// @ts-nocheck
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "./tests",
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: [["html", { outputFolder: "playwright-report", open: "never" }], ["list"]],
    use: {
        trace: "on-first-retry",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
        headless: false,
        // headless: process.env.PWDEBUG ? false : true,
        actionTimeout: 15_000,
        navigationTimeout: 30_000,
    },
    projects: [
        {
            name: "chromium",
            use: {
                ...devices["Desktop Chrome"],
            },
        },
    ],
});
