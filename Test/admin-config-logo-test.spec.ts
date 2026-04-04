import { test, expect, type Page } from '@playwright/test';
import path from 'path';

// ─────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────
const ADMIN_URL = 'https://admin0.fctf.site';
const CONTESTANT_URL = 'https://contestant0.fctf.site';

const ASSETS_PATH = path.resolve(__dirname, '..'); // Root directory where logo.jpg/png reside
const LOGO_JPG = path.join(ASSETS_PATH, 'logo.jpg');
const LOGO_PNG = path.join(ASSETS_PATH, 'logo.png');

// ─────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────

async function loginAdmin(page: Page) {
    await test.step('Login as admin', async () => {
        await page.goto(`${ADMIN_URL}/login`);
        await page.getByRole('textbox', { name: 'User Name or Email' }).fill('admin');
        await page.getByRole('textbox', { name: 'Password' }).fill('1');
        await page.getByRole('button', { name: 'Submit' }).click();
        await expect(page).toHaveURL(/.*admin/, { timeout: 15000 });
    });
}

async function goToLogoTab(page: Page) {
    await page.goto(`${ADMIN_URL}/admin/config`, { waitUntil: 'load' });
    await page.locator('#config-sidebar a[href="#logo"]').click();
    await expect(page.locator('#logo')).toBeVisible({ timeout: 10000 });
}

// ─────────────────────────────────────────
//  Test Suite
// ─────────────────────────────────────────

