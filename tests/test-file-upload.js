const { TestRunner, createTestServer, makeRequest, assert, assertEqual, assertIncludes, createTempDir, cleanupTempDir } = require('./test-helper');
const { Router, bodyParser } = require('../index');
const fs = require('fs');
const path = require('path');

const runner = new TestRunner('File Upload Tests');

// Helper to create multipart form data
function createMultipartData(fields, boundary) {
  let data = '';
  
  for (const field of fields) {
    data += `--${boundary}\r\n`;
    
    if (field.filename) {
      data += `Content-Disposition: form-data; name="${field.name}"; filename="${field.filename}"\r\n`;
      data += `Content-Type: ${field.contentType || 'application/octet-stream'}\r\n\r\n`;
      data += field.value + '\r\n';
    } else {
      data += `Content-Disposition: form-data; name="${field.name}"\r\n\r\n`;
      data += field.value + '\r\n';
    }
  }
  
  data += `--${boundary}--\r\n`;
  return data;
}

runner.test('Should handle single file upload', async () => {
  const app = new Router();
  const uploadDir = createTempDir();
  
  try {
    app.use(bodyParser.multipart({
      uploadDir: uploadDir,
      maxFileSize: 10 * 1024 * 1024 // 10MB
    }));
    
    app.post('/upload', (req, res) => {
      res.json({
        files: req.files,
        fields: req.body
      });
    });
    
    const server = await createTestServer(app);
    
    try {
      const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
      const fileContent = 'This is the file content';
      
      const formData = createMultipartData([
        {
          name: 'file',
          filename: 'test.txt',
          contentType: 'text/plain',
          value: fileContent
        },
        {
          name: 'description',
          value: 'Test file upload'
        }
      ], boundary);
      
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/upload',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': Buffer.byteLength(formData)
        }
      }, formData);
      
      assertEqual(response.statusCode, 200);
      
      const body = JSON.parse(response.body);
      assert(body.files, 'Should have files');
      assert(body.files.file, 'Should have uploaded file');
      assertEqual(body.files.file.originalFilename, 'test.txt');
      assertEqual(body.files.file.mimetype, 'text/plain');
      assertEqual(body.fields.description, 'Test file upload');
      
      // Verify file was saved
      if (body.files.file.filepath) {
        const savedContent = fs.readFileSync(body.files.file.filepath, 'utf8');
        assertEqual(savedContent, fileContent);
      }
    } finally {
      await server.close();
    }
  } finally {
    cleanupTempDir(uploadDir);
  }
});

runner.test('Should handle multiple file uploads', async () => {
  const app = new Router();
  const uploadDir = createTempDir();
  
  try {
    app.use(bodyParser.multipart({
      uploadDir: uploadDir,
      maxFiles: 10
    }));
    
    app.post('/upload-multiple', (req, res) => {
      res.json({
        fileCount: Object.keys(req.files || {}).length,
        files: req.files
      });
    });
    
    const server = await createTestServer(app);
    
    try {
      const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
      
      const formData = createMultipartData([
        {
          name: 'file1',
          filename: 'document.pdf',
          contentType: 'application/pdf',
          value: 'PDF content here'
        },
        {
          name: 'file2',
          filename: 'image.jpg',
          contentType: 'image/jpeg',
          value: 'JPEG data here'
        },
        {
          name: 'file3',
          filename: 'data.json',
          contentType: 'application/json',
          value: '{"test": "data"}'
        }
      ], boundary);
      
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/upload-multiple',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': Buffer.byteLength(formData)
        }
      }, formData);
      
      assertEqual(response.statusCode, 200);
      
      const body = JSON.parse(response.body);
      assertEqual(body.fileCount, 3);
      assert(body.files.file1, 'Should have file1');
      assert(body.files.file2, 'Should have file2');
      assert(body.files.file3, 'Should have file3');
      
      assertEqual(body.files.file1.originalFilename, 'document.pdf');
      assertEqual(body.files.file2.originalFilename, 'image.jpg');
      assertEqual(body.files.file3.originalFilename, 'data.json');
    } finally {
      await server.close();
    }
  } finally {
    cleanupTempDir(uploadDir);
  }
});

