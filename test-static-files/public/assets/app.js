console.log('Velocy static middleware test loaded!');

// Test fetch with Range request
async function testRangeRequest() {
  const response = await fetch('/assets/app.js', {
    headers: {
      'Range': 'bytes=0-50'
    }
  });
  
  console.log('Range request status:', response.status);
  console.log('Content-Range:', response.headers.get('Content-Range'));
}

// Test conditional request
async function testConditionalRequest() {
  const response1 = await fetch('/assets/style.css');
  const etag = response1.headers.get('ETag');
  const lastModified = response1.headers.get('Last-Modified');
  
  console.log('ETag:', etag);
  console.log('Last-Modified:', lastModified);
  
  // Make conditional request with ETag
  const response2 = await fetch('/assets/style.css', {
    headers: {
      'If-None-Match': etag
    }
  });
  
  console.log('Conditional request status:', response2.status);
}

// Run tests
setTimeout(() => {
  testRangeRequest();
  testConditionalRequest();
}, 1000);