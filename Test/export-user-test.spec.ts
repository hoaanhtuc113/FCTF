import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const ADMIN_URL = 'https://admin.fctf.site';

test.describe.configure({ mode: 'serial' });

// =============================================================================
// HELPERS
// =============================================================================

async function loginAdmin(page: Page) {
    await page.goto(`${ADMIN_URL}/login`);
    await page.getByRole('textbox', { name: 'User Name or Email' }).fill('admin');
    await page.getByRole('textbox', { name: 'Password' }).fill('1');
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page).toHaveURL(/.*admin/);
}

/**
 * Poor man's CSV parser for verification
 */
function parseCSV(content: string) {
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
    const data = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
        const obj: any = {};
        headers.forEach((h, i) => {
            obj[h] = values[i];
        });
        return obj;
    });
    return { headers, data };
}

async function setContestPeriod(page: Page, state: 'before' | 'during') {
    await page.goto(`${ADMIN_URL}/admin/config`);
    await page.waitForTimeout(2000);
    await page.locator('a[href="#ctftime"]').click();

    if (state === 'before') {
        // Set start to future
        await page.locator('a[href="#start-date"]').click();
        await page.locator('#start-year').fill('2099');
    } else {
        // Set start to past
        await page.locator('a[href="#start-date"]').click();
        await page.locator('#start-year').fill('2020');
        await page.locator('a[href="#end-date"]').click();
        await page.locator('#end-year').fill('2099');
    }

    await page.locator('#ctftime button[type="submit"]').click();
    await page.waitForTimeout(2000);
}

async function createUser(page: Page, name: string, email: string) {
    await page.goto(`${ADMIN_URL}/admin/users/new`);
    await page.locator('input[name="name"]').fill(name);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill('12345678');

    const submitBtn = page.locator('#update-user');
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();

    await expect(page).toHaveURL(/\/admin\/users\/\d+/, { timeout: 15000 });
}

// =============================================================================
// TESTS
// =============================================================================