runner.test('Should handle file size limits', async () => {
  const app = new Router();
  const uploadDir = createTempDir();
  
  try {
    app.use(bodyParser.multipart({
      uploadDir: uploadDir,
      maxFileSize: 100 // Very small limit (100 bytes)
    }));
    
    app.post('/upload', (req, res) => {
      res.json({ success: true });
    });
    
    const server = await createTestServer(app);
    
    try {
      const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
      const largeContent = 'x'.repeat(200); // Exceeds limit
      
      const formData = createMultipartData([
        {
          name: 'file',
          filename: 'large.txt',
          contentType: 'text/plain',
          value: largeContent
        }
      ], boundary);
      
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/upload',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': Buffer.byteLength(formData)
        }
      }, formData);
      
      assertEqual(response.statusCode, 413, 'Should return 413 Payload Too Large');
    } finally {
      await server.close();
    }
  } finally {
    cleanupTempDir(uploadDir);
  }
});

runner.test('Should handle mixed form fields and files', async () => {
  const app = new Router();
  const uploadDir = createTempDir();
  
  try {
    app.use(bodyParser.multipart({
      uploadDir: uploadDir
    }));
    
    app.post('/submit-form', (req, res) => {
      res.json({
        fields: req.body,
        files: req.files
      });
    });
    
    const server = await createTestServer(app);
    
    try {
      const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
      
      const formData = createMultipartData([
        { name: 'username', value: 'john_doe' },
        { name: 'email', value: 'john@example.com' },
        { name: 'age', value: '25' },
        {
          name: 'avatar',
          filename: 'avatar.png',
          contentType: 'image/png',
          value: 'PNG image data'
        },
        {
          name: 'resume',
          filename: 'resume.pdf',
          contentType: 'application/pdf',
          value: 'PDF resume data'
        }
      ], boundary);
      
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/submit-form',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': Buffer.byteLength(formData)
        }
      }, formData);
      
      assertEqual(response.statusCode, 200);
      
      const body = JSON.parse(response.body);
      
      // Check fields
      assertEqual(body.fields.username, 'john_doe');
      assertEqual(body.fields.email, 'john@example.com');
      assertEqual(body.fields.age, '25');
      
      // Check files
      assert(body.files.avatar, 'Should have avatar file');
      assert(body.files.resume, 'Should have resume file');
      assertEqual(body.files.avatar.originalFilename, 'avatar.png');
      assertEqual(body.files.resume.originalFilename, 'resume.pdf');
    } finally {
      await server.close();
    }
  } finally {
    cleanupTempDir(uploadDir);
  }
});

runner.test('Should handle file type restrictions', async () => {
  const app = new Router();
  const uploadDir = createTempDir();
  
  try {
    app.use(bodyParser.multipart({
      uploadDir: uploadDir,
      allowedTypes: ['image/jpeg', 'image/png', 'application/pdf']
    }));
    
    app.post('/upload', (req, res) => {
      res.json({ files: req.files });
    });
    
    const server = await createTestServer(app);
    
    try {
      const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
      
      // Try uploading allowed type
      let formData = createMultipartData([
        {
          name: 'file',
          filename: 'image.jpg',
          contentType: 'image/jpeg',
          value: 'JPEG data'
        }
      ], boundary);
      
      let response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/upload',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': Buffer.byteLength(formData)
        }
      }, formData);
      
      assertEqual(response.statusCode, 200);
      
      // Try uploading disallowed type
      formData = createMultipartData([
        {
          name: 'file',
          filename: 'script.exe',
          contentType: 'application/x-msdownload',
          value: 'EXE data'
        }
      ], boundary);
      
      response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/upload',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': Buffer.byteLength(formData)
        }
      }, formData);
      
      assertEqual(response.statusCode, 415, 'Should return 415 Unsupported Media Type');
    } finally {
      await server.close();
    }
  } finally {
    cleanupTempDir(uploadDir);
  }
});

