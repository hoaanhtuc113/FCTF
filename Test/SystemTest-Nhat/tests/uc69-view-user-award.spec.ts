import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    createAward,
    deleteAwardsByName,
    getSubmissionSeed,
    loginAsAdmin,
} from "./support";

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

    test("TC69.02 - Bảng award hiển thị đúng cột và dữ liệu khớp award vừa tạo", async ({ page }) => {
        const seed = await getSubmissionSeed(page);
        const token = `UC69_VERIFY_${Date.now()}`;

        try {
            await createAward(page, {
                userId: seed.userId,
                teamId: seed.teamId,
                name: token,
                value: 15,
                description: "Verify columns",
                category: "testing",
                icon: "shield",
            });

            await page.goto(`${BASE_URL}/admin/users/${seed.userId}`, { waitUntil: "domcontentloaded" });
            await page.click("#nav-awards-tab");

            const headerText = await page.locator("#nav-awards thead").textContent();
            expect(headerText).toContain("Name");
            expect(headerText).toContain("Description");
            expect(headerText).toContain("Value");
            expect(headerText).toContain("Category");
            expect(headerText).toContain("Icon");

            // Verify dữ liệu award
            const awardRow = page.locator("#nav-awards tbody tr").filter({ hasText: token });
            await expect(awardRow).toContainText("15");
            await expect(awardRow).toContainText("testing");
        } finally {
            await deleteAwardsByName(page, token);
        }
    });
});