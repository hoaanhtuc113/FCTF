import { test, expect } from "@playwright/test";
import {
    commitLazyInput,
    createBracket,
    deleteBracketByApi,
    getTeams,
    loginAsAdmin,
    openTeamEditModal,
    updateBracket,
} from "./helpers";

test.describe("UC-77 Update Bracket", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC77.01 - Admin cập nhật bracket từ trang config", async ({ page }) => {
        const originalName = `UC77_BRACKET_${Date.now()}`;
        const updatedName = `${originalName}_UPDATED`;
        let createdId: number | null = null;
        const targetTeam = (await getTeams(page, 1))[0];

        try {
            const created = await createBracket(page, {
                name: originalName,
                description: "Original description",
                type: "teams",
            });
            // store non-null copy for immediate use
            const bracketId = created.id;
            createdId = bracketId;

            const updateBody = await updateBracket(page, bracketId, {
                name: updatedName,
                description: "Original description",
                type: "teams",
            });
            expect(updateBody.name).toBe(updatedName);

            await openTeamEditModal(page, targetTeam.id);
            const bracketSelect = page.locator('#team-info-edit-form select[name="bracket_id"]');
            await expect(bracketSelect).toContainText(updatedName);
        } finally {
            if (createdId !== null) {
                await deleteBracketByApi(page, createdId);
            }
        }
    });
});