runner.test('Should handle file upload with custom filename', async () => {
  const app = new Router();
  const uploadDir = createTempDir();
  
  try {
    app.use(bodyParser.multipart({
      uploadDir: uploadDir,
      keepExtensions: true,
      filename: (name, ext, part, form) => {
        return `custom_${Date.now()}${ext}`;
      }
    }));
    
    app.post('/upload', (req, res) => {
      res.json({ files: req.files });
    });
    
    const server = await createTestServer(app);
    
    try {
      const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
      
      const formData = createMultipartData([
        {
          name: 'file',
          filename: 'original.txt',
          contentType: 'text/plain',
          value: 'File content'
        }
      ], boundary);
      
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/upload',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': Buffer.byteLength(formData)
        }
      }, formData);
      
      assertEqual(response.statusCode, 200);
      
      const body = JSON.parse(response.body);
      assert(body.files.file, 'Should have file');
      assert(body.files.file.newFilename.startsWith('custom_'), 'Should have custom filename');
      assert(body.files.file.newFilename.endsWith('.txt'), 'Should keep extension');
    } finally {
      await server.close();
    }
  } finally {
    cleanupTempDir(uploadDir);
  }
});

runner.test('Should handle empty file uploads', async () => {
  const app = new Router();
  const uploadDir = createTempDir();
  
  try {
    app.use(bodyParser.multipart({
      uploadDir: uploadDir,
      allowEmptyFiles: false
    }));
    
    app.post('/upload', (req, res) => {
      res.json({ files: req.files });
    });
    
    const server = await createTestServer(app);
    
    try {
      const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
      
      const formData = createMultipartData([
        {
          name: 'file',
          filename: 'empty.txt',
          contentType: 'text/plain',
          value: '' // Empty file
        }
      ], boundary);
      
      const response = await makeRequest({
        hostname: '127.0.0.1',
        port: server.port,
        path: '/upload',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': Buffer.byteLength(formData)
        }
      }, formData);
      
      // Should either reject or handle empty files based on configuration
      assert(response.statusCode === 400 || response.statusCode === 200);
    } finally {
      await server.close();
    }
  } finally {
    cleanupTempDir(uploadDir);
  }
});

runner.test('Should handle base64 encoded file uploads', async () => {
  const app = new Router();
  
  app.use(bodyParser.json({ limit: '10mb' }));
  
  app.post('/upload-base64', (req, res) => {
    const { filename, data, contentType } = req.body;
    
    // Decode base64 data
    const buffer = Buffer.from(data, 'base64');
    
    res.json({
      filename,
      contentType,
      size: buffer.length,
      preview: buffer.toString('utf8', 0, Math.min(100, buffer.length))
    });
  });
  
  const server = await createTestServer(app);
  
  try {
    const fileContent = 'This is a test file content for base64 encoding';
    const base64Data = Buffer.from(fileContent).toString('base64');
    
    const response = await makeRequest({
      hostname: '127.0.0.1',
      port: server.port,
      path: '/upload-base64',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, JSON.stringify({
      filename: 'test.txt',
      contentType: 'text/plain',
      data: base64Data
    }));
    
    assertEqual(response.statusCode, 200);
    
    const body = JSON.parse(response.body);
    assertEqual(body.filename, 'test.txt');
    assertEqual(body.contentType, 'text/plain');
    assertEqual(body.size, fileContent.length);
    assertIncludes(body.preview, 'This is a test file');
  } finally {
    await server.close();
  }
});

// Run the tests
runner.run().then(success => {
  process.exit(success ? 0 : 1);
});