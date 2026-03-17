import { test, expect, Page } from '@playwright/test';

// =============================================================================
// CONFIGURATION
// =============================================================================

const ADMIN_URL = 'https://admin.fctf.site';
const CHALLENGE_GATEWAY_ID = 193;

test.describe.configure({ mode: 'serial' });

// =============================================================================
// HELPERS
// =============================================================================

async function loginAdmin(page: Page) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await page.goto(`${ADMIN_URL}/login`, { timeout: 20_000 });

            if (/\/admin(\/|$)/.test(page.url())) return;

            const usernameInput = page
                .locator('#name, input[name="name"], input[name="username"], input[type="text"]')
                .first();
            const passwordInput = page
                .locator('#password, input[name="password"], input[type="password"]')
                .first();
            const submitButton = page
                .locator('#_submit, button[type="submit"], input[type="submit"]')
                .first();

            await usernameInput.waitFor({ state: 'visible', timeout: 15_000 });
            await usernameInput.fill('admin');
            await passwordInput.fill('1');
            await submitButton.click();
            await expect(page).toHaveURL(/.*admin/, { timeout: 15_000 });
            return;
        } catch (err) {
            if (attempt === 3) throw err;
            await page.waitForTimeout(2_000);
        }
    }
}

/** Navigate to challenge detail page and click the Versions tab */
async function goToVersionsTab(page: Page) {
    await page.goto(`${ADMIN_URL}/admin/challenges/${CHALLENGE_GATEWAY_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
    });
    await expect(page).toHaveURL(new RegExp(`/admin/challenges/${CHALLENGE_GATEWAY_ID}`), {
        timeout: 15_000,
    });

    // Click the Versions tab
    const versionsTab = page
        .locator('#challenge-properties a[href="#versions"]')
        .first();
    await versionsTab.waitFor({ state: 'visible', timeout: 10_000 });
    await versionsTab.click();
    await page.waitForTimeout(1_000);
}

// =============================================================================
// TEST SUITE
// =============================================================================

test.describe('Challenge Version Detail & Rollback (Challenge ID 193)', () => {
    test.setTimeout(120_000);

    test.beforeEach(async ({ page }) => {
        await loginAdmin(page);
    });

    // -------------------------------------------------------------------------
    // VER-01: Versions tab displays version rows with expected columns
    // -------------------------------------------------------------------------
    test('VER-01: Versions tab displays version list with correct columns', async ({ page }) => {
        await goToVersionsTab(page);

        const table = page.locator('#versions-list-container table');
        await expect(table).toBeVisible({ timeout: 10_000 });

        // Verify column headers
        const headerText = await table.locator('thead').textContent();
        expect(headerText).toContain('Ver.');
        expect(headerText).toContain('Image Tag');
        expect(headerText).toContain('Status');

        // Verify at least one version row exists (not the "No versions" placeholder)
        const rows = table.locator('tbody tr');
        const rowCount = await rows.count();
        expect(rowCount).toBeGreaterThanOrEqual(1);

        // Check that a version row contains version number and status badge
        const firstRow = rows.first();
        const firstRowText = await firstRow.textContent();
        expect(firstRowText).toMatch(/v\d+/); // e.g. "v1", "v2"
        // Should contain either ACTIVE or OLD
        const hasStatus = firstRowText!.includes('ACTIVE') || firstRowText!.includes('OLD');
        expect(hasStatus).toBe(true);
    });

    // -------------------------------------------------------------------------
    // VER-02: Click view detail → version detail page shows all basic fields
    // -------------------------------------------------------------------------
    test('VER-02: Version detail page displays all basic information fields', async ({ page }) => {
        await goToVersionsTab(page);

        // Click the first "view detail" eye icon
        const viewDetailLink = page
            .locator('#versions-list-container tbody tr a[title="View detail"]')
            .first();
        await expect(viewDetailLink).toBeVisible({ timeout: 10_000 });
        await viewDetailLink.click();

        // Verify URL pattern
        await expect(page).toHaveURL(
            new RegExp(`/admin/challenges/${CHALLENGE_GATEWAY_ID}/versions/\\d+`),
            { timeout: 15_000 },
        );

        // Verify page header contains version number
        const header = page.locator('.page-header h1');
        await expect(header).toBeVisible({ timeout: 10_000 });
        await expect(header).toContainText('Version');

        // Verify breadcrumb navigation is present
        await expect(page.locator('.breadcrumb-link').first()).toBeVisible();

        // --- Image Information card ---
        const imageCard = page.locator('.detail-card').filter({ hasText: 'Image Information' });
        await expect(imageCard).toBeVisible();
        await expect(imageCard).toContainText('Image Tag');
        await expect(imageCard).toContainText('Exposed Port');
        await expect(imageCard).toContainText('Deploy File');
        await expect(imageCard).toContainText('Status');

        // --- Resource Configuration card ---
        const resourceCard = page.locator('.detail-card').filter({ hasText: 'Resource Configuration' });
        await expect(resourceCard).toBeVisible();
        await expect(resourceCard).toContainText('CPU Limit');
        await expect(resourceCard).toContainText('CPU Request');
        await expect(resourceCard).toContainText('Memory Limit');
        await expect(resourceCard).toContainText('Memory Request');
        await expect(resourceCard).toContainText('gVisor Sandbox');
        await expect(resourceCard).toContainText('Max Deploy Count');

        // --- Metadata card ---
        const metadataCard = page.locator('.detail-card').filter({ hasText: 'Metadata' });
        await expect(metadataCard).toBeVisible();
        await expect(metadataCard).toContainText('Version Number');
        await expect(metadataCard).toContainText('Created By');
        await expect(metadataCard).toContainText('Created At');

        // --- Notes card ---
        const notesCard = page.locator('.detail-card').filter({ hasText: 'Notes' });
        await expect(notesCard).toBeVisible();
    });

    // -------------------------------------------------------------------------
    // VER-03: Active version shows "currently active" banner, no rollback btn
    // -------------------------------------------------------------------------
    test('VER-03: Active version shows active banner and no rollback button', async ({ page }) => {
        await goToVersionsTab(page);

        // Find the row with ACTIVE status and click its view detail link
        const activeRow = page
            .locator('#versions-list-container tbody tr')
            .filter({ hasText: 'ACTIVE' })
            .first();

        // If no active row, skip this test
        if ((await activeRow.count()) === 0) {
            test.skip(true, 'No active version found for this challenge');
            return;
        }

        await activeRow.locator('a[title="View detail"]').click();
        await expect(page).toHaveURL(
            new RegExp(`/admin/challenges/${CHALLENGE_GATEWAY_ID}/versions/\\d+`),
            { timeout: 15_000 },
        );

        // Active banner should be visible
        const activeBanner = page.locator('.active-banner');
        await expect(activeBanner).toBeVisible();
        await expect(activeBanner).toContainText('currently active version');

        // Rollback button should NOT be visible for the active version
        const rollbackBtn = page.locator('#rollback-btn');
        await expect(rollbackBtn).toHaveCount(0);
    });

    // -------------------------------------------------------------------------
    // VER-04: Rollback an OLD version → success, then verify image tag changed
    // -------------------------------------------------------------------------
    test('VER-04: Rollback to an old version and verify image tag is updated', async ({ page }) => {
        await goToVersionsTab(page);

        // Find an OLD (inactive) version row
        const oldRow = page
            .locator('#versions-list-container tbody tr')
            .filter({ hasText: 'OLD' })
            .first();

        if ((await oldRow.count()) === 0) {
            test.skip(true, 'No OLD version found — cannot test rollback');
            return;
        }

        // Capture the image tag of the OLD version before rollback
        const oldImageTag = await oldRow.locator('code').textContent();
        expect(oldImageTag).toBeTruthy();

        // Navigate to the OLD version detail page
        await oldRow.locator('a[title="View detail"]').click();
        await expect(page).toHaveURL(
            new RegExp(`/admin/challenges/${CHALLENGE_GATEWAY_ID}/versions/\\d+`),
            { timeout: 15_000 },
        );

        // Verify Rollback button is visible
        const rollbackBtn = page.locator('#rollback-btn');
        await expect(rollbackBtn).toBeVisible({ timeout: 10_000 });

        // Click rollback button → opens confirmation modal
        await rollbackBtn.click();

        // Verify the confirmation modal appears
        const modal = page.locator('#rollback-modal.show');
        await expect(modal).toBeVisible({ timeout: 5_000 });
        await expect(modal).toContainText('Confirm Rollback');

        // Click confirm
        const confirmBtn = page.locator('#confirm-rollback-btn');
        await expect(confirmBtn).toBeVisible();
        await confirmBtn.click();

        // Wait for success message
        const statusEl = page.locator('#rollback-status');
        await expect(statusEl).toBeVisible({ timeout: 30_000 });
        await expect(statusEl).toHaveClass(/success/, { timeout: 30_000 });

        // Wait for page reload after rollback
        await page.waitForTimeout(3_000);
        await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });

        // The version should now be ACTIVE after rollback  
        const activeBanner = page.locator('.active-banner');
        await expect(activeBanner).toBeVisible({ timeout: 10_000 });

        // Go back to challenge detail to verify the image tag changed
        await page.goto(`${ADMIN_URL}/admin/challenges/${CHALLENGE_GATEWAY_ID}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
        });

        // Navigate to Versions tab and verify the rolled-back version is now ACTIVE
        const versionsTab = page
            .locator('#challenge-properties a[href="#versions"]')
            .first();
        await versionsTab.click();
        await page.waitForTimeout(1_000);

        // Find the row with the same image tag, verify it is ACTIVE now
        const rolledBackRow = page
            .locator('#versions-list-container tbody tr')
            .filter({ hasText: oldImageTag!.trim() })
            .first();

        if ((await rolledBackRow.count()) > 0) {
            await expect(rolledBackRow).toContainText('ACTIVE');
        }
    });

    // -------------------------------------------------------------------------
    // VER-05: Cancel rollback → version stays inactive
    // -------------------------------------------------------------------------
    test('VER-05: Cancel rollback confirmation → version remains inactive', async ({ page }) => {
        await goToVersionsTab(page);

        // Find an OLD (inactive) version row
        const oldRow = page
            .locator('#versions-list-container tbody tr')
            .filter({ hasText: 'OLD' })
            .first();

        if ((await oldRow.count()) === 0) {
            test.skip(true, 'No OLD version found — cannot test cancel rollback');
            return;
        }

        // Navigate to the OLD version detail page
        await oldRow.locator('a[title="View detail"]').click();
        await expect(page).toHaveURL(
            new RegExp(`/admin/challenges/${CHALLENGE_GATEWAY_ID}/versions/\\d+`),
            { timeout: 15_000 },
        );

        // Click rollback button → opens modal
        const rollbackBtn = page.locator('#rollback-btn');
        await expect(rollbackBtn).toBeVisible({ timeout: 10_000 });
        await rollbackBtn.click();

        // Verify modal is open
        const modal = page.locator('#rollback-modal.show');
        await expect(modal).toBeVisible({ timeout: 5_000 });

        // Click Cancel
        const cancelBtn = modal.locator('.btn-cancel');
        await cancelBtn.click();

        // Modal should close
        await expect(modal).not.toBeVisible({ timeout: 3_000 });

        // Rollback button should still be visible (version is still inactive)
        await expect(rollbackBtn).toBeVisible();

        // No success/error status should appear
        const statusEl = page.locator('#rollback-status');
        await expect(statusEl).not.toBeVisible();
    });
});