test.describe('Admin Config Logo Tests (CONF-LOGO)', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(120000);

    test.beforeEach(async ({ page }) => {
        await loginAdmin(page);
        await goToLogoTab(page);
    });

    // ── CONF-LOGO-001 ────────────────────────────────────────────────────────
    test('CONF-LOGO-001: UI – Logo tab renders all sections', async ({ page }) => {
        console.log('Starting CONF-LOGO-001...');
        await expect(page.locator('#logo-upload')).toBeVisible();
        await expect(page.locator('#small-icon-upload, #ctf-small-icon-upload')).toBeVisible();

        await expect(page.locator('label[for="ctf_logo"]')).toContainText('Logo');
        await expect(page.locator('label[for="small_icon"]')).toContainText('Tab Icon');
        console.log('CONF-LOGO-001 PASSED');
    });

    // ── CONF-LOGO-002 ────────────────────────────────────────────────────────
    test('CONF-LOGO-002: Happy path – Upload Logo (JPG)', async ({ page }) => {
        console.log('Starting CONF-LOGO-002...');

        // Use setInputFiles on the file input
        await page.locator('#ctf_logo_file').setInputFiles(LOGO_JPG);

        // Click Upload button in the logo form
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'load' }).catch(() => { }),
            page.locator('#logo-upload button[type="submit"]').click(),
        ]);

        await page.waitForTimeout(2000);
        await goToLogoTab(page);

        // Verify preview is visible
        const preview = page.locator('#ctf_logo_preview');
        await expect(preview).toBeVisible();
        const src = await preview.getAttribute('src');
        expect(src).toContain('/files/');
        console.log(`Logo uploaded: ${src}`);
        console.log('CONF-LOGO-002 PASSED');
    });

    // ── CONF-LOGO-003 ────────────────────────────────────────────────────────
    test('CONF-LOGO-003: Happy path – Upload Logo (PNG) overwrites existing', async ({ page }) => {
        console.log('Starting CONF-LOGO-003...');

        await page.locator('#ctf_logo_file').setInputFiles(LOGO_PNG);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'load' }).catch(() => { }),
            page.locator('#logo-upload button[type="submit"]').click(),
        ]);

        await page.waitForTimeout(2000);
        await goToLogoTab(page);

        const preview = page.locator('#ctf_logo_preview');
        await expect(preview).toBeVisible();
        const src = await preview.getAttribute('src');
        expect(src).toContain('/files/');
        console.log('CONF-LOGO-003 PASSED');
    });

    // ── CONF-LOGO-004 ────────────────────────────────────────────────────────
    test('CONF-LOGO-004: Logo Removal – Preview disappears', async ({ page }) => {
        console.log('Starting CONF-LOGO-004...');

        // Ensure there is a logo to remove
        if (!(await page.locator('#remove-logo').isVisible())) {
            await page.locator('#ctf_logo_file').setInputFiles(LOGO_PNG);
            await page.locator('#logo-upload button[type="submit"]').click();
            await page.waitForTimeout(2000);
            await goToLogoTab(page);
        }

        // Click Remove Logo and click "Yes" in the modal
        await page.locator('#remove-logo').click();
        await expect(page.locator('.modal-content')).toBeVisible();
        await page.locator('.modal-footer button:has-text("Yes")').click();

        await page.waitForTimeout(2000);
        await goToLogoTab(page);

        await expect(page.locator('#ctf_logo_preview')).not.toBeVisible();
        await expect(page.locator('#remove-logo')).not.toBeVisible();
        console.log('CONF-LOGO-004 PASSED');
    });

    // ── CONF-LOGO-005 ────────────────────────────────────────────────────────
    test.skip('CONF-LOGO-005: Tab Icon Upload (PNG)', async ({ page }) => {
        console.log('Starting CONF-LOGO-005...');

        // The file input id is ctf_small_icon_file
        await page.locator('#ctf_small_icon_file').setInputFiles(LOGO_PNG);

        // Click Upload button in the small icon form
        // Using form scoping to be safe
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'load' }).catch(() => { }),
            page.locator('#small-icon-upload button[type="submit"], #ctf-small-icon-upload button[type="submit"]').click(),
        ]);

        await page.waitForTimeout(2000);
        await goToLogoTab(page);

        const preview = page.locator('#ctf_small_icon_preview');
        await expect(preview).toBeVisible();
        console.log('CONF-LOGO-005 PASSED');
    });

    // ── CONF-LOGO-006 ────────────────────────────────────────────────────────
    test.skip('CONF-LOGO-006: Tab Icon Removal', async ({ page }) => {
        console.log('Starting CONF-LOGO-006...');

        if (!(await page.locator('#remove-small-icon').isVisible())) {
            await page.locator('#ctf_small_icon_file').setInputFiles(LOGO_PNG);
            await page.locator('#small-icon-upload button[type="submit"]').click();
            await page.waitForTimeout(2000);
            await goToLogoTab(page);
        }

        await page.locator('#remove-small-icon').click();
        await expect(page.locator('.modal-content')).toBeVisible();
        await page.locator('.modal-footer button:has-text("Yes")').click();

        await page.waitForTimeout(2000);
        await goToLogoTab(page);

        await expect(page.locator('#ctf_small_icon_preview')).not.toBeVisible();
        console.log('CONF-LOGO-006 PASSED');
    });

    // ── CONF-LOGO-007 ────────────────────────────────────────────────────────
    test.skip('CONF-LOGO-007: Contestant UI Sync – Logo appears in navbar', async ({ page, browser }) => {
        console.log('Starting CONF-LOGO-007...');

        // Upload a logo first
        await page.locator('#ctf_logo_file').setInputFiles(LOGO_JPG);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'load' }).catch(() => { }),
            page.locator('#logo-upload button[type="submit"]').click(),
        ]);
        await page.waitForTimeout(2000);

        // Check contestant portal login page logo
        const contestantPage = await browser.newPage();
        await contestantPage.goto(`${CONTESTANT_URL}/login`, { waitUntil: 'load' });

        // Clear localStorage to bypass the 5-minute cache in configService.ts
        await contestantPage.evaluate(() => localStorage.clear());
        await contestantPage.reload({ waitUntil: 'load' });

        // Login page uses alt="logo"
        const loginLogo = contestantPage.locator('img[alt="logo"]');
        await expect(loginLogo).toBeVisible({ timeout: 15000 });
        const loginSrc = await loginLogo.getAttribute('src');
        expect(loginSrc).toContain('/files/');

        // Now login to see the header logo
        await contestantPage.locator("input[placeholder='input username...']").fill('user2');
        await contestantPage.locator("input[placeholder='enter_password']").fill('1');
        await contestantPage.locator("button[type='submit']").click();
        await contestantPage.waitForURL(/\/(challenges|dashboard)/, { timeout: 15000 });

        // Header uses alt="FCTF Logo"
        const headerLogo = contestantPage.locator('header img[alt="FCTF Logo"]');
        await expect(headerLogo).toBeVisible({ timeout: 15000 });
        const headerSrc = await headerLogo.getAttribute('src');
        expect(headerSrc).toContain('/files/');
        console.log(`Contestant portal logo src: ${headerSrc}`);

        await contestantPage.close();
        console.log('CONF-LOGO-007 PASSED');
    });

    // ── CONF-LOGO-008 ────────────────────────────────────────────────────────
    test('CONF-LOGO-008: Security – Unauthenticated access', async ({ browser }) => {
        console.log('Starting CONF-LOGO-008...');
        const newPage = await browser.newPage();
        await newPage.goto(`${ADMIN_URL}/admin/config`, { waitUntil: 'load' });
        await expect(newPage).toHaveURL(/.*login.*/);
        await newPage.close();
        console.log('CONF-LOGO-008 PASSED');
    });

    // ── CONF-LOGO-009 ────────────────────────────────────────────────────────
    test('CONF-LOGO-009: Cleanup – Restore default state', async ({ page }) => {
        console.log('Cleanup: Removing logo and icon...');

        if (await page.locator('#remove-logo').isVisible()) {
            await page.locator('#remove-logo').click();
            await expect(page.locator('.modal-content')).toBeVisible();
            await page.locator('.modal-footer button:has-text("Yes")').click();
            await page.waitForTimeout(1000);
        }

        if (await page.locator('#remove-small-icon').isVisible()) {
            await page.locator('#remove-small-icon').click();
            await expect(page.locator('.modal-content')).toBeVisible();
            await page.locator('.modal-footer button:has-text("Yes")').click();
            await page.waitForTimeout(1000);
        }

        await expect(page.locator('#ctf_logo_preview')).not.toBeVisible();
        await expect(page.locator('#ctf_small_icon_preview')).not.toBeVisible();
        console.log('CONF-LOGO-009 PASSED');
    });

    // ── CONF-LOGO-011 ────────────────────────────────────────────────────────
    test('CONF-LOGO-011: Security – Malicious file upload prevention', async ({ page }) => {
        console.log('Starting CONF-LOGO-011...');
        const SECURITY_TEST_FILE = path.join(ASSETS_PATH, 'security_test.php');

        // Attempt to upload security_test.php to the logo field
        await page.locator('#ctf_logo_file').setInputFiles(SECURITY_TEST_FILE);

        // Click Upload. We expect either a failure from the backend or the file to be treated as a static image.
        await Promise.all([
            page.waitForResponse(resp => resp.url().includes('/api/v1/configs') || resp.url().includes('/upload')).catch(() => { }),
            page.locator('#logo-upload button[type="submit"]').click(),
        ]);

        await page.waitForTimeout(3000);
        await goToLogoTab(page);

        // Check if the logo preview exists and what its source is
        const preview = page.locator('#ctf_logo_preview');
        if (await preview.isVisible()) {
            const src = await preview.getAttribute('src');
            console.log(`Malicious file was uploaded and is served at: ${src}`);

            // Try to fetch the file and see how it's served
            const response = await page.request.get(ADMIN_URL + src);
            const contentType = response.headers()['content-type'];
            console.log(`Content-Type: ${contentType}`);

            // If the content type is 'application/x-httpd-php' or similar, it's a huge vulnerability.
            // In a secure system, it should be served as 'image/...' or 'application/octet-stream' with no execution.
            expect(contentType).not.toContain('php');

            const body = await response.text();
            // Check if the PHP code is visible in the source (meaning it wasn't executed)
            // or if it executed (unlikely in this setup, but good to check for POC)
            if (body.includes('--- SYSTEM INFORMATION POC ---')) {
                console.log('POC PHP code detected in response body (Not executed - GOOD)');
            } else if (body.includes('PHP Version:')) {
                console.error('CRITICAL: PHP code was EXECUTED (BAD)');
                throw new Error('Security Vulnerability: PHP code execution detected!');
            }
        } else {
            console.log('Malicious file was rejected by the backend (GOOD)');
        }

        console.log('CONF-LOGO-011 PASSED (Safety verified)');
    });
});
