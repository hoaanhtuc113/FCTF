import { test, expect } from "@playwright/test";
import { BASE_URL, loginAsAdmin, openAdminConfigTab } from "./support";

/**
 * UC83 – Config Sanitize (HTML Sanitization toggle)
 *
 * Page: Admin → Config → Security → Sanitize (#sanitize)
 * Element: select[name="html_sanitization"] (true | false)
 * Behavior: Controls whether CTFd sanitizes HTML in user-supplied content.
 *
 * IMPORTANT: afterAll restores the original value to avoid side-effects.
 */

test.describe("UC83 Config Sanitize", () => {
    test.describe.configure({ mode: "serial" });

    let originalValue: string;

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            await loginAsAdmin(page);
            await openAdminConfigTab(page, "#sanitize");
            originalValue = await page.locator('select[name="html_sanitization"]').inputValue();
        } finally {
            await page.close();
        }
    });

    test.afterAll(async ({ browser }) => {
        if (!originalValue) return;
        const page = await browser.newPage();
        try {
            await loginAsAdmin(page);
            await openAdminConfigTab(page, "#sanitize");
            await page.locator('select[name="html_sanitization"]').selectOption(originalValue);
            await Promise.all([
                page.waitForNavigation({ waitUntil: "load", timeout: 30_000 }).catch(() => undefined),
                page.locator('#sanitize button[type="submit"]').click(),
            ]);
        } finally {
            await page.close();
        }
    });

    test.beforeEach(async ({ page }) => {
        test.setTimeout(60_000);
        await loginAsAdmin(page);
    });

    // ─── UI TESTS ────────────────────────────────────────────────────────────

    test("TC83.01 – Sanitize tab hiển thị đúng các thành phần UI", async ({ page }) => {
        await openAdminConfigTab(page, "#sanitize");

        // Tab pane phải visible
        await expect(page.locator("#sanitize")).toBeVisible();

        // Label
        await expect(page.locator('#sanitize label[for="html_sanitization"]')).toContainText("HTML Sanitization");

        // Select dropdown should have at least 1 option (may be locked by config.ini)
        const select = page.locator('select[name="html_sanitization"]');
        await expect(select).toBeVisible();
        const optionCount = await select.locator("option").count();
        expect(optionCount).toBeGreaterThanOrEqual(1);

        // Update button should be visible
        await expect(page.locator('#sanitize button[type="submit"]')).toBeVisible();
        await expect(page.locator('#sanitize button[type="submit"]')).toContainText("Update");
    });

    test("TC83.02 – Dropdown có đủ các option (Enabled / Disabled)", async ({ page }) => {
        await openAdminConfigTab(page, "#sanitize");

        const select = page.locator('select[name="html_sanitization"]');

        // Check if the select is NOT locked by config.ini (has true/false options)
        const forcedOption = select.locator('option:has-text("Required")');
        if (await forcedOption.count() > 0) {
            // Forced mode – only 1 option
            test.skip(true, "HTML sanitization is forced by config.ini; cannot toggle.");
            return;
        }

        const options = await select.locator("option").allTextContents();
        const trimmed = options.map((o) => o.trim());
        expect(trimmed).toContain("Enabled");
        expect(trimmed).toContain("Disabled");
    });

    // ─── FUNCTIONAL TESTS ────────────────────────────────────────────────────

    test("TC83.03 – Bật HTML Sanitization (Enabled → save → reload → verify)", async ({ page }) => {
        await openAdminConfigTab(page, "#sanitize");

        const select = page.locator('select[name="html_sanitization"]');
        const forcedOption = select.locator('option:has-text("Required")');
        if (await forcedOption.count() > 0) {
            test.skip(true, "Forced by config.ini");
            return;
        }

        await select.selectOption("true");
        await Promise.all([
            page.waitForNavigation({ waitUntil: "load", timeout: 30_000 }).catch(() => undefined),
            page.locator('#sanitize button[type="submit"]').click(),
        ]);

        // Reload and verify
        await openAdminConfigTab(page, "#sanitize");
        await expect(page.locator('select[name="html_sanitization"]')).toHaveValue("true");
    });

    test("TC83.04 – Tắt HTML Sanitization (Disabled → save → reload → verify)", async ({ page }) => {
        await openAdminConfigTab(page, "#sanitize");

        const select = page.locator('select[name="html_sanitization"]');
        const forcedOption = select.locator('option:has-text("Required")');
        if (await forcedOption.count() > 0) {
            test.skip(true, "Forced by config.ini");
            return;
        }

        await select.selectOption("false");
        await Promise.all([
            page.waitForNavigation({ waitUntil: "load", timeout: 30_000 }).catch(() => undefined),
            page.locator('#sanitize button[type="submit"]').click(),
        ]);

        // Reload and verify
        await openAdminConfigTab(page, "#sanitize");
        await expect(page.locator('select[name="html_sanitization"]')).toHaveValue("false");
    });

    test("TC83.05 – Toggle Enabled → Disabled → Enabled (round-trip)", async ({ page }) => {
        await openAdminConfigTab(page, "#sanitize");

        const select = page.locator('select[name="html_sanitization"]');
        const forcedOption = select.locator('option:has-text("Required")');
        if (await forcedOption.count() > 0) {
            test.skip(true, "Forced by config.ini");
            return;
        }

        // Set to Enabled
        await select.selectOption("true");
        await Promise.all([
            page.waitForNavigation({ waitUntil: "load", timeout: 30_000 }).catch(() => undefined),
            page.locator('#sanitize button[type="submit"]').click(),
        ]);
        await openAdminConfigTab(page, "#sanitize");
        await expect(page.locator('select[name="html_sanitization"]')).toHaveValue("true");

        // Set to Disabled
        await page.locator('select[name="html_sanitization"]').selectOption("false");
        await Promise.all([
            page.waitForNavigation({ waitUntil: "load", timeout: 30_000 }).catch(() => undefined),
            page.locator('#sanitize button[type="submit"]').click(),
        ]);
        await openAdminConfigTab(page, "#sanitize");
        await expect(page.locator('select[name="html_sanitization"]')).toHaveValue("false");

        // Set back to Enabled
        await page.locator('select[name="html_sanitization"]').selectOption("true");
        await Promise.all([
            page.waitForNavigation({ waitUntil: "load", timeout: 30_000 }).catch(() => undefined),
            page.locator('#sanitize button[type="submit"]').click(),
        ]);
        await openAdminConfigTab(page, "#sanitize");
        await expect(page.locator('select[name="html_sanitization"]')).toHaveValue("true");
    });

    test("TC83.06 – Verify qua API sau khi thay đổi giá trị", async ({ page }) => {
        await openAdminConfigTab(page, "#sanitize");

        const select = page.locator('select[name="html_sanitization"]');
        const forcedOption = select.locator('option:has-text("Required")');
        if (await forcedOption.count() > 0) {
            test.skip(true, "Forced by config.ini");
            return;
        }

        // Set to Disabled
        await select.selectOption("false");
        await Promise.all([
            page.waitForNavigation({ waitUntil: "load", timeout: 30_000 }).catch(() => undefined),
            page.locator('#sanitize button[type="submit"]').click(),
        ]);

        // Verify via API
        const apiResult = await page.evaluate(async () => {
            const resp = await fetch("/api/v1/configs", {
                credentials: "same-origin",
                headers: { Accept: "application/json" },
            });
            return resp.json();
        });

        if (apiResult.success && Array.isArray(apiResult.data)) {
            const sanitizeConfig = apiResult.data.find(
                (c: any) => c.key === "html_sanitization"
            );
            if (sanitizeConfig) {
                // admin2 may return 0 (int) or "false" (string) for disabled
                const valStr = String(sanitizeConfig.value);
                expect(valStr === "false" || valStr === "0").toBe(true);
            }
        }
    });
});
