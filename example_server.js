/**
 * Velocy Framework - Comprehensive Example Server
 * 
 * This example demonstrates EVERY feature of the Velocy framework.
 * Visit http://localhost:4000 for interactive documentation and testing.
 * 
 * @author Velocy Framework
 * @version 1.0.0
 */

const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

// Import ALL Velocy features
const {
  // Core Routers
  Router,
  FastRouter,
  SimpleRouter,
  WebSocketRouter,
  
  // WebSocket Classes
  WebSocketConnection,
  WebSocketServer,
  WS_OPCODES,
  WS_CLOSE_CODES,
  WS_STATES,
  
  // Core Classes
  Request,
  Response,
  
  // Middleware
  bodyParser,
  cors,
  cookieParser,
  static: staticMiddleware,
  compression,
  rateLimit,
  session,
  validator,
  validate,
  
  // Utilities
  createServer,
  buildQueryString,
  websocketUtils
} = require('./index');

// ==================== CONFIGURATION ====================

const PORT = process.env.PORT || 4000;
const SESSION_SECRET = 'velocy-example-secret-key-2024';
const COOKIE_SECRET = 'velocy-cookie-secret-key-2024';

// ==================== INITIALIZE ROUTERS ====================

// Main router with all features enabled
const app = new Router({
  performance: true,      // Enable performance monitoring
  cache: true,            // Enable route caching
  routeCacheSize: 1000,   // Route cache size
  urlCacheSize: 500,      // URL parsing cache size
  cookieSecret: COOKIE_SECRET,
  websocket: {
    enableQueue: true,
    maxQueueSize: 100,
    heartbeatInterval: 30000,
    heartbeatTimeout: 60000,
    maxPayloadSize: 10 * 1024 * 1024 // 10MB
  }
});

// Create additional routers for demonstration
const fastRouter = new FastRouter();
const simpleRouter = new SimpleRouter();

// ==================== GLOBAL MIDDLEWARE ====================

