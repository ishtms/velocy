const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createRequire } = require('node:module');
const { checkPackageFiles, checkLockfile, smokeExports, runtimeFiles, parsePackResult, runInstalledSmoke, runNpm } = require('../scripts/check-package');
const manifest = require('../package.json');
const lock = require('../package-lock.json');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`PASS ${name}`);
}

const required = ['package.json', 'index.js', 'lib/index.js'];
const valid = required.map(file => ({ path: file }));

test('npm pack JSON supports both older array and npm 12 keyed output', () => {
  const pack = { name: 'velocy', version: '0.3.0', files: valid };
  assert.deepEqual(parsePackResult(JSON.stringify([pack])), pack);
  assert.deepEqual(parsePackResult(JSON.stringify({ velocy: pack })), pack);
  assert.throws(() => parsePackResult('[]'));
  assert.throws(() => parsePackResult('{}'));
  assert.throws(() => parsePackResult('null'));
  assert.throws(() => parsePackResult(JSON.stringify([pack, pack])));
});

test('package metadata declares CommonJS and Node 26-only support policy', () => {
  assert.equal(manifest.type, 'commonjs');
  assert.equal(manifest.main, 'lib/index.js');
  assert.deepEqual(manifest.engines, { node: '>=26 <27' });
  assert.deepEqual(lock.packages[''].engines, manifest.engines);
  assert.deepEqual(manifest.files, ['index.js', 'lib/**/*.js', 'docs/**/*.md']);
});

test('lockfile matches manifest and retains development-only integrity-pinned dependencies', () => {
  checkLockfile(manifest, lock);
  assert.equal(lock.packages['node_modules/velocy'].version, '0.0.14');
  assert.equal(lock.packages['node_modules/ws'].version, '8.22.0');
});

test('lockfile rejects missing integrity or insecure resolution', () => {
  for (const property of ['resolved', 'integrity']) {
    const modified = JSON.parse(JSON.stringify(lock));
    modified.packages['node_modules/ws'][property] = 'invalid';
    assert.throws(() => checkLockfile(manifest, modified));
  }
});

test('complete package manifest accepted', () => {
  assert.deepEqual(checkPackageFiles(valid, required), [...required].sort());
});

test('missing and duplicate files rejected', () => {
  assert.throws(() => checkPackageFiles(valid.slice(1), required), /Missing/);
  assert.throws(() => checkPackageFiles([...valid, valid[0]], required), /Duplicate/);
});

test('publication boundary rejects local files, secrets and traversal', () => {
  for (const name of [
    '.env', '.npmrc', '.DS_Store', 'AGENTS.md', 'package-lock.json', 'tests/test-package.js',
    'scripts/check-package.js', 'benchmarks/baseline.js', 'node_modules/ws/index.js',
    'lib/.env.js', 'lib/../outside.js', 'lib//outside.js', 'lib/node_modules/extra.js',
    'lib/key.pem', '/lib/escape.js', 'lib\\escape.js'
  ]) {
    assert.throws(() => checkPackageFiles([...valid, { path: name }], required), undefined, name);
  }
});

test('source public exports and all runtime modules load on the current runtime', () => {
  const root = path.resolve(__dirname, '..');
  const modules = runtimeFiles(root);
  assert(modules.length > 0);
  for (const file of modules) require(path.join(root, file));
  assert.equal(smokeExports(require('..')).length, 23);
});

test('export smoke rejects a missing public function', () => {
  const incomplete = { ...require('..') };
  delete incomplete.createServer;
  assert.throws(() => smokeExports(incomplete));
});

