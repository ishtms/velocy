# Velocy Documentation

Welcome to the comprehensive documentation for Velocy - a blazing fast, zero-dependency HTTP framework for Node.js.

## 📚 Documentation Index

### Getting Started

- **[Getting Started Guide](./GETTING_STARTED.md)** - Quick start guide for new users
- **[Installation & Setup](./GETTING_STARTED.md#installation)** - How to install and configure Velocy
- **[Hello World Example](./GETTING_STARTED.md#hello-world)** - Your first Velocy application

### Core Documentation

- **[API Reference](./API_REFERENCE.md)** - Complete API documentation for all classes and methods
- **[Architecture Overview](./ARCHITECTURE.md)** - Deep dive into Velocy's internal architecture
- **[Router Comparison Guide](./ROUTER_COMPARISON.md)** - Choose between FastRouter, SimpleRouter, and Router

### Feature Guides

- **[Middleware Guide](./MIDDLEWARE_GUIDE.md)** - Comprehensive guide to built-in and custom middleware
- **[WebSocket Documentation](./WEBSOCKET.md)** - Real-time communication with WebSockets
- **[Static Files Documentation](./STATIC_MIDDLEWARE.md)** - Serving static files efficiently
- **[Body Parser Documentation](./middleware-bodyparser.md)** - Parsing request bodies

### Performance & Optimization

- **[Performance Guide](./PERFORMANCE.md)** - Optimization strategies and benchmarks
- **[Zero-Cost Abstractions](./PERFORMANCE.md#zero-cost-abstractions)** - Understanding Velocy's performance model
- **[Benchmark Results](./PERFORMANCE.md#benchmark-results)** - Performance comparisons

### Testing & Development

- **[Testing Guide](./TESTING_GUIDE.md)** - Comprehensive testing strategies
- **[Unit Testing](./TESTING_GUIDE.md#unit-testing)** - Testing individual components
- **[Integration Testing](./TESTING_GUIDE.md#integration-testing)** - Testing component interactions
- **[E2E Testing](./TESTING_GUIDE.md#end-to-end-testing)** - Full application testing

### Migration Guides

- **[Migrating from Express](./MIGRATION_EXPRESS.md)** - Step-by-step Express.js migration guide
- **[API Differences](./MIGRATION_EXPRESS.md#api-differences)** - Key differences from Express
- **[Migration Checklist](./MIGRATION_EXPRESS.md#migration-checklist)** - Complete migration steps

## 🚀 Quick Links

### By Use Case

#### Building a REST API

1. [Choose your router](./ROUTER_COMPARISON.md) (FastRouter for max performance)
2. [Set up routing](./API_REFERENCE.md#routing)
3. [Add body parsing](./middleware-bodyparser.md)
4. [Implement CRUD operations](./GETTING_STARTED.md#basic-routing)
5. [Add authentication](./MIDDLEWARE_GUIDE.md#custom-middleware)

#### Building a Web Application

1. [Use full Router](./ROUTER_COMPARISON.md#router-full-featured)
2. [Configure middleware](./MIDDLEWARE_GUIDE.md)
3. [Set up sessions](./MIDDLEWARE_GUIDE.md#session-management)
4. [Serve static files](./STATIC_MIDDLEWARE.md)
5. [Add WebSocket support](./WEBSOCKET.md)

#### Microservices

1. [Use FastRouter](./ROUTER_COMPARISON.md#fastrouter)
2. [Minimal overhead routing](./PERFORMANCE.md#fastrouter-minimal-overhead)
3. [Health checks](./GETTING_STARTED.md#basic-routing)
4. [Performance monitoring](./API_REFERENCE.md#performance)

#### Real-time Applications

1. [WebSocket setup](./WEBSOCKET.md#quick-start)
2. [Room management](./WEBSOCKET.md#room-management)
3. [Broadcasting](./WEBSOCKET.md#broadcasting)
4. [Client integration](./WEBSOCKET.md#browser-client-example)

## 📖 Documentation Structure

```
docs/
├── README.md                   # This file - Documentation index
├── GETTING_STARTED.md          # Quick start and basics
├── API_REFERENCE.md            # Complete API documentation
├── ARCHITECTURE.md             # System architecture
├── ROUTER_COMPARISON.md        # Router selection guide
├── MIDDLEWARE_GUIDE.md         # Middleware documentation
├── WEBSOCKET.md               # WebSocket features
├── PERFORMANCE.md             # Performance optimization
├── TESTING_GUIDE.md           # Testing strategies
├── MIGRATION_EXPRESS.md       # Express migration guide
├── STATIC_MIDDLEWARE.md       # Static file serving
└── middleware-bodyparser.md   # Body parser details
```

## 🎯 Key Features

### Zero Dependencies

- No external dependencies
- No security vulnerabilities from third-party packages
- Smaller installation size
- Faster installation time

### Performance First

- **FastRouter**: 55,000+ requests/second
- **SimpleRouter**: 50,000+ requests/second
- **Router**: 41,000+ requests/second
- Lazy loading of features
- Optimized route matching

### Full Feature Set

- HTTP routing with parameters
- Middleware system
- WebSocket support
- Template rendering
- Cookie handling
- Session management
- Static file serving
- Body parsing
- CORS support
- Compression
- Rate limiting

### Developer Experience

- Express-compatible API
- Comprehensive documentation
- TypeScript support
- Extensive examples
- Easy migration path

## 💡 Common Patterns

### Basic API Server

```javascript
const { FastRouter } = require("velocy");
const app = new FastRouter();

app.get("/api/health", (req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end('{"status":"ok"}');
});

require("http")
  .createServer((req, res) => {
    app.handleRequest(req, res);
  })
  .listen(3000);
```

### Full-Featured Application

```javascript
const { Router, createServer } = require("velocy");
const { bodyParser, session, cors } = require("velocy/middleware");

const app = new Router();

app.use(cors());
app.use(bodyParser());
app.use(session({ secret: "secret" }));

app.get("/", (req, res) => {
  res.render("index", { user: req.session.user });
});

app.ws("/socket", (ws, req) => {
  ws.on("message", (msg) => ws.send(`Echo: ${msg}`));
});

createServer(app).listen(3000);
```

## 📊 Performance Comparison

| Framework        | Use Case              | Performance   | Latency | Transfer Rate |
| ---------------- | --------------------- | ------------- | ------- | ------------- |
| **Velocy**       | High-performance APIs | 91,330 req/s  | 1.40ms  | 16.11 MB/Sec  |
| **Express**      | Traditional Node.js   | 16,438 req/s  | 7.78ms  | 3.76 MB/Sec   |

**Velocy is 5.56x faster than Express** with significantly lower latency and higher throughput.

## 🔧 Configuration Examples

### Development Configuration

```javascript
const app = new Router({
  cache: false, // Disable caching for development
  performance: true, // Enable performance monitoring
  cookieSecret: "dev", // Simple secret for development
});
```

### Production Configuration

```javascript
const app = new Router({
  cache: true, // Enable route caching
  routeCacheSize: 5000, // Large cache for production
  performance: false, // Disable monitoring overhead
  cookieSecret: process.env.SECRET, // Secure secret
  trustProxy: true, // Behind reverse proxy
});
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](../CONTRIBUTING.md) for details.

### Areas for Contribution

- Additional middleware
- Performance improvements
- Documentation improvements
- Example applications
- Test coverage
- Bug fixes

## 📝 License

Velocy is MIT licensed. See [LICENSE](../LICENSE) for details.

## 🔗 Resources

### Official Resources

- [GitHub Repository](https://github.com/velocy/velocy)
- [NPM Package](https://www.npmjs.com/package/velocy)
- [Issue Tracker](https://github.com/velocy/velocy/issues)

### Community

- [Discussions](https://github.com/velocy/velocy/discussions)
- [Stack Overflow](https://stackoverflow.com/questions/tagged/velocy)

### Examples

#### Server Implementation

- **[Example Server](../example_server.js)** - Comprehensive reference implementation
  - Demonstrates EVERY feature of the Velocy framework
  - Shows all HTTP methods (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
  - Advanced middleware patterns and custom validators
  - Multiple router types (Router, FastRouter, SimpleRouter)
  - Room-based WebSocket implementation
  - View engine integration with templating
  - Performance monitoring and metrics
  - Educational comments throughout
  - Ideal for learning advanced patterns and capabilities

- [Example Applications](../examples/)
- [Benchmarks](../benchmarks/)

## ❓ FAQ

### Which router should I use?

- **FastRouter**: For maximum performance with basic routing
- **SimpleRouter**: For REST APIs with middleware support
- **Router**: For full-featured web applications

### How do I migrate from Express?

See our comprehensive [Express Migration Guide](./MIGRATION_EXPRESS.md).

### Is Velocy production-ready?

Yes! Velocy is used in production by various companies for APIs and web applications.

### How does Velocy achieve zero dependencies?

Velocy is built entirely using Node.js built-in modules (http, fs, crypto, etc.).

### Can I use Express middleware?

Some Express middleware works directly, others may need adaptation. See [Middleware Guide](./MIDDLEWARE_GUIDE.md).

### Does Velocy support TypeScript?

Yes! TypeScript definitions are included.

## 📞 Support

- **Documentation**: You're here!
- **GitHub Issues**: [Report bugs](https://github.com/velocy/velocy/issues)
- **Discussions**: [Ask questions](https://github.com/velocy/velocy/discussions)

---

<div align="center">
  <strong>Built with ❤️ for the Node.js community</strong>
  <br>
  <em>Fast • Simple • Secure • Zero Dependencies</em>
</div>
