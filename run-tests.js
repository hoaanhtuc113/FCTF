const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEST_DIR = path.join(__dirname, 'Test');
const SYSTEM_TEST_NHAT_DIR = path.join(TEST_DIR, 'SystemTest-Nhat', 'tests');
const SYSTEM_TEST_NHAT_CONFIG = path.join(TEST_DIR, 'SystemTest-Nhat', 'playwright.config.ts');

// 1. Get tests in SystemTest-Nhat/tests
let systemTests = [];
if (fs.existsSync(SYSTEM_TEST_NHAT_DIR)) {
    systemTests = fs.readdirSync(SYSTEM_TEST_NHAT_DIR)
        .filter(f => f.endsWith('.spec.ts'))
        .map(f => `Test/SystemTest-Nhat/tests/${f}`);
}

// 2. Get top-level tests in Test/
const SPECIAL_LAST_TESTS = ['import-export-csv-test.spec.ts', 'admin-reset-test.spec.ts'];
const topLevelTests = fs.readdirSync(TEST_DIR)
    .filter(f => f.endsWith('.spec.ts'))
    .filter(f => !SPECIAL_LAST_TESTS.includes(f))
    .map(f => `Test/${f}`);

// 3. Final special tests
const finalSpecialTests = SPECIAL_LAST_TESTS.map(f => `Test/${f}`);

console.log('--- Order of Execution ---');
systemTests.forEach((t, i) => console.log(`${i + 1}. [SystemTest-Nhat] ${t}`));
topLevelTests.forEach((t, i) => console.log(`${systemTests.length + i + 1}. [Top-Level] ${t}`));
finalSpecialTests.forEach((t, i) => console.log(`${systemTests.length + topLevelTests.length + i + 1}. [Final] ${t}`));
console.log('--------------------------');

if (process.argv.includes('--dry-run')) {
    process.exit(0);
}

// Execution
// Category 1: SystemTest-Nhat (using its own config if it exists)
const systemConfigFlag = fs.existsSync(SYSTEM_TEST_NHAT_CONFIG) ? `--config="${SYSTEM_TEST_NHAT_CONFIG}"` : '';
for (const testFile of systemTests) {
    runTest(testFile, systemConfigFlag);
}

// Category 2: Top-Level Tests (using root config)
for (const testFile of topLevelTests) {
    runTest(testFile, '');
}

// Category 3: Special Last Tests
for (const testFile of finalSpecialTests) {
    runTest(testFile, '');
}

function runTest(testFile, configFlag) {
    console.log(`\n[\x1b[34mRUNNING\x1b[0m] ${testFile}...`);
    try {
        // Run sequentially with --headed as per usual user preference for these tasks
        execSync(`npx playwright test "${testFile}" ${configFlag} --headed`, { stdio: 'inherit' });
    } catch (error) {
        console.error(`[\x1b[31mFAILED\x1b[0m] ${testFile}`);
    }
}