// 1. CORS - Cross-Origin Resource Sharing
app.use(cors({
  origin: (origin, callback) => {
    // Custom origin validation
    const allowedOrigins = ['http://localhost:4000', 'http://localhost:3000'];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Custom-Header'],
  exposedHeaders: ['X-Total-Count', 'X-Page-Count'],
  credentials: true,
  maxAge: 86400, // 24 hours
  optionsSuccessStatus: 204
}));

// 2. Compression - Response compression
app.use(compression({
  threshold: 1024, // Only compress responses > 1KB
  level: 6,        // Compression level (0-9)
  filter: (req, res) => {
    // Custom filter function
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// 3. Cookie Parser - Parse and sign cookies
app.use(cookieParser(COOKIE_SECRET));

// 4. Session Management
app.use(session({
  secret: SESSION_SECRET,
  name: 'velocy.sid',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24, // 24 hours
    sameSite: 'lax'
  },
  genid: () => {
    return 'sess_' + crypto.randomBytes(16).toString('hex');
  }
}));

// 5. Body Parsers - Parse different content types
app.use(bodyParser.json({
  limit: '10mb',
  strict: true,
  reviver: (key, value) => {
    // Custom JSON reviver
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
      return new Date(value);
    }
    return value;
  }
}));

app.use(bodyParser.urlencoded({
  extended: true,
  limit: '10mb',
  parameterLimit: 10000
}));

app.use(bodyParser.text({
  type: 'text/*',
  limit: '1mb'
}));

app.use(bodyParser.raw({
  type: 'application/octet-stream',
  limit: '50mb'
}));

// 6. Custom logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const originalEnd = res.end;
  
  // Track response
  res.end = function(...args) {
    const duration = Date.now() - start;
    const size = res.getHeader('content-length') || 0;
    
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms) ${size}B`);
    
    // Call original end
    originalEnd.apply(res, args);
  };
  
  next();
});

// 7. Request ID middleware
app.use((req, res, next) => {
  req.id = crypto.randomBytes(8).toString('hex');
  res.set('X-Request-ID', req.id);
  next();
});

// ==================== IN-MEMORY DATA STORE ====================

const dataStore = {
  users: new Map([
    [1, { id: 1, name: 'Admin User', email: 'admin@velocy.com', role: 'admin', createdAt: new Date('2024-01-01') }],
    [2, { id: 2, name: 'John Doe', email: 'john@example.com', role: 'user', createdAt: new Date('2024-01-15') }],
    [3, { id: 3, name: 'Jane Smith', email: 'jane@example.com', role: 'moderator', createdAt: new Date('2024-02-01') }]
  ]),
  posts: new Map(),
  files: new Map(),
  websocketClients: new Map(),
  messageHistory: [],
  apiKeys: new Map([
    ['demo-api-key-123', { name: 'Demo API Key', permissions: ['read', 'write'] }]
  ])
};

let nextUserId = 4;
let nextPostId = 1;

// ==================== STATIC FILE SERVING ====================

// Serve static files from a public directory
app.use('/public', staticMiddleware(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true,
  lastModified: true,
  index: ['index.html', 'index.htm'],
  dotfiles: 'ignore',
  extensions: ['html', 'css', 'js', 'json']
}));

// ==================== ROOT DOCUMENTATION ROUTE ====================

app.get('/', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Velocy Framework - Comprehensive Example Server</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
        }
        .header {
            background: white;
            border-radius: 10px;
            padding: 2rem;
            margin-bottom: 2rem;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
        }
        h1 {
            color: #667eea;
            margin-bottom: 1rem;
            font-size: 2.5rem;
        }
        .subtitle {
            color: #666;
            font-size: 1.2rem;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 1.5rem;
            margin-top: 2rem;
        }
        .card {
            background: white;
            border-radius: 10px;
            padding: 1.5rem;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.08);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
        }
        .card h2 {
            color: #764ba2;
            margin-bottom: 1rem;
            font-size: 1.5rem;
        }
        .endpoint {
            background: #f8f9fa;
            border-left: 3px solid #667eea;
            padding: 0.75rem;
            margin: 0.5rem 0;
            border-radius: 5px;
            font-family: 'Courier New', monospace;
        }
        .method {
            display: inline-block;
            padding: 0.25rem 0.5rem;
            border-radius: 3px;
            font-weight: bold;
            font-size: 0.85rem;
            margin-right: 0.5rem;
        }
        .get { background: #28a745; color: white; }
        .post { background: #007bff; color: white; }
        .put { background: #ffc107; color: black; }
        .delete { background: #dc3545; color: white; }
        .patch { background: #17a2b8; color: white; }
        .ws { background: #6f42c1; color: white; }
        .description {
            color: #666;
            font-size: 0.9rem;
            margin-top: 0.5rem;
        }
        .test-section {
            background: #f8f9fa;
            border-radius: 10px;
            padding: 2rem;
            margin-top: 2rem;
        }
        .test-section h2 {
            color: #667eea;
            margin-bottom: 1rem;
        }
        .test-form {
            display: flex;
            gap: 1rem;
            margin-bottom: 1rem;
        }
        .test-form input, .test-form select {
            padding: 0.5rem;
            border: 1px solid #ddd;
            border-radius: 5px;
            flex: 1;
        }
        .test-form button {
            padding: 0.5rem 1.5rem;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-weight: bold;
        }
        .test-form button:hover {
            background: #5a67d8;
        }
        #response {
            background: #1e1e1e;
            color: #d4d4d4;
            padding: 1rem;
            border-radius: 5px;
            min-height: 100px;
            font-family: 'Courier New', monospace;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-top: 2rem;
        }
        .stat-card {
            background: white;
            padding: 1rem;
            border-radius: 10px;
            text-align: center;
        }
        .stat-value {
            font-size: 2rem;
            font-weight: bold;
            color: #667eea;
        }
        .stat-label {
            color: #666;
            font-size: 0.9rem;
        }
        .feature-list {
            list-style: none;
            padding: 0;
        }
        .feature-list li {
            padding: 0.5rem 0;
            border-bottom: 1px solid #eee;
        }
        .feature-list li:before {
            content: "✓ ";
            color: #28a745;
            font-weight: bold;
            margin-right: 0.5rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 Velocy Framework</h1>
            <p class="subtitle">Comprehensive Example Server - Demonstrating Every Feature</p>
            <p>Session ID: ${req.sessionID || 'N/A'} | Request ID: ${req.id}</p>
        </div>

        <div class="grid">
            <!-- Core Features -->
            <div class="card">
                <h2>📦 Core Features</h2>
                <ul class="feature-list">
                    <li>Three Router Types (Router, FastRouter, SimpleRouter)</li>
                    <li>Performance Monitoring & Caching</li>
                    <li>Request/Response Enhancement</li>
                    <li>Middleware Pipeline</li>
                    <li>Error Handling</li>
                    <li>Nested Routing</li>
                    <li>Route Parameters & Wildcards</li>
                    <li>View Engine Support</li>
                </ul>
            </div>

            <!-- Middleware Features -->
            <div class="card">
                <h2>🔧 Middleware</h2>
                <ul class="feature-list">
                    <li>Body Parser (JSON, URL-encoded, Raw, Text)</li>
                    <li>CORS with Custom Origin Validation</li>
                    <li>Cookie Parser with Signed Cookies</li>
                    <li>Session Management</li>
                    <li>Compression</li>
                    <li>Rate Limiting</li>
                    <li>Request Validation</li>
                    <li>Static File Serving</li>
                </ul>
            </div>

            <!-- HTTP Methods -->
            <div class="card">
                <h2>🌐 HTTP Methods</h2>
                <div class="endpoint">
                    <span class="method get">GET</span> /api/users
                    <div class="description">List all users with pagination</div>
                </div>
                <div class="endpoint">
                    <span class="method post">POST</span> /api/users
                    <div class="description">Create new user with validation</div>
                </div>
                <div class="endpoint">
                    <span class="method put">PUT</span> /api/users/:id
                    <div class="description">Update user by ID</div>
                </div>
                <div class="endpoint">
                    <span class="method delete">DELETE</span> /api/users/:id
                    <div class="description">Delete user by ID</div>
                </div>
                <div class="endpoint">
                    <span class="method patch">PATCH</span> /api/users/:id
                    <div class="description">Partial update user</div>
                </div>
            </div>

            <!-- Request Features -->
            <div class="card">
                <h2>📥 Request Features</h2>
                <div class="endpoint">
                    <span class="method get">GET</span> /demo/request-info
                    <div class="description">Shows all request properties</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span> /demo/params/:id/:action
                    <div class="description">Route parameters demo</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span> /demo/query
                    <div class="description">Query string parsing</div>
                </div>
                <div class="endpoint">
                    <span class="method post">POST</span> /demo/body
                    <div class="description">Body parsing demo</div>
                </div>
            </div>

            <!-- Response Features -->
            <div class="card">
                <h2>📤 Response Features</h2>
                <div class="endpoint">
                    <span class="method get">GET</span> /demo/json
                    <div class="description">JSON response</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span> /demo/redirect
                    <div class="description">Redirect demo</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span> /demo/download
                    <div class="description">File download</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span> /demo/stream
                    <div class="description">Streaming response</div>
                </div>
            </div>

            <!-- WebSocket Features -->
            <div class="card">
                <h2>🔌 WebSocket</h2>
                <div class="endpoint">
                    <span class="method ws">WS</span> /ws
                    <div class="description">Main WebSocket endpoint</div>
                </div>
                <div class="endpoint">
                    <span class="method ws">WS</span> /ws/chat/:room
                    <div class="description">Room-based chat</div>
                </div>
                <div class="endpoint">
                    <span class="method ws">WS</span> /ws/broadcast
                    <div class="description">Broadcasting demo</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span> /api/ws/stats
                    <div class="description">WebSocket statistics</div>
                </div>
            </div>

            <!-- Security Features -->
            <div class="card">
                <h2>🔐 Security</h2>
                <div class="endpoint">
                    <span class="method post">POST</span> /auth/login
                    <div class="description">Login with session</div>
                </div>
                <div class="endpoint">
                    <span class="method post">POST</span> /auth/logout
                    <div class="description">Logout and destroy session</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span> /auth/protected
                    <div class="description">Protected route (requires auth)</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span> /api/rate-limited
                    <div class="description">Rate limited endpoint</div>
                </div>
            </div>

            <!-- Advanced Features -->
            <div class="card">
                <h2>⚡ Advanced</h2>
                <div class="endpoint">
                    <span class="method get">GET</span> /nested/sub/route
                    <div class="description">Nested router demo</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span> /files/*.pdf
                    <div class="description">Wildcard routing</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span> /catch/**
                    <div class="description">Catch-all route</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span> /demo/performance
                    <div class="description">Performance metrics</div>
                </div>
            </div>

            <!-- Cookie Management -->
            <div class="card">
                <h2>🍪 Cookies</h2>
                <div class="endpoint">
                    <span class="method get">GET</span> /cookies/set
                    <div class="description">Set various cookies</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span> /cookies/get
                    <div class="description">Get all cookies</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span> /cookies/signed
                    <div class="description">Signed cookies demo</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span> /cookies/clear
                    <div class="description">Clear cookies</div>
                </div>
            </div>

            <!-- Session Management -->
            <div class="card">
                <h2>📝 Sessions</h2>
                <div class="endpoint">
                    <span class="method get">GET</span> /session/info
                    <div class="description">Current session info</div>
                </div>
                <div class="endpoint">
                    <span class="method post">POST</span> /session/data
                    <div class="description">Store session data</div>
                </div>
                <div class="endpoint">
                    <span class="method delete">DELETE</span> /session/destroy
                    <div class="description">Destroy session</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span> /session/regenerate
                    <div class="description">Regenerate session ID</div>
                </div>
            </div>

            <!-- Validation -->
            <div class="card">
                <h2>✅ Validation</h2>
                <div class="endpoint">
                    <span class="method post">POST</span> /validate/user
                    <div class="description">User schema validation</div>
                </div>
                <div class="endpoint">
                    <span class="method post">POST</span> /validate/custom
                    <div class="description">Custom validation rules</div>
                </div>
                <div class="endpoint">
                    <span class="method post">POST</span> /validate/async
                    <div class="description">Async validation</div>
                </div>
            </div>

            <!-- File Operations -->
            <div class="card">
                <h2>📁 File Operations</h2>
                <div class="endpoint">
                    <span class="method post">POST</span> /upload
                    <div class="description">File upload</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span> /download/:filename
                    <div class="description">File download</div>
                </div>
                <div class="endpoint">
                    <span class="method get">GET</span> /files/list
                    <div class="description">List uploaded files</div>
                </div>
            </div>
        </div>

        <!-- Interactive Test Section -->
        <div class="test-section">
            <h2>🧪 Interactive API Tester</h2>
            <div class="test-form">
                <select id="method">
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="DELETE">DELETE</option>
                    <option value="PATCH">PATCH</option>
                </select>
                <input type="text" id="endpoint" placeholder="/api/users" value="/api/users">
                <input type="text" id="body" placeholder='{"name":"test"}' style="display:none;">
                <button onclick="testAPI()">Send Request</button>
            </div>
            <div id="response">Response will appear here...</div>
        </div>

        <!-- Statistics -->
        <div class="stats">
            <div class="stat-card">
                <div class="stat-value">${dataStore.users.size}</div>
                <div class="stat-label">Total Users</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${dataStore.websocketClients.size}</div>
                <div class="stat-label">WebSocket Clients</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${req.session.views || 0}</div>
                <div class="stat-label">Your Page Views</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${PORT}</div>
                <div class="stat-label">Server Port</div>
            </div>
        </div>
    </div>

    <script>
        // Show/hide body input based on method
        document.getElementById('method').addEventListener('change', function() {
            const bodyInput = document.getElementById('body');
            if (['POST', 'PUT', 'PATCH'].includes(this.value)) {
                bodyInput.style.display = 'block';
            } else {
                bodyInput.style.display = 'none';
            }
        });

        // Test API function
        async function testAPI() {
            const method = document.getElementById('method').value;
            const endpoint = document.getElementById('endpoint').value;
            const bodyInput = document.getElementById('body').value;
            const responseDiv = document.getElementById('response');
            
            responseDiv.textContent = 'Loading...';
            
            try {
                const options = {
                    method: method,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': 'demo-api-key-123'
                    }
                };
                
                if (['POST', 'PUT', 'PATCH'].includes(method) && bodyInput) {
                    options.body = bodyInput;
                }
                
                const response = await fetch('http://localhost:${PORT}' + endpoint, options);
                const data = await response.json();
                
                responseDiv.textContent = JSON.stringify({
                    status: response.status,
                    headers: Object.fromEntries(response.headers.entries()),
                    data: data
                }, null, 2);
            } catch (error) {
                responseDiv.textContent = 'Error: ' + error.message;
            }
        }

        // WebSocket test
        function connectWebSocket() {
            const ws = new WebSocket('ws://localhost:${PORT}/ws');
            
            ws.onopen = () => {
                console.log('WebSocket connected');
                ws.send(JSON.stringify({ type: 'hello', message: 'From browser' }));
            };
            
            ws.onmessage = (event) => {
                console.log('WebSocket message:', event.data);
            };
            
            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
            
            ws.onclose = () => {
                console.log('WebSocket disconnected');
            };
            
            return ws;
        }

        // Update page views
        if (!req.session.views) {
            req.session.views = 0;
        }
        req.session.views++;
    </script>
</body>
</html>
  `;
  
  res.type('text/html').send(html);
});

// ==================== ALL HTTP METHODS DEMONSTRATION ====================

// GET method
app.get('/api/users', (req, res) => {
  const { page = 1, limit = 10, sort = 'id', order = 'asc', search } = req.query;
  
  let users = Array.from(dataStore.users.values());
  
  // Search
  if (search) {
    users = users.filter(u => 
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
    );
  }
  
  // Sort
  users.sort((a, b) => {
    const aVal = a[sort];
    const bVal = b[sort];
    return order === 'asc' ? 
      (aVal > bVal ? 1 : -1) : 
      (aVal < bVal ? 1 : -1);
  });
  
  // Paginate
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + parseInt(limit);
  const paginatedUsers = users.slice(startIndex, endIndex);
  
  res.set('X-Total-Count', users.length.toString());
  res.set('X-Page-Count', Math.ceil(users.length / limit).toString());
  
  res.json({
    data: paginatedUsers,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: users.length,
      totalPages: Math.ceil(users.length / limit)
    }
  });
});

