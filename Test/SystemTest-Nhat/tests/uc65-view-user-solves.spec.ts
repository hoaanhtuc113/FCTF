import { test, expect } from "playwright/test";
import {
    BASE_URL,
    createSubmission,
    deleteSubmissionsByProvided,
    getSubmissionSeed,
    loginAsAdmin,
} from "./helpers";

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
});