import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    confirmEzQueryModal,
    createAward,
    deleteAwardByApi,
    ensureContestantUser,
    getAwardById,
    getContestantTeamScore,
    getUserByExactName,
    getUserDetailById,
    loginAsAdmin,
    loginContestant,
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

    return {
        userId: user.id,
        teamId: detail.teamId,
    };
}

test.describe("UC-73 Delete Award", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC73.01 - Admin xóa award từ trang team detail", async ({ page }) => {
        const seed = await createContestantSeed(page, "uc73_del");
        let createdId: number | null = null;
        const awardValue = 20;

        try {
            const scoreBefore = await getContestantTeamScore(page);
            const created = await createAward(page, {
                userId: seed.userId,
                teamId: seed.teamId,
                name: `UC73_AWARD_DELETE_${Date.now()}`,
                value: awardValue,
                description: "Award to delete",
                category: "bonus",
                icon: "shield",
            });
            createdId = created.id;

            await page.goto(`${BASE_URL}/admin/teams/${seed.teamId}`, { waitUntil: "domcontentloaded" });
            await page.click("#nav-awards-tab");
            await page.locator(`input[data-award-id="${created.id}"]`).check();

            const responsePromise = page.waitForResponse((response) => {
                return response.url().includes(`/api/v1/awards/${created.id}`) && response.request().method() === "DELETE";
            });

            await page.click("#awards-delete-button");
            await confirmEzQueryModal(page);
            await responsePromise;

            await expect.poll(async () => await getAwardById(page, created.id)).toBeNull();
            await expect.poll(async () => {
                const score = await getContestantTeamScore(page);
                return score.score;
            }).toBe(scoreBefore.score);
        } finally {
            if (createdId) {
                await deleteAwardByApi(page, createdId).catch(() => undefined);
            }
        }
    });

    test("TC73.02 - Cancel modal xóa → award vẫn tồn tại", async ({ page }) => {
        const seed = await createContestantSeed(page, "uc73_cancel");
        let createdId: number | null = null;
        const awardValue = 20;

        try {
            const scoreBefore = await getContestantTeamScore(page);
            const created = await createAward(page, {
                userId: seed.userId,
                teamId: seed.teamId,
                name: `UC73_CANCEL_${Date.now()}`,
                value: awardValue,
                description: "Award to cancel delete",
                category: "bonus",
                icon: "shield",
            });
            createdId = created.id;

            await page.goto(`${BASE_URL}/admin/teams/${seed.teamId}`, { waitUntil: "domcontentloaded" });
            await page.click("#nav-awards-tab");
            await page.locator(`input[data-award-id="${created.id}"]`).check();
            await page.click("#awards-delete-button");

            const modal = page.locator(".modal.show, .modal.fade.show");
            await expect(modal).toBeVisible();
            const closeButton = modal.locator('button[data-dismiss="modal"], button.close').first();
            await closeButton.click();

            const award = await getAwardById(page, created.id);
            expect(award).not.toBeNull();
            await expect.poll(async () => {
                const score = await getContestantTeamScore(page);
                return score.score;
            }).toBe(scoreBefore.score);
        } finally {
            if (createdId) {
                await deleteAwardByApi(page, createdId).catch(() => undefined);
            }
        }
    });
});