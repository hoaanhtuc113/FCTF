import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const ADMIN_URL = 'https://admin0.fctf.site';
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

/**
 * Helper to interact with the custom searchable select components
 */
async function selectSearchableValue(page: Page, inputName: string, labelText: string) {
    const wrapper = page.locator(`.ss-wrapper, .searchable-select-wrapper`).filter({
        has: page.locator(`input[name="${inputName}"]`)
    });

    const displayInput = wrapper.locator('input.ss-input');
    await displayInput.click();

    // Check if option is already visible/present
    const option = wrapper.locator('.ss-option').filter({ hasText: new RegExp(`^${labelText}$`, 'i') }).first();

    try {
        if (await option.isVisible({ timeout: 2000 })) {
            await option.click();
        } else {
            // Fill to search if not immediately visible
            await displayInput.fill(labelText);
            await page.waitForTimeout(500);
            await wrapper.locator('.ss-option').filter({ hasText: new RegExp(`^${labelText}$`, 'i') }).first().click();
        }
    } catch (e) {
        console.error(`Failed to select searchable value "${labelText}" for "${inputName}"`);
        throw e;
    }
}

test.describe('Submission Search Functionality - Full Coverage', () => {
    test.beforeEach(async ({ page }) => {
        if (!fs.existsSync('Test/debug_screenshots')) {
            fs.mkdirSync('Test/debug_screenshots', { recursive: true });
        }

        await loginAdmin(page);
        console.log('Navigating to submissions page...');
        await page.goto(`${ADMIN_URL}/admin/submissions`);

        // Wait for the form to be interactive
        await page.locator('#filterForm').waitFor({ state: 'visible', timeout: 30_000 });
        console.log('Submissions page loaded.');
    });

    test('SRCH-01: Search by Provided Content (Flag "a")', async ({ page }) => {
        await selectSearchableValue(page, 'field', 'Provided');
        await page.locator('input[name="q"]').fill('a');
        await page.locator('#filterForm button[type="submit"]').click();

        await expect(page.locator('#teamsboard')).toContainText('a', { timeout: 15_000 });
    });

    test('SRCH-02: Search by Challenge ID (1)', async ({ page }) => {
        await selectSearchableValue(page, 'field', 'Challenge ID');
        await page.locator('input[name="q"]').fill('1');
        await page.locator('#filterForm button[type="submit"]').click();

        const row = page.locator('#teamsboard tbody tr').first();
        await expect(row).toBeVisible();
        const link = row.locator('a[href*="/admin/challenges/1"]');
        await expect(link).toBeVisible();
    });

    test('SRCH-03: Filter by Team Name', async ({ page }) => {
        // Find a team name from the first row to filter by
        const rows = page.locator('#teamsboard tbody tr');
        await expect(rows.first()).toBeVisible();
        const teamName = (await rows.first().locator('td').nth(3).textContent())?.trim();
        if (!teamName) throw new Error('No team name found in table');

        await selectSearchableValue(page, 'team_id', teamName);
        await page.locator('#filterForm button[type="submit"]').click();

        await expect(page.locator('#teamsboard tbody tr').first()).toContainText(teamName);
    });

    test('SRCH-04: Filter by User Name', async ({ page }) => {
        const rows = page.locator('#teamsboard tbody tr');
        await expect(rows.first()).toBeVisible();
        const userName = (await rows.first().locator('td').nth(2).textContent())?.trim();
        if (!userName) throw new Error('No user name found in table');

        await selectSearchableValue(page, 'user_id', userName);
        await page.locator('#filterForm button[type="submit"]').click();

        const firstRow = page.locator('#teamsboard tbody tr').first();
        await expect(firstRow).toBeVisible({ timeout: 10_000 });
        // Use a partial match in case of truncation or weird white spaces
        await expect(firstRow).toContainText(userName.substring(0, Math.min(userName.length, 5)));
    });

    test('SRCH-05: Filter by Date Range', async ({ page }) => {
        await page.locator('#date_from').fill('2024-01-01');
        await page.locator('#date_to').fill('2026-12-31');
        await page.locator('#filterForm button[type="submit"]').click();

        await expect(page.locator('#teamsboard tbody tr').first()).toBeVisible();
    });

    test('SRCH-06: Combined Filters (Pick row ID + Challenge)', async ({ page }) => {
        const rows = page.locator('#teamsboard tbody tr');
        await expect(rows.first()).toBeVisible();
        const firstRowId = (await rows.first().locator('td').nth(1).textContent())?.trim();
        const challengeName = (await rows.first().locator('td').nth(4).textContent())?.trim();

        if (!firstRowId || !challengeName) throw new Error('Data missing for SRCH-06');

        console.log(`Testing SRCH-06 with ID: ${firstRowId} and Challenge: ${challengeName}`);

        // Search by challenge using the searchable select
        await selectSearchableValue(page, 'challenge_id', challengeName);

        // Search by ID field
        await selectSearchableValue(page, 'field', 'ID');
        await page.locator('input[name="q"]').fill(firstRowId);

        await page.locator('#filterForm button[type="submit"]').click();

        const row = page.locator('#teamsboard tbody tr').first();
        await expect(row).toContainText(firstRowId);
        await expect(row).toContainText(challengeName.substring(0, 5));
    });

    test('SRCH-07: Export Submissions', async ({ page }) => {
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('a[title="Export Data"]').click(),
        ]);
        expect(download.url()).toContain('/admin/export_submission_data');
        console.log('Download initiated:', download.suggestedFilename());
    });

    test('SRCH-08: Clear Filters (Reset)', async ({ page }) => {
        // Apply some filters first
        await page.locator('input[name="q"]').fill('testing-reset');
        await page.locator('#filterForm button[type="submit"]').click();
        await expect(page.locator('input[name="q"]')).toHaveValue('testing-reset');

        // Click Reset
        await page.locator('button[onclick="clearAllFilters()"]').click();

        // Verify URL and input are cleared
        await page.waitForURL(/\/admin\/submissions$/, { timeout: 10_000 });
        await expect(page.locator('input[name="q"]')).toHaveValue('');
    });
});
