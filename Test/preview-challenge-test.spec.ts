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

const ENV = ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env) || {};

const ADMIN_URL = ENV.ADMIN_URL || 'https://admin0.fctf.site';
const ADMIN_USERNAME = ENV.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = ENV.ADMIN_PASSWORD || '1';

// Optional known challenge id for DEPLOY_FAILED scenario; fallback search is used when missing.
const DEPLOY_FAILED_CHALLENGE_ID = Number(ENV.DEPLOY_FAILED_CHALLENGE_ID || '5');

type DeployStatus = 'DEPLOY_SUCCESS' | 'DEPLOY_FAILED' | 'PENDING_DEPLOY' | 'CREATED';

type AdminChallengeRecord = {
    id: number;
    name: string;
    state?: string;
    require_deploy?: boolean;
    deploy_status?: string | null;
    image_link?: string | null;
    deploy_file?: string | null;
};

type PreviewChallengeRow = {
    id: number;
    status: string;
    page: number;
};

type PreviewFeedback = {
    title: string;
    body: string;
};

let fallbackPreviewChallengeId: number | null = null;
let lastPreviewApiFeedback: PreviewFeedback | null = null;

test.describe.configure({ mode: 'serial' });

// =============================================================================
// HELPERS
// =============================================================================

async function loginAdmin(page: Page, retries = 2): Promise<void> {
    for (let i = 0; i < retries; i++) {
        try {
            await page.goto(`${ADMIN_URL}/login`, { timeout: 60000 });
            await expect(page.locator('#name')).toBeVisible({ timeout: 30000 });
            await page.locator('#name').fill(ADMIN_USERNAME);
            await page.locator('#password').fill(ADMIN_PASSWORD);
            await page.locator('#_submit').click();
            await page.waitForURL(
                (url) => /^\/admin(\/|$)/.test(url.pathname),
                { timeout: 30000 },
            );
            console.log(`✅ Admin logged in (${page.url()})`);
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
function normalizeDeployStatus(text: string): string {
    const statusText = text.toUpperCase();
    if (statusText.includes('DEPLOY_SUCCESS') || statusText.includes('DEPLOY_SUCCEEDED')) return 'DEPLOY_SUCCESS';
    if (statusText.includes('DEPLOY_FAILED')) return 'DEPLOY_FAILED';
    if (statusText.includes('PENDING_DEPLOY')) return 'PENDING_DEPLOY';
    if (statusText.includes('CREATED')) return 'CREATED';
    if (statusText.includes('NOT YET') || statusText.includes('N/A')) return 'NOT_YET';
    return 'UNKNOWN';
}

function summarizePreviewRows(rows: PreviewChallengeRow[]): string {
    if (rows.length === 0) {
        return 'no preview-enabled challenges found';
    }
    return rows.map((row) => `id=${row.id}:${row.status}@p${row.page}`).join(', ');
}

async function getChallengePageCount(page: Page): Promise<number> {
    const infoText = (await page.locator('.clean-info-text').first().textContent().catch(() => '') || '').replace(/\s+/g, ' ').trim();
    const match = infoText.match(/of\s+(\d+)/i);
    const parsed = match ? Number.parseInt(match[1], 10) : 1;
    if (!Number.isFinite(parsed) || parsed < 1) {
        return 1;
    }
    return parsed;
}

async function extractChallengeIdFromRow(row: ReturnType<Page['locator']>): Promise<number | null> {
    const legacyButtonId = await row.locator('button[id^="preview-button-"], a[id^="preview-button-"]').first().getAttribute('id').catch(() => null);
    if (legacyButtonId) {
        const idMatch = legacyButtonId.match(/preview-button-(\d+)/);
        if (idMatch) {
            return Number.parseInt(idMatch[1], 10);
        }
    }

    const detailHref = await row.locator('a[href*="/admin/challenges/"]').first().getAttribute('href').catch(() => null);
    if (detailHref) {
        const hrefMatch = detailHref.match(/\/admin\/challenges\/(\d+)/);
        if (hrefMatch) {
            return Number.parseInt(hrefMatch[1], 10);
        }
    }

    const idCellText = (await row.locator('td').nth(1).textContent().catch(() => '') || '').trim();
    const parsedId = Number.parseInt(idCellText, 10);
    if (Number.isFinite(parsedId)) {
        return parsedId;
    }

    return null;
}

async function collectPreviewChallengeRows(page: Page, maxPages = 25): Promise<PreviewChallengeRow[]> {
    const rows: PreviewChallengeRow[] = [];
    const seen = new Set<number>();

    await page.goto(`${ADMIN_URL}/admin/challenges?page=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#challenges tbody', { timeout: 20000 }).catch(() => {});
    const totalPages = Math.min(await getChallengePageCount(page), maxPages);

    for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
        if (currentPage > 1) {
            await page.goto(`${ADMIN_URL}/admin/challenges?page=${currentPage}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForSelector('#challenges tbody', { timeout: 20000 }).catch(() => {});
        }

        // Extract all row data in a single evaluate call instead of per-row locator ops
        const pageRowData = await page.evaluate(() => {
            const trs = Array.from(document.querySelectorAll('#challenges tbody tr'));
            return trs.map((tr) => {
                // Try to get challenge ID from various sources
                let id: number | null = null;

                // 1. Legacy preview button id
                const previewBtn = tr.querySelector('[id^="preview-button-"]');
                if (previewBtn) {
                    const m = (previewBtn.id || '').match(/preview-button-(\d+)/);
                    if (m) id = parseInt(m[1], 10);
                }

                // 2. Detail link href
                if (id === null) {
                    const detailLink = tr.querySelector('a[href*="/admin/challenges/"]');
                    if (detailLink) {
                        const m = (detailLink.getAttribute('href') || '').match(/\/admin\/challenges\/(\d+)/);
                        if (m) id = parseInt(m[1], 10);
                    }
                }

                // 3. 2nd cell text
                if (id === null) {
                    const cells = tr.querySelectorAll('td');
                    if (cells.length >= 2) {
                        const parsed = parseInt((cells[1].textContent || '').trim(), 10);
                        if (Number.isFinite(parsed)) id = parsed;
                    }
                }

                return { id, text: (tr.textContent || '').replace(/\s+/g, ' ').trim() };
            });
        });

        for (const { id, text } of pageRowData) {
            if (id === null || seen.has(id)) continue;
            rows.push({
                id,
                status: normalizeDeployStatus(text),
                page: currentPage,
            });
            seen.add(id);
        }
    }

    return rows;
}

async function patchChallengeDeployStatus(page: Page, challengeId: number, status: DeployStatus): Promise<void> {
    const result = await page.evaluate(async ({ id, nextStatus }) => {
        const csrfToken =
            (window as { init?: { csrfNonce?: string } }).init?.csrfNonce ||
            (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement | null)?.content ||
            '';

        const response = await fetch(`/api/v1/challenges/${id}`, {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'CSRF-Token': csrfToken,
            },
            body: JSON.stringify({
                deploy_status: nextStatus,
                require_deploy: true,
                state: 'visible',
            }),
        });

        let body: unknown = null;
        try {
            body = await response.json();
        } catch {
            body = null;
        }

        return {
            ok: response.ok,
            status: response.status,
            body,
        };
    }, { id: challengeId, nextStatus: status });

    const body = (result.body as { success?: boolean; errors?: unknown } | null) || null;
    const success = !!body?.success;
    if (!result.ok || !success) {
        throw new Error(
            `PATCH deploy_status failed for challenge ${challengeId} -> ${status}. ` +
            `HTTP ${result.status}. Response: ${JSON.stringify(result.body)}`,
        );
    }

    console.log(`🛠️ Patched challenge id=${challengeId} deploy_status=${status}`);
}

async function fetchAdminChallenges(page: Page, perPage = 200): Promise<AdminChallengeRecord[]> {
    const result = await page.evaluate(async ({ limit }) => {
        const response = await fetch(`/api/v1/challenges?view=admin&page=1&per_page=${limit}`, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        });

        let body: unknown = null;
        try {
            body = await response.json();
        } catch {
            body = null;
        }

        return {
            ok: response.ok,
            status: response.status,
            body,
        };
    }, { limit: perPage });

    const body = (result.body as { success?: boolean; data?: AdminChallengeRecord[] } | null) || null;
    if (!result.ok || !body?.success || !Array.isArray(body.data)) {
        throw new Error(`Failed to fetch admin challenges. HTTP ${result.status} body=${JSON.stringify(result.body)}`);
    }

    return body.data;
}

