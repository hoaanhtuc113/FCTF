import { test, expect, Page, BrowserContext } from '@playwright/test';

/**
 * Hint Buy Test Suite
 * Tests for the hint unlocking functionality in the contestant portal.
 */

// Force serial execution to avoid session interference
test.describe.configure({ mode: 'serial' });

// =============================================================================
// HELPERS
// =============================================================================

async function loginUser(page: Page, user: string = 'user2', pass: string = '1') {
    await test.step(`Login as ${user}`, async () => {
        await page.goto('https://contestant0.fctf.site/login');
        await page.locator("input[placeholder='input username...']").fill(user);
        await page.locator("input[placeholder='enter_password']").fill(pass);
        await page.locator("button[type='submit']").click();
        await page.waitForURL(/\/(dashboard|challenges|tickets|scoreboard|instances)/, { timeout: 60000 });
        await page.waitForTimeout(2000); // Wait for layout/data to load
    });
}

async function navigateToChallenges(page: Page) {
    await test.step('Navigate to Challenges page', async () => {
        await page.locator('button', { hasText: 'Challenges' }).click();
        await page.waitForTimeout(1000);
        await expect(page.locator('h1', { hasText: '[CHALLENGES]' })).toBeVisible({ timeout: 10000 });
    });
}

/**
 * Finds a challenge card that is likely to have hints.
 * In a real environment, we'd target a specific test challenge.
 * Here we'll try to find one that is visible.
 */
async function openChallenge(page: Page, challengeName?: string) {
    await test.step(`Open challenge: ${challengeName || 'any'}`, async () => {
        let card;
        if (challengeName) {
            card = page.locator(`h2:has-text("${challengeName}")`).first();
        } else {
            // Pick first challenge card
            card = page.locator('.cursor-pointer').first();
        }
        await card.click();
        await page.waitForTimeout(1000);
    });
}

async function checkSwalAlert(page: Page, expectedText: string, timeout: number = 10000) {
    const swal = page.locator('.swal2-popup');
    await expect(swal).toBeVisible({ timeout });

    // Use toContainText which will wait/retry until the expected text appears 
    // (useful to bypass the confirmation dialog text that briefly remains)
    await expect(swal).toContainText(expectedText, { timeout });

    // Auto-close OK button if it exists
    const okButton = page.locator('.swal2-confirm');
    if (await okButton.isVisible()) {
        await okButton.click();
    }
    await page.waitForTimeout(500);
}

// Shared variable to store a challenge name that has hints, to avoid re-discovery
let challengeWithHints: string | null = null;
let challengeWithMultipleHints: string | null = null;

async function dismissAllSwals(page: Page) {
    await test.step('Dismiss all Swals', async () => {
        // Use page.evaluate to force-close any Swal if possible
        await page.evaluate(() => {
            if (typeof (window as any).Swal !== 'undefined') {
                (window as any).Swal.close();
            }
        });
        await page.waitForTimeout(500);

        // Fallback: click buttons if still there
        const okButton = page.locator('.swal2-confirm');
        if (await okButton.isVisible()) {
            await okButton.click().catch(() => { });
            await page.waitForTimeout(500);
        }
    });
}

// =============================================================================
// TEST CASES
// =============================================================================

test.describe('Hint Buy Functionality', () => {

    test('TC-H001: Buy hint successfully', async ({ page }) => {
        test.setTimeout(60000);
        await loginUser(page, 'user6');
        await navigateToChallenges(page);

        // Step 1: Open the first challenge
        await test.step('Open first challenge', async () => {
            await dismissAllSwals(page);
            const firstChallenge = page.locator('h3').first();
            await expect(firstChallenge).toBeVisible();
            await firstChallenge.click();
            await page.waitForTimeout(1500);
            await expect(page.locator('text=[HINTS]')).toBeVisible({ timeout: 10000 });
        });

        // Step 2: Click first hint (H1)
        const h1Button = page.locator('button').filter({ hasText: /^H1/ }).first();
        await expect(h1Button).toBeVisible();
        await h1Button.click();

        // Step 3: Confirm Unlock in Swal
        await test.step('Confirm unlock in Swal', async () => {
            const swal = page.locator('.swal2-popup');
            await expect(swal).toBeVisible();
            await page.locator('.swal2-confirm').click();
        });

        // Step 4: Verify result
        const swal = page.locator('.swal2-popup');
        // Wait for the popup to show the result (Success or Already unlocked)
        // We use toContainText which retries and waits for visibility implicitly
        await expect(swal).toContainText(/(Hint unlocked|Already unlocked)/i, { timeout: 15000 });

        const text = await swal.textContent() || '';
        console.log(`TC-H001 result text: ${text.replace(/\s+/g, ' ')}`);

        await dismissAllSwals(page);
    });

    test('TC-H002: Buy hint with insufficient points', async ({ page }) => {
        test.setTimeout(60000);
        // Use user20 who was confirmed to have fewer points
        await loginUser(page, 'user20');
        await navigateToChallenges(page);

        await test.step('Open first challenge', async () => {
            await dismissAllSwals(page);
            await page.locator('h3').first().click();
            await page.waitForTimeout(1500);
            await expect(page.locator('text=[HINTS]')).toBeVisible({ timeout: 10000 });
        });

        // Click H1 (should fail due to cost)
        const h1Button = page.locator('button').filter({ hasText: /^H1/ }).first();
        await h1Button.click();

        const swal = page.locator('.swal2-popup');
        await expect(swal).toBeVisible();
        await page.locator('.swal2-confirm').click();

        // Wait for error response
        await expect(swal).not.toContainText(/Unlock hint/i, { timeout: 10000 });
        await expect(swal).toContainText(/Not enough points/i, { timeout: 10000 });

        console.log('✅ TC-H002: Caught insufficient points error - PASS');
        await dismissAllSwals(page);
    });

    test('TC-H003: Buy hint2 that requires hint1 first', async ({ page }) => {
        test.setTimeout(60000);
        // Use user10 to potentially find a fresh team state for prerequisites
        await loginUser(page, 'user10');
        await navigateToChallenges(page);

        await test.step('Open first challenge', async () => {
            await dismissAllSwals(page);
            await page.locator('h3').first().click();
            await page.waitForTimeout(1500);
            await expect(page.locator('text=[HINTS]')).toBeVisible({ timeout: 10000 });
        });

        const h2Button = page.locator('button').filter({ hasText: /^H2/ }).first();
        if (await h2Button.isHidden()) {
            console.log('Skipping TC-H003: H2 hint button not found even after load');
            test.skip();
        }

        await h2Button.click();
        const swal = page.locator('.swal2-popup');
        await expect(swal).toBeVisible();
        await page.locator('.swal2-confirm').click();

        // Wait for error about prerequisite
        await expect(swal).not.toContainText(/Unlock hint/i, { timeout: 10000 });
        await expect(swal).toContainText(/must unlock other hints/i, { timeout: 10000 });

        console.log('✅ TC-H003: Prerequisite check enforced - PASS');
        await dismissAllSwals(page);
    });
});
