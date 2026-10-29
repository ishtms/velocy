# Runtime and packaging verification

## Supported runtime policy and tested patches

Velocy is CommonJS (`main: lib/index.js`, `type: commonjs`); `index.js` remains
a compatibility re-export. The supported runtime target is **Node 26.x only**,
declared as `engines.node: ">=26 <27"` in the manifest and root lock metadata.
This is a major-version support policy, not a claim that every Node 26 patch
has been tested. Exact executed patches are recorded separately below.

| Evidence | Finding | Limitation |
| --- | --- | --- |
| Support policy | Node 26.x (`>=26 <27`) | Other Node major versions are outside the supported target |
| Syntax inspection | Private methods/accessors (`#method`) require the V8 8.4 generation shipped in Node 14.6.0; optional chaining/nullish coalescing are also used | Inferred syntax floor, not an old-runtime test |
| Built-in module loading | CommonJS `require('node:...')` arrived in Node 16.0.0 / 14.18.0; `node:stream/promises` requires the streams promises API introduced in Node 15.0.0 | Node 14's prefix backport alone cannot load the library |
| Other built-ins | `crypto.randomUUID()` was introduced in Node 15.6.0 / 14.17.0 | API history, not behavioral compatibility evidence |
| Combined source/API floor | Node 16.0.0 is the earliest candidate release line satisfying these observed requirements | Necessary lower bound only; not a claim that all features work on Node 16 |
| Executed packaging environments | Node **v26.5.0** and **v26.12.1**, npm **12.2.1**, macOS (`darwin`) arm64 | Focused package tests, source syntax and actual offline consumer checks on these two patches; not every patch/platform or the full behavioral suite |

No runtime was downloaded, installed, or selected through persistent configuration.
Other Node patches, operating systems, optional template engines, and native
WebSocket accelerators remain untested by these package checks. Keep Node 26
security updates current and verify application behavior on the selected patch.
Historical source/API availability below Node 26 is not a support commitment or
a recommendation to deploy an obsolete release.

Sources (official API/release history, consulted 2026-10-29):

