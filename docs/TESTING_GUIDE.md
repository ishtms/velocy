# Velocy Testing Guide

## Table of Contents

- [Overview](#overview)
- [Unit Testing](#unit-testing)
- [Integration Testing](#integration-testing)
- [End-to-End Testing](#end-to-end-testing)
- [WebSocket Testing](#websocket-testing)
- [Middleware Testing](#middleware-testing)
- [Performance Testing](#performance-testing)
- [Test Utilities](#test-utilities)
- [Best Practices](#best-practices)

---

## Overview

This guide covers testing strategies and techniques for Velocy applications, including unit tests, integration tests, and end-to-end tests.

### Testing Setup

```bash
# Install testing dependencies
npm install --save-dev jest supertest @types/jest

# For WebSocket testing
npm install --save-dev ws

# For browser testing
npm install --save-dev playwright
```

### Test Structure

```
project/
├── src/           # Application code
├── tests/
│   ├── unit/      # Unit tests
│   ├── integration/ # Integration tests
│   ├── e2e/       # End-to-end tests
│   └── fixtures/  # Test data and utilities
└── jest.config.js # Jest configuration
```

---

## Unit Testing

### Testing Route Handlers

```javascript
// src/handlers/users.js
const getUser = (req, res) => {
  const { id } = req.params
  const user = findUserById(id)
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' })
  }
  
  res.json(user)
}

// tests/unit/handlers/users.test.js
describe('User Handlers', () => {
  describe('getUser', () => {
    it('should return user when found', () => {
      const req = { params: { id: '1' } }
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      }
      
      getUser(req, res)
      
      expect(res.json).toHaveBeenCalledWith({
        id: '1',
        name: 'John Doe'
      })
    })
    
    it('should return 404 when user not found', () => {
      const req = { params: { id: '999' } }
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis()
      }
      
      getUser(req, res)
      
      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({
        error: 'User not found'
      })
    })
  })
})
```

### Testing Middleware

```javascript
// src/middleware/auth.js
const authenticate = (req, res, next) => {
  const token = req.headers.authorization
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' })
  }
  
  try {
    const decoded = verifyToken(token)
    req.user = decoded
    next()
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' })
  }
}

// tests/unit/middleware/auth.test.js
describe('Authentication Middleware', () => {
  it('should call next() with valid token', () => {
    const req = {
      headers: { authorization: 'valid-token' }
    }
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    }
    const next = jest.fn()
    
    authenticate(req, res, next)
    
    expect(next).toHaveBeenCalled()
    expect(req.user).toBeDefined()
  })
  
  it('should return 401 with no token', () => {
    const req = { headers: {} }
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    }
    const next = jest.fn()
    
    authenticate(req, res, next)
    
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({
      error: 'No token provided'
    })
    expect(next).not.toHaveBeenCalled()
  })
})
```

### Testing Utilities

```javascript
// src/utils/validation.js
const validateEmail = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return regex.test(email)
}

const validatePassword = (password) => {
  return password.length >= 8 &&
         /[A-Z]/.test(password) &&
         /[a-z]/.test(password) &&
         /[0-9]/.test(password)
}

// tests/unit/utils/validation.test.js
describe('Validation Utils', () => {
  describe('validateEmail', () => {
    it('should validate correct emails', () => {
      expect(validateEmail('user@example.com')).toBe(true)
      expect(validateEmail('test.user@domain.co.uk')).toBe(true)
    })
    
    it('should reject invalid emails', () => {
      expect(validateEmail('invalid')).toBe(false)
      expect(validateEmail('@example.com')).toBe(false)
      expect(validateEmail('user@')).toBe(false)
    })
  })
  
  describe('validatePassword', () => {
    it('should validate strong passwords', () => {
      expect(validatePassword('Test1234')).toBe(true)
      expect(validatePassword('SecureP@ss1')).toBe(true)
    })
    
    it('should reject weak passwords', () => {
      expect(validatePassword('weak')).toBe(false)
      expect(validatePassword('12345678')).toBe(false)
      expect(validatePassword('NoNumbers')).toBe(false)
    })
  })
})
```

---

## Integration Testing

### Testing with Supertest

```javascript
// tests/integration/api.test.js
const request = require('supertest')
const { Router, createServer } = require('velocy')
const { bodyParser } = require('velocy/middleware')

describe('API Integration Tests', () => {
  let server
  let app
  
  beforeEach(() => {
    app = new Router()
    app.use(bodyParser())
    
    // Setup routes
    app.get('/api/health', (req, res) => {
      res.json({ status: 'ok' })
    })
    
    app.post('/api/users', (req, res) => {
      const { name, email } = req.body
      
      if (!name || !email) {
        return res.status(400).json({ error: 'Missing fields' })
      }
      
      res.status(201).json({ id: 1, name, email })
    })
    
    server = createServer(app)
  })
  
  afterEach((done) => {
    server.close(done)
  })
  
  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const response = await request(server)
        .get('/api/health')
        .expect(200)
      
      expect(response.body).toEqual({ status: 'ok' })
    })
  })
  
  describe('POST /api/users', () => {
    it('should create user with valid data', async () => {
      const userData = {
        name: 'John Doe',
        email: 'john@example.com'
      }
      
      const response = await request(server)
        .post('/api/users')
        .send(userData)
        .expect(201)
      
      expect(response.body).toMatchObject({
        id: expect.any(Number),
        name: userData.name,
        email: userData.email
      })
    })
    
    it('should return 400 with missing fields', async () => {
      const response = await request(server)
        .post('/api/users')
        .send({ name: 'John' })
        .expect(400)
      
      expect(response.body).toEqual({
        error: 'Missing fields'
      })
    })
  })
})
```

### Testing with Database

```javascript
// tests/integration/database.test.js
const request = require('supertest')
const { Router, createServer } = require('velocy')
const { setupDatabase, teardownDatabase, User } = require('../fixtures/db')

describe('Database Integration', () => {
  let server
  let app
  
  beforeAll(async () => {
    await setupDatabase()
  })
  
  afterAll(async () => {
    await teardownDatabase()
  })
  
  beforeEach(() => {
    app = new Router()
    
    app.get('/api/users/:id', async (req, res) => {
      try {
        const user = await User.findById(req.params.id)
        if (!user) {
          return res.status(404).json({ error: 'User not found' })
        }
        res.json(user)
      } catch (err) {
        res.status(500).json({ error: err.message })
      }
    })
    
    server = createServer(app)
  })
  
  afterEach(async () => {
    await User.deleteMany({})
    server.close()
  })
  
  it('should fetch user from database', async () => {
    const user = await User.create({
      name: 'Test User',
      email: 'test@example.com'
    })
    
    const response = await request(server)
      .get(`/api/users/${user.id}`)
      .expect(200)
    
    expect(response.body).toMatchObject({
      name: 'Test User',
      email: 'test@example.com'
    })
  })
})
```

---

## End-to-End Testing

### Using Playwright

```javascript
// tests/e2e/app.test.js
const { test, expect } = require('@playwright/test')

test.describe('Application E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000')
  })
  
  test('should display homepage', async ({ page }) => {
    await expect(page).toHaveTitle('Velocy App')
    await expect(page.locator('h1')).toContainText('Welcome')
  })
  
  test('should navigate to login', async ({ page }) => {
    await page.click('text=Login')
    await expect(page).toHaveURL('/login')
    
    // Fill login form
    await page.fill('input[name="username"]', 'testuser')
    await page.fill('input[name="password"]', 'password123')
    await page.click('button[type="submit"]')
    
    // Check redirect
    await expect(page).toHaveURL('/dashboard')
    await expect(page.locator('.user-name')).toContainText('testuser')
  })
  
  test('should perform API request', async ({ page }) => {
    // Intercept API call
    await page.route('/api/users', route => {
      route.fulfill({
        status: 200,
        body: JSON.stringify([
          { id: 1, name: 'User 1' },
          { id: 2, name: 'User 2' }
        ])
      })
    })
    
    await page.click('text=Load Users')
    
    // Check users displayed
    await expect(page.locator('.user-list li')).toHaveCount(2)
  })
})
```

### Testing Full Application Flow

```javascript
// tests/e2e/workflow.test.js
const { test, expect } = require('@playwright/test')

test.describe('User Workflow', () => {
  test('complete user registration flow', async ({ page }) => {
    // Navigate to registration
    await page.goto('http://localhost:3000/register')
    
    // Fill registration form
    await page.fill('input[name="email"]', 'new@example.com')
    await page.fill('input[name="password"]', 'SecurePass123')
    await page.fill('input[name="confirmPassword"]', 'SecurePass123')
    await page.check('input[name="terms"]')
    
    // Submit form
    await page.click('button[type="submit"]')
    
    // Wait for redirect
    await page.waitForURL('/welcome')
    
    // Verify welcome message
    await expect(page.locator('.welcome-message'))
      .toContainText('Welcome, new@example.com')
    
    // Verify email sent
    const emailSent = await page.evaluate(() => {
      return window.emailService.lastEmail
    })
    expect(emailSent.to).toBe('new@example.com')
    expect(emailSent.subject).toBe('Welcome to Velocy')
  })
})
```

---

## WebSocket Testing

### Testing WebSocket Connections

```javascript
// tests/integration/websocket.test.js
const WebSocket = require('ws')
const { Router, createServer } = require('velocy')

describe('WebSocket Tests', () => {
  let server
  let app
  let ws
  
  beforeEach((done) => {
    app = new Router()
    
    app.ws('/ws/echo', (ws, req) => {
      ws.on('message', (msg) => {
        ws.send(`Echo: ${msg}`)
      })
    })
    
    app.ws('/ws/broadcast', (ws, req) => {
      ws.join('test-room')
      
      ws.on('message', (msg) => {
        ws.broadcast(msg, 'test-room')
      })
    })
    
    server = createServer(app)
    server.listen(3001, done)
  })
  
  afterEach((done) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close()
    }
    server.close(done)
  })
  
  test('should echo messages', (done) => {
    ws = new WebSocket('ws://localhost:3001/ws/echo')
    
    ws.on('open', () => {
      ws.send('Hello')
    })
    
    ws.on('message', (data) => {
      expect(data.toString()).toBe('Echo: Hello')
      done()
    })
  })
  
  test('should broadcast to room', (done) => {
    const ws1 = new WebSocket('ws://localhost:3001/ws/broadcast')
    const ws2 = new WebSocket('ws://localhost:3001/ws/broadcast')
    
    let connectedCount = 0
    let messageCount = 0
    
    const checkConnected = () => {
      connectedCount++
      if (connectedCount === 2) {
        ws1.send('Broadcast message')
      }
    }
    
    ws1.on('open', checkConnected)
    ws2.on('open', checkConnected)
    
    ws2.on('message', (data) => {
      expect(data.toString()).toBe('Broadcast message')
      messageCount++
      
      if (messageCount === 1) {
        ws1.close()
        ws2.close()
        done()
      }
    })
  })
})
```

### Testing WebSocket with Mock Client

```javascript
// tests/unit/websocket.test.js
class MockWebSocket {
  constructor() {
    this.messages = []
    this.rooms = new Set()
    this.listeners = {}
  }
  
  on(event, handler) {
    this.listeners[event] = handler
  }
  
  send(data) {
    this.messages.push(data)
  }
  
  join(room) {
    this.rooms.add(room)
  }
  
  broadcast(data, room) {
    // Mock broadcast
  }
  
  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event](data)
    }
  }
}

describe('WebSocket Handler', () => {
  test('should handle chat messages', () => {
    const ws = new MockWebSocket()
    const req = { query: { username: 'testuser' } }
    
    // Call your WebSocket handler
    chatHandler(ws, req)
    
    // Simulate message
    ws.emit('message', JSON.stringify({
      type: 'chat',
      text: 'Hello world'
    }))
    
    // Check response
    expect(ws.messages).toHaveLength(1)
    const response = JSON.parse(ws.messages[0])
    expect(response.type).toBe('chat')
    expect(response.from).toBe('testuser')
    expect(response.text).toBe('Hello world')
  })
})
```

---

## Middleware Testing

### Testing Custom Middleware

```javascript
// tests/integration/middleware.test.js
const request = require('supertest')
const { Router, createServer } = require('velocy')

describe('Middleware Integration', () => {
  let server
  let app
  
  beforeEach(() => {
    app = new Router()
    
    // Custom logging middleware
    app.use((req, res, next) => {
      req.startTime = Date.now()
      next()
    })
    
    // Custom response time middleware
    app.use((req, res, next) => {
      const originalEnd = res.end
      res.end = function(...args) {
        const duration = Date.now() - req.startTime
        res.setHeader('X-Response-Time', `${duration}ms`)
        originalEnd.apply(res, args)
      }
      next()
    })
    
    app.get('/test', (req, res) => {
      res.json({ message: 'test' })
    })
    
    server = createServer(app)
  })
  
  test('should add response time header', async () => {
    const response = await request(server)
      .get('/test')
      .expect(200)
    
    expect(response.headers['x-response-time']).toMatch(/\d+ms/)
  })
})
```

### Testing Middleware Order

```javascript
describe('Middleware Order', () => {
  test('should execute middleware in correct order', async () => {
    const app = new Router()
    const order = []
    
    app.use((req, res, next) => {
      order.push('first')
      next()
    })
    
    app.use((req, res, next) => {
      order.push('second')
      next()
    })
    
    app.get('/test', (req, res) => {
      order.push('handler')
      res.json({ order })
    })
    
    const server = createServer(app)
    
    const response = await request(server)
      .get('/test')
      .expect(200)
    
    expect(response.body.order).toEqual(['first', 'second', 'handler'])
    
    server.close()
  })
})
```

---

## Performance Testing

### Load Testing

```javascript
// tests/performance/load.test.js
const autocannon = require('autocannon')
const { Router, createServer } = require('velocy')

describe('Performance Tests', () => {
  let server
  
  beforeAll((done) => {
    const app = new Router()
    
    app.get('/api/test', (req, res) => {
      res.json({ message: 'test' })
    })
    
    server = createServer(app)
    server.listen(3002, done)
  })
  
  afterAll((done) => {
    server.close(done)
  })
  
  test('should handle high load', (done) => {
    const instance = autocannon({
      url: 'http://localhost:3002/api/test',
      connections: 100,
      duration: 10,
      pipelining: 1
    }, (err, result) => {
      expect(err).toBeNull()
      expect(result.errors).toBe(0)
      expect(result.timeouts).toBe(0)
      expect(result.requests.average).toBeGreaterThan(10000)
      done()
    })
  })
})
```

### Memory Testing

```javascript
// tests/performance/memory.test.js
describe('Memory Usage', () => {
  test('should not leak memory', async () => {
    const app = new Router()
    const iterations = 10000
    
    app.get('/test', (req, res) => {
      res.json({ data: 'x'.repeat(1000) })
    })
    
    const server = createServer(app)
    
    // Get initial memory
    global.gc() // Requires --expose-gc flag
    const initialMemory = process.memoryUsage().heapUsed
    
    // Make many requests
    for (let i = 0; i < iterations; i++) {
      await request(server)
        .get('/test')
        .expect(200)
    }
    
    // Check memory after requests
    global.gc()
    const finalMemory = process.memoryUsage().heapUsed
    const memoryIncrease = finalMemory - initialMemory
    
    // Memory increase should be minimal
    expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024) // 10MB
    
    server.close()
  })
})
```

---

## Test Utilities

### Test Helpers

```javascript
// tests/helpers/auth.js
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET || 'test-secret')
}

const authenticatedRequest = (request) => {
  const token = generateToken('test-user-id')
  return request.set('Authorization', `Bearer ${token}`)
}

module.exports = { generateToken, authenticatedRequest }

// Usage
const { authenticatedRequest } = require('../helpers/auth')

test('should access protected route', async () => {
  const response = await authenticatedRequest(
    request(server).get('/api/protected')
  ).expect(200)
})
```

### Test Fixtures

```javascript
// tests/fixtures/users.js
const testUsers = [
  {
    id: 1,
    name: 'Alice',
    email: 'alice@example.com',
    role: 'admin'
  },
  {
    id: 2,
    name: 'Bob',
    email: 'bob@example.com',
    role: 'user'
  }
]

const createTestUser = (overrides = {}) => ({
  id: Math.random(),
  name: 'Test User',
  email: 'test@example.com',
  role: 'user',
  ...overrides
})

module.exports = { testUsers, createTestUser }
```

### Database Utilities

```javascript
// tests/fixtures/db.js
const setupDatabase = async () => {
  // Connect to test database
  await mongoose.connect('mongodb://localhost/velocy-test')
  
  // Clear database
  await mongoose.connection.db.dropDatabase()
  
  // Seed data
  await User.create(testUsers)
}

const teardownDatabase = async () => {
  await mongoose.connection.close()
}

const clearCollection = async (modelName) => {
  await mongoose.model(modelName).deleteMany({})
}

module.exports = { setupDatabase, teardownDatabase, clearCollection }
```

---

## Best Practices

### 1. Test Organization

```javascript
// Group related tests
describe('UserController', () => {
  describe('GET /users', () => {
    test('should return all users', () => {})
    test('should filter by role', () => {})
    test('should paginate results', () => {})
  })
  
  describe('POST /users', () => {
    test('should create user', () => {})
    test('should validate input', () => {})
  })
})
```

### 2. Use Descriptive Test Names

```javascript
// ❌ Bad
test('test user', () => {})

// ✅ Good
test('should return 404 when user does not exist', () => {})
test('should create user with valid email and password', () => {})
```

### 3. Test Isolation

```javascript
// Each test should be independent
beforeEach(() => {
  // Reset state
  users = []
  mockDatabase.clear()
})

afterEach(() => {
  // Cleanup
  jest.clearAllMocks()
})
```

### 4. Test Coverage

```javascript
// jest.config.js
module.exports = {
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageThresholds: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
}
```

### 5. Async Testing

```javascript
// Use async/await for cleaner async tests
test('should fetch data', async () => {
  const data = await fetchData()
  expect(data).toBeDefined()
})

// Or return promises
test('should fetch data', () => {
  return fetchData().then(data => {
    expect(data).toBeDefined()
  })
})
```

### 6. Mock External Dependencies

```javascript
// Mock external services
jest.mock('../services/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true })
}))

const { sendEmail } = require('../services/email')

test('should send welcome email', async () => {
  await registerUser({ email: 'test@example.com' })
  
  expect(sendEmail).toHaveBeenCalledWith({
    to: 'test@example.com',
    subject: 'Welcome'
  })
})
```

### 7. Test Error Cases

```javascript
test('should handle network errors', async () => {
  // Mock network error
  jest.spyOn(global, 'fetch').mockRejectedValue(
    new Error('Network error')
  )
  
  await expect(fetchUserData()).rejects.toThrow('Network error')
})
```

### 8. Use Test Doubles Appropriately

```javascript
// Stub - Provides canned answers
const stub = jest.fn().mockReturnValue('stubbed value')

// Spy - Records calls
const spy = jest.spyOn(object, 'method')

// Mock - Replaces entire module
jest.mock('./module')
```

---

## Testing Configuration

### Jest Configuration

```javascript
// jest.config.js
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/index.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 10000
}
```

### Test Scripts

```json
// package.json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:unit": "jest tests/unit",
    "test:integration": "jest tests/integration",
    "test:e2e": "playwright test",
    "test:performance": "jest tests/performance"
  }
}
```

### CI/CD Integration

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v2
    
    - name: Setup Node.js
      uses: actions/setup-node@v2
      with:
        node-version: '16'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run tests
      run: npm test
    
    - name: Upload coverage
      uses: codecov/codecov-action@v2
      with:
        file: ./coverage/lcov.info
```

---

## Summary

Key testing principles for Velocy applications:

1. **Test at multiple levels**: Unit, integration, and E2E
2. **Isolate tests**: Each test should be independent
3. **Mock external dependencies**: Don't rely on external services
4. **Test error cases**: Not just happy paths
5. **Use descriptive names**: Tests document behavior
6. **Maintain test coverage**: Aim for 80%+ coverage
7. **Automate testing**: Integrate with CI/CD
8. **Performance test**: Ensure scalability

Remember: Good tests enable confident refactoring and deployment!