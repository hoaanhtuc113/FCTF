import { test, expect, type Page } from '@playwright/test';

// ─────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────
const ADMIN_URL = 'https://admin0.fctf.site';
const CONTESTANT_URL = 'https://contestant0.fctf.site';

// ─────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────

/**
 * Log in to the admin portal.
 */
async function loginAdmin(page: Page) {
    await test.step('Login as admin', async () => {
        await page.goto(`${ADMIN_URL}/login`);
        await page.locator('#name').fill('admin');
        await page.locator('#password').fill('1');
        await page.waitForTimeout(500);
        await page.locator('#_submit').click();
        await expect(page).toHaveURL(new RegExp(`${ADMIN_URL}/admin/.*`), { timeout: 20000 });
    });
}

/**
 * Log in to the contestant portal as a regular (non-captain) member.
 * user2 must be a member (NOT captain) of a team so captain-only guards apply.
 */
async function loginContestantMember(page: Page) {
    await test.step('Login as contestant member (user2)', async () => {
        await page.goto(`${CONTESTANT_URL}/login`);
        await page.locator("input[placeholder='input username...']").fill('user2');
        await page.locator("input[placeholder='enter_password']").fill('1');
        await page.waitForTimeout(500);
        await page.locator("button[type='submit']").click();
        await page.waitForURL(/\/(dashboard|challenges|tickets)/, { timeout: 15000 }).catch(() => {
            console.log(`loginContestantMember: still on ${page.url()} after 15 s`);
        });
    });
}

/**
 * Log in to the contestant portal as a team captain.
 * user9 is assumed to be the captain of their team.
 */
async function loginContestantCaptain(page: Page) {
    await test.step('Login as contestant captain (user9)', async () => {
        await page.goto(`${CONTESTANT_URL}/login`);
        await page.locator("input[placeholder='input username...']").fill('user9');
        await page.locator("input[placeholder='enter_password']").fill('1');
        await page.waitForTimeout(500);
        await page.locator("button[type='submit']").click();
        await page.waitForURL(/\/(dashboard|challenges|tickets)/, { timeout: 15000 }).catch(() => {
            console.log(`loginContestantCaptain: still on ${page.url()} after 15 s`);
        });
    });
}

/**
 * Navigate to Admin → Config and click the "General" sidebar tab.
 * The General tab is the default active tab, but we click it explicitly to be safe.
 */
async function goToGeneralTab(page: Page) {
    await page.goto(`${ADMIN_URL}/admin/config`, { waitUntil: 'load' });
    // "General" tab is the FIRST nav-link in #config-sidebar
    await page.locator('#config-sidebar a[href="#general"]').click();
    await expect(page.locator('#general')).toBeVisible({ timeout: 10000 });
}

/**
 * Submit the General config form via the Update button inside #general
 * and wait for the page to reload (AJAX → window.location.reload()).
 */
async function submitGeneralForm(page: Page) {
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'load', timeout: 20000 }).catch(() =>
            console.log('submitGeneralForm: navigation timeout (ok if SPA reload)')
        ),
        page.locator('#general button[type="submit"]').click(),
    ]);
    // Give the server-side cache invalidation a moment to propagate
    await page.waitForTimeout(3000);
}

/**
 * Open the first deployable challenge panel in the contestant portal.
 * Assumes the contest is active and at least one challenge exists.
 * Returns false if no challenge card was found.
 */
async function openFirstDeployableChallenge(page: Page): Promise<boolean> {
    await page.goto(`${CONTESTANT_URL}/challenges`, { waitUntil: 'load' });
    await page.waitForTimeout(2000);

    // Click the first challenge card and wait for the detail panel to open
    const card = page.locator('[data-require-deploy="true"]').first();
    const cardAlt = page.locator('.challenge-card').first();

    const target = (await card.count()) > 0 ? card : cardAlt;
    if ((await target.count()) === 0) {
        console.log('openFirstDeployableChallenge: no challenge cards found');
        return false;
    }
    await target.click();
    // Wait for the challenge detail panel
    await page.waitForTimeout(1500);
    return true;
}

