import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    confirmEzQueryModal,
    getSubmissionById,
    getSubmissions,
    loginAsAdmin,
} from "./support";

async function pickExistingSolvedSubmission(page: Parameters<typeof loginAsAdmin>[0]) {
    const submissions = await getSubmissions(page);
    const target = submissions.find((item) => item.type === "correct" && item.teamId && item.id);
    if (!target) {
        throw new Error("Không tìm thấy solved submission có sẵn để thực hiện UC71");
    }
    return target;
}

test.describe("UC-71 Delete Solved Submission", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC71.01 - Admin xóa solved submission từ trang team detail", async ({ page }) => {
        const target = await pickExistingSolvedSubmission(page);

        await page.goto(`${BASE_URL}/admin/teams/${target.teamId}`, { waitUntil: "domcontentloaded" });
        await page.locator(`input[data-submission-id="${target.id}"]`).check();

        const responsePromise = page.waitForResponse((response) => {
            return response.url().includes(`/api/v1/submissions/${target.id}`) && response.request().method() === "DELETE";
        });

        await page.click("#solves-delete-button");
        await confirmEzQueryModal(page);
        await responsePromise;

        await expect.poll(async () => await getSubmissionById(page, target.id)).toBeNull();
    });

    test("TC71.02 - Cancel modal xóa → solved submission vẫn tồn tại", async ({ page }) => {
        const target = await pickExistingSolvedSubmission(page);

        await page.goto(`${BASE_URL}/admin/teams/${target.teamId}`, { waitUntil: "domcontentloaded" });
        await page.locator(`input[data-submission-id="${target.id}"]`).check();
        await page.click("#solves-delete-button");

        const modal = page.locator(".modal.show, .modal.fade.show");
        await expect(modal).toBeVisible();
        const closeButton = modal.locator('button[data-dismiss="modal"], button.close').first();
        await closeButton.click();

        const sub = await getSubmissionById(page, target.id);
        expect(sub).not.toBeNull();
    });
});