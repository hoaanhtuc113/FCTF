import { test, expect, Page } from '@playwright/test';

const ADMIN_URL = 'https://admin.sanchoi.iahn.hanoi.vn';
const CONTESTANT_URL = 'https://sanchoi.iahn.hanoi.vn';

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

// Helper: Login User with retry
async function loginUser(page: Page, username: string = 'user20', retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            await page.goto(`${CONTESTANT_URL}/login`, { waitUntil: 'load', timeout: 60000 });
            await page.locator("input[placeholder='input username...']").fill(username);
            await page.locator("input[placeholder='enter_password']").fill('1');
            await page.locator("button[type='submit']").click();

            await page.waitForURL(/\/(dashboard|challenges|tickets|profile)/, { timeout: 30000 });
            console.log(`✅ User ${username} logged in successfully`);
            return;
        } catch (e: any) {
            console.warn(`⚠️ loginUser (${username}) attempt ${i + 1} failed: ${e.message}`);
            if (i === retries - 1) throw e;
            await page.waitForTimeout(5000);
        }
    }
}

// Helpers adapted from stop-challenge-test.spec.ts
async function startAnUnlockedChallenge(page: Page) {
    await test.step('Start any unlocked challenge', async () => {
        await page.goto(`${CONTESTANT_URL}/challenges`);
        await expect(page.locator('div.flex.items-center.justify-between.gap-2 h1')).toContainText(/CHALLENGES/i, { timeout: 30000 });
        await page.waitForTimeout(2000);

        const categories = page.locator('button').filter({ has: page.locator('div.font-mono') });
        const catCount = await categories.count();
        console.log(`📂 Found ${catCount} categories`);

        for (let i = 0; i < catCount; i++) {
            await categories.nth(i).click();
            await page.waitForTimeout(1000);

            const challenges = page.locator('h3.font-mono');
            const chalCount = await challenges.count();

            for (let j = 0; j < chalCount; j++) {
                const chal = challenges.nth(j);
                const chalName = await chal.innerText();
                console.log(`🔍 Checking challenge: ${chalName}`);
                await chal.click();
                await page.waitForTimeout(1500);

                // Check if locked
                const lockedMsg = page.locator('text=/Challenge Locked|Prerequisites required/i');
                if (await lockedMsg.isVisible()) {
                    console.log(`🔒 ${chalName} is locked. Closing modal...`);
                    await page.keyboard.press('Escape');
                    await page.waitForTimeout(500);
                    continue;
                }

                const startBtn = page.locator('button').filter({ hasText: /\[\+\] Start Challenge/i });
                if (await startBtn.isVisible()) {
                    await startBtn.click();
                    console.log(`🚀 Starting ${chalName}...`);

                    const swal = page.locator('.swal2-popup');
                    await expect(swal).toContainText(/Challenge Ready|Deploying challenge/i, { timeout: 120000 }).catch(() => {
                        console.warn('⌛ Deployment taking long or Swal not seen.');
                    });

                    await page.waitForSelector('.swal2-popup', { state: 'hidden', timeout: 30000 }).catch(() => { });
                    console.log(`✅ ${chalName} started.`);
                    return; // Success!
                } else {
                    const stopBtn = page.locator('button').filter({ hasText: /Stop Challenge|\[-\] Stop|\[\.\.\.\]/i });
                    if (await stopBtn.isVisible()) {
                        console.log(`✅ ${chalName} already running.`);
                        return;
                    }
                    await page.keyboard.press('Escape');
                    await page.waitForTimeout(500);
                }
            }
            // Close category
            await categories.nth(i).click();
        }
        throw new Error('Could not find any unlocked challenge to start');
    });
}

async function setFilterValue(page: Page, selector: string, value: string) {
    const filter = page.locator(selector);
    await expect(filter).toBeVisible({ timeout: 15000 });

    const tagName = await filter.evaluate(el => el.tagName.toLowerCase());
    if (tagName === 'select') {
        await page.selectOption(selector, { label: value }).catch(async () => {
            await page.selectOption(selector, value);
        });
        return;
    }

    // Some deployments hydrate these controls into text inputs with datalist/autocomplete.
    await filter.click();
    await filter.fill('');
    await filter.type(value, { delay: 20 });
    await filter.press('Enter').catch(() => { });
    await filter.blur();
}