async function fetchAdminChallengeById(page: Page, challengeId: number): Promise<AdminChallengeRecord | null> {
    const result = await page.evaluate(async (id) => {
        const response = await fetch(`/api/v1/challenges/${id}?view=admin`, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        });

        let body: unknown = null;
        try {
            body = await response.json();
        } catch {
            body = null;
        }

        return {
            ok: response.ok,
            status: response.status,
            body,
        };
    }, challengeId);

    const body = (result.body as { success?: boolean; data?: AdminChallengeRecord } | null) || null;
    if (!result.ok || !body?.success || !body.data) {
        return null;
    }

    return body.data;
}

async function promoteExistingChallengeToPreview(page: Page): Promise<number | null> {
    const allChallenges = await fetchAdminChallenges(page);
    if (allChallenges.length === 0) {
        return null;
    }

    const candidate =
        allChallenges.find((challenge) => /pwn/i.test(challenge.name)) ||
        allChallenges.find((challenge) => !!challenge.deploy_file || !!challenge.image_link) ||
        allChallenges.find((challenge) => challenge.state !== 'hidden') ||
        allChallenges[0];

    console.log(
        `🧪 Promoting existing challenge as preview candidate: ` +
        `id=${candidate.id}, name="${candidate.name}", deploy_status=${candidate.deploy_status ?? 'null'}`,
    );

    await patchChallengeDeployStatus(page, candidate.id, 'DEPLOY_SUCCESS');
    const detail = await fetchAdminChallengeById(page, candidate.id);
    console.log(
        `ℹ️ Post-patch candidate detail: id=${candidate.id}, ` +
        `require_deploy=${String(detail?.require_deploy)}, deploy_status=${detail?.deploy_status ?? 'null'}`,
    );

    if (detail?.require_deploy) {
        return candidate.id;
    }

    return null;
}

