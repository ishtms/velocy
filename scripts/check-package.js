const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const functionExports = [
  'Router', 'FastRouter', 'Request', 'Response', 'SimpleRouter',
  'WebSocketRouter', 'WebSocketConnection', 'WebSocketServer',
  'bodyParser', 'cors', 'cookieParser', 'static', 'compression',
  'rateLimit', 'session', 'validator', 'validate', 'createServer', 'buildQueryString'
];
const objectExports = ['WS_OPCODES', 'WS_CLOSE_CODES', 'WS_STATES', 'websocketUtils'];

function runtimeFiles(root, directory = 'lib') {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const relative = `${directory}/${entry.name}`;
    assert(!entry.isSymbolicLink(), `Runtime symlink is not allowed: ${relative}`);
    if (entry.isDirectory()) return runtimeFiles(root, relative);
    return entry.isFile() && entry.name.endsWith('.js') ? [relative] : [];
  }).sort();
}

function checkPackageFiles(files, requiredFiles) {
  assert(Array.isArray(files) && files.length > 0, 'Package manifest must not be empty');
  const names = files.map(file => file.path);
  assert.equal(new Set(names).size, names.length, 'Duplicate package paths');
  for (const name of names) {
    assert.equal(typeof name, 'string');
    const segments = name.split('/');
    assert(!name.includes('\\') && !path.posix.isAbsolute(name), 'Unsafe package path');
    assert(segments.every(part => part && !part.startsWith('.') && part !== 'node_modules'),
      `Local/hidden package material: ${name}`);
    assert(
      ['package.json', 'index.js', 'README.md', 'LICENSE', 'LICENSE.md', 'LICENSE.txt'].includes(name) ||
      (name.startsWith('lib/') && name.endsWith('.js')) ||
      (name.startsWith('docs/') && name.endsWith('.md')),
      `Unexpected package file: ${name}`
    );
  }
  for (const name of requiredFiles) assert(names.includes(name), `Missing package file: ${name}`);
  return names.sort();
}

function checkLockfile(manifest, lock) {
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.name, manifest.name);
  assert.equal(lock.version, manifest.version);
  assert.deepEqual(lock.packages[''].devDependencies, manifest.devDependencies);
  assert.deepEqual(manifest.engines, { node: '>=26 <27' });
  assert.deepEqual(lock.packages[''].engines, manifest.engines);
  // Introducing runtime dependencies changes the offline consumer verification contract.
  assert.deepEqual(manifest.dependencies || {}, {});
  assert.deepEqual(manifest.optionalDependencies || {}, {});
  assert.deepEqual(manifest.peerDependencies || {}, {});
  for (const [name, item] of Object.entries(lock.packages)) {
    if (!name) continue;
    assert.equal(item.dev, true, `Unexpected production dependency: ${name}`);
    assert.match(item.resolved, /^https:\/\//, `Dependency must retain verified TLS: ${name}`);
    assert.match(item.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/, `Missing integrity: ${name}`);
    assert.match(item.version, /^\d+\.\d+\.\d+/, `Dependency is not version-locked: ${name}`);
  }
}

function smokeExports(api) {
  assert.deepEqual(Object.keys(api).sort(), [...functionExports, ...objectExports].sort());
  for (const name of functionExports) assert.equal(typeof api[name], 'function', name);
  for (const name of objectExports) assert(api[name] && typeof api[name] === 'object', name);
  assert.equal(api.validate, api.validator);
  assert.equal(api.WS_OPCODES.TEXT, 1);
  assert.equal(api.WS_CLOSE_CODES.NORMAL, 1000);
  assert.equal(api.WS_STATES.OPEN, 1);
  assert.equal(api.buildQueryString({ greeting: 'hello world' }), 'greeting=hello%20world');
  const router = new api.Router();
  assert.equal(typeof router.handleRequest, 'function');
  const server = api.createServer(router);
  assert.equal(server.listening, false);
  return Object.keys(api).sort();
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function parsePackResult(output) {
  const parsed = JSON.parse(output);
  // npm 12 returns a name-keyed object; older npm releases return an array.
  assert(parsed && typeof parsed === 'object', 'Invalid npm pack JSON');
  const packs = Array.isArray(parsed) ? parsed : Object.values(parsed);
  assert.equal(packs.length, 1, 'Expected exactly one packed artifact');
  return packs[0];
}

function npmCliPath() {
  if (process.env.npm_execpath) return fs.realpathSync(process.env.npm_execpath);
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, process.platform === 'win32' ? 'npm.cmd' : 'npm');
    if (!fs.existsSync(candidate)) continue;
    const cli = fs.realpathSync(candidate);
    if (cli.endsWith('.js')) return cli;
    break;
  }
  throw new Error('Cannot locate npm JavaScript CLI; invoke through npm run check:package');
}

