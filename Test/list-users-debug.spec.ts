import { test } from '@playwright/test';

const ADMIN_URL = 'https://admin0.fctf.site';

test('List users', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/login`);
    await page.getByRole('textbox', { name: 'User Name or Email' }).fill('admin');
    await page.getByRole('textbox', { name: 'Password' }).fill('1');
    await page.getByRole('button', { name: 'Submit' }).click();

    await page.goto(`${ADMIN_URL}/admin/users`);
    const rows = await page.locator('#teamsboard tbody tr').allTextContents();
    console.log('--- USER LIST ---');
    rows.forEach(r => console.log(r.trim()));
    console.log('--- END USER LIST ---');
});
