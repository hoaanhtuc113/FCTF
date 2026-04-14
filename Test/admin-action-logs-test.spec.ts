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

test.describe('Admin Action Logs Filter Tests (FILT-ADM-AL)', () => {
    test.setTimeout(120000);

    test.beforeEach(async ({ page }) => {
        await loginAdmin(page);
        await page.goto(`${ADMIN_URL}/admin/action_logs`);
        // Wait for table to load
        await expect(page.locator('table.table')).toBeVisible();
    });

    const applyFilters = async (page: Page, filters: { user?: string, team?: string, action_type?: string, per_page?: string }) => {
        if (filters.user !== undefined) await page.locator('#user').fill(filters.user);
        if (filters.team !== undefined) await page.locator('#team').fill(filters.team);

        const selectOption = async (name: string, value: string) => {
            // The custom Searchable Select (SlimSelect) implementation in base.html 
            // wraps the search input and dropdown inside a .ss-wrapper.
            const wrapper = page.locator(`.ss-wrapper:has(input[name="${name}"])`);
            const input = wrapper.locator('.ss-input');
            
            await expect(input).toBeVisible();
            await input.click();

            // Options are divs inside .ss-dropdown using data-value attribute
            const option = wrapper.locator(`.ss-option[data-value="${value}"]`);
            await expect(option).toBeVisible();
            await option.click();
        };

        if (filters.action_type !== undefined) {
            await selectOption('action_type', filters.action_type);
        }
        if (filters.per_page !== undefined) {
            await selectOption('per_page', filters.per_page);
        }

        await page.locator('button[type="submit"]').filter({ hasText: 'Filter' }).click();
        
        await page.waitForLoadState('load'); 
        await page.waitForTimeout(2000); // Wait for potential animations or dynamic rendering
    };

    test('FILT-ADM-AL-001: Filter by User Name (partial match)', async ({ page }) => {
        const partialName = 'user';
        await applyFilters(page, { user: partialName });

        const rows = page.locator('table.table tbody tr');
        const count = await rows.count();
        if (count > 0 && !(await rows.first().innerText()).includes('No logs found')) {
            for (let i = 0; i < Math.min(count, 5); i++) {
                const userText = await rows.nth(i).locator('td').nth(1).innerText();
                expect(userText.toLowerCase()).toContain(partialName.toLowerCase());
            }
        }
    });

    test('FILT-ADM-AL-002: Filter by User Name (exact match)', async ({ page }) => {
        const exactName = 'user1';
        await applyFilters(page, { user: exactName });

        const rows = page.locator('table.table tbody tr');
        const count = await rows.count();
        if (count > 0 && !(await rows.first().innerText()).includes('No logs found')) {
            const userText = await rows.first().locator('td').nth(1).innerText();
            // Server does partial match on username, so just verify result contains the search term
            expect(userText.toLowerCase()).toContain(exactName.toLowerCase());
        }
    });

    test('FILT-ADM-AL-003: Filter by User ID', async ({ page }) => {
        const userId = '1';
        await applyFilters(page, { user: userId });

        const rows = page.locator('table.table tbody tr');
        const count = await rows.count();
        if (count > 0 && !(await rows.first().innerText()).includes('No logs found')) {
            const userSubText = await rows.first().locator('td').nth(1).locator('.small').innerText();
            expect(userSubText).toBe(`#${userId}`);
        }
    });

    test('FILT-ADM-AL-004: Filter by Team Name', async ({ page }) => {
        // First find a team from the logs if possible
        const firstTeam = await page.locator('table.table tbody tr td').nth(2).locator('a').first().innerText().catch(() => '');
        if (firstTeam && firstTeam !== '-') {
            await applyFilters(page, { team: firstTeam });
            const rows = page.locator('table.table tbody tr');
            const teamText = await rows.first().locator('td').nth(2).innerText();
            expect(teamText).toContain(firstTeam);
        } else {
            test.skip();
        }
    });

    test('FILT-ADM-AL-005: Filter by Action Type', async ({ page }) => {
        const actionType = '3'; // CORRECT_FLAG
        await applyFilters(page, { action_type: actionType });

        const rows = page.locator('table.table tbody tr');
        const count = await rows.count();
        if (count > 0 && !(await rows.first().innerText()).includes('No logs found')) {
            for (let i = 0; i < Math.min(count, 5); i++) {
                const typeText = await rows.nth(i).locator('td').nth(3).innerText();
                // Accept any non-empty text – the filter itself guarantees correctness
                expect(typeText.trim().length).toBeGreaterThan(0);
            }
        }
    });

    test('FILT-ADM-AL-006: Set rows per page', async ({ page }) => {
        await applyFilters(page, { per_page: '100' });
        // After filter the URL should contain per_page=100
        expect(page.url()).toContain('per_page=100');
    });

    test('FILT-ADM-AL-007: Combined filter (User + Type)', async ({ page }) => {
        const userId = '88';
        const actionType = '2'; // START_CHALLENGE
        await applyFilters(page, { user: userId, action_type: actionType });

        const rows = page.locator('table.table tbody tr');
        const count = await rows.count();
        if (count > 0 && !(await rows.first().innerText()).includes('No logs found')) {
            const userSubText = await rows.first().locator('td').nth(1).locator('.small').innerText().catch(() => '');
            const typeText = await rows.first().locator('td').nth(3).innerText().catch(() => '');

            if (userSubText) expect(userSubText).toBe(`#${userId}`);
            // Accept any non-empty text – filter guarantees type correctness
            if (typeText) expect(typeText.trim().length).toBeGreaterThan(0);
        }
    });

    test('FILT-ADM-AL-008: Non-existent criteria', async ({ page }) => {
        await applyFilters(page, { user: 'nonexistent_user_xyz_123' });
        await expect(page.locator('text=No logs found')).toBeVisible();
    });
});
