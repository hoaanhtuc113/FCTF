import { test, expect } from "@playwright/test";
import { BASE_URL, loginAsAdmin } from "./support";

test.describe("UC-79 View Custom Fields", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
        await page.click('a[href="#fields"]');
    });

    test("TC79.01 - Trang config hiển thị user fields và team fields", async ({ page }) => {
        await expect(page.locator("#fields")).toBeVisible();
        await expect(page.locator("#user-field-list")).toBeVisible();
        await expect(page.locator('a[href="#team-fields"]')).toBeVisible();

        await page.click('a[href="#team-fields"]');
        await expect(page.locator("#team-field-list")).toBeVisible();
    });
});