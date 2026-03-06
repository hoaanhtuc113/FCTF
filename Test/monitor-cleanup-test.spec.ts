import { test, expect, Page } from '@playwright/test';

const ADMIN_URL = 'https://admin.fctf.site';

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

test.describe('Monitor Cleanup Actions (Cleanup)', () => {
    test.setTimeout(120000);

    test.beforeEach(async ({ page }) => {
        await loginAdmin(page);
    });

    test('MCI-005: Stop an instance of a team', async ({ page }) => {
        await page.goto(`${ADMIN_URL}/admin/monitoring`);
        await page.locator('button:has-text("Refresh Data")').click();
        await page.waitForTimeout(2000);

        const firstRow = page.locator('#challengeTable tbody tr').first();
        if (!(await firstRow.isVisible())) {
            console.log('⏭️ No instances found to stop. Skipping MCI-005.');
            return;
        }

        const teamName = await firstRow.locator('td').nth(3).innerText();
        const challengeName = await firstRow.locator('td').nth(2).innerText();

        console.log(`🛑 Stopping instance: ${challengeName} for Team ${teamName}`);
        await firstRow.locator('button:has-text("Actions")').click();

        // Listen for dialog
        page.once('dialog', dialog => dialog.accept());
        // Click Stop in menu
        await page.locator('.dropdown-menu.show a.dropdown-item:has-text("Stop"), .action-menu-item:has-text("Stop")').first().click();

        // Wait for removal of specific row
        await expect(async () => {
            await page.locator('button:has-text("Refresh Data")').click();
            const rows = page.locator('#challengeTable tbody tr');
            const count = await rows.count();
            let found = false;
            for (let i = 0; i < count; i++) {
                const text = await rows.nth(i).innerText();
                if (text.includes(teamName) && text.includes(challengeName)) {
                    found = true; break;
                }
            }
            expect(found).toBeFalsy();
        }).toPass({ timeout: 15000 });

        console.log('✅ MCI-005: Stop instance success');
    });

    test('MCI-009: Delete a running instance', async ({ page }) => {
        await page.goto(`${ADMIN_URL}/admin/monitoring`);
        await page.locator('button:has-text("Refresh Data")').click();
        await page.waitForTimeout(2000);

        const firstRow = page.locator('#challengeTable tbody tr').first();
        if (!(await firstRow.isVisible())) {
            console.log('⏭️ No instances found to delete. Skipping MCI-009.');
            return;
        }

        const teamName = await firstRow.locator('td').nth(3).innerText();
        const challengeName = await firstRow.locator('td').nth(2).innerText();

        console.log(`🗑️ Deleting instance: ${challengeName} for Team ${teamName}`);
        await firstRow.locator('button:has-text("Actions")').click();

        // Listen for confirmation dialog and accept
        page.once('dialog', dialog => dialog.accept());
        await page.locator('.dropdown-menu.show a.dropdown-item:has-text("Delete"), .action-menu-item:has-text("Delete")').first().click();

        // Wait and verify disappearance of specific row
        await expect(async () => {
            await page.locator('button:has-text("Refresh Data")').click();
            const rows = page.locator('#challengeTable tbody tr');
            const count = await rows.count();
            let found = false;
            for (let i = 0; i < count; i++) {
                const text = await rows.nth(i).innerText();
                if (text.includes(teamName) && text.includes(challengeName)) {
                    found = true; break;
                }
            }
            expect(found).toBeFalsy();
        }).toPass({ timeout: 15000 });

        console.log('✅ MCI-009: Delete instance success');
    });

    test('MCI-006: Stop all instances', async ({ page }) => {
        await page.goto(`${ADMIN_URL}/admin/monitoring`);
        const stopAllBtn = page.locator('button', { hasText: 'Stop All' });

        if (!(await stopAllBtn.isVisible())) {
            console.log('⏭️ Stop All button not visible. Skipping.');
            return;
        }

        page.once('dialog', async dialog => {
            console.log(`Dialog message: ${dialog.message()}`);
            await dialog.accept();
        });

        await stopAllBtn.click();
        await page.waitForTimeout(5000);

        await expect(page.locator('#challengeTable tbody')).not.toContainText('Running', { timeout: 30000 });
        console.log('✅ MCI-006: Stop All instances success');
    });
});
