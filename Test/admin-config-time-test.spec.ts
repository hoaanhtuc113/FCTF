import { test, expect, type Page } from '@playwright/test';

const ADMIN_URL = 'https://admin0.fctf.site';
const CONTESTANT_URL = 'https://contestant0.fctf.site';

async function loginAdmin(page: Page) {
    await test.step('Login as admin', async () => {
        await page.goto(`${ADMIN_URL}/login`);
        await page.getByRole('textbox', { name: 'User Name or Email' }).fill('admin');
        await page.getByRole('textbox', { name: 'Password' }).fill('1');
        await page.getByRole('button', { name: 'Submit' }).click();
        await expect(page).toHaveURL(/.*admin/);
    });
}

async function loginContestant(page: Page) {
    await test.step('Login as contestant', async () => {
        await page.goto(`${CONTESTANT_URL}/login`);
        await page.locator("input[placeholder='input username...']").fill('user2');
        await page.locator("input[placeholder='enter_password']").fill('1');
        await page.locator("button[type='submit']").click();
        // Wait for redirect away from login page (to dashboard, challenges, etc.)
        // Do NOT include 'login' in this regex or it resolves immediately
        await page.waitForURL(/\/(dashboard|challenges|tickets)/, { timeout: 15000 }).catch(() => {
            console.log(`loginContestant: still on ${page.url()} after 15s`);
        });
    });
}

async function clickTab(page: Page, tabName: string | RegExp, containerSelector?: string) {
    console.log(`Clicking tab: ${tabName} (container: ${containerSelector || 'default'})`);
    const root = containerSelector ? page.locator(containerSelector) : page;
    const tab = root.getByRole('tab', { name: tabName });
    await expect(tab).toBeVisible({ timeout: 10000 });
    await tab.click();
}