// POST method with validation
app.post('/api/users', 
  validator({
    body: {
      name: { type: 'string', required: true, minLength: 2, maxLength: 50 },
      email: { type: 'email', required: true },
      role: { type: 'string', enum: ['admin', 'user', 'moderator'], default: 'user' },
      age: { type: 'number', min: 0, max: 150 },
      tags: { type: 'array', items: { type: 'string' }, maxItems: 10 }
    }
  }),
  (req, res) => {
    const user = {
      id: nextUserId++,
      ...req.body,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    dataStore.users.set(user.id, user);
    
    res.status(201).json({
      message: 'User created successfully',
      user
    });
  }
);

// PUT method - Full update
app.put('/api/users/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const user = dataStore.users.get(id);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  const updatedUser = {
    id,
    ...req.body,
    createdAt: user.createdAt,
    updatedAt: new Date()
  };
  
  dataStore.users.set(id, updatedUser);
  res.json(updatedUser);
});

// PATCH method - Partial update
app.patch('/api/users/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const user = dataStore.users.get(id);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  const updatedUser = {
    ...user,
    ...req.body,
    id, // Prevent ID change
    updatedAt: new Date()
  };
  
  dataStore.users.set(id, updatedUser);
  res.json(updatedUser);
});

// DELETE method
app.delete('/api/users/:id', (req, res) => {
  const id = parseInt(req.params.id);
  
  if (!dataStore.users.has(id)) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  const user = dataStore.users.get(id);
  dataStore.users.delete(id);
  
  res.json({
    message: 'User deleted successfully',
    user
  });
});

