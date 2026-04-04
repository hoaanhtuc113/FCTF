import { test, expect } from "@playwright/test";
import { BASE_URL, createBracket, deleteBracketByApi, findConfigBlockByInputValue, getBrackets, getTeams, loginAsAdmin, openTeamEditModal } from "./support";

test.describe("UC-78 Delete Bracket", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC78.01 - Admin xóa bracket từ trang config", async ({ page }) => {
        const name = `UC78_BRACKET_${Date.now()}`;
        let createdId: number | null = null;
        const targetTeam = (await getTeams(page, 1))[0];

        try {
            const created = await createBracket(page, {
                name,
                description: "Bracket to delete",
                type: "teams",
            });
            createdId = created.id;

            await openTeamEditModal(page, targetTeam.id);
            await expect(page.locator('#team-info-edit-form select[name="bracket_id"]')).toContainText(name);

            await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
            await page.click('a[href="#brackets"]');
            await expect(page.locator("#brackets")).toBeVisible();
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

            await expect.poll(async () => {
                const brackets = await getBrackets(page);
                return brackets.some((bracket) => bracket.id === createdId);
            }, { timeout: 10_000 }).toBeFalsy();

            await openTeamEditModal(page, targetTeam.id);
            await expect(page.locator('#team-info-edit-form select[name="bracket_id"]')).not.toContainText(name);
            createdId = null;
        } finally {
            if (createdId !== null) {
                await deleteBracketByApi(page, createdId);
            }
        }
    });

    test("TC78.02 - Cancel dialog xóa bracket → bracket vẫn tồn tại", async ({ page }) => {
        const name = `UC78_CANCEL_${Date.now()}`;
        let createdId: number | null = null;

        try {
            const created = await createBracket(page, {
                name,
                description: "Cancel delete test",
                type: "teams",
            });
            createdId = created.id;

            await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
            await page.click('a[href="#brackets"]');
            await expect(page.locator("#brackets")).toBeVisible();

            const persistedBlock = await findConfigBlockByInputValue(page, "#brackets", name);
            await expect(persistedBlock).toBeVisible();

            page.once("dialog", (dialog) => dialog.dismiss());
            const deleteButton = persistedBlock.locator("button.close");
            await deleteButton.scrollIntoViewIfNeeded();
            await deleteButton.click({ force: true });

            await expect.poll(async () => {
                const brackets = await getBrackets(page);
                return brackets.some((bracket) => bracket.id === createdId);
            }, { timeout: 10_000 }).toBeTruthy();

            const brackets = await getBrackets(page);
            const found = brackets.find((bracket) => bracket.id === createdId);
            expect(found, "Bracket phải vẫn tồn tại sau khi cancel dialog").toBeTruthy();
        } finally {
            if (createdId !== null) {
                await deleteBracketByApi(page, createdId);
            }
        }
    });
});