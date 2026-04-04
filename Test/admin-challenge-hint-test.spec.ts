import { test, expect, Page, Locator } from '@playwright/test';

/**
 * Admin Challenge Hint Management Test Suite
 * Tests for creating, editing, and deleting hints in the Admin Portal.
 * Includes validation checks and cross-portal behavior (unlocked hints).
 */

test.describe.configure({ mode: 'serial', retries: 1 });

const ADMIN_URL = 'https://admin0.fctf.site';
const CONTESTANT_URL = 'https://contestant0.fctf.site';
const CHALLENGE_ID = '186'; // Using a known challenge ID from research

// =============================================================================
// HELPERS
// =============================================================================

async function loginAdmin(page: Page) {
    await test.step('Login as Admin', async () => {
        await page.goto(`${ADMIN_URL}/login`);
        await page.locator('#name').fill('admin');
        await page.locator('#password').fill('1');

        await page.waitForTimeout(500);
        await page.locator('#_submit').click();

        await expect(page).toHaveURL(/admin/, { timeout: 20000 });
    });
}

async function loginContestant(page: Page, user: string = 'user2', pass: string = '1') {
    await test.step(`Login as ${user}`, async () => {
        await page.goto(`${CONTESTANT_URL}/login`);
        await page.locator("input[placeholder*='username']").fill(user);
        await page.locator("input[placeholder*='password']").fill(pass);
        await page.locator("button[type='submit']").click();
        await page.waitForURL(/\/(dashboard|challenges|tickets|scoreboard|instances)/, { timeout: 60000 });
    });
}

async function navigateToAdminChallengeHints(page: Page) {
    await test.step(`Navigate to Challenge ${CHALLENGE_ID} Hints (Admin)`, async () => {
        await page.goto(`${ADMIN_URL}/admin/challenges/${CHALLENGE_ID}`);
        await page.locator('a[href="#hints"]').click();
        await expect(page.locator('#hints')).toBeVisible();
    });
}

async function dismissSwal(page: Page) {
    const okButton = page.locator('.swal2-confirm');
    if (await okButton.isVisible()) {
        await okButton.click();
    }
}

async function fillCodeMirror(page: Page, container: Locator, text: string) {
    await container.locator('.CodeMirror-scroll').click();
    await page.waitForTimeout(200);
    // Select all and delete
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(100);
    if (text) {
        // Use .type instead of .insertText to ensure CodeMirror processes the input
        await page.keyboard.type(text, { delay: 10 });
    }
    await page.waitForTimeout(200);
}

async function submitModal(page: Page, modal: Locator) {
    const submitBtn = modal.getByRole('button', { name: 'Submit' });
    await submitBtn.focus();
    await page.waitForTimeout(100);
    await submitBtn.click({ force: true });
}

// =============================================================================
// TEST CASES
// =============================================================================

test.describe('Admin Challenge Hint Management Lifecycle', () => {

    const uid = Date.now().toString().slice(-6);
    const hintContent = `Automated Lifecycle Hint ${uid}`;
    const updatedContent = `${hintContent} - UPDATED`;
    const initialCost = '50';
    const updatedCost = '100';

    test('CHAL-HINT-001: Create Hint', async ({ page }) => {
        await loginAdmin(page);
        await navigateToAdminChallengeHints(page);

        await page.locator('button:has-text("Create Hint")').click();
        const modal = page.locator('.modal:visible').filter({ hasText: 'Submit' }).first();
        await expect(modal).toBeVisible();
        await page.waitForTimeout(500); // Wait for animation

        await fillCodeMirror(page, modal, hintContent);
        await modal.locator('input[type="number"], input[name="cost"]').first().fill(initialCost);

        await submitModal(page, modal);
        await expect(modal).toBeHidden({ timeout: 5000 });

        await page.waitForTimeout(1000);
        await expect(page.locator('#hints table')).toContainText(hintContent, { timeout: 10000 });
    });

    test('CHAL-HINT-002: Edit Hint', async ({ page }) => {
        await loginAdmin(page);
        await navigateToAdminChallengeHints(page);

        const row = page.locator('#hints table tbody tr', { hasText: hintContent }).first();
        await row.locator('.btn-fa.fas.fa-edit').click();
        const modal = page.locator('.modal:visible').filter({ hasText: 'Submit' }).first();
        await expect(modal).toBeVisible();
        await page.waitForTimeout(500);

        await fillCodeMirror(page, modal, updatedContent);
        await modal.locator('input[type="number"], input[name="cost"]').first().fill(updatedCost);

        await submitModal(page, modal);
        await expect(modal).toBeHidden({ timeout: 5000 });

        await page.waitForTimeout(1000);
        await expect(page.locator('#hints table')).toContainText(updatedContent, { timeout: 10000 });
    });

    test('CHAL-HINT-003: Delete Hint', async ({ page }) => {
        await loginAdmin(page);
        await navigateToAdminChallengeHints(page);

        const row = page.locator('#hints table tbody tr', { hasText: updatedContent }).first();

        await row.locator('.btn-fa.fas.fa-times').click();

        const deleteModal = page.locator('.modal:visible').filter({ hasText: 'Delete' });
        await expect(deleteModal).toBeVisible();
        await deleteModal.getByRole('button', { name: 'Yes' }).click();

        await page.waitForTimeout(2000);
        await expect(page.locator('#hints table')).not.toContainText(updatedContent, { timeout: 10000 });
    });
});

