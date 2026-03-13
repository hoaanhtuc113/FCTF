import { defineConfig, devices } from '@playwright/test';

// Dedicated config for isolated UC03 runs inside SystemTest-Nhat.
export default defineConfig({
    testDir: './tests',
    testMatch: ['uc03-create-challenge-test.spec.ts'],
    fullyParallel: false,
    workers: 1,
    retries: 1,
    reporter: [
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
        ['list'],
        ['json', { outputFile: 'uc03-results.json' }],
        ['junit', { outputFile: 'uc03-junit.xml' }],
    ],
    use: {
        actionTimeout: 30_000,
        navigationTimeout: 90_000,
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});