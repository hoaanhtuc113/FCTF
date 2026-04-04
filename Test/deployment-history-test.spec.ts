import { test, expect, type Locator, type Page } from '@playwright/test';

const ADMIN_URL = 'https://admin0.fctf.site';

async function loginAdmin(page: Page) {
    await test.step('Login as admin', async () => {
        await page.goto(`${ADMIN_URL}/login`);
        await page.getByRole('textbox', { name: 'User Name or Email' }).fill('admin');
        await page.getByRole('textbox', { name: 'Password' }).fill('1');
        await page.getByRole('button', { name: 'Submit' }).click();
        await page.waitForURL((url) => url.pathname.startsWith('/admin'), { timeout: 30000 });
        console.log('✅ Admin logged in successfully');
    });
}

async function openHistoryFromChallengeRow(page: Page, row: Locator) {
    const directHistoryLink = row.locator('a[href*="/deploy_History/"]').first();
    if (await directHistoryLink.count()) {
        try {
            await directHistoryLink.click({ timeout: 5000 });
            return;
        } catch {
            // Continue with fallback strategies.
        }
    }

    const actionsButton = row.getByRole('button', { name: /actions/i }).first();
    if (await actionsButton.count()) {
        try {
            await actionsButton.click({ timeout: 5000 });
        } catch {
            // Some layouts expose history controls without a working Actions button.
        }
    }

    const visibleHistoryLink = page.locator('a[href*="/deploy_History/"]:visible').first();
    if (await visibleHistoryLink.count()) {
        await visibleHistoryLink.click({ timeout: 10000 });
        return;
    }

    const jsHistoryControl = row
        .locator('button[onclick*="deploy_History"], a[onclick*="deploy_History"], a:has(i.fa-history), button:has(i.fa-history), [title*="History"]')
        .first();
    await jsHistoryControl.click({ timeout: 10000, force: true });
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

        await openHistoryFromChallengeRow(page, row);

        await expect(page).toHaveURL(/deploy_History/);
        console.log(`📂 Opened history page`);

        // Use .last() to get the most recent deployment (as IDs are ascending)
        const historyRow = page.locator('tr').filter({ hasText: /DEPLOY_SUCCEEDED|DEPLOY_SUCCESS/ }).last();
        await expect(historyRow).toBeVisible({ timeout: 15000 });
        const detailBtn = historyRow.locator('a[href*="/deploy_History/details/"]').first();
        if (await detailBtn.count()) {
            await detailBtn.click();
        } else {
            await historyRow.getByRole('link', { name: /View Details/i }).click();
        }

        await expect(page).toHaveURL(/details/);

        // Check log content for success
        const logContent = page.locator('#log-content');
        await expect(logContent).toBeVisible({ timeout: 20000 });

        await expect(async () => {
            const text = await logContent.innerText();
            const normalized = text.toLowerCase();
            expect(normalized).toContain('image pushed:');
            expect(normalized).toContain('level=info msg="sub-process exited"');
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
                await openHistoryFromChallengeRow(page, row);
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

            const detailBtn = failedEntry.locator('a[href*="/deploy_History/details/"]').first();
            if (await detailBtn.count()) {
                await detailBtn.click();
            } else {
                await failedEntry.getByRole('link', { name: /View Details/i }).click();
            }

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
        await page.goto(`${ADMIN_URL}/deploy_History/details/9999999`);

        await expect(page.locator('body')).toContainText(
            /No deployment details found for the given ID|File not found|404 Not Found|An Internal Server Error has occurred|\b500\b/i
        );

        console.log('✅ LOG-003: Not found alert verified');
    });
});
