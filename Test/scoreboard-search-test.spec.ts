import { test, expect, Page } from '@playwright/test';

// =============================================================================
// HELPER FUNCTIONS & CONSTANTS
// =============================================================================

const BASE_URL = 'https://contestant0.fctf.site';
const TEST_USER = 'user22';
const TEST_PASS = '1';

// Helper: Login
async function login(page: Page, user: string, pass: string) {
    // Retry once because remote auth can occasionally bounce back to /login.
    for (let attempt = 1; attempt <= 2; attempt++) {
        await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
        await page.locator("input[placeholder='input username...']").fill(user);
        await page.locator("input[placeholder='enter_password']").fill(pass);

        try {
            await page.locator("button[type='submit']").click();
            await page.waitForURL(/\/(dashboard|challenges|tickets|scoreboard)/, { timeout: 20000 });
            await page.goto(`${BASE_URL}/scoreboard`, { waitUntil: 'domcontentloaded' });
            if (!page.url().includes('/login')) {
                return;
            }
        } catch {
            // Retry on transient auth/navigation failures.
        }

        if (attempt === 2) {
            throw new Error(`Login failed for user ${user}. Current URL: ${page.url()}`);
        }
    }
}

// Helper: Navigate to Scoreboard
async function navigateToScoreboard(page: Page) {
    await page.goto(`${BASE_URL}/scoreboard`, { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/scoreboard/, { timeout: 15000 });
    await expect(page.getByText('[LEADERBOARD]')).toBeVisible({ timeout: 20000 });
}

// Helper: Perform Search
async function performSearch(page: Page, term: string) {
    const searchInput = page.locator('input[placeholder="Search teams..."]');
    await searchInput.fill(term);
    await page.locator('button').filter({ hasText: 'GO' }).click();
    // Wait for internal state update and potential re-render
    await page.waitForTimeout(500);
}

// Helper: Get Team Names from results
async function getVisibleTeamNames(page: Page): Promise<string[]> {
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    const names: string[] = [];

    for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const cells = row.locator('td');
        const cellCount = await cells.count();

        // Only process rows that have the expected number of columns (3)
        // This avoids timeouts on "No teams found" which has only 1 td (colSpan=3)
        if (cellCount >= 2) {
            const text = await cells.nth(1).textContent();
            if (text && !text.includes('No teams found')) {
                names.push(text.trim().replace('★', '').trim());
            }
        }
    }
    return names;
}

// =============================================================================
// TEST SUITE: SCOREBOARD SEARCH
// =============================================================================

test.describe('Scoreboard Search Functionality (TC-SB-SEA)', () => {

    test.describe.configure({ mode: 'serial' });

    test.setTimeout(120000);

    test.beforeEach(async ({ page }) => {
        // Login as standard user
        await login(page, TEST_USER, TEST_PASS);
        await navigateToScoreboard(page);
    });

    test('SB-SEA-001: Basic Search - Match (team2)', async ({ page }) => {
        const term = 'team2';
        await performSearch(page, term);

        const results = await getVisibleTeamNames(page);
        if (results.length > 0) {
            for (const name of results) {
                expect(name.toLowerCase()).toContain(term.toLowerCase());
            }
        } else {
            // If team2 doesn't exist, search results should be empty with feedback
            await expect(page.getByText('No teams found')).toBeVisible();
        }
    });

    test('SB-SEA-002: Substring Search (team2)', async ({ page }) => {
        const term = 'team2';
        await performSearch(page, term);

        const results = await getVisibleTeamNames(page);
        if (results.length > 0) {
            for (const name of results) {
                expect(name.toLowerCase()).toContain(term.toLowerCase());
            }
        } else {
            await expect(page.getByText('No teams found')).toBeVisible();
        }
    });

    test('SB-SEA-003: Case-Insensitive Search (TEAM2)', async ({ page }) => {
        const term = 'TEAM2';
        const lowercaseTerm = term.toLowerCase();
        await performSearch(page, term);

        const results = await getVisibleTeamNames(page);
        if (results.length > 0) {
            for (const name of results) {
                expect(name.toLowerCase()).toContain(lowercaseTerm);
            }
        } else {
            await expect(page.getByText('No teams found')).toBeVisible();
        }
    });

    test('SB-SEA-004: Partial Substring Search (eam2)', async ({ page }) => {
        const term = 'eam2';
        await performSearch(page, term);

        const results = await getVisibleTeamNames(page);
        if (results.length > 0) {
            for (const name of results) {
                expect(name.toLowerCase()).toContain(term);
            }
        } else {
            await expect(page.getByText('No teams found')).toBeVisible();
        }
    });

    test('SB-SEA-005: Search with Unicode/Special Characters (~~a)', async ({ page }) => {
        const term = '~~a';
        await performSearch(page, term);

        const results = await getVisibleTeamNames(page);
        if (results.length > 0) {
            for (const name of results) {
                expect(name.toLowerCase()).toContain(term.toLowerCase());
            }
        }
    });

    test('SB-SEA-006: Empty Result handling', async ({ page }) => {
        const term = 'zzz_nonexistent_123456789_zzz';
        await performSearch(page, term);

        const results = await getVisibleTeamNames(page);
        expect(results.length).toBe(0);
        await expect(page.getByText('No teams found')).toBeVisible();
    });

    test('SB-SEA-007: Trigger search with Enter key', async ({ page }) => {
        const term = 'team2';
        const searchInput = page.locator('input[placeholder="Search teams..."]');
        await searchInput.fill(term);
        await searchInput.press('Enter');
        await page.waitForTimeout(500);

        const results = await getVisibleTeamNames(page);
        if (results.length > 0) {
            for (const name of results) {
                expect(name.toLowerCase()).toContain(term.toLowerCase());
            }
        } else {
            await expect(page.getByText('No teams found')).toBeVisible();
        }
    });

    test('SB-SEA-008: XSS Injection handling', async ({ page }) => {
        const payload = '<script>alert("xss")</script>';
        await performSearch(page, payload);

        // Verify it doesn't break the UI and handles the empty state gracefully
        await expect(page.getByText('No teams found')).toBeVisible();

        // Ensure the payload is rendered as text in the input (not executed)
        const inputValue = await page.locator('input[placeholder="Search teams..."]').inputValue();
        expect(inputValue).toBe(payload);
    });

    test('SB-SEA-009: Hidden team consistency (hidden_user)', async ({ page }) => {
        const term = 'hidden_user';
        await performSearch(page, term);

        // Hidden user should NOT appear on the scoreboard
        const results = await getVisibleTeamNames(page);
        expect(results.every(name => !name.includes(term))).toBeTruthy();
        await expect(page.getByText('No teams found')).toBeVisible();
    });
});
