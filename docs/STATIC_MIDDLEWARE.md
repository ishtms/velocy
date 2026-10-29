# Velocy Static File Middleware

Static serving rejects observed symbolic links at or below the configured root. With the default `fallthrough: true`, rejected requests pass to downstream middleware, which must enforce its own access policy; use `fallthrough: false` to return 403. **The root, its ancestors, directories and file contents must be controlled by trusted writers.** Descriptor-bound reads reduce check/open races but do not provide portable confinement against a hostile filesystem writer. See [Filesystem race boundary](#filesystem-race-boundary).

A comprehensive, production-ready static file serving middleware for the Velocy framework with zero external dependencies.

## Features

- **Efficient File Serving**: Stream-based file delivery for optimal memory usage
- **MIME Type Detection**: Comprehensive MIME type mapping for all common file types  
- **ETag Support**: Automatic ETag generation and validation for efficient caching
- **Range Requests**: Full support for partial content delivery (HTTP 206) for media streaming
- **Pre-compressed Files**: Automatic serving of `.gz` and `.br` files when available
- **Security**: Path traversal prevention, dotfile handling, and safe path resolution
- **Directory Listing**: Optional HTML directory browsing with file information
- **Conditional Requests**: Support for If-Modified-Since and If-None-Match headers
- **Cache Control**: Flexible caching strategies with customizable headers
- **Zero Dependencies**: Uses only Node.js built-in modules

## Installation

The static middleware is included with Velocy:

```javascript
const { static: staticMiddleware } = require('velocy');
// or
const staticMiddleware = require('velocy/lib/middleware/static');
```

## Basic Usage

```javascript
const { Router, createServer, static: staticMiddleware } = require('velocy');

const router = new Router();

// Serve files from 'public' directory
router.use('/static', staticMiddleware({
  root: './public'
}));

const server = createServer(router);
server.listen(3000);
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `root` | String | *required* | Root directory to serve files from |
| `index` | String/Array | `['index.html']` | Index file(s) to serve for directories |
| `dotfiles` | String | `'ignore'` | How to handle dotfiles: 'allow', 'deny', 'ignore' |
| `etag` | Boolean | `true` | Enable ETag generation |
| `lastModified` | Boolean | `true` | Enable Last-Modified header |
| `maxAge` | Number/String | `0` | Cache-Control max-age in ms or string |
| `immutable` | Boolean | `false` | Add immutable directive to Cache-Control |
| `directoryListing` | Boolean | `false` | Enable directory listing |
| `gzip` | Boolean | `true` | Support pre-compressed .gz files |
| `brotli` | Boolean | `true` | Support pre-compressed .br files |
| `headers` | Object | `{}` | Additional headers to set on all responses |
| `setHeaders` | Function | - | Function to set custom headers (file, stats, res) |
| `extensions` | Array | `[]` | Extensions to try when file not found |
| `fallthrough` | Boolean | `true` | Pass missing or rejected paths to the next middleware |
| `acceptRanges` | Boolean | `true` | Enable range requests |
| `cacheControl` | Object | `{}` | Custom cache control by file extension |

## Advanced Examples

### Multiple Static Directories

```javascript
// Serve different directories with different configurations
router.use('/images', staticMiddleware({
  root: './uploads/images',
  maxAge: 604800000, // 1 week
  immutable: true
}));

router.use('/downloads', staticMiddleware({
  root: './files',
  directoryListing: true,
  dotfiles: 'deny'
}));
```

### Custom Headers

```javascript
router.use('/docs', staticMiddleware({
  root: './documentation',
  setHeaders: (file, stats, res) => {
    // Add security headers for HTML files
    if (file.endsWith('.html')) {
      res.set('X-Frame-Options', 'DENY');
      res.set('X-Content-Type-Options', 'nosniff');
    }
    
    // Force download for certain files
    if (file.endsWith('.pdf')) {
      res.set('Content-Disposition', 'attachment');
    }
  }
}));
```

### Pre-compression Support

```javascript
// Automatically serve .gz or .br versions when available
router.use('/assets', staticMiddleware({
  root: './dist',
  gzip: true,
  brotli: true
}));

// Files structure:
// dist/
//   app.js
//   app.js.gz   (served when Accept-Encoding includes gzip)
//   app.js.br   (served when Accept-Encoding includes br)
```

### Clean URLs

```javascript
// Serve .html files without extension
router.use('/', staticMiddleware({
  root: './site',
  extensions: ['.html'],
  index: ['index.html', 'default.html']
}));

// Now /about will serve ./site/about.html
```

### Custom Cache Strategies

```javascript
router.use('/public', staticMiddleware({
  root: './public',
  cacheControl: {
    'html': 'no-cache, must-revalidate',
    'css': 'public, max-age=604800',
    'js': 'public, max-age=604800',
    'jpg': 'public, max-age=2592000, immutable',
    'png': 'public, max-age=2592000, immutable'
  }
}));
```

## Preset Configurations

The middleware includes convenient presets for common use cases:

### Assets (Long-term caching)

```javascript
router.use('/assets', staticMiddleware.assets('./dist'));
// Equivalent to:
// staticMiddleware({
//   root: './dist',
//   maxAge: 86400000, // 1 day
//   etag: true,
//   lastModified: true,
//   gzip: true,
//   brotli: true
// })
```

### Public (Web root)

```javascript
router.use('/', staticMiddleware.public('./www'));
// Equivalent to:
// staticMiddleware({
//   root: './www',
//   index: ['index.html', 'index.htm'],
//   directoryListing: false,
//   dotfiles: 'ignore'
// })
```

### Immutable (Versioned assets)

```javascript
router.use('/cdn', staticMiddleware.immutable('./static'));
// Equivalent to:
// staticMiddleware({
//   root: './static',
//   maxAge: 31536000000, // 1 year
//   immutable: true,
//   etag: true,
//   lastModified: true
// })
```

## Security Considerations

1. **Path Traversal Prevention**: The middleware normalizes paths and ensures they stay within the root directory
2. **Dotfile Handling**: Control access to hidden files with the `dotfiles` option
3. **Headers**: Use `setHeaders` to add security headers like CSP, X-Frame-Options, etc.
4. **Directory Listing**: Disable in production unless specifically needed

### Filesystem race boundary

All file-serving candidates (ordinary files, indexes, extension fallbacks, gzip
and Brotli variants) use the same sequence:

1. Check the root and each path component with `lstat`; reject observed symlinks.
2. Open the selected file read-only, adding `O_NOFOLLOW` and `O_NONBLOCK` when
   the runtime exposes them. An unsupported flag is not emulated by Node.
3. Obtain metadata from the opened descriptor; require a regular file and the
   same device/inode as the selected candidate. Recheck the path for symlinks
   and matching identity before setting file headers.
4. Build headers from descriptor metadata and stream that **same FileHandle**,
   without reopening the path. Close it for success, HEAD, 304, 416, empty files,
   errors and client disconnects. A detected identity change is rejected, not
   retried against a potentially different file.

| Scenario | Protection / boundary |
|---|---|
| Final component replaced by a symlink before open | `O_NOFOLLOW` rejects it where supported; identity/path checks reject observed changes elsewhere |
| Different regular file or directory observed at open | Descriptor type and device/inode checks reject the replacement |
| Path replaced after descriptor validation | Bytes still come from the already-opened file; no second path resolution |
| Intermediate directory, root or ancestor changed by an attacker | **Not confined**: separate path checks are not atomic, and `O_NOFOLLOW` protects only the final component |
| Opened inode modified in place, hard-linked elsewhere, or inode identity reused | **Not an immutable content snapshot or proof of root membership**; trusted writers remain required |
| Directory listing | Path-based `readdir`/metadata checks, not a descriptor-confined snapshot; disable it for sensitive deployments |
| Windows / unsupported flags / unusual or network filesystems | No blanket no-follow, nonblocking or identity-stability guarantee; platform semantics apply |

These checks are defense in depth, **not a sandbox for attacker-writable upload
trees**. Node's public portable filesystem API does not expose a root-directory
descriptor-relative `openat`/`openat2` traversal with beneath-root resolution.
Repeated `lstat`/`realpath` checks cannot substitute for an atomic OS primitive.
`O_NONBLOCK` avoids FIFO-open blocking where supported; non-regular descriptors
are rejected before streaming, but this is not a guarantee against arbitrary
device or network filesystem behavior.

For deployments with untrusted writers, an owner must choose an external
boundary: publish vetted files into a separate immutable/read-only tree with
trusted ancestors; isolate the serving process with filesystem/OS permissions
so outside secrets are inaccessible; or authorize a reviewed platform-specific
native implementation of descriptor-relative confinement. No dependency or
platform-specific confinement implementation is included here. Even native
path confinement does not make concurrent writes to the same inode immutable.

API evidence: official Node.js [`fs.open` constants](https://nodejs.org/api/fs.html#file-open-constants)
(`O_NOFOLLOW`/`O_NONBLOCK`, with limited Windows availability),
[`FileHandle.stat`](https://nodejs.org/api/fs.html#filehandlestatoptions), and
[`fs.createReadStream`](https://nodejs.org/api/fs.html#fscreatereadstreampath-options)
(`fd` ignores the path; `autoClose` closes on end/error). These API semantics
were checked through Context7 against `nodejs/node` documentation; only local
tests on the recorded development platform establish behavior for this change.

## Performance Tips

1. **Pre-compress Assets**: Generate `.gz` and `.br` versions during build for better compression
2. **Use ETags**: Keep `etag: true` for efficient caching
3. **Set Appropriate Cache Headers**: Use long max-age for versioned assets
4. **Enable Range Requests**: Keep `acceptRanges: true` for video/audio streaming
5. **Use Immutable**: Add `immutable: true` for truly static, versioned assets

## Media Streaming

The middleware fully supports range requests for efficient media streaming:

```javascript
router.use('/media', staticMiddleware({
  root: './videos',
  acceptRanges: true, // Enable range requests
  maxAge: 3600000 // 1 hour cache
}));
```

This allows video/audio players to seek and buffer efficiently.

## Integration with Velocy

The static middleware integrates seamlessly with Velocy's routing system:

```javascript
const router = new Router();

// Static files
router.use('/static', staticMiddleware({ root: './public' }));

// API routes
router.get('/api/users', (req, res) => {
  res.json({ users: [] });
});

// Catch-all for SPA
router.use('*', staticMiddleware({
  root: './dist',
  fallthrough: false,
  index: ['index.html']
}));
```

## Error Handling

The middleware handles errors gracefully:

- **404 Not Found**: When file doesn't exist (can fallthrough to next middleware)
- **403 Forbidden**: When accessing forbidden paths or dotfiles
- **416 Range Not Satisfiable**: When range request is invalid
- **500 Internal Server Error**: For unexpected errors

If an error occurs before headers are committed (including a throwing
`setHeaders` callback), file-specific framing, compression, range and cache
validators are removed from the wrapper and native queued headers. The error
is sent as correctly sized plaintext with `Cache-Control: no-store`, not as a
compressed or partial file response. Other custom/security headers are retained.

This error-response policy does **not** apply to `EACCES` fallthrough. Before
calling downstream middleware, static serving restores the wrapper/native
header snapshots captured at entry (including copied array values), undoing any
static or callback header changes. Upstream headers and downstream content-type
selection are preserved; no plaintext or no-store policy is imposed on `next()`.

If a file read fails after success headers have been committed, the middleware
destroys the native response/connection instead of gracefully ending a truncated
success entity. Clients may receive a connection reset before the first byte or
an aborted/incomplete response after partial data; they must not treat it as a
complete successful download. The source stream is destroyed on disconnect and
its FileHandle closes only after pending read I/O settles.
Commitment checks include both the response wrapper and the native response:
calling native `writeHead()` or `flushHeaders()` inside `setHeaders` commits the
response even if the wrapper flag is still false. A subsequent callback error
aborts the transport before attempting any header reset or fallthrough.

## Browser Compatibility

The middleware sets appropriate headers for wide browser compatibility:
- Proper MIME types for all file formats
- ETag format compatible with all browsers
- Range request support for modern media elements
- Cache-Control headers understood by all browsers

## License

Part of the Velocy framework - see main project license.
