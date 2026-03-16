import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    confirmEzQueryModal,
    createSubmission,
    deleteSubmissionByApi,
    ensureContestantUser,
    getContestantChallengeState,
    getSubmissionById,
    getUserByExactName,
    getUserDetailById,
    loginAsAdmin,
    loginContestant,
    pickContestantChallenge,
} from "./support";

const CONTESTANT_PASSWORD = "1";
const CONTESTANT_USERNAME = "user2";
const CONTESTANT_TEAM = "team2";

async function loginContestantWithRetry(
    page: Parameters<typeof loginAsAdmin>[0],
    username: string,
    password: string,
    retries = 5
) {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            await loginContestant(page, username, password);
            return;
        } catch (error) {
            lastError = error;
            const message = String(error);
            const retriable = message.includes("status=522") || message.includes("Timeout") || message.includes("timeout");
            if (!retriable || attempt === retries - 1) {
                throw error;
            }
            await page.waitForTimeout(1500 * (attempt + 1));
        }
    }
    throw lastError;
}

async function createContestantSeed(page: Parameters<typeof loginAsAdmin>[0], prefix: string) {
    await ensureContestantUser(page, CONTESTANT_USERNAME, CONTESTANT_PASSWORD, CONTESTANT_TEAM);
    const user = await getUserByExactName(page, CONTESTANT_USERNAME);
    const detail = await getUserDetailById(page, user.id);

    if (!detail.teamId) {
        throw new Error(`Contestant user ${CONTESTANT_USERNAME} chưa được gán team`);
    }

    await loginContestantWithRetry(page, CONTESTANT_USERNAME, CONTESTANT_PASSWORD);
    const challenge = await pickContestantChallenge(page, { requireUnsolved: true });

    return {
        userId: user.id,
        teamId: detail.teamId,
        challengeId: challenge.id,
    };
}

test.describe("UC-71 Delete Solved Submission", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC71.01 - Admin xóa solved submission từ trang team detail", async ({ page }) => {
        const seed = await createContestantSeed(page, "uc71_del");
        let createdId: number | null = null;

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
                const state = await getContestantChallengeState(page, seed.challengeId);
                return state.solveByMyTeam;
            }).toBe(true);

            await page.goto(`${BASE_URL}/admin/teams/${seed.teamId}`, { waitUntil: "domcontentloaded" });
            await page.locator(`input[data-submission-id="${created.id}"]`).check();

            const responsePromise = page.waitForResponse((response) => {
                return response.url().includes(`/api/v1/submissions/${created.id}`) && response.request().method() === "DELETE";
            });

            await page.click("#solves-delete-button");
            await confirmEzQueryModal(page);
            await responsePromise;

            await expect.poll(async () => await getSubmissionById(page, created.id)).toBeNull();
            await expect.poll(async () => {
                const state = await getContestantChallengeState(page, seed.challengeId);
                return state.solveByMyTeam;
            }).toBe(false);
        } finally {
            if (createdId) {
                await deleteSubmissionByApi(page, createdId).catch(() => undefined);
            }
        }
    });

    test("TC71.02 - Cancel modal xóa → solved submission vẫn tồn tại", async ({ page }) => {
        const seed = await createContestantSeed(page, "uc71_cancel");
        let createdId: number | null = null;

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
                const state = await getContestantChallengeState(page, seed.challengeId);
                return state.solveByMyTeam;
            }).toBe(true);

            await page.goto(`${BASE_URL}/admin/teams/${seed.teamId}`, { waitUntil: "domcontentloaded" });
            await page.locator(`input[data-submission-id="${created.id}"]`).check();
            await page.click("#solves-delete-button");

            const modal = page.locator(".modal.show, .modal.fade.show");
            await expect(modal).toBeVisible();
            const closeButton = modal.locator('button[data-dismiss="modal"], button.close').first();
            await closeButton.click();

            const sub = await getSubmissionById(page, created.id);
            expect(sub).not.toBeNull();
            await expect.poll(async () => {
                const state = await getContestantChallengeState(page, seed.challengeId);
                return state.solveByMyTeam;
            }).toBe(true);
        } finally {
            if (createdId) {
                await deleteSubmissionByApi(page, createdId).catch(() => undefined);
            }
        }
    });
});