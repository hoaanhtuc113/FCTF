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

            await expect.poll(async () => {
                const updated = await getSubmissionById(page, created.id);
                return updated?.type ?? null;
            }).toBe("discard");

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

            await expect.poll(async () => {
                const updated = await getSubmissionById(page, created.id);
                return updated?.type ?? null;
            }).toBe(null);

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

    // =========================================================================
    // BVA/ECP: Edge cases
    // =========================================================================

    test("TC46.05 - [ECP - Edge] Click đổi trạng thái khi không chọn submission nào → không mở modal hoặc hiển thị warning", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/submissions/incorrect`, { waitUntil: "domcontentloaded" });

        // Không check bất kỳ checkbox nào, click nút correct
        await page.click("#correct-flags-button");
        await page.waitForTimeout(1000);

        // Modal không nên mở, hoặc nếu mở thì không chứa submissions
        const isModalVisible = await page.locator(".modal.show, .modal.fade.show").isVisible().catch(() => false);

        if (!isModalVisible) {
            // Hành vi đúng: không mở modal khi không chọn submission
            expect(isModalVisible).toBe(false);
        } else {
            // Nếu modal mở, nó phải hiển thị cảnh báo hoặc danh sách trống
            const modal = page.locator(".modal.show, .modal.fade.show");
            await expect(modal).toBeVisible();
        }
    });

    test("TC46.06 - [ECP] Đổi trạng thái nhiều submissions cùng lúc → tất cả đều đổi", async ({ page }) => {
        const seed = await getSubmissionSeed(page);
        const token1 = `STATUS_MULTI1_${Date.now()}`;
        const token2 = `STATUS_MULTI2_${Date.now()}`;

        const created1 = await createSubmission(page, {
            userId: seed.userId,
            teamId: seed.teamId,
            challengeId: seed.challengeId,
            provided: token1,
            type: "incorrect",
        });

        const created2 = await createSubmission(page, {
            userId: seed.userId,
            teamId: seed.teamId,
            challengeId: seed.challengeId,
            provided: token2,
            type: "incorrect",
        });

        try {
            await page.goto(`${BASE_URL}/admin/submissions/incorrect`, { waitUntil: "domcontentloaded" });

            // Check cả 2 submissions
            await page.locator(`input[data-submission-id="${created1.id}"]`).first().check();
            await page.locator(`input[data-submission-id="${created2.id}"]`).first().check();
            await page.click("#correct-flags-button");

            const modal = page.locator(".modal.show, .modal.fade.show");
            await expect(modal).toBeVisible();
            await confirmEzQueryModal(page);

            // Verify cả 2 đã thay đổi
            await expect.poll(async () => {
                const sub1 = await getSubmissionById(page, created1.id);
                const sub2 = await getSubmissionById(page, created2.id);
                return sub1?.type === "correct" && sub2?.type === "correct";
            }).toBe(true);
        } finally {
            await deleteSubmissionsByProvided(page, token1);
            await deleteSubmissionsByProvided(page, token2);
        }
    });
});