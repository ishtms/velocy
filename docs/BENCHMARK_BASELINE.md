# Bounded HTTP/routing baseline

`benchmarks/baseline.js` measures the **current checkout's** exported `Router`
and `createServer`, not the older installed `velocy` development dependency.
It uses only Node built-ins; no installation, package script changes, telemetry,
external target, or existing stress client is involved.

## Reproduce

From the repository root, save machine-readable output and diagnostics separately:

```sh
node benchmarks/baseline.js --duration-ms 2000 --concurrency 5 --samples 3 > baseline.json 2> baseline.stderr.log
```

The worker run additionally had a 55-second Python process-group timeout. The
harness itself supplies a 45-second supervisor deadline, including metadata
collection, and an independent 10-second supervisor watchdog for each sample.
No external timeout program is required for normal use. Exit status is zero
only when all issued requests validate and each sample completes successfully.
Timeouts, transport/status/body failures, and hard sample deadlines fail the run;
forced termination produces no valid baseline JSON and must not be counted as
a successful observation.

For a changed checkout, rerun into a different output file:

```sh
node --check benchmarks/baseline.js
node benchmarks/baseline.js --duration-ms 2000 --concurrency 5 --samples 3 > baseline-rerun.json 2> baseline-rerun.stderr.log
```

Record the revision, uncommitted changes and dependency versions alongside that JSON.
`ownerSuppliedSnapshotLabel` is only a caller-supplied label, not a verified hash.
Every run independently fingerprints `index.js`, `package.json`, an existing
`package-lock.json`, and all `lib/**/*.js` files. It emits the sorted path/hash map,
its SHA256 digest, the harness SHA256, observed Git HEAD, runtime versions, host
metadata, request counts, errors, timings, latency histogram and memory readings.
The source digest does not cover dependencies, other files, or the whole dirty
tree; record those separately when comparing runs.

## Workload and limits

Four fixed GET requests are selected round-robin: `/plain`, `/users/42`,
`/search?q=velocy`, and `/files/example.txt`. These exercise static, parameter,
query and wildcard dispatch with the default Router options. Every response must
be HTTP 200 with the exact expected synthetic body; JSON handlers read the actual
request parameters/query. No application middleware is installed.

| Resource | Bound |
|---|---|
| Server/client destination | Only `127.0.0.1`; OS-assigned ephemeral port; no target/port option |
| Connections | `--concurrency` integer 1–10, default 5; agent per-host/total socket limits; server maximum 10 |
| Samples | `--samples` integer 1–3, default 3; sequential on the same server |
| Load window | `--duration-ms` integer 100–9000, default 2000 |
| Request/sample deadline | 1000 ms per request, including response; load window plus at most 1000 ms to drain; maximum 10 s/sample |
| Independent wall-clock protection | Supervisor kills worker at 10 s/sample or 45 s overall, including a blocked worker event loop |
| Request count | Maximum 100,000 issued per sample; no retry loop |
| Payload/response | Zero request payload; fixed small responses; client rejects responses over 1 MiB |
| Response headers | Maximum 8192 bytes |
| Latency storage | At most 100,000 successful timings/sample; at most 3 sample summaries retained |
| Metadata subprocesses | Local `npm --version` and `git rev-parse HEAD`, each ≤3 s and 1024 output bytes, before server worker startup |

Unknown options, duplicate options, malformed values and values beyond these
bounds are rejected before a server starts. The supervisor's internal worker
mode requires an IPC channel; it is not a standalone entry point.

The supervisor starts one server/client worker. That worker does not launch child
processes. A custom HTTP agent does not consume proxy environment configuration.
On normal/error completion the worker destroys outstanding requests and its
agent, stops accepting connections, closes all server connections, and waits for
the server close callback. On signal/watchdog termination the supervisor kills
that worker; the OS closes its sockets. No long-lived stress server remains.

Throughput is successful responses divided by elapsed sample wall time, including
final in-flight request completion but excluding summary sorting. Latency is
client request creation through complete body validation, measured with the
monotonic clock; percentiles use nearest rank over **successful requests only**.
Histogram buckets are disjoint, with inclusive upper bounds; the final `null`
upper bound means greater than 1000 ms. Error counters remain separate.

There is **no separate warm-up**: sample 1 includes cold client connections/JIT,
and later samples reuse the process/server/keep-alive agent. No forced GC occurs.
Memory `before`, `after` and 100 ms observed peaks are byte-valued
`process.memoryUsage()` readings for **server, client and measurement buffers
together**, not isolated server memory or a guaranteed instantaneous maximum.

