const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable, PassThrough } = require('node:stream');
const { TestRunner } = require('./test-helper');
const bodyParser = require('../lib/middleware/bodyParser');

const runner = new TestRunner('Body Parser Security Tests');
const boundary = 'P1-boundary';
const type = `multipart/form-data; boundary=${boundary}`;

function quotedParameter(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function multipart(parts, token = boundary) {
  const chunks = [];
  for (const part of parts) {
    const disposition = part.disposition ?? `form-data; name=${quotedParameter(part.name ?? 'field')}${part.filename === undefined ? '' : `; filename=${quotedParameter(part.filename)}`}`;
    chunks.push(Buffer.from(`--${token}\r\nContent-Disposition: ${disposition}\r\n${part.type ? `Content-Type: ${part.type}\r\n` : ''}\r\n`));
    chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value ?? 'value'));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${token}--\r\n`));
  return Buffer.concat(chunks);
}

async function parse(data, contentType = type, options = {}, stream) {
  const req = {
    method: 'POST', headers: { 'content-type': contentType },
    nativeRequest: stream || Readable.from([Buffer.isBuffer(data) ? data : Buffer.from(data)])
  };
  let error;
  let calls = 0;
  await bodyParser(options)(req, {}, value => { error = value; calls++; });
  assert.equal(calls, 1, 'middleware must settle once');
  return { req, error };
}

async function temporaryDirectory(test) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'velocy-body-security-'));
  try {
    await test(directory);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
}

function expectError(result, code, status = 400) {
  assert.equal(result.error?.code, code);
  assert.equal(result.error?.statusCode, status);
  assert.equal(Object.hasOwn(result.req, 'body'), false);
  assert.equal(result.req.files, undefined);
}

runner.test('Boundary-like binary payload bytes must not split a file', async () => {
  const bytes = Buffer.concat([
    Buffer.from(`before--${boundary}\r\ninside\r\n--${boundary}X\r\n--${boundary}--not-a-delimiter\r\nafter`),
    Buffer.from([0, 255, 128, 13, 10])
  ]);
  const result = await parse(multipart([{ filename: 'binary.dat', value: bytes }]));
  assert.equal(result.error, undefined);
  assert.deepEqual(result.req.files.field.buffer, bytes);
});

runner.test('Quoted boundary with spaces and case-insensitive parameter is supported', async () => {
  const token = 'quoted boundary';
  const result = await parse(multipart([{ value: 'ok' }], token), `multipart/form-data; BOUNDARY="${token}"`);
  assert.equal(result.error, undefined);
  assert.equal(result.req.body.field, 'ok');
});

runner.test('Multipart requires a valid boundary and complete closing delimiter', async () => {
  for (const contentType of ['multipart/form-data', 'multipart/form-data; boundary=""', `multipart/form-data; boundary=${'b'.repeat(71)}`, 'multipart/form-data; boundary="bad\r\nvalue"']) {
    const result = await parse('invalid', contentType);
    assert.equal(result.error?.statusCode, 400);
  }
  const complete = multipart([{ value: 'ok' }]);
  expectError(await parse(complete.subarray(0, complete.lastIndexOf(`--${boundary}--`))), 'INVALID_MULTIPART');
  expectError(await parse(Buffer.from(`--${boundary}\r\nnot-headers\r\n--${boundary}--\r\n`)), 'INVALID_MULTIPART');
});

runner.test('MIME preamble, epilogue, transport padding and empty multipart are supported', async () => {
  const data = Buffer.from(`preamble\r\n--${boundary} \t\r\nContent-Disposition: form-data; name="x"\r\n\r\ny\r\n--${boundary}-- \t\r\nepilogue`);
  const result = await parse(data);
  assert.equal(result.error, undefined);
  assert.equal(result.req.body.x, 'y');
  assert.equal((await parse(`--${boundary}--`)).error, undefined);
});

runner.test('Multipart field and file namespaces remain separate for matching names', async () => {
  const result = await parse(multipart([{ name: 'shared', value: 'text' }, { name: 'shared', filename: 'file.txt', value: 'file' }]));
  assert.equal(result.error, undefined);
  assert.equal(result.req.body.shared, 'text');
  assert.equal(result.req.files.shared.originalFilename, 'file.txt');
  assert.equal(Object.getPrototypeOf(result.req.body), null);
  assert.equal(Object.getPrototypeOf(result.req.files), null);
});

runner.test('Empty filename remains a file and obeys empty-file rejection', async () => {
  const data = multipart([{ filename: '', value: '' }]);
  expectError(await parse(data, type, { allowEmptyFiles: false }), 'EMPTY_FILE');
  const result = await parse(data);
  assert.equal(result.error, undefined);
  assert.equal(result.req.files.field.originalFilename, '');
});

runner.test('Escaped filename quotes and backslashes preserve file classification and binary bytes', async () => {
  await temporaryDirectory(async uploadDir => {
    const bytes = Buffer.from([0xff, 0x80, 0, 13, 10, 0x22, 0x5c]);
    for (const filename of ['a"b.txt', 'a\\b.txt', 'a";name="spoofed;filename="b.txt']) {
      for (const fileMemoryLimit of [0, 1024]) {
        const result = await parse(multipart([{ name: 'upload', filename, value: bytes }]), type, { uploadDir, fileMemoryLimit });
        assert.equal(result.error, undefined);
        assert.equal(result.req.files?.upload?.originalFilename, filename);
        assert.equal(Object.keys(result.req.body).length, 0);
        const file = result.req.files.upload;
        assert.deepEqual(file.inMemory ? file.buffer : await fs.promises.readFile(file.filepath), bytes);
      }
    }
  });
});

runner.test('Escaped filenames cannot bypass any file-specific policy', async () => {
  for (const filename of ['a"b.txt', 'a\\b.txt']) {
    const data = multipart([{ name: 'upload', filename, value: Buffer.from([255, 128, 0]), type: 'application/octet-stream' }]);
    expectError(await parse(data, type, { maxFiles: 0 }), 'LIMIT_FILE_COUNT', 413);
    expectError(await parse(data, type, { maxFileSize: 2 }), 'LIMIT_FILE_SIZE', 413);
    expectError(await parse(data, type, { allowedTypes: ['text/plain'] }), 'UNSUPPORTED_MEDIA_TYPE', 415);
    expectError(await parse(multipart([{ name: 'upload', filename, value: '' }]), type, { allowEmptyFiles: false }), 'EMPTY_FILE');
  }
});

runner.test('Disposition parameter parsing supports tokens, quoting and parameter order without spoofing', async () => {
  for (const disposition of [
    'form-data; filename=plain.txt; name=upload',
    'FORM-DATA ; FILENAME = "a\\"b.txt" ; NAME = "up\\load"',
    'form-data; note="; filename=not-a-file"; name=upload'
  ]) {
    const result = await parse(multipart([{ disposition, value: Buffer.from([255, 0, 128]) }]));
    assert.equal(result.error, undefined);
    if (disposition.includes('note=')) {
      assert.equal(result.req.files, undefined);
      assert.equal(Object.keys(result.req.body).length, 1);
    } else {
      assert.deepEqual(result.req.files.upload.buffer, Buffer.from([255, 0, 128]));
    }
  }
});

runner.test('Malformed or ambiguous filename parameters reject instead of becoming fields', async () => {
  const invalid = [
    'filename="unterminated',
    'filename="trailing\\',
    'filename="a\\"b.txt"junk',
    'filename="a.txt"; filename="b.txt"',
    'filename="a.txt"; FILENAME="a.txt"',
    'filename="a.txt"; filename',
    'filename',
    'filename=',
    'filename=bad name.txt',
    'filename="bad\0name.txt"',
    'filename="bad\\\x01name.txt"',
    'filename*=UTF-8\'\'file.txt',
    'filename="a.txt"; filename*=UTF-8\'\'b.txt',
    'filename*0="a"; filename*1=".txt"',
    'filename="a.txt"; name="different"'
  ];
  for (const parameters of invalid) {
    expectError(await parse(multipart([{ disposition: `form-data; name="upload"; ${parameters}`, value: Buffer.from([255, 0, 128]) }])), 'INVALID_MULTIPART');
  }
});

runner.test('Ambiguous later filename parameters roll back previously written uploads', async () => {
  await temporaryDirectory(async uploadDir => {
    const data = multipart([
      { name: 'first', filename: 'valid.txt' },
      { disposition: 'form-data; name="upload"; filename="one.txt"; filename="two.txt"' }
    ]);
    expectError(await parse(data, type, { uploadDir, fileMemoryLimit: 0 }), 'INVALID_MULTIPART');
    assert.deepEqual(await fs.promises.readdir(uploadDir), []);
  });
});

runner.test('Multipart size, header, field, file and part counts are bounded', async () => {
  const fields = multipart([{ value: 'abc' }, { value: 'def' }]);
  const files = multipart([{ filename: '1.txt' }, { filename: '2.txt' }]);
  expectError(await parse(fields, type, { multipartLimit: fields.length - 1 }), 'LIMIT_FILE_SIZE', 413);
  expectError(await parse(fields, type, { maxHeaderSize: 4 }), 'LIMIT_HEADER_SIZE', 413);
  expectError(await parse(fields, type, { maxFieldSize: 2 }), 'LIMIT_FIELD_SIZE', 413);
  expectError(await parse(fields, type, { maxFields: 1 }), 'LIMIT_FIELD_COUNT', 413);
  expectError(await parse(fields, type, { maxParts: 1 }), 'LIMIT_PART_COUNT', 413);
  expectError(await parse(files, type, { maxFiles: 1 }), 'LIMIT_FILE_COUNT', 413);
  expectError(await parse(files, type, { maxFileSize: 1 }), 'LIMIT_FILE_SIZE', 413);
  assert.equal((await parse(fields, type, { maxFields: 2, maxParts: 2, maxFieldSize: 3 })).error, undefined);
});

runner.test('Disk upload is private and retained for caller cleanup on success', async () => {
  await temporaryDirectory(async uploadDir => {
    const result = await parse(multipart([{ filename: 'source.txt', value: 'disk data' }]), type, {
      uploadDir, fileMemoryLimit: 0, filename: () => 'stored.txt'
    });
    assert.equal(result.error, undefined);
    const file = result.req.files.field;
    assert.equal(file.path, path.join(uploadDir, 'stored.txt'));
    assert.equal(await fs.promises.readFile(file.path, 'utf8'), 'disk data');
    assert.equal((await fs.promises.stat(file.path)).mode & 0o777, 0o600);
  });
});

runner.test('Unsafe custom filenames are rejected in disk and memory storage', async () => {
  await temporaryDirectory(async uploadDir => {
    for (const fileMemoryLimit of [0, 1000]) {
      for (const filename of ['../escape.txt', '..\\escape.txt', '/absolute.txt', 'C:\\escape.txt', '.', '..', '', 'bad\0.txt', 'trailing.', 'trailing ', 'CON', 'nul.txt', 'COM1.txt', 12, 'x'.repeat(256)]) {
        expectError(await parse(multipart([{ filename: 'source.txt' }]), type, {
          uploadDir, fileMemoryLimit, filename: () => filename
        }), 'INVALID_FILENAME');
      }
    }
    assert.deepEqual(await fs.promises.readdir(uploadDir), []);
  });
});

runner.test('Exclusive upload creation does not overwrite existing files or symlinks', async () => {
  await temporaryDirectory(async uploadDir => {
    const target = path.join(uploadDir, 'target.txt');
    await fs.promises.writeFile(target, 'keep');
    await fs.promises.symlink(target, path.join(uploadDir, 'link.txt'));
    for (const filename of ['target.txt', 'link.txt']) {
      expectError(await parse(multipart([{ filename: 'source.txt', value: 'overwrite' }]), type, {
        uploadDir, fileMemoryLimit: 0, filename: () => filename
      }), 'PARSE_ERROR');
      assert.equal(await fs.promises.readFile(target, 'utf8'), 'keep');
    }
    assert.deepEqual((await fs.promises.readdir(uploadDir)).sort(), ['link.txt', 'target.txt']);
  });
});

runner.test('A later failed part rolls back all previously created disk uploads', async () => {
  await temporaryDirectory(async uploadDir => {
    for (const options of [{ maxFiles: 1 }, { maxFileSize: 4 }, { allowedTypes: ['text/plain'] }]) {
      const data = multipart([
        { filename: 'ok.txt', value: 'ok', type: 'text/plain' },
        { filename: 'bad.txt', value: 'too large', type: 'application/octet-stream' }
      ]);
      const result = await parse(data, type, { uploadDir, fileMemoryLimit: 0, ...options });
      assert.ok(result.error);
      assert.deepEqual(await fs.promises.readdir(uploadDir), [], 'rollback completes before next(error)');
    }
    const data = multipart([{ filename: 'ok.txt' }, { value: 'value' }]);
    expectError(await parse(data.subarray(0, data.lastIndexOf(`--${boundary}--`)), type, { uploadDir, fileMemoryLimit: 0 }), 'INVALID_MULTIPART');
    assert.deepEqual(await fs.promises.readdir(uploadDir), []);
  });
});

runner.test('Partial disk-write failures close the descriptor and remove created files', async () => {
  await temporaryDirectory(async uploadDir => {
    const originalOpen = fs.promises.open;
    let closed = false;
    fs.promises.open = async (...args) => {
      const handle = await originalOpen(...args);
      return {
        async writeFile() { await handle.writeFile('partial'); throw new Error('simulated write failure'); },
        async close() { await handle.close(); closed = true; }
      };
    };
    try {
      expectError(await parse(multipart([{ filename: 'file.txt' }]), type, { uploadDir, fileMemoryLimit: 0 }), 'PARSE_ERROR');
      assert.equal(closed, true);
      assert.deepEqual(await fs.promises.readdir(uploadDir), []);
    } finally {
      fs.promises.open = originalOpen;
    }
  });
});

runner.test('Rollback reports cleanup failures and still attempts the remaining files', async () => {
  await temporaryDirectory(async uploadDir => {
    const originalUnlink = fs.promises.unlink;
    let calls = 0;
    fs.promises.unlink = async filename => {
      if (++calls === 1) throw Object.assign(new Error('simulated cleanup denial'), { code: 'EACCES' });
      return originalUnlink(filename);
    };
    try {
      expectError(await parse(multipart([{ filename: '1.txt' }, { filename: '2.txt' }, { filename: '3.txt' }]), type, {
        uploadDir, fileMemoryLimit: 0, maxFiles: 2
      }), 'UPLOAD_CLEANUP_FAILED', 500);
      assert.equal(calls, 2);
      assert.equal((await fs.promises.readdir(uploadDir)).length, 1);
    } finally {
      fs.promises.unlink = originalUnlink;
    }
  });
});

runner.test('Aborting during an asynchronous disk write rolls back the upload', async () => {
  await temporaryDirectory(async uploadDir => {
    const stream = Readable.from([multipart([{ filename: 'file.txt' }])]);
    const originalOpen = fs.promises.open;
    fs.promises.open = async (...args) => {
      const handle = await originalOpen(...args);
      stream.emit('aborted');
      return handle;
    };
    try {
      expectError(await parse('', type, { uploadDir, fileMemoryLimit: 0 }, stream), 'REQUEST_ABORTED');
      assert.deepEqual(await fs.promises.readdir(uploadDir), []);
    } finally {
      fs.promises.open = originalOpen;
    }
  });
});

runner.test('Aborted, prematurely closed and already closed bodies settle without hanging', async () => {
  for (const contentType of [type, 'application/json', 'application/x-www-form-urlencoded', 'text/plain']) {
    for (const event of ['aborted', 'close', 'destroyed', 'destroyed-error']) {
      const stream = new PassThrough();
      if (event === 'destroyed') stream.destroy();
      if (event === 'destroyed-error') stream.destroy(new Error('already destroyed'));
      const parsing = parse('', contentType, { raw: true }, stream);
      if (event === 'aborted') { stream.emit('aborted'); stream.destroy(new Error('cancelled')); }
      if (event === 'close') stream.destroy();
      let timer;
      try {
        const result = await Promise.race([parsing, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('parser hung after cancellation')), 500); })]);
        expectError(result, 'REQUEST_ABORTED');
        assert.equal(stream.listenerCount('data'), 0);
      } finally {
        clearTimeout(timer);
        stream.destroy();
      }
    }
  }
});

runner.test('Oversized bodies reject before the sender ends, without caching body bytes', async () => {
  const stream = new PassThrough();
  const parsing = parse('', 'application/octet-stream', { raw: true, rawLimit: 2 }, stream);
  stream.write(Buffer.from('too large'));
  let timer;
  try {
    const result = await Promise.race([parsing, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('size rejection waited for EOF')), 500); })]);
    expectError(result, 'LIMIT_FILE_SIZE', 413);
  } finally {
    clearTimeout(timer);
    stream.end();
  }
});

runner.test('Decoded streams and already consumed streams reject instead of crashing or hanging', async () => {
  const decoded = Readable.from(['decoded text']);
  expectError(await parse('', 'text/plain', { raw: true }, decoded), 'INVALID_BODY_STREAM');
  const consumed = Readable.from([Buffer.from('used')]);
  for await (const chunk of consumed) assert.equal(chunk.toString(), 'used');
  expectError(await parse('', 'text/plain', { raw: true }, consumed), 'BODY_ALREADY_CONSUMED');
});

runner.test('JSON errors do not reflect submitted payload text', async () => {
  for (const preserveRawBody of [false, true]) {
    const result = await parse('{"private-field":"unclosed', 'application/json', { preserveRawBody });
    expectError(result, 'INVALID_JSON');
    assert.equal(result.error.message, 'Invalid JSON');
  }
});

runner.test('Parsed null/empty JSON is cached without rereading the consumed stream', async () => {
  for (const data of ['', 'null']) {
    const { req, error } = await parse(data, 'application/json');
    assert.equal(error, undefined);
    assert.equal(Object.hasOwn(req, 'body'), true);
    assert.equal(req.body, null);
    assert.equal(req._bodyParsed, true);
    let calls = 0;
    await bodyParser.json()(req, {}, err => { assert.equal(err, undefined); calls++; });
    assert.equal(calls, 1);
  }
});

runner.test('Chunked bodies on DELETE requests are parsed and verified', async () => {
  const req = {
    method: 'DELETE',
    headers: { 'transfer-encoding': 'chunked', 'content-type': 'application/json' },
    nativeRequest: Readable.from([Buffer.from('{"delete":true}')])
  };
  let verified = false;
  await bodyParser({ verify() { verified = true; } })(req, {}, err => assert.equal(err, undefined));
  assert.equal(verified, true);
  assert.deepEqual(req.body, { delete: true });
});

runner.test('Byte limits apply to multibyte bodies in every preservation branch', async () => {
  for (const preserveRawBody of [false, true]) {
    for (const [contentType, data] of [
      ['application/json', '"éé"'],
      ['application/x-www-form-urlencoded', 'x=éé'],
      ['text/plain', 'ééé']
    ]) {
      expectError(await parse(data, contentType, { raw: true, preserveRawBody, limit: 5 }), 'LIMIT_FILE_SIZE', 413);
    }
  }
});

runner.test('Nested form paths cannot mutate array prototypes or inherited properties', async () => {
  for (const preserveRawBody of [false, true]) {
    for (const form of ['items[]=one&items[__proto__][p1Polluted]=yes', 'x[constructor][prototype][p1Polluted]=yes', '__proto__[p1Polluted]=yes', 'items[]=one&items[length]=99999999']) {
      try {
        expectError(await parse(form, 'application/x-www-form-urlencoded', { preserveRawBody }), 'INVALID_FORM_KEY');
        assert.equal(Array.prototype.p1Polluted, undefined);
        assert.equal(Object.prototype.p1Polluted, undefined);
      } finally {
        delete Array.prototype.p1Polluted;
        delete Object.prototype.p1Polluted;
      }
    }
  }
  expectError(await parse(multipart([{ name: '__proto__' }])), 'INVALID_FORM_KEY');
});

runner.test('Extended form nesting and sparse/repeated arrays obey configured limits', async () => {
  for (const preserveRawBody of [false, true]) {
    const options = { preserveRawBody, depthLimit: 2, arrayLimit: 2 };
    const contentType = 'application/x-www-form-urlencoded';
    assert.equal((await parse('x[y][z]=ok&items[1]=last', contentType, options)).error, undefined);
    expectError(await parse('x[y][z][deep]=bad', contentType, options), 'LIMIT_FORM_DEPTH', 413);
    expectError(await parse('items[4294967294]=bad', contentType, options), 'LIMIT_ARRAY_SIZE', 413);
    expectError(await parse('items[]=1&items[]=2&items[]=3', contentType, options), 'LIMIT_ARRAY_SIZE', 413);
    expectError(await parse('items=1&items=2&items=3', contentType, options), 'LIMIT_ARRAY_SIZE', 413);
    expectError(await parse('x[y]trailing=bad', contentType, options), 'INVALID_FORM_KEY');
  }
});

runner.test('Malformed escapes and invalid parser limit configuration reject safely', async () => {
  expectError(await parse('x=%ZZ', 'application/x-www-form-urlencoded'), 'PARSE_ERROR');
  for (const option of ['depthLimit', 'arrayLimit', 'maxFiles', 'maxFields', 'maxParts']) {
    for (const value of [-1, Infinity, 1.5, '2']) assert.throws(() => bodyParser({ [option]: value }), RangeError);
  }
  assert.throws(() => bodyParser({ verify: true }), TypeError);
  const largeLimit = await parse('a=1&b=2', 'application/x-www-form-urlencoded', { parameterLimit: 2 ** 32 });
  assert.equal(largeLimit.error, undefined);
  assert.equal(largeLimit.req.body.b, '2');
});

runner.test('Verification hook covers all body types with and without raw preservation', async () => {
  const cases = [
    ['application/json', Buffer.from('{"ok":true}')],
    ['application/x-www-form-urlencoded', Buffer.from('ok=true')],
    ['application/octet-stream', Buffer.from([255, 0, 128])],
    [type, multipart([{ filename: 'test.txt' }])]
  ];
  for (const preserveRawBody of [false, true]) {
    for (const [contentType, bytes] of cases) {
      let calls = 0;
      const result = await parse(bytes, contentType, { raw: true, preserveRawBody, verify(req, res, buffer) { calls++; assert.deepEqual(buffer, bytes); } });
      assert.equal(result.error, undefined);
      assert.equal(calls, 1);
      if (preserveRawBody) assert.deepEqual(result.req.rawBody, bytes);
      expectError(await parse(bytes, contentType, { raw: true, preserveRawBody, verify() { throw new Error('reject input'); } }), 'PARSE_ERROR');
    }
  }
});

runner.test('Rejected multipart verification must not create disk uploads', async () => {
  await temporaryDirectory(async uploadDir => {
    expectError(await parse(multipart([{ filename: 'test.txt' }]), type, {
      uploadDir, fileMemoryLimit: 0, verify() { throw new Error('reject input'); }
    }), 'PARSE_ERROR');
    assert.deepEqual(await fs.promises.readdir(uploadDir), []);
  });
});

runner.run().then(success => { process.exitCode = success ? 0 : 1; });
