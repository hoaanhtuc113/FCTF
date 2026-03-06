import { test, expect, type Page } from '@playwright/test';
import * as net from 'net';
import { execSync } from 'child_process';

const ADMIN_URL = 'https://admin.fctf.site';
const CONTESTANT_URL = 'https://contestant.fctf.site';

async function loginAdmin(page: Page, retries = 2) {
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

async function loginContestant(page: Page) {
    await page.goto(`${CONTESTANT_URL}/login`, { waitUntil: 'load', timeout: 60000 });
    await page.locator("input[placeholder='input username...']").fill('user22');
    await page.locator("input[placeholder='enter_password']").fill('1');
    await page.locator("button[type='submit']").click();
    await expect(page).toHaveURL(/.*challenges/, { timeout: 30000 });
}

test.describe('Instance Request Logs Verification (INST-LOG)', () => {
    test.setTimeout(300000); // 5 minutes

    test('INST-LOG-001: Verification of HTTP request logging (WEB challenge)', async ({ page, browser }) => {
        const contestantPage = await browser.newPage();
        await loginContestant(contestantPage);
        await contestantPage.goto(`${CONTESTANT_URL}/challenges?category=WEB&challenge=186`);

        await contestantPage.locator('h3:has-text("EZ Web")').click();

        const startBtn = contestantPage.locator('button:has-text("Start Challenge")');
        if (await startBtn.isVisible()) {
            await startBtn.click();
            // Wait for deployment: TOKEN div should appear
            await contestantPage.waitForSelector('div:has-text("TOKEN")', { timeout: 120000 });
            await contestantPage.locator('button:has-text("OK"), button:has-text("Close")').first().click().catch(() => { });
        }

        let challengeUrl = await contestantPage.locator('div:has-text("HTTP") + div').first().innerText();
        challengeUrl = challengeUrl.trim();
        if (!challengeUrl.startsWith('http')) {
            challengeUrl = `http://${challengeUrl}`;
        }

        const challengePage = await browser.newPage();
        await challengePage.goto(challengeUrl);
        await challengePage.locator('input[name="username"]').fill("' OR 1=1 --");
        await challengePage.locator('input[name="password"]').fill('any');
        await challengePage.locator('button[type="submit"]').click();

        await contestantPage.waitForTimeout(10000);

        await loginAdmin(page);
        await page.goto(`${ADMIN_URL}/admin/monitoring`);
        await page.locator('button:has-text("Refresh Data")').click();

        await expect(page.locator('table')).toBeVisible();
        const row = page.locator('tr').filter({ hasText: 'EZ Web' }).first();
        await expect(row).toBeVisible({ timeout: 15000 });

        // New Navigation: Click "Actions" then "Request Logs"
        await row.locator('button:has-text("Actions")').click();
        await row.locator('a.action-menu-item:has-text("Request Logs"), a.dropdown-item:has-text("Request Logs")').first().click();

        await expect(page).toHaveURL(/.*request-logs/);

        // Verify New Refresh Features
        const refreshBtn = page.locator('#refreshBtn');
        await expect(refreshBtn).toBeVisible();
        await refreshBtn.click();
        await expect(page.locator('body')).toContainText('Last refreshed:');

        const sync5Btn = page.locator('#sync-5');
        await expect(sync5Btn).toBeVisible();
        await sync5Btn.click();
        await expect(page.locator('body')).toContainText('Next in');

        // Log shows URL-encoded body: username=%27+OR+1%3D1+-- 
        await expect(page.locator('body')).toContainText('HTTP POST /login', { timeout: 60000 });
        await expect(page.locator('body')).toContainText('%27+OR+1%3D1', { timeout: 10000 });

        await challengePage.close();
        await contestantPage.close();
    });

    test('INST-LOG-002: Verification of TCP request logging (PWN challenge)', async ({ page, browser }) => {
        // Step 1: Ensure the PWN challenge is running (start it if not)
        const contestantPage = await browser.newPage();
        await loginContestant(contestantPage);
        await contestantPage.goto(`${CONTESTANT_URL}/challenges?category=PWN&challenge=185`);
        await contestantPage.waitForTimeout(2000);

        const pwnChallenge = contestantPage.locator('h3').filter({ hasText: /pwn/i }).first();
        await pwnChallenge.click();
        await contestantPage.waitForTimeout(1500);

        const startBtn = contestantPage.locator('button').filter({ hasText: /\[\+\] Start Challenge/i });
        if (await startBtn.isVisible({ timeout: 5000 })) {
            await startBtn.click();
            await page.waitForTimeout(30000);
            await contestantPage.waitForSelector('[class*="swal"], div:has-text("TOKEN")', { timeout: 120000 });
            await contestantPage.keyboard.press('Escape');
            await contestantPage.waitForTimeout(2000);
        } else {
            console.log('✅ PWN challenge already running.');
        }
        await contestantPage.close();

        // Step 2: Admin navigates to monitoring and opens Request Logs for PWN challenge
        await loginAdmin(page);
        await page.goto(`${ADMIN_URL}/admin/monitoring`);
        await page.locator('button:has-text("Refresh Data")').click();
        await page.waitForTimeout(2000);

        // Find PWN row by challenge ID 185
        const row = page.locator('tr').filter({ hasText: '185' }).first();
        await expect(row).toBeVisible({ timeout: 15000 });

        // Click Actions (uses class clean-action-btn-sm)
        await row.locator('button:has-text("Actions")').click();
        await row.locator('a.action-menu-item:has-text("Request Logs"), a.dropdown-item:has-text("Request Logs")').first().click();


        await expect(page).toHaveURL(/.*request-logs/);

        // Step 3: Verify Refresh features work
        const refreshBtn = page.locator('#refreshBtn');
        await expect(refreshBtn).toBeVisible();
        await refreshBtn.click();
        await expect(page.locator('body')).toContainText('Last refreshed:', { timeout: 10000 });

        await page.locator('#sync-10').click();
        await expect(page.locator('body')).toContainText('Next in', { timeout: 5000 });
        await page.locator('#sync-off').click();

        // Step 4: Verify TCP log entries in #log-content
        await expect(page.locator('#log-content')).toContainText('TCP', { timeout: 30000 });
        console.log('✅ INST-LOG-002: TCP request log verification success');
    });
});
