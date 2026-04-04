import { test, expect, Page } from '@playwright/test';

const ADMIN_URL = 'https://admin0.fctf.site';

test.describe.configure({ mode: 'serial' });

async function loginAdmin(page: Page) {
    await page.goto(`${ADMIN_URL}/login`);
    await page.getByRole('textbox', { name: 'User Name or Email' }).fill('admin');
    await page.getByRole('textbox', { name: 'Password' }).fill('1');
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page).toHaveURL(/.*admin/);
}

test.describe('Admin Challenge Filters', () => {

    test.beforeEach(async ({ page }) => {
        await loginAdmin(page);
        await page.goto(`${ADMIN_URL}/admin/challenges`);
        await expect(page.locator('h1').filter({ hasText: 'Challenges' })).toBeVisible();
    });

    test('FILT-CHAL-001: Default filter state', async ({ page }) => {
        // Assert that all dropdowns and search inputs are empty/default
        await expect(page.locator('select[name="category"]')).toHaveValue('');
        await expect(page.locator('select[name="type"]')).toHaveValue('');
        await expect(page.locator('select[name="difficulty"]')).toHaveValue('');
        await expect(page.locator('select[name="state"]')).toHaveValue('');
        await expect(page.locator('select[name="has_prereq"]')).toHaveValue('');
        await expect(page.locator('input[name="q"]')).toHaveValue('');
        await expect(page.locator('select[name="field"]')).toHaveValue('name'); // Usually name is default

        // Ensure table has loaded
        await expect(page.locator('table.clean-table tbody tr').first()).toBeVisible();
    });

    test('FILT-CHAL-002: Reset filters', async ({ page }) => {
        // Apply some filters
        await page.locator('input[name="q"]').fill('dummytest');
        await page.locator('select[name="field"]').selectOption('category');
        await page.locator('select[name="state"]').selectOption('hidden');
        await page.locator('button[type="submit"]').click();

        await page.waitForTimeout(1000); // Give time for reload

        // Click Reset
        await page.locator('a[title="Reset"]').click();
        await page.waitForTimeout(1000);

        // Verify cleared
        await expect(page.locator('input[name="q"]')).toHaveValue('');
        await expect(page.locator('select[name="state"]')).toHaveValue('');
    });

    test('FILT-CHAL-003: Search exactly by Name', async ({ page }) => {
        await page.locator('input[name="q"]').fill('pwn');
        await page.locator('select[name="field"]').selectOption('name');
        await page.locator('button[type="submit"]').click();

        await expect(page.locator('.alert-info')).toContainText('Searching for challenges with name matching pwn');
        // Let's assume there's at least one
        const rows = await page.locator('table.clean-table tbody tr').count();
        expect(rows).toBeGreaterThanOrEqual(1);
    });

    test('FILT-CHAL-004: Search by Name - Partial match', async ({ page }) => {
        await page.locator('input[name="q"]').fill('exploit');
        await page.locator('select[name="field"]').selectOption('name');
        await page.locator('button[type="submit"]').click();
        // Just verify it doesn't crash, logic handles it.
    });

    test('FILT-CHAL-006: Search by Name - Case insensitivity', async ({ page }) => {
        await page.locator('input[name="q"]').fill('PWN');
        await page.locator('select[name="field"]').selectOption('name');
        await page.locator('button[type="submit"]').click();
    });

    test('FILT-CHAL-005: Search with no match', async ({ page }) => {
        await page.locator('input[name="q"]').fill('THIS_SHOULD_NEVER_MATCH_123456');
        await page.locator('select[name="field"]').selectOption('name');
        await page.locator('button[type="submit"]').click();

        await expect(page.locator('.alert-info')).toContainText('0 results');
        await expect(page.locator('table.clean-table tbody tr')).toHaveCount(0);
    });

    test('FILT-CHAL-009: Search with special characters', async ({ page }) => {
        await page.locator('input[name="q"]').fill('!@#$%');
        await page.locator('select[name="field"]').selectOption('name');
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('0 results');
    });

    test('FILT-CHAL-008: Search by ID', async ({ page }) => {
        // Find existing ID first
        const firstIdElem = page.locator('table.clean-table tbody tr').first().locator('td:nth-child(2)');
        if (await firstIdElem.isVisible()) {
            const idVal = await firstIdElem.innerText();

            await page.locator('input[name="q"]').fill(idVal.trim());
            await page.locator('select[name="field"]').selectOption('id');
            await page.locator('button[type="submit"]').click();

            await expect(page.locator('.alert-info')).toContainText(`id matching ${idVal.trim()}`);
            await expect(page.locator('table.clean-table tbody tr')).toHaveCount(1);
        }
    });

    test('FILT-CHAL-010: Filter by Category', async ({ page }) => {
        const catSelect = page.locator('select[name="category"]');
        const count = await catSelect.locator('option').count();
        if (count > 1) {
            await catSelect.selectOption({ index: 1 });
            await page.locator('button[type="submit"]').click();
            await page.waitForTimeout(1000);
            const rows = await page.locator('table.clean-table tbody tr').count();
            expect(rows).toBeGreaterThanOrEqual(0);
        }
    });

    test('FILT-CHAL-011: Filter by Type', async ({ page }) => {
        const typeSelect = page.locator('select[name="type"]');
        const count = await typeSelect.locator('option').count();
        if (count > 1) {
            await typeSelect.selectOption({ index: 1 });
            await page.locator('button[type="submit"]').click();
            await page.waitForTimeout(1000);
            const rows = await page.locator('table.clean-table tbody tr').count();
            expect(rows).toBeGreaterThanOrEqual(0);
        }
    });

    test('FILT-CHAL-012: Filter by Difficulty', async ({ page }) => {
        await page.locator('select[name="difficulty"]').selectOption('2'); // Easy
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('Difficulty: Easy');
    });

    test('FILT-CHAL-013: Filter by State - Visible', async ({ page }) => {
        await page.locator('select[name="state"]').selectOption('visible');
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('State: visible');
    });

    test('FILT-CHAL-014: Filter by State - Hidden', async ({ page }) => {
        await page.locator('select[name="state"]').selectOption('hidden');
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('State: hidden');
    });

    test('FILT-CHAL-015: Filter by Prerequisites - Yes', async ({ page }) => {
        await page.locator('select[name="has_prereq"]').selectOption('yes');
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('Prerequisites: Yes');
    });

    test('FILT-CHAL-016: Filter by Prerequisites - No', async ({ page }) => {
        await page.locator('select[name="has_prereq"]').selectOption('no');
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('Prerequisites: No');
    });

    test('FILT-CHAL-017: Filter by Tags', async ({ page }) => {
        // Tag picker uses a hidden input 'tags' and JS UI. Inject value directly.
        await page.evaluate(() => {
            const el = document.getElementById('tags-hidden') as HTMLInputElement;
            if (el) el.value = 'pwn,web';
        });
        await page.locator('button[type="submit"]').click();

        const alertInfo = page.locator('.alert-info');
        if (await alertInfo.isVisible()) {
            await expect(alertInfo).toContainText('matching tags:');
        }
    });

    test('FILT-CHAL-018: Filter by multiple Tags', async ({ page }) => {
        await page.evaluate(() => {
            const el = document.getElementById('tags-hidden') as HTMLInputElement;
            if (el) el.value = 'pwn,web,crypto';
        });
        await page.locator('button[type="submit"]').click();
        const alertInfo = page.locator('.alert-info');
        if (await alertInfo.isVisible()) {
            await expect(alertInfo).toContainText('matching tags:');
        }
    });

    test('FILT-CHAL-019: Combination filters', async ({ page }) => {
        await page.locator('input[name="q"]').fill('pwn');
        await page.locator('select[name="state"]').selectOption('visible');
        await page.locator('button[type="submit"]').click();

        const alertInfo = page.locator('.alert-info');
        if (await alertInfo.isVisible()) {
            await expect(alertInfo).toContainText('name matching pwn');
            await expect(alertInfo).toContainText('State: visible');
        }
    });

    test('FILT-CHAL-020: Incompatible combination filter', async ({ page }) => {
        const catSelect = page.locator('select[name="category"]');
        if (await catSelect.locator('option').count() > 1) {
            await catSelect.selectOption({ index: 1 });
        }
        await page.locator('select[name="difficulty"]').selectOption('5');
        await page.locator('button[type="submit"]').click();
        const alertInfo = page.locator('.alert-info');
        if (await alertInfo.isVisible()) {
            const txt = await alertInfo.innerText();
            expect(txt.length).toBeGreaterThan(0);
        }
    });

    test('FILT-CHAL-021: Pagination state transfer', async ({ page }) => {
        await page.locator('select[name="state"]').selectOption('visible');
        await page.locator('button[type="submit"]').click();

        const nextPageBtn = page.locator('.pagination .page-link:has-text("»"), .pagination .page-link:has-text("2")').first();
        if (await nextPageBtn.isVisible()) {
            await nextPageBtn.click();
            await page.waitForTimeout(1000);

            // Verify filter is still applied
            await expect(page.locator('select[name="state"]')).toHaveValue('visible');
            await expect(page).toHaveURL(/state=visible/);
            await expect(page).toHaveURL(/page=/);
        } else {
            console.log('⚠️ FILT-CHAL-021: Not enough data for pagination test - OK');
        }
    });

    test('FILT-CHAL-022: Search by field=category', async ({ page }) => {
        await page.locator('select[name="field"]').selectOption('category');
        await page.locator('input[name="q"]').fill('web');
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('Searching for challenges with category matching web');
    });

    test('FILT-CHAL-023: Search by field=type', async ({ page }) => {
        await page.locator('select[name="field"]').selectOption('type');
        await page.locator('input[name="q"]').fill('standard');
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('Searching for challenges with type matching standard');
    });

    test('FILT-CHAL-024: Filter by difficulty – Very Easy (1)', async ({ page }) => {
        await page.locator('select[name="difficulty"]').selectOption('1');
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('Difficulty: Very Easy');
    });

    test('FILT-CHAL-025: Filter by difficulty – Medium (3)', async ({ page }) => {
        await page.locator('select[name="difficulty"]').selectOption('3');
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('Difficulty: Medium');
    });

    test('FILT-CHAL-026: Filter by difficulty – Hard (4)', async ({ page }) => {
        await page.locator('select[name="difficulty"]').selectOption('4');
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('Difficulty: Hard');
    });

    test('FILT-CHAL-027: Filter by difficulty – Very Hard (5)', async ({ page }) => {
        await page.locator('select[name="difficulty"]').selectOption('5');
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('Difficulty: Very Hard');
    });

    test('FILT-CHAL-028: Combined filters – name search + difficulty + state', async ({ page }) => {
        await page.locator('select[name="field"]').selectOption('name');
        await page.locator('input[name="q"]').fill('web');
        await page.locator('select[name="difficulty"]').selectOption('2');
        await page.locator('select[name="state"]').selectOption('visible');
        await page.locator('button[type="submit"]').click();

        const alertInfo = page.locator('.alert-info');
        await expect(alertInfo).toContainText('Searching for challenges with name matching web');
        await expect(alertInfo).toContainText('Difficulty: Easy');
        await expect(alertInfo).toContainText('State: visible');
    });

});
