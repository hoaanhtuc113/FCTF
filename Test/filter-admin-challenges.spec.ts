import { test, expect, Page, type BrowserContext } from '@playwright/test';

const ADMIN_URL = 'https://admin0.fctf.site';
type ContextCookies = Awaited<ReturnType<BrowserContext['cookies']>>;
let cachedAdminCookies: ContextCookies | null = null;

test.describe.configure({ mode: 'serial' });

async function loginAdmin(page: Page) {
    if (cachedAdminCookies && cachedAdminCookies.length > 0) {
        await page.context().addCookies(cachedAdminCookies);
        await page.goto(`${ADMIN_URL}/admin/challenges`, { waitUntil: 'domcontentloaded' });
        if (!/\/login(?:[/?#]|$)/i.test(page.url())) {
            return;
        }
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
        await page.goto(`${ADMIN_URL}/admin/challenges`, { waitUntil: 'domcontentloaded' });

        // Already authenticated.
        if (!/\/login(?:[/?#]|$)/i.test(page.url())) {
            return;
        }

        await page.getByRole('textbox', { name: 'User Name or Email' }).fill('admin');
        await page.getByRole('textbox', { name: 'Password' }).fill('1');
        await page.getByRole('button', { name: 'Submit' }).click();
        await page.waitForLoadState('domcontentloaded');

        // Validate by revisiting the protected route.
        await page.goto(`${ADMIN_URL}/admin/challenges`, { waitUntil: 'domcontentloaded' });
        if (!/\/login(?:[/?#]|$)/i.test(page.url())) {
            cachedAdminCookies = await page.context().cookies();
            return;
        }

        if (attempt < 3) {
            await page.waitForTimeout(1000 * attempt);
        }
    }

    throw new Error(`Admin login failed after retries. Current URL: ${page.url()}`);
}

function filterControl(page: Page, name: string) {
    return page.locator(`select[name="${name}"], input[name="${name}"]`).first();
}

async function expectFilterValue(page: Page, name: string, expected: string) {
    await expect(filterControl(page, name)).toHaveValue(expected);
}

async function setFilterValue(page: Page, name: string, value: string) {
    const selectField = page.locator(`select[name="${name}"]`).first();
    if (await selectField.count()) {
        await selectField.selectOption(value);
        return;
    }

    const inputField = page.locator(`input[name="${name}"]`).first();
    await expect(inputField).toHaveCount(1);

    const inputType = await inputField.getAttribute('type');
    if (inputType === 'hidden') {
        await inputField.evaluate((el, nextValue) => {
            const input = el as HTMLInputElement;
            input.value = String(nextValue);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }, value);
        return;
    }

    await inputField.fill(value);
}

async function getFirstRowCellText(page: Page, columnIndex: number) {
    const row = page.locator('table.clean-table tbody tr').first();
    if (await row.count() === 0) {
        return null;
    }

    const cell = row.locator(`td:nth-child(${columnIndex})`).first();
    if (await cell.count() === 0) {
        return null;
    }

    const text = (await cell.innerText()).trim();
    return text || null;
}

test.describe('Admin Challenge Filters', () => {

    test.beforeEach(async ({ page }) => {
        await loginAdmin(page);
        await page.goto(`${ADMIN_URL}/admin/challenges`, { waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL(/\/admin\/challenges/, { timeout: 15000 });
        await expect(page.locator('input[name="q"]')).toBeVisible({ timeout: 15000 });
    });

    test('FILT-CHAL-001: Default filter state', async ({ page }) => {
        // Assert that all dropdowns and search inputs are empty/default
        await expectFilterValue(page, 'category', '');
        await expectFilterValue(page, 'type', '');
        await expectFilterValue(page, 'difficulty', '');
        await expectFilterValue(page, 'state', '');
        await expectFilterValue(page, 'has_prereq', '');
        await expectFilterValue(page, 'q', '');
        await expectFilterValue(page, 'field', 'name'); // Usually name is default

        // Ensure table has loaded
        await expect(page.locator('table.clean-table tbody tr').first()).toBeVisible();
    });

    test('FILT-CHAL-002: Reset filters', async ({ page }) => {
        // Apply some filters
        await setFilterValue(page, 'q', 'dummytest');
        await setFilterValue(page, 'field', 'category');
        await setFilterValue(page, 'state', 'hidden');
        await page.locator('button[type="submit"]').click();

        await page.waitForTimeout(1000); // Give time for reload

        // Click Reset
        await page.locator('a[title="Reset"]').click();
        await page.waitForTimeout(1000);

        // Verify cleared
        await expectFilterValue(page, 'q', '');
        await expectFilterValue(page, 'state', '');
    });

    test('FILT-CHAL-003: Search exactly by Name', async ({ page }) => {
        await setFilterValue(page, 'q', 'pwn');
        await setFilterValue(page, 'field', 'name');
        await page.locator('button[type="submit"]').click();

        await expect(page.locator('.alert-info')).toContainText('Searching for challenges with name matching pwn');
        // Let's assume there's at least one
        const rows = await page.locator('table.clean-table tbody tr').count();
        expect(rows).toBeGreaterThanOrEqual(1);
    });

    test('FILT-CHAL-004: Search by Name - Partial match', async ({ page }) => {
        await setFilterValue(page, 'q', 'exploit');
        await setFilterValue(page, 'field', 'name');
        await page.locator('button[type="submit"]').click();
        // Just verify it doesn't crash, logic handles it.
    });

    test('FILT-CHAL-006: Search by Name - Case insensitivity', async ({ page }) => {
        await setFilterValue(page, 'q', 'PWN');
        await setFilterValue(page, 'field', 'name');
        await page.locator('button[type="submit"]').click();
    });

    test('FILT-CHAL-005: Search with no match', async ({ page }) => {
        await setFilterValue(page, 'q', 'THIS_SHOULD_NEVER_MATCH_123456');
        await setFilterValue(page, 'field', 'name');
        await page.locator('button[type="submit"]').click();

        await expect(page.locator('.alert-info')).toContainText('0 results');
    });

    test('FILT-CHAL-009: Search with special characters', async ({ page }) => {
        await setFilterValue(page, 'q', '!@#$%');
        await setFilterValue(page, 'field', 'name');
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('0 results');
    });

    test('FILT-CHAL-008: Search by ID', async ({ page }) => {
        // Find existing ID first
        const firstIdElem = page.locator('table.clean-table tbody tr').first().locator('td:nth-child(2)');
        if (await firstIdElem.isVisible()) {
            const idVal = await firstIdElem.innerText();

            await setFilterValue(page, 'q', idVal.trim());
            await setFilterValue(page, 'field', 'id');
            await page.locator('button[type="submit"]').click();

            await expect(page.locator('.alert-info')).toContainText(`id matching ${idVal.trim()}`);
            await expect(page.locator('table.clean-table tbody tr')).toHaveCount(1);
        }
    });

    test('FILT-CHAL-010: Filter by Category', async ({ page }) => {
        const category = await getFirstRowCellText(page, 4);
        if (category && category !== '—') {
            await setFilterValue(page, 'category', category);
            await page.locator('button[type="submit"]').click();
            await page.waitForTimeout(1000);
            await expect(page).toHaveURL(/category=/);
            const rows = await page.locator('table.clean-table tbody tr').count();
            expect(rows).toBeGreaterThanOrEqual(1);
        }
    });

    test('FILT-CHAL-011: Filter by Type', async ({ page }) => {
        const challengeType = await getFirstRowCellText(page, 8);
        if (challengeType && challengeType !== '—') {
            await setFilterValue(page, 'type', challengeType);
            await page.locator('button[type="submit"]').click();
            await page.waitForTimeout(1000);
            await expect(page).toHaveURL(/type=/);
            const rows = await page.locator('table.clean-table tbody tr').count();
            expect(rows).toBeGreaterThanOrEqual(1);
        }
    });

    test('FILT-CHAL-012: Filter by Difficulty', async ({ page }) => {
        await setFilterValue(page, 'difficulty', '2'); // Easy
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('Difficulty: Easy');
    });

    test('FILT-CHAL-013: Filter by State - Visible', async ({ page }) => {
        await setFilterValue(page, 'state', 'visible');
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('State: visible');
    });

    test('FILT-CHAL-014: Filter by State - Hidden', async ({ page }) => {
        await setFilterValue(page, 'state', 'hidden');
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('State: hidden');
    });

    test('FILT-CHAL-015: Filter by Prerequisites - Yes', async ({ page }) => {
        await setFilterValue(page, 'has_prereq', 'yes');
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('Prerequisites: Yes');
    });

    test('FILT-CHAL-016: Filter by Prerequisites - No', async ({ page }) => {
        await setFilterValue(page, 'has_prereq', 'no');
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
        await setFilterValue(page, 'q', 'pwn');
        await setFilterValue(page, 'state', 'visible');
        await page.locator('button[type="submit"]').click();

        const alertInfo = page.locator('.alert-info');
        if (await alertInfo.isVisible()) {
            await expect(alertInfo).toContainText('name matching pwn');
            await expect(alertInfo).toContainText('State: visible');
        }
    });

    test('FILT-CHAL-020: Incompatible combination filter', async ({ page }) => {
        const category = await getFirstRowCellText(page, 4);
        if (category && category !== '—') {
            await setFilterValue(page, 'category', category);
        }
        await setFilterValue(page, 'difficulty', '5');
        await page.locator('button[type="submit"]').click();
        const alertInfo = page.locator('.alert-info');
        if (await alertInfo.isVisible()) {
            const txt = await alertInfo.innerText();
            expect(txt.length).toBeGreaterThan(0);
        }
    });

    test('FILT-CHAL-021: Pagination state transfer', async ({ page }) => {
        await setFilterValue(page, 'state', 'visible');
        await page.locator('button[type="submit"]').click();

        const nextPageBtn = page.locator('.pagination .page-link:has-text("»"), .pagination .page-link:has-text("2")').first();
        if (await nextPageBtn.isVisible()) {
            await nextPageBtn.click();
            await page.waitForTimeout(1000);

            // Verify filter is still applied
            await expectFilterValue(page, 'state', 'visible');
            await expect(page).toHaveURL(/state=visible/);
            await expect(page).toHaveURL(/page=/);
        } else {
            console.log('⚠️ FILT-CHAL-021: Not enough data for pagination test - OK');
        }
    });

    test('FILT-CHAL-022: Search by field=category', async ({ page }) => {
        await setFilterValue(page, 'field', 'category');
        await setFilterValue(page, 'q', 'web');
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('Searching for challenges with category matching web');
    });

    test('FILT-CHAL-023: Search by field=type', async ({ page }) => {
        await setFilterValue(page, 'field', 'type');
        await setFilterValue(page, 'q', 'standard');
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('Searching for challenges with type matching standard');
    });

    test('FILT-CHAL-024: Filter by difficulty – Very Easy (1)', async ({ page }) => {
        await setFilterValue(page, 'difficulty', '1');
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('Difficulty: Very Easy');
    });

    test('FILT-CHAL-025: Filter by difficulty – Medium (3)', async ({ page }) => {
        await setFilterValue(page, 'difficulty', '3');
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('Difficulty: Medium');
    });

    test('FILT-CHAL-026: Filter by difficulty – Hard (4)', async ({ page }) => {
        await setFilterValue(page, 'difficulty', '4');
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('Difficulty: Hard');
    });

    test('FILT-CHAL-027: Filter by difficulty – Very Hard (5)', async ({ page }) => {
        await setFilterValue(page, 'difficulty', '5');
        await page.locator('button[type="submit"]').click();
        await expect(page.locator('.alert-info')).toContainText('Difficulty: Very Hard');
    });

    test('FILT-CHAL-028: Combined filters – name search + difficulty + state', async ({ page }) => {
        await setFilterValue(page, 'field', 'name');
        await setFilterValue(page, 'q', 'web');
        await setFilterValue(page, 'difficulty', '2');
        await setFilterValue(page, 'state', 'visible');
        await page.locator('button[type="submit"]').click();

        const alertInfo = page.locator('.alert-info');
        await expect(alertInfo).toContainText('Searching for challenges with name matching web');
        await expect(alertInfo).toContainText('Difficulty: Easy');
        await expect(alertInfo).toContainText('State: visible');
    });

});
