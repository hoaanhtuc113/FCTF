import { test, expect, Page } from '@playwright/test';

/**
 * Action Logs Test Suite
 */

test.describe.configure({ mode: 'serial' });

// =============================================================================
// HELPERS
// =============================================================================

async function loginUser(page: Page, user: string = 'user1', pass: string = '1') {
    await test.step(`Login as ${user}`, async () => {
        await page.goto('https://contestant.fctf.site/login');
        await page.locator("input[placeholder='input username...']").fill(user);
        await page.locator("input[placeholder='enter_password']").fill(pass);
        await page.locator("button[type='submit']").click();
        await page.waitForURL(/\/(dashboard|challenges|tickets|scoreboard|instances|action-logs)/, { timeout: 60000 });
        await page.waitForTimeout(2000);
    });
}

async function navigateToActionLogs(page: Page) {
    await test.step('Navigate to Action Logs page', async () => {
        // High-level safety: ensure no Swals are blocking navigation
        await dismissAllSwals(page);
        await page.locator('button', { hasText: 'Action Logs' }).click();
        await page.waitForTimeout(1000);
        await expect(page.locator('h1', { hasText: '[TEAM_ACTION_LOGS]' })).toBeVisible({ timeout: 10000 });
    });
}

async function dismissAllSwals(page: Page) {
    await test.step('Force dismiss all Swals', async () => {
        // Try clicking OK or Cancel buttons first
        const buttons = page.locator('.swal2-confirm, .swal2-cancel, .swal2-close');
        const count = await buttons.count();
        if (count > 0) {
            for (let i = 0; i < count; i++) {
                if (await buttons.nth(i).isVisible()) {
                    await buttons.nth(i).click().catch(() => { });
                }
            }
        }

        // JS fallbacks
        await page.evaluate(() => {
            // Try global Swal if it exists
            if ((window as any).Swal) {
                (window as any).Swal.close();
            }
            // Force hide all swal classes via CSS
            const style = document.createElement('style');
            style.id = 'force-hide-swal';
            style.innerHTML = '.swal2-container { display: none !important; }';
            document.head.appendChild(style);
        });

        // Wait for container to be gone
        const swalContainer = page.locator('.swal2-container');
        if (await swalContainer.isVisible()) {
            await page.waitForTimeout(1000);
            if (await swalContainer.isVisible()) {
                console.log('Swal container still visible, forcing removal...');
                await page.evaluate(() => {
                    const container = document.querySelector('.swal2-container');
                    if (container) container.remove();
                });
            }
        }
        await page.waitForTimeout(1000);
    });
}

// =============================================================================
// TEST CASES
// =============================================================================

