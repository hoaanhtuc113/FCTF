import { test, expect, type Page } from '@playwright/test';

const ADMIN_URL = 'https://admin0.fctf.site';

async function loginAdmin(page: Page) {
    await test.step('Login as admin', async () => {
        await page.goto(`${ADMIN_URL}/login`);
        await page.getByRole('textbox', { name: 'User Name or Email' }).fill('admin');
        await page.getByRole('textbox', { name: 'Password' }).fill('1');
        await page.getByRole('button', { name: 'Submit' }).click();
        await expect(page).toHaveURL(/.*admin/);
        console.log('✅ Admin logged in successfully');
    });
}

test.describe.serial('Deployment History (LOG) Test Suite', () => {
    test.setTimeout(240000);

    test.beforeEach(async ({ page }) => {
        await loginAdmin(page);
    });

    test('LOG-001: Display full log for successful workflow', async ({ page }) => {
        await page.goto(`${ADMIN_URL}/admin/challenges`);

        // Find a challenge with DEPLOY_SUCCESS
        const row = page.locator('tr', { has: page.locator('span.clean-badge-success', { hasText: 'DEPLOY_SUCCESS' }) }).first();
        await expect(row).toBeVisible({ timeout: 15000 });

        // User's exact History button selector
        await row.getByRole('link', { name: ' History' }).click();

        await expect(page).toHaveURL(/deploy_History/);
        console.log(`📂 Opened history page`);

        // Correct status string for History page is DEPLOY_SUCCEEDED
        // Use .last() to get the most recent deployment (as IDs are ascending)
        const historyRow = page.locator('tr').filter({ hasText: 'DEPLOY_SUCCEEDED' }).last();
        await expect(historyRow).toBeVisible({ timeout: 15000 });
        const detailBtn = historyRow.getByRole('link', { name: ' View Details' });
        await detailBtn.click();

        await expect(page).toHaveURL(/details/);

        // Check log content for success
        const logContent = page.locator('#log-content');
        await expect(logContent).toBeVisible({ timeout: 20000 });

        await expect(async () => {
            const text = await logContent.innerText();
            expect(text).toContain('Image pushed:');
            expect(text).toContain('level=info msg="sub-process exited"');
        }).toPass({ timeout: 30000 });

        console.log('✅ LOG-001: Success log content verified');
    });

    test('LOG-002: View log when the workflow process has failed', async ({ page }) => {
        await page.goto(`${ADMIN_URL}/admin/challenges`);

        let found = false;
        let pageNum = 1;

        // Loop through pages to find a DEPLOY_FAILED challenge
        while (pageNum <= 10) { // Safety limit of 10 pages
            console.log(`🔍 Searching for DEPLOY_FAILED on page ${pageNum}...`);
            const row = page.locator('tr', { has: page.locator('span.clean-badge-danger', { hasText: 'DEPLOY_FAILED' }) }).first();

            if (await row.isVisible()) {
                console.log('✅ Found DEPLOY_FAILED challenge!');
                await row.getByRole('link', { name: ' History' }).click();
                found = true;
                break;
            }

            // Check for next page
            const nextBtn = page.locator('li.page-item:not(.disabled) a.page-link', { hasText: '»' });
            if (await nextBtn.isVisible()) {
                await nextBtn.click();
                await page.waitForLoadState('load');
                pageNum++;
            } else {
                break;
            }
        }

        if (found) {
            await expect(page).toHaveURL(/deploy_History/);

            // In history, find a DEPLOY_FAILED entry
            const failedEntry = page.locator('tr').filter({ hasText: 'DEPLOY_FAILED' }).last();
            await expect(failedEntry).toBeVisible({ timeout: 15000 });

            const detailBtn = failedEntry.getByRole('link', { name: ' View Details' });
            await detailBtn.click();

            const logContent = page.locator('#log-content');
            await expect(logContent).toBeVisible({ timeout: 20000 });
            await page.screenshot({ path: `test-results/failed-log-${Date.now()}.png`, fullPage: true });

            await expect(async () => {
                const text = await logContent.innerText();
                console.log(`💬 Log content for DEPLOY_FAILED: ${text.substring(0, 500)}...`);
                const hasExpectedFail = text.toLowerCase().includes('error') ||
                    text.toLowerCase().includes('failed') ||
                    text.toLowerCase().includes('exit code') ||
                    text.includes('No build-and-push pod found in workflow') ||
                    text.includes('Image push failed');
                expect(hasExpectedFail).toBeTruthy();
            }).toPass({ timeout: 30000 });

            console.log('✅ LOG-003: Failure log content verified');
        } else {
            console.warn('⚠️ No challenge with DEPLOY_FAILED found after searching pages');
            test.skip();
        }
    });

    test('LOG-003: View log when the workflow process has been deleted', async ({ page }) => {
        // Access a non-existent deployment ID directly
        await page.goto(`${ADMIN_URL}/admin/challenges/deploy_History/9999999/details`);

        const alert = page.locator('.alert-danger');
        await expect(alert).toBeVisible();
        await expect(alert).toContainText('No deployment details found for the given ID');

        console.log('✅ LOG-003: Not found alert verified');
    });
});
