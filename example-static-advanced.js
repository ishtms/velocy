/**
 * Advanced static middleware configuration examples
 * Shows various use cases and configurations
 */

const { Router, createServer, static: staticMiddleware } = require('./lib');
const path = require('path');

const router = new Router();

// Example 1: Basic static file serving
const publicStatic = staticMiddleware({
  root: './public',
  index: 'index.html'
});

// Example 2: Serve assets with aggressive caching
const assetsStatic = staticMiddleware({
  root: './assets',
  maxAge: 31536000000, // 1 year
  immutable: true, // Files never change (versioned filenames)
  etag: true,
  lastModified: true
});

// Example 3: Serve uploads with no caching
const uploadsStatic = staticMiddleware({
  root: './uploads',
  maxAge: 0,
  etag: false,
  lastModified: false,
  directoryListing: false,
  dotfiles: 'deny'
});

// Example 4: Development static server with directory listing
const devStatic = staticMiddleware({
  root: './src',
  directoryListing: true,
  maxAge: 0, // No caching in development
  headers: {
    'X-Dev-Server': 'true'
  }
});

// Example 5: CDN-optimized configuration
const cdnStatic = staticMiddleware({
  root: './dist',
  maxAge: 86400000, // 24 hours
  etag: true,
  gzip: true,
  brotli: true,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff'
  }
});

// Example 6: Documentation server
const docsStatic = staticMiddleware({
  root: './docs',
  index: ['index.html', 'readme.html'],
  directoryListing: true,
  maxAge: 3600000, // 1 hour
  onError: (err, req, res) => {
    console.error(`Error serving ${req.url}:`, err.message);
    res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head><title>404 - Not Found</title></head>
      <body>
        <h1>404 - Documentation Not Found</h1>
        <p>The requested documentation page was not found.</p>
        <a href="/">Return to documentation home</a>
      </body>
      </html>
    `);
  }
});

// Mount middleware at different paths
router.get('/*', publicStatic);              // Serve public files at root
router.get('/assets/*', assetsStatic);       // Serve assets with long cache
router.get('/uploads/*', uploadsStatic);     // Serve uploads with no cache
router.get('/dev/*', devStatic);             // Development files with listing
router.get('/cdn/*', cdnStatic);             // CDN-optimized serving
router.get('/docs/*', docsStatic);           // Documentation server

// Example of combining static with dynamic routes
router.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: Date.now() });
});

// Protected static files with authentication
const protectedStatic = staticMiddleware({
  root: './protected',
  dotfiles: 'deny'
});

router.get('/protected/*', (req, res, next) => {
  // Simple auth check (replace with real authentication)
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // If authenticated, serve static file
  protectedStatic(req, res, next);
});

// Fallback route for SPA (Single Page Applications)
const spaStatic = staticMiddleware({
  root: './spa-build',
  index: 'index.html'
});

router.get('/app/*', (req, res, next) => {
  // Try to serve the static file
  spaStatic(req, res, () => {
    // If file not found, serve index.html for client-side routing
    res.sendFile(path.join(__dirname, 'spa-build', 'index.html'));
  });
});

// Example with conditional middleware based on environment
const isDevelopment = process.env.NODE_ENV !== 'production';

if (isDevelopment) {
  // In development, serve source files with directory listing
  const srcStatic = staticMiddleware({
    root: './src',
    directoryListing: true,
    maxAge: 0
  });
  router.get('/src/*', srcStatic);
} else {
  // In production, serve optimized build
  const buildStatic = staticMiddleware({
    root: './build',
    maxAge: 31536000000,
    immutable: true,
    gzip: true,
    brotli: true
  });
  router.get('/static/*', buildStatic);
}

// Create and start server
const server = createServer(router);
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`
Advanced Static Server Configuration
====================================

Server running at: http://localhost:${PORT}

Configured routes:
- /              : Public files (basic serving)
- /assets/*      : Assets with aggressive caching
- /uploads/*     : User uploads (no caching)
- /dev/*         : Development files with directory listing
- /cdn/*         : CDN-optimized configuration
- /docs/*        : Documentation with custom 404
- /protected/*   : Protected files (requires auth)
- /app/*         : SPA with fallback to index.html
- /api/health    : Dynamic API endpoint

Environment: ${isDevelopment ? 'Development' : 'Production'}
  `);
});