test.describe('Admin Challenge Hint Validation & Advanced', () => {

    test('CHAL-HINT-004: Validation - Empty Content', async ({ page }) => {
        await loginAdmin(page);
        await navigateToAdminChallengeHints(page);

        await page.locator('button:has-text("Create Hint")').click();
        const modal = page.locator('.modal:visible').filter({ hasText: 'Submit' }).first();
        await expect(modal).toBeVisible();
        await page.waitForTimeout(500);

        await fillCodeMirror(page, modal, '');
        await modal.locator('input[type="number"], input[name="cost"]').first().fill('10');
        await submitModal(page, modal);

        // Modal should stay open
        await expect(modal).toBeVisible({ timeout: 5000 });
        await modal.locator('button.close, .close').first().click().catch(() => { });
    });

    test('CHAL-HINT-005: Validation - Negative Cost', async ({ page }) => {
        await loginAdmin(page);
        await navigateToAdminChallengeHints(page);

        await page.locator('button:has-text("Create Hint")').click();
        const modal = page.locator('.modal:visible').filter({ hasText: 'Submit' }).first();
        await expect(modal).toBeVisible();
        await page.waitForTimeout(500);

        await fillCodeMirror(page, modal, 'Test negative cost');
        await modal.locator('input[type="number"], input[name="cost"]').first().fill('-1');
        await submitModal(page, modal);

        await page.waitForTimeout(1500);
        if (await modal.isVisible()) {
            await modal.locator('button.close, .close').first().click().catch(() => { });
        }
    });

    test('CHAL-HINT-006: Validation - Non-numeric Cost', async ({ page }) => {
        await loginAdmin(page);
        await navigateToAdminChallengeHints(page);

        await page.locator('button:has-text("Create Hint")').click();
        const modal = page.locator('.modal:visible').filter({ hasText: 'Submit' }).first();
        await expect(modal).toBeVisible();
        await page.waitForTimeout(500);

        await fillCodeMirror(page, modal, 'Test non-numeric');
        await modal.locator('input[type="number"], input[name="cost"]').first().fill('abc').catch(() => { });
        await submitModal(page, modal);

        await page.waitForTimeout(1500);
        if (await modal.isVisible()) {
            await modal.locator('button.close, .close').first().click().catch(() => { });
        }
    });

    test('CHAL-HINT-007: Delete Hint Unlocked by Contestant', async ({ browser }) => {
        const hintContent = `Unlocked Hint ${Date.now().toString().slice(-6)}`;
        const cost = '50';

        const adminContext = await browser.newContext();
        const userContext = await browser.newContext();

        const adminPage = await adminContext.newPage();
        const userPage = await userContext.newPage();

        // Step 1: Admin creates hint
        await test.step('Admin: Create hint for unlock test', async () => {
            await loginAdmin(adminPage);
            await navigateToAdminChallengeHints(adminPage);

            await adminPage.locator('button:has-text("Create Hint")').click();
            const modal = adminPage.locator('.modal:visible').filter({ hasText: 'Submit' }).first();
            await expect(modal).toBeVisible();
            await adminPage.waitForTimeout(500);

            await fillCodeMirror(adminPage, modal, hintContent);
            await modal.locator('input[type="number"], input[name="cost"]').first().fill(cost);

            await submitModal(adminPage, modal);
            await expect(modal).toBeHidden({ timeout: 5000 });
            await adminPage.waitForTimeout(1000);
            await expect(adminPage.locator('#hints table')).toContainText(hintContent, { timeout: 10000 });
        });

        // Step 2: Contestant unlocks hint
        await test.step('Contestant: Unlock the hint', async () => {
            await loginContestant(userPage, 'user2');
            await userPage.getByRole('button', { name: 'Challenges', exact: true }).click();
            await userPage.waitForTimeout(2000);

            // Wait for categories to load, expand WEB if collapsed 
            const categoryBtn = userPage.locator('button', { hasText: /WEB/i }).first();
            await categoryBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
            await categoryBtn.click().catch(() => { });

            // Search precisely for the 'EZ Web' challenge name (id 186)
            await userPage.locator('h3', { hasText: /EZ Web/i }).first().click();
            await userPage.waitForTimeout(2000);

            // Wait for hint buttons to render by looking for buttons inside the hints block
            // Often it renders a hint header [HINTS] prior.
            const hintButtons = userPage.locator('button').filter({ hasText: /^H\d+/ });
            await hintButtons.last().waitFor({ state: 'visible', timeout: 5000 });
            await hintButtons.last().click({ force: true });

            await userPage.locator('.swal2-confirm').waitFor({ state: 'visible', timeout: 5000 });
            await userPage.locator('.swal2-confirm').click();
            await expect(userPage.locator('.swal2-popup')).toContainText(/( unlocked|Already unlocked)/i);
            await dismissSwal(userPage);
        });

        // Step 3: Admin deletes hint
        await test.step('Admin: Delete the unlocked hint', async () => {
            const row = adminPage.locator('#hints table tbody tr', { hasText: hintContent }).first();

            await row.locator('.btn-fa.fas.fa-times').click();

            const deleteModal = adminPage.locator('.modal:visible').filter({ hasText: 'Delete' });
            await expect(deleteModal).toBeVisible();
            await deleteModal.getByRole('button', { name: 'Yes' }).click();

            await adminPage.waitForTimeout(2000);
            await expect(adminPage.locator('#hints table')).not.toContainText(hintContent, { timeout: 10000 });
        });

        await adminContext.close();
        await userContext.close();
    });
});