// HEAD method
app.head('/api/users/:id', (req, res) => {
  const id = parseInt(req.params.id);
  
  if (!dataStore.users.has(id)) {
    res.status(404).end();
  } else {
    res.status(200).end();
  }
});

// OPTIONS method
app.options('/api/users', (req, res) => {
  res.set('Allow', 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS');
  res.set('X-Accepted-Methods', 'GET, POST, PUT, PATCH, DELETE');
  res.status(204).end();
});

// ALL method - Handles all HTTP methods
app.all('/api/echo', (req, res) => {
  res.json({
    method: req.method,
    path: req.path,
    headers: req.headers,
    query: req.query,
    body: req.body,
    params: req.params,
    cookies: req.cookies,
    signedCookies: req.signedCookies,
    ip: req.ip,
    hostname: req.hostname,
    protocol: req.protocol,
    secure: req.secure,
    xhr: req.xhr
  });
});

// ==================== REQUEST OBJECT FEATURES ====================

app.get('/demo/request-info', (req, res) => {
  res.json({
    // All request properties
    method: req.method,
    url: req.url,
    path: req.path,
    query: req.query,
    params: req.params,
    headers: req.headers,
    cookies: req.cookies,
    signedCookies: req.signedCookies,
    body: req.body,
    ip: req.ip,
    ips: req.ips,
    hostname: req.hostname,
    protocol: req.protocol,
    secure: req.secure,
    xhr: req.xhr,
    fresh: req.fresh,
    stale: req.stale,
    
    // Custom properties
    id: req.id,
    sessionID: req.sessionID,
    session: req.session,
    
    // Methods demonstration
    get: {
      contentType: req.get('content-type'),
      userAgent: req.get('user-agent'),
      host: req.get('host')
    },
    accepts: {
      json: req.accepts('json'),
      html: req.accepts('html'),
      text: req.accepts('text')
    },
    is: {
      json: req.is('json'),
      html: req.is('html'),
      urlencoded: req.is('urlencoded')
    }
  });
});

// Route parameters
app.get('/demo/params/:id/:action', (req, res) => {
  res.json({
    params: req.params,
    id: req.params.id,
    action: req.params.action
  });
});

// Query string
app.get('/demo/query', (req, res) => {
  res.json({
    query: req.query,
    queryString: buildQueryString(req.query)
  });
});

// ==================== RESPONSE OBJECT FEATURES ====================

// JSON response
app.get('/demo/json', (req, res) => {
  res.json({
    message: 'This is a JSON response',
    timestamp: new Date(),
    data: { foo: 'bar', nested: { value: 123 } }
  });
});

// Send various types
app.get('/demo/send/:type', (req, res) => {
  const { type } = req.params;
  
  switch(type) {
    case 'string':
      res.send('This is a string response');
      break;
    case 'html':
      res.send('<h1>HTML Response</h1><p>This is HTML content</p>');
      break;
    case 'buffer':
      res.send(Buffer.from('This is a buffer response'));
      break;
    case 'number':
      res.status(418).send(418); // I'm a teapot
      break;
    default:
      res.send({ type: 'object', message: 'Default object response' });
  }
});

// Redirect
app.get('/demo/redirect', (req, res) => {
  const { permanent, url } = req.query;
  
  if (url) {
    res.redirect(permanent === 'true' ? 301 : 302, url);
  } else {
    res.redirect('/');
  }
});

// Status codes
app.get('/demo/status/:code', (req, res) => {
  const code = parseInt(req.params.code) || 200;
  res.status(code).json({
    statusCode: code,
    message: `Response with status ${code}`
  });
});

// Headers manipulation
app.get('/demo/headers', (req, res) => {
  res.set('X-Custom-Header', 'Custom Value');
  res.set({
    'X-Multiple-1': 'Value 1',
    'X-Multiple-2': 'Value 2'
  });
  res.append('X-Append', 'First');
  res.append('X-Append', 'Second');
  res.type('application/json');
  
  res.json({
    message: 'Check response headers',
    headers: res.getHeaders()
  });
});

// Content type
app.get('/demo/type/:type', (req, res) => {
  const { type } = req.params;
  res.type(type);
  
  switch(type) {
    case 'json':
      res.send({ message: 'JSON content' });
      break;
    case 'xml':
      res.send('<?xml version="1.0"?><message>XML content</message>');
      break;
    case 'text':
      res.send('Plain text content');
      break;
    case 'html':
      res.send('<h1>HTML content</h1>');
      break;
    default:
      res.send('Default content');
  }
});

// File operations
app.get('/demo/download', (req, res) => {
  const content = 'This is a sample file content for download demonstration.';
  const filename = 'sample.txt';
  
  res.attachment(filename);
  res.send(content);
});

// Streaming response
app.get('/demo/stream', (req, res) => {
  res.type('text/plain');
  
  let counter = 0;
  const interval = setInterval(() => {
    res.write(`Stream chunk ${++counter}\n`);
    
    if (counter >= 5) {
      clearInterval(interval);
      res.end('Stream complete\n');
    }
  }, 1000);
});

// ==================== COOKIE MANAGEMENT ====================

app.get('/cookies/set', (req, res) => {
  // Regular cookie
  res.cookie('regular', 'regular-value', {
    maxAge: 900000,
    httpOnly: false
  });
  
  // HTTP-only cookie
  res.cookie('httponly', 'secure-value', {
    maxAge: 900000,
    httpOnly: true
  });
  
  // Signed cookie
  res.cookie('signed', 'signed-value', {
    maxAge: 900000,
    httpOnly: true,
    signed: true
  });
  
  // Session cookie (no maxAge)
  res.cookie('session', 'session-value');
  
  // Secure cookie (HTTPS only)
  res.cookie('secure', 'secure-value', {
    secure: true,
    sameSite: 'strict'
  });
  
  res.json({
    message: 'Cookies set successfully',
    cookies: {
      regular: 'regular-value',
      httponly: 'secure-value (httpOnly)',
      signed: 'signed-value (signed)',
      session: 'session-value (session)',
      secure: 'secure-value (secure, HTTPS only)'
    }
  });
});

app.get('/cookies/get', (req, res) => {
  res.json({
    cookies: req.cookies,
    signedCookies: req.signedCookies
  });
});

app.get('/cookies/signed', (req, res) => {
  const value = req.signedCookies.signed || 'Not found';
  res.json({
    signed: value,
    valid: value !== 'Not found'
  });
});

app.get('/cookies/clear', (req, res) => {
  res.clearCookie('regular');
  res.clearCookie('httponly');
  res.clearCookie('signed');
  res.clearCookie('session');
  res.clearCookie('secure');
  
  res.json({ message: 'All cookies cleared' });
});

// ==================== SESSION MANAGEMENT ====================

app.get('/session/info', (req, res) => {
  if (!req.session.views) {
    req.session.views = 0;
  }
  req.session.views++;
  
  res.json({
    sessionID: req.sessionID,
    session: req.session,
    views: req.session.views,
    cookie: req.session.cookie,
    isNew: req.session.isNew
  });
});

app.post('/session/data', (req, res) => {
  const { key, value } = req.body;
  
  if (!key) {
    return res.status(400).json({ error: 'Key is required' });
  }
  
  req.session[key] = value;
  
  res.json({
    message: 'Session data stored',
    session: req.session
  });
});

app.delete('/session/destroy', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to destroy session' });
    }
    
    res.clearCookie('velocy.sid');
    res.json({ message: 'Session destroyed' });
  });
});

