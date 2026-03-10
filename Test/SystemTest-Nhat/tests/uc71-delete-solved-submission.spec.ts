import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    confirmEzQueryModal,
    createSubmission,
    deleteSubmissionsByProvided,
    getSubmissionById,
    getSubmissionSeed,
    loginAsAdmin,
} from "./support";

test.describe("UC-71 Delete Solved Submission", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC71.01 - Admin xóa solved submission từ trang team detail", async ({ page }) => {
        const seed = await getSubmissionSeed(page);
        const token = `UC71_SOLVE_DELETE_${Date.now()}`;
        const created = await createSubmission(page, {
            userId: seed.userId,
            teamId: seed.teamId,
            challengeId: seed.challengeId,
            provided: token,
            type: "correct",
        });

        try {
            await page.goto(`${BASE_URL}/admin/teams/${seed.teamId}`, { waitUntil: "domcontentloaded" });
            await page.locator(`input[data-submission-id="${created.id}"]`).check();

            const responsePromise = page.waitForResponse((response) => {
                return response.url().includes(`/api/v1/submissions/${created.id}`) && response.request().method() === "DELETE";
            });

            await page.click("#solves-delete-button");
            await confirmEzQueryModal(page);
            await responsePromise;

            await expect.poll(async () => await getSubmissionById(page, created.id)).toBeNull();
        } finally {
            await deleteSubmissionsByProvided(page, token);
        }
    });
});