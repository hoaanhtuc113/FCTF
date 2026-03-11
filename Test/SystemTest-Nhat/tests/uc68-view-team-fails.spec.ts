import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    createSubmission,
    deleteSubmissionsByProvided,
    getSubmissionSeed,
    loginAsAdmin,
} from "./support";

test.describe("UC-68 View Team Fails", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC68.01 - Trang chi tiết team hiển thị fail vừa được tạo", async ({ page }) => {
        const seed = await getSubmissionSeed(page);
        const token = `UC68_FAIL_${Date.now()}`;

        try {
            await createSubmission(page, {
                userId: seed.userId,
                teamId: seed.teamId,
                challengeId: seed.challengeId,
                provided: token,
                type: "incorrect",
            });

            await page.goto(`${BASE_URL}/admin/teams/${seed.teamId}`, { waitUntil: "domcontentloaded" });
            await page.click("#nav-wrong-tab");
            await expect(page.locator("#nav-wrong")).toContainText(token);
        } finally {
            await deleteSubmissionsByProvided(page, token);
        }
    });

    test("TC68.02 - Bảng fail hiển thị các cột: Challenge, User, Submitted, Time", async ({ page }) => {
        const seed = await getSubmissionSeed(page);
        await page.goto(`${BASE_URL}/admin/teams/${seed.teamId}`, { waitUntil: "domcontentloaded" });
        await page.click("#nav-wrong-tab");

        const headerText = await page.locator("#nav-wrong thead").textContent();
        expect(headerText).toContain("Challenge");
        expect(headerText).toContain("User");
        expect(headerText).toContain("Submitted");
        expect(headerText).toContain("Time");
    });
});