app.get('/session/regenerate', (req, res) => {
  const oldId = req.sessionID;
  
  req.session.regenerate((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to regenerate session' });
    }
    
    res.json({
      message: 'Session regenerated',
      oldID: oldId,
      newID: req.sessionID
    });
  });
});

// ==================== AUTHENTICATION & AUTHORIZATION ====================

// Middleware for checking authentication
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
};

// Middleware for checking API key
const requireApiKey = (req, res, next) => {
  const apiKey = req.get('X-API-Key');
  
  if (!apiKey || !dataStore.apiKeys.has(apiKey)) {
    return res.status(403).json({ error: 'Valid API key required' });
  }
  
  req.apiKey = dataStore.apiKeys.get(apiKey);
  next();
};

app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  
  // Simple demo authentication
  if (username === 'admin' && password === 'password') {
    req.session.user = {
      username: 'admin',
      role: 'admin',
      loginTime: new Date()
    };
    
    res.json({
      success: true,
      user: req.session.user,
      sessionID: req.sessionID
    });
  } else {
    res.status(401).json({
      error: 'Invalid credentials'
    });
  }
});

app.post('/auth/logout', (req, res) => {
  const user = req.session.user;
  
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    
    res.clearCookie('velocy.sid');
    res.json({
      message: 'Logged out successfully',
      user
    });
  });
});