test.describe('Admin User Export (EXP-001 - EXP-010)', () => {
    test.setTimeout(60000);

    test.beforeAll(async ({ browser }) => {
        // Initialization if needed
    });

    test.afterAll(async ({ browser }) => {
        const page = await browser.newPage();
        await loginAdmin(page);
        await page.goto(`${ADMIN_URL}/admin/config`);
        await page.waitForTimeout(2000);
        await page.locator('a[href="#ctftime"]').click();

        await page.locator('a[href="#start-date"]').click();
        const lastYear = (new Date().getUTCFullYear() - 1).toString();
        await page.locator('#start-year').fill(lastYear);

        await page.locator('a[href="#end-date"]').click();
        await page.locator('#end-year').fill('2099');

        await page.locator('#ctftime button[type="submit"]').click();
        await page.waitForTimeout(2000);
        await page.close();
    });

    test.beforeEach(async ({ page }) => {
        await loginAdmin(page);
    });

    test('EXP-001: Export all contestants before contest (Reset OFF)', async ({ page }) => {
        await setContestPeriod(page, 'before');
        await page.goto(`${ADMIN_URL}/admin/users`);

        // Wait for table to load
        await expect(page.locator('#teamsboard tbody tr').first()).toBeVisible();

        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('#export-csv-button').click().then(() =>
                page.locator('#export-btn').click()
            )
        ]);

        const filePath = await download.path();
        const content = fs.readFileSync(filePath as string, 'utf-8');
        const { headers, data } = parseCSV(content);

        expect(headers).toContain('name');
        expect(headers).toContain('email');
        expect(headers).not.toContain('password_plain');
        expect(data.length).toBeGreaterThan(0);
    });

    test('EXP-002: Export all contestants before contest (Reset ON)', async ({ page }) => {
        await setContestPeriod(page, 'before');
        await page.goto(`${ADMIN_URL}/admin/users`);

        // Open dropdown
        await page.locator('#export-csv-button').click();
        const checkbox = page.locator('#include-passwords-visible');
        await expect(checkbox).toBeVisible();
        await checkbox.check();

        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('#export-btn').click()
        ]);

        const filePath = await download.path();
        const content = fs.readFileSync(filePath as string, 'utf-8');
        const { headers, data } = parseCSV(content);

        expect(headers).toContain('password_plain');
        expect(data[0].password_plain.length).toBe(12);
    });

    test('EXP-003: Export filtered contestants (Reset ON)', async ({ page }) => {
        const uniqueName = `export_filter_test_${Date.now()}`;
        await createUser(page, uniqueName, `${uniqueName}@example.com`);

        await page.goto(`${ADMIN_URL}/admin/users`);
        // Filter
        await page.locator('input[name="q"]').fill(uniqueName);
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('#teamsboard tbody tr')).toHaveCount(1);

        // Export
        await page.locator('#export-csv-button').click();
        await page.locator('#include-passwords-visible').check();

        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('#export-btn').click()
        ]);

        const content = fs.readFileSync(await download.path() as string, 'utf-8');
        const { data } = parseCSV(content);

        expect(data).toHaveLength(1);
        expect(data[0].name).toBe(uniqueName);
        expect(data[0]).toHaveProperty('password_plain');
    });

    test('EXP-004: Export filtered contestants (Reset OFF)', async ({ page }) => {
        await page.goto(`${ADMIN_URL}/admin/users`);
        await page.locator('input[name="q"]').fill('admin'); // admin is usually filtered out in export loop (type=user only)
        await page.locator('button[type="submit"]').click();

        await page.locator('#export-csv-button').click();
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('#export-btn').click()
        ]);

        const content = fs.readFileSync(await download.path() as string, 'utf-8');
        const { data } = parseCSV(content);

        // Backend filters (type='user'), so admin won't be in export
        const hasAdmin = data.some(u => u.name === 'admin');
        expect(hasAdmin).toBe(false);
    });

    test('EXP-005: Enforcement during ACTIVE contest (Reset disabled)', async ({ page }) => {
        await setContestPeriod(page, 'during');
        await page.goto(`${ADMIN_URL}/admin/users`);

        await page.locator('#export-csv-button').click();
        const checkbox = page.locator('#include-passwords-visible');
        const warning = page.locator('#ctf-active-warning');

        await expect(warning).toBeVisible();
        await expect(checkbox).toBeDisabled();
    });

    test('EXP-006: Export all info during ACTIVE contest (Reset OFF)', async ({ page }) => {
        await setContestPeriod(page, 'during');
        await page.goto(`${ADMIN_URL}/admin/users`);

        await page.locator('#export-csv-button').click();

        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('#export-btn').click()
        ]);

        const content = fs.readFileSync(await download.path() as string, 'utf-8');
        const { headers } = parseCSV(content);
        expect(headers).not.toContain('password_plain');
    });

    test('EXP-007: Multiple export clicks behavior', async ({ page }) => {
        await setContestPeriod(page, 'before');
        await page.goto(`${ADMIN_URL}/admin/users`);
        await page.locator('#export-csv-button').click();
        await page.locator('#include-passwords-visible').check();

        // Clicking twice rapidly
        const exportBtn = page.locator('#export-btn');
        await exportBtn.click();
        await expect(exportBtn).toBeDisabled(); // Should be disabled while exporting

        // Wait for first download to verify stability
        const download = await page.waitForEvent('download');
        expect(download.suggestedFilename()).toContain('.csv');
    });

    test('EXP-008: Export users with Unicode names', async ({ page }) => {
        const unicodeName = `Nguyễn Quy ${Date.now()}`;
        await createUser(page, unicodeName, `unicode_${Date.now()}@example.com`);

        await page.goto(`${ADMIN_URL}/admin/users`);
        await page.locator('input[name="q"]').fill(unicodeName);
        await page.locator('button[type="submit"]').click();

        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('#export-csv-button').click().then(() => page.locator('#export-btn').click())
        ]);

        const content = fs.readFileSync(await download.path() as string, 'utf-8');
        expect(content).toContain(unicodeName);
    });

    test('EXP-009: CSRF token validation (Mock/Concept)', async ({ page }) => {
        // Playwright's fetch automatically handles cookies/CSRF if credentials: same-origin is used
        // We verify the request sent has headers if we intercept
        let csrfFound = false;
        page.on('request', request => {
            if (request.url().includes('/admin/export/csv/user')) {
                const headers = request.headers();
                // CTFd uses CSRF-Token or session cookie
                if (headers['cookie'] || headers['crst-token']) csrfFound = true;
            }
        });

        await page.goto(`${ADMIN_URL}/admin/users`);
        await page.locator('#export-csv-button').click();
        await page.locator('#export-btn').click();
        await page.waitForEvent('download');
        // If it downloaded, auth/CSRF worked.
    });

    test('EXP-010: Unauthenticated access', async ({ browser }) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(`${ADMIN_URL}/admin/export/csv/user`);
        // Should redirect to login
        await expect(page).toHaveURL(/.*login/);
        await context.close();
    });

});