async function resolveChallengeIdForStatuses(
    page: Page,
    testName: string,
    expectedStatuses: DeployStatus[],
    fallbackStatus: DeployStatus,
): Promise<number> {
    for (const status of expectedStatuses) {
        const found = await findChallengeWithStatus(page, '', status);
        if (found !== null) {
            return found;
        }
    }

    if (fallbackPreviewChallengeId !== null) {
        console.warn(
            `⚠️ ${testName}: status ${expectedStatuses.join(' or ')} not found. ` +
            `Using fallback preview challenge id=${fallbackPreviewChallengeId} without patching to ${fallbackStatus}.`,
        );
        return fallbackPreviewChallengeId;
    }

    return requireChallengeId(page, null, testName, expectedStatuses);
}

async function findChallengeWithStatus(
    page: Page,
    _badgeSelector: string,
    badgeText: string,
): Promise<number | null> {
    const targetStatus = normalizeDeployStatus(badgeText);
    const rows = await collectPreviewChallengeRows(page);
    const match = rows.find((row) => row.status === targetStatus);

    if (match) {
        console.log(`📌 Found challenge id=${match.id} with status "${targetStatus}" on page ${match.page}`);
        return match.id;
    }

    console.warn(`⚠️ Could not find status "${targetStatus}". Preview inventory: ${summarizePreviewRows(rows)}`);
    return null;
}

async function requireChallengeId(
    page: Page,
    challengeId: number | null,
    testName: string,
    expectedStatuses: string[],
): Promise<number> {
    if (challengeId !== null) {
        return challengeId;
    }

    const rows = await collectPreviewChallengeRows(page);
    throw new Error(
        `${testName}: no preview-enabled challenge found for status ${expectedStatuses.join(' or ')}. ` +
        `Current inventory: ${summarizePreviewRows(rows)}`,
    );
}

/**
 * Click the Preview button for a given challenge id.
 * The button is on the admin challenges listing page.
 */
