import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    createAward,
    deleteAwardsByName,
    getSubmissionSeed,
    loginAsAdmin,
} from "./support";

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

    test("TC70.02 - Bảng award team hiển thị đúng cột và dữ liệu khớp", async ({ page }) => {
        const seed = await getSubmissionSeed(page);
        const token = `UC70_VERIFY_${Date.now()}`;

        try {
            await createAward(page, {
                userId: seed.userId,
                teamId: seed.teamId,
                name: token,
                value: 25,
                description: "Verify team award cols",
                category: "bonus",
                icon: "crown",
            });

            await page.goto(`${BASE_URL}/admin/teams/${seed.teamId}`, { waitUntil: "domcontentloaded" });
            await page.click("#nav-awards-tab");

            const headerText = await page.locator("#nav-awards thead").textContent();
            expect(headerText).toContain("Name");
            expect(headerText).toContain("User");
            expect(headerText).toContain("Description");
            expect(headerText).toContain("Value");
            expect(headerText).toContain("Category");
            expect(headerText).toContain("Icon");

            const awardRow = page.locator("#nav-awards tbody tr").filter({ hasText: token });
            await expect(awardRow).toContainText("25");
            await expect(awardRow).toContainText("bonus");
        } finally {
            await deleteAwardsByName(page, token);
        }
    });
});