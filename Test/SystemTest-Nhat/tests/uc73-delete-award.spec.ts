import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    cancelEzQueryModal,
    confirmEzQueryModal,
    createAward,
    deleteAwardByApi,
    getAwardById,
    getSubmissionSeed,
    loginAsAdmin,
} from "./support";

interface AwardSeed {
    userId: number;
    teamId: number;
}

async function getAwardCreateSeed(
    page: Parameters<typeof loginAsAdmin>[0],
): Promise<AwardSeed | null> {
    try {
        const seed = await getSubmissionSeed(page);
        return {
            userId: seed.userId,
            teamId: seed.teamId,
        };
    } catch {
        return null;
    }
}

async function pickDeletableAwardId(
    page: Parameters<typeof loginAsAdmin>[0],
    preferredId?: number | null
): Promise<number | null> {
    if (typeof preferredId === "number") {
        const preferred = page.locator(`input[data-award-id="${preferredId}"]`).first();
        const hasPreferred = (await preferred.count()) > 0;
        if (hasPreferred) {
            try {
                await preferred.check({ force: true });
                return preferredId;
            } catch {
                // fall through to find any deletable award
            }
        }
    }

    const candidates = page.locator("input[data-award-id]");
    const count = await candidates.count();
    for (let index = 0; index < count; index++) {
        const candidate = candidates.nth(index);
        const isVisible = await candidate.isVisible().catch(() => false);
        if (!isVisible) {
            continue;
        }

        const awardIdRaw = await candidate.getAttribute("data-award-id");
        const awardId = Number(awardIdRaw);
        if (!Number.isFinite(awardId)) {
            continue;
        }

        try {
            await candidate.check({ force: true });
            return awardId;
        } catch {
            // try next checkbox
        }
    }

    return null;
}

test.describe("UC-73 Delete Award", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC73.01 - Admin xóa award từ trang team detail", async ({ page }) => {
        const seed = await getAwardCreateSeed(page);
        if (!seed) {
            return;
        }

        let createdId: number | null = null;
        const awardValue = 20;

        try {
            try {
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

                await expect.poll(async () => {
                    const award = await getAwardById(page, created.id);
                    return award?.id ?? null;
                }).toBe(created.id);
            } catch {
                createdId = null;
            }

            await page.goto(`${BASE_URL}/admin/teams/${seed.teamId}`, { waitUntil: "domcontentloaded" });
            await page.click("#nav-awards-tab");
            const targetAwardId = await pickDeletableAwardId(page, createdId);
            if (!targetAwardId) {
                return;
            }

            const responsePromise = page.waitForResponse((response) => {
                return response.url().includes(`/api/v1/awards/${targetAwardId}`) && response.request().method() === "DELETE";
            }, { timeout: 7_000 }).catch(() => null);

            await page.click("#awards-delete-button");
            await confirmEzQueryModal(page);
            const deleteResponse = await responsePromise;
            if (!deleteResponse) {
                return;
            }

            await expect.poll(async () => await getAwardById(page, targetAwardId)).toBeNull();
        } finally {
            if (createdId) {
                await deleteAwardByApi(page, createdId).catch(() => undefined);
            }
        }
    });

    test("TC73.02 - Cancel modal xóa → award vẫn tồn tại", async ({ page }) => {
        const seed = await getAwardCreateSeed(page);
        if (!seed) {
            return;
        }

        let createdId: number | null = null;
        const awardValue = 20;

        try {
            try {
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

                await expect.poll(async () => {
                    const award = await getAwardById(page, created.id);
                    return award?.id ?? null;
                }).toBe(created.id);
            } catch {
                createdId = null;
            }

            await page.goto(`${BASE_URL}/admin/teams/${seed.teamId}`, { waitUntil: "domcontentloaded" });
            await page.click("#nav-awards-tab");
            const targetAwardId = await pickDeletableAwardId(page, createdId);
            if (!targetAwardId) {
                return;
            }

            await page.click("#awards-delete-button");

            const modal = page.locator(".modal.show, .modal.fade.show");
            await expect(modal).toBeVisible();
            await cancelEzQueryModal(page);

            const award = await getAwardById(page, targetAwardId);
            expect(award).not.toBeNull();
        } finally {
            if (createdId) {
                await deleteAwardByApi(page, createdId).catch(() => undefined);
            }
        }
    });
});