import { test, expect } from "playwright/test";
import {
    BASE_URL,
    cancelEzQueryModal,
    confirmEzQueryModal,
    createSubmission,
    deleteSubmissionsByProvided,
    getSubmissionById,
    getSubmissionSeed,
    loginAsAdmin,
} from "./helpers";

test.describe("UC-44 Delete Submission", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC44.01 - Click Delete mở modal xác nhận xóa submission", async ({ page }) => {
        const seed = await getSubmissionSeed(page);
        const token = `DELETE_MODAL_${Date.now()}`;
        const created = await createSubmission(page, {
            userId: seed.userId,
            teamId: seed.teamId,
            challengeId: seed.challengeId,
            provided: token,
            type: "incorrect",
        });

        try {
            await page.goto(`${BASE_URL}/admin/submissions?field=id&q=${created.id}`, { waitUntil: "domcontentloaded" });
            const targetCheckbox = page.locator(`input[data-submission-id="${created.id}"]`).first();
            await targetCheckbox.check();
            await page.click("#submission-delete-button");

            const modal = page.locator(".modal.show, .modal.fade.show");
            await expect(modal).toBeVisible();
            await expect(modal).toContainText("Delete Submission");
            await cancelEzQueryModal(page);
        } finally {
            await deleteSubmissionsByProvided(page, token);
        }
    });

    test("TC44.02 - Cancel xóa thì submission vẫn còn", async ({ page }) => {
        const seed = await getSubmissionSeed(page);
        const token = `DELETE_CANCEL_${Date.now()}`;
        const created = await createSubmission(page, {
            userId: seed.userId,
            teamId: seed.teamId,
            challengeId: seed.challengeId,
            provided: token,
            type: "incorrect",
        });

        try {
            await page.goto(`${BASE_URL}/admin/submissions?field=id&q=${created.id}`, { waitUntil: "domcontentloaded" });
            const targetCheckbox = page.locator(`input[data-submission-id="${created.id}"]`).first();
            await targetCheckbox.check();
            await page.click("#submission-delete-button");
            await cancelEzQueryModal(page);

            const existing = await getSubmissionById(page, created.id);
            expect(existing).not.toBeNull();
        } finally {
            await deleteSubmissionsByProvided(page, token);
        }
    });

    test("TC44.03 - Confirm xóa thì submission biến mất khỏi hệ thống", async ({ page }) => {
        const seed = await getSubmissionSeed(page);
        const token = `DELETE_CONFIRM_${Date.now()}`;
        const created = await createSubmission(page, {
            userId: seed.userId,
            teamId: seed.teamId,
            challengeId: seed.challengeId,
            provided: token,
            type: "incorrect",
        });

        try {
            await page.goto(`${BASE_URL}/admin/submissions?field=id&q=${created.id}`, { waitUntil: "domcontentloaded" });
            const targetCheckbox = page.locator(`input[data-submission-id="${created.id}"]`).first();
            await targetCheckbox.check();

            const responsePromise = page.waitForResponse((response) => {
                return response.url().includes(`/api/v1/submissions/${created.id}`) && response.request().method() === "DELETE";
            });

            await page.click("#submission-delete-button");
            await confirmEzQueryModal(page);
            await responsePromise;

            const deleted = await getSubmissionById(page, created.id);
            expect(deleted).toBeNull();
        } finally {
            await deleteSubmissionsByProvided(page, token);
        }
    });
});