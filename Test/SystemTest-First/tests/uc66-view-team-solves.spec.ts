import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    createSubmission,
    deleteSubmissionsByProvided,
    getSubmissionSeed,
    loginAsAdmin,
} from "./support";

test.describe("UC-66 View Team Solves", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC66.01 - Trang chi tiết team hiển thị solve vừa được tạo", async ({ page }) => {
        const seed = await getSubmissionSeed(page);
        const token = `UC66_SOLVE_${Date.now()}`;

        try {
            await createSubmission(page, {
                userId: seed.userId,
                teamId: seed.teamId,
                challengeId: seed.challengeId,
                provided: token,
                type: "correct",
            });

            await page.goto(`${BASE_URL}/admin/teams/${seed.teamId}`, { waitUntil: "domcontentloaded" });
            await expect(page.locator("#nav-solves")).toContainText(token);
        } finally {
            await deleteSubmissionsByProvided(page, token);
        }
    });

    test("TC66.02 - Bảng solve hiển thị các cột: Challenge, User, Submitted, Category, Value, Time", async ({ page }) => {
        const seed = await getSubmissionSeed(page);
        await page.goto(`${BASE_URL}/admin/teams/${seed.teamId}`, { waitUntil: "domcontentloaded" });

        const headerText = await page.locator("#nav-solves thead").textContent();
        expect(headerText).toContain("Challenge");
        expect(headerText).toContain("User");
        expect(headerText).toContain("Submitted");
        expect(headerText).toContain("Category");
        expect(headerText).toContain("Value");
        expect(headerText).toContain("Time");
    });
});