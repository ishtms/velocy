/**
 * Example of using the static file serving middleware with Velocy
 */

const { Router, createServer } = require('./lib/index');
const staticMiddleware = require('./lib/middleware/static');
const path = require('path');

// Create a router
const router = new Router();

// Serve static files from a 'public' directory
// This middleware will handle all requests to /static/*
router.use('/static', staticMiddleware({
  root: path.join(__dirname, 'public'),
  index: ['index.html', 'index.htm'],
  dotfiles: 'ignore',
  etag: true,
  lastModified: true,
  maxAge: 86400000, // 1 day cache for static assets
  directoryListing: true, // Enable directory browsing
  gzip: true, // Support pre-compressed .gz files
  brotli: true, // Support pre-compressed .br files
  acceptRanges: true, // Support range requests for video/audio streaming
  setHeaders: (file, stats, res) => {
    // Custom headers for specific file types
    if (file.endsWith('.pdf')) {
      res.set('X-Content-Type-Options', 'nosniff');
    }
  }
}));

// Serve files from 'assets' with immutable caching (for versioned files)
router.use('/assets', staticMiddleware.immutable('./assets', {
  dotfiles: 'deny' // Explicitly deny access to dotfiles
}));

// Serve the app's root with a public directory
router.use('/', staticMiddleware.public('./www', {
  extensions: ['.html'], // Try adding .html if file not found
  fallthrough: false // Don't pass to next middleware on 404
}));

// API routes can still be defined
router.get('/api/status', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Create and start the server
const server = createServer(router);
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Static file server running on http://localhost:${PORT}`);
  console.log('Try these URLs:');
  console.log(`  http://localhost:${PORT}/static/ - Directory listing`);
  console.log(`  http://localhost:${PORT}/api/status - API endpoint`);
  console.log(`  http://localhost:${PORT}/ - Root index file`);
});

/**
 * Directory structure example:
 * 
 * project/
 * ├── public/           # Served at /static/
 * │   ├── css/
 * │   │   └── style.css
 * │   ├── js/
 * │   │   └── app.js
 * │   └── images/
 * │       └── logo.png
 * ├── assets/          # Served at /assets/ with immutable caching
 * │   └── dist/
 * │       └── bundle.123abc.js
 * └── www/            # Served at root /
 *     └── index.html
 */

/**
 * Features demonstrated:
 * 
 * 1. Multiple static directories with different configurations
 * 2. Directory listing for development
 * 3. ETag and Last-Modified headers for caching
 * 4. Support for pre-compressed files (.gz, .br)
 * 5. Range requests for media streaming
 * 6. Custom headers via setHeaders callback
 * 7. Security features (dotfile handling, path traversal prevention)
 * 8. Integration with API routes
 * 9. Immutable caching for versioned assets
 * 10. Extension fallback for clean URLs
 */