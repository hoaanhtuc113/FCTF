const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function getNpmCacheNpxDir() {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
        return path.join(localAppData, "npm-cache", "_npx");
    }

    const userProfile = process.env.USERPROFILE;
    if (userProfile) {
        return path.join(userProfile, "AppData", "Local", "npm-cache", "_npx");
    }

    return null;
}

function findCachedPlaywrightCli() {
    const npxDir = getNpmCacheNpxDir();
    if (!npxDir || !fs.existsSync(npxDir)) {
        return null;
    }

    const candidates = fs.readdirSync(npxDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
            const baseDir = path.join(npxDir, entry.name);
            const cliPath = path.join(baseDir, "node_modules", "playwright", "cli.js");
            if (!fs.existsSync(cliPath)) {
                return null;
            }

            const stats = fs.statSync(cliPath);
            return {
                cliPath,
                nodeModulesPath: path.join(baseDir, "node_modules"),
                mtimeMs: stats.mtimeMs,
            };
        })
        .filter(Boolean)
        .sort((left, right) => right.mtimeMs - left.mtimeMs);

    return candidates[0] ?? null;
}

function primeCachedPlaywright() {
    const command = process.platform === "win32"
        ? process.env.ComSpec || "cmd.exe"
        : "npx";
    const args = process.platform === "win32"
        ? ["/d", "/s", "/c", "npx --yes playwright --version"]
        : ["--yes", "playwright", "--version"];

    spawnSync(command, args, {
        cwd: __dirname,
        stdio: "ignore",
        shell: false,
    });
}

function resolvePlaywrightCommand() {
    const candidateModules = [
        "playwright/cli",
        "@playwright/test/cli",
        path.join(__dirname, "..", "..", "node_modules", "playwright", "cli"),
        path.join(__dirname, "..", "..", "node_modules", "@playwright", "test", "cli"),
        path.join(__dirname, "..", "node_modules", "playwright", "cli"),
        path.join(__dirname, "..", "node_modules", "@playwright", "test", "cli"),
    ];

    for (const candidate of candidateModules) {
        try {
            const cliPath = require.resolve(candidate);
            return {
                command: process.execPath,
                args: [cliPath, "test"],
                useCommandString: false,
                env: process.env,
            };
        } catch (_error) {
            // Try next candidate.
        }
    }

    let cachedPlaywright = findCachedPlaywrightCli();
    if (!cachedPlaywright) {
        primeCachedPlaywright();
        cachedPlaywright = findCachedPlaywrightCli();
    }

    if (cachedPlaywright) {
        const nodePath = process.env.NODE_PATH
            ? `${cachedPlaywright.nodeModulesPath}${path.delimiter}${process.env.NODE_PATH}`
            : cachedPlaywright.nodeModulesPath;

        return {
            command: process.execPath,
            args: [cachedPlaywright.cliPath, "test"],
            useCommandString: false,
            env: {
                ...process.env,
                NODE_PATH: nodePath,
            },
        };
    }

    if (process.platform === "win32") {
        return {
            command: process.env.ComSpec || "cmd.exe",
            args: ["/d", "/s", "/c"],
            useCommandString: true,
            env: process.env,
        };
    }

    return {
        command: "npx",
        args: ["--yes", "playwright", "test"],
        useCommandString: false,
        env: process.env,
    };
}

function quoteArg(arg) {
    if (!/[\s"]/u.test(arg)) {
        return arg;
    }
    return `"${arg.replace(/"/g, '\\"')}"`;
}

const orderedFiles = [
    "tests/uc23-query-reward.spec.ts",
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
];

const extraArgs = process.argv.slice(2);
const playwrightCommand = resolvePlaywrightCommand();
const trailingArgs = [...orderedFiles, ...extraArgs];
const args = playwrightCommand.useCommandString
    ? [...playwrightCommand.args, `npx --yes playwright test ${trailingArgs.map(quoteArg).join(" ")}`]
    : [...playwrightCommand.args, ...trailingArgs];

const result = spawnSync(playwrightCommand.command, args, {
    cwd: __dirname,
    env: playwrightCommand.env,
    stdio: "inherit",
    shell: false,
});

if (result.error) {
    console.error(result.error);
    process.exit(1);
}

process.exit(result.status ?? 1);