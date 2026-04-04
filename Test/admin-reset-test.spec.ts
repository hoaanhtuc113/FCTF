import { test, expect, Page } from '@playwright/test';

const ADMIN_URL = 'https://admin0.fctf.site';
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

/**
 * ⚠️ WARNING: DO NOT EXECUTE THESE TESTS ON PRODUCTION.
 * They will permanently delete data from the CTFd instance.
 * These tests are written for code review and dry-run purposes only.
 */
test.describe('UC-RESET: Admin CTFd Reset Functionality', () => {

    test.beforeEach(async ({ page }) => {
        await loginAdmin(page);
        await navigateToResetPage(page);
    });

    // ─── RST-01: Verify Reset Page UI ────────────────────────────
    test('RST-01: Verify all reset options and warning are displayed', async ({ page }) => {
        // Warning message about permanent deletion
        await expect(page.locator('.alert-danger')).toContainText('PERMANENTLY');

        // All 4 checkboxes
        await expect(page.locator('input[name="accounts"]')).toBeVisible();
        await expect(page.locator('input[name="submissions"]')).toBeVisible();
        await expect(page.locator('input[name="challenges"]')).toBeVisible();
        await expect(page.locator('input[name="logs"]')).toBeVisible();

        // Descriptions for each option
        await expect(page.locator('text=Users, Teams, Submissions, Tracking, Tokens, Tickets, Action Logs, Field Entries')).toBeVisible();
        await expect(page.locator('text=Submissions, Awards, Unlocks, Tracking')).toBeVisible();
        await expect(page.locator('text=Challenges, Flags, Hints, Tags, Topics, Challenge Files, Versions, Deploy Histories, Start Tracking, Badges')).toBeVisible();
        await expect(page.locator('text=Action Logs, Admin Audit Logs')).toBeVisible();

        // Submit button
        await expect(page.locator('#reset-ctf-form button[type="submit"], #reset-ctf-form input[type="submit"]').first()).toBeVisible();

        // Link to export/backup
        await expect(page.locator('a[href*="backup"]')).toBeVisible();
    });

    // ─── RST-02: Reset Accounts ──────────────────────────────────
    test('RST-02: Reset Accounts — all users/teams deleted, redirects to setup', async ({ page }) => {
        await page.locator('input[name="accounts"]').check();
        await expect(page.locator('input[name="accounts"]')).toBeChecked();

        // Submit
        await page.locator('#reset-ctf-form button[type="submit"], #reset-ctf-form input[type="submit"]').first().click();

        // ezQuery modal appears
        const modal = page.locator('.modal.show, .modal.fade.show');
        await expect(modal).toBeVisible({ timeout: 5_000 });
        await expect(modal).toContainText('Are you sure you want to reset your CTFd instance?');

        // Confirm
        const confirmBtn = modal.locator('.modal-footer button').filter({ hasText: /(Yes|Confirm|OK)/i }).first();
        await confirmBtn.click();

        // After deleting accounts, backend sets setup=False and redirects to /setup
        await page.waitForURL(/\/setup/, { timeout: 30_000 });
        await expect(page).toHaveURL(/\/setup/);
    });

    // ─── RST-03: Reset Submissions ───────────────────────────────
    test('RST-03: Reset Submissions — all submissions/awards/unlocks deleted', async ({ page }) => {
        await page.locator('input[name="submissions"]').check();

        await page.locator('#reset-ctf-form button[type="submit"], #reset-ctf-form input[type="submit"]').first().click();

        const modal = page.locator('.modal.show, .modal.fade.show');
        await expect(modal).toBeVisible({ timeout: 5_000 });
        const confirmBtn = modal.locator('.modal-footer button').filter({ hasText: /(Yes|Confirm|OK)/i }).first();
        await confirmBtn.click();

        // Redirects to admin statistics (not /setup since accounts are kept)
        await page.waitForURL(/\/admin/, { timeout: 30_000 });

        // Verify: go to submissions page, table should be empty
        await page.goto(`${ADMIN_URL}/admin/submissions`, { waitUntil: 'domcontentloaded' });
        const rows = page.locator('#teamsboard tbody tr');
        await expect(rows).toHaveCount(0, { timeout: 10_000 });
    });

    // ─── RST-04: Reset Challenges ────────────────────────────────
    test('RST-04: Reset Challenges — all challenges and related data deleted', async ({ page }) => {
        await page.locator('input[name="challenges"]').check();

        await page.locator('#reset-ctf-form button[type="submit"], #reset-ctf-form input[type="submit"]').first().click();

        const modal = page.locator('.modal.show, .modal.fade.show');
        await expect(modal).toBeVisible({ timeout: 5_000 });
        const confirmBtn = modal.locator('.modal-footer button').filter({ hasText: /(Yes|Confirm|OK)/i }).first();
        await confirmBtn.click();

        await page.waitForURL(/\/admin/, { timeout: 30_000 });

        // Verify: go to challenges page, no challenges should be listed
        await page.goto(`${ADMIN_URL}/admin/challenges`, { waitUntil: 'domcontentloaded' });
        const challengeRows = page.locator('#challenges tbody tr, .challenge-row');
        await expect(challengeRows).toHaveCount(0, { timeout: 10_000 });
    });

    // ─── RST-05: Reset Logs ──────────────────────────────────────
    test('RST-05: Reset Logs — all action logs and audit logs deleted', async ({ page }) => {
        await page.locator('input[name="logs"]').check();

        await page.locator('#reset-ctf-form button[type="submit"], #reset-ctf-form input[type="submit"]').first().click();

        const modal = page.locator('.modal.show, .modal.fade.show');
        await expect(modal).toBeVisible({ timeout: 5_000 });
        const confirmBtn = modal.locator('.modal-footer button').filter({ hasText: /(Yes|Confirm|OK)/i }).first();
        await confirmBtn.click();

        await page.waitForURL(/\/admin/, { timeout: 30_000 });

        // Verify: navigate to action logs page, should be empty
        await page.goto(`${ADMIN_URL}/admin/action_logs`, { waitUntil: 'domcontentloaded' });
        const logRows = page.locator('table tbody tr, .log-entry');
        await expect(logRows).toHaveCount(0, { timeout: 10_000 });
    });

    // ─── RST-06: Reset All Options ───────────────────────────────
    test('RST-06: Reset All — select all options and confirm', async ({ page }) => {
        await page.locator('input[name="accounts"]').check();
        await page.locator('input[name="submissions"]').check();
        await page.locator('input[name="challenges"]').check();
        await page.locator('input[name="logs"]').check();

        await page.locator('#reset-ctf-form button[type="submit"], #reset-ctf-form input[type="submit"]').first().click();

        const modal = page.locator('.modal.show, .modal.fade.show');
        await expect(modal).toBeVisible({ timeout: 5_000 });
        const confirmBtn = modal.locator('.modal-footer button').filter({ hasText: /(Yes|Confirm|OK)/i }).first();
        await confirmBtn.click();

        // Since accounts are included, redirects to /setup
        await page.waitForURL(/\/setup/, { timeout: 30_000 });
        await expect(page).toHaveURL(/\/setup/);
    });

    // ─── RST-07: Cancel Reset Modal ──────────────────────────────
    test('RST-07: Cancel reset modal — no data is deleted', async ({ page }) => {
        await page.locator('input[name="submissions"]').check();

        await page.locator('#reset-ctf-form button[type="submit"], #reset-ctf-form input[type="submit"]').first().click();

        const modal = page.locator('.modal.show, .modal.fade.show');
        await expect(modal).toBeVisible({ timeout: 5_000 });

        // Close/Cancel
        const cancelBtn = modal.locator('button[data-dismiss="modal"], button.close').first();
        await cancelBtn.click();

        await expect(modal).not.toBeVisible();
        // Still on reset page
        await expect(page).toHaveURL(/\/admin\/reset/);

        // Verify submissions are NOT deleted
        await page.goto(`${ADMIN_URL}/admin/submissions`, { waitUntil: 'domcontentloaded' });
        const rows = page.locator('#teamsboard tbody tr');
        const count = await rows.count();
        expect(count).toBeGreaterThan(0);
    });

    // ─── RST-08: Submit without selecting any option ─────────────
    test('RST-08: Submit without selecting any option — nothing happens', async ({ page }) => {
        // Ensure nothing is checked
        await expect(page.locator('input[name="accounts"]')).not.toBeChecked();
        await expect(page.locator('input[name="submissions"]')).not.toBeChecked();
        await expect(page.locator('input[name="challenges"]')).not.toBeChecked();
        await expect(page.locator('input[name="logs"]')).not.toBeChecked();

        await page.locator('#reset-ctf-form button[type="submit"], #reset-ctf-form input[type="submit"]').first().click();

        // Modal should still appear (ezQuery fires regardless)
        const modal = page.locator('.modal.show, .modal.fade.show');
        await expect(modal).toBeVisible({ timeout: 5_000 });
        const confirmBtn = modal.locator('.modal-footer button').filter({ hasText: /(Yes|Confirm|OK)/i }).first();
        await confirmBtn.click();

        // Since no data type was selected, redirect back to admin stats
        await page.waitForURL(/\/admin/, { timeout: 30_000 });

        // Data should remain intact
        await page.goto(`${ADMIN_URL}/admin/users`, { waitUntil: 'domcontentloaded' });
        const userRows = page.locator('#teamsboard tbody tr, table tbody tr');
        const count = await userRows.count();
        expect(count).toBeGreaterThan(0);
    });
});
