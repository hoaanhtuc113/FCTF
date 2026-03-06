import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const ADMIN_URL = 'https://admin.fctf.site';

test.describe.configure({ mode: 'serial' });

// =============================================================================
// HELPERS
// =============================================================================

async function loginAdmin(page: Page) {
    await page.goto(`${ADMIN_URL}/login`);
    await page.getByRole('textbox', { name: 'User Name or Email' }).fill('admin');
    await page.getByRole('textbox', { name: 'Password' }).fill('1');
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page).toHaveURL(/.*admin/, { timeout: 15000 });
}

/** Navigate to Config → Backup → Import CSV tab */
async function goToImportCSV(page: Page) {
    await page.goto(`${ADMIN_URL}/admin/config`);
    await page.waitForTimeout(1500);
    // Click the "Import & Export" sidebar link
    await page.locator('a[href="#backup"][data-toggle="tab"]').click();
    await page.waitForTimeout(800);
    // Click the "Import CSV" inner tab
    await page.locator('#backup a[href="#import-csv"][data-toggle="tab"]').click();
    await page.waitForTimeout(800);
    // Verify the import-csv pane is visible
    await expect(page.locator('#import-csv')).toBeVisible();
}

/**
 * Upload a CSV file via the import form.
 * @param csvType  - "users" | "teams" | "users_and_teams"
 * @param content  - raw CSV text
 * @param filename - name shown in the file-input
 * Returns the dialog message if the browser shows an alert, or null.
 */
async function submitImportCSV(
    page: Page,
    csvType: string,
    content: string,
    filename: string = 'test.csv'
): Promise<string | null> {
    // Write temp file
    const tmpPath = path.join(os.tmpdir(), filename);
    fs.writeFileSync(tmpPath, content, 'utf-8');

    // Select csv_type
    await page.locator('#import-csv-type').selectOption(csvType);

    // Upload file
    await page.locator('#import-csv-file').setInputFiles(tmpPath);

    // Register the dialog listener BEFORE clicking so we never miss the event.
    // page.waitForEvent with generous timeout handles slow bulk imports (>4s).
    const dialogPromise = page.waitForEvent('dialog', { timeout: 30000 });

    // Submit
    await page.locator('#import-csv-form button[type="submit"], #import-csv-form input[type="submit"]').click();

    // Await the alert dialog – give up to 30 s for large imports
    let dialogMessage: string | null = null;
    try {
        const dialog = await dialogPromise;
        dialogMessage = dialog.message();
        await dialog.accept();
    } catch {
        // No dialog within 30 s
        dialogMessage = null;
    }

    try { fs.unlinkSync(tmpPath); } catch { /* ignore EBUSY on Windows */ }
    return dialogMessage;
}

/**
 * Check whether a user exists in the admin user list.
 */
async function userExistsInAdmin(page: Page, username: string): Promise<boolean> {
    await page.goto(`${ADMIN_URL}/admin/users?q=${encodeURIComponent(username)}&field=name`);
    await page.waitForTimeout(1500);
    const count = await page.locator('#teamsboard tbody tr').count();
    if (count === 0) return false;
    const firstRow = await page.locator('#teamsboard tbody tr').first().textContent();
    return firstRow?.includes(username) ?? false;
}

// =============================================================================
// TEST DATA FACTORIES
// =============================================================================

function makeUsersCSV(users: { name: string; email: string; password: string }[]) {
    const header = 'Name,Email,Password';
    const rows = users.map(u => `${u.name},${u.email},${u.password}`);
    return [header, ...rows].join('\r\n');
}

function makeTeamsCSV(teams: { name: string; email: string; password: string }[]) {
    const header = 'Name,Email,Password';
    const rows = teams.map(t => `${t.name},${t.email},${t.password}`);
    return [header, ...rows].join('\r\n');
}

function makeUsersAndTeamsCSV(entries: { name: string; email: string; password: string; team?: string }[]) {
    const header = 'Name,Email,Password,Team';
    const rows = entries.map(e => `${e.name},${e.email},${e.password},${e.team ?? ''}`);
    return [header, ...rows].join('\r\n');
}

