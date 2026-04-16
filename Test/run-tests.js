const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEST_DIR = __dirname;
const SYSTEM_TEST_NHAT_DIR = path.join(TEST_DIR, 'SystemTest-Nhat', 'tests');
const SYSTEM_TEST_NHAT_CONFIG = path.join(TEST_DIR, 'playwright.config.ts'); // Move it here

// Group 0: SystemTest-Nhat (Dynamic)
let systemTests = [];
if (fs.existsSync(SYSTEM_TEST_NHAT_DIR)) {
    systemTests = fs.readdirSync(SYSTEM_TEST_NHAT_DIR)
        .filter(f => f.endsWith('.spec.ts'))
        .map(f => `Test/SystemTest-Nhat/tests/${f}`);
}

// Groups 1-5: Static order as requested by the user
const groups = [
    {
        name: "Nhóm 1: Xác thực tài khoản & User/Contestant",
        tests: [
            "login-test.spec.ts",
            "changepassword-test.spec.ts",
            "user-profile-test.spec.ts",
            "ticket-test.spec.ts",
            "challenges-test.spec.ts",
            "hint-test.spec.ts"
        ]
    },
    {
        name: "Nhóm 2: Challenge Framework & Flags",
        tests: [
            "start-challenge-test.spec.ts",
            "stop-challenge-test.spec.ts",
            "preview-challenge-test.spec.ts",
            "monitor-instance-test.spec.ts",
            "instances-test.spec.ts",
            "submission-status-test.spec.ts",
            "submission-search-test.spec.ts",
            "submit-flag-test.spec.ts",
            "challenge-version-test.spec.ts"
        ]
    },
    {
        name: "Nhóm 3: Quản Lý, Lọc, và System History trên Admin",
        tests: [
            "admin-ticket-test.spec.ts",
            "admin-ticket-respond-test.spec.ts",
            "admin-user-filter-test.spec.ts",
            "admin-create-user-team-test.spec.ts",
            "filter-admin-challenges.spec.ts",
            "deployment-history-test.spec.ts",
            "action-logs-test.spec.ts",
            "admin-action-logs-test.spec.ts",
            "instance-request-logs-test.spec.ts",
            "audit-log-test.spec.ts",
            "scoreboard-search-test.spec.ts",
            "scoreboard-test.spec.ts",
            "admin-scoreboard-test.spec.ts"
        ]
    },
    {
        name: "Nhóm 4: Cấu hình hệ thống (Global State)",
        tests: [
            "admin-challenge-hint-test.spec.ts",
            "admin-config-general-test.spec.ts",
            "admin-config-logo-test.spec.ts",
            "admin-config-visibility-test.spec.ts",
            "admin-config-time-test.spec.ts"
        ]
    },
    {
        name: "Nhóm 5: Tác vụ Export, Cleanup & Reset",
        tests: [
            "export-user-test.spec.ts",
            "import-export-csv-test.spec.ts",
            "admin-reset-test.spec.ts"
        ]
    }
];

console.log('--- Order of Execution ---');
let count = 1;

// Log Group 0
if (systemTests.length > 0) {
    console.log(`\n[\x1b[36mNhóm 0: SystemTest-Nhat\x1b[0m]`);
    systemTests.forEach(test => {
        console.log(`${count++}. ${test}`);
    });
}

// Log Groups 1-5
groups.forEach(group => {
    console.log(`\n[\x1b[35m${group.name}\x1b[0m]`);
    group.tests.forEach(test => {
        console.log(`${count++}. Test/${test}`);
    });
});
console.log('\n--------------------------');

if (process.argv.includes('--dry-run')) {
    process.exit(0);
}

// Execution - Category 0: SystemTest-Nhat
if (systemTests.length > 0) {
    console.log(`\n\x1b[36m>>> Starting Nhóm 0: SystemTest-Nhat <<<\x1b[0m`);
    // System tests are already relative to TEST_DIR in the map function (Test/SystemTest...)
    // but the map function used 'Test/'. Let's fix that.
    const systemConfigFlag = fs.existsSync(SYSTEM_TEST_NHAT_CONFIG) ? `--config="playwright.config.ts"` : '';
    for (const testFile of systemTests) {
        // Strip the 'Test/' prefix because we will run from TEST_DIR
        const relativePath = testFile.startsWith('Test/') ? testFile.substring(5) : testFile;
        runTest(relativePath, systemConfigFlag);
    }
}

// Execution - Categories 1-5
for (const group of groups) {
    console.log(`\n\x1b[33m>>> Starting ${group.name} <<<\x1b[0m`);
    for (const testFile of group.tests) {
        runTest(testFile, `--config="playwright.config.ts"`);
    }
}

function runTest(testPath, configFlag) {
    const fullTestPath = path.join(TEST_DIR, testPath);
    if (!fs.existsSync(fullTestPath)) {
        console.error(`[\x1b[31mSKIPPED\x1b[0m] File not found: ${fullTestPath}`);
        return;
    }

    console.log(`\n[\x1b[34mRUNNING\x1b[0m] ${testPath}...`);
    try {
        // Run sequentially with --headed and --workers=1 to ensure strict ordering
        // Execute with TEST_DIR as CWD so it finds local node_modules
        execSync(`npx playwright test "${testPath}" ${configFlag} --headed --workers=1`, { 
            stdio: 'inherit',
            cwd: TEST_DIR
        });
    } catch (error) {
        console.error(`[\x1b[31mFAILED\x1b[0m] ${testPath}`);
    }
}
