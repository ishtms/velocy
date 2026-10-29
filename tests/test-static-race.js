const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const { Writable, Readable } = require('node:stream');
const { finished } = require('node:stream/promises');
const staticMiddleware = require('../lib/middleware/static');
const { Router } = require('../index');
const { TestRunner, assert, assertEqual, createTestServer, cleanupTempDir } = require('./test-helper');

const runner = new TestRunner('Static Descriptor Race Tests');

// Direct middleware fixtures keep each scheduling point deterministic; no live
// race loops or global mocks survive a test. TestRunner executes sequentially.
function response() {
  const chunks = [];
  const res = new Writable({ write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  res._headers = {};
  res.statusCode = 200;
  res.headersSent = false;
  res.set = (key, value) => { res._headers[key.toLowerCase()] = value; return res; };
  res.removeHeader = key => { delete res._headers[key]; return res; };
  res.status = code => { res.statusCode = code; return res; };
  res.send = body => { res.end(body); return res; };
  res.writeHead = code => { res.statusCode = code; res.headersSent = true; };
  res.body = () => Buffer.concat(chunks).toString();
  return res;
}

// Unlike makeRequest, this captures an aborted HTTP entity rather than waiting
// only for 'end'. A referenced deadline makes incomplete framing a test failure.
function captureHttp(port, headers = {}, onData) {
  return new Promise((resolve, reject) => {
    let incoming;
    const chunks = [];
    let error;
    let ended = false;
    const request = http.get({ hostname: '127.0.0.1', port, path: '/file.txt', headers, agent: false }, res => {
      incoming = res;
      res.on('data', chunk => { chunks.push(chunk); if (onData) onData(res); });
      res.on('error', err => { error = err; });
      res.on('end', () => { ended = true; });
      res.on('close', finish);
    });
    const deadline = setTimeout(() => {
      request.destroy();
      if (incoming) incoming.destroy();
      reject(new Error('HTTP fixture did not terminate within 3 seconds'));
    }, 3000);
    function finish() {
      clearTimeout(deadline);
      resolve({ incoming, error, ended, body: Buffer.concat(chunks).toString(), complete: incoming ? incoming.complete : false });
    }
    request.on('error', err => { error = err; if (!incoming) finish(); });
  });
}

async function fixture(run) {
  const tempRoot = path.join(__dirname, 'temp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const temp = fs.mkdtempSync(path.join(tempRoot, 'static-race-'));
  const root = path.join(temp, 'root');
  fs.mkdirSync(root);
  const file = path.join(root, 'file.txt');
  fs.writeFileSync(file, 'public');
  const originalOpen = fs.promises.open;
  const originalStream = fs.createReadStream;
  const handles = [];
  const closed = [];
  const context = {
    temp, root, file, handles, closed,
    async open(filePath, flags) {
      const handle = await originalOpen(filePath, flags);
      handles.push(handle);
      const close = handle.close.bind(handle);
      handle.close = async () => { await close(); closed.push(handle); };
      return handle;
    },
    async request(url = '/file.txt', headers = {}, options = {}, method = 'GET') {
      const res = response();
      const done = finished(res).catch(err => err);
      await staticMiddleware(root, { fallthrough: false, ...options })({ method, url, headers }, res);
      res.completionError = await done;
      return res;
    },
    async http(options, runRequest) {
      let native;
      let finishMiddleware;
      let finishClose;
      const completed = new Promise(resolve => { finishMiddleware = resolve; });
      const nativeClosed = new Promise(resolve => { finishClose = resolve; });
      const app = new Router();
      app.use(async (req, res, next) => {
        native = res._nativeResponse;
        native.once('close', finishClose);
        try {
          await staticMiddleware(root, { fallthrough: false, ...options })(req, res, next);
        } finally {
          finishMiddleware();
        }
      });
      const server = await createTestServer(app);
      try {
        await runRequest(server.port, () => native, completed, nativeClosed);
        await completed;
      } finally {
        await server.close();
      }
    }
  };
  fs.promises.open = context.open;
  try {
    await run(context);
    assertEqual(closed.length, handles.length,
      `every opened handle must close exactly once (opened ${handles.length}, closed ${closed.length})`);
    assertEqual(new Set(closed).size, handles.length, 'no handle may be closed twice instead of another');
  } finally {
    fs.promises.open = originalOpen;
    fs.createReadStream = originalStream;
    // Only failed tests can leave handles here; preserve cleanup without hiding
    // the assertion that detected the leak.
    for (const handle of handles) {
      if (!closed.includes(handle)) await handle.close();
    }
    cleanupTempDir(temp);
  }
}

runner.test('Should reject a regular-file replacement between check and open', async () => {
  await fixture(async ctx => {
    const replacement = path.join(ctx.temp, 'replacement');
    fs.writeFileSync(replacement, 'private replacement');
    fs.promises.open = async (filePath, flags) => {
      fs.renameSync(replacement, filePath);
      return ctx.open(filePath, flags);
    };
    const res = await ctx.request();
    assertEqual(res.statusCode, 403);
    assertEqual(res.body(), 'Forbidden');
    assertEqual(ctx.handles.length, 1);
  });
});

runner.test('Should reject a symlink swapped in immediately before open', async () => {
  await fixture(async ctx => {
    const secret = path.join(ctx.temp, 'secret');
    fs.writeFileSync(secret, 'private');
    fs.promises.open = async (filePath, flags) => {
      assertEqual(flags & (fs.constants.O_NOFOLLOW || 0), fs.constants.O_NOFOLLOW || 0);
      assertEqual(flags & (fs.constants.O_NONBLOCK || 0), fs.constants.O_NONBLOCK || 0);
      fs.unlinkSync(filePath);
      fs.symlinkSync(secret, filePath);
      return ctx.open(filePath, flags);
    };
    const res = await ctx.request();
    assertEqual(res.statusCode, 403);
    assertEqual(res.body(), 'Forbidden');
  });
});

runner.test('Should reject an intermediate-directory replacement observed at open', async () => {
  await fixture(async ctx => {
    const nested = path.join(ctx.root, 'nested');
    const outside = path.join(ctx.temp, 'outside');
    fs.mkdirSync(nested);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(nested, 'file.txt'), 'public');
    fs.writeFileSync(path.join(outside, 'file.txt'), 'private');
    fs.promises.open = async (filePath, flags) => {
      fs.renameSync(nested, path.join(ctx.temp, 'old-nested'));
      fs.symlinkSync(outside, nested, 'dir');
      return ctx.open(filePath, flags);
    };
    const res = await ctx.request('/nested/file.txt');
    assertEqual(res.statusCode, 403);
    assertEqual(res.body(), 'Forbidden');
    assertEqual(ctx.handles.length, 1);
  });
});

runner.test('Should not reopen a path changed by setHeaders after descriptor validation', async () => {
  await fixture(async ctx => {
    const replacement = path.join(ctx.temp, 'replacement');
    fs.writeFileSync(replacement, 'private replacement');
    const originalStream = fs.createReadStream;
    let streams = 0;
    let descriptor;
    fs.createReadStream = (filePath, options) => {
      descriptor = options.fd;
      streams++;
      return originalStream(filePath, options);
    };
    const res = await ctx.request('/file.txt', {}, {
      setHeaders(filePath) { fs.renameSync(replacement, filePath); }
    });
    assertEqual(res.statusCode, 200);
    assertEqual(res.body(), 'public');
    assertEqual(res._headers['content-length'], 6);
    assert(descriptor && Number.isInteger(descriptor.fd),
      'stream must adopt a FileHandle (which may already be closed)');
    assertEqual(streams, 1);
    assertEqual(ctx.handles.length, 1);
  });
});

runner.test('Should retain original bytes when a late path becomes a symlink', async () => {
  await fixture(async ctx => {
    const secret = path.join(ctx.temp, 'secret');
    fs.writeFileSync(secret, 'secret');
    const res = await ctx.request('/file.txt', {}, {
      setHeaders(filePath) {
        fs.unlinkSync(filePath);
        fs.symlinkSync(secret, filePath);
      }
    });
    assertEqual(res.statusCode, 200);
    assertEqual(res.body(), 'public');
    assertEqual(ctx.handles.length, 1);
  });
});

runner.test('Should reject a non-regular descriptor before sending file headers', async () => {
  await fixture(async ctx => {
    fs.promises.open = async (filePath, flags) => {
      const handle = await ctx.open(filePath, flags);
      handle.stat = async () => fs.statSync(ctx.root);
      return handle;
    };
    const res = await ctx.request();
    assertEqual(res.statusCode, 403);
    assertEqual(res.headersSent, false);
    assertEqual(res.body(), 'Forbidden');
  });
});

runner.test('Should reject a path replaced after open but before revalidation', async () => {
  await fixture(async ctx => {
    const replacement = path.join(ctx.temp, 'replacement');
    fs.writeFileSync(replacement, 'private replacement');
    fs.promises.open = async (filePath, flags) => {
      const handle = await ctx.open(filePath, flags);
      fs.renameSync(replacement, filePath);
      return handle;
    };
    const res = await ctx.request();
    assertEqual(res.statusCode, 403);
    assertEqual(res.body(), 'Forbidden');
    assertEqual(ctx.handles.length, 1);
  });
});

runner.test('Should close the descriptor when fstat or setHeaders throws', async () => {
  await fixture(async ctx => {
    fs.promises.open = async (filePath, flags) => {
      const handle = await ctx.open(filePath, flags);
      handle.stat = async () => { throw new Error('fixture stat failure'); };
      return handle;
    };
    let res = await ctx.request();
    assertEqual(res.statusCode, 500);
    assertEqual(res.body(), 'Internal Server Error');
    fs.promises.open = ctx.open;
    res = await ctx.request('/file.txt', {}, { setHeaders() { throw new Error('fixture header failure'); } });
    assertEqual(res.statusCode, 500);
    assertEqual(res.body(), 'Internal Server Error');
    assertEqual(ctx.handles.length, 2);
  });
});

runner.test('Should bind HEAD, 304, 416 and empty-file responses to closed descriptors', async () => {
  await fixture(async ctx => {
    let res = await ctx.request('/file.txt', {}, {}, 'HEAD');
    assertEqual(res.statusCode, 200);
    assertEqual(res.body(), '');
    assertEqual(res._headers['content-length'], 6);
    res = await ctx.request('/file.txt', { 'if-none-match': res._headers.etag });
    assertEqual(res.statusCode, 304);
    assertEqual(res.body(), '');
    res = await ctx.request('/file.txt', { range: 'bytes=99-100' });
    assertEqual(res.statusCode, 416);
    assertEqual(res.body(), '');
    fs.writeFileSync(ctx.file, '');
    res = await ctx.request();
    assertEqual(res.statusCode, 200);
    assertEqual(res.body(), '');
    assertEqual(res._headers['content-length'], 0);
    assertEqual(ctx.handles.length, 4);
  });
});

runner.test('Should use opened metadata after an in-place trusted update', async () => {
  await fixture(async ctx => {
    fs.promises.open = async (filePath, flags) => {
      fs.writeFileSync(filePath, 'updated contents');
      return ctx.open(filePath, flags);
    };
    const res = await ctx.request();
    assertEqual(res.statusCode, 200);
    assertEqual(res.body(), 'updated contents');
    assertEqual(res._headers['content-length'], Buffer.byteLength('updated contents'));
  });
});

runner.test('Should bind index, extension and compressed candidates to descriptors', async () => {
  await fixture(async ctx => {
    fs.writeFileSync(path.join(ctx.root, 'index.html'), 'index');
    fs.writeFileSync(path.join(ctx.root, 'page.html'), 'page');
    fs.writeFileSync(ctx.file + '.gz', 'gzip fixture');
    fs.writeFileSync(ctx.file + '.br', 'brotli fixture');
    for (const [url, headers, options, body] of [
      ['/', {}, {}, 'index'],
      ['/page', {}, { extensions: ['.html'] }, 'page'],
      ['/file.txt', { 'accept-encoding': 'gzip' }, {}, 'gzip fixture'],
      ['/file.txt', { 'accept-encoding': 'br' }, {}, 'brotli fixture'],
      ['/file.txt', { range: 'bytes=1-3' }, {}, 'ubl']
    ]) {
      const before = ctx.handles.length;
      const res = await ctx.request(url, headers, options);
      assertEqual(res.statusCode, headers.range ? 206 : 200);
      assertEqual(res.body(), body);
      assertEqual(ctx.handles.length, before + 1);
    }
  });
});

runner.test('Should reject swapped index, extension and compressed candidates without encoding error bodies', async () => {
  await fixture(async ctx => {
    fs.writeFileSync(path.join(ctx.root, 'index.html'), 'index');
    fs.writeFileSync(path.join(ctx.root, 'page.html'), 'page');
    fs.writeFileSync(ctx.file + '.gz', 'gzip fixture');
    fs.writeFileSync(ctx.file + '.br', 'brotli fixture');
    fs.promises.open = async (filePath, flags) => {
      const replacement = path.join(ctx.temp, 'replacement');
      fs.writeFileSync(replacement, 'private replacement');
      fs.renameSync(replacement, filePath);
      return ctx.open(filePath, flags);
    };
    for (const [url, headers, options] of [
      ['/', {}, {}],
      ['/page', {}, { extensions: ['.html'] }],
      ['/file.txt', { 'accept-encoding': 'gzip' }, {}],
      ['/file.txt', { 'accept-encoding': 'br' }, {}]
    ]) {
      const res = await ctx.request(url, headers, options);
      assertEqual(res.statusCode, 403);
      assertEqual(res.body(), 'Forbidden');
      assertEqual(res._headers['content-encoding'], undefined);
    }
    assertEqual(ctx.handles.length, 4);
  });
});

runner.test('Should close the descriptor after a read failure', async () => {
  await fixture(async ctx => {
    fs.createReadStream = (filePath, options) => {
      assert(Number.isInteger(options.fd.fd));
      return new Readable({ read() { this.destroy(new Error('fixture read failure')); } });
    };
    const res = await ctx.request();
    assertEqual(res.body(), '');
    assert(res.destroyed, 'committed read failure must destroy response');
    assertEqual(res.writableEnded, false, 'must not gracefully end a truncated entity');
    assertEqual(res.completionError.code, 'ERR_STREAM_PREMATURE_CLOSE');
    assertEqual(ctx.handles.length, 1);
  });
});

runner.test('Should stop reading and close the descriptor on client disconnect', async () => {
  await fixture(async ctx => {
    let source;
    fs.createReadStream = () => {
      source = new Readable({ read() {} });
      return source;
    };
    const res = response();
    const done = finished(res).catch(err => err);
    res.writeHead = () => { res.headersSent = true; setImmediate(() => res.destroy()); };
    await staticMiddleware(ctx.root, { fallthrough: false })({ method: 'GET', url: '/file.txt', headers: {} }, res);
    await done;
    assert(source.destroyed, 'disconnect must destroy source');
    assertEqual(ctx.handles.length, 1);
  });
});

runner.test('Should close without streaming if the response disconnects during open', async () => {
  await fixture(async ctx => {
    const res = response();
    const done = finished(res).catch(err => err);
    fs.promises.open = async (filePath, flags) => {
      const handle = await ctx.open(filePath, flags);
      res.destroy();
      return handle;
    };
    fs.createReadStream = () => { throw new Error('must not stream a closed response'); };
    await staticMiddleware(ctx.root, { fallthrough: false })({ method: 'GET', url: '/file.txt', headers: {} }, res);
    await done;
    assertEqual(res.headersSent, false);
    assertEqual(ctx.handles.length, 1);
  });
});

for (const partial of [false, true]) {
  runner.test(`Should abort real HTTP response on read error ${partial ? 'after partial data' : 'before first byte'}`, async () => {
    await fixture(async ctx => {
      let releaseFailure;
      const delivered = new Promise(resolve => { releaseFailure = resolve; });
      let source;
      let reads = 0;
      const originalStream = fs.createReadStream;
      fs.createReadStream = (filePath, options) => {
        // This is a real fs.ReadStream adopting the real opened FileHandle.
        source = originalStream(filePath, { ...options, highWaterMark: 3 });
        return source;
      };
      fs.promises.open = async (filePath, flags) => {
        const handle = await ctx.open(filePath, flags);
        const read = handle.read.bind(handle);
        handle.read = async (...args) => {
          reads++;
          if (partial && reads === 1) return read(...args);
          if (partial) await delivered;
          throw new Error('fixture real-handle read failure');
        };
        return handle;
      };
      await ctx.http({}, async (port, native) => {
        const result = await captureHttp(port, {}, releaseFailure);
        assertEqual(result.complete, false, 'client must not see a complete success entity');
        assertEqual(result.ended, false, 'truncated entity must not emit end');
        assert(native().destroyed, 'native response/socket must be destroyed');
        assertEqual(native().writableEnded, false, 'server must not end a failed success entity');
        assertEqual(result.error.code, 'ECONNRESET');
        if (partial) {
          assertEqual(result.incoming.statusCode, 200);
          assertEqual(result.body, 'pub');
          assertEqual(result.incoming.headers['content-length'], '6');
        } else {
          assertEqual(result.body, '');
        }
      });
      assert(source.destroyed);
      assertEqual(ctx.handles.length, 1);
      assertEqual(reads, partial ? 2 : 1, 'failure must use real FileHandle.read');
    });
  });
}

for (const encoding of ['', 'gzip', 'br']) {
  runner.test(`Should reset real HTTP error headers when setHeaders throws for ${encoding || 'ordinary'} file`, async () => {
    await fixture(async ctx => {
      fs.writeFileSync(ctx.file + '.gz', zlib.gzipSync('public'));
      fs.writeFileSync(ctx.file + '.br', zlib.brotliCompressSync('public'));
      await ctx.http({
        setHeaders(filePath, stats, res) {
          // Case variants exercise the existing wrapper's exact-key removal;
          // native queued headers must not reappear when it writes the error.
          res.set('content-length', '999');
          res.set('CONTENT-ENCODING', encoding || 'gzip');
          res.set('content-range', 'bytes 0-2/999');
          res.set('CACHE-CONTROL', 'public, max-age=31536000, immutable');
          res.set('X-Frame-Options', 'DENY');
          res._nativeResponse.setHeader('Content-Encoding', 'br');
          throw new Error('fixture callback failure');
        }
      }, async port => {
        const result = await captureHttp(port, { range: 'bytes=0-2', 'accept-encoding': encoding });
        assertEqual(result.incoming.statusCode, 500);
        assertEqual(result.complete, true);
        assertEqual(result.ended, true);
        assertEqual(result.body, 'Internal Server Error');
        const headers = result.incoming.headers;
        assertEqual(headers['content-length'], '21');
        assertEqual(headers['content-type'], 'text/plain; charset=utf-8');
        assertEqual(headers['cache-control'], 'no-store');
        assertEqual(headers['x-frame-options'], 'DENY');
        for (const name of ['content-encoding', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
          assertEqual(headers[name], undefined, `${name} must not describe the failed file`);
        }
      });
      assertEqual(ctx.handles.length, 1);
    });
  });
}

runner.test('Should wait for pending real-handle I/O before closing on HTTP client disconnect', async () => {
  await fixture(async ctx => {
    let releaseRead;
    let readStarted;
    const pendingRead = new Promise(resolve => { releaseRead = resolve; });
    const started = new Promise(resolve => { readStarted = resolve; });
    let reads = 0;
    let source;
    const originalStream = fs.createReadStream;
    fs.createReadStream = (filePath, options) => {
      source = originalStream(filePath, { ...options, highWaterMark: 3 });
      return source;
    };
    fs.promises.open = async (filePath, flags) => {
      const handle = await ctx.open(filePath, flags);
      const read = handle.read.bind(handle);
      handle.read = async (...args) => {
        if (++reads === 2) {
          readStarted();
          await pendingRead;
        }
        return read(...args);
      };
      return handle;
    };
    await ctx.http({}, async (port, native, completed, nativeClosed) => {
      const result = await captureHttp(port, {}, incoming => incoming.destroy());
      assertEqual(result.body, 'pub');
      await started;
      await nativeClosed;
      assert(source.destroyed, 'native close must stop the real source');
      assertEqual(ctx.closed.length, 0, 'pending descriptor read must settle before close');
      releaseRead();
      await completed;
      assertEqual(ctx.closed.length, 1);
      assertEqual(ctx.handles[0].fd, -1);
    });
  });
});

runner.test('Should restore upstream header snapshots on EACCES fallthrough after file headers were applied', async () => {
  await fixture(async ctx => {
    const app = new Router();
    app.use((req, res, next) => {
      res.set('Cache-Control', 'private, max-age=60');
      res.set('ETag', '"upstream"');
      res.set('X-Upstream-Multi', ['one', 'two']);
      res._nativeResponse.setHeader('X-Native-Upstream', 'retained');
      res._nativeResponse.setHeader('X-Native-Multi', ['first', 'second']);
      return next();
    });
    app.use(staticMiddleware(ctx.root, {
      setHeaders(filePath, stats, res) {
        res.set('X-Static', 'must not leak');
        res.getHeader('X-Upstream-Multi').push('mutated');
        res._nativeResponse.getHeader('X-Native-Multi').push('mutated');
        res._nativeResponse.removeHeader('X-Native-Upstream');
        res._nativeResponse.setHeader('X-Native-Static', 'must not leak');
        const err = new Error('fixture access denied');
        err.code = 'EACCES';
        throw err;
      }
    }));
    app.get('/file.txt', (req, res) => res.status(200).send('<h1>downstream</h1>'));
    const server = await createTestServer(app);
    try {
      const result = await captureHttp(server.port);
      assertEqual(result.complete, true);
      assertEqual(result.body, '<h1>downstream</h1>');
      const headers = result.incoming.headers;
      assertEqual(headers['content-type'], 'text/html; charset=utf-8');
      assertEqual(headers['content-length'], String(Buffer.byteLength(result.body)));
      assertEqual(headers['cache-control'], 'private, max-age=60');
      assertEqual(headers.etag, '"upstream"');
      assertEqual(headers['x-upstream-multi'], 'one, two');
      assertEqual(headers['x-native-multi'], 'first, second');
      assertEqual(headers['x-native-upstream'], 'retained');
      for (const name of ['x-static', 'x-native-static', 'content-range', 'content-encoding', 'accept-ranges', 'last-modified']) {
        assertEqual(headers[name], undefined, `${name} must not leak into downstream response`);
      }
    } finally {
      await server.close();
    }
    assertEqual(ctx.handles.length, 1);
  });
});

for (const commit of ['writeHead', 'flushHeaders']) {
  runner.test(`Should abort without resetting headers when native ${commit} commits before callback throws`, async () => {
    await fixture(async ctx => {
      let wrapper;
      let resetAttempts = 0;
      await ctx.http({
        setHeaders(filePath, stats, res) {
          wrapper = res;
          const native = res._nativeResponse;
          native.setHeader('Content-Type', 'application/octet-stream');
          native.setHeader('Content-Length', '100');
          if (commit === 'writeHead') native.writeHead(200);
          else native.flushHeaders();
          native.write('pub');
          const remove = native.removeHeader.bind(native);
          native.removeHeader = (...args) => { resetAttempts++; return remove(...args); };
          throw new Error('fixture native committed then callback failed');
        }
      }, async (port, native) => {
        const result = await captureHttp(port);
        assertEqual(wrapper.headersSent, true, 'wrapper must reflect native commitment');
        assertEqual(native().headersSent, true);
        assertEqual(resetAttempts, 0, 'no header reset is allowed after native commitment');
        assert(native().destroyed);
        assertEqual(native().writableEnded, false);
        assertEqual(result.complete, false);
        assertEqual(result.ended, false);
        assert(!result.body.includes('Internal Server Error'));
        assertEqual(result.error.code, 'ECONNRESET');
      });
      assertEqual(ctx.handles.length, 1);
    });
  });
}

// Pending promises alone do not keep Node alive. Keep a referenced deadline
// until every registered test has actually completed; never allow silent exit 0.
const suiteDeadline = setTimeout(() => {
  console.error(`Static race suite stalled: ${runner.passed + runner.failed}/${runner.tests.length} completed`);
  process.exit(1);
}, 20000);
runner.run().then(success => {
  clearTimeout(suiteDeadline);
  const completed = runner.passed + runner.failed;
  assertEqual(completed, runner.tests.length, 'all registered tests must complete');
  console.log(`Completion: ${completed}/${runner.tests.length}`);
  process.exit(success ? 0 : 1);
}).catch(err => {
  clearTimeout(suiteDeadline);
  console.error(err.message);
  process.exit(1);
});
