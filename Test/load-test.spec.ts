import { test, expect, Page } from '@playwright/test';

// Khai báo mảng để lưu metrics
interface MetricData {
    user: string;
    action: string;
    duration: number;
    timestamp: string;
}

const metrics: MetricData[] = [];

// Helper function để log metrics
function logMetric(user: string, action: string, startTime: number) {
    const duration = Date.now() - startTime;
    metrics.push({
        user,
        action,
        duration,
        timestamp: new Date().toISOString()
    });
    console.log(`[${user}] ${action}: ${duration}ms`);
}

// Helper function để click với retry
async function waitAndClick(page: Page, xpath: string, description: string, userId: string) {
    try {
        await page.waitForSelector(`xpath=${xpath}`, { state: 'visible', timeout: 60000 });
        await page.waitForTimeout(1000);
        await page.locator(`xpath=${xpath}`).click({ force: true });
        return true;
    } catch (err: any) {
        console.log(`[${userId}] Lỗi click ${description}: ${err.message}`);
        return false;
    }
}

// Cấu hình test để chạy song song
test.describe.configure({ mode: 'parallel' });

// Hàm test chính - sẽ được gọi cho mỗi user
async function runUserTest(page: Page, userName: string) {
    console.log(`Starting test with ${userName}`);

    try {
        // 1. ĐO THỜI GIAN LOGIN
        await page.goto('https://contestant.fctf.mnhduc.site/login', { waitUntil: 'networkidle' });

        const startLogin = Date.now();
        await page.locator("input[placeholder='input username...']").fill(userName);
        await page.locator("input[placeholder='enter_password']").fill("1");
        await page.locator("//button[@type='submit']").click();
        await page.waitForSelector('xpath=//button[contains(., "Tickets")]', { timeout: 60000 });
        logMetric(userName, 'login', startLogin);

        // 2. ĐO THỜI GIAN TẠO TICKET (nếu cần, hiện tại comment)
        // const startTicket = Date.now();
        // ... code tạo ticket
        // logMetric(userName, 'create_ticket', startTicket);

        // 3. ĐO THỜI GIAN LOAD SCOREBOARD
        const startScore = Date.now();
        await waitAndClick(page, '//button[contains(., "Scoreboard")]', "Mở Scoreboard", userName);
        await page.waitForSelector('xpath=//table | //div[contains(@class, "table")]', { timeout: 30000 });
        logMetric(userName, 'load_scoreboard', startScore);

        // 4. ĐO THỜI GIAN LOAD INSTANCES
        const startInst = Date.now();
        await waitAndClick(page, '//button[contains(., "Instances")]', "Mở Instances", userName);
        await page.waitForTimeout(2000);
        logMetric(userName, 'load_instances', startInst);

        // 5. ĐO THỜI GIAN LOAD ACTION LOGS
        const startLogs = Date.now();
        await waitAndClick(page, '//button[contains(., "Action Logs")]', "Mở Action Logs", userName);
        await page.waitForTimeout(2000);
        logMetric(userName, 'load_action_logs', startLogs);

        // 6. ĐO THỜI GIAN CHỜ TOKEN
        await waitAndClick(page, '//button[contains(., "Challenges")]', "Vào Challenges", userName);
        const categoryXpath = '//*[@id="root"]/div/div/div/div/div[1]/div/div[2]/button[1]';
        await waitAndClick(page, categoryXpath, "Chọn Category", userName);
        const exactXpath = '//*[@id="root"]/div/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div';
        await waitAndClick(page, exactXpath, "Chọn Challenge", userName);

        const startToken = Date.now();
        const startBtnXpath = '//*[@id="root"]/div/div/div/div/div[2]/div/div[2]/div/div[2]/div[4]/button';
        await waitAndClick(page, startBtnXpath, "Bấm Start Challenge", userName);

        const tokenSelector = 'div.text-orange-600';
        await page.waitForFunction(
            (sel) => {
                const el = document.querySelector(sel) as HTMLElement;
                return el && el.innerText.trim().startsWith('ey');
            },
            tokenSelector,
            { timeout: 300000 }
        );
        logMetric(userName, 'get_token', startToken);

        // 7. VÒNG LẶP - Lặp qua các trang
        let count = 1;
        const maxIterations = 100; // Giới hạn số lần lặp để tránh chạy vô hạn

        while (count <= maxIterations) {
            await waitAndClick(page, '//button[contains(., "Scoreboard")]', "Lặp: Scoreboard", userName);
            await page.waitForTimeout(2000);

            await waitAndClick(page, '//button[contains(., "Tickets")]', "Lặp: Tickets", userName);
            await page.waitForTimeout(2000);

            await waitAndClick(page, '//button[contains(., "Action Logs")]', "Lặp: Action Logs", userName);
            await page.waitForTimeout(2000);

            await waitAndClick(page, '//button[contains(., "Instances")]', "Lặp: Instances", userName);
            await page.waitForTimeout(2000);

            if (count > 22) {
                await waitAndClick(page, '//button[contains(., "Challenges")]', "Vào Challenges", userName);

                const categoryXpath = '//*[@id="root"]/div/div/div/div/div[1]/div/div[2]/button[1]';
                await waitAndClick(page, categoryXpath, "Chọn Category", userName);

                const exactXpath = '//*[@id="root"]/div/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div';
                await waitAndClick(page, exactXpath, "Chọn Challenge", userName);

                const startBtnXpath = '//*[@id="root"]/div/div/div/div/div[2]/div/div[2]/div/div[2]/div[4]/button';
                await waitAndClick(page, startBtnXpath, "Bấm Start Challenge", userName);

                const tokenSelector = 'div.text-orange-600';
                await page.waitForFunction(
                    (sel) => {
                        const el = document.querySelector(sel) as HTMLElement;
                        return el && el.innerText.trim().startsWith('ey');
                    },
                    tokenSelector,
                    { timeout: 300000 }
                );
                count = 0;
            }

            count++;
        }

    } catch (e: any) {
        console.log(`[${userName}] Lỗi: ${e.message}`);
        throw e;
    }
}

// TẠO 20 TEST CASES - MỖI TEST CHO 1 USER
for (let i = 1; i <= 20; i++) {
    test(`Load test - User ${i}`, async ({ page }) => {
        const userName = `user${i}`;
        await runUserTest(page, userName);
    });
}

// Hook để xuất metrics sau khi tất cả tests hoàn thành
test.afterAll(async () => {
    // Xuất metrics ra file CSV hoặc JSON
    const fs = require('fs');
    const path = require('path');

    // Xuất JSON
    fs.writeFileSync(
        path.join(__dirname, 'load-test-metrics.json'),
        JSON.stringify(metrics, null, 2)
    );

    // Xuất CSV
    if (metrics.length > 0) {
        const headers = Object.keys(metrics[0]).join(',');
        const rows = metrics.map(m => Object.values(m).join(','));
        const csv = [headers, ...rows].join('\n');
        fs.writeFileSync(path.join(__dirname, 'load-test-metrics.csv'), csv);
    }

    console.log(`\n=== METRICS SUMMARY ===`);
    console.log(`Total measurements: ${metrics.length}`);
});