function withConsumerFixture(fn) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'velocy-package-isolation-')));
  const consumer = path.join(directory, 'nested', 'consumer');
  const artifact = path.join(consumer, 'node_modules', 'velocy');
  fs.mkdirSync(artifact, { recursive: true });
  fs.cpSync(path.join(__dirname, '..', 'lib'), path.join(artifact, 'lib'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'index.js'), path.join(artifact, 'index.js'));
  fs.copyFileSync(path.join(__dirname, '..', 'package.json'), path.join(artifact, 'package.json'));
  fs.writeFileSync(path.join(consumer, 'package.json'), '{"private":true}');
  try {
    fn({ directory, consumer, artifact });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('fresh consumer loads real runtime with ambient startup/search paths cleared', () => {
  withConsumerFixture(({ directory, consumer }) => {
    const marker = path.join(directory, 'preload-executed');
    const preload = path.join(directory, 'preload.js');
    fs.writeFileSync(preload, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`);
    const saved = { NODE_PATH: process.env.NODE_PATH, NODE_OPTIONS: process.env.NODE_OPTIONS, HOME: process.env.HOME };
    try {
      process.env.NODE_OPTIONS = `--require=${preload}`;
      process.env.NODE_PATH = path.join(directory, 'ambient-modules');
      process.env.HOME = directory;
      const result = runInstalledSmoke(consumer);
      assert.equal(result.exports.length, 23);
      assert.equal(result.smokeNode, process.version);
      assert.equal(result.smokeNodeExecutable, process.execPath);
      assert.equal(result.runtimeModuleCount, runtimeFiles(path.join(__dirname, '..')).length);
      assert.deepEqual(result.isolation, { freshProcess: true, globalSearchPaths: [], guardedResolution: true });
      assert(!fs.existsSync(marker), 'Inherited NODE_OPTIONS preload executed');
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

test('npm CLI uses invoking Node rather than an ambient PATH node executable', () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'velocy-npm-runtime-')));
  const saved = { npm_execpath: process.env.npm_execpath, PATH: process.env.PATH };
  try {
    const cli = path.join(directory, 'npm-cli.js');
    fs.writeFileSync(cli, '#!/usr/bin/env node\nconsole.log(JSON.stringify({node:process.version,executable:process.execPath}));');
    fs.symlinkSync(cli, path.join(directory, process.platform === 'win32' ? 'npm.cmd' : 'npm'));
    fs.writeFileSync(path.join(directory, 'node'), 'Not a Node executable');
    delete process.env.npm_execpath;
    process.env.PATH = directory;
    assert.deepEqual(JSON.parse(runNpm(['--version'], directory)), {
      node: process.version, executable: process.execPath
    });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('undeclared dependency found only in ancestor node_modules fails before execution', () => {
  withConsumerFixture(({ directory, consumer, artifact }) => {
    const dependency = path.join(directory, 'node_modules', 'velocy-undeclared-fixture');
    const marker = path.join(directory, 'dependency-executed');
    fs.mkdirSync(dependency, { recursive: true });
    fs.writeFileSync(path.join(dependency, 'index.js'),
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed'); module.exports = true;`);
    const probe = path.join(artifact, 'lib', 'ambient-probe.js');
    fs.writeFileSync(probe, "require('velocy-undeclared-fixture');");
    // Prove ordinary lookup would succeed; no NODE_PATH/global installation required.
    assert.equal(createRequire(probe).resolve('velocy-undeclared-fixture'), path.join(dependency, 'index.js'));
    assert.throws(() => runInstalledSmoke(consumer), { code: 'ERR_PACKAGE_ISOLATION' });
    assert(!fs.existsSync(marker), 'Ancestor dependency executed before rejection');
  });
});

test('absolute, symlink and require.resolve escapes are rejected even when caught', () => {
  withConsumerFixture(({ directory, consumer, artifact }) => {
    const outside = path.join(directory, 'outside.js');
    const marker = path.join(directory, 'outside-executed');
    fs.writeFileSync(outside, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`);
    const link = path.join(artifact, 'external-link.js');
    fs.symlinkSync(outside, link);
    const probe = path.join(artifact, 'lib', 'ambient-probe.js');
    for (const operation of ['require', 'require.resolve']) {
      for (const specifier of [outside, '../external-link.js']) {
        fs.writeFileSync(probe, `try { ${operation}(${JSON.stringify(specifier)}); } catch (error) {}`);
        assert.throws(() => runInstalledSmoke(consumer), { code: 'ERR_PACKAGE_ISOLATION' });
      }
    }
    fs.unlinkSync(link);
    fs.writeFileSync(probe, `require(${JSON.stringify(outside)});`);
    assert.throws(() => runInstalledSmoke(consumer), { code: 'ERR_PACKAGE_ISOLATION' });
    assert(!fs.existsSync(marker));
  });
});

test('caught dynamic imports outside artifact or through data URLs still fail', () => {
  withConsumerFixture(({ directory, consumer, artifact }) => {
    const outside = path.join(directory, 'outside.mjs');
    const marker = path.join(directory, 'import-executed');
    fs.writeFileSync(outside,
      `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'executed');`);
    const { pathToFileURL } = require('node:url');
    for (const url of [
      pathToFileURL(outside).href,
      `data:text/javascript,${encodeURIComponent(fs.readFileSync(outside, 'utf8'))}`
    ]) {
      fs.writeFileSync(path.join(artifact, 'lib', 'ambient-probe.js'),
        `import(${JSON.stringify(url)}).catch(() => {});`);
      assert.throws(() => runInstalledSmoke(consumer), { code: 'ERR_PACKAGE_ISOLATION' });
    }
    assert(!fs.existsSync(marker));
  });
});

console.log(`Package tests: ${passed} passed, 0 failed; Node ${process.version}`);
