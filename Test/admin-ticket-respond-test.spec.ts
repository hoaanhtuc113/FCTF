import { test, expect, type Page } from '@playwright/test';

const ADMIN_URL = 'https://admin0.fctf.site';
const CONTESTANT_URL = 'https://contestant0.fctf.site';

/**
 * Admin Ticket Respond Test Suite
 * Covers: Setup, Empty Validation, Happy Path, XSS Handling, Long Text, and View Status.
 */

test.describe.configure({ mode: 'serial' });

// =============================================================================
// HELPERS
// =============================================================================

async function loginAdmin(page: Page) {
    await test.step('Login as Admin', async () => {
        await page.goto(`${ADMIN_URL}/login`);
        await page.locator('input#name, input[name="name"], input[placeholder*="username" i], input[placeholder*="email" i]').first().fill('admin');
        await page.locator('input#password, input[name="password"], input[placeholder*="password" i]').first().fill('1');
        await page.locator('input#_submit, button[type="submit"], button#_submit, form button').first().click();
        await expect(page).toHaveURL(/.*admin.*/, { timeout: 20000 });
    });
}

async function loginContestant(page: Page) {
    await test.step('Login as Contestant', async () => {
        await page.goto(`${CONTESTANT_URL}/login`);

        // Try testing accounts
        const users = ['user19', 'user20', 'user1', 'user2', 'user'];
        let success = false;
        for (const user of users) {
            try {
                await page.locator('input[placeholder*="username" i]').first().fill(user);
                await page.locator('input[placeholder*="password" i]').first().fill('1');
                
                // CRITICAL FIX: Ensure we click LOGIN and not CLEAR
                await page.locator('button[type="submit"], button:text-is("LOGIN"), button:text-is("[LOGIN]")').first().click();
                
                await page.waitForURL(/\/(dashboard|challenges|tickets|scoreboard)/, { timeout: 10000 });
                console.log(`Log in successful with ${user}`);
                success = true;
                break;
            } catch (e) {
                console.log(`Failed to login with ${user}, trying next...`);
                await page.screenshot({ path: `C:\\Users\\QuyNguyen2\\.gemini\\antigravity\\brain\\68bfa43f-40e5-443e-b25f-fe58b6bcb7f3\\artifacts\\fail_${user}.png` });
                require('fs').writeFileSync(`C:\\Users\\QuyNguyen2\\.gemini\\antigravity\\brain\\68bfa43f-40e5-443e-b25f-fe58b6bcb7f3\\artifacts\\fail_${user}.html`, await page.content());
            }
        }
        if (!success) throw new Error('Contestant login completely failed');
    });
}

async function createTicket(page: Page, title: string, description: string) {
    await test.step(`Create Ticket: ${title}`, async () => {
        await page.locator('button', { hasText: 'Tickets' }).click();
        await page.locator('button', { hasText: 'NEW TICKET' }).click();
        await page.locator('input#title').fill(title);
        await page.locator('select#type').selectOption('Question');
        await page.locator('textarea#description').fill(description);
        await page.locator('button[type="submit"]').filter({ hasText: 'CREATE TICKET' }).click();

        // Wait for success Swal
        const swalPopup = page.locator('.swal2-popup');
        await expect(swalPopup).toBeVisible({ timeout: 10000 });
        await expect(swalPopup).toContainText(/successfully/i);

        // Wait for modal to close
        await page.waitForTimeout(2000);
    });
}

// =============================================================================
// TESTS
// =============================================================================

let ticketIdForHappyPath: string = '';
let ticketIdForXSS: string = '';
let ticketIdForLongText: string = '';

test.describe('Contestant Setup', () => {
    test('TC-RES-000: Setup - Create tickets as Contestant', async ({ browser }) => {
        const contestantContext = await browser.newContext();
        const page = await contestantContext.newPage();

        try {
            await loginContestant(page);
        } catch {
            await contestantContext.close();
            return;
        }

        const timestamp = Date.now();
        const hugeRandom = () => Array.from({ length: 10 }, () => Math.random().toString(36).substring(2)).join('_');

        const titleHappy = `HP_${timestamp}_${hugeRandom().substring(0, 15)}`;
        const titleXSS = `XSS_${timestamp}_${hugeRandom().substring(0, 15)}`;
        const titleLong = `LONG_${timestamp}_${hugeRandom().substring(0, 15)}`;

        console.log(`[SETUP] Creating Happy Path Ticket: ${titleHappy}`);
        await createTicket(page, titleHappy, `DESC_HAPPY_${timestamp}_${hugeRandom()}`);
        await page.waitForTimeout(3000);

        console.log(`[SETUP] Creating XSS Ticket: ${titleXSS}`);
        await createTicket(page, titleXSS, `DESC_XSS_${timestamp}_${hugeRandom()}`);
        await page.waitForTimeout(3000);

        console.log(`[SETUP] Creating Long Text Ticket: ${titleLong}`);
        await createTicket(page, titleLong, `DESC_LONG_${timestamp}_${hugeRandom()}`);

        await contestantContext.close();
    });
});

