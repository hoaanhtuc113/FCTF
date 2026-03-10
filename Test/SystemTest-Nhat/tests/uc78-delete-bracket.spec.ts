import { test, expect } from "@playwright/test";
import { commitLazyInput, deleteBracketByApi, findConfigBlockByInputValue, getTeams, loginAsAdmin, openAdminConfigTab, openTeamEditModal } from "./support";

test.describe("UC-78 Delete Bracket", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC78.01 - Admin xóa bracket từ trang config", async ({ page }) => {
        const name = `UC78_BRACKET_${Date.now()}`;
        let createdId: number | null = null;
        const targetTeam = (await getTeams(page, 1))[0];

        try {
            await openAdminConfigTab(page, "#brackets");
            await page.click('#brackets button:has-text("Add New Bracket")');

            const block = page.locator("#brackets .border-bottom").last();
            await expect(block).toBeVisible();

            await commitLazyInput(block.locator("input.form-control").nth(0), name);
            await commitLazyInput(block.locator("input.form-control").nth(1), "Bracket to delete");

            const createResponsePromise = page.waitForResponse((response) => {
                return response.url().includes("/api/v1/brackets") && response.request().method() === "POST";
            });

            await block.locator('button:has-text("Save")').click();
            const createResponse = await createResponsePromise;
            const createBody = await createResponse.json();
            createdId = createBody.data.id;

            await openTeamEditModal(page, targetTeam.id);
            await expect(page.locator('#team-info-edit-form select[name="bracket_id"]')).toContainText(name);

            await openAdminConfigTab(page, "#brackets");
            const persistedBlock = await findConfigBlockByInputValue(page, "#brackets", name);
            await expect(persistedBlock).toBeVisible();

            page.once("dialog", (dialog) => dialog.accept());
            const responsePromise = page.waitForResponse((response) => {
                return createdId !== null
                    && response.url().includes(`/api/v1/brackets/${createdId}`)
                    && response.request().method() === "DELETE";
            });

            const deleteButton = persistedBlock.locator("button.close");
            await deleteButton.scrollIntoViewIfNeeded();
            await deleteButton.click({ force: true });
            const deleteResponse = await responsePromise;
            expect(deleteResponse.ok(), "DELETE /api/v1/brackets phải trả về HTTP thành công").toBe(true);

            await openTeamEditModal(page, targetTeam.id);
            await expect(page.locator('#team-info-edit-form select[name="bracket_id"]')).not.toContainText(name);
            createdId = null;
        } finally {
            if (createdId !== null) {
                await deleteBracketByApi(page, createdId);
            }
        }
    });
});