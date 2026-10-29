# Rate-limit client identity and proxy trust

## Secure default

The built-in rate-limit key generator uses the connection's socket address.
It does **not** use `req.ip`, `X-Real-IP`, `X-Client-IP`, or `Forwarded`.
`X-Forwarded-For` (XFF) is ignored unless the limiter explicitly enables proxy
trust. Rotating client-supplied forwarding headers therefore cannot create new
buckets on a directly reachable server.

Behind a reverse proxy, the default aggregates clients into the proxy's bucket.
Configure trust explicitly if per-client limits are needed. IP limits are not
authentication: NATs share addresses, clients can change networks, and IPv6
addresses are not grouped into subnets by this limiter.

## Explicit proxy configuration

```js
const { rateLimit } = require('velocy');

const limiter = rateLimit({
  windowMs: 60000,
  max: 100,
  // Example addresses only: replace with your controlled proxy addresses.
  trustProxy: (address, hop) => hop === 0 && address === '192.0.2.10',
  proxies: 1
});
```

| Option | Accepted values | Meaning |
| --- | --- | --- |
| `trustProxy` | `false` (default) | Socket identity only. |
| `trustProxy` | `(address, hop) => boolean` or `Promise<boolean>` | Check each proxy before accepting the next address to its left. The socket is hop `0`; addresses are canonicalized first. |
| `trustProxy` | `true` | Trust every peer traversed, up to `proxies`. Only safe when network controls prevent direct/untrusted access and all ingress paths enforce the expected header chain. |
| `proxies` | Integer `1`–`64`, default `1` | Maximum number of proxy hops to traverse, including the socket peer. |

The proxy must overwrite XFF with the actual client address, or append the actual
upstream socket address to an existing chain. Never deploy a proxy that forwards
an arbitrary incoming XFF unchanged. Restrict application ingress to controlled
proxies. A predicate checking specific proxy addresses is safer than `true`.
Predicates may be asynchronous; they must resolve to a boolean. Thrown errors,
rejections and non-boolean results reject middleware execution, not allow it.
The application must provide normal error handling. Async predicates should be
local/fast or enforce their own timeouts; the limiter does not impose a deadline.

### Hop selection

For socket `192.0.2.10` and XFF
`203.0.113.99, 198.51.100.1, 192.0.2.20`:

| Policy | Selected key |
| --- | --- |
| Default / `trustProxy: false` | `192.0.2.10` |
| `trustProxy: true, proxies: 1` | `192.0.2.20` |
| `trustProxy: true, proxies: 2` | `198.51.100.1` |
| Predicate trusts only `192.0.2.10`, `proxies: 3` | `192.0.2.20` (first untrusted hop) |
| `trustProxy: true, proxies: 4` | Reject (chain too short) |

Traversal proceeds right to left, never beyond an untrusted address or the hop
limit. Choose hop counts for **every** ingress path: trusting more hops than a
shorter path really has can accept attacker-controlled prefixes. An incomplete
trusted chain rejects the request rather than falling back to the socket or
clamping to its leftmost entry.

## Literal validation and rejection

- Trust is checked before parsing: an untrusted socket peer retains its socket
  identity even when forwarding headers are malformed. A trusted socket peer
  must supply XFF; absent/non-string/empty headers reject rather than grant a
  proxy-identity exemption.
- Only selected/traversed addresses must be literal IPs. Surrounding whitespace
  is trimmed; empty selected entries, hostnames, quoted addresses, IPv4 ports,
  IPv6 brackets, zone identifiers and leading-zero/abbreviated IPv4 are invalid.
  No DNS resolution occurs. Prefixes beyond the selected trust boundary are
  ignored: `garbage, 198.51.100.1` through one trusted appending proxy selects
  `198.51.100.1`, not the proxy. This preserves client blacklist/rate-limit checks.
- Parsing is bounded to 8,192 characters and 64 entries, including unselected
  prefixes. Oversized chains, CR/LF anywhere, invalid selected addresses and
  incomplete trusted chains reject middleware execution **before** whitelist,
  blacklist, bypass or store access. No alternate forwarding header is tried.
  Rejection propagates as a generic `TypeError` without raw header content;
  the default application error handler responds with HTTP 500. Applications
  may map this to an appropriate generic client error, but must not fail open.
- IPv6 spelling/case is canonicalized. IPv4-mapped IPv6, including hexadecimal
  spellings, shares the corresponding dotted IPv4 bucket. Whitelist/blacklist
  string entries and `resetKey()` callers should use these canonical keys.
- A missing/invalid socket address uses one shared `unknown` key and cannot
  enable forwarded identity. Requests are still counted; this is not a bypass.
- Invalid trusted forwarding never falls back to a whitelisted proxy key or
  changes a valid client's identity to evade its blacklist. Sanitize XFF at
  ingress and avoid proxy-IP exemptions when the intended policy is per-client.

Literal validation uses Node's [`net.isIP()`](https://nodejs.org/api/net.html#netisipinput);
IPv6 canonicalization uses the [WHATWG URL API](https://nodejs.org/api/url.html#the-whatwg-url-api).

## Custom generators, skip hooks and compatibility

A custom `keyGenerator(req)` is still called with exactly one request argument;
sync/async generators and their application-defined keys are preserved. Proxy
options only affect the built-in generator. A custom generator using raw headers
or an independently configured `req.ip` must establish its own trust boundary.
Its errors/rejections propagate; no fallback identity or automatic exemption is
introduced. Supplied `keyGenerator` values must be functions.

Intentional pre-identity exemptions (`skip` and `skipOptions`) still opt out
before identity validation. `bypass` and whitelists apply only after identity
has been established; they cannot exempt invalid trusted forwarding. Do not base
exemptions on untrusted headers. False or throwing skip/bypass callbacks do not
grant exemption; errors propagate. Response
counting, limiter algorithms and store behavior are unchanged by this identity
fix; this is not a distributed-store or concurrency redesign.

**Compatibility changes:** proxy trust is now off by default; `trustProxy: false`
and `proxies` now actually affect the default key generator; trust predicates
are evaluated rather than treated as truthy; proxy/hop/key-generator option
types are validated; non-XFF forwarding headers and nonliteral selected XFF
values are no longer accepted by the built-in generator. Missing, invalid,
oversized or incomplete trusted forwarding now rejects instead of using the
proxy's socket bucket. Unselected prefixes do not influence client identity.
Alternate spellings of the same IP
no longer create separate keys. Migrate reverse-proxy deployments explicitly.

## Regression checks

```sh
node tests/test-rate-limit.js
node tests/test-rate-limit-security.js
```

Tests use loopback HTTP servers and pure request fixtures for header rotation,
trusted/untrusted peers, hop selection, malformed chains, literal normalization,
custom generators, option validation, skip hooks and error-response counting.