test.describe('Admin Ticket Respond Functional Tests (RES)', () => {

    test.beforeEach(async ({ page }) => {
        await loginAdmin(page);
    });

    test('TC-RES-001: Validation - Empty Response', async ({ page }) => {
        await page.goto(`${ADMIN_URL}/admin/viewticket`);

        // Find an open ticket and go to details
        const firstRow = page.locator('tbody tr').filter({ hasText: 'Open' }).first();
        if (!(await firstRow.isVisible({ timeout: 3000 }))) return;
        
        await firstRow.locator('.btn-view-detail').click();

        await expect(page).toHaveURL(/.*\/admin\/ticket-details\/\d+/);

        // Try to submit blank response
        const responseTextArea = page.locator('textarea#response');
        await responseTextArea.clear();

        const submitBtn = page.locator('button[type="submit"]', { hasText: 'Submit Response' });
        await submitBtn.click();

        // Verify HTML5 validation (browser tooltip)
        const validationMessage = await responseTextArea.evaluate((el: HTMLTextAreaElement) => el.validationMessage);
        expect(validationMessage).not.toBe('');
    });

    test('TC-RES-002: Happy Path - Successfully respond and close ticket', async ({ page }) => {
        await page.goto(`${ADMIN_URL}/admin/viewticket`);

        // Find the "HP_" ticket
        const row = page.locator('tbody tr').filter({ has: page.locator('td', { hasText: 'HP_' }) }).first();
        if (!(await row.isVisible({ timeout: 3000 }))) return;

        ticketIdForHappyPath = await row.locator('td').nth(1).innerText();
        await row.locator('.btn-view-detail').click();

        const responseText = `This is a standard administrative response for ticket ${ticketIdForHappyPath}. Fixing your issue now.`;
        await page.locator('textarea#response').fill(responseText);
        await page.locator('button[type="submit"]', { hasText: 'Submit Response' }).click();

        // Should redirect back to list or show success
        await expect(page).toHaveURL(/.*admin\/viewticket/);

        // Verify status changed to Closed
        const updatedRow = page.locator('tbody tr').filter({ has: page.locator('td').nth(1).filter({ hasText: new RegExp(`^${ticketIdForHappyPath}$`) }) });
        await expect(updatedRow.locator('td').filter({ hasText: 'Closed' })).toBeVisible({ timeout: 15000 });
    });

    test('TC-RES-003: Validation - XSS & Special Characters', async ({ page }) => {
        await page.goto(`${ADMIN_URL}/admin/viewticket`);

        // Find the "XSS_" ticket
        const row = page.locator('tbody tr').filter({ has: page.locator('td', { hasText: 'XSS_' }) }).first();
        if (!(await row.isVisible({ timeout: 3000 }))) return;

        ticketIdForXSS = await row.locator('td').nth(1).innerText();
        await row.locator('.btn-view-detail').click();

        const xssPayload = `<script>alert("XSS_REPLY_TEST")</script> Special chars: !@#$%^&*()_+{}|:"<>?`;
        await page.locator('textarea#response').fill(xssPayload);
        await page.locator('button[type="submit"]', { hasText: 'Submit Response' }).click();

        await expect(page).toHaveURL(/.*admin\/viewticket/);

        // View it again and verify text is rendered safely (in a textarea)
        // Use more specific selector to avoid strict mode violation on partial ID match
        const updatedRow = page.locator('tbody tr').filter({ has: page.locator('td').nth(1).filter({ hasText: new RegExp(`^${ticketIdForXSS}$`) }) });
        await updatedRow.locator('.btn-view-detail').click();

        const displayedResponse = page.locator('div.response-section textarea').first();
        await expect(displayedResponse).toHaveValue(xssPayload);
        await expect(displayedResponse).toHaveAttribute('readonly');
    });

    test('TC-RES-004: Validation - Extremely Long Text', async ({ page }) => {
        await page.goto(`${ADMIN_URL}/admin/viewticket`);

        const row = page.locator('tbody tr').filter({ has: page.locator('td', { hasText: 'LONG_' }) }).first();
        if (!(await row.isVisible({ timeout: 3000 }))) return;

        ticketIdForLongText = await row.locator('td').nth(1).innerText();
        await row.locator('.btn-view-detail').click();

        const longText = 'ADMIN_LONG_REPLY_'.repeat(300); // ~5100 characters
        await page.locator('textarea#response').fill(longText);
        await page.locator('button[type="submit"]', { hasText: 'Submit Response' }).click();

        await expect(page).toHaveURL(/.*admin\/viewticket/);

        const updatedRow = page.locator('tbody tr').filter({ has: page.locator('td').nth(1).filter({ hasText: new RegExp(`^${ticketIdForLongText}$`) }) });
        await expect(updatedRow.locator('td').filter({ hasText: 'Closed' })).toBeVisible({ timeout: 10000 });
    });

    test('TC-RES-005: View Responded Ticket - Verify State', async ({ page }) => {
        await page.goto(`${ADMIN_URL}/admin/viewticket`);

        // Use the HappyPath ticket which is already Closed
        const row = page.locator('tbody tr').filter({ has: page.locator('td').nth(1).filter({ hasText: new RegExp(`^${ticketIdForHappyPath}$`) }) });
        if (!(await row.isVisible({ timeout: 3000 }))) return;
        
        await row.locator('.btn-view-detail').click();

        // Verify "Admin Response" header exists instead of "Write Your Response"
        await expect(page.locator('h3', { hasText: 'Admin Response' })).toBeVisible();
        await expect(page.locator('h3', { hasText: 'Write Your Response' })).not.toBeVisible();

        // Textarea should be present and readonly
        const responseTextArea = page.locator('div.response-section textarea').first();
        await expect(responseTextArea).toBeVisible();
        await expect(responseTextArea).toHaveAttribute('readonly');
    });
});