function runNpm(args, cwd) {
  // Resolve the owner's existing npm CLI, but bypass its shebang so an explicit
  // Node invocation also governs npm. Never alter PATH, registry or TLS settings.
  const cli = npmCliPath();
  try {
    return execFileSync(process.execPath, [cli, ...args], {
      cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    // npm diagnostics may contain registry credentials; do not forward raw output.
    throw new Error(`npm ${args[0]} failed (status ${error.status}, code ${error.code || 'none'}); raw diagnostics withheld`);
  }
}

// Serialized into a fresh Node process: only built-ins are loaded before the hook.
// This is a dependency-resolution check for trusted package code, not a JS sandbox.
function isolatedRuntimeSmoke() {
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');
  const Module = require('node:module');
  const { fileURLToPath } = require('node:url');
  const consumer = process.argv[1];
  const root = fs.realpathSync(path.join(consumer, 'node_modules', 'velocy'));
  const violations = [];

  function checkResolution(url) {
    if (Module.isBuiltin(url)) return;
    if (url.startsWith('file:')) {
      const relative = path.relative(root, fs.realpathSync(fileURLToPath(url)));
      if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) return;
    }
    violations.push('ERR_PACKAGE_ISOLATION');
    const error = new Error('Module resolution escaped the installed artifact');
    error.code = 'ERR_PACKAGE_ISOLATION';
    throw error;
  }

  function reportFailure(error) {
    // Artifact code/paths may contain sensitive data; emit only a fixed failure class.
    const code = error.code === 'ERR_PACKAGE_ISOLATION' ? error.code : 'ERR_PACKAGE_SMOKE';
    console.error(JSON.stringify({ error: code }));
    process.exitCode = 1;
  }

  process.on('uncaughtException', reportFailure);
  process.on('unhandledRejection', reportFailure);
  try {
    assert.deepEqual(Module.globalPaths, []);
    assert.equal(process.env.NODE_PATH, undefined);
    assert.equal(process.env.NODE_OPTIONS, undefined);
    // Synchronous hooks cover CommonJS (including createRequire) and ESM imports.
    // Clearing NODE_PATH alone does not remove ancestor node_modules resolution.
    Module.registerHooks({
      resolve(specifier, context, nextResolve) {
        const result = nextResolve(specifier, context);
        checkResolution(result.url);
        return result;
      },
      load(url, context, nextLoad) {
        checkResolution(url);
        return nextLoad(url, context);
      }
    });
    const requireConsumer = Module.createRequire(path.join(consumer, 'package.json'));
    const resolved = requireConsumer.resolve('velocy');
    assert.equal(fs.realpathSync(resolved), path.join(root, 'lib', 'index.js'));
    const modules = runtimeFiles(root);
    for (const file of modules) requireConsumer(`velocy/${file}`);
    const api = requireConsumer('velocy');
    assert.equal(api, requireConsumer('velocy/index.js'));
    const exports = smokeExports(api);
    // Wait for natural process quiescence so caught/asynchronous hook violations
    // cannot be hidden by printing an early success result.
    process.once('beforeExit', () => {
      if (process.exitCode) return;
      try {
        assert.deepEqual(violations, []);
        const loadedFiles = Object.keys(require.cache).map(file => {
          checkResolution(require('node:url').pathToFileURL(file).href);
          return path.relative(root, file).split(path.sep).join('/');
        }).sort();
        console.log(JSON.stringify({
          resolved, exports, runtimeModuleCount: modules.length, loadedFiles,
          smokeNode: process.version, smokeNodeExecutable: process.execPath,
          isolation: { freshProcess: true, globalSearchPaths: Module.globalPaths, guardedResolution: true }
        }));
      } catch (error) {
        reportFailure(violations.length ? { code: 'ERR_PACKAGE_ISOLATION' } : error);
      }
    });
  } catch (error) {
    reportFailure(error);
  }
}

function runInstalledSmoke(consumer) {
  const bootstrap = [
    "const assert = require('node:assert/strict');",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    `const functionExports = ${JSON.stringify(functionExports)};`,
    `const objectExports = ${JSON.stringify(objectExports)};`,
    runtimeFiles.toString(), smokeExports.toString(),
    `(${isolatedRuntimeSmoke.toString()})();`
  ].join('\n');
  // No inherited NODE_OPTIONS/preloads, NODE_PATH, HOME/global search settings,
  // native-loader injection variables, or parent execArgv/cache/loader hooks.
  // npm subprocesses retain the owner's registry/TLS environment separately.
  const env = process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {};
  let output;
  try {
    output = execFileSync(process.execPath, [
      '--no-global-search-paths', '--input-type=commonjs', '--eval', bootstrap, path.resolve(consumer)
    ], {
      cwd: consumer, env, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    const code = error.code === 'ETIMEDOUT' ? 'ERR_PACKAGE_SMOKE_TIMEOUT' :
      String(error.stderr).includes('"error":"ERR_PACKAGE_ISOLATION"') ?
        'ERR_PACKAGE_ISOLATION' : 'ERR_PACKAGE_SMOKE';
    const failure = new Error(`Installed runtime smoke failed (${code}); raw diagnostics withheld`);
    failure.code = code;
    throw failure;
  }
  try {
    return JSON.parse(output);
  } catch {
    throw new Error('Installed runtime smoke returned invalid JSON; raw output withheld');
  }
}

function inspectInstalled(consumer, pack) {
  const installedRoot = path.join(consumer, 'node_modules', 'velocy');
  const installedFiles = checkPackageFiles(pack.files, ['package.json', 'index.js', 'lib/index.js']);
  for (const file of installedFiles) {
    const target = path.join(installedRoot, file);
    assert(fs.lstatSync(target).isFile(), `Installed file missing or linked: ${file}`);
  }
  assert(!fs.existsSync(path.join(installedRoot, 'node_modules')), 'Bundled dependencies are forbidden');
  const installed = fs.readdirSync(path.join(consumer, 'node_modules')).filter(name => !name.startsWith('.'));
  assert.deepEqual(installed, ['velocy'], 'Consumer must install only the tarball, not dev dependencies');
  return runInstalledSmoke(consumer);
}

function checkPackage(outputDirectory) {
  const root = path.resolve(__dirname, '..');
  const manifest = require(path.join(root, 'package.json'));
  const lock = require(path.join(root, 'package-lock.json'));
  checkLockfile(manifest, lock);
  const directory = outputDirectory ? path.resolve(outputDirectory) :
    fs.mkdtempSync(path.join(os.tmpdir(), 'velocy-package-'));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  assert.deepEqual(fs.readdirSync(directory), [], 'Evidence directory must be empty');
  const pack = parsePackResult(runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', directory], root));
  assert.equal(pack.name, manifest.name);
  assert.equal(pack.version, manifest.version);
  assert.equal(pack.filename, `${manifest.name}-${manifest.version}.tgz`);
  assert.deepEqual(pack.bundled, []);
  const files = checkPackageFiles(pack.files, ['package.json', 'index.js', 'README.md', ...runtimeFiles(root)]);
  const tarball = path.join(directory, pack.filename);
  fs.writeFileSync(path.join(directory, 'pack.json'), JSON.stringify(pack, null, 2));
  const consumer = path.join(directory, 'consumer');
  fs.mkdirSync(consumer, { mode: 0o700 });
  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'velocy-package-smoke', version: '1.0.0', private: true }));
  runNpm(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev', tarball], consumer);
  const smoke = inspectInstalled(consumer, pack);
  // Check every installed artifact byte against the source used by npm pack.
  const hashes = {};
  for (const file of files) {
    hashes[file] = sha256(path.join(root, file));
    assert.equal(sha256(path.join(consumer, 'node_modules', 'velocy', file)), hashes[file], file);
  }
  const result = {
    node: process.version, npm: runNpm(['--version'], root).trim(),
    nodeExecutable: process.execPath, npmCli: npmCliPath(),
    npmNodeExecutable: process.execPath,
    platform: process.platform, arch: process.arch, fileCount: files.length,
    artifact: tarball, sha256: sha256(tarball), integrity: pack.integrity,
    hashes, ...smoke
  };
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}

module.exports = { checkPackageFiles, checkLockfile, smokeExports, runtimeFiles, parsePackResult, runInstalledSmoke, runNpm, checkPackage };

if (require.main === module) {
  try {
    assert(process.argv.length <= 3, 'Usage: node scripts/check-package.js [empty-evidence-directory]');
    console.log(JSON.stringify(checkPackage(process.argv[2]), null, 2));
  } catch (error) {
    console.error(`Package check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
