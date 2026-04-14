import { test, expect } from "@playwright/test";
import { BASE_URL, loginAsAdmin } from "./support";

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

    test("TC75.02 - Bracket list hiển thị brackets hiện có (nếu có) với name và description", async ({ page }) => {
        const bracketBlocks = page.locator("#brackets .border-bottom");
        const blockCount = await bracketBlocks.count();

        if (blockCount > 0) {
            const firstBlock = bracketBlocks.first();
            // Mỗi block có ít nhất 2 input: name và description
            await expect(firstBlock.locator("input.form-control").nth(0)).toBeVisible();
            await expect(firstBlock.locator("input.form-control").nth(1)).toBeVisible();
            // Block có nút Save
            await expect(firstBlock.locator('button:has-text("Save")')).toBeVisible();
        }
    });
});