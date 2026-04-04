import { test, expect, Page } from '@playwright/test';

/**
 * Challenges Test Suite - Automation of View, Details, Dependencies, and Timing
 */

test.describe.configure({ mode: 'serial' });

// =============================================================================
// CONFIG & CONSTANTS
// =============================================================================

const ADMIN_URL = 'https://admin0.fctf.site';
const CONTESTANT_URL = 'https://contestant0.fctf.site';

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

async function setContestStartFuture(page: Page) {
    await test.step('Set contest start time to FUTURE', async () => {
        await page.goto(`${ADMIN_URL}/admin/config`);
        await page.waitForTimeout(2000);
        await page.locator('a[href="#ctftime"]').click();
        await page.locator('a[href="#start-date"]').click();

        const now = new Date();
        const futureDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year later

        await page.locator('#start-month').fill((futureDate.getUTCMonth() + 1).toString());
        await page.locator('#start-day').fill(futureDate.getUTCDate().toString());
        await page.locator('#start-year').fill(futureDate.getUTCFullYear().toString());
        await page.locator('#start-hour').fill('0');
        await page.locator('#start-minute').fill('0');

        await page.locator('#ctftime button[type="submit"]').click();
        await page.waitForTimeout(2000);
        console.log(`✅ Contest start time set to FUTURE (${futureDate.getUTCFullYear()})`);
    });
}

async function restoreContestStart(page: Page) {
    await test.step('Restore contest start time to PAST', async () => {
        await page.goto(`${ADMIN_URL}/admin/config`);
        await page.waitForTimeout(2000);
        await page.locator('a[href="#ctftime"]').click();
        await page.locator('a[href="#start-date"]').click();

        await page.locator('#start-year').fill('2020');
        await page.locator('#ctftime button[type="submit"]').click();
        await page.waitForTimeout(2000);
        console.log('✅ Contest start time restored to PAST (2020)');
    });
}

async function navigateToChallenges(page: Page) {
    await test.step('Navigate to Challenges page', async () => {
        await page.goto(`${CONTESTANT_URL}/challenges`);
        await page.waitForTimeout(1000);
        await expect(page.locator('h1', { hasText: '[CHALLENGES]' })).toBeVisible({ timeout: 10000 });
    });
}

async function dismissAllSwals(page: Page) {
    await test.step('Dismiss all SweetAlerts', async () => {
        await page.evaluate(() => {
            const swals = document.querySelectorAll('.swal2-container');
            swals.forEach(s => s.remove());
            document.body.classList.remove('swal2-shown', 'swal2-height-auto');
        });
        await page.waitForTimeout(500);
    });
}

// =============================================================================
// TEST CASES
// =============================================================================

