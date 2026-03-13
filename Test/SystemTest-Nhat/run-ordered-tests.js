const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const testsDir = path.join(__dirname, "tests");
const configPath = path.join(__dirname, "playwright.config.ts");

function resolveLocalPlaywrightCli() {
    const candidateModules = [
        path.join(__dirname, "node_modules", "@playwright", "test", "cli"),
        path.join(__dirname, "node_modules", "playwright", "cli"),
    ];

    for (const candidate of candidateModules) {
        try {
            return require.resolve(candidate);
        } catch (_error) {
            // Try next local-only candidate.
        }
    }

    throw new Error(
        "Local Playwright CLI was not found in Test/SystemTest-Nhat/node_modules. Run 'npm install' inside Test/SystemTest-Nhat before executing tests.",
    );
}

function getAllSpecFiles() {
    return fs.readdirSync(testsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.ts"))
        .map((entry) => path.posix.join("tests", entry.name.replace(/\\/g, "/")))
        .sort();
}

const orderedFiles = [

    "tests/uc16-change-scoreboard-visibility-usecases.spec.ts",
    "tests/uc24-filter-history.spec.ts",
    "tests/uc25-view-instance-history.spec.ts",
    "tests/uc26-view-audit-logs.spec.ts",
    "tests/uc28-view-users.spec.ts",
    "tests/uc30-edit-user.spec.ts",
    "tests/uc31-delete-user.spec.ts",
    "tests/uc37-view-teams.spec.ts",
    "tests/uc39-edit-team.spec.ts",
    "tests/uc40-delete-team.spec.ts",
    "tests/uc42-search-team.spec.ts",
    "tests/uc43-view-submissions.spec.ts",
    "tests/uc44-delete-submission.spec.ts",
    "tests/uc45-search-submission.spec.ts",
    "tests/uc46-change-submission-status.spec.ts",
    "tests/uc63-comment.spec.ts",
    "tests/uc64-assign-captain.spec.ts",
    "tests/uc65-view-user-solves.spec.ts",
    "tests/uc66-view-team-solves.spec.ts",
    "tests/uc67-view-user-fails.spec.ts",
    "tests/uc68-view-team-fails.spec.ts",
    "tests/uc69-view-user-award.spec.ts",
    "tests/uc70-view-team-award.spec.ts",
    "tests/uc71-delete-solved-submission.spec.ts",
    "tests/uc72-delete-failed-submission.spec.ts",
    "tests/uc73-delete-award.spec.ts",
    "tests/uc74-view-team-missings.spec.ts",
    "tests/uc75-view-brackets.spec.ts",
    "tests/uc76-create-bracket.spec.ts",
    "tests/uc77-update-bracket.spec.ts",
    "tests/uc78-delete-bracket.spec.ts",
    "tests/uc79-view-custom-fields.spec.ts",
    "tests/uc80-create-custom-field.spec.ts",
    "tests/uc81-update-custom-field.spec.ts",
    "tests/uc82-delete-custom-field.spec.ts",
    "tests/uc83-config-sanitize.spec.ts",
    "tests/uc84-pause-contest.spec.ts",
    // uc03 runs last — challenge creation seeds data consumed by edit/delete suites above
    // "tests/uc03-create-challenge-test.spec.ts",
    // "tests/uc04-edit-challenge-usecases.spec.ts",
    // "tests/uc05-delete-challenge-usecases.spec.ts",
    // "tests/uc13-challenge-version-usecases.spec.ts",
];

const excludedFiles = new Set([
    "tests/uc03-create-challenge-test.spec.ts",
    "tests/uc04-edit-challenge-usecases.spec.ts",
    "tests/uc05-delete-challenge-usecases.spec.ts",
    "tests/uc13-challenge-version-usecases.spec.ts",
    "tests/uc23-query-reward.spec.ts",

]);

const allSpecFiles = getAllSpecFiles();
const trailingOrderedFiles = allSpecFiles.filter(
    (file) => !orderedFiles.includes(file) && !excludedFiles.has(file),
);
const extraArgs = process.argv.slice(2);
const cliPath = resolveLocalPlaywrightCli();
const trailingArgs = ["test", "--config", configPath, ...orderedFiles, ...trailingOrderedFiles, ...extraArgs];

const result = spawnSync(process.execPath, [cliPath, ...trailingArgs], {
    cwd: __dirname,
    env: process.env,
    stdio: "inherit",
    shell: false,
});

if (result.error) {
    console.error(result.error);
    process.exit(1);
}

process.exit(result.status ?? 1);