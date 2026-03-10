import { test, expect } from '@playwright/test';
import {
    CONTESTANT_URL,
    loginAdmin,
    loginContestant,
    setScoreVisibility,
} from './challenge-admin-support';

test.describe('UC16 Change Scoreboard Visibility', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        test.setTimeout(180_000);
        await loginAdmin(page);
    });

    test.afterAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            await loginAdmin(page);
            await setScoreVisibility(page, 'public');
        } finally {
            await page.close();
        }
    });

    test('SCV-01: Set score visibility to public', async ({ page, browser }) => {
        await setScoreVisibility(page, 'public');

        const guestPage = await browser.newPage();
        try {
            await guestPage.goto(`${CONTESTANT_URL}/public/scoreboard`);
            await expect(guestPage.getByText('LEADERBOARD').first()).toBeVisible({ timeout: 20_000 });
        } finally {
            await guestPage.close();
        }
    });

    test('SCV-02: Set score visibility to private', async ({ page, browser }) => {
        await setScoreVisibility(page, 'private');

        const guestPage = await browser.newPage();
        const contestantPage = await browser.newPage();
        try {
            await guestPage.goto(`${CONTESTANT_URL}/public/scoreboard`);
            await expect(guestPage).toHaveURL(/\/login(\?|$)/, { timeout: 20_000 });

            await loginContestant(contestantPage);
            await contestantPage.goto(`${CONTESTANT_URL}/scoreboard`);
            await expect(contestantPage.getByRole('heading', { name: 'Scoreboard' })).toBeVisible({ timeout: 20_000 });
            await expect(contestantPage.locator('#scoreboard')).toBeVisible({ timeout: 20_000 });
        } finally {
            await guestPage.close();
            await contestantPage.close();
        }
    });

    test('SCV-03: Set score visibility to hidden', async ({ page, browser }) => {
        await setScoreVisibility(page, 'hidden');

        const contestantPage = await browser.newPage();
        try {
            await loginContestant(contestantPage);
            await contestantPage.goto(`${CONTESTANT_URL}/scoreboard`);
            await expect(contestantPage.locator('text=SCOREBOARD HIDDEN').first()).toBeVisible({ timeout: 20_000 });
            await expect(contestantPage.locator('text=Scores are currently hidden.').first()).toBeVisible();
        } finally {
            await contestantPage.close();
        }
    });

    test('SCV-04: Set score visibility to admins only', async ({ page, browser }) => {
        await setScoreVisibility(page, 'admins');

        const contestantPage = await browser.newPage();
        try {
            await loginContestant(contestantPage);
            await contestantPage.goto(`${CONTESTANT_URL}/scoreboard`);
            await expect(contestantPage.locator('text=SCOREBOARD HIDDEN').first()).toBeVisible({ timeout: 20_000 });
        } finally {
            await contestantPage.close();
        }
    });
});