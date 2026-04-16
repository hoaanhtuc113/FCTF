import { chromium } from 'playwright';

const ADMIN_URL = 'https://admin3.fctf.site';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('Logging in to admin...');
    await page.goto(`${ADMIN_URL}/login`);
    await page.getByRole('textbox', { name: 'User Name or Email' }).fill('admin');
    await page.getByRole('textbox', { name: 'Password' }).fill('1');
    await page.getByRole('button', { name: 'Submit' }).click();
    await page.waitForURL(/.*admin/);

    console.log('Resetting contest dates...');
    await page.goto(`${ADMIN_URL}/admin/config`);
    await page.waitForTimeout(2000);

    await page.locator('a[href="#ctftime"]').click();
    await page.waitForTimeout(1000);

    // Start Date -> 2020
    await page.locator('a[href="#start-date"]').click();
    await page.locator('#start-year').fill('2020');

    // End Date -> 2099
    await page.locator('a[href="#end-date"]').click();
    await page.locator('#end-year').fill('2099');

    // Save
    await page.locator('#ctftime button[type="submit"]').click();
    await page.waitForTimeout(2000);

    console.log('Done!');
    await browser.close();
})();
