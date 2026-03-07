import { test, expect } from "@playwright/test";
import { BASE_URL, loginAsAdmin } from "./helpers";

test.describe("UC-75 View Brackets", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
        await page.click('a[href="#brackets"]');
    });

    test("TC75.01 - Trang config hiển thị khu vực Scoreboard Brackets", async ({ page }) => {
        await expect(page.locator("#brackets")).toBeVisible();
        await expect(page.locator("#brackets-list")).toBeVisible();
        await expect(page.locator('#brackets button:has-text("Add New Bracket")')).toBeVisible();
    });
});