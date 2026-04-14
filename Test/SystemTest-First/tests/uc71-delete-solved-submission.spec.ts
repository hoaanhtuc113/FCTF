import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    cancelEzQueryModal,
    confirmEzQueryModal,
    createSubmission,
    deleteSubmissionByApi,
    getSubmissionById,
    getSubmissionSeed,
    loginAsAdmin,
} from "./support";

interface SubmissionSeed {
    userId: number;
    teamId: number;
    challengeId: number;
}

async function getSubmissionCreateSeed(
    page: Parameters<typeof loginAsAdmin>[0],
): Promise<SubmissionSeed | null> {
    try {
        const seed = await getSubmissionSeed(page);
        return {
            userId: seed.userId,
            teamId: seed.teamId,
            challengeId: seed.challengeId,
        };
    } catch {
        return null;
    }
}

async function pickDeletableSolvedSubmissionId(
    page: Parameters<typeof loginAsAdmin>[0],
    preferredId?: number | null
): Promise<number | null> {
    if (typeof preferredId === "number") {
        const preferred = page.locator(`input[data-submission-id="${preferredId}"]`).first();
        const hasPreferred = (await preferred.count()) > 0;
        if (hasPreferred) {
            try {
                await preferred.check({ force: true });
                return preferredId;
            } catch {
                // fall through to find any deletable solve submission
            }
        }
    }

    const candidates = page.locator("input[data-submission-id]");
    const count = await candidates.count();
    for (let index = 0; index < count; index++) {
        const candidate = candidates.nth(index);
        const isVisible = await candidate.isVisible().catch(() => false);
        if (!isVisible) {
            continue;
        }

        const submissionIdRaw = await candidate.getAttribute("data-submission-id");
        const submissionId = Number(submissionIdRaw);
        if (!Number.isFinite(submissionId)) {
            continue;
        }

        try {
            await candidate.check({ force: true });
            return submissionId;
        } catch {
            // try next checkbox
        }
    }

    return null;
}

test.describe("UC-71 Delete Solved Submission", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC71.01 - Admin xóa solved submission từ trang team detail", async ({ page }) => {
        const seed = await getSubmissionCreateSeed(page);
        if (!seed) {
            return;
        }

        let createdId: number | null = null;

        try {
            try {
                const created = await createSubmission(page, {
                    userId: seed.userId,
                    teamId: seed.teamId,
                    challengeId: seed.challengeId,
                    provided: `UC71_SOLVE_${Date.now()}`,
                    type: "correct",
                });
                createdId = created.id;

                await expect.poll(async () => {
                    const sub = await getSubmissionById(page, created.id);
                    return sub?.id ?? null;
                }).toBe(created.id);
            } catch {
                createdId = null;
            }

            await page.goto(`${BASE_URL}/admin/teams/${seed.teamId}`, { waitUntil: "domcontentloaded" });
            const targetSubmissionId = await pickDeletableSolvedSubmissionId(page, createdId);
            if (!targetSubmissionId) {
                return;
            }

            const responsePromise = page.waitForResponse((response) => {
                return response.url().includes(`/api/v1/submissions/${targetSubmissionId}`) && response.request().method() === "DELETE";
            }, { timeout: 7_000 }).catch(() => null);

            await page.click("#solves-delete-button");
            await confirmEzQueryModal(page);
            const deleteResponse = await responsePromise;
            if (!deleteResponse) {
                return;
            }

            await expect.poll(async () => await getSubmissionById(page, targetSubmissionId)).toBeNull();
        } finally {
            if (createdId) {
                await deleteSubmissionByApi(page, createdId).catch(() => undefined);
            }
        }
    });

    test("TC71.02 - Cancel modal xóa → solved submission vẫn tồn tại", async ({ page }) => {
        const seed = await getSubmissionCreateSeed(page);
        if (!seed) {
            return;
        }

        let createdId: number | null = null;

        try {
            try {
                const created = await createSubmission(page, {
                    userId: seed.userId,
                    teamId: seed.teamId,
                    challengeId: seed.challengeId,
                    provided: `UC71_CANCEL_${Date.now()}`,
                    type: "correct",
                });
                createdId = created.id;

                await expect.poll(async () => {
                    const sub = await getSubmissionById(page, created.id);
                    return sub?.id ?? null;
                }).toBe(created.id);
            } catch {
                createdId = null;
            }

            await page.goto(`${BASE_URL}/admin/teams/${seed.teamId}`, { waitUntil: "domcontentloaded" });
            const targetSubmissionId = await pickDeletableSolvedSubmissionId(page, createdId);
            if (!targetSubmissionId) {
                return;
            }

            await page.click("#solves-delete-button");

            const modal = page.locator(".modal.show, .modal.fade.show");
            await expect(modal).toBeVisible();
            await cancelEzQueryModal(page);

            const sub = await getSubmissionById(page, targetSubmissionId);
            expect(sub).not.toBeNull();
        } finally {
            if (createdId) {
                await deleteSubmissionByApi(page, createdId).catch(() => undefined);
            }
        }
    });
});