app.get('/auth/protected', requireAuth, (req, res) => {
  res.json({
    message: 'This is a protected route',
    user: req.session.user
  });
});

app.get('/auth/api-protected', requireApiKey, (req, res) => {
  res.json({
    message: 'This route requires API key',
    apiKey: req.apiKey
  });
});

// ==================== RATE LIMITING ====================

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

const strictLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5, // only 5 requests per minute
  skipSuccessfulRequests: false,
  skipFailedRequests: false
});

app.use('/api/rate-limited', strictLimiter);
app.get('/api/rate-limited', (req, res) => {
  res.json({
    message: 'This endpoint is rate limited',
    remaining: req.rateLimit.remaining,
    limit: req.rateLimit.limit,
    resetTime: new Date(req.rateLimit.resetTime)
  });
});

// ==================== VALIDATION EXAMPLES ====================

// User validation schema
const userSchema = {
  body: {
    name: {
      type: 'string',
      required: true,
      minLength: 2,
      maxLength: 50,
      pattern: /^[a-zA-Z\s]+$/,
      transform: (value) => value.trim()
    },
    email: {
      type: 'email',
      required: true,
      transform: (value) => value.toLowerCase()
    },
    age: {
      type: 'number',
      min: 0,
      max: 150,
      coerce: true
    },
    role: {
      type: 'string',
      enum: ['admin', 'user', 'moderator'],
      default: 'user'
    },
    preferences: {
      type: 'object',
      properties: {
        newsletter: { type: 'boolean', default: false },
        notifications: { type: 'boolean', default: true }
      }
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      minItems: 0,
      maxItems: 10,
      uniqueItems: true
    }
  }
};

app.post('/validate/user', validator(userSchema), (req, res) => {
  res.json({
    message: 'Validation passed',
    data: req.body
  });
});

// Custom validation
app.post('/validate/custom', 
  validator({
    body: {
      password: {
        type: 'string',
        required: true,
        minLength: 8,
        custom: (value) => {
          if (!/[A-Z]/.test(value)) {
            return 'Password must contain at least one uppercase letter';
          }
          if (!/[a-z]/.test(value)) {
            return 'Password must contain at least one lowercase letter';
          }
          if (!/[0-9]/.test(value)) {
            return 'Password must contain at least one number';
          }
          if (!/[!@#$%^&*]/.test(value)) {
            return 'Password must contain at least one special character';
          }
          return true;
        }
      },
      confirmPassword: {
        type: 'string',
        required: true,
        custom: (value, { body }) => {
          if (value !== body.password) {
            return 'Passwords do not match';
          }
          return true;
        }
      }
    }
  }),
  (req, res) => {
    res.json({
      message: 'Password validation passed',
      strength: 'strong'
    });
  }
);

// Async validation
app.post('/validate/async',
  validator({
    body: {
      username: {
        type: 'string',
        required: true,
        minLength: 3,
        custom: async (value) => {
          // Simulate async check (e.g., database lookup)
          await new Promise(resolve => setTimeout(resolve, 100));
          
          if (value === 'admin' || value === 'root') {
            return 'Username is reserved';
          }
          
          // Check if username exists
          const exists = Array.from(dataStore.users.values())
            .some(u => u.name.toLowerCase() === value.toLowerCase());
          
          if (exists) {
            return 'Username already taken';
          }
          
          return true;
        }
      }
    }
  }),
  (req, res) => {
    res.json({
      message: 'Username is available',
      username: req.body.username
    });
  }
);

// ==================== FILE OPERATIONS ====================

// File upload simulation
app.post('/upload', (req, res) => {
  const fileId = crypto.randomBytes(8).toString('hex');
  const file = {
    id: fileId,
    name: req.body.filename || 'unnamed.txt',
    size: req.body.size || 0,
    type: req.get('content-type'),
    uploadedAt: new Date(),
    content: req.body
  };
  
  dataStore.files.set(fileId, file);
  
  res.status(201).json({
    message: 'File uploaded successfully',
    fileId,
    file: {
      id: file.id,
      name: file.name,
      size: file.size,
      type: file.type,
      uploadedAt: file.uploadedAt
    }
  });
});

// File download
app.get('/download/:filename', (req, res) => {
  const { filename } = req.params;
  const file = Array.from(dataStore.files.values())
    .find(f => f.name === filename);
  
  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  res.attachment(file.name);
  res.type(file.type || 'application/octet-stream');
  res.send(file.content);
});

// List files
app.get('/files/list', (req, res) => {
  const files = Array.from(dataStore.files.values()).map(f => ({
    id: f.id,
    name: f.name,
    size: f.size,
    type: f.type,
    uploadedAt: f.uploadedAt
  }));
  
  res.json({ files });
});

// ==================== NESTED ROUTING ====================

// Create a nested router
const nestedRouter = new Router();

nestedRouter.get('/route', (req, res) => {
  res.json({
    message: 'This is a nested route',
    path: req.path,
    baseUrl: req.baseUrl
  });
});

nestedRouter.get('/deep/path', (req, res) => {
  res.json({
    message: 'Deep nested route',
    level: 'nested/sub/deep/path'
  });
});

// Another nested router
const apiV2Router = new Router();

apiV2Router.get('/users', (req, res) => {
  res.json({
    version: 'v2',
    users: Array.from(dataStore.users.values())
  });
});

apiV2Router.get('/info', (req, res) => {
  res.json({
    version: 'v2',
    message: 'API Version 2'
  });
});

// Mount nested routers
app.nest('/nested/sub', nestedRouter);
app.nest('/api/v2', apiV2Router);

// ==================== WILDCARD & CATCH-ALL ROUTES ====================

// Single segment wildcard
app.get('/files/*.pdf', (req, res) => {
  res.json({
    message: 'PDF file route',
    filename: req.params['*'],
    extension: 'pdf'
  });
});

// Pattern matching
app.get('/assets/*.css', (req, res) => {
  res.type('text/css');
  res.send(`/* CSS file: ${req.params['*']} */\nbody { margin: 0; }`);
});

// Multi-segment catch-all
app.get('/catch/**', (req, res) => {
  res.json({
    message: 'Catch-all route',
    caught: req.params['**'],
    fullPath: req.path
  });
});

// ==================== WEBSOCKET IMPLEMENTATION ====================

// Main WebSocket endpoint
app.ws('/ws', (ws, req) => {
  const clientId = crypto.randomBytes(8).toString('hex');
  
  console.log(`WebSocket client connected: ${clientId}`);
  dataStore.websocketClients.set(clientId, ws);
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    clientId,
    message: 'Connected to Velocy WebSocket server',
    timestamp: new Date()
  }));
  
  // Handle messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`WebSocket message from ${clientId}:`, data);
      
      // Store in history
      dataStore.messageHistory.push({
        clientId,
        data,
        timestamp: new Date()
      });
      
      // Echo back
      ws.send(JSON.stringify({
        type: 'echo',
        original: data,
        clientId,
        timestamp: new Date()
      }));
      
      // Broadcast to all clients
      app.wsRouter.broadcast(JSON.stringify({
        type: 'broadcast',
        from: clientId,
        data,
        timestamp: new Date()
      }), { except: ws });
      
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format',
        error: error.message
      }));
    }
  });
  
  // Handle close
  ws.on('close', () => {
    console.log(`WebSocket client disconnected: ${clientId}`);
    dataStore.websocketClients.delete(clientId);
    
    // Notify others
    app.wsRouter.broadcast(JSON.stringify({
      type: 'client_left',
      clientId,
      timestamp: new Date()
    }));
  });
  
  // Handle errors
  ws.on('error', (error) => {
    console.error(`WebSocket error for ${clientId}:`, error);
  });
});