- [V8 8.4 private methods/accessors](https://v8.dev/blog/v8-release-84#private-methods-and-accessors)
  and [Node 14.6.0 V8 update](https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V14.md#14.6.0).
- [CommonJS built-in modules history](https://nodejs.org/api/modules.html#built-in-modules).
- [Streams promises API history](https://nodejs.org/api/stream.html#streams-promises-api).
- [crypto.randomUUID history](https://nodejs.org/api/crypto.html#cryptorandomuuidoptions).

## Reproducible development install

The root `package-lock.json` is a version-3 lockfile and must be committed with
`package.json`; `.gitignore` no longer excludes either itself or the lockfile.
The initial lock preserves all nine records, resolved URLs, and SHA-512 integrity
values from the existing installation's npm hidden lock. No package was added
or upgraded. Routine verification uses:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node tests/test-package.js
```

| Package path under node_modules | Locked version | Purpose |
| --- | --- | --- |
| `velocy` | 0.0.14 | Legacy comparison benchmark only |
| `velocy/node_modules/velocy` | 0.0.13 | Legacy benchmark transitive dependency |
| `restana` | 4.9.9 | Legacy benchmark transitive dependency |
| `0http` | 3.5.3 | Legacy benchmark transitive dependency |
| `lru-cache` | 10.4.3 | Legacy benchmark transitive dependency |
| `regexparam` | 3.0.0 | Legacy benchmark transitive dependency |
| `trouter` | 3.2.1 | Legacy benchmark transitive dependency |
| `trouter/node_modules/regexparam` | 1.3.0 | Legacy benchmark transitive dependency |
| `ws` | 8.22.0 | WebSocket test client |

The self-named development dependency is **used**, not a runtime dependency:
`benchmarks/old_vs_new.js` explicitly requires registry Velocy to compare it
with `../index`. Removing it would break the existing `npm run compare` workflow.
It remains development-only. Do not add package self-reference `exports` without
revisiting that benchmark's resolution behavior.

`restana` declares an install lifecycle script. The verification above suppresses
all dependency lifecycle scripts deliberately; it does not validate those scripts
or the optional historical comparison benchmark. The lock makes resolution
repeatable; it is not a vulnerability, license, or provenance approval.
Keep the configured registry, TLS verification, and integrity checks unchanged;
authentication/TLS failures are blockers, not reasons to change registries.

## Artifact boundary and installed-consumer check

The publication allowlist includes `index.js`, `lib/**/*.js`, and `docs/**/*.md`.
npm additionally includes package metadata and the root README (and license file
if one is added). Tests, benchmark/demo apps, UI/static assets, agent instructions,
OS metadata, credentials, lockfiles, and node_modules are not publication inputs.
`.npmignore` adds explicit local-material exclusions; the allowlist and package
check are the primary boundary, not reliance on ignore-file precedence.

```sh
npm pack --ignore-scripts --dry-run --json
npm run check:package
# Optional: retain evidence in a specified, initially empty directory.
node scripts/check-package.js /path/to/empty-evidence-directory
```

The checker:

1. Validates lock/manifest consistency and development-only locked dependencies.
2. Packs with lifecycle scripts disabled; accepts npm's older array and npm 12's
   name-keyed JSON result formats.
3. Rejects unexpected, duplicate, hidden, traversal, or missing runtime file paths.
4. Installs the actual local tarball into a separate consumer using
   `--offline --ignore-scripts --no-audit --no-fund --omit=dev`.
5. Runs runtime loading in a **fresh Node process**, with an empty ambient
   environment (only `SystemRoot` on Windows), no inherited startup flags/cache/
   hooks, and `--no-global-search-paths`. Thus `NODE_OPTIONS` preloads, `NODE_PATH`,
   HOME/global module directories and native-loader environment injection are
   not inherited. npm's separate registry/TLS environment remains unchanged.
6. Installs synchronous resolve/load hooks **before loading package code**.
   Built-ins are allowed; every other resolution/load must be a file whose
   canonical realpath is inside the installed artifact. Ancestor node_modules,
   absolute-path escapes, symlink escapes and non-file URL imports are rejected.
   Hooks cover CommonJS, `createRequire`, `require.resolve` and ESM imports;
   caught/asynchronous boundary violations still fail at process quiescence.
   The loaded CommonJS cache is checked again before reporting success.
7. Checks `require('velocy')` resolves to that consumer's `lib/index.js`, verifies
   all **23 public exports**, loads every runtime JS module (**23 in the initial
   packaging snapshot**), checks the root re-export identity, and exercises query
   encoding/router/server construction without listening on a port. The consumer
   contains only Velocy; even if evidence is inside a checkout, ancestor
   dependencies cannot silently satisfy the smoke check.
8. Compares every installed file's SHA-256 against the packed source and writes
   `pack.json`, `result.json`, the tarball, and the consumer installation to the
   evidence directory. Evidence is retained, not automatically deleted. The result
   includes the exact artifact SHA-256/integrity, file list/hashes, exports, and
   observed Node/npm/platform versions. A new directory is required for a rerun.

Both npm and the isolated runtime smoke execute using the checker's invoking
`process.execPath`. For a direct Node invocation the checker locates the existing
npm JavaScript CLI from PATH and bypasses its shebang; when launched through npm
it uses that npm CLI. An ambient `node` executable cannot silently substitute a
different runtime. No PATH/default runtime configuration is changed. Results
record the invoking/npm/runtime-smoke executable paths and smoke's actual version.

Each npm subprocess has a 60-second timeout and a 4-MiB output cap; the fresh
runtime smoke has a 10-second timeout and a 1-MiB cap. Failures fail the check;
raw subprocess diagnostics are withheld to avoid leaking credentials. This
development checker uses `module.registerHooks` (introduced in Node 22.15.0 /
23.5.0), available on the supported Node 26 target and verified on both tested
patches. The historical library API floor does not broaden this policy. See the
[official synchronous hooks API](https://nodejs.org/api/module.html#moduleregisterhooksoptions).
This check detects dependency-resolution mistakes in trusted package code, not
hostile JavaScript that deliberately tampers with the verifier or its hooks.
The checker does not publish, execute dependency scripts, download a runtime,
or contact a scanner. Successful package installation/export smoke is narrower
than HTTP/WebSocket behavioral testing. `tests/test-package.js` has fourteen focused
offline checks. Run the complete integrated behavioral suite separately and
refresh artifact evidence after any packaged source/document changes.

## Security and remaining coverage

This work addresses supply-chain/integrity and misconfiguration risks through
locked versions, script-disabled installation, publication allowlisting, path
validation, isolated consumers, and byte-for-byte artifact checks. Process calls
use argument arrays, bounded output/time, and no shell interpolation. No request
authorization, authentication, database, browser rendering, or cryptographic
protocol behavior is changed by these packaging edits.

Local tests, manual review, and a redacted directory secret scan do not establish
full semantic analyzer or dependency-vulnerability coverage. Preservation of
legacy benchmark dependencies is not a clean security claim; maintainers may
separately decide to retire or isolate that benchmark after dependency review.
