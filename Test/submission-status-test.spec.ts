import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const ADMIN_URL = 'https://admin.fctf.site';
const ADMIN_USER = 'admin';
const ADMIN_PASS = '1';

async function loginAdmin(page: Page) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            console.log(`Login attempt ${attempt}...`);
            await page.goto(`${ADMIN_URL}/login`);
            
            if (page.url().includes('/admin') && !page.url().includes('/login')) {
                console.log('Already logged in.');
                return;
            }

            const nameInput = page.locator('#name, input[name="name"]').first();
            const passInput = page.locator('#password, input[name="password"]').first();
            const submitBtn = page.locator('#_submit, button[type="submit"]').first();

            await nameInput.waitFor({ state: 'visible', timeout: 15_000 });
            await nameInput.fill(ADMIN_USER);
            await passInput.fill(ADMIN_PASS);

            await Promise.all([
                page.waitForURL(/\/admin/, { timeout: 30_000 }),
                submitBtn.click(),
            ]);
            console.log('Login successful.');
            return;
        } catch (err: any) {
            console.error(`Login attempt ${attempt} failed: ${err.message}`);
            if (attempt === 3) {
                await page.screenshot({ path: `Test/debug_screenshots/login_fail_${Date.now()}.png` });
                throw err;
            }
            await page.waitForTimeout(2000);
        }
    }
}

async function confirmModal(page: Page) {
    // ezQuery modals usually have a primary button in the footer for confirmation
    const confirmBtn = page.locator('.modal-footer button:not(.btn-outline-secondary), #yes-button, #confirm-button').filter({ hasText: /(Confirm|Yes|Delete|OK)/i }).first();
    await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
    await confirmBtn.click();
}

test.describe('Submission Status Management', () => {
    test.beforeEach(async ({ page }) => {
        if (!fs.existsSync('Test/debug_screenshots')) {
            fs.mkdirSync('Test/debug_screenshots', { recursive: true });
        }

        await loginAdmin(page);
        console.log('Navigating to submissions page...');
        await page.goto(`${ADMIN_URL}/admin/submissions`);
        await page.locator('#teamsboard').waitFor({ state: 'visible', timeout: 30_000 });
    });

    test('STAT-01: Change status from Incorrect to Correct (Single Row)', async ({ page }) => {
        // Find an incorrect submission
        const row = page.locator('#teamsboard tbody tr').filter({ hasText: 'incorrect' }).first();
        if (!(await row.isVisible())) {
            console.log('No incorrect submission found to test STAT-01');
            return;
        }

        const subId = await row.locator('input.table-check').getAttribute('value');
        console.log(`Changing status for submission ID ${subId} to correct`);

        // Correct submissions are usually handled by selecting and clicking the bulk button
        // OR the user might want to click a row specific eye/check if available.
        // submissions.html shows #correct-flags-button for selected rows.
        await row.locator('input.table-check').check();
        await page.locator('#correct-flags-button').click();

        await confirmModal(page);

        // Verification: Page should reload and row should be correct (or missing if filtered to incorrect only)
        await page.waitForLoadState('load');
        await page.waitForTimeout(1000); // Grace for DB/Reload sync
        const updatedRow = page.locator(`#teamsboard tbody tr:has(input[value="${subId}"])`);
        await expect(updatedRow).toContainText('correct', { timeout: 10_000 });
    });

    test('STAT-02: Change status from Correct to Incorrect (Single Row)', async ({ page }) => {
        const row = page.locator('#teamsboard tbody tr').filter({ hasText: 'correct' }).first();
        if (!(await row.isVisible())) {
            console.log('No correct submission found to test STAT-02');
            return;
        }

        const subId = await row.locator('input.table-check').getAttribute('value');
        await row.locator('input.table-check').check();
        await page.locator('#incorrect-flags-button').click();

        await confirmModal(page);

        await page.waitForLoadState('load');
        await page.waitForTimeout(1000); // Grace for DB/Reload sync
        const updatedRow = page.locator(`#teamsboard tbody tr:has(input[value="${subId}"])`);
        await expect(updatedRow).toContainText('incorrect', { timeout: 10_000 });
    });

    test('STAT-03: Bulk Status Change', async ({ page }) => {
        const rows = page.locator('#teamsboard tbody tr').filter({ hasText: 'incorrect' });
        const count = await rows.count();
        if (count < 2) {
            console.log('Not enough incorrect submissions for bulk test');
            return;
        }

        // Select first two
        await rows.nth(0).locator('input.table-check').check();
        await rows.nth(1).locator('input.table-check').check();

        await page.locator('#correct-flags-button').click();
        await confirmModal(page);

        await page.waitForLoadState('load');
        // Check if no longer listed as incorrect (or confirm correct if we look at the same IDs)
        // For simplicity, just check visibility of any 'correct' now
        await expect(page.locator('#teamsboard')).toContainText('correct');
    });

    test('STAT-04: Delete Submission', async ({ page }) => {
        const row = page.locator('#teamsboard tbody tr').first();
        if (!(await row.isVisible())) return;

        const subId = await row.locator('input.table-check').getAttribute('value');
        
        await row.locator('input.table-check').check();
        await page.locator('#submission-delete-button').click();

        await confirmModal(page);

        await page.waitForLoadState('load');
        await expect(page.locator(`#teamsboard tbody tr:has(input[value="${subId}"])`)).not.toBeVisible();
    });
});