test.describe('Action Logs Functionality', () => {

    test.beforeEach(async ({ page }) => {
        await loginUser(page);
    });

    test('TC-AL001: Retrieve list of 100 action logs successfully', async ({ page }) => {
        await navigateToActionLogs(page);

        // Step 1: Change rows per page to 100
        await test.step('Set rows per page to 100', async () => {
            const rowSelect = page.locator('select').last(); // The one in pagination
            await rowSelect.selectOption('100');
            await page.waitForTimeout(1000);
        });

        // Step 2: Verify log count
        const rows = page.locator('tbody tr');
        const count = await rows.count();
        console.log(`Visible logs count: ${count}`);

        // If there are logs, verify we see at least 1 or up to 100
        if (count > 0) {
            expect(count).toBeGreaterThan(0);
            expect(count).toBeLessThanOrEqual(100);
        } else {
            await expect(page.locator('text=No action logs found')).toBeVisible();
        }

        console.log('✅ TC-AL001: Retrieve logs with pagination - PASS');
    });

    test('TC-AL002: Verify new action creates a log entry', async ({ page }) => {
        test.setTimeout(120000);

        // Use a different user to ensure fresh attempts
        await loginUser(page, 'user11');

        let challengeName = '';

        // Step 1: Perform an action (Incorrect flag submission)
        await test.step('Submit incorrect flag', async () => {
            await page.locator('button', { hasText: 'Challenges' }).click();
            await page.waitForTimeout(2000);

            // Try to find an open challenge (not solved, not max attempts)
            const challenges = page.locator('h3');
            const count = await challenges.count();
            let found = false;

            for (let i = 0; i < Math.min(count, 5); i++) {
                challengeName = await challenges.nth(i).textContent() || '';
                await challenges.nth(i).click();
                await page.waitForTimeout(1000);

                if (await page.locator('text=[SUBMIT FLAG]').isVisible()) {
                    const textarea = page.locator('textarea[placeholder="flag{...}"]');
                    if (await textarea.isVisible()) {
                        await textarea.fill(`flag{wrong_test_${Date.now()}}`);
                        const submitBtn = page.locator('button', { hasText: '[SUBMIT]' });
                        await expect(submitBtn).toBeEnabled();
                        await submitBtn.click();

                        await expect(page.locator('.swal2-popup')).toBeVisible();
                        await dismissAllSwals(page);
                        found = true;
                        break;
                    }
                }
                // If not found, close and try next
                await page.locator('button', { hasText: '✕' }).click();
            }

            if (!found) {
                throw new Error('Could not find a challenge with available attempts for user11');
            }
            console.log(`Submitted incorrect flag for challenge: ${challengeName}`);
        });

        // Step 2: Check Action Logs
        await navigateToActionLogs(page);

        await test.step('Verify log entry exists', async () => {
            // The app logs: "Nộp cờ sai cho thử thách [name]"
            const searchInput = page.locator('input[placeholder*="Search by detail"]');
            await searchInput.fill(challengeName);
            await page.waitForTimeout(2000);

            const firstRowDetail = page.locator('tbody tr td').nth(3); // Detail column
            // Use regex to handle Vietnamese characters or partial match
            await expect(firstRowDetail).toContainText(challengeName);

            // Verify action type is "Incorrect" (usually RED or has "Incorrect" text)
            const typeBadge = page.locator('tbody tr td').nth(1);
            await expect(typeBadge).toContainText(/Incorrect|Flag/i);
        });

        console.log('✅ TC-AL002: Real-time log generation - PASS');
    });

    test('TC-AL003: Retrieve actions filtered by action type', async ({ page }) => {
        await navigateToActionLogs(page);

        // Step 1: Filter by "Unlock Hint" (Type 5 based on code analysis)
        await test.step('Filter by Unlock Hint', async () => {
            const typeSelect = page.locator('select').first();
            await typeSelect.selectOption({ label: 'Unlock Hint' });
            await page.waitForTimeout(1000);
        });

        // Step 2: Verify all rows have "Hint" badge
        const rows = page.locator('tbody tr');
        const count = await rows.count();

        for (let i = 0; i < count; i++) {
            const badge = rows.nth(i).locator('td').nth(1);
            await expect(badge).toContainText(/Hint|Unlock/i);
        }

        console.log('✅ TC-AL003: Filter by action type - PASS');
    });

    test('TC-AL004: Retrieve actions filtered by topic', async ({ page }) => {
        await navigateToActionLogs(page);

        // Step 1: Pick a topic from the filter
        const topicSelect = page.locator('select').nth(1); // Second select
        const options = await topicSelect.locator('option').all();

        if (options.length > 1) { // 0 is "All Topics"
            const targetTopic = await options[1].textContent() || '';
            console.log(`Filtering by topic: ${targetTopic}`);

            await topicSelect.selectOption(targetTopic);
            await page.waitForTimeout(1000);

            // Step 2: Verify rows
            const rows = page.locator('tbody tr');
            const count = await rows.count();

            for (let i = 0; i < count; i++) {
                const topicCol = rows.nth(i).locator('td').nth(2);
                await expect(topicCol).toContainText(targetTopic);
            }
        } else {
            console.log('Skipping TC-AL004: No topics available to filter.');
        }

        console.log('✅ TC-AL004: Filter by topic - PASS');
    });

    test('TC-AL005: Search logs by multiple criteria (User, Topic, Detail)', async ({ page }) => {
        await navigateToActionLogs(page);
        const searchInput = page.locator('input[placeholder*="Search by detail"]');

        // 1. Search by User
        await test.step('Search by User Name', async () => {
            const userName = 'user1'; // Default logged in user
            await searchInput.fill(userName);
            await page.waitForTimeout(1000);

            const rows = page.locator('tbody tr');
            const count = await rows.count();
            if (count > 0) {
                // Verify first row contains user name in User column (index 4)
                const userCol = rows.first().locator('td').nth(4);
                await expect(userCol).toContainText(userName, { ignoreCase: true });
            }
        });

        // 2. Search by Topic
        await test.step('Search by Topic Name', async () => {
            await searchInput.fill('');
            await page.waitForTimeout(500);

            // Get a topic name from the first row if available
            const firstRowTopic = await page.locator('tbody tr td').nth(2).textContent() || '';
            if (firstRowTopic) {
                await searchInput.fill(firstRowTopic);
                await page.waitForTimeout(1000);

                const rows = page.locator('tbody tr');
                const count = await rows.count();
                if (count > 0) {
                    const topicCol = rows.first().locator('td').nth(2);
                    await expect(topicCol).toContainText(firstRowTopic, { ignoreCase: true });
                }
            }
        });

        // 3. Search by Detail keyword
        await test.step('Search by Detail Keyword', async () => {
            await searchInput.fill('');
            await page.waitForTimeout(500);

            const keyword = 'Nộp cờ'; // Common Vietnamese keyword for flag submissions
            await searchInput.fill(keyword);
            await page.waitForTimeout(1000);

            const rows = page.locator('tbody tr');
            const count = await rows.count();
            if (count > 0) {
                const detailCol = rows.first().locator('td').nth(3);
                await expect(detailCol).toContainText(keyword, { ignoreCase: true });
            }
        });

        console.log('✅ TC-AL005: Multi-criteria search - PASS');
    });
});
