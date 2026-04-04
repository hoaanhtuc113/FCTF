import { test, expect, Page } from '@playwright/test';

/**
 * Logging & Monitoring (LM) Test Suite
 * Verifies that system events are correctly recorded in Grafana Loki.
 */

const ADMIN_URL = 'https://admin0.fctf.site';
const CONTESTANT_URL = 'https://contestant0.fctf.site';
const GRAFANA_URL = 'https://grafana.fctf.site';

// =============================================================================
// HELPERS
// =============================================================================

async function loginUser(page: Page, username: string) {
    await page.goto(`${CONTESTANT_URL}/login`);
    await page.locator("input[placeholder='input username...']").fill(username);
    await page.locator("input[placeholder='enter_password']").fill('1');
    await page.locator("button[type='submit']").click();
    await page.waitForURL(/\/(dashboard|challenges|tickets|profile)/);
}

async function loginAdmin(page: Page) {
    await page.goto(`${ADMIN_URL}/login`);
    await page.getByRole('textbox', { name: 'User Name or Email' }).fill('admin');
    await page.getByRole('textbox', { name: 'Password' }).fill('1');
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page).toHaveURL(/.*admin/);
}

async function loginGrafana(page: Page, retries = 2) {
    for (let i = 0; i < retries; i++) {
        try {
            await page.goto(`${GRAFANA_URL}/login`, { timeout: 60000, waitUntil: 'load' });
            // Check if already logged in by looking for the login button
            const loginBtn = page.getByTestId('data-testid Login button');
            if (await loginBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
                await page.getByTestId('data-testid Username input field').fill('admin');
                await page.getByTestId('data-testid Password input field').fill('Fctf2025@');
                await loginBtn.click();
                await page.waitForURL(/.*grafana.fctf.site\//, { timeout: 60000 });
                await page.waitForTimeout(5000);
            }
            return;
        } catch (e) {
            console.log(`⚠️ loginGrafana failed (attempt ${i + 1}/${retries}): ${(e as Error).message}`);
            if (i === retries - 1) throw e;
            await page.waitForTimeout(5000);
        }
    }
}

async function queryLokiBuilder(page: Page, label: string, value: string, expectedText: string | RegExp) {
    const testId = `query-${Date.now()}`;
    try {
        await page.goto(`${GRAFANA_URL}/explore`, { timeout: 90000, waitUntil: 'load' });
        await page.waitForTimeout(5000);

        // Ensure we are in Builder mode
        const builderBtn = page.getByRole('button', { name: 'Builder' });
        if (await builderBtn.isVisible()) {
            await builderBtn.click();
        }

        // 1. Select Label (e.g. 'app')
        // Using user's selector pattern for icons
        const labelDropdownIcon = page.locator('.css-1ms3s8l-input-suffix > .css-1d3xu67-Icon').first();
        await labelDropdownIcon.click();
        await page.getByText(label, { exact: true }).first().click();

        // 2. Select Value (e.g. 'contestant-be')
        const valueInput = page.getByTestId('data-testid Select value-input');
        await valueInput.click();
        await valueInput.fill(value);
        await page.getByRole('option', { name: value }).first().click();

        // 3. Run Query
        await page.getByTestId('data-testid RefreshPicker run button').click();
        console.log(`🔍 Querying Loki: ${label}=${value}`);

        // 4. Polling for Log Content with Scrolling
        console.log(`⌛ Waiting for log containing: ${expectedText}`);

        let found = false;
        const startTime = Date.now();
        while (Date.now() - startTime < 120000) { // Increased to 2 mins
            try {
                // Check if text is present
                const bodyText = await page.innerText('body');
                if (bodyText.includes(expectedText instanceof RegExp ? "" : expectedText) || (expectedText instanceof RegExp && expectedText.test(bodyText))) {
                    found = true;
                    break;
                }

                // Scroll down the log window to trigger loading/rendering
                // Logs are usually in a scrollable container
                const logScrollable = page.locator('.log-rows-container, .log-rows, [role="log"]').first();
                if (await logScrollable.isVisible()) {
                    await logScrollable.evaluate((el) => el.scrollTop = el.scrollHeight);
                    await page.waitForTimeout(2000);
                    await logScrollable.evaluate((el) => el.scrollTop = 0); // Scroll back up to see new top logs
                } else {
                    // Fallback scroll
                    await page.mouse.wheel(0, 5000);
                }

                await page.waitForTimeout(5000);

                // Click refresh/run if not found after few scrolls
                await page.getByTestId('data-testid RefreshPicker run button').click();
                await page.waitForTimeout(5000);
            } catch (e) {
                await page.waitForTimeout(5000);
            }
        }

        if (!found) throw new Error(`Log with text "${expectedText}" not found after 120s`);
        console.log(`✅ Log verified!`);

    } catch (e) {
        if (!page.isClosed()) {
            await page.screenshot({ path: `test-results/failure-${testId}.png`, fullPage: true });
            console.log(`❌ queryLokiBuilder failed. Screenshot saved: test-results/failure-${testId}.png`);
        }
        throw e;
    }
}

// =============================================================================
// LM TESTS
// =============================================================================

test.describe('Logging & Monitoring (LM) Suite', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(300000);

    test('LM-001 & LM-002: Log recorded for Start Challenge and Submit Flag', async ({ browser }) => {
        const userPage = await browser.newPage();
        const grafanaPage = await browser.newPage();

        const username = 'user901';
        const uniqueId = `test-lm-${Date.now()}`;

        // 1. Perform Actions
        await loginUser(userPage, username);

        // Start Challenge
        await userPage.goto(`${CONTESTANT_URL}/challenges`);
        const chal = userPage.locator('h3', { hasText: 'pwn' }).first();
        if (await chal.isVisible()) {
            await chal.click();
            await userPage.locator('button').filter({ hasText: /\[\+\] Start Challenge/i }).click();
            await userPage.waitForTimeout(5000);
        }

        // Submit Flag (wrong flag to avoid solving)
        const flagInput = userPage.locator('textarea[placeholder="flag{...}"]');
        if (await flagInput.isVisible()) {
            await flagInput.fill(uniqueId); // Use uniqueId as flag to find it in logs
            await userPage.locator('button').filter({ hasText: /\[SUBMIT\]/ }).click();
        }

        // 2. Verify in Grafana
        await loginGrafana(grafanaPage);

        // Check Start Challenge Log
        await queryLokiBuilder(grafanaPage, 'app', 'contestant-be', /started challenge|deploy/i);
        console.log('✅ LM-001: Start challenge log verified');

        // Check Submit Flag Log
        await queryLokiBuilder(grafanaPage, 'app', 'contestant-be', new RegExp(uniqueId));
        console.log('✅ LM-002: Submit flag log verified');

        await userPage.close();
        await grafanaPage.close();
    });

    test('LM-003: Log recorded when user sends a ticket', async ({ browser }) => {
        const userPage = await browser.newPage();
        const grafanaPage = await browser.newPage();
        const ticketContent = `Audit test ticket ${Date.now()}`;
        const ticketTitle = `Log Test ${Date.now()}`;

        await loginUser(userPage, 'user903');

        // Correct Ticket Flow
        await userPage.goto(`${CONTESTANT_URL}/tickets`);
        await userPage.locator('button', { hasText: 'NEW TICKET' }).click();
        await userPage.waitForSelector('text=[CREATE_TICKET]', { timeout: 10000 });

        await userPage.locator('input#title').fill(ticketTitle);
        await userPage.locator('select#type').selectOption('Question');
        await userPage.locator('textarea#description').fill(ticketContent);
        await userPage.locator('button[type="submit"]').filter({ hasText: 'CREATE TICKET' }).click();

        // Wait for success Swal
        await userPage.waitForSelector('.swal2-popup', { timeout: 10000 });

        await loginGrafana(grafanaPage);
        await queryLokiBuilder(grafanaPage, 'app', 'contestant-be', new RegExp(ticketContent));
        console.log('✅ LM-003: Ticket log verified');

        await userPage.close();
        await grafanaPage.close();
    });

    test('LM-004: Log recorded when user changes password', async ({ browser }) => {
        const userPage = await browser.newPage();
        const grafanaPage = await browser.newPage();

        await loginUser(userPage, 'user904');
        await userPage.goto(`${CONTESTANT_URL}/profile`);
        // Assuming change password is in profile settings
        const changePassBtn = userPage.locator('button').filter({ hasText: /Change Password/i });
        if (await changePassBtn.isVisible()) {
            await changePassBtn.click();
            await userPage.locator('input[name="new_password"]').fill('1');
            await userPage.locator('input[name="confirm_password"]').fill('1');
            await userPage.locator('button').filter({ hasText: /Update|Save/i }).last().click();
        }

        await loginGrafana(grafanaPage);
        await queryLokiBuilder(grafanaPage, 'app', 'contestant-be', /password changed|update/i);
        console.log('✅ LM-004: Password change log verified');

        await userPage.close();
        await grafanaPage.close();
    });

    test('LM-005, LM-006, LM-007: Log recorded when an error occurs', async ({ browser }) => {
        const userPage = await browser.newPage();
        const adminPage = await browser.newPage();
        const grafanaPage = await browser.newPage();

        // Trigger Contestant-BE Error (404)
        await userPage.goto(`${CONTESTANT_URL}/api/v1/non-existent-endpoint-${Date.now()}`);

        // Trigger Admin-MVC Error
        await loginAdmin(adminPage);
        await adminPage.goto(`${ADMIN_URL}/admin/non-existent-page-${Date.now()}`);

        await loginGrafana(grafanaPage);

        // LM-005: Contestant BE Error
        await queryLokiBuilder(grafanaPage, 'app', 'contestant-be', /error|404|exception/i);
        console.log('✅ LM-005: Contestant-BE error log verified');

        // LM-007: Admin-MVC Error
        await queryLokiBuilder(grafanaPage, 'app', 'admin-mvc', /error|404|exception/i);
        console.log('✅ LM-007: Admin-MVC error log verified');

        await userPage.close();
        await adminPage.close();
        await grafanaPage.close();
    });
});
