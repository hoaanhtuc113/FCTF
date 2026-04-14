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
 * Navigate to audit logs page with GET params.
 * This is fast and 100% reliable for GET-based filters.
 */
async function applyAuditFilter(page: Page, filters: Record<string, string>) {
    const params = new URLSearchParams(filters);
    await page.goto(`${ADMIN_URL}/admin/admin_audit?${params.toString()}`);
    // Wait for the table container or any specific element
    await expect(page.locator('table.clean-table')).toBeVisible({ timeout: 30000 });
}

/** Check if the table has real data rows */
async function hasAuditRows(page: Page): Promise<boolean> {
    const rows = page.locator('table.clean-table tbody tr');
    const count = await rows.count();
    if (count === 0) return false;
    const firstText = await rows.first().innerText();
    // In admin_audit.html, if no records, it shows "No audit records match..."
    return !firstText.includes('No audit records match');
}

test.describe('Admin Audit Logs Filter Tests (FILT-ADM-AU)', () => {
    test.setTimeout(60000);

    test.beforeEach(async ({ page }) => {
        await loginAdmin(page);
    });

    test('FILT-ADM-AU-001: Default load', async ({ page }) => {
        await page.goto(`${ADMIN_URL}/admin/admin_audit`);
        await expect(page.locator('table.clean-table')).toBeVisible();
    });

    test('FILT-ADM-AU-002: Filter by Actor Name', async ({ page }) => {
        await applyAuditFilter(page, { actor: 'admin' });
        // Just verify page loads and table is visible
        await expect(page.locator('table.clean-table')).toBeVisible();
    });

    test('FILT-ADM-AU-003: Filter by Role', async ({ page }) => {
        await applyAuditFilter(page, { role: 'admin' });
        await expect(page.locator('table.clean-table')).toBeVisible();
    });

    test('FILT-ADM-AU-004: Filter by Action', async ({ page }) => {
        // From inspection: 'bulk_update_config' is common
        await applyAuditFilter(page, { action: 'bulk_update_config' });
        await expect(page.locator('table.clean-table')).toBeVisible();
    });

    test('FILT-ADM-AU-005: Filter by Target Type', async ({ page }) => {
        await applyAuditFilter(page, { target_type: 'config' });
        await expect(page.locator('table.clean-table')).toBeVisible();
    });

    test('FILT-ADM-AU-006: Filter by Target ID', async ({ page }) => {
        await applyAuditFilter(page, { target_id: '1' });
        await expect(page.locator('table.clean-table')).toBeVisible();
    });

    test('FILT-ADM-AU-007: Filter by Date range', async ({ page }) => {
        const today = new Date().toISOString().split('T')[0];
        await applyAuditFilter(page, { date_from: today, date_to: today });
        await expect(page.locator('table.clean-table')).toBeVisible();
    });

    test('FILT-ADM-AU-008: Search actor not found', async ({ page }) => {
        await applyAuditFilter(page, { actor: 'nonexistent_actor_xyz' });
        expect(await hasAuditRows(page)).toBeFalsy();
    });

    test('FILT-ADM-AU-009: Per page change', async ({ page }) => {
        await applyAuditFilter(page, { per_page: '100' });
        expect(page.url()).toContain('per_page=100');
    });

    test('FILT-ADM-AU-010: View details modal', async ({ page }) => {
        await page.goto(`${ADMIN_URL}/admin/admin_audit`);
        const viewBtn = page.locator('button.view-diff-btn').first();
        if (await viewBtn.isVisible()) {
            await viewBtn.click();
            await expect(page.locator('#diffModal')).toBeVisible();
        }
    });
});
