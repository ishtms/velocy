# Repository guide

- CommonJS Node.js HTTP framework; package entrypoint is `lib/index.js` (root `index.js` re-exports it). Public exports must be wired through `lib/index.js`.
- Core routers, request/response and WebSocket implementations are in `lib/core/`; middleware is in `lib/middleware/`; server creation and other helpers are in `lib/utils/`.
- `npm test` runs `tests/run-tests.js`: it launches sorted, top-level `tests/test-*.js` files in separate processes sequentially to avoid port conflicts. It does not discover `tests/debug/` or `tests/comprehensive-test.js`.
- Run one test with `node tests/test-routing.js` or `npm run test:single -- tests/test-routing.js`. `VERBOSE=1` enables stack traces in the shared `TestRunner`. Tests use local HTTP servers; `tests/test-helper.js` provides server and temporary-directory helpers.
- `docs/TESTING_GUIDE.md` describes testing applications using Velocy, not this repository's test runner. The manifest defines no build, lint, or typecheck scripts.
- `npm run demo` starts `example_server.js`. `npm run benchmark` starts the stress-test server; `npm run bench:stress` is its separate client targeting localhost:3001.