// ─────────────────────────────────────────
//  Test Suite
// ─────────────────────────────────────────

test.describe('Admin Config General Tests (CONF-GEN)', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(120000);

    // ── CONF-GEN-001 ────────────────────────────────────────────────────────
    test('CONF-GEN-001: UI – General tab renders all required fields', async ({ page }) => {
        console.log('Starting CONF-GEN-001...');
        await loginAdmin(page);
        await goToGeneralTab(page);

        // The form must contain all four config fields
        await expect(page.locator('#ctf_name')).toBeVisible();
        await expect(page.locator('#ctf_description')).toBeVisible();
        await expect(page.locator('#captain_only_start_challenge')).toBeVisible();
        await expect(page.locator('#captain_only_submit_challenge')).toBeVisible();
        await expect(page.locator('#limit_challenges')).toBeVisible();

        // Update button must be present
        await expect(page.locator('#general button[type="submit"]')).toBeVisible();

        // Captain-only dropdowns must have exactly 2 options: Enabled / Disabled
        const startOpts = page.locator('#captain_only_start_challenge option');
        await expect(startOpts).toHaveCount(2);
        await expect(startOpts.nth(0)).toHaveText('Enabled');
        await expect(startOpts.nth(1)).toHaveText('Disabled');

        const submitOpts = page.locator('#captain_only_submit_challenge option');
        await expect(submitOpts).toHaveCount(2);
        await expect(submitOpts.nth(0)).toHaveText('Enabled');
        await expect(submitOpts.nth(1)).toHaveText('Disabled');

        // limit_challenges must accept only numbers (type="number", min=1)
        const limitInput = page.locator('#limit_challenges');
        await expect(limitInput).toHaveAttribute('type', 'number');
        await expect(limitInput).toHaveAttribute('min', '1');

        console.log('CONF-GEN-001 PASSED');
    });

    // ── CONF-GEN-002 ────────────────────────────────────────────────────────
    test('CONF-GEN-002: Happy path – Update Event Name and verify persistence', async ({ page }) => {
        console.log('Starting CONF-GEN-002...');
        await loginAdmin(page);
        await goToGeneralTab(page);

        const newName = `FCTF Test ${Date.now()}`;
        console.log(`Setting CTF name to: ${newName}`);

        await page.locator('#ctf_name').fill(newName);
        await submitGeneralForm(page);

        // Reload and verify persistence
        await goToGeneralTab(page);
        await expect(page.locator('#ctf_name')).toHaveValue(newName);
        console.log('CONF-GEN-002 PASSED');
    });

    // ── CONF-GEN-003 ────────────────────────────────────────────────────────
    test('CONF-GEN-003: Happy path – Update Event Description and verify persistence', async ({ page }) => {
        console.log('Starting CONF-GEN-003...');
        await loginAdmin(page);
        await goToGeneralTab(page);

        const newDesc = `Auto-test description – ${new Date().toISOString()}`;
        console.log(`Setting CTF description to: ${newDesc}`);

        await page.locator('#ctf_description').fill(newDesc);
        await submitGeneralForm(page);

        // Reload and verify persistence
        await goToGeneralTab(page);
        await expect(page.locator('#ctf_description')).toHaveValue(newDesc);
        console.log('CONF-GEN-003 PASSED');
    });

    // ── CONF-GEN-004 ────────────────────────────────────────────────────────
    test('CONF-GEN-004: Captain Only Start – Enable and verify non-captain sees restriction', async ({ page, browser }) => {
        console.log('Starting CONF-GEN-004...');
        await loginAdmin(page);
        await goToGeneralTab(page);

        // Enable captain-only start
        await page.locator('#captain_only_start_challenge').selectOption('1');
        // Ensure captain-only submit is disabled so it does not interfere
        await page.locator('#captain_only_submit_challenge').selectOption('0');
        await submitGeneralForm(page);

        // Verify admin setting persists
        await goToGeneralTab(page);
        await expect(page.locator('#captain_only_start_challenge')).toHaveValue('1');
        console.log('CONF-GEN-004: Admin setting persists (captain_only_start=1)');

        // Verify contestant side: member (non-captain) should see "[!] Only captain can start"
        const memberPage = await browser.newPage();
        await loginContestantMember(memberPage);
        await memberPage.goto(`${CONTESTANT_URL}/challenges`, { waitUntil: 'load' });
        await memberPage.waitForTimeout(2000);

        // Open any challenge card that requires deploy
        const cards = memberPage.locator('[data-require-deploy="true"], .challenge-card');
        if ((await cards.count()) > 0) {
            await cards.first().click();
            await memberPage.waitForTimeout(2000);

            // The "[!] Only captain can start" text should appear in the start area
            const bodyText = await memberPage.textContent('body');
            console.log(`CONF-GEN-004 member body snippet: ${bodyText?.substring(0, 300)}`);
            await expect(memberPage.locator('body')).toContainText('Only captain can start', { ignoreCase: true });
            console.log('CONF-GEN-004: Non-captain sees restriction message');
        } else {
            console.log('CONF-GEN-004: No deployable challenge found – skipping contestant check');
        }

        await memberPage.close();
        console.log('CONF-GEN-004 PASSED');
    });

    // ── CONF-GEN-005 ────────────────────────────────────────────────────────
    test('CONF-GEN-005: Captain Only Start – Disable restores normal start button for member', async ({ page, browser }) => {
        console.log('Starting CONF-GEN-005...');
        await loginAdmin(page);
        await goToGeneralTab(page);

        // Disable captain-only start
        await page.locator('#captain_only_start_challenge').selectOption('0');
        await submitGeneralForm(page);

        // Verify admin setting persists
        await goToGeneralTab(page);
        await expect(page.locator('#captain_only_start_challenge')).toHaveValue('0');

        // Verify contestant side: member should no longer see the restriction
        const memberPage = await browser.newPage();
        await loginContestantMember(memberPage);
        await memberPage.goto(`${CONTESTANT_URL}/challenges`, { waitUntil: 'load' });
        await memberPage.waitForTimeout(2000);

        const cards = memberPage.locator('[data-require-deploy="true"], .challenge-card');
        if ((await cards.count()) > 0) {
            await cards.first().click();
            await memberPage.waitForTimeout(2000);
            // The restriction message must NOT appear
            await expect(memberPage.locator('body')).not.toContainText('Only captain can start', { ignoreCase: true });
            console.log('CONF-GEN-005: Non-captain does NOT see restriction → normal start button present');
        } else {
            console.log('CONF-GEN-005: No deployable challenge found – skipping contestant check');
        }

        await memberPage.close();
        console.log('CONF-GEN-005 PASSED');
    });

    // ── CONF-GEN-006 ────────────────────────────────────────────────────────
    test('CONF-GEN-006: Captain Only Submit – Enable and verify non-captain sees restriction', async ({ page, browser }) => {
        console.log('Starting CONF-GEN-006...');
        await loginAdmin(page);
        await goToGeneralTab(page);

        // Enable captain-only submit
        await page.locator('#captain_only_submit_challenge').selectOption('1');
        await submitGeneralForm(page);

        // Verify persistence
        await goToGeneralTab(page);
        await expect(page.locator('#captain_only_submit_challenge')).toHaveValue('1');
        console.log('CONF-GEN-006: Admin setting persists (captain_only_submit=1)');

        // Verify contestant: member must see "[!] Only captain can submit" and [CAPTAIN ONLY] button
        const memberPage = await browser.newPage();
        await loginContestantMember(memberPage);
        await memberPage.goto(`${CONTESTANT_URL}/challenges`, { waitUntil: 'load' });
        await memberPage.waitForTimeout(2000);

        const cards = memberPage.locator('.challenge-card');
        if ((await cards.count()) > 0) {
            await cards.first().click();
            await memberPage.waitForTimeout(2000);
            const bodyText = await memberPage.textContent('body');
            console.log(`CONF-GEN-006 member body snippet: ${bodyText?.substring(0, 400)}`);

            // Either the warning message or the button label should be visible
            const hasWarning = (bodyText ?? '').toLowerCase().includes('only captain can submit');
            const hasCaptainBtn = (bodyText ?? '').toLowerCase().includes('[captain only]');
            expect(hasWarning || hasCaptainBtn).toBeTruthy();
            console.log('CONF-GEN-006: Non-captain sees submit restriction');
        } else {
            console.log('CONF-GEN-006: No challenge card found – skipping contestant check');
        }

        await memberPage.close();
        console.log('CONF-GEN-006 PASSED');
    });

    // ── CONF-GEN-007 ────────────────────────────────────────────────────────
    test('CONF-GEN-007: Captain Only Submit – Captain does NOT see restriction', async ({ page, browser }) => {
        console.log('Starting CONF-GEN-007...');
        // captain_only_submit is still enabled from previous test (serial mode)

        // Verify admin setting is still enabled
        await loginAdmin(page);
        await goToGeneralTab(page);
        await expect(page.locator('#captain_only_submit_challenge')).toHaveValue('1');

        // Verify contestant captain: should see normal [SUBMIT] button
        const captainPage = await browser.newPage();
        await loginContestantCaptain(captainPage);
        await captainPage.goto(`${CONTESTANT_URL}/challenges`, { waitUntil: 'load' });
        await captainPage.waitForTimeout(2000);

        const cards = captainPage.locator('.challenge-card');
        if ((await cards.count()) > 0) {
            await cards.first().click();
            await captainPage.waitForTimeout(2000);
            const bodyText = await captainPage.textContent('body');
            console.log(`CONF-GEN-007 captain body snippet: ${bodyText?.substring(0, 400)}`);

            // Captain must NOT see the CAPTAIN ONLY restriction
            await expect(captainPage.locator('body')).not.toContainText('[CAPTAIN ONLY]', { ignoreCase: true });
            console.log('CONF-GEN-007: Captain does NOT see restriction – normal submit button shown');
        } else {
            console.log('CONF-GEN-007: No challenge card found – skipping contestant check');
        }

        await captainPage.close();
        console.log('CONF-GEN-007 PASSED');
    });

    // ── CONF-GEN-008 ────────────────────────────────────────────────────────
    test('CONF-GEN-008: Captain Only Submit – Disable removes restriction for members', async ({ page, browser }) => {
        console.log('Starting CONF-GEN-008...');
        await loginAdmin(page);
        await goToGeneralTab(page);

        // Disable captain-only submit
        await page.locator('#captain_only_submit_challenge').selectOption('0');
        await submitGeneralForm(page);

        // Verify persistence
        await goToGeneralTab(page);
        await expect(page.locator('#captain_only_submit_challenge')).toHaveValue('0');

        // Verify contestant member: restriction must be gone
        const memberPage = await browser.newPage();
        await loginContestantMember(memberPage);
        await memberPage.goto(`${CONTESTANT_URL}/challenges`, { waitUntil: 'load' });
        await memberPage.waitForTimeout(2000);

        const cards = memberPage.locator('.challenge-card');
        if ((await cards.count()) > 0) {
            await cards.first().click();
            await memberPage.waitForTimeout(2000);
            await expect(memberPage.locator('body')).not.toContainText('[CAPTAIN ONLY]', { ignoreCase: true });
            await expect(memberPage.locator('body')).not.toContainText('Only captain can submit', { ignoreCase: true });
            console.log('CONF-GEN-008: Non-captain no longer sees submit restriction');
        } else {
            console.log('CONF-GEN-008: No challenge card found – skipping contestant check');
        }

        await memberPage.close();
        console.log('CONF-GEN-008 PASSED');
    });

    // ── CONF-GEN-009 ────────────────────────────────────────────────────────
    test('CONF-GEN-009: Limit Challenges – Set value and verify persistence', async ({ page }) => {
        console.log('Starting CONF-GEN-009...');
        await loginAdmin(page);
        await goToGeneralTab(page);

        const limitValue = '3';
        console.log(`Setting limit_challenges to: ${limitValue}`);

        await page.locator('#limit_challenges').fill(limitValue);
        await submitGeneralForm(page);

        // Reload and verify persistence
        await goToGeneralTab(page);
        await expect(page.locator('#limit_challenges')).toHaveValue(limitValue);
        console.log('CONF-GEN-009 PASSED');
    });

    // ── CONF-GEN-010 ────────────────────────────────────────────────────────
    test('CONF-GEN-010: Limit Challenges – Value 1 (minimum) is accepted', async ({ page }) => {
        console.log('Starting CONF-GEN-010...');
        await loginAdmin(page);
        await goToGeneralTab(page);

        await page.locator('#limit_challenges').fill('1');
        await submitGeneralForm(page);

        // Reload and verify
        await goToGeneralTab(page);
        await expect(page.locator('#limit_challenges')).toHaveValue('1');
        console.log('CONF-GEN-010 PASSED');
    });

    // ── CONF-GEN-011 ────────────────────────────────────────────────────────
    test('CONF-GEN-011: All fields update together in a single submit', async ({ page }) => {
        console.log('Starting CONF-GEN-011...');
        await loginAdmin(page);
        await goToGeneralTab(page);

        const batchName = `FCTF-Batch-${Date.now()}`;
        const batchDesc = `Batch description ${new Date().toISOString()}`;

        await page.locator('#ctf_name').fill(batchName);
        await page.locator('#ctf_description').fill(batchDesc);
        await page.locator('#captain_only_start_challenge').selectOption('1');
        await page.locator('#captain_only_submit_challenge').selectOption('1');
        await page.locator('#limit_challenges').fill('5');

        await submitGeneralForm(page);

        // Reload and verify ALL fields saved correctly
        await goToGeneralTab(page);
        await expect(page.locator('#ctf_name')).toHaveValue(batchName);
        await expect(page.locator('#ctf_description')).toHaveValue(batchDesc);
        await expect(page.locator('#captain_only_start_challenge')).toHaveValue('1');
        await expect(page.locator('#captain_only_submit_challenge')).toHaveValue('1');
        await expect(page.locator('#limit_challenges')).toHaveValue('5');

        console.log('CONF-GEN-011 PASSED');
    });

    // ── CONF-GEN-012 ────────────────────────────────────────────────────────
    test('CONF-GEN-012: Security – Unauthenticated access redirects to login', async ({ page }) => {
        console.log('Starting CONF-GEN-012...');
        // Try accessing config page without logging in
        await page.goto(`${ADMIN_URL}/admin/config`, { waitUntil: 'load' });
        // Must be redirected to login page
        await expect(page).toHaveURL(/login/, { timeout: 10000 });
        console.log('CONF-GEN-012 PASSED');
    });

    // ── CONF-GEN-013 (cleanup / restore) ────────────────────────────────────
    test('CONF-GEN-013: Restore – Reset to safe defaults after tests', async ({ page }) => {
        console.log('Starting CONF-GEN-013 (cleanup)...');
        await loginAdmin(page);
        await goToGeneralTab(page);

        // Restore captain-only flags to Disabled, name back to FCTF, limit to 3
        await page.locator('#ctf_name').fill('FCTF');
        await page.locator('#captain_only_start_challenge').selectOption('0');
        await page.locator('#captain_only_submit_challenge').selectOption('0');
        await page.locator('#limit_challenges').fill('3');
        await submitGeneralForm(page);

        // Verify
        await goToGeneralTab(page);
        await expect(page.locator('#captain_only_start_challenge')).toHaveValue('0');
        await expect(page.locator('#captain_only_submit_challenge')).toHaveValue('0');
        await expect(page.locator('#limit_challenges')).toHaveValue('3');
        console.log('CONF-GEN-013 PASSED – defaults restored');
    });
});
