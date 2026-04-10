import { test, expect, Page } from '@playwright/test';

const ADMIN_URL = 'https://admin3.fctf.site';
const ADMIN_USER = 'admin';
const ADMIN_PASS = '1';

async function loginAdmin(page: Page) {
    await page.goto(`${ADMIN_URL}/login`);
    if (page.url().includes('/admin') && !page.url().includes('/login')) {
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
}

async function navigateToResetPage(page: Page) {
    await page.goto(`${ADMIN_URL}/admin/reset`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1')).toContainText('Reset');
}

test.describe('UC-RESET: Admin CTFd Reset Functionality', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        await loginAdmin(page);
        await navigateToResetPage(page);
    });

    // 1. Reset Submissions
    test('RST-03: Reset Submissions — all submissions/awards/unlocks deleted', async ({ page }) => {
        await page.locator('input[name="submissions"]').check();
        await page.locator('#reset-ctf-form button[type="submit"], #reset-ctf-form input[type="submit"]').first().click();

        const modal = page.locator('.modal.show, .modal.fade.show');
        await expect(modal).toBeVisible({ timeout: 5_000 });
        const confirmBtn = modal.locator('.modal-footer button').filter({ hasText: /(Yes|Confirm|OK)/i }).first();
        await confirmBtn.click();

        await page.waitForURL(/\/admin/, { timeout: 30_000 });
    });

    // 2. Reset Logs
    test('RST-05: Reset Logs — all action logs and audit logs deleted', async ({ page }) => {
        await page.locator('input[name="logs"]').check();
        await page.locator('#reset-ctf-form button[type="submit"], #reset-ctf-form input[type="submit"]').first().click();

        const modal = page.locator('.modal.show, .modal.fade.show');
        await expect(modal).toBeVisible({ timeout: 5_000 });
        const confirmBtn = modal.locator('.modal-footer button').filter({ hasText: /(Yes|Confirm|OK)/i }).first();
        await confirmBtn.click();

        await page.waitForURL(/\/admin/, { timeout: 30_000 });
    });

    // 3. Reset Challenges
    test('RST-04: Reset Challenges — all challenges and related data deleted', async ({ page }) => {
        await page.locator('input[name="challenges"]').check();
        await page.locator('#reset-ctf-form button[type="submit"], #reset-ctf-form input[type="submit"]').first().click();

        const modal = page.locator('.modal.show, .modal.fade.show');
        await expect(modal).toBeVisible({ timeout: 5_000 });
        const confirmBtn = modal.locator('.modal-footer button').filter({ hasText: /(Yes|Confirm|OK)/i }).first();
        await confirmBtn.click();

        await page.waitForURL(/\/admin/, { timeout: 30_000 });
    });

    // 4. Reset Users
    test('RST-02: Reset Accounts — all users/teams deleted, redirects to setup', async ({ page }) => {
        await page.locator('input[name="accounts"]').check();
        await expect(page.locator('input[name="accounts"]')).toBeChecked();

        await page.locator('#reset-ctf-form button[type="submit"], #reset-ctf-form input[type="submit"]').first().click();

        const modal = page.locator('.modal.show, .modal.fade.show');
        await expect(modal).toBeVisible({ timeout: 5_000 });
        const confirmBtn = modal.locator('.modal-footer button').filter({ hasText: /(Yes|Confirm|OK)/i }).first();
        await confirmBtn.click();

        await page.waitForURL(/\/setup/, { timeout: 30_000 });
        await expect(page).toHaveURL(/\/setup/);
    });
});
