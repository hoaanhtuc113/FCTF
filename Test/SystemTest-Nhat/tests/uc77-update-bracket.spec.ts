import { test, expect } from "@playwright/test";
import {
    getBrackets,
    getTeams,
    loginAsAdmin,
    openTeamEditModal,
    updateBracket,
} from "./support";

test.describe("UC-77 Update Bracket", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC77.01 - Admin cập nhật bracket từ trang config", async ({ page }) => {
        const targetTeam = (await getTeams(page, 1))[0];
        const targetBracket = (await getBrackets(page)).find((bracket) => bracket.type === "teams") ?? null;

        test.skip(targetBracket === null, "Cần ít nhất 1 team bracket có sẵn để test update");

        const originalBracket = {
            id: targetBracket!.id,
            name: targetBracket!.name,
            description: targetBracket!.description,
            type: targetBracket!.type === "users" ? "users" : "teams",
        };
        const updatedName = `${originalBracket.name}_UPDATED_${Date.now()}`;

        try {
            const updateBody = await updateBracket(page, originalBracket.id, {
                name: updatedName,
                description: originalBracket.description,
                type: originalBracket.type,
            });
            expect(updateBody.name).toBe(updatedName);

            await openTeamEditModal(page, targetTeam.id);
            const bracketSelect = page.locator('#team-info-edit-form select[name="bracket_id"]');
            await expect(bracketSelect).toContainText(updatedName);
        } finally {
            await updateBracket(page, originalBracket.id, {
                name: originalBracket.name,
                description: originalBracket.description,
                type: originalBracket.type,
            });

            await openTeamEditModal(page, targetTeam.id);
            await expect(page.locator('#team-info-edit-form select[name="bracket_id"]')).toContainText(originalBracket.name);
        }
    });
});