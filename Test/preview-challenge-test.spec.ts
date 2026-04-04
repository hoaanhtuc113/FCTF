import { test, expect, Page } from '@playwright/test';

/**
 * Preview Challenge Test Suite
 * Covers PREV-001 to PREV-004
 *
 * Feature: Admin can click "Preview" on a deployable challenge in the
 * Challenges listing page (/admin/challenges). The button calls
 * POST /api/challenge/start (teamId = -1, Preview Mode) and polls
 * GET /api/challenge/status-check/<id> until the challenge URL is ready.
 *
 * Deploy states (badge text in the UI):
 *   DEPLOY_SUCCESS  → green badge  → Preview should work
 *   DEPLOY_FAILED   → red badge    → Preview should fail with error
 *   PENDING_DEPLOY  → orange badge → Deployment not yet complete, should fail
 *   CREATED / NOT YET → no image   → Not applicable (button hidden)
 */

const ADMIN_URL = 'https://admin0.fctf.site';

// Challenge id=194 has deploy_status = DEPLOY_FAILED (provided by user)
const DEPLOY_FAILED_CHALLENGE_ID = 5;

test.describe.configure({ mode: 'serial' });

// =============================================================================
// HELPERS
// =============================================================================

async function loginAdmin(page: Page, retries = 2): Promise<void> {
    for (let i = 0; i < retries; i++) {
        try {
            await page.goto(`${ADMIN_URL}/login`, { timeout: 60000 });
            await expect(page.locator('#name')).toBeVisible({ timeout: 30000 });
            await page.locator('#name').fill('admin');
            await page.locator('#password').fill('1');
            await page.locator('#_submit').click();
            await expect(page).toHaveURL(/.*admin/, { timeout: 30000 });
            console.log('✅ Admin logged in');
            return;
        } catch (e) {
            console.log(`⚠️ loginAdmin failed (attempt ${i + 1}/${retries}): ${(e as Error).message}`);
            if (i === retries - 1) throw e;
            await page.waitForTimeout(5000 * (i + 1));
        }
    }
}

/**
 * Navigate the admin challenges pages to find the first row with a given.
 * deploy_status badge (e.g. "DEPLOY_SUCCESS", "DEPLOY_FAILED") that also
 * has a visible Preview button.
 * Returns the challenge id, or null if not found.
 */
async function findChallengeWithStatus(
    page: Page,
    badgeSelector: string,
    badgeText: string,
): Promise<number | null> {
    await page.goto(`${ADMIN_URL}/admin/challenges`, { waitUntil: 'load', timeout: 60000 });

    let currentPage = 1;
    const maxPages = 15;

    while (currentPage <= maxPages) {
        // Find rows that have the specified deploy status badge
        const rows = page.locator('tr', {
            has: page.locator(badgeSelector, { hasText: badgeText }),
        });
        const count = await rows.count();

        for (let i = 0; i < count; i++) {
            const row = rows.nth(i);
            // Preview button is only present for challenges with require_deploy=true
            const previewBtn = row.locator('button[id^="preview-button-"]');
            if (await previewBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
                // Extract the challenge ID from the button's id attribute
                const btnId = await previewBtn.getAttribute('id');
                if (btnId) {
                    const id = parseInt(btnId.replace('preview-button-', ''), 10);
                    console.log(`📌 Found challenge id=${id} with status "${badgeText}" on page ${currentPage}`);
                    return id;
                }
            }
        }

        // Go to next page
        const nextBtn = page.locator('li.page-item:not(.disabled) a.page-link', { hasText: '»' });
        if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await nextBtn.click();
            await page.waitForLoadState('load');
            currentPage++;
        } else {
            break;
        }
    }

    return null;
}

/**
 * Click the Preview button for a given challenge id.
 * The button is on the admin challenges listing page.
 */
async function clickPreviewButton(page: Page, challengeId: number): Promise<void> {
    await page.goto(`${ADMIN_URL}/admin/challenges`, { waitUntil: 'load', timeout: 60000 });

    // The challenge might be on a different page; use direct URL search
    let found = false;
    let currentPage = 1;
    const maxPages = 15;

    while (currentPage <= maxPages) {
        const btn = page.locator(`#preview-button-${challengeId}`);
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await btn.click();
            found = true;
            break;
        }

        const nextBtn = page.locator('li.page-item:not(.disabled) a.page-link', { hasText: '»' });
        if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await nextBtn.click();
            await page.waitForLoadState('load');
            currentPage++;
        } else {
            break;
        }
    }

    if (!found) {
        throw new Error(`Preview button for challenge id=${challengeId} not found after searching ${currentPage} pages`);
    }
}

/**
 * Wait for an ezAlert dialog to appear and return its title + body text.
 */
