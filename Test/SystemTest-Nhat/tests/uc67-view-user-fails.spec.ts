import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    createSubmission,
    deleteSubmissionsByProvided,
    getSubmissionSeed,
    loginAsAdmin,
} from "./helpers";

test.describe("UC-67 View User Fails", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC67.01 - Trang chi tiết user hiển thị fail vừa được tạo", async ({ page }) => {
        const seed = await getSubmissionSeed(page);
        const token = `UC67_FAIL_${Date.now()}`;

        try {
            await createSubmission(page, {
                userId: seed.userId,
                teamId: seed.teamId,
                challengeId: seed.challengeId,
                provided: token,
                type: "incorrect",
            });

            await page.goto(`${BASE_URL}/admin/users/${seed.userId}`, { waitUntil: "domcontentloaded" });
            await page.click("#nav-wrong-tab");
            await expect(page.locator("#nav-wrong")).toContainText(token);
        } finally {
            await deleteSubmissionsByProvided(page, token);
        }
    });
});