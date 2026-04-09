import { test, expect, type Page } from '@playwright/test';
import { spawn } from 'child_process';

const ADMIN_URL = 'https://admin3.fctf.site';
const CONTESTANT_URL = 'https://contestant3.fctf.site';

async function loginContestant(page: Page) {
    await page.goto(`${CONTESTANT_URL}/login`);
    await page.getByRole('textbox', { name: 'input username...' }).fill('user22');
    await page.getByRole('textbox', { name: 'enter_password' }).fill('1');
    await page.getByRole('button', { name: '[LOGIN]' }).click();
    await expect(page).toHaveURL(/.*challenges/, { timeout: 30000 });
}

async function loginAdmin(page: Page) {
    await page.goto(`${ADMIN_URL}/login`);
    await page.waitForTimeout(1000);
    const userField = page.getByRole('textbox', { name: 'User Name or Email' });
    if (await userField.isVisible({ timeout: 5000 }).catch(() => false)) {
        await userField.fill('admin');
        await page.getByRole('textbox', { name: 'Password' }).fill('1');
        await page.getByRole('button', { name: 'Submit' }).click();
        await page.waitForURL(/admin3\.fctf\.site\/(admin|dashboard)/, { timeout: 30000 });
        await page.waitForTimeout(2000);
    }
}


async function openChallenge(page: Page, category: string, challengeName: string) {
    console.log(`Searching for challenge "${challengeName}" in category "${category}"...`);
    await page.goto(`${CONTESTANT_URL}/challenges`);
    await page.waitForTimeout(2000);

    // Mở category nếu cần (TCP thường đã mở sẵn)
    const catBtn = page.getByRole('button', { name: new RegExp(`${category}.*challenges`, 'i') }).first();
    const catBtnVisible = await catBtn.isVisible().catch(() => false);
    if (catBtnVisible) {
        const cls = await catBtn.getAttribute('class') || '';
        if (!cls.includes('bg-orange-50')) {
            console.log(`Expanding category "${category}"...`);
            await catBtn.click();
            await page.waitForTimeout(1500);
        } else {
            console.log(`Category "${category}" already open.`);
        }
    }
    
    // Click vào challenge item qua h3 heading
    const heading = page.getByRole('heading', { name: challengeName });
    await heading.waitFor({ state: 'visible', timeout: 15000 });
    await heading.click();

    // Chờ panel challenge mở — có thể là Start hoặc Stop (nếu đang chạy sẵn)
    await page.waitForTimeout(2000);
}

async function startAndGetHttpUrl(page: Page): Promise<string> {
    const startBtn = page.getByRole('button', { name: '[+] Start Challenge' });
    if (await startBtn.isVisible()) {
        await startBtn.click();
        await page.locator('.swal2-popup button').filter({ hasText: /OK|Close|Got it/i }).first()
            .click({ timeout: 180000 })
            .catch(() => {});
    }
    const urlLoc = page.locator('div.break-all.text-blue-600, div.break-all:has-text("fctftoken")').first();
    await urlLoc.waitFor({ state: 'visible', timeout: 90000 });
    let rawUrl = (await urlLoc.innerText()).trim();
    if (rawUrl.includes('\n')) rawUrl = rawUrl.split('\n').pop()?.trim() || rawUrl;
    if (!rawUrl.includes('://')) rawUrl = `http://${rawUrl}`;
    return rawUrl;
}

async function startAndGetTcpToken(page: Page): Promise<string> {
    const startBtn = page.locator('button').filter({ hasText: /start/i }).first();
    if (await startBtn.isVisible()) {
        await startBtn.click();
        await page.locator('.swal2-popup button').filter({ hasText: /OK|Close|Got it/i }).first()
            .click({ timeout: 180000 })
            .catch(() => {});
    }
    const tokenLoc = page.locator('div.break-all.text-orange-600, div.font-mono.text-orange-600, div.break-all:not(.text-blue-600)').first();
    await tokenLoc.waitFor({ state: 'visible', timeout: 90000 });
    let token = (await tokenLoc.innerText()).trim();
    if (token.includes('\n')) token = token.split('\n').pop()?.trim() || token;
    return token;
}

function connectViaNcat(host: string, port: number, token: string, payload: string) {
    return new Promise((resolve) => {
        const proc = spawn('ncat', [host, String(port)], { stdio: ['pipe', 'pipe', 'pipe'] });
        
        proc.stdout.on('data', (data: any) => {
            const output = data.toString();
            if (output.length > 0) {
                try { proc.stdin.write(token + '\n'); } catch (_) {}
                setTimeout(() => {
                    try { proc.stdin.write(payload + '\n'); } catch (_) {}
                    setTimeout(() => { proc.kill(); resolve(true); }, 2000);
                }, 1000);
            }
        });

        setTimeout(() => {
            proc.kill();
            resolve(false);
        }, 15000);
    });
}

async function verifyLogOnAdmin(page: Page, challengeName: string, expectedText: string) {
    await loginAdmin(page);
    // Điều hướng thẳng đến trang Monitoring bằng URL
    await page.goto(`${ADMIN_URL}/admin/monitoring`);
    await page.waitForTimeout(2000);
    
    // Tìm đúng dòng của challenge và click Actions
    const row = page.locator('tr').filter({ hasText: new RegExp(challengeName, 'i') }).first();
    await row.waitFor({ state: 'visible', timeout: 20000 });
    await row.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('link', { name: ' Request Logs' }).click();
    
    // Kiểm tra log có chứa text mong muốn không
    await expect(page.locator('body')).toContainText(expectedText, { timeout: 30000 });
}

test.describe('Instance Request Logs Verification', () => {
    test.setTimeout(300000);

    test('INST-LOG-001: Web Challenge Request Logs', async ({ browser }) => {
        const contestantPage = await browser.newPage();
        await loginContestant(contestantPage);
        await openChallenge(contestantPage, 'Web', 'EZ Web 1');
        const challengeUrl = await startAndGetHttpUrl(contestantPage);
        
        // Gửi request tới challenge
        const challengePage = await browser.newPage();
        await challengePage.goto(challengeUrl);
        const testId = `user_${Date.now()}`;
        await challengePage.getByRole('textbox', { name: /username/i }).fill(testId);
        await challengePage.getByRole('textbox', { name: /password/i }).fill('1');
        await challengePage.getByRole('button', { name: /login/i }).click().catch(() => {});
        
        // Kiểm tra log trong Admin
        const adminPage = await browser.newPage();
        await verifyLogOnAdmin(adminPage, 'EZ Web 1', testId);
        
        await adminPage.close();
        await challengePage.close();
        await contestantPage.close();
    });


    test('INST-LOG-002: TCP Challenge Request Logs', async ({ browser }) => {
        const contestantPage = await browser.newPage();
        await loginContestant(contestantPage);
        await openChallenge(contestantPage, 'TCP', 'Pwn');
        const token = await startAndGetTcpToken(contestantPage);
        
        const testPayload = `payload_${Date.now()}`;
        await connectViaNcat('challenge3.fctf.site', 30037, token, testPayload);
        
        // Kiểm tra log trong Admin
        const adminPage = await browser.newPage();
        await verifyLogOnAdmin(adminPage, 'Pwn', testPayload);
        
        await adminPage.close();
        await contestantPage.close();
    });
});
