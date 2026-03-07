import { test, expect } from "playwright/test";
import { BASE_URL, loginAsAdmin } from "./helpers";

test.describe("UC-25 View Instance History", () => {
    test.beforeEach(async ({ page }, testInfo) => {
        testInfo.setTimeout(60_000);
        await loginAsAdmin(page);
        await page.goto(`${BASE_URL}/admin/instances_history`, { waitUntil: "domcontentloaded" });
    });

    test("TC25.01 - Trang Instances History hiển thị đầy đủ tiêu đề và cột", async ({ page }) => {
        await expect(page.locator("h1")).toContainText("Instances History");
        await expect(page.locator("table.clean-table thead")).toContainText("Started At");
        await expect(page.locator("table.clean-table thead")).toContainText("Stopped At");
        await expect(page.locator("table.clean-table thead")).toContainText("Challenge");
        await expect(page.locator("table.clean-table thead")).toContainText("Tracking ID");
    });

    test("TC25.02 - Trang có đầy đủ filter inputs và nút export", async ({ page }) => {
        await expect(page.locator("#user")).toBeVisible();
        await expect(page.locator("#team")).toBeVisible();
        await expect(page.locator("#challenge")).toBeVisible();
        await expect(page.locator("#start")).toBeVisible();
        await expect(page.locator("#end")).toBeVisible();
        await expect(page.locator('a[href*="/admin/instances_history/export/csv"]')).toBeVisible();
    });

    test("TC25.03 - Row có Actions menu hoặc hiển thị empty state hợp lệ", async ({ page }) => {
        const firstRow = page.locator("table.clean-table tbody tr").first();
        await expect(firstRow).toBeVisible();

        const rowText = (await firstRow.textContent()) ?? "";
        if (/No entries found/i.test(rowText)) {
            await expect(firstRow).toContainText("No entries found");
            return;
        }

        const actionsButton = firstRow.locator('button:has-text("Actions")').first();
        await expect(actionsButton).toBeVisible();
    });
});