test.describe.serial('Monitor Instance (MCI) Test Suite', () => {
    test.setTimeout(400000);

    test.beforeAll(async ({ browser }) => {
        test.setTimeout(300000); // 5 minutes for seeding
        const page = await browser.newPage();
        try {
            await loginUser(page, 'user22');
            await startAnUnlockedChallenge(page);
        } catch (e: any) {
            console.warn(`❌ Failed to seed instance:`, e.message);
        } finally {
            await page.close();
        }
    });

    test.beforeEach(async ({ page }) => {
        await loginAdmin(page);
        await page.goto(`${ADMIN_URL}/admin/monitoring`, { waitUntil: 'load', timeout: 90000 });

        // Wait for table to load
        await page.waitForSelector('#challengeTable', { timeout: 30000 });

        // Poll for data for up to 30 seconds
        let rowsCount = 0;
        for (let i = 0; i < 6; i++) {
            rowsCount = await page.locator('#challengeTable tbody tr').count();
            if (rowsCount > 0) break;

            console.log(`🔄 [Attempt ${i + 1}] Table empty, clicking Refresh Data...`);
            const refreshBtn = page.locator('button:has-text("Refresh Data")');
            if (await refreshBtn.isVisible()) {
                await refreshBtn.click();
            } else {
                await page.reload();
            }
            await page.waitForTimeout(5000);
        }

        if (rowsCount === 0) {
            console.log('🌱 No rows found, attempting to re-seed instance...');
            const seedPage = await page.context().newPage();
            try {
                await loginUser(seedPage, 'user22');
                await startAnUnlockedChallenge(seedPage);
                await page.bringToFront();
                await page.reload();
                await page.waitForSelector('#challengeTable tbody tr', { timeout: 30000 });
            } catch (e: any) {
                console.warn(`❌ Failed to re-seed instance:`, e.message);
                await page.screenshot({ path: `test-results/empty-monitor-${Date.now()}.png`, fullPage: true });
            } finally {
                await seedPage.close();
            }
        }
    });

    test('MCI-001: View all running challenge instances', async ({ page }) => {
        await expect(page.locator('h1')).toContainText('Challenge Instance');
        const rows = page.locator('#challengeTable tbody tr');
        const count = await rows.count();
        expect(count).toBeGreaterThan(0);
        console.log(`✅ MCI-001: Found ${count} running instances`);
    });

    test('MCI-002: Filter challenge instances by team', async ({ page }) => {
        // Get first team name from table
        const firstTeamName = (await page.locator('#challengeTable tbody tr td').nth(3).innerText()).trim();
        console.log(`🔍 Filtering by Team: ${firstTeamName}`);

        await setFilterValue(page, '#teamFilter', firstTeamName);
        await page.waitForTimeout(3000); // Wait for filtering

        const rows = page.locator('#challengeTable tbody tr');
        const count = await rows.count();
        for (let i = 0; i < count; i++) {
            await expect(rows.nth(i).locator('td').nth(3)).toContainText(firstTeamName);
        }
        console.log(`✅ MCI-002: Filter by team "${firstTeamName}" success`);
    });

    test('MCI-003: Filter challenge instances by challenge name', async ({ page }) => {
        // Get first challenge name
        const challengeName = await page.locator('#challengeTable tbody tr td').nth(2).innerText();
        console.log(`🔍 Searching for Challenge: ${challengeName}`);

        await page.fill('#challengeSearch', challengeName);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);

        const rows = page.locator('#challengeTable tbody tr');
        const count = await rows.count();
        for (let i = 0; i < count; i++) {
            await expect(rows.nth(i).locator('td').nth(2)).toContainText(challengeName);
        }
        console.log(`✅ MCI-003: Search by challenge name "${challengeName}" success`);
    });

    test('MCI-007: Filter challenge instances by category', async ({ page }) => {
        // Get first category from table
        const category = (await page.locator('#challengeTable tbody tr td').nth(5).innerText()).trim();
        if (category === 'N/A') {
            console.log('⚠ Skipping MCI-007: No category available to filter');
            return;
        }
        console.log(`🔍 Filtering by Category: ${category}`);

        await setFilterValue(page, '#categoryFilter', category);
        await page.waitForTimeout(3000);

        const rows = page.locator('#challengeTable tbody tr');
        const count = await rows.count();
        for (let i = 0; i < count; i++) {
            await expect(rows.nth(i).locator('td').nth(5)).toContainText(category);
        }
        console.log(`✅ MCI-007: Filter by category "${category}" success`);
    });

    test('MCI-004: Pod Logs Verification', async ({ page }) => {
        // Assume instance is already running (started manually or by another test)
        await page.goto(`${ADMIN_URL}/admin/monitoring`, { waitUntil: 'load', timeout: 90000 });
        await page.waitForSelector('#challengeTable', { timeout: 30000 });

        const monitoringRefreshBtn = page.locator('button').filter({ hasText: /Refresh Data|Refresh/i }).first();
        if (await monitoringRefreshBtn.isVisible()) {
            await monitoringRefreshBtn.click();
        }

        const rows = page.locator('#challengeTable tbody tr');
        await expect(rows.first()).toBeVisible({ timeout: 30000 });
        const row = rows.first();

        console.log('🔍 Checking Pod Logs...');
        await row.locator('button:has-text("Actions"), button.clean-action-btn-sm').first().click();
        const podLogsLink = row.locator('a.action-menu-item:has-text("Pod Logs"), a:has-text("Pod Logs")').first();
        await expect(podLogsLink).toBeVisible({ timeout: 5000 });
        await podLogsLink.click();
        await page.waitForURL(/\/deploy_History\/.*\/pods-logs/, { timeout: 15000 });

        // Verify Refresh functionality
        const refreshBtn = page.locator('#refreshBtn');
        await expect(refreshBtn).toBeVisible();
        await refreshBtn.click();
        await expect(page.locator('body')).toContainText('Last refreshed:', { timeout: 10000 });

        // Verify Auto Refresh 5s
        await page.locator('#sync-5').click();
        await expect(page.locator('body')).toContainText('Next in', { timeout: 5000 });

        await page.locator('#sync-off').click();

        console.log('✅ MCI-004: Pod Logs verification success');
    });


});