test.describe('Challenges Functionality Suite', () => {

    test('TC-C001: View challenge list by Category', async ({ page }) => {
        await loginUser(page);
        await navigateToChallenges(page);

        const categories = page.locator('.space-y-2 > div.rounded-lg.border');
        const count = await categories.count();
        expect(count).toBeGreaterThan(0);

        for (let i = 0; i < Math.min(count, 3); i++) {
            const category = categories.nth(i);
            const headerButton = category.locator('button').first();
            const categoryName = await headerButton.locator('.font-bold.text-sm.font-mono').first().innerText();

            await test.step(`Verify category: ${categoryName}`, async () => {
                await headerButton.click();

                // Wait for the challenges list to be visible (AnimatePresence adds it to DOM)
                const challengeItems = category.locator('h3.font-mono');

                // If the category was already expanded, clicking it collapses it. 
                // Let's ensure it's expanded by checking if it was initially collapsed or just wait and check.
                // For reliability, we can wait until at least one challenge appears if count > 0.
                try {
                    await challengeItems.first().waitFor({ state: 'visible', timeout: 5000 });
                } catch (e) {
                    console.log(`ℹ️ Category ${categoryName} might be empty or still loading.`);
                }

                const challengeCount = await challengeItems.count();
                console.log(`Category ${categoryName} has ${challengeCount} challenges visible.`);
                // We expect at least some challenges in the first few categories if they are setup
            });
        }
    });

    test('TC-C002: View Challenge Details', async ({ page }) => {
        await loginUser(page);
        await navigateToChallenges(page);

        // Expand first category
        const firstCategory = page.locator('button').filter({ hasText: /challenges/i }).first();
        await firstCategory.click();

        // Click first challenge
        const firstChallenge = page.locator('h3.font-mono').first();
        const challengeName = await firstChallenge.innerText();
        await firstChallenge.click();

        // Verify Detail Panel
        await expect(page.locator('h2', { hasText: challengeName })).toBeVisible();
        await expect(page.getByText('[CHALLENGE INFO]', { exact: true }).first()).toBeVisible();
        await expect(page.locator('span', { hasText: /pts/i }).first()).toBeVisible();
    });

    test('TC-C003: View locked challenge (dependencies)', async ({ page }) => {
        await loginUser(page);
        await navigateToChallenges(page);

        // Find a locked challenge (has Lock icon and [!] locked text)
        const lockedChallenge = page.locator('div').filter({ hasText: '[!] locked' }).first();

        if (await lockedChallenge.isVisible()) {
            await lockedChallenge.click();

            // Verify Warning Popup
            await expect(page.locator('.swal2-popup')).toBeVisible();
            await expect(page.locator('.swal2-html-container', { hasText: '[!] Challenge Locked' }).first()).toBeVisible();
            await expect(page.locator('.swal2-html-container', { hasText: '> Prerequisites required:' }).first()).toBeVisible();

            await page.locator('button', { hasText: 'Close' }).click();
        } else {
            console.log('⚠️ No locked challenges found for user20, skipping TC-C003 partially.');
        }
    });

    test('TC-C004: View challenges before contest starts', async ({ browser }) => {
        test.setTimeout(120000);
        const adminContext = await browser.newContext();
        const adminPage = await adminContext.newPage();

        try {
            await loginAdmin(adminPage);
            await setContestStartFuture(adminPage);

            const contestantPage = await (await browser.newContext()).newPage();
            await loginUser(contestantPage);
            await navigateToChallenges(contestantPage);

            // Verify Contest Not Active Banner
            await expect(contestantPage.getByText('[!] CONTEST NOT ACTIVE').first()).toBeVisible();

            await contestantPage.close();
        } finally {
            await restoreContestStart(adminPage);
            await adminContext.close();
        }
    });

    test('TC-C005: Display solved challenges', async ({ page }) => {
        // Note: This requires a challenge that is ALREADY solved by user20 
        // or a submission during test. We'll verify existing solved state if any.
        await loginUser(page);
        await navigateToChallenges(page);

        const solvedBadge = page.locator('span', { hasText: 'SOLVED' });
        if (await solvedBadge.isVisible()) {
            await expect(solvedBadge.first()).toBeVisible();
            const solvedCard = solvedBadge.first().locator('xpath=./ancestor::div[contains(@class, "border")]');
            await expect(solvedCard.locator('svg[data-testid="CheckIcon"]')).toBeVisible();
        } else {
            console.log('⚠️ No solved challenges found for user20, please solve one manually or via script to verify.');
        }
    });

    test('TC-C006: Display challenges that are currently being deployed', async ({ page }) => {
        await loginUser(page);
        await navigateToChallenges(page);

        // Find a challenge that requires deployment
        // In this UI, they often have a Timer or Terminal icon if they are deployable
        // Let's find one that 'is_deployable' or just 'Deploy' button in details

        // Expand a category
        const firstCategory = page.locator('button').filter({ hasText: /challenges/i }).first();
        await firstCategory.click();

        // Click a challenge (preferably one not solved)
        const unsolvedChallenge = page.locator('div:not(:has(span:has-text("SOLVED"))) > div > h3.font-mono').first();
        await unsolvedChallenge.click();

        const startBtn = page.locator('button', { hasText: /\[-\] START|\[START\]/i });
        if (await startBtn.isVisible()) {
            await startBtn.click();

            // Verify Deploying UI (Spinner, "Checking", "Deploying")
            await expect(page.locator('button', { hasText: /Checking|Deploying/i })).toBeVisible();
            await expect(page.locator('.MuiCircularProgress-root')).toBeVisible();

            // Cleanup: Stop if button changes to STOP
            const stopBtn = page.locator('button', { hasText: /STOP/i });
            if (await stopBtn.isVisible({ timeout: 10000 })) {
                await stopBtn.click();
                await page.locator('button', { hasText: 'Yes, stop it!' }).click();
            }
        } else {
            console.log('⚠️ No deployable challenges found or already started.');
        }
    });
});
