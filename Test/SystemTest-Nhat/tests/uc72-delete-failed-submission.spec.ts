import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    confirmEzQueryModal,
    getSubmissionById,
    getSubmissions,
    loginAsAdmin,
} from "./support";

async function pickExistingFailedSubmission(page: Parameters<typeof loginAsAdmin>[0]) {
    const submissions = await getSubmissions(page);
    const target = submissions.find((item) => item.type === "incorrect" && item.teamId && item.id);
    if (!target) {
        throw new Error("Không tìm thấy failed submission có sẵn để thực hiện UC72");
    }
    return target;
}

test.describe("UC-72 Delete Failed Submission", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC72.01 - Admin xóa failed submission từ trang team detail", async ({ page }) => {
        const target = await pickExistingFailedSubmission(page);

        await page.goto(`${BASE_URL}/admin/teams/${target.teamId}`, { waitUntil: "domcontentloaded" });
        await page.click("#nav-wrong-tab");
        await page.locator(`input[data-submission-id="${target.id}"]`).check();

        const responsePromise = page.waitForResponse((response) => {
            return response.url().includes(`/api/v1/submissions/${target.id}`) && response.request().method() === "DELETE";
        });

        await page.click("#fails-delete-button");
        await confirmEzQueryModal(page);
        await responsePromise;

        await expect.poll(async () => await getSubmissionById(page, target.id)).toBeNull();
    });

    test("TC72.02 - Cancel modal xóa → failed submission vẫn tồn tại", async ({ page }) => {
        const target = await pickExistingFailedSubmission(page);

        await page.goto(`${BASE_URL}/admin/teams/${target.teamId}`, { waitUntil: "domcontentloaded" });
        await page.click("#nav-wrong-tab");
        await page.locator(`input[data-submission-id="${target.id}"]`).check();
        await page.click("#fails-delete-button");

        const modal = page.locator(".modal.show, .modal.fade.show");
        await expect(modal).toBeVisible();
        const closeButton = modal.locator('button[data-dismiss="modal"], button.close').first();
        await closeButton.click();

        const sub = await getSubmissionById(page, target.id);
        expect(sub).not.toBeNull();
    });
});