// Room-based chat WebSocket
app.ws('/ws/chat/:room', (ws, req) => {
  const room = req.params.room;
  const userId = crypto.randomBytes(4).toString('hex');
  
  // Join room
  ws.join(room);
  
  // Welcome message
  ws.send(JSON.stringify({
    type: 'joined',
    room,
    userId,
    message: `Welcome to room: ${room}`
  }));
  
  // Notify room
  app.wsRouter.getRoom(room).broadcast(JSON.stringify({
    type: 'user_joined',
    userId,
    room,
    timestamp: new Date()
  }), { except: ws });
  
  // Handle messages
  ws.on('message', (message) => {
    // Broadcast to room
    app.wsRouter.getRoom(room).broadcast(JSON.stringify({
      type: 'chat',
      room,
      userId,
      message: message.toString(),
      timestamp: new Date()
    }));
  });
  
  // Handle disconnect
  ws.on('close', () => {
    ws.leave(room);
    
    app.wsRouter.getRoom(room).broadcast(JSON.stringify({
      type: 'user_left',
      userId,
      room,
      timestamp: new Date()
    }));
  });
});

// Broadcasting endpoint
app.ws('/ws/broadcast', (ws, req) => {
  ws.on('message', (message) => {
    // Broadcast to all WebSocket clients
    app.wsRouter.broadcast(message);
  });
});

// WebSocket statistics
app.get('/api/ws/stats', (req, res) => {
  res.json({
    totalClients: dataStore.websocketClients.size,
    clients: Array.from(dataStore.websocketClients.keys()),
    messageHistory: dataStore.messageHistory.slice(-10), // Last 10 messages
    rooms: app.wsRouter.getRooms()
  });
});

// ==================== PERFORMANCE MONITORING ====================

app.get('/demo/performance', (req, res) => {
  const stats = {
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    cpuUsage: process.cpuUsage(),
    requestsServed: app.getSetting('requestCount') || 0,
    routerCache: {
      enabled: app._cacheEnabled,
      routeCacheSize: app._routeCache ? app._routeCache.size : 0,
      urlCacheSize: app._urlCache ? app._urlCache.size : 0
    },
    performance: {
      enabled: app._performanceEnabled,
      metrics: app._performanceMetrics || {}
    }
  };
  
  res.json(stats);
});

// Track request count
app.use((req, res, next) => {
  const count = app.getSetting('requestCount') || 0;
  app.set('requestCount', count + 1);
  next();
});

// ==================== VIEW ENGINE & TEMPLATING ====================

// Set view engine settings
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'html');

// Enable various settings
app.enable('case sensitive routing');
app.enable('strict routing');
app.enable('trust proxy');
app.enable('x-powered-by');

// Custom view engine for .html files
app.viewEngine.registerEngine('html', (filePath, options, callback) => {
  fs.readFile(filePath, 'utf8')
    .then(content => {
      // Simple template replacement
      let html = content;
      for (const [key, value] of Object.entries(options)) {
        html = html.replace(new RegExp(`{{${key}}}`, 'g'), value);
      }
      callback(null, html);
    })
    .catch(callback);
});

// Render view
app.get('/demo/render', (req, res) => {
  // Since we don't have actual view files, we'll simulate
  const html = `
    <h1>{{title}}</h1>
    <p>{{message}}</p>
    <p>Time: {{time}}</p>
  `;
  
  // Simulate template rendering
  let rendered = html;
  const data = {
    title: 'Velocy Template Engine',
    message: 'This is a rendered view',
    time: new Date().toISOString()
  };
  
  for (const [key, value] of Object.entries(data)) {
    rendered = rendered.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  
  res.type('html').send(rendered);
});

// ==================== ERROR HANDLING ====================

// Custom error class
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
  }
}

// Route that throws an error
app.get('/demo/error', (req, res, next) => {
  next(new AppError('This is a demonstration error', 500));
});

