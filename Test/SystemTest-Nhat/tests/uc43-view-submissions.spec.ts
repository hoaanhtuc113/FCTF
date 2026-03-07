import { test, expect } from "playwright/test";
import { BASE_URL, loginAsAdmin } from "./helpers";

test.describe("UC-43 View Submissions", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto(`${BASE_URL}/admin/submissions`, { waitUntil: "domcontentloaded" });
    });

    test("TC43.01 - Trang Submissions hiển thị heading, bảng và dữ liệu", async ({ page }) => {
        await expect(page.locator("h1")).toContainText("Submissions");
        await expect(page.locator("#teamsboard")).toBeVisible();
        await expect(page.locator("#teamsboard tbody tr").first()).toBeVisible();
    });

    test("TC43.02 - Trang có đầy đủ nhóm filter inputs", async ({ page }) => {
        await expect(page.locator("#team_id")).toBeAttached();
        await expect(page.locator("#user_id")).toBeAttached();
        await expect(page.locator("#challenge_id")).toBeAttached();
        await expect(page.locator("#date_from")).toBeVisible();
        await expect(page.locator("#date_to")).toBeVisible();
        await expect(page.locator('input[name="q"]')).toBeVisible();
    });

    test("TC43.03 - Trang có các action buttons quản trị submissions", async ({ page }) => {
        await expect(page.locator("#correct-flags-button")).toBeVisible();
        await expect(page.locator("#incorrect-flags-button")).toBeVisible();
        await expect(page.locator("#submission-delete-button")).toBeVisible();
        await expect(page.locator("#resync-dynamic-button")).toBeVisible();
        await expect(page.locator('a[href*="/admin/export_submission_data"]')).toBeVisible();
    });
});