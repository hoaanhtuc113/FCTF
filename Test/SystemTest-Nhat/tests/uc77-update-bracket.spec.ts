import { test, expect } from "@playwright/test";
import {
    commitLazyInput,
    createBracket,
    deleteBracketByApi,
    getUsers,
    loginAsAdmin,
    openUserEditModal,
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
        const targetUser = (await getUsers(page, 5)).find((user) => user.name !== "admin") ?? (await getUsers(page, 1))[0];

        try {
            const created = await createBracket(page, {
                name: originalName,
                description: "Original description",
                type: "users",
            });
            // store non-null copy for immediate use
            const bracketId = created.id;
            createdId = bracketId;

            const updateBody = await updateBracket(page, bracketId, {
                name: updatedName,
                description: "Original description",
                type: "users",
            });
            expect(updateBody.name).toBe(updatedName);

            await openUserEditModal(page, targetUser.id);
            const bracketSelect = page.locator('#user-info-edit-form select[name="bracket_id"]');
            await expect(bracketSelect).toContainText(updatedName);
        } finally {
            if (createdId !== null) {
                await deleteBracketByApi(page, createdId);
            }
        }
    });
});