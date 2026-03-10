import { test, expect, type Page } from '@playwright/test';

const ADMIN_URL = 'https://admin.fctf.site';
const CONTESTANT_URL = 'https://contestant.fctf.site';

async function loginAdmin(page: Page) {
    await page.goto(`${ADMIN_URL}/login`);
    await page.fill('#name', 'admin');
    await page.fill('#password', '1');
    await page.click('#_submit');
    await expect(page).toHaveURL(new RegExp('.*/admin/(statistics|challenges)'), { timeout: 15000 });
}

async function loginContestant(page: Page) {
    await page.goto(`${CONTESTANT_URL}/login`);
    await page.fill('input[placeholder="input username..."]', 'user2');
    await page.fill('input[placeholder="enter_password"]', '1');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(`${CONTESTANT_URL}/challenges`, { timeout: 30000 });
    // Surgical clear to avoid clearing session tokens
    await page.evaluate(() => {
        localStorage.removeItem('contest_date_config');
        localStorage.removeItem('contest_public_config');
    });
    await page.reload();
}

async function goToVisibilityTab(page: Page) {
    await page.goto(`${ADMIN_URL}/admin/config`);
    await page.click('a[href="#visibility"]');
    await expect(page.locator('#visibility')).toBeVisible();
}

async function setScoreVisibility(page: Page, visibility: 'public' | 'private' | 'hidden' | 'admins') {
    await goToVisibilityTab(page);
    await page.selectOption('select[name="score_visibility"]', visibility);
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => { }),
        page.click('#visibility button[type="submit"]')
    ]);
}

async function setDifficultyVisibility(page: Page, visibility: 'enabled' | 'disabled') {
    await goToVisibilityTab(page);
    await page.selectOption('select[name="challenge_difficulty_visibility"]', visibility);
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => { }),
        page.click('#visibility button[type="submit"]')
    ]);
}

test.describe('Admin Config Visibility Tests (CONF-VIS)', () => {
    test.describe.configure({ mode: 'serial', retries: 2 });

    test.beforeEach(async ({ page }) => {
        // Set a generous timeout for each test
        test.setTimeout(120000);
    });

    test('CONF-VIS-001: Score Visibility - Public', async ({ page }) => {
        await loginAdmin(page);
        await setScoreVisibility(page, 'public');

        // Verify unauthenticated access
        const newPage = await page.context().newPage();
        await newPage.goto(`${CONTESTANT_URL}/public/scoreboard`);
        // Surgical clear
        await newPage.evaluate(() => {
            localStorage.removeItem('contest_date_config');
            localStorage.removeItem('contest_public_config');
        });
        await newPage.reload();

        // Wait for scores to load
        await expect(newPage.getByText('LEADERBOARD').first()).toBeVisible();
        await expect(newPage.getByText('SCORE_EVOLUTION').first()).toBeVisible();
        await newPage.close();
    });

    test('CONF-VIS-002: Score Visibility - Private (Unauthenticated)', async ({ page }) => {
        await loginAdmin(page);
        await setScoreVisibility(page, 'private');

        // Verify unauthenticated access - should see restricted message
        const newPage = await page.context().newPage();
        await newPage.goto(`${CONTESTANT_URL}/public/scoreboard`);
        await newPage.evaluate(() => {
            localStorage.removeItem('contest_date_config');
            localStorage.removeItem('contest_public_config');
        });
        await newPage.reload();

        await expect(newPage.locator('text=ACCESS RESTRICTED').or(newPage.locator('text=SCOREBOARD HIDDEN')).first()).toBeVisible();
        await expect(newPage.locator('text=private').or(newPage.locator('text=hidden')).first()).toBeVisible();
        await newPage.close();
    });

    test('CONF-VIS-003: Score Visibility - Private (Authenticated)', async ({ page }) => {
        await loginAdmin(page);
        await setScoreVisibility(page, 'private');

        // Login as contestant
        await loginContestant(page);
        await page.goto(`${CONTESTANT_URL}/scoreboard`);
        await page.evaluate(() => {
            localStorage.removeItem('contest_date_config');
            localStorage.removeItem('contest_public_config');
        });
        await page.reload();

        await expect(page.getByText('[LEADERBOARD]').first()).toBeVisible({ timeout: 15000 });
        await expect(page.getByText('[SCORE_EVOLUTION]').first()).toBeVisible({ timeout: 15000 });
    });

    test('CONF-VIS-004: Score Visibility - Hidden', async ({ page }) => {
        await loginAdmin(page);
        await setScoreVisibility(page, 'hidden');

        // Login as contestant
        await loginContestant(page);
        await page.goto(`${CONTESTANT_URL}/scoreboard`);

        await expect(page.locator('text=SCOREBOARD HIDDEN').first()).toBeVisible();
        await expect(page.locator('text=Scores are currently hidden.').first()).toBeVisible();
    });

    test('CONF-VIS-005: Score Visibility - Admins Only', async ({ page }) => {
        await loginAdmin(page);
        await setScoreVisibility(page, 'admins');

        // Login as contestant
        await loginContestant(page);
        await page.goto(`${CONTESTANT_URL}/scoreboard`);

        await expect(page.locator('text=SCOREBOARD HIDDEN').first()).toBeVisible();
        await expect(page.locator('text=Scores are currently hidden.').first()).toBeVisible();
    });

    test('CONF-VIS-006: Challenge Difficulty - Enabled', async ({ page }) => {
        await loginAdmin(page);
        await setDifficultyVisibility(page, 'enabled');

        await loginContestant(page);
        // Navigate to a challenge detail. Assuming challenge ID 1 exists.
        // We'll click the first challenge in the list.
        await page.waitForSelector('.relative.border.rounded.cursor-pointer');
        await page.click('.relative.border.rounded.cursor-pointer');

        // Check for Difficulty section
        await expect(page.locator('text=[DIFFICULTY]')).toBeVisible();
        await expect(page.locator('text=/5')).toBeVisible(); // e.g. "3/5"
    });

    test('CONF-VIS-007: Challenge Difficulty - Disabled', async ({ page }) => {
        await loginAdmin(page);
        await setDifficultyVisibility(page, 'disabled');

        await loginContestant(page);
        await page.waitForSelector('.relative.border.rounded.cursor-pointer');
        await page.click('.relative.border.rounded.cursor-pointer');

        // Difficulty section should NOT be visible
        await expect(page.locator('text=[DIFFICULTY]')).not.toBeVisible();
    });

    test('Cleanup: Restore Default Visibility', async ({ page }) => {
        await loginAdmin(page);
        await setScoreVisibility(page, 'public');
        await setDifficultyVisibility(page, 'disabled');
    });

});
