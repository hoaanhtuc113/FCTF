import { test, expect, Page } from '@playwright/test';

/**
 * User Profile Test Suite - Information Viewing with Admin Simulation
 */

test.describe.configure({ mode: 'serial' });

// =============================================================================
// CONFIG & CONSTANTS
// =============================================================================

const ADMIN_URL = 'https://admin.fctf.site';
const CONTESTANT_URL = 'https://contestant.fctf.site';

// =============================================================================
// HELPERS
// =============================================================================

async function loginUser(page: Page, user: string = 'user20', pass: string = '1') {
    await test.step(`Login as contestant ${user}`, async () => {
        await page.goto(`${CONTESTANT_URL}/login`);
        await page.locator("input[placeholder='input username...']").fill(user);
        await page.locator("input[placeholder='enter_password']").fill(pass);
        await page.locator("button[type='submit']").click();
        await page.waitForURL(/\/(dashboard|challenges|tickets|scoreboard|instances|action-logs|profile)/, { timeout: 60000 });
        await page.waitForTimeout(2000);
    });
}

async function loginAdmin(page: Page) {
    await test.step('Login as admin', async () => {
        await page.goto(`${ADMIN_URL}/login`);
        await page.getByRole('textbox', { name: 'User Name or Email' }).fill('admin');
        await page.getByRole('textbox', { name: 'Password' }).fill('1');
        await page.getByRole('button', { name: 'Submit' }).click();
        await expect(page).toHaveURL(/.*admin/);
    });
}

async function navigateToTimeConfig(page: Page) {
    await test.step('Navigate to Admin Time Config', async () => {
        await page.goto(`${ADMIN_URL}/admin/config`);
        await page.waitForTimeout(2000);

        // Click tab "Time"
        const timeTab = page.locator('a[href="#ctftime"]');
        if (await timeTab.isVisible()) {
            await timeTab.click();
        }

        // Click "End Time" tab
        const endTab = page.locator('a[href="#end-date"]');
        await endTab.click();
    });
}

/**
 * Set contest end time to 1 hour ago
 */
async function setContestEndPast(page: Page) {
    await test.step('Set contest end time to PAST', async () => {
        await navigateToTimeConfig(page);

        const now = new Date();
        const pastDate = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago

        await page.locator('#end-month').fill((pastDate.getUTCMonth() + 1).toString());
        await page.locator('#end-day').fill(pastDate.getUTCDate().toString());
        await page.locator('#end-year').fill(pastDate.getUTCFullYear().toString());
        await page.locator('#end-hour').fill(pastDate.getUTCHours().toString());
        await page.locator('#end-minute').fill(pastDate.getUTCMinutes().toString());

        await page.locator('#end-timezone').selectOption({ label: 'UTC' });

        // Click Update
        await page.locator('#ctftime button[type="submit"]').click();
        await page.waitForTimeout(2000);
        console.log('✅ Contest end time set to PAST');
    });
}

/**
 * Restore contest end time (set to far future)
 */
async function restoreContestEnd(page: Page) {
    await test.step('Restore contest end time to FUTURE', async () => {
        await navigateToTimeConfig(page);

        await page.locator('#end-year').fill('2030');
        await page.locator('#end-month').fill('1');
        await page.locator('#end-day').fill('1');

        // Click Update
        await page.locator('#ctftime button[type="submit"]').click();
        await page.waitForTimeout(2000);
        console.log('✅ Contest end time restored to FUTURE (2030)');
    });
}

async function navigateToProfile(page: Page) {
    await test.step('Navigate to Profile page', async () => {
        await page.goto(`${CONTESTANT_URL}/profile`);
        await page.waitForTimeout(1000);
        await expect(page.locator('h2', { hasText: 'user20' })).toBeVisible({ timeout: 10000 });
    });
}

async function verifyProfileDetails(page: Page, context: string) {
    await test.step(`Verify Profile Details - ${context}`, async () => {
        // 1. Identity Verification
        const profileCard = page.locator('.lg\\:col-span-1');
        await expect(profileCard.locator('h2', { hasText: 'user20' })).toBeVisible();

        // Email is usually in a div or span, use exact text to avoid matching "user20user20@gmail.comteam20"
        await expect(profileCard.getByText('user20@gmail.com', { exact: true })).toBeVisible();

        // Team name badge
        const teamBadge = profileCard.locator('div').filter({ hasText: /^team20$/i });
        await expect(teamBadge.first()).toBeVisible();

        // 2. Ranking & Score Verification
        const statsCol = page.locator('.lg\\:col-span-2');
        await expect(statsCol.locator('span', { hasText: '[TEAM_RANKING]' })).toBeVisible();
        await expect(statsCol.locator('span', { hasText: '[TEAM_SCORE]' })).toBeVisible();

        const ranking = statsCol.locator('div', { hasText: '#' }).filter({ hasText: /^#\d+/ });
        await expect(ranking.first()).toBeVisible();

        // 3. Team Members Verification
        await expect(statsCol.locator('span', { hasText: '[TEAM_MEMBERS]' })).toBeVisible();
        const memberRows = statsCol.locator('table tbody tr');
        expect(await memberRows.count()).toBeGreaterThan(0);
        await expect(memberRows.filter({ hasText: 'user20' })).toBeVisible();

        // 4. Recent Activity Verification
        await expect(statsCol.locator('span', { hasText: '[RECENT_ACTIVITY]' })).toBeVisible();
    });
}

// =============================================================================
// TEST CASES
// =============================================================================

test.describe('User Profile View Functionality (Inc. Admin State Change)', () => {

    test('TC-UP001: View user information while the contest is running', async ({ page }) => {
        await loginUser(page);
        await navigateToProfile(page);
        await verifyProfileDetails(page, 'Contest Running');
        console.log('✅ TC-UP001: View profile info (Running) - PASS');
    });

    test('TC-UP002: View user information after the contest has ended', async ({ browser }) => {
        test.setTimeout(120000);

        // 1. Admin login and set time to past
        const adminContext = await browser.newContext();
        const adminPage = await adminContext.newPage();
        try {
            await loginAdmin(adminPage);
            await setContestEndPast(adminPage);

            // 2. Contestant login and verify profile status
            const contestantContext = await browser.newContext();
            const contestantPage = await contestantContext.newPage();
            await loginUser(contestantPage);
            await navigateToProfile(contestantPage);

            // Ensure data persists even after contest end
            await verifyProfileDetails(contestantPage, 'Contest Ended');

            console.log('✅ TC-UP002: View profile info (Ended) - PASS');
            await contestantContext.close();
        } finally {
            // 3. Cleanup: Restore time
            await restoreContestEnd(adminPage);
            await adminContext.close();
        }
    });
});
