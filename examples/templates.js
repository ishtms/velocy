/**
 * Velocy Template Engine Example
 * 
 * This example demonstrates how to use Velocy's template engine support.
 * It shows:
 * - Using the built-in simple template engine
 * - Registering custom template engines
 * - Setting up view directories
 * - Using app.locals and res.locals
 * - Rendering views with layouts and partials
 */

const { Router } = require('./lib/core/Router');
const { createServer, ViewEngine } = require('./lib/utils');
const path = require('node:path');
const fs = require('node:fs');

// Create router instance
const app = new Router();

// Configure view settings
app.set('views', path.join(__dirname, 'test-views')); // Set views directory
app.set('view engine', 'html'); // Set default template engine
app.set('view cache', false); // Disable caching for development

// Set application-wide locals (available in all templates)
app.locals.appName = 'Velocy Template Demo';
app.locals.year = new Date().getFullYear();
app.locals.company = 'Velocy Framework';

// Example: Register a custom template engine (similar to EJS)
app.engine('velo', (filePath, data, callback) => {
  fs.readFile(filePath, 'utf8', (err, template) => {
    if (err) return callback(err);
    
    try {
      // Simple template processing: <%= variable %>
      let html = template.replace(/<%=\s*(.+?)\s*%>/g, (match, code) => {
        // Evaluate the code in the context of data
        const keys = Object.keys(data);
        const values = keys.map(k => data[k]);
        const fn = new Function(...keys, `return ${code}`);
        return fn(...values);
      });
      
      // Process JavaScript code blocks: <% code %>
      html = html.replace(/<%\s*([\s\S]+?)\s*%>/g, (match, code) => {
        // For simplicity, we'll just remove code blocks in this example
        return '';
      });
      
      callback(null, html);
    } catch (renderErr) {
      callback(renderErr);
    }
  });
});

// Create test views directory and sample templates
const viewsDir = path.join(__dirname, 'test-views');
if (!fs.existsSync(viewsDir)) {
  fs.mkdirSync(viewsDir, { recursive: true });
}

// Create a simple HTML template
fs.writeFileSync(path.join(viewsDir, 'index.html'), `
<!DOCTYPE html>
<html>
<head>
    <title>{{title}} - {{appName}}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        .info { background: #f0f0f0; padding: 10px; border-radius: 5px; }
        .user-list { list-style-type: none; padding: 0; }
        .user-list li { background: #fff; margin: 5px 0; padding: 10px; border: 1px solid #ddd; }
    </style>
</head>
<body>
    <h1>{{title}}</h1>
    <div class="info">
        <p>Welcome to {{appName}}!</p>
        <p>Message: {{message}}</p>
        <p>Request-specific data: {{requestData}}</p>
    </div>
    
    {{#if showUsers}}
    <h2>Users:</h2>
    <ul class="user-list">
        {{#each users}}
        <li>
            <strong>{{this.name}}</strong> ({{this.email}})
            {{#if @first}}<span style="color: green;"> - First user!</span>{{/if}}
            {{#if @last}}<span style="color: blue;"> - Last user!</span>{{/if}}
        </li>
        {{/each}}
    </ul>
    {{/if}}
    
    <footer>
        <p>&copy; {{year}} {{company}}</p>
    </footer>
</body>
</html>
`);

// Create a custom .velo template
fs.writeFileSync(path.join(viewsDir, 'custom.velo'), `
<!DOCTYPE html>
<html>
<head>
    <title><%= title %></title>
</head>
<body>
    <h1><%= greeting %></h1>
    <p>This is rendered with our custom .velo engine!</p>
    <p>Math example: 2 + 2 = <%= 2 + 2 %></p>
    <p>App name from locals: <%= appName %></p>
</body>
</html>
`);

