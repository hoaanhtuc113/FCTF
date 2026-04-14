import { test, expect, type Page } from '@playwright/test';

const ADMIN_URL = 'https://admin0.fctf.site';

async function loginAdmin(page: Page) {
    await test.step('Login as admin', async () => {
        await page.goto(`${ADMIN_URL}/login`);
        await page.locator('input#name, input[name="name"], input[placeholder*="username" i], input[placeholder*="email" i]').first().fill('admin');
        await page.locator('input#password, input[name="password"], input[placeholder*="password" i]').first().fill('1');
        await page.locator('input#_submit, button[type="submit"], button#_submit, form button').first().click();
        await expect(page).toHaveURL(/.*admin.*/, { timeout: 15000 });
    });
}

/**
 * Navigate to users page with GET params — the form is GET-based.
 */
async function searchUser(page: Page, field: string, query: string) {
    const params = new URLSearchParams({ field, q: query });
    await page.goto(`${ADMIN_URL}/admin/users?${params.toString()}`);
    await page.locator('#teamsboard').waitFor({ state: 'visible', timeout: 30000 });
}

async function applyFilter(page: Page, filters: Record<string, string>) {
    const params = new URLSearchParams(filters);
    await page.goto(`${ADMIN_URL}/admin/users?${params.toString()}`);
    await page.locator('#teamsboard').waitFor({ state: 'visible', timeout: 30000 });
}

/** Check if the table has real data rows */
async function hasDataRows(page: Page): Promise<boolean> {
    const rows = page.locator('#teamsboard tbody tr');
    const count = await rows.count();
    if (count === 0) return false;
    const firstText = await rows.first().innerText();
    return !firstText.includes('No data');
}

test.describe('Admin User Search & Filter Tests (FILT-USER)', () => {
    test.setTimeout(60000);

    test.beforeEach(async ({ page }) => {
        await loginAdmin(page);
    });

    // ---------- Search ----------

    test('FILT-USER-001: Search user by exact Name', async ({ page }) => {
        await searchUser(page, 'name', 'user1');
        expect(await hasDataRows(page)).toBeTruthy();
    });

    test('FILT-USER-002: Search users by partial Name', async ({ page }) => {
        await searchUser(page, 'name', 'admin');
        expect(await hasDataRows(page)).toBeTruthy();
    });

    test('FILT-USER-003: Search Name not found', async ({ page }) => {
        await searchUser(page, 'name', 'nonexistent_user_xyz');
        expect(await hasDataRows(page)).toBeFalsy();
    });

    test('FILT-USER-004: Search user by exact ID', async ({ page }) => {
        await searchUser(page, 'id', '1');
        expect(await hasDataRows(page)).toBeTruthy();
    });

    test('FILT-USER-005: Search ID not found', async ({ page }) => {
        await searchUser(page, 'id', '999999');
        expect(await hasDataRows(page)).toBeFalsy();
    });

    test('FILT-USER-006: Search Email partial', async ({ page }) => {
        await searchUser(page, 'email', 'example.com');
        // Just verify page loads ok
        await expect(page.locator('#teamsboard')).toBeVisible();
    });

    // ---------- Dropdown Filters ----------

    test('FILT-USER-007: Filter by Role - Admin', async ({ page }) => {
        await applyFilter(page, { role: 'admin' });
        expect(await hasDataRows(page)).toBeTruthy();
    });

    test('FILT-USER-008: Filter by Role - User', async ({ page }) => {
        await applyFilter(page, { role: 'user' });
        expect(await hasDataRows(page)).toBeTruthy();
    });

    test('FILT-USER-009: Filter by Verified', async ({ page }) => {
        await applyFilter(page, { verified: 'true' });
        await expect(page.locator('#teamsboard')).toBeVisible();
    });

    test('FILT-USER-010: Filter by Not Verified', async ({ page }) => {
        await applyFilter(page, { verified: 'false' });
        await expect(page.locator('#teamsboard')).toBeVisible();
    });

    test('FILT-USER-011: Filter by Hidden', async ({ page }) => {
        await applyFilter(page, { hidden: 'true' });
        await expect(page.locator('#teamsboard')).toBeVisible();
    });

    test('FILT-USER-012: Filter by Not Hidden', async ({ page }) => {
        await applyFilter(page, { hidden: 'false' });
        await expect(page.locator('#teamsboard')).toBeVisible();
    });

    test('FILT-USER-013: Filter by Banned', async ({ page }) => {
        await applyFilter(page, { banned: 'true' });
        await expect(page.locator('#teamsboard')).toBeVisible();
    });

    test('FILT-USER-014: Filter by Not Banned', async ({ page }) => {
        await applyFilter(page, { banned: 'false' });
        await expect(page.locator('#teamsboard')).toBeVisible();
    });
});
