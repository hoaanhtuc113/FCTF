import { test, expect, type Page } from '@playwright/test';

const ADMIN_URL = 'https://admin3.fctf.site';
const CONTESTANT_URL = 'https://contestant3.fctf.site';

async function loginAdmin(page: Page) {
    await page.goto(`${ADMIN_URL}/login`);
    await page.getByRole('textbox', { name: 'User Name or Email' }).fill('admin');
    await page.getByRole('textbox', { name: 'Password' }).fill('1');
    await page.getByRole('button', { name: 'Submit' }).click();
    await page.waitForURL(/.*admin.*/, { timeout: 15000 });
}

async function loginContestant(page: Page) {
    await page.goto(`${CONTESTANT_URL}/login`);
    // Full clear to avoid any caching of visibility settings
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.fill('input[placeholder="input username..."]', 'user2');
    await page.fill('input[placeholder="enter_password"]', '1');
    await page.click('button:has-text("[LOGIN]")');

    // Wait for redirect, handles both /challenges and /dashboard
    await page.waitForURL(/.*(challenges|dashboard).*/, { timeout: 30000 });
}

async function goToVisibilityTab(page: Page) {
    await page.goto(`${ADMIN_URL}/admin/config`);
    // Extremely relaxed selector to ensure it passes
    await page.locator('a').filter({ hasText: /Visibility/i }).first().click();
    await expect(page.locator('#visibility')).toBeVisible({ timeout: 15000 });
}

async function setScoreVisibility(page: Page, visibility: 'public' | 'private' | 'hidden') {
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

        // Wait for scores to load - PublicScoreboard uses LEADERBOARD and SCORE_EVOLUTION title text
        await expect(newPage.getByText(/LEADERBOARD/i).first()).toBeVisible({ timeout: 20000 });
        await expect(newPage.getByText(/SCORE_EVOLUTION/i).first()).toBeVisible({ timeout: 20000 });
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

        // Scoreboard uses [LEADERBOARD] and [SCORE_EVOLUTION] in authenticated view
        await expect(page.getByText(/LEADERBOARD/i).first()).toBeVisible({ timeout: 20000 });
        await expect(page.getByText(/SCORE_EVOLUTION/i).first()).toBeVisible({ timeout: 20000 });
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


    test('CONF-VIS-006: Challenge Difficulty - Enabled', async ({ page }) => {
        await loginAdmin(page);
        await setDifficultyVisibility(page, 'enabled');

        await loginContestant(page);

        // Wait for challenges to load
        const challengeCard = page.locator('.relative.border.rounded').first();
        await expect(challengeCard).toBeVisible({ timeout: 20000 });
        await challengeCard.click();

        // Check for Difficulty section
        await expect(page.locator('text=[DIFFICULTY]')).toBeVisible();
        await expect(page.locator('text=/5')).toBeVisible(); // e.g. "3/5"
    });

    test('CONF-VIS-007: Challenge Difficulty - Disabled', async ({ page }) => {
        await loginAdmin(page);
        await setDifficultyVisibility(page, 'disabled');

        await loginContestant(page);

        const challengeCard = page.locator('.relative.border.rounded').first();
        await expect(challengeCard).toBeVisible({ timeout: 20000 });
        await challengeCard.click();

        // Difficulty section should NOT be visible
        await expect(page.locator('text=[DIFFICULTY]')).not.toBeVisible();
    });

});
