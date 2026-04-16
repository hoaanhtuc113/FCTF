const { execSync } = require('child_process');
const files = [
  "login-test.spec.ts",
  "changepassword-test.spec.ts",
  "user-profile-test.spec.ts",
  "ticket-test.spec.ts",
  "challenges-test.spec.ts",
  "hint-test.spec.ts",
  "start-challenge-test.spec.ts",
  "stop-challenge-test.spec.ts",
  "preview-challenge-test.spec.ts",
  "monitor-instance-test.spec.ts",
  "instances-test.spec.ts",
  "submission-status-test.spec.ts",
  "submission-search-test.spec.ts",
  "submit-flag-test.spec.ts",
  "challenge-version-test.spec.ts",
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
  "export-user-test.spec.ts",
  "scoreboard-search-test.spec.ts",
  "scoreboard-test.spec.ts",
  "admin-scoreboard-test.spec.ts",
  "admin-challenge-hint-test.spec.ts",
  "admin-config-general-test.spec.ts",
  "admin-config-logo-test.spec.ts",
  "admin-config-visibility-test.spec.ts",
  "admin-config-time-test.spec.ts",
  "reset-contest.spec.ts",
  "import-export-csv-test.spec.ts",
  "admin-reset-test.spec.ts"
];

let failed = [];
let passed = [];

for (const file of files) {
  console.log(`\n========================================`);
  console.log(`⏳ [RUNNING] ${file}`);
  try {
    // Execute from the Test directory
    execSync(`npx playwright test ${file} --config=playwright.config.ts --workers=1`, { 
        stdio: 'inherit',
        cwd: __dirname
    });
    passed.push(file);
  } catch (err) {
    console.error(`❌ [FAILED] ${file}`);
    failed.push(file);
  }
}

console.log(`\n========================================`);
console.log(`🎯 EXECUTION SUMMARY`);
console.log(`✅ Passed: ${passed.length}`);
console.log(`❌ Failed: ${failed.length}`);

if (failed.length > 0) {
    console.log(`\n[FAILED FILES LIST]`);
    failed.forEach(f => console.log(`- ${f}`));
}
