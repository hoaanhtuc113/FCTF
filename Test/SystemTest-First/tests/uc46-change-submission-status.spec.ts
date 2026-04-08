import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    confirmEzQueryModal,
    createSubmission,
    deleteSubmissionsByProvided,
    getSubmissionById,
    getSubmissions,
    getSubmissionSeed,
    loginAsAdmin,
} from "./support";

test.describe("UC-46 Change Submission Status", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC46.01 - Mark incorrect submission thành correct", async ({ page }) => {
        const seed = await getSubmissionSeed(page);
        const token = `STATUS_TO_CORRECT_${Date.now()}`;
        const created = await createSubmission(page, {
            userId: seed.userId,
            teamId: seed.teamId,
            challengeId: seed.challengeId,
            provided: token,
            type: "incorrect",
        });

        try {
            await page.goto(`${BASE_URL}/admin/submissions/incorrect?field=provided&q=${encodeURIComponent(token)}`, { waitUntil: "domcontentloaded" });
            const checkbox = page.locator(`input[data-submission-id="${created.id}"]`).first();
            await checkbox.check();

            const responsePromise = page.waitForResponse((response) => {
                return response.url().includes(`/api/v1/submissions/${created.id}`) && response.request().method() === "PATCH";
            });

            await page.click("#correct-flags-button");
            await confirmEzQueryModal(page);
            const response = await responsePromise;
            expect(response.ok()).toBeTruthy();

            // Backend creates a new `correct` (solve) record and marks the
            // original submission as `discard`. Assert by searching for the
            // provided token instead of relying on the original id.
            await expect.poll(async () => {
                const updated = await getSubmissions(page, { q: token, field: "provided" });
                return updated.filter((submission) => submission.type === "correct").length;
            }).toBe(1);
        } finally {
            await deleteSubmissionsByProvided(page, token);
        }
    });

    test("TC46.02 - Mark correct submission thành incorrect", async ({ page }) => {
        const seed = await getSubmissionSeed(page);
        const token = `STATUS_TO_INCORRECT_${Date.now()}`;
        const created = await createSubmission(page, {
            userId: seed.userId,
            teamId: seed.teamId,
            challengeId: seed.challengeId,
            provided: token,
            type: "correct",
        });

        try {
            await page.goto(`${BASE_URL}/admin/submissions/correct?field=provided&q=${encodeURIComponent(token)}`, { waitUntil: "domcontentloaded" });
            const checkbox = page.locator(`input[data-submission-id="${created.id}"]`).first();
            await checkbox.check();

            const responsePromise = page.waitForResponse((response) => {
                return response.url().includes(`/api/v1/submissions/${created.id}`) && response.request().method() === "PATCH";
            });

            await page.click("#incorrect-flags-button");
            await confirmEzQueryModal(page);
            const response = await responsePromise;
            expect(response.ok()).toBeTruthy();

            // The server may create a new incorrect submission record when
            // reverting a solve. Verify by looking up submissions by token.
            await expect.poll(async () => {
                const updated = await getSubmissions(page, { q: token, field: "provided" });
                return {
                    correct: updated.filter((submission) => submission.type === "correct").length,
                    incorrect: updated.filter((submission) => submission.type === "incorrect").length,
                };
            }).toEqual({ correct: 0, incorrect: 1 });
        } finally {
            await deleteSubmissionsByProvided(page, token);
        }
    });

    test("TC46.03 - Modal xác nhận hiển thị đúng khi đổi trạng thái submission", async ({ page }) => {
        const seed = await getSubmissionSeed(page);
        const token = `STATUS_MODAL_${Date.now()}`;
        const created = await createSubmission(page, {
            userId: seed.userId,
            teamId: seed.teamId,
            challengeId: seed.challengeId,
            provided: token,
            type: "incorrect",
        });

        try {
            await page.goto(`${BASE_URL}/admin/submissions/incorrect?field=provided&q=${encodeURIComponent(token)}`, { waitUntil: "domcontentloaded" });
            const checkbox = page.locator(`input[data-submission-id="${created.id}"]`).first();
            await checkbox.check();
            await page.click("#correct-flags-button");

            const modal = page.locator(".modal.show, .modal.fade.show");
            await expect(modal).toBeVisible();
            await expect(modal).toContainText("Correct Submissions");
        } finally {
            await deleteSubmissionsByProvided(page, token);
        }
    });

    test("TC46.04 - Cancel modal xác nhận → submission không thay đổi trạng thái", async ({ page }) => {
        const seed = await getSubmissionSeed(page);
        const token = `STATUS_CANCEL_${Date.now()}`;
        const created = await createSubmission(page, {
            userId: seed.userId,
            teamId: seed.teamId,
            challengeId: seed.challengeId,
            provided: token,
            type: "incorrect",
        });

        try {
            await page.goto(`${BASE_URL}/admin/submissions/incorrect?field=provided&q=${encodeURIComponent(token)}`, { waitUntil: "domcontentloaded" });
            const checkbox = page.locator(`input[data-submission-id="${created.id}"]`).first();
            await checkbox.check();
            await page.click("#correct-flags-button");

            const modal = page.locator(".modal.show, .modal.fade.show");
            await expect(modal).toBeVisible();

            // Đóng modal bằng nút close hoặc dismiss
            const closeButton = modal.locator('button[data-dismiss="modal"], button.close, .btn-secondary, .btn:has-text("Cancel")').first();
            await closeButton.click();

            // Verify submission vẫn là incorrect
            await expect.poll(async () => {
                const submissions = await getSubmissions(page, { page: 1, per_page: 100 });
                const sub = submissions.find((s) => s.provided === token);
                return sub?.type;
            }).toBe("incorrect");
        } finally {
            await deleteSubmissionsByProvided(page, token);
        }
    });


});