// Create a JSON template for API responses
fs.writeFileSync(path.join(viewsDir, 'api.html'), `{
  "status": "{{status}}",
  "message": "{{message}}",
  "data": {
    "timestamp": "{{timestamp}}",
    "items": {{itemCount}}
  },
  "app": "{{appName}}"
}`);

// Routes demonstrating template rendering

// Basic template rendering with the built-in engine
app.get('/', (req, res) => {
  // Set request-specific locals
  res.locals.requestData = 'Data specific to this request';
  
  // Render the template with data
  res.render('index', {
    title: 'Home Page',
    message: 'This is rendered using the built-in simple template engine!',
    showUsers: true,
    users: [
      { name: 'Alice', email: 'alice@example.com' },
      { name: 'Bob', email: 'bob@example.com' },
      { name: 'Charlie', email: 'charlie@example.com' }
    ]
  });
});

// Using a custom template engine
app.get('/custom', (req, res) => {
  res.render('custom.velo', {
    title: 'Custom Engine Demo',
    greeting: 'Hello from Velocy!'
  });
});

// Rendering with callback
app.get('/callback', (req, res) => {
  res.render('index', {
    title: 'Callback Example',
    message: 'Rendered with callback',
    showUsers: false
  }, (err, html) => {
    if (err) {
      res.status(500).send('Rendering error: ' + err.message);
    } else {
      // You could modify the HTML here before sending
      const modifiedHtml = html.replace('</body>', '<p>Added by callback!</p></body>');
      res.send(modifiedHtml);
    }
  });
});

// API response template (JSON-like)
app.get('/api/status', (req, res) => {
  res.type('json'); // Set content type before rendering
  res.render('api', {
    status: 'success',
    message: 'System operational',
    timestamp: new Date().toISOString(),
    itemCount: 42
  });
});

// Demonstrate error handling
app.get('/error', (req, res) => {
  // Try to render a non-existent template
  res.render('nonexistent', {
    title: 'This will fail'
  }).catch(err => {
    res.status(500).send(`
      <h1>Template Error</h1>
      <p>${err.message}</p>
    `);
  });
});

// Dynamic template selection
app.get('/dynamic/:template', (req, res) => {
  const templateName = req.params.template;
  
  // Validate template name for security
  if (!/^[a-zA-Z0-9_-]+$/.test(templateName)) {
    return res.status(400).send('Invalid template name');
  }
  
  res.render(templateName, {
    title: `Dynamic: ${templateName}`,
    message: `Rendering template: ${templateName}`,
    showUsers: false
  }).catch(err => {
    res.status(404).send('Template not found: ' + templateName);
  });
});

// Settings management examples
app.get('/settings', (req, res) => {
  const settings = {
    viewEngine: app.getSetting('view engine'),
    views: app.getSetting('views'),
    viewCache: app.getSetting('view cache'),
    cacheEnabled: app.enabled('view cache'),
    appLocals: app.locals
  };
  
  res.json(settings);
});

// Toggle view caching
app.post('/settings/cache/:action', (req, res) => {
  const action = req.params.action;
  
  if (action === 'enable') {
    app.enable('view cache');
    res.send('View caching enabled');
  } else if (action === 'disable') {
    app.disable('view cache');
    res.send('View caching disabled');
  } else {
    res.status(400).send('Invalid action');
  }
});

// Create the server
const server = createServer(app);
const PORT = 3000;

server.listen(PORT, () => {
  console.log(`Template engine example server running at http://localhost:${PORT}`);
  console.log('Routes:');
  console.log('  GET  /          - Basic template with built-in engine');
  console.log('  GET  /custom    - Custom .velo template engine');
  console.log('  GET  /callback  - Rendering with callback');
  console.log('  GET  /api/status - JSON-like template');
  console.log('  GET  /error     - Error handling example');
  console.log('  GET  /dynamic/:template - Dynamic template selection');
  console.log('  GET  /settings  - View current settings');
  console.log('  POST /settings/cache/:action - Enable/disable caching');
  console.log('\nView files created in:', viewsDir);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});