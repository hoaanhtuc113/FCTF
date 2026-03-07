import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    createAward,
    deleteAwardsByName,
    getSubmissionSeed,
    loginAsAdmin,
} from "./helpers";

test.describe("UC-70 View Team Award", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC70.01 - Trang chi tiết team hiển thị award vừa được tạo", async ({ page }) => {
        const seed = await getSubmissionSeed(page);
        const token = `UC70_AWARD_${Date.now()}`;

        try {
            await createAward(page, {
                userId: seed.userId,
                teamId: seed.teamId,
                name: token,
                value: 10,
                description: "Automation award for UC70",
                category: "bonus",
                icon: "crown",
            });

            await page.goto(`${BASE_URL}/admin/teams/${seed.teamId}`, { waitUntil: "domcontentloaded" });
            await page.click("#nav-awards-tab");
            await expect(page.locator("#nav-awards")).toContainText(token);
        } finally {
            await deleteAwardsByName(page, token);
        }
    });
});