async function setConfigTime(page: Page, place: string, date: Date) {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = date.getFullYear();
    const hour = date.getHours();
    const minute = date.getMinutes();

    let tabName = "";
    if (place === 'start') tabName = "Start Time";
    if (place === 'end') tabName = "End Time";
    if (place === 'freeze') tabName = "Freeze Time";

    console.log(`Setting ${place} time to: ${date.toISOString()} (Local: ${month}/${day}/${year} ${hour}:${minute})`);

    // Ensure the specific time tab is visible - scope to #ctftime to avoid sidebar collisions
    await clickTab(page, new RegExp(`^${tabName}$`, 'i'), '#ctftime');

    await page.locator(`#${place}-month`).fill(month.toString());
    await page.locator(`#${place}-day`).fill(day.toString());
    await page.locator(`#${place}-year`).fill(year.toString());
    await page.locator(`#${place}-hour`).fill(hour.toString());
    await page.locator(`#${place}-minute`).fill(minute.toString());

    // Explicitly trigger change event to fire the JS calculation
    await page.locator(`#${place}-minute`).dispatchEvent('change');
    await page.locator(`#${place}-minute`).blur();

    // Wait for the hidden field to be populated (max 5s)
    await page.waitForFunction((id) => {
        const el = document.getElementById(id) as HTMLInputElement;
        return el && el.value !== "" && el.value !== "0";
    }, place, { timeout: 5000 }).catch(() => {
        console.log(`Warning: Hidden field #${place} did not populate in 5s. Current value: ${page.locator(`#${place}`).inputValue()}`);
    });

    const finalVal = await page.locator(`#${place}`).inputValue();
    console.log(`Finished ${place}. Hidden value: ${finalVal}`);
}

test.describe('Admin Config Start/End Time Tests (CONF-TIME)', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(120000); // Increased timeout to 2 minutes

    test.beforeEach(async ({ page }) => {
        await loginAdmin(page);
        await page.goto(`${ADMIN_URL}/admin/config`, { waitUntil: 'load' });
        await clickTab(page, /Start and End Time/i, '#config-sidebar');
        await expect(page.locator('#ctftime')).toBeVisible();
    });

    test('CONF-TIME-001: Set Valid Start and End Time (Active State)', async ({ page, browser }) => {
        console.log('Starting CONF-TIME-001...');
        const now = new Date();
        const start = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day ago
        const end = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 days later

        await setConfigTime(page, 'start', start);
        console.log('Start time set in UI.');
        await setConfigTime(page, 'end', end);
        console.log('End time set in UI.');

        console.log('Clicking Update...');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }).catch(() => console.log('Update navigation timeout.')),
            page.locator('#ctftime button[type="submit"]:has-text("Update")').click()
        ]);
        console.log('Update clicked, waiting for synchronization...');
        await page.waitForTimeout(5000);

        // Verify Admin Persistence
        console.log('Verifying persistence in Admin...');
        await page.goto(`${ADMIN_URL}/admin/config`, { waitUntil: 'load' });
        await clickTab(page, /Start and End Time/i, '#config-sidebar');
        await clickTab(page, /Start Time/i, '#ctftime');
        await expect(page.locator('#start-year')).toHaveValue(start.getFullYear().toString());
        console.log('Persistence verified in Admin.');

        // Verify Contestant Portal
        const contestantPage = await browser.newPage();
        await loginContestant(contestantPage);
        await contestantPage.goto(`${CONTESTANT_URL}/challenges`);

        // If active, challenges or dashboard should be accessible and no "Contest is not active" message
        await expect(contestantPage.locator('body')).not.toContainText('CONTEST NOT ACTIVE', { ignoreCase: true });
        await expect(contestantPage.locator('body')).not.toContainText('NOT STARTED YET', { ignoreCase: true });
        await expect(contestantPage.locator('body')).not.toContainText('HAS ENDED', { ignoreCase: true });
        await contestantPage.close();
    });

    test('CONF-TIME-002: Verify Inactive State (Start Time in Future)', async ({ page, browser }) => {
        console.log('Starting CONF-TIME-002...');
        const now = new Date();
        const start = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 days later
        const end = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000); // 5 days later

        await setConfigTime(page, 'start', start);
        await setConfigTime(page, 'end', end);

        console.log('Clicking Update...');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }).catch(() => { }),
            page.locator('#ctftime button[type="submit"]:has-text("Update")').click()
        ]);
        await page.waitForTimeout(5000);

        // Verify Admin side first
        await page.goto(`${ADMIN_URL}/admin/config`, { waitUntil: 'load' });
        await clickTab(page, /Start and End Time/i, '#config-sidebar');
        await clickTab(page, /Start Time/i, '#ctftime');
        await expect(page.locator('#start-year')).toHaveValue(start.getFullYear().toString());
        await expect(page.locator('#start-month')).toHaveValue((start.getMonth() + 1).toString());
        await expect(page.locator('#start-day')).toHaveValue(start.getDate().toString());

        // Verify Contestant Portal - after login should redirect to /challenges with CONTEST NOT ACTIVE
        const contestantPage = await browser.newPage();
        await loginContestant(contestantPage);
        // Navigate to challenges page where CONTEST NOT ACTIVE message is shown
        if (!contestantPage.url().includes('/challenges')) {
            await contestantPage.goto(`${CONTESTANT_URL}/challenges`, { waitUntil: 'load' });
        }
        await contestantPage.waitForTimeout(3000);

        console.log(`Contestant Page URL in 002: ${contestantPage.url()}`);
        const bodyContent = await contestantPage.textContent('body');
        console.log(`Body content snippet (002): ${bodyContent?.substring(0, 400)}`);

        // Check for contest not active message
        await expect(contestantPage.locator('body')).toContainText('CONTEST NOT ACTIVE', { ignoreCase: true });
        await contestantPage.close();
    });

    test('CONF-TIME-003: Verify Inactive State (End Time in Past)', async ({ page, browser }) => {
        console.log('Starting CONF-TIME-003...');
        const now = new Date();
        const start = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
        const end = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago

        await setConfigTime(page, 'start', start);
        await setConfigTime(page, 'end', end);

        console.log('Clicking Update...');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }).catch(() => { }),
            page.locator('#ctftime button[type="submit"]:has-text("Update")').click()
        ]);
        await page.waitForTimeout(5000);

        // Verify Admin side
        await page.goto(`${ADMIN_URL}/admin/config`, { waitUntil: 'load' });
        await clickTab(page, /Start and End Time/i, '#config-sidebar');
        await clickTab(page, /End Time/i, '#ctftime');
        await expect(page.locator('#end-year')).toHaveValue(end.getFullYear().toString());
        await expect(page.locator('#end-month')).toHaveValue((end.getMonth() + 1).toString());
        await expect(page.locator('#end-day')).toHaveValue(end.getDate().toString());

        // Verify Contestant Portal - after login should redirect to /challenges with CONTEST NOT ACTIVE
        const contestantPage = await browser.newPage();
        await loginContestant(contestantPage);
        // Navigate to challenges page where CONTEST NOT ACTIVE message is shown
        if (!contestantPage.url().includes('/challenges')) {
            await contestantPage.goto(`${CONTESTANT_URL}/challenges`, { waitUntil: 'load' });
        }
        await contestantPage.waitForTimeout(3000);

        console.log(`Contestant Page URL in 003: ${contestantPage.url()}`);
        const bodyContent = await contestantPage.textContent('body');
        console.log(`Body content snippet (003): ${bodyContent?.substring(0, 400)}`);

        // Check for contest not active message
        await expect(contestantPage.locator('body')).toContainText('CONTEST NOT ACTIVE', { ignoreCase: true });
        await contestantPage.close();
    });

    test('CONF-TIME-004: Freeze Time Configuration', async ({ page }) => {
        console.log('Starting CONF-TIME-004...');
        const now = new Date();
        const freeze = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000); // Tomorrow

        await setConfigTime(page, 'freeze', freeze);

        console.log('Clicking Update...');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }).catch(() => { }),
            page.locator('#ctftime button[type="submit"]:has-text("Update")').click()
        ]);
        await page.waitForTimeout(5000);

        // Verify persistence in Admin
        await page.goto(`${ADMIN_URL}/admin/config`, { waitUntil: 'load' });
        await clickTab(page, /Start and End Time/i, '#config-sidebar');
        await clickTab(page, /Freeze Time/i, '#ctftime');
        await expect(page.locator('#freeze-year')).toHaveValue(freeze.getFullYear().toString());
        await expect(page.locator('#freeze-day')).toHaveValue(freeze.getDate().toString());
    });

});