## Recorded worker baseline — provisional

- UTC: `2026-10-29T02:05:48.922Z` to `2026-10-29T02:05:54.988Z`.
- Git HEAD: `da474af4310fe7e3253f9d935a4a038e1c35e253` with uncommitted changes;
  use the measured source fingerprint below rather than HEAD alone.
- Measured source fingerprint: `7bebfe904ce4167d744046d5272eadd06fa6b295d043fdc5c66b63619f774495`.
- Harness SHA256: `81aa242815106a9de575ba694853939a6ef79244767c8adb6edcc52fe3145460`.
- Node `v26.12.1`; npm `12.2.1`; Darwin `25.6.0`, `arm64`.
- Apple M4 Max; 14 logical CPUs; 38,654,705,664 bytes physical memory (36 GiB).
- Initial load averages (1/5/15 min): `6.2603 / 9.7881 / 8.0840`.
- Five peak simultaneous server connections, three 2000 ms load windows;
  every sample stopped at its load duration, not its request cap/deadline.

| Sample | Issued = validated | Errors | Elapsed ms | Responses/s | Latency p50 ms | p95 ms | p99 ms | Maximum ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 42,254 | 0 | 2000.316 | 21,123.66 | 0.209250 | 0.318959 | 0.603541 | 8.917166 |
| 2 | 47,809 | 0 | 2000.245 | 23,901.58 | 0.192458 | 0.256916 | 0.380166 | 2.578208 |
| 3 | 48,675 | 0 | 2000.203 | 24,335.03 | 0.190625 | 0.244709 | 0.353708 | 2.442583 |

| Sample | RSS before bytes | RSS after bytes | Observed peak RSS bytes | Observed peak heap-used bytes |
|---|---:|---:|---:|---:|
| 1 | 64,815,104 | 173,146,112 | 173,391,872 | 50,666,360 |
| 2 | 173,703,168 | 180,551,680 | 180,830,208 | 53,115,168 |
| 3 | 181,174,272 | 180,879,360 | 181,174,272 | 55,231,696 |

Total: **138,738 issued, 138,738 validated, 0 errors**. Median sample throughput:
**23,901.58 responses/s**. Process exit status 0; empty stderr;
`cleanup.serverClosed=true`, `cleanup.outstandingRequests=0`.

These measurements describe an **isolated working checkout, not any subsequently
combined or modified checkout**. Concurrent activity and other machine load could
compete for CPU. Contention was not isolated or attributed. Repeat on a quiet
machine after changing the checkout. This is a
closed-loop microbenchmark with client/server sharing one event loop, very small
responses and only four fixed routes—not production capacity, a comparison with
other frameworks, an SLO, or a pass/fail performance threshold. It does not
measure TLS, cross-host networking, uploads, sessions, static files, WebSocket,
database work, backpressure, or middleware-heavy applications. No supported Node
version matrix is established by this single-runtime observation.

## Saving and comparing results

The reproduction command writes the full report to `baseline.json` and errors to
`baseline.stderr.log` in the current directory. Retain both files and the exact
invocation/exit status. Use different output names for later runs, preserving
earlier results with their matching `source.harnessSha256`. Never replace an old
report's harness hash with the hash of a newer script. Retain the source file
hash map and runtime/host metadata when moving reports to another machine.

Compare only successful runs with comparable source/dependency versions,
workload, runtime, hardware, background load and warm-up behavior. A report from
an older harness remains historical evidence, not a measurement of the new one.

## Validation and diagnostics

Worker failures emit one bounded JSON diagnostic with a fixed stage ID, an
allowlisted OS/Node error code (or `UNKNOWN`) and `baselineValid=false`. Stage IDs
are `fingerprint`, `framework_setup`, `listen`, `sample`, `cleanup`, `report` and
`output`; unknown stage IDs are replaced with `unknown`. Exception messages,
stacks, causes and arbitrary error-code values are not printed, because they can
contain private paths or source-derived data.

Normal completion and server/request cleanup were observed in the recorded run.
Signal, watchdog and exceptional cleanup paths were **inspected only**, not
demonstrated by fault injection. A successful normal run does not verify those
failure paths. Seven malformed/out-of-range or unsupported invocations were
rejected before starting a server; that check is separate from fault injection.
