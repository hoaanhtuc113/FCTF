import { test, expect } from "playwright/test";
import {
    BASE_URL,
    createAward,
    deleteAwardsByName,
    getSubmissionSeed,
    loginAsAdmin,
} from "./helpers";

test.describe("UC-69 View User Award", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC69.01 - Trang chi tiết user hiển thị award vừa được tạo", async ({ page }) => {
        const seed = await getSubmissionSeed(page);
        const token = `UC69_AWARD_${Date.now()}`;

        try {
            await createAward(page, {
                userId: seed.userId,
                teamId: seed.teamId,
                name: token,
                value: 5,
                description: "Automation award for UC69",
                category: "bonus",
                icon: "shield",
            });

            await page.goto(`${BASE_URL}/admin/users/${seed.userId}`, { waitUntil: "domcontentloaded" });
            await page.click("#nav-awards-tab");
            await expect(page.locator("#nav-awards")).toContainText(token);
        } finally {
            await deleteAwardsByName(page, token);
        }
    });
});