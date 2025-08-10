const { Router, createServer } = require("./index");

// Create router with cookie secret for signed cookies
const router = new Router({ cookieSecret: "my-super-secret-key-12345" });

// Test route to demonstrate cookie functionality
router.get("/", (req, res) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Cookie Test</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            pre { background: #f4f4f4; padding: 10px; border-radius: 5px; }
            .section { margin: 20px 0; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
            h2 { color: #333; }
            .cookie-list { background: #e8f5e9; padding: 10px; border-radius: 5px; margin: 10px 0; }
            .signed-list { background: #e3f2fd; padding: 10px; border-radius: 5px; margin: 10px 0; }
            button { padding: 10px 20px; margin: 5px; cursor: pointer; border: none; border-radius: 5px; }
            .set-btn { background: #4CAF50; color: white; }
            .clear-btn { background: #f44336; color: white; }
        </style>
    </head>
    <body>
        <h1>Velocy Cookie Test Page</h1>
        
        <div class="section">
            <h2>Current Cookies</h2>
            <div class="cookie-list">
                <strong>Regular Cookies:</strong>
                <pre>${JSON.stringify(req.cookies, null, 2)}</pre>
            </div>
            <div class="signed-list">
                <strong>Signed Cookies (Validated):</strong>
                <pre>${JSON.stringify(req.signedCookies, null, 2)}</pre>
            </div>
        </div>
        
        <div class="section">
            <h2>Cookie Actions</h2>
            <p>Click the buttons below to test cookie operations:</p>
            
            <form method="GET" action="/set-cookies" style="display: inline;">
                <button type="submit" class="set-btn">Set Test Cookies</button>
            </form>
            
            <form method="GET" action="/set-signed" style="display: inline;">
                <button type="submit" class="set-btn">Set Signed Cookie</button>
            </form>
            
            <form method="GET" action="/clear-cookies" style="display: inline;">
                <button type="submit" class="clear-btn">Clear All Cookies</button>
            </form>
        </div>
        
        <div class="section">
            <h2>Request Headers</h2>
            <pre>${JSON.stringify(
              {
                Cookie: req.headers.cookie || "(none)",
                "User-Agent": req.headers["user-agent"],
              },
              null,
              2
            )}</pre>
        </div>
    </body>
    </html>
  `;

  res.type("html").send(html);
});

// Route to set various cookies with different options
router.get("/set-cookies", (req, res) => {
  // Set a simple cookie
  res.cookie("theme", "dark", {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
    httpOnly: false, // Allow client-side access for this one
  });

  // Set a session cookie (no maxAge or expires)
  res.cookie("sessionId", "abc123xyz", {
    httpOnly: true, // Default, but being explicit
    secure: false, // Would be true in production with HTTPS
    sameSite: "lax",
  });

  // Set a cookie with special characters
  res.cookie("preferences", JSON.stringify({ lang: "en", timezone: "UTC" }), {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  // Set a cookie with expires date
  const expiresDate = new Date();
  expiresDate.setDate(expiresDate.getDate() + 14); // 14 days from now
  res.cookie("expiresTest", "will-expire-in-14-days", {
    expires: expiresDate,
  });

  res.redirect("/");
});

// Route to set a signed cookie
router.get("/set-signed", (req, res) => {
  // Set a signed cookie for secure session management
  res.cookie(
    "userSession",
    JSON.stringify({
      userId: 42,
      username: "testuser",
      role: "admin",
    }),
    {
      signed: true,
      httpOnly: true,
      secure: false, // Would be true in production
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    }
  );

  // Also set a regular cookie for comparison
  res.cookie("lastVisit", new Date().toISOString(), {
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  res.redirect("/");
});

// Route to clear all cookies
router.get("/clear-cookies", (req, res) => {
  // Clear regular cookies
  res.clearCookie("theme");
  res.clearCookie("sessionId");
  res.clearCookie("preferences");
  res.clearCookie("expiresTest");
  res.clearCookie("lastVisit");

  // Clear signed cookie
  res.clearCookie("userSession");

  res.redirect("/");
});

// API endpoint to test JSON response with cookies
router.get("/api/test", (req, res) => {
  // Set an API token cookie
  res.cookie("apiToken", "token-" + Date.now(), {
    signed: true,
    httpOnly: true,
    sameSite: "strict",
    maxAge: 60 * 60 * 1000, // 1 hour
  });

  res.json({
    message: "API test endpoint",
    cookies: req.cookies,
    signedCookies: req.signedCookies,
    timestamp: new Date().toISOString(),
  });
});

// Test route for tampering detection
router.get("/tamper-test", (req, res) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Cookie Tampering Test</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .warning { background: #ffebee; color: #c62828; padding: 10px; border-radius: 5px; margin: 10px 0; }
            .success { background: #e8f5e9; color: #2e7d32; padding: 10px; border-radius: 5px; margin: 10px 0; }
            code { background: #f5f5f5; padding: 2px 5px; border-radius: 3px; }
        </style>
    </head>
    <body>
        <h1>Cookie Tampering Detection Test</h1>
        
        <p>This page demonstrates how signed cookies protect against tampering.</p>
        
        <h2>Instructions:</h2>
        <ol>
            <li>First, <a href="/set-signed">set a signed cookie</a></li>
            <li>Check that the signed cookie appears in the "Signed Cookies" section on the <a href="/">main page</a></li>
            <li>Open browser DevTools and manually edit the <code>userSession</code> cookie value</li>
            <li>Refresh the <a href="/">main page</a> - the tampered cookie should now appear in "Regular Cookies" instead of "Signed Cookies"</li>
        </ol>
        
        <div class="warning">
            <strong>Security Note:</strong> When a signed cookie's signature doesn't match, it's treated as an unsigned cookie.
            This prevents attackers from forging secure session data.
        </div>
        
        <div class="success">
            <strong>Current Status:</strong><br>
            Signed cookies validated: ${Object.keys(req.signedCookies).length}<br>
            Regular cookies: ${Object.keys(req.cookies).length}
        </div>
        
        <p><a href="/">Back to main page</a></p>
    </body>
    </html>
  `;

  res.type("html").send(html);
});

// Create and start server
const server = createServer(router);
const PORT = 3000;

server.listen(PORT, () => {
  console.log(`
Cookie Test Server Running!
===========================
Visit: http://localhost:${PORT}

Available endpoints:
- GET /              - Main page showing all cookies
- GET /set-cookies   - Set various test cookies
- GET /set-signed    - Set a signed cookie
- GET /clear-cookies - Clear all cookies
- GET /api/test      - JSON API endpoint with cookies
- GET /tamper-test   - Instructions for testing tamper detection

Cookie features demonstrated:
- Regular cookie parsing (req.cookies)
- Signed cookie validation (req.signedCookies)
- Cookie setting with various options
- Secure HMAC-SHA256 signing
- Cookie clearing
- HttpOnly flag (default: true for security)
- SameSite attribute support
- MaxAge and Expires support
- Special character handling
- Tamper detection for signed cookies
  `);
});