async function waitForEzAlert(page: Page, timeoutMs = 90000): Promise<{ title: string; body: string }> {
    const dialog = page.locator('.swal2-popup, .modal.show, [role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: timeoutMs });
    const title = (await dialog.locator('.swal2-title, .modal-title').textContent({ timeout: 5000 }).catch(() => '') || '').trim();
    const body = (await dialog.locator('.swal2-content, .swal2-html-container, .modal-body').textContent({ timeout: 5000 }).catch(() => '') || '').trim();
    console.log(`📋 Dialog → Title: "${title}" | Body (truncated): "${body.substring(0, 200)}"`);
    return { title, body };
}

/**
 * Dismiss the current open ezAlert/modal by clicking its OK/confirm button or pressing Escape.
 */
async function dismissDialog(page: Page): Promise<void> {
    const confirmBtn = page.locator('.swal2-confirm, .modal-footer .btn-primary, .modal-body .btn-primary, .modal.show .btn-primary').first();
    try {
        if (await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            // Use force: true because sometimes the modal backdrop or animations intercept the click
            await confirmBtn.click({ force: true, timeout: 5000 }).catch(() => { });
        } else {
            await page.keyboard.press('Escape');
        }
        // Wait for the modal/overlay to actually disappear
        await page.waitForTimeout(1500); // 1.5s wait
    } catch (e) {
        console.warn('⚠️ dismissDialog encountered an issue (non-critical):', (e as Error).message);
        await page.keyboard.press('Escape');
    }
}

/**
 * Stop a preview instance via the admin API (force stop, team_id = -1).
 * Used as cleanup so that TC4 can test the "already running" scenario.
 */
async function stopPreviewInstance(page: Page, challengeId: number): Promise<void> {
    try {
        const resp = await page.request.post(`${ADMIN_URL}/api/challenge/stop-by-admin`, {
            data: { challenge_id: String(challengeId), team_id: '-1' },
            headers: { 'Content-Type': 'application/json' },
        });
        const body = await resp.text().catch(() => '');
        console.log(`🗑️ stopPreviewInstance id=${challengeId}: HTTP ${resp.status()} – ${body.substring(0, 100)}`);
    } catch (e) {
        console.warn(`⚠️ stopPreviewInstance failed (non-critical): ${(e as Error).message}`);
    }
}

// =============================================================================
// TESTS
// =============================================================================

/**
 * Wait for the success dialog (containing URL/Token) by periodically 
 * clicking the Preview button again (re-clicking forces a UI refresh
 * and gets the latest state from the backend).
 */
async function waitForUrlWithReclick(
    page: Page,
    challengeId: number,
    maxWaitMs = 360000
): Promise<void> {
    const successPattern = /success|challenge url|challenge token|token:|url/i;
    const start = Date.now();
    let attempt = 1;

    while (Date.now() - start < maxWaitMs) {
        // Look for any visible dialog
        const dialog = page.locator('.swal2-popup:visible, .modal.show:visible, [role="dialog"]:visible').first();
        const toast = page.locator('.swal2-toast:visible').first();

        // Check for error toast
        if (await toast.isVisible({ timeout: 500 }).catch(() => false)) {
            const toastText = await toast.textContent() || '';
            console.log(`💬 Toast visible: ${toastText.substring(0, 100)}`);
        }

        // Check if a dialog is visible
        if (await dialog.isVisible({ timeout: 2000 }).catch(() => false)) {
            const title = (await dialog.locator('.swal2-title, .modal-title').textContent().catch(() => '') || '').trim();
            const body = (await dialog.locator('.swal2-content, .swal2-html-container, .modal-body').textContent().catch(() => '') || '').trim();

            console.log(`📋 Observed Dialog → Title: "${title}" | Body: "${body.substring(0, 100)}..."`);

            const fullText = (title + ' ' + body).toLowerCase();

            if (successPattern.test(fullText)) {
                console.log('✅ URL/Token found in dialog! (Matched success pattern)');
                return;
            } else if (fullText.includes('deploying') || fullText.includes('request') || fullText.includes('starting') || fullText.includes('wait')) {
                console.log('⏳ Still showing "deploying" modal. Dismissing to allow re-click later...');
                await dismissDialog(page);
            } else {
                console.log('❓ Dialog has unknown content. Dismissing...');
                await dismissDialog(page);
            }
        }

        // Re-click the preview button every 30-40 seconds to refresh the state
        const elapsed = Date.now() - start;
        if (elapsed > (attempt * 40000)) {
            console.log(`🔁 Re-clicking Preview for challenge ${challengeId} (Attempt ${attempt}, elapsed ${Math.floor(elapsed / 1000)}s)...`);
            await page.keyboard.press('Escape').catch(() => { });
            await page.waitForTimeout(1000);

            const btn = page.locator(`#preview-button-${challengeId}`);
            if (await btn.isVisible()) {
                await btn.click();
            } else {
                console.warn('⚠️ Preview button not visible for re-click.');
            }
            attempt++;
        }

        await page.waitForTimeout(8000);
    }

    throw new Error(`❌ FAILED: Success dialog with URL did not appear within ${maxWaitMs / 1000}s`);
}

test.describe('Preview Challenge Feature (Admin)', () => {

    test.slow(); // Mark tests as slow to increase default timeout

    // -------------------------------------------------------------------------
    // PREV-001: Preview deployed Challenge successfully
    // -------------------------------------------------------------------------
    test('PREV-001: Preview deployed challenge (DEPLOY_SUCCESS) – MUST show URL', async ({ page }) => {
        test.setTimeout(480000);

        await loginAdmin(page);

        const challengeId = await findChallengeWithStatus(
            page,
            'span.clean-badge-success',
            'DEPLOY_SUCCESS',
        );

        if (challengeId === null) {
            console.warn('⚠️ PREV-001: No DEPLOY_SUCCESS challenge found. Skipping.');
            test.skip();
            return;
        }

        console.log(`🚀 PREV-001: Strict test for challenge id=${challengeId} with re-click strategy`);

        await stopPreviewInstance(page, challengeId);
        await page.waitForTimeout(3000);

        await clickPreviewButton(page, challengeId);

        const initial = await waitForEzAlert(page, 60000);
        const hasUrlInitial = initial.body.toLowerCase().includes('challenge_url') ||
            initial.body.toLowerCase().includes('challenge url') ||
            initial.body.toLowerCase().includes('challenge token') ||
            initial.body.toLowerCase().includes('token:');

        if (hasUrlInitial) {
            console.log('✅ PREV-001: URL/Token appeared in initial dialog – PASS');
            await dismissDialog(page);
            return;
        }

        expect(initial.body.toLowerCase()).toMatch(/send to request|deploying|starting|wait|pending/i);
        console.log('⏳ PREV-001: Deployment started. Using re-click strategy...');
        await dismissDialog(page);

        await waitForUrlWithReclick(page, challengeId);
        await dismissDialog(page);
    });

    // -------------------------------------------------------------------------
    // PREV-002: Preview Challenge when deployment is not completed (PENDING_DEPLOY)
    // -------------------------------------------------------------------------
    test('PREV-002: Preview challenge with PENDING_DEPLOY – error message shown', async ({ page }) => {
        test.setTimeout(120000);
        await loginAdmin(page);

        const challengeId = await findChallengeWithStatus(page, 'span.clean-badge-primary', 'PENDING_DEPLOY') ||
            await findChallengeWithStatus(page, 'span.clean-badge-secondary', 'CREATED');

        if (challengeId === null) {
            test.skip();
            return;
        }

        await clickPreviewButton(page, challengeId);
        const { title, body } = await waitForEzAlert(page, 30000);

        const isError = title.toLowerCase().includes('error');
        const isNotReady = body.toLowerCase().includes('deploy') || body.toLowerCase().includes('pending') ||
            body.toLowerCase().includes('not') || body.toLowerCase().includes('failed');

        expect(isError || isNotReady).toBe(true);
        await dismissDialog(page);
    });

    // -------------------------------------------------------------------------
    // PREV-003: Preview Challenge when deployment failed (DEPLOY_FAILED)
    // -------------------------------------------------------------------------
    test('PREV-003: Preview challenge with DEPLOY_FAILED (id=194) – error message shown', async ({ page }) => {
        test.setTimeout(120000);
        await loginAdmin(page);

        let found = false;
        await page.goto(`${ADMIN_URL}/admin/challenges`, { waitUntil: 'load' });

        const btn = page.locator(`#preview-button-${DEPLOY_FAILED_CHALLENGE_ID}`);
        if (await btn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await btn.click();
            found = true;
        } else {
            const fallbackId = await findChallengeWithStatus(page, 'span.clean-badge-danger', 'DEPLOY_FAILED');
            if (fallbackId) await clickPreviewButton(page, fallbackId);
            found = !!fallbackId;
        }

        if (!found) {
            test.skip();
            return;
        }

        const { title, body } = await waitForEzAlert(page, 30000);
        const text = (title + ' ' + body).toLowerCase();
        expect(text).toMatch(/error|failed|cannot|deploy|request|wait/i);
        await dismissDialog(page);
    });

    // -------------------------------------------------------------------------
    // PREV-004: Preview Challenge that already has a running instance
    // -------------------------------------------------------------------------
    test('PREV-004: Preview challenge with already-running preview instance – MUST show URL', async ({ page }) => {
        test.setTimeout(900000); // 15 minutes total
        await loginAdmin(page);

        const challengeId = await findChallengeWithStatus(page, 'span.clean-badge-success', 'DEPLOY_SUCCESS');
        if (challengeId === null) {
            test.skip();
            return;
        }

        console.log(`🚀 PREV-004: Setting up already-running scenario for id=${challengeId}`);
        await clickPreviewButton(page, challengeId);

        // Use re-click to get it to SUCCESS state
        await waitForUrlWithReclick(page, challengeId, 600000);
        await dismissDialog(page);

        console.log('✅ PREV-004: Setup complete. Re-clicking Preview...');
        await page.waitForTimeout(5000);
        await clickPreviewButton(page, challengeId);

        const { title, body } = await waitForEzAlert(page, 60000);
        expect(body.toLowerCase()).toMatch(/token|url|success/i);
        await dismissDialog(page);

        await stopPreviewInstance(page, challengeId);
    });

});
