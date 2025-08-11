#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

async function runTest(testFile) {
  return new Promise((resolve) => {
    const testPath = path.join(__dirname, testFile);
    
    console.log(`${colors.cyan}Running: ${testFile}${colors.reset}`);
    
    const proc = spawn(process.execPath, [testPath], {
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' },
      shell: false
    });
    
    proc.on('exit', (code) => {
      resolve(code === 0);
    });
    
    proc.on('error', (err) => {
      console.error(`${colors.red}Failed to run ${testFile}: ${err.message}${colors.reset}`);
      resolve(false);
    });
  });
}

async function main() {
  console.log(`${colors.blue}${'='.repeat(60)}`);
  console.log('  Velocy Test Suite');
  console.log(`${'='.repeat(60)}${colors.reset}\n`);
  
  // Get all test files
  const testFiles = fs.readdirSync(__dirname)
    .filter(file => file.startsWith('test-') && file.endsWith('.js'))
    .sort();
  
  if (testFiles.length === 0) {
    console.log(`${colors.yellow}No test files found!${colors.reset}`);
    process.exit(1);
  }
  
  console.log(`Found ${testFiles.length} test files\n`);
  
  const results = [];
  const startTime = Date.now();
  
  // Run tests sequentially to avoid port conflicts
  for (const testFile of testFiles) {
    const passed = await runTest(testFile);
    results.push({ file: testFile, passed });
    
    // Small delay between tests to ensure cleanup
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  // Print summary
  console.log(`\n${colors.blue}${'='.repeat(60)}`);
  console.log('  Test Summary');
  console.log(`${'='.repeat(60)}${colors.reset}\n`);
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  results.forEach(({ file, passed }) => {
    const status = passed ? `${colors.green}✅ PASS` : `${colors.red}❌ FAIL`;
    console.log(`  ${status}${colors.reset} ${file}`);
  });
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Total: ${passed} passed, ${failed} failed (${duration}s)`);
  console.log(`${'='.repeat(60)}\n`);
  
  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

// Handle errors
process.on('unhandledRejection', (err) => {
  console.error(`${colors.red}Unhandled rejection: ${err}${colors.reset}`);
  process.exit(1);
});

main().catch(err => {
  console.error(`${colors.red}Test runner error: ${err}${colors.reset}`);
  process.exit(1);
});