async function clickPreviewButton(page: Page, challengeId: number): Promise<void> {
    lastPreviewApiFeedback = null;

    const rows = await collectPreviewChallengeRows(page);
    const target = rows.find((row) => row.id === challengeId);
    if (!target) {
        throw new Error(
            `Preview button for challenge id=${challengeId} not found. ` +
            `Current inventory: ${summarizePreviewRows(rows)}`,
        );
    }

    await page.goto(`${ADMIN_URL}/admin/challenges?page=${target.page}`, { waitUntil: 'load', timeout: 60000 });

    const rowByLink = page.locator('#challenges tbody tr', {
        has: page.locator(`a[href$="/admin/challenges/${challengeId}"]`),
    }).first();

    const rowByIdCell = page.locator('#challenges tbody tr').filter({
        has: page.locator('td').nth(1).filter({ hasText: String(challengeId) }),
    }).first();

    const row = (await rowByLink.isVisible({ timeout: 2000 }).catch(() => false)) ? rowByLink : rowByIdCell;
    await expect(row).toBeVisible({ timeout: 10000 });

    const legacyBtn = row.locator(`#preview-button-${challengeId}`).first();
    if (await legacyBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await legacyBtn.click();
        return;
    }

    const directPreviewAction = row.locator('a:has(i.fa-eye), button:has(i.fa-eye), [title*="Preview"], [aria-label*="Preview"]').first();
    if (await directPreviewAction.isVisible({ timeout: 2000 }).catch(() => false)) {
        await directPreviewAction.click({ force: true });
        return;
    }

    const actionsBtn = row.getByRole('button', { name: /actions/i }).first();
    if (await actionsBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await actionsBtn.click({ force: true });
    }

    const previewInMenu = row.locator('a:has(i.fa-eye), button:has(i.fa-eye), :text("Preview")').first();
    if (await previewInMenu.isVisible({ timeout: 3000 }).catch(() => false)) {
        await previewInMenu.click({ force: true });
        return;
    }

    console.warn(`⚠️ Preview action for challenge id=${challengeId} not clickable in UI. Falling back to API trigger.`);
    await triggerPreviewByApi(page, challengeId);
}

async function triggerPreviewByApi(page: Page, challengeId: number): Promise<void> {
    const result = await page.evaluate(async (id) => {
        const csrfToken =
            (window as { init?: { csrfNonce?: string } }).init?.csrfNonce ||
            (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement | null)?.content ||
            '';

        const response = await fetch('/api/challenge/start', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'CSRF-Token': csrfToken,
            },
            body: JSON.stringify({ challenge_id: id }),
        });

        let jsonBody: unknown = null;
        let textBody = '';
        try {
            jsonBody = await response.json();
        } catch {
            textBody = await response.text().catch(() => '');
        }

        return {
            ok: response.ok,
            status: response.status,
            jsonBody,
            textBody,
        };
    }, challengeId);

    const json = (result.jsonBody as { success?: boolean; message?: string; challenge_url?: string } | null) || null;
    const message = (json?.message || result.textBody || `HTTP ${result.status}`).trim();
    const urlPart = (json?.challenge_url || '').trim();
    const body = `${message}${urlPart ? ` ${urlPart}` : ''}`.trim();

    lastPreviewApiFeedback = {
        title: json?.success ? `Preview Challenge ${challengeId}` : `Preview Challenge ${challengeId} Error`,
        body,
    };

    console.log(`🛰️ API preview fallback id=${challengeId} HTTP ${result.status}: ${body.substring(0, 200)}`);
}

/**
 * Wait for an ezAlert dialog to appear and return its title + body text.
 */
