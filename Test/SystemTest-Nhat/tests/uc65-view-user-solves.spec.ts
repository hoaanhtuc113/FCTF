import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    createSubmission,
    deleteSubmissionsByProvided,
    getSubmissionSeed,
    loginAsAdmin,
} from "./support";

test.describe("UC-65 View User Solves", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC65.01 - Trang chi tiết user hiển thị solve vừa được tạo", async ({ page }) => {
        const seed = await getSubmissionSeed(page);
        const token = `UC65_SOLVE_${Date.now()}`;

        try {
            await createSubmission(page, {
                userId: seed.userId,
                teamId: seed.teamId,
                challengeId: seed.challengeId,
                provided: token,
                type: "correct",
            });

            await page.goto(`${BASE_URL}/admin/users/${seed.userId}`, { waitUntil: "domcontentloaded" });
            await expect(page.locator("#nav-solves")).toContainText(token);
        } finally {
            await deleteSubmissionsByProvided(page, token);
        }
    });

    test("TC65.02 - Bảng solve hiển thị các cột: Challenge, Submitted, Category, Value, Time", async ({ page }) => {
        const seed = await getSubmissionSeed(page);
        await page.goto(`${BASE_URL}/admin/users/${seed.userId}`, { waitUntil: "domcontentloaded" });

        const headerText = await page.locator("#nav-solves thead").textContent();
        expect(headerText).toContain("Challenge");
        expect(headerText).toContain("Submitted");
        expect(headerText).toContain("Category");
        expect(headerText).toContain("Value");
        expect(headerText).toContain("Time");
    });
});