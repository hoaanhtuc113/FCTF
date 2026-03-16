import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    confirmEzQueryModal,
    createAward,
    deleteAwardsByName,
    getAwardById,
    getSubmissionSeed,
    loginAsAdmin,
} from "./support";

test.describe("UC-73 Delete Award", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC73.01 - Admin xóa award từ trang team detail", async ({ page }) => {
        const seed = await getSubmissionSeed(page);
        const token = `UC73_AWARD_DELETE_${Date.now()}`;

        try {
            const created = await createAward(page, {
                userId: seed.userId,
                teamId: seed.teamId,
                name: token,
                value: 20,
                description: "Award to delete",
                category: "bonus",
                icon: "shield",
            });

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
        } finally {
            await deleteAwardsByName(page, token);
        }
    });

    test("TC73.02 - Cancel modal xóa → award vẫn tồn tại", async ({ page }) => {
        const seed = await getSubmissionSeed(page);
        const token = `UC73_CANCEL_${Date.now()}`;
        const created = await createAward(page, {
            userId: seed.userId,
            teamId: seed.teamId,
            name: token,
            value: 20,
            description: "Award to cancel delete",
            category: "bonus",
            icon: "shield",
        });

        try {
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
        } finally {
            await deleteAwardsByName(page, token);
        }
    });
});