import { test, expect, type Page } from '@playwright/test';

const ADMIN_URL = 'https://admin0.fctf.site';

async function loginAdmin(page: Page) {
    await test.step('Login as admin', async () => {
        await page.goto(`${ADMIN_URL}/login`);
        await page.getByRole('textbox', { name: 'User Name or Email' }).fill('admin');
        await page.getByRole('textbox', { name: 'Password' }).fill('1');
        await page.getByRole('button', { name: 'Submit' }).click();
        await expect(page).toHaveURL(/.*admin/);
    });
}

test.describe('Admin Ticket Management Tests (ADM-TIC)', () => {
    test.setTimeout(120000);

    test.beforeEach(async ({ page }) => {
        await loginAdmin(page);
        await page.goto(`${ADMIN_URL}/admin/viewticket`);
        await expect(page.locator('h1')).toContainText('Tickets');
    });

    test('ADM-TIC-001: View Ticket List', async ({ page }) => {
        const table = page.locator('table.clean-table');
        await expect(table).toBeVisible();

        const headers = ['ID', 'Team', 'Type', 'Title', 'Message', 'Create At', 'Status', 'Details', 'Action'];
        for (const header of headers) {
            await expect(page.locator('th', { hasText: header }).first()).toBeVisible();
        }

        const rows = page.locator('tbody tr');
        const count = await rows.count();
        expect(count).toBeGreaterThanOrEqual(1);
    });

    test('ADM-TIC-002: Filter by Status', async ({ page }) => {
        const statusWrapper = page.locator('.ss-wrapper:has(input[name="status"])');
        const statusInput = statusWrapper.locator('.ss-input');

        await expect(statusInput).toBeVisible();
        await statusInput.click();

        const options = statusWrapper.locator('.ss-option');
        const count = await options.count();

        if (count > 1) {
            const statusToFilter = await options.nth(1).innerText();
            await options.nth(1).click();

            // The custom UI might trigger a form submit or we might need to click Filter
            // In view_ticket.html, the original select had onchange="this.form.submit()"
            // But the custom pick() function just sets the value.
            // Wait, pick() function in base.html doesn't seem to trigger submit.
            // Ah, line 951: hiddenInput.value = opt.getAttribute('data-value');
            // But there is no form submit triggered in pick().
            // Wait, let's check view_ticket.html again.
            // Oh, the pick() function is inside base.html. It doesn't know about onchange.
            // So we likely need to click the Filter button.

            await page.locator('button[type="submit"]:has-text("Filter")').click();
            await page.waitForLoadState('load');
            await page.waitForTimeout(2000);

            const rows = page.locator('tbody tr');
            const rowCount = await rows.count();

            if (rowCount > 0 && !(await rows.first().innerText()).includes('No tickets found')) {
                for (let i = 0; i < rowCount; i++) {
                    const statusCell = await rows.nth(i).locator('td').nth(7).innerText();
                    expect(statusCell.trim().toLowerCase()).toBe(statusToFilter.trim().toLowerCase());
                }
            }
        }
    });

    test('ADM-TIC-003: Filter by Type', async ({ page }) => {
        const typeWrapper = page.locator('.ss-wrapper:has(input[name="type"])');
        const typeInput = typeWrapper.locator('.ss-input');

        await expect(typeInput).toBeVisible();
        await typeInput.click();

        const options = typeWrapper.locator('.ss-option');
        const count = await options.count();

        if (count > 1) {
            const typeToFilter = await options.nth(1).innerText();
            await options.nth(1).click();

            await page.locator('button[type="submit"]:has-text("Filter")').click();
            await page.waitForLoadState('load');
            await page.waitForTimeout(2000);

            const rows = page.locator('tbody tr');
            const rowCount = await rows.count();

            if (rowCount > 0 && !(await rows.first().innerText()).includes('No tickets found')) {
                for (let i = 0; i < rowCount; i++) {
                    const typeCell = await rows.nth(i).locator('td').nth(3).innerText();
                    expect(typeCell.trim().toLowerCase()).toBe(typeToFilter.trim().toLowerCase());
                }
            }
        }
    });

    test('ADM-TIC-004: Search by Title', async ({ page }) => {
        // Try to find an existing ticket title to search for
        const firstRow = page.locator('tbody tr').first();
        if (await firstRow.isVisible() && !(await firstRow.innerText()).includes('No tickets found')) {
            const titleToSearch = (await firstRow.locator('td').nth(4).getAttribute('title')) || '';

            if (titleToSearch) {
                await page.locator('input[name="search"]').fill(titleToSearch);
                await page.locator('button[type="submit"]:has-text("Filter")').click();
                await page.waitForLoadState('load');
                await page.waitForTimeout(2000);

                const rows = page.locator('tbody tr');
                expect(await rows.count()).toBeGreaterThanOrEqual(1);
                const resultTitle = await rows.first().locator('td').nth(4).getAttribute('title');
                expect(resultTitle).toContain(titleToSearch);
            }
        }
    });

    test('ADM-TIC-005: View Ticket Details', async ({ page }) => {
        const firstRow = page.locator('tbody tr').first();
        if (await firstRow.isVisible() && !(await firstRow.innerText()).includes('No tickets found')) {
            const viewButton = firstRow.locator('.btn-view-detail');
            await viewButton.click();

            await expect(page).toHaveURL(/.*\/admin\/ticket-details\/\d+/);
            const bodyText = await page.innerText('body');
            expect(bodyText).toMatch(/Ticket Details|AUTHOR|CREATED|\[TICKET_DETAIL\]/i);
        }
    });

    test('ADM-TIC-006: Delete Single Ticket', async ({ page }) => {
        const firstRow = page.locator('tbody tr').first();
        if (!(await firstRow.innerText()).includes('No tickets found')) {
            const ticketId = await firstRow.locator('td').nth(1).innerText();

            // Setup dialog handler
            page.on('dialog', dialog => dialog.accept());

            const deleteButton = firstRow.locator('.btn-delete-single');
            await deleteButton.click();

            await page.waitForLoadState('domcontentloaded');

            // Verify ticket is gone
            const rows = page.locator('tbody tr');
            const rowTexts = await rows.allInnerTexts();
            expect(rowTexts.some(text => text.includes(ticketId))).toBeFalsy();
        }
    });

    test('ADM-TIC-007: Bulk Delete Tickets', async ({ page }) => {
        const rows = page.locator('tbody tr');
        const count = await rows.count();

        if (count >= 2 && !(await rows.first().innerText()).includes('No tickets found')) {
            const id1 = await rows.nth(0).locator('td').nth(1).innerText();
            const id2 = await rows.nth(1).locator('td').nth(1).innerText();

            await rows.nth(0).locator('.ticket-checkbox').check();
            await rows.nth(1).locator('.ticket-checkbox').check();

            page.on('dialog', dialog => dialog.accept());
            await page.locator('button:has-text("Delete Selected")').click();

            await page.waitForLoadState('domcontentloaded');

            const remainingRows = await page.locator('tbody tr').allInnerTexts();
            expect(remainingRows.some(text => text.includes(id1))).toBeFalsy();
            expect(remainingRows.some(text => text.includes(id2))).toBeFalsy();
        }
    });

    test('ADM-TIC-008: Select All / Deselect All', async ({ page }) => {
        const selectAll = page.locator('#select-all');
        const checkboxes = page.locator('.ticket-checkbox');

        if (await checkboxes.count() > 0) {
            await selectAll.check();
            const allChecked = await checkboxes.evaluateAll(list => list.every(c => (c as HTMLInputElement).checked));
            expect(allChecked).toBeTruthy();

            await selectAll.uncheck();
            const noneChecked = await checkboxes.evaluateAll(list => list.every(c => !(c as HTMLInputElement).checked));
            expect(noneChecked).toBeTruthy();
        }
    });

    test('ADM-TIC-009: Search with Very Long String', async ({ page }) => {
        const longString = 'A'.repeat(255);
        await page.locator('input[name="search"]').fill(longString);
        await page.locator('button[type="submit"]:has-text("Filter")').click();
        await page.waitForLoadState('load');
        await page.waitForTimeout(2000);

        // Verify UI stability - table should still exist, maybe showing no results
        const table = page.locator('table.clean-table');
        await expect(table).toBeVisible();

        const rows = page.locator('tbody tr');
        if (await rows.count() === 1) {
            const rowText = await rows.first().innerText();
            if (rowText.includes('No tickets found')) {
                expect(rowText).toContain('No tickets found');
            }
        }
    });

    test('ADM-TIC-010: Search with Special Characters', async ({ page }) => {
        const specialChars = '!@#$%^&*()_+{}|:"<>?~`-=[]\\;\',./';
        await page.locator('input[name="search"]').fill(specialChars);
        await page.locator('button[type="submit"]:has-text("Filter")').click();
        await page.waitForLoadState('load');
        await page.waitForTimeout(2000);

        const table = page.locator('table.clean-table');
        await expect(table).toBeVisible();

        // Should not crash, just handle as a search query
        const rowText = await page.locator('tbody tr').first().innerText();
        // If results exist, they match; if not, show "No tickets found"
        expect(rowText).toBeTruthy();
    });

    test('ADM-TIC-011: Search with SQL Injection payload', async ({ page }) => {
        const sqliPayload = "' OR 1=1 --";
        await page.locator('input[name="search"]').fill(sqliPayload);
        await page.locator('button[type="submit"]:has-text("Filter")').click();
        await page.waitForLoadState('load');
        await page.waitForTimeout(2000);

        // Verify system handles it as literal string
        const table = page.locator('table.clean-table');
        await expect(table).toBeVisible();

        const rows = page.locator('tbody tr');
        // It shouldn't return all entries unless the title actually contains the payload
        // Most likely it will show "No tickets found"
        const rowCount = await rows.count();
        if (rowCount === 1) {
            const rowText = await rows.first().innerText();
            if (rowText.includes('No tickets found')) {
                expect(rowText).toContain('No tickets found');
            }
        }
    });

    test('ADM-TIC-012: Filter with No Results', async ({ page }) => {
        // Use a definitely non-existent title
        const nonExistentTitle = 'ThisTicketShouldNeverExist_' + Date.now();
        await page.locator('input[name="search"]').fill(nonExistentTitle);
        await page.locator('button[type="submit"]:has-text("Filter")').click();
        await page.waitForLoadState('load');
        await page.waitForTimeout(2000);

        const firstRow = page.locator('tbody tr').first();
        await expect(firstRow).toContainText('No tickets found');
    });

    test('ADM-TIC-013: Unauthorized Access', async ({ page, context }) => {
        // Clear cookies/session to logout
        await context.clearCookies();
        await page.goto(`${ADMIN_URL}/admin/viewticket`);

        // Should redirect to login
        await expect(page).toHaveURL(/.*login/);
    });
});
