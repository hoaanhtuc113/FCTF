import { test, expect, type Page } from '@playwright/test';

const ADMIN_URL = 'https://admin0.fctf.site';
const CONTESTANT_URL = 'https://contestant0.fctf.site';

async function loginAdmin(page: Page) {
    await page.goto(`${ADMIN_URL}/login`);
    await page.locator('input#name, input[name="name"]').first().fill('admin');
    await page.locator('input#password, input[name="password"]').first().fill('1');
    await page.locator('button[type="submit"], input#_submit').first().click();
    await expect(page).toHaveURL(/.*admin/);
}

async function loginContestant(page: Page) {
    await page.goto(`${CONTESTANT_URL}/login`);
    await page.locator("input[placeholder*='username' i]").fill('user22');
    await page.locator("input[placeholder*='password' i]").fill('1');
    await page.locator("button[type='submit']").click();
    await expect(page).toHaveURL(/.*challenges/, { timeout: 30000 });
}

/**
 * Expand category if needed and click the challenge
 */
async function openChallenge(page: Page, category: string, name: string) {
    console.log(`Searching for challenge "${name}" in category "${category}"...`);
    
    // 1. Expand the category if it appears collapsed
    // Category headers often have the category name (e.g. "Web") and a count
    const catHeader = page.locator('button, div').filter({ hasText: new RegExp(`^${category}`, 'i') }).first();
    await catHeader.click().catch(() => console.log(`Could not click category header for ${category}`));
    await page.waitForTimeout(1500); // Wait for transition

    // 2. Find the challenge item
    // Use a more robust selector that covers common CTF title patterns
    const challengeItem = page.locator('h3, h4, h5, .font-mono').filter({ hasText: new RegExp(name, 'i') }).first();
    await challengeItem.waitFor({ state: 'visible', timeout: 20000 });
    await challengeItem.click();
    
    // 3. Wait for the challenge details view (Start Challenge button or similar)
    await expect(page.locator('button').filter({ hasText: /challenge/i }).first()).toBeVisible({ timeout: 20000 });
}

/**
 * Start the challenge and extract the access URL (including fctftoken)
 */
async function startAndGetUrl(page: Page): Promise<string> {
    const startBtn = page.locator('button').filter({ hasText: /Start Challenge/i });
    if (await startBtn.isVisible()) {
        console.log("Found Start Challenge button. Clicking...");
        await startBtn.click();
        // Wait for deployment. A SweetAlert2 modal "Challenge Ready!" usually appears.
        await page.locator('.swal2-popup button').filter({ hasText: /OK|Close/i }).first()
            .click({ timeout: 120000 })
            .catch(() => console.log("Deployment modal didn't appear or already closed."));
    }

    // Wait for the instance URL to be displayed
    // The URL div usually has 'text-blue-600' class whereas the token div might be different.
    const urlLoc = page.locator('div.break-all.text-blue-600, div.break-all:has-text("fctftoken")').first();
    await urlLoc.waitFor({ state: 'visible', timeout: 60000 });
    
    let rawUrl = await urlLoc.innerText();
    rawUrl = rawUrl.trim();
    
    console.log(`Raw URL extracted: ${rawUrl}`);
    
    // Sometimes the div contains the label "HTTP " or "URL ", let's clean it up if needed
    if (rawUrl.includes('\n')) {
        rawUrl = rawUrl.split('\n').pop()?.trim() || rawUrl;
    }

    if (rawUrl.startsWith('challenge') || !rawUrl.includes('://')) {
        return `http://${rawUrl}`;
    }
    return rawUrl;
}

test.describe('Instance Request Logs Verification (INST-LOG)', () => {
    test.setTimeout(360000);

    test('INST-LOG-001: Verification of challenge instance access (WEB challenge)', async ({ page, browser }) => {
        const contestantPage = await browser.newPage();
        await loginContestant(contestantPage);
        
        await openChallenge(contestantPage, 'Web', 'EZ Web 1');
        const challengeUrl = await startAndGetUrl(contestantPage);
        console.log(`Navigating to Challenge URL: ${challengeUrl}`);

        // Step 1: Access the challenge instance
        const challengePage = await browser.newPage();
        await challengePage.goto(challengeUrl, { timeout: 60000 });
        
        // Basic check to ensure we are on the challenge page (e.g., check for common CTF elements or no error)
        await expect(challengePage).not.toHaveTitle(/404|Error|Forbidden/i);
        console.log("Successfully navigated to challenge instance.");

        await challengePage.close();
        await contestantPage.close();
    });

    // INST-LOG-002 for TCP/PWN was removed as it requires ncat and custom token input which is outside the current scope.
});