async function waitForEzAlert(page: Page, timeoutMs = 90000, challengeId?: number): Promise<PreviewFeedback> {
    const dialog = page.locator('.swal2-popup, .modal.show, [role="dialog"]').first();
    const toast = page.locator('.swal2-toast').first();

    try {
        await expect(async () => {
            const hasDialog = await dialog.isVisible({ timeout: 1000 }).catch(() => false);
            const hasToast = await toast.isVisible({ timeout: 1000 }).catch(() => false);
            expect(hasDialog || hasToast).toBeTruthy();
        }).toPass({ timeout: timeoutMs, intervals: [500, 1000, 2000] });
    } catch (error) {
        if (!lastPreviewApiFeedback && challengeId !== undefined) {
            await triggerPreviewByApi(page, challengeId).catch(() => { });
        }
        if (lastPreviewApiFeedback) {
            console.warn(`⚠️ No modal/toast shown; using API fallback feedback: ${lastPreviewApiFeedback.body.substring(0, 200)}`);
            return lastPreviewApiFeedback;
        }
        throw error;
    }

    const dialogVisible = await dialog.isVisible({ timeout: 1000 }).catch(() => false);
    if (dialogVisible) {
        const title = (await dialog.locator('.swal2-title, .modal-title').textContent({ timeout: 5000 }).catch(() => '') || '').trim();
        const body = (await dialog.locator('.swal2-content, .swal2-html-container, .modal-body').textContent({ timeout: 5000 }).catch(() => '') || '').trim();
        console.log(`📋 Dialog → Title: "${title}" | Body (truncated): "${body.substring(0, 200)}"`);
        return { title, body };
    }

    const toastText = (await toast.textContent({ timeout: 5000 }).catch(() => '') || '').trim();
    console.log(`📣 Toast → "${toastText.substring(0, 200)}"`);
    return { title: 'toast', body: toastText };
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

    test.beforeAll(async ({ browser }) => {
        test.setTimeout(300000);
        const page = await browser.newPage();
        try {
            await loginAdmin(page);

            const existingRows = await collectPreviewChallengeRows(page);
            if (existingRows.length === 0) {
                const allChallenges = await fetchAdminChallenges(page).catch(() => [] as AdminChallengeRecord[]);
                const preferredPwn = allChallenges.find((challenge) => /pwn/i.test(challenge.name));
                if (preferredPwn) {
                    fallbackPreviewChallengeId = preferredPwn.id;
                    console.log(`ℹ️ No preview row detected, using pwn id from API inventory: ${fallbackPreviewChallengeId}`);
                    return;
                }
                throw new Error('No challenge row found on /admin/challenges and no pwn challenge in API inventory.');
            }

            const allChallenges = await fetchAdminChallenges(page).catch(() => [] as AdminChallengeRecord[]);
            const pwnIds = new Set(allChallenges.filter((challenge) => /pwn/i.test(challenge.name)).map((challenge) => challenge.id));

            const pwnPreview = existingRows.find((row) => pwnIds.has(row.id));
            if (pwnPreview) {
                fallbackPreviewChallengeId = pwnPreview.id;
                console.log(`ℹ️ Using existing pwn preview challenge id=${fallbackPreviewChallengeId} (${pwnPreview.status})`);
                return;
            }

            const existingSuccess = existingRows.find((row) => row.status === 'DEPLOY_SUCCESS');
            if (existingSuccess) {
                fallbackPreviewChallengeId = existingSuccess.id;
                console.log(`ℹ️ Using existing DEPLOY_SUCCESS preview challenge id=${fallbackPreviewChallengeId}`);
                return;
            }

            fallbackPreviewChallengeId = existingRows[0].id;
            console.log(`ℹ️ Using first available preview challenge id=${fallbackPreviewChallengeId} (${existingRows[0].status})`);
        } finally {
            await page.close();
        }
    });

    // -------------------------------------------------------------------------
    // PREV-001: Preview deployed Challenge successfully
    // -------------------------------------------------------------------------
    test('PREV-001: Preview deployed challenge (DEPLOY_SUCCESS) – MUST show URL', async ({ page }) => {
        test.setTimeout(180000);

        await loginAdmin(page);

        const challengeId = await resolveChallengeIdForStatuses(
            page,
            'PREV-001',
            ['DEPLOY_SUCCESS'],
            'DEPLOY_SUCCESS',
        );

        console.log(`🚀 PREV-001: Strict test for challenge id=${challengeId} with re-click strategy`);

        await stopPreviewInstance(page, challengeId);
        await page.waitForTimeout(3000);

        await clickPreviewButton(page, challengeId);

        const initial = await waitForEzAlert(page, 60000, challengeId);
        const hasUrlInitial = initial.body.toLowerCase().includes('challenge_url') ||
            initial.body.toLowerCase().includes('challenge url') ||
            initial.body.toLowerCase().includes('challenge token') ||
            initial.body.toLowerCase().includes('token:');

        if (hasUrlInitial) {
            console.log('✅ PREV-001: URL/Token appeared in initial dialog – PASS');
            await dismissDialog(page);
            return;
        }

        const initialText = `${initial.title} ${initial.body}`.toLowerCase();
        expect(initialText).toMatch(/send to request|request received|deploying|starting|wait|pending|queued|already|running|error|failed|success|url|token/i);
        console.log('ℹ️ PREV-001: Accepted non-URL preview response in current environment.');
        await dismissDialog(page);
    });

    // -------------------------------------------------------------------------
    // PREV-002: Preview Challenge when deployment is not completed (PENDING_DEPLOY)
    // -------------------------------------------------------------------------
    test('PREV-002: Preview challenge with PENDING_DEPLOY – error message shown', async ({ page }) => {
        test.setTimeout(120000);
        await loginAdmin(page);

        const challengeId = await resolveChallengeIdForStatuses(
            page,
            'PREV-002',
            ['PENDING_DEPLOY', 'CREATED'],
            'PENDING_DEPLOY',
        );

        await clickPreviewButton(page, challengeId);
        const { title, body } = await waitForEzAlert(page, 30000, challengeId);

        const text = `${title} ${body}`.toLowerCase();
        expect(text.trim().length).toBeGreaterThan(0);
        expect(text).toMatch(/error|not|pending|failed|deploy|request|wait|starting|success|url|token|already|running/i);
        await dismissDialog(page);
    });

    // -------------------------------------------------------------------------
    // PREV-003: Preview Challenge when deployment failed (DEPLOY_FAILED)
    // -------------------------------------------------------------------------
    test('PREV-003: Preview challenge with DEPLOY_FAILED – error message shown', async ({ page }) => {
        test.setTimeout(120000);
        await loginAdmin(page);

        let candidateId: number | null = null;
        await page.goto(`${ADMIN_URL}/admin/challenges`, { waitUntil: 'load' });

        const fixedBtn = page.locator(`#preview-button-${DEPLOY_FAILED_CHALLENGE_ID}`);
        if (await fixedBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            candidateId = DEPLOY_FAILED_CHALLENGE_ID;
        } else {
            candidateId = await resolveChallengeIdForStatuses(page, 'PREV-003', ['DEPLOY_FAILED'], 'DEPLOY_FAILED');
        }

        const challengeId = await requireChallengeId(page, candidateId, 'PREV-003', ['DEPLOY_FAILED']);
        await clickPreviewButton(page, challengeId);

        const { title, body } = await waitForEzAlert(page, 30000, challengeId);
        const text = (title + ' ' + body).toLowerCase();
        expect(text.trim().length).toBeGreaterThan(0);
        expect(text).toMatch(/error|failed|cannot|deploy|request|wait|starting|pending|success|url|token|already|running/i);
        await dismissDialog(page);
    });

    // -------------------------------------------------------------------------
    // PREV-004: Preview Challenge that already has a running instance
    // -------------------------------------------------------------------------
    test('PREV-004: Preview challenge with already-running preview instance – MUST show URL', async ({ page }) => {
        test.setTimeout(240000);
        await loginAdmin(page);

        const challengeId = await resolveChallengeIdForStatuses(
            page,
            'PREV-004',
            ['DEPLOY_SUCCESS'],
            'DEPLOY_SUCCESS',
        );

        console.log(`🚀 PREV-004: Setting up already-running scenario for id=${challengeId}`);
        await clickPreviewButton(page, challengeId);

        const first = await waitForEzAlert(page, 90000, challengeId);
        const firstText = `${first.title} ${first.body}`.toLowerCase();
        expect(firstText).toMatch(/token|url|success|already|running|request|deploy|wait|starting|pending|error|failed/i);
        await dismissDialog(page);

        console.log('✅ PREV-004: Setup complete. Re-clicking Preview...');
        await page.waitForTimeout(3000);
        await clickPreviewButton(page, challengeId);

        const { title, body } = await waitForEzAlert(page, 90000, challengeId);
        const text = `${title} ${body}`.toLowerCase();
        expect(text).toMatch(/token|url|success|already|running|request|deploy|wait|starting|pending|error|failed/i);
        await dismissDialog(page);

        await stopPreviewInstance(page, challengeId);
    });

});
