const { Router, createServer, buildQueryString } = require("./lib/velocy");

// Create a new router
const router = new Router();

// Test route that demonstrates enhanced query parsing
router.get("/test-query", (req, res) => {
  console.log("=== Enhanced Query Parsing Test ===");
  console.log("Raw URL:", req.url);
  console.log("Parsed query:", JSON.stringify(req.query, null, 2));
  
  res.json({
    query: req.query,
    url: req.url
  });
});

// Test route for demonstrating the query builder
router.get("/test-builder", (req, res) => {
  const testObjects = [
    // Simple object
    { name: "John", age: 30 },
    
    // Nested object
    { 
      user: { 
        name: "Jane", 
        age: 25,
        preferences: {
          theme: "dark",
          lang: "en"
        }
      } 
    },
    
    // Arrays with brackets notation
    { 
      tags: ["javascript", "node", "express"],
      ids: [1, 2, 3]
    },
    
    // Mixed types with type coercion examples
    {
      active: true,
      count: 42,
      price: 19.99,
      nullable: null,
      empty: ""
    },
    
    // Complex nested structure
    {
      filters: {
        categories: ["tech", "news"],
        date: {
          from: "2024-01-01",
          to: "2024-12-31"
        },
        active: true
      },
      sort: "desc",
      limit: 10
    }
  ];
  
  const results = testObjects.map(obj => ({
    original: obj,
    queryString: buildQueryString(obj),
    withOptions: {
      skipNulls: buildQueryString(obj, { skipNulls: true }),
      indices: buildQueryString(obj, { arrayFormat: 'indices' }),
      repeat: buildQueryString(obj, { arrayFormat: 'repeat' }),
      comma: buildQueryString(obj, { arrayFormat: 'comma' })
    }
  }));
  
  res.json(results);
});

// Create and start server
const server = createServer(router);
const PORT = 3001;

server.listen(PORT, () => {
  console.log(`Query parsing test server running on http://localhost:${PORT}`);
  console.log("\n=== Test URLs - Copy and paste these into your browser ===\n");
  
  console.log("1. Simple parameters:");
  console.log(`   http://localhost:${PORT}/test-query?name=John&age=30&active=true`);
  
  console.log("\n2. Nested objects:");
  console.log(`   http://localhost:${PORT}/test-query?user[name]=Jane&user[age]=25&user[email]=jane@example.com`);
  
  console.log("\n3. Deeply nested objects:");
  console.log(`   http://localhost:${PORT}/test-query?settings[theme][color]=blue&settings[theme][mode]=dark&settings[notifications][email]=true`);
  
  console.log("\n4. Arrays with brackets:");
  console.log(`   http://localhost:${PORT}/test-query?tags[]=javascript&tags[]=node&tags[]=express`);
  
  console.log("\n5. Arrays with indices:");
  console.log(`   http://localhost:${PORT}/test-query?items[0]=first&items[1]=second&items[2]=third`);
  
  console.log("\n6. Duplicate keys (converted to array):");
  console.log(`   http://localhost:${PORT}/test-query?color=red&color=blue&color=green`);
  
  console.log("\n7. Type coercion (booleans and numbers):");
  console.log(`   http://localhost:${PORT}/test-query?active=true&inactive=false&count=42&price=19.99&empty=&nullish=null`);
  
  console.log("\n8. Comma-separated values:");
  console.log(`   http://localhost:${PORT}/test-query?tags=javascript,node,express&ids=1,2,3`);
  
  console.log("\n9. Complex mixed structure:");
  console.log(`   http://localhost:${PORT}/test-query?filter[status]=active&filter[tags][]=js&filter[tags][]=node&sort=desc&limit=10&page=2`);
  
  console.log("\n10. Special characters (URL encoded):");
  console.log(`   http://localhost:${PORT}/test-query?message=Hello%20World&email=user%40example.com&special=%2B%2D%2A%2F`);
  
  console.log("\n=== Query Builder Test ===");
  console.log(`Visit: http://localhost:${PORT}/test-builder`);
  console.log("This will show various objects converted to query strings with different options\n");
});