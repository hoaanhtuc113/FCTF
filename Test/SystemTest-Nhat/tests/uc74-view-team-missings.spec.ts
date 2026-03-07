import { test, expect } from "playwright/test";
import { BASE_URL, getSubmissionSeed, loginAsAdmin } from "./helpers";

test.describe("UC-74 View Team Missings", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC74.01 - Trang chi tiết team hiển thị tab Missing và bảng challenge còn thiếu", async ({ page }) => {
        const seed = await getSubmissionSeed(page);

        await page.goto(`${BASE_URL}/admin/teams/${seed.teamId}`, { waitUntil: "domcontentloaded" });
        await page.click("#nav-missing-tab");

        await expect(page.locator("#nav-missing")).toBeVisible();
        await expect(page.locator("#missing-solve-button")).toBeVisible();
        await expect(page.locator("#nav-missing table")).toBeVisible();
    });
});