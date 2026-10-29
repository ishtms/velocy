# Request input safety

These rules cover `Request.query`, standalone `await Request.body` URL-encoded
parsing, and `Request.getRawBody()`. The optional `bodyParser` middleware has its
own parsing options; `Request.queryParams` remains the separate `URLSearchParams`
interface. Applications must still validate the meaning and allowed fields of
untrusted input before using it.

## Query and standalone URL-encoded parameters

Normal repeated keys, bracket arrays, numeric array indices, nested objects,
type coercion, plus-as-space decoding and malformed-escape fallback remain
supported. Parameter objects have null prototypes. Traversal only follows own
properties, including when a path passes through an array. New array fields are
defined directly so inherited setters are not invoked.

The parser rejects decoded `__proto__`, `prototype`, and `constructor` path
segments at every level, including plain keys and malformed bracket paths.
Array `length` cannot be assigned or traversed as a parameter. These are deliberate
compatibility restrictions, not silently omitted fields.

| Fixed ceiling | Value | Failure |
| --- | --- | --- |
| Encoded parameter input, measured as UTF-8 bytes | 1 MiB | 413 `PARAMETER_SIZE_LIMIT` |
| Ampersand-separated parameter slots (including empty slots) | 1,000 | 413 `PARAMETER_COUNT_LIMIT` |
| Bracket nesting | 20 levels after the base key | 400 `PARAMETER_DEPTH_LIMIT` |
| Numeric bracket index (including zero-padded notation) | 10,000 | 400 `PARAMETER_INDEX_LIMIT` |
| Forbidden prototype/array path | Rejected at any level | 400 `INVALID_PARAMETER_PATH` |

Limits apply before allocating arbitrarily large parameter lists or sparse
arrays. They cannot be disabled by supplying an infinite/unlimited option.
The native HTTP server may reject an oversized URL earlier, using its own
header/URL limits. Errors thrown by `req.query` in route handlers flow through
Router error handling, just like rejected `await req.body` calls.

## Standalone body lifecycle

`getRawBody()` caches one promise per request, including failures. Concurrent
raw and parsed reads therefore share the same byte collection and rejection.
`req.body` also caches its parsing promise, including empty bodies, JSON `null`
and parsing failures. Existing behavior is retained: empty or invalid JSON bodies
produce `null` rather than a new JSON validation error.

Set these request properties **before the first read**, normally in middleware:

| Property | Default | Valid setting |
| --- | --- | --- |
| `bodyLimit` | 10 MiB | Non-negative safe integer byte count, no larger than Node's Buffer limit |
| `bodyTimeout` | 30,000 ms | Integer from 1 through 2,147,483,647 ms |

Invalid settings reject with `TypeError`; `NaN`, infinity, strings and fractional
values cannot bypass the bounds. Zero `bodyLimit` allows only an empty body.
The timeout is a **total collection deadline**, not an idle timeout reset by
incoming chunks. Its timer is cleared on every terminal path.

| Condition | Result |
| --- | --- |
| Byte limit exceeded | 413 `BODY_SIZE_LIMIT` |
| Collection deadline exceeded | 408 `BODY_TIMEOUT` |
| Aborted request | 400 `BODY_ABORTED` |
| Premature close / already destroyed stream | 400 `BODY_STREAM_CLOSED` |
| Previously or partially consumed non-empty stream | 400 `BODY_ALREADY_CONSUMED` |
| Native stream error | Original error rejects every waiter |

Only listeners installed by this reader are removed. Application and middleware
listeners are never removed wholesale. A failed reader releases its buffered
chunks, does not restart, and does not destroy the shared native stream; the
application/server retains responsibility for transport closure and request
timeouts. Configure server connection/header/request limits as well. Do not
consume or change the encoding of the native stream before requesting raw bytes.

## Interaction with `bodyParser`

- Middleware still owns its direct `req.body` value when it overrides the getter.
- With `preserveRawBody: true`, an explicit own `req.rawBody` Buffer is reused by
  `getRawBody()` (and checked against `bodyLimit`). This also supports a consumed
  stream after middleware has finished.
- Without preserved bytes, an already consumed non-empty stream rejects promptly
  instead of hanging or returning a truncated body. An ended empty stream can
  safely return an empty Buffer.
- The first standalone read fixes the cached outcome. Assigning preserved bytes
  or changing limits after that read does not retry a failure. Choose one parsing
  owner; do not race middleware consumption with a standalone reader.

## Local regressions

Run `node tests/test-request.js` and
`node tests/test-request-input-security.js`. Security tests use isolated child
processes with prototype restoration, referenced deadlines, local streams and
loopback HTTP servers. They check parser limits, inherited-accessor isolation,
concurrent reads, error/abort/close/timeout cleanup, consumed streams and middleware
handoffs. They do not certify application authorization or every parser API.