// Async error
app.get('/demo/async-error', async (req, res, next) => {
  try {
    await new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('Async error')), 100);
    });
  } catch (error) {
    next(error);
  }
});

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({
    error: 'Not Found',
    path: req.path,
    method: req.method,
    timestamp: new Date()
  });
});

// Global error handler (4 parameters)
app.useError((err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';
  
  console.error('Error:', err);
  
  res.status(statusCode).json({
    error: message,
    statusCode,
    path: req.path,
    method: req.method,
    timestamp: new Date(),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ==================== FASTROUTER DEMONSTRATION ====================

// FastRouter and SimpleRouter are standalone routers, not nestable
// They're demonstrated here as alternative routing options

// Setup FastRouter endpoints
fastRouter.get('/fast', (req, res) => {
  res.json({ message: 'FastRouter response', router: 'FastRouter' });
});

fastRouter.post('/fast/data', (req, res) => {
  res.json({ received: req.body, router: 'FastRouter' });
});

// FastRouter would be used as the main router instead of Router
// const app = new FastRouter(); // Alternative to Router

// ==================== SIMPLEROUTER DEMONSTRATION ====================

// Setup SimpleRouter endpoints  
simpleRouter.get('/simple', (req, res) => {
  res.json({ message: 'SimpleRouter response', router: 'SimpleRouter' });
});

simpleRouter.get('/simple/:id', (req, res) => {
  res.json({ id: req.params.id, router: 'SimpleRouter' });
});

// SimpleRouter would be used as the main router for simple apps
// const app = new SimpleRouter(); // Alternative to Router

// Create nested Router instances instead
const fastRouterDemo = new Router();
fastRouterDemo.get('/fast', (req, res) => {
  res.json({ message: 'Router emulating FastRouter', router: 'Router' });
});
fastRouterDemo.post('/fast/data', (req, res) => {
  res.json({ received: req.body, router: 'Router' });
});

const simpleRouterDemo = new Router();
simpleRouterDemo.get('/simple', (req, res) => {
  res.json({ message: 'Router emulating SimpleRouter', router: 'Router' });
});
simpleRouterDemo.get('/simple/:id', (req, res) => {
  res.json({ id: req.params.id, router: 'Router' });
});

// Mount the Router instances
app.nest('/fastrouter', fastRouterDemo);
app.nest('/simplerouter', simpleRouterDemo);

// ==================== ADVANCED MIDDLEWARE FEATURES ====================

// Path-specific middleware
app.use('/admin', (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
});

app.get('/admin/dashboard', (req, res) => {
  res.json({
    message: 'Admin dashboard',
    users: dataStore.users.size,
    files: dataStore.files.size,
    sessions: 'Active'
  });
});

// Conditional middleware
const conditionalMiddleware = (condition) => {
  return (req, res, next) => {
    if (condition(req)) {
      console.log('Conditional middleware activated');
      // Do something
    }
    next();
  };
};

app.use(conditionalMiddleware(req => req.query.debug === 'true'));

// ==================== UTILITY FUNCTIONS DEMONSTRATION ====================

app.get('/demo/utils', (req, res) => {
  const queryObject = { foo: 'bar', baz: 123, array: [1, 2, 3] };
  
  res.json({
    buildQueryString: buildQueryString(queryObject),
    websocketUtils: {
      available: typeof websocketUtils === 'object'
    }
  });
});

// ==================== SERVER SETTINGS & LOCALS ====================

// Set application locals
app.locals.title = 'Velocy Example Server';
app.locals.version = '1.0.0';
app.locals.author = 'Velocy Framework';

app.get('/demo/settings', (req, res) => {
  res.json({
    settings: {
      'case sensitive routing': app.enabled('case sensitive routing'),
      'strict routing': app.enabled('strict routing'),
      'trust proxy': app.enabled('trust proxy'),
      'x-powered-by': app.enabled('x-powered-by'),
      'views': app.getSetting('views'),
      'view engine': app.getSetting('view engine')
    },
    locals: app.locals,
    disabled: {
      'etag': app.disabled('etag')
    }
  });
});

// ==================== START SERVER ====================

// Create and start server
const server = createServer(app);

// Print configuration
console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║                                                              ║');
console.log('║           🚀 Velocy Framework - Example Server              ║');
console.log('║                                                              ║');
console.log('║           Demonstrating EVERY Feature Available             ║');
console.log('║                                                              ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

console.log('📋 Configuration:');
console.log('├─ Performance Monitoring: ENABLED');
console.log('├─ Route Caching: ENABLED');
console.log('├─ Session Management: ENABLED');
console.log('├─ WebSocket Server: ENABLED');
console.log('├─ CORS: ENABLED');
console.log('├─ Compression: ENABLED');
console.log('└─ Rate Limiting: ENABLED\n');

console.log('🌳 Route Tree:');
app.printTree();

console.log('\n📊 Router Statistics:');
console.log(`├─ Middleware Stack: ${app.globalMiddleware.length} global`);
console.log(`├─ Nested Routers: 4 (main + 3 nested)`);
console.log(`└─ WebSocket Routes: 3\n`);

// Start listening
server.listen(PORT, () => {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log(`║   🎉 Server is running at http://localhost:${PORT}            ║`);
  console.log('║                                                              ║');
  console.log(`║   📖 Documentation: http://localhost:${PORT}/                ║`);
  console.log(`║   🧪 API Testing: http://localhost:${PORT}/api              ║`);
  console.log(`║   🔌 WebSocket: ws://localhost:${PORT}/ws                   ║`);
  console.log('║                                                              ║');
  console.log('║   Press Ctrl+C to stop the server                           ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down gracefully...');
  
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
  
  // Force exit after 5 seconds
  setTimeout(() => {
    console.error('❌ Forced shutdown');
    process.exit(1);
  }, 5000);
});

module.exports = app;