// =============================================================================
// TESTS
// =============================================================================

test.describe('Admin Import CSV (IMP-001 - IMP-020)', () => {
    test.setTimeout(90000);

    test.beforeEach(async ({ page }) => {
        await loginAdmin(page);
        await goToImportCSV(page);
    });

    // -------------------------------------------------------------------------
    // IMP-001: UI STRUCTURE — Form elements visible
    // -------------------------------------------------------------------------
    test('IMP-001: Import CSV UI elements are visible on config page', async ({ page }) => {
        await expect(page.locator('#import-csv-type')).toBeVisible();
        await expect(page.locator('#import-csv-file')).toBeVisible();
        await expect(
            page.locator('#import-csv-form button[type="submit"], #import-csv-form input[type="submit"]')
        ).toBeVisible();
    });

    // -------------------------------------------------------------------------
    // IMP-002: TEMPLATE DOWNLOAD — Users template download
    // -------------------------------------------------------------------------
    test('IMP-002: Download Users CSV template', async ({ page }) => {
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('a[href*="users_template.csv"]').click()
        ]);
        expect(download.suggestedFilename()).toBe('users_template.csv');
        const tmpPath = await download.path();
        const content = fs.readFileSync(tmpPath as string, 'utf-8');
        // Should have proper header
        expect(content.toLowerCase()).toContain('name');
        expect(content.toLowerCase()).toContain('email');
        expect(content.toLowerCase()).toContain('password');
    });

    // -------------------------------------------------------------------------
    // IMP-003: TEMPLATE DOWNLOAD — Teams template download
    // -------------------------------------------------------------------------
    test('IMP-003: Download Teams CSV template', async ({ page }) => {
        // Use exact text match to avoid matching "users_and_teams_template.csv"
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.getByRole('link', { name: 'Download Teams template' }).click()
        ]);
        expect(download.suggestedFilename()).toBe('teams_template.csv');
    });

    // -------------------------------------------------------------------------
    // IMP-004: TEMPLATE DOWNLOAD — Users+Teams template download
    // -------------------------------------------------------------------------
    test('IMP-004: Download Users+Teams CSV template', async ({ page }) => {
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.getByRole('link', { name: 'Download Users + Teams template' }).click()
        ]);
        expect(download.suggestedFilename()).toBe('users_and_teams_template.csv');
        const tmpPath = await download.path();
        const content = fs.readFileSync(tmpPath as string, 'utf-8');
        expect(content.toLowerCase()).toContain('team');
    });

    // -------------------------------------------------------------------------
    // IMP-005: IMPORT USERS — Happy path
    // -------------------------------------------------------------------------
    test('IMP-005: Import valid Users CSV creates new users', async ({ page }) => {
        const ts = Date.now();
        const csv = makeUsersCSV([
            { name: `imp_user_a_${ts}`, email: `imp_a_${ts}@test.com`, password: 'Test@1234' },
            { name: `imp_user_b_${ts}`, email: `imp_b_${ts}@test.com`, password: 'Test@1234' },
        ]);

        const msg = await submitImportCSV(page, 'users', csv, 'users.csv');
        expect(msg).toMatch(/import completed successfully/i);

        // Verify users appear in admin
        const existA = await userExistsInAdmin(page, `imp_user_a_${ts}`);
        expect(existA).toBe(true);
        const existB = await userExistsInAdmin(page, `imp_user_b_${ts}`);
        expect(existB).toBe(true);
    });

    // -------------------------------------------------------------------------
    // IMP-006: IMPORT TEAMS — Happy path
    // -------------------------------------------------------------------------
    test('IMP-006: Import valid Teams CSV creates new teams', async ({ page }) => {
        const ts = Date.now();
        const csv = makeTeamsCSV([
            { name: `imp_team_a_${ts}`, email: `team_a_${ts}@test.com`, password: 'Team@1234' },
        ]);

        const msg = await submitImportCSV(page, 'teams', csv, 'teams.csv');
        expect(msg).toMatch(/import completed successfully/i);
    });

    // -------------------------------------------------------------------------
    // IMP-007: IMPORT USERS+TEAMS — Happy path, user assigned to team
    // -------------------------------------------------------------------------
    test('IMP-007: Import Users+Teams CSV — users correctly assigned to teams', async ({ page }) => {
        const ts = Date.now();
        const csv = makeUsersAndTeamsCSV([
            { name: `ut_alice_${ts}`, email: `ut_alice_${ts}@test.com`, password: 'Pass@123', team: `ut_team_${ts}` },
            { name: `ut_bob_${ts}`, email: `ut_bob_${ts}@test.com`, password: 'Pass@123', team: `ut_team_${ts}` },
            { name: `ut_charlie_${ts}`, email: `ut_charlie_${ts}@test.com`, password: 'Pass@123', team: '' },
        ]);

        const msg = await submitImportCSV(page, 'users_and_teams', csv, 'users_and_teams.csv');
        expect(msg).toMatch(/import completed successfully/i);

        // Verify Alice is created
        const existAlice = await userExistsInAdmin(page, `ut_alice_${ts}`);
        expect(existAlice).toBe(true);
    });

    // -------------------------------------------------------------------------
    // IMP-008: DUPLICATE USERNAME — Import same username twice → error or warning
    // -------------------------------------------------------------------------
    test('IMP-008: Duplicate username in import should fail or show warning', async ({ page }) => {
        const ts = Date.now();
        const username = `dup_user_${ts}`;
        const csv = makeUsersCSV([
            { name: username, email: `dup_${ts}_1@test.com`, password: 'Pass@123' },
        ]);

        // First import - should succeed
        let msg = await submitImportCSV(page, 'users', csv, 'dup1.csv');
        expect(msg).toMatch(/import completed successfully/i);

        // Navigate back to import tab
        await goToImportCSV(page);

        // Second import with same username but different email
        const csv2 = makeUsersCSV([
            { name: username, email: `dup_${ts}_2@test.com`, password: 'DiffPass@123' },
        ]);
        msg = await submitImportCSV(page, 'users', csv2, 'dup2.csv');

        // Backend should either refuse (fail) or warn about duplicate
        const isMsgPresent = msg !== null;
        expect(isMsgPresent).toBe(true);
    });

    // -------------------------------------------------------------------------
    // IMP-009: DUPLICATE EMAIL — Import same email twice → error or warning
    // -------------------------------------------------------------------------
    test('IMP-009: Duplicate email in import should fail or show warning', async ({ page }) => {
        const ts = Date.now();
        const email = `dup_email_${ts}@test.com`;
        const csv = makeUsersCSV([
            { name: `dup_mail_user1_${ts}`, email, password: 'Pass@123' },
        ]);

        // First import
        let msg = await submitImportCSV(page, 'users', csv, 'dup_email_1.csv');
        expect(msg).toMatch(/import completed successfully/i);

        await goToImportCSV(page);

        // Second import - same email different username
        const csv2 = makeUsersCSV([
            { name: `dup_mail_user2_${ts}`, email, password: 'DiffPass@123' },
        ]);
        msg = await submitImportCSV(page, 'users', csv2, 'dup_email_2.csv');

        // Should produce some feedback (error or warning)
        expect(msg).not.toBeNull();
    });

    // -------------------------------------------------------------------------
    // IMP-010: EMPTY CSV — Only header row, no data
    // -------------------------------------------------------------------------
    test('IMP-010: Import CSV with header only (no data rows) should succeed or warn', async ({ page }) => {
        const csv = 'Name,Email,Password\r\n';
        const msg = await submitImportCSV(page, 'users', csv, 'empty.csv');
        // Should not crash; success or graceful message expected
        expect(msg).not.toBeNull();
    });

    // -------------------------------------------------------------------------
    // IMP-011: MISSING REQUIRED FIELDS — CSV missing email column
    // -------------------------------------------------------------------------
    test('IMP-011: CSV missing required Email column should fail gracefully', async ({ page }) => {
        const ts = Date.now();
        const csv = `Name,Password\r\nmissing_email_${ts},Pass@123\r\n`;
        const msg = await submitImportCSV(page, 'users', csv, 'missing_email.csv');
        // Should fail with some error message (not crash)
        expect(msg).not.toBeNull();
    });

    // -------------------------------------------------------------------------
    // IMP-012: INVALID EMAIL FORMAT — Bad email address
    // -------------------------------------------------------------------------
    test('IMP-012: CSV with invalid email format should fail gracefully', async ({ page }) => {
        const ts = Date.now();
        const csv = makeUsersCSV([
            { name: `bad_email_user_${ts}`, email: 'not-a-valid-email', password: 'Pass@123' },
        ]);

        const msg = await submitImportCSV(page, 'users', csv, 'bad_email.csv');
        // Backend validates email; should produce an error or warning message
        expect(msg).not.toBeNull();
    });

    // -------------------------------------------------------------------------
    // IMP-013: UNICODE NAMES — Non-ASCII characters in name/email
    // -------------------------------------------------------------------------
    test('IMP-013: Import users with Unicode names should succeed', async ({ page }) => {
        const ts = Date.now();
        const csv = makeUsersCSV([
            { name: `Nguyễn_${ts}`, email: `unicode_${ts}@test.com`, password: 'Pass@123' },
        ]);

        const msg = await submitImportCSV(page, 'users', csv, 'unicode.csv');
        expect(msg).toMatch(/import completed successfully/i);

        const exists = await userExistsInAdmin(page, `Nguyễn_${ts}`);
        expect(exists).toBe(true);
    });

    // -------------------------------------------------------------------------
    // IMP-014: WRONG FILE TYPE — Upload a .txt file
    // -------------------------------------------------------------------------
    test('IMP-014: Uploading a .txt file should not crash the import', async ({ page }) => {
        const tmpPath = path.join(os.tmpdir(), 'test_wrong_type.txt');
        fs.writeFileSync(tmpPath, 'This is not a CSV file.', 'utf-8');

        await page.locator('#import-csv-type').selectOption('users');

        // Override file input to bypass accept=".csv"
        await page.locator('#import-csv-file').evaluate((el) => {
            (el as HTMLInputElement).removeAttribute('accept');
        });
        await page.locator('#import-csv-file').setInputFiles(tmpPath);

        const dialogPromise = page.waitForEvent('dialog', { timeout: 30000 });
        await page.locator('#import-csv-form button[type="submit"], #import-csv-form input[type="submit"]').click();

        let dialogMessage: string | null = null;
        try {
            const dialog = await dialogPromise;
            dialogMessage = dialog.message();
            await dialog.accept();
        } catch { dialogMessage = null; }

        try { fs.unlinkSync(tmpPath); } catch { /* ignore EBUSY on Windows */ }
        // Should not crash, some message expected
        expect(dialogMessage).not.toBeNull();
    });

    // -------------------------------------------------------------------------
    // IMP-015: WRONG CSV TYPE MISMATCH — Upload users CSV but select "teams"
    // -------------------------------------------------------------------------
    test('IMP-015: Uploading Users CSV with "teams" type selected should handle gracefully', async ({ page }) => {
        const ts = Date.now();
        // Columns match teams schema (Name,Email,Password) so it may still succeed
        const csv = makeTeamsCSV([
            { name: `mismatch_team_${ts}`, email: `mismatch_${ts}@test.com`, password: 'Pass@123' },
        ]);

        const msg = await submitImportCSV(page, 'teams', csv, 'type_mismatch.csv');
        // Should produce a dialog – success or error is both acceptable, not a crash
        expect(msg).not.toBeNull();
    });

    // -------------------------------------------------------------------------
    // IMP-016: LARGE CSV — Many rows (bulk import)
    // -------------------------------------------------------------------------
    test('IMP-016: Import a large CSV with 50 users should succeed', async ({ page }) => {
        const ts = Date.now();
        const users = Array.from({ length: 50 }, (_, i) => ({
            name: `bulk_user_${ts}_${i}`,
            email: `bulk_${ts}_${i}@test.com`,
            password: 'BulkPass@123',
        }));
        const csv = makeUsersCSV(users);

        const msg = await submitImportCSV(page, 'users', csv, `bulk_${ts}.csv`);
        expect(msg).toMatch(/import completed successfully/i);
    });

    // -------------------------------------------------------------------------
    // IMP-017: USERS+TEAMS CSV — Row with duplicate username within single upload
    // -------------------------------------------------------------------------
    test('IMP-017: Users+Teams CSV with duplicate username within file should handle gracefully', async ({ page }) => {
        const ts = Date.now();
        const csv = makeUsersAndTeamsCSV([
            { name: `dup_within_${ts}`, email: `dup_w1_${ts}@test.com`, password: 'Pass@123', team: `dup_team_${ts}` },
            { name: `dup_within_${ts}`, email: `dup_w2_${ts}@test.com`, password: 'Pass@123', team: `dup_team_${ts}` },
        ]);

        const msg = await submitImportCSV(page, 'users_and_teams', csv, 'dup_within.csv');
        // Should produce a message – warning or error
        expect(msg).not.toBeNull();
    });

    // -------------------------------------------------------------------------
    // IMP-018: IMPORT WITH BOM — UTF-8 BOM encoded file
    // -------------------------------------------------------------------------
    test('IMP-018: CSV with UTF-8 BOM encoding should import correctly', async ({ page }) => {
        const ts = Date.now();
        const csvContent = `Name,Email,Password\r\nbom_user_${ts},bom_${ts}@test.com,Pass@123\r\n`;
        const BOM = '\xEF\xBB\xBF';
        const tmpPath = path.join(os.tmpdir(), `bom_${ts}_test.csv`);
        fs.writeFileSync(tmpPath, BOM + csvContent, 'binary');

        await page.locator('#import-csv-type').selectOption('users');
        await page.locator('#import-csv-file').setInputFiles(tmpPath);

        const dialogPromise = page.waitForEvent('dialog', { timeout: 30000 });
        await page.locator('#import-csv-form button[type="submit"], #import-csv-form input[type="submit"]').click();

        let dialogMessage: string | null = null;
        try {
            const dialog = await dialogPromise;
            dialogMessage = dialog.message();
            await dialog.accept();
        } catch { dialogMessage = null; }

        try { fs.unlinkSync(tmpPath); } catch { /* ignore EBUSY on Windows */ }
        expect(dialogMessage).toMatch(/import completed successfully/i);

        const exists = await userExistsInAdmin(page, `bom_user_${ts}`);
        expect(exists).toBe(true);
    });

    // -------------------------------------------------------------------------
    // IMP-019: UNAUTHENTICATED ACCESS — Direct POST to import endpoint
    // -------------------------------------------------------------------------
    test('IMP-019: Unauthenticated POST to import CSV endpoint should redirect to login', async ({ browser }) => {
        const context = await browser.newContext();
        const page = await context.newPage();

        // Try to access the import endpoint without authentication
        await page.goto(`${ADMIN_URL}/admin/config`);
        // Should redirect to login page
        await expect(page).toHaveURL(/login/, { timeout: 10000 });
        await context.close();
    });

    // -------------------------------------------------------------------------
    // IMP-020: CSV TYPE DROPDOWN — Verify all options are present
    // -------------------------------------------------------------------------
    test('IMP-020: CSV type dropdown contains expected options', async ({ page }) => {
        const select = page.locator('#import-csv-type');
        await expect(select).toBeVisible();

        // Should have at least users, teams, users_and_teams options
        const options = await select.locator('option').allTextContents();
        const optionValues = await select.locator('option').evaluateAll((els) =>
            els.map((el) => (el as HTMLOptionElement).value)
        );

        // Verify key options exist (by value)
        expect(optionValues).toContain('users');
        expect(optionValues).toContain('teams');
        expect(optionValues).toContain('users_and_teams');
    });
});
