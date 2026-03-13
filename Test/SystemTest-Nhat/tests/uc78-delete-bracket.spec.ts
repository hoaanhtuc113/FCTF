import { test, expect } from "@playwright/test";
import { BASE_URL, commitLazyInput, deleteBracketByApi, findConfigBlockByInputValue, getTeams, loginAsAdmin, openAdminConfigTab, openTeamEditModal } from "./support";

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

    test("TC78.02 - Cancel dialog xóa bracket → bracket vẫn tồn tại", async ({ page }) => {
        const name = `UC78_CANCEL_${Date.now()}`;
        let createdId: number | null = null;

        try {
            await openAdminConfigTab(page, "#brackets");
            await page.click('#brackets button:has-text("Add New Bracket")');

            const block = page.locator("#brackets .border-bottom").last();
            await expect(block).toBeVisible();

            // Set up response listener BEFORE commitLazyInput so we don't miss the POST
            const createResponsePromise = page.waitForResponse((response) => {
                return response.url().includes("/api/v1/brackets") && response.request().method() === "POST";
            }, { timeout: 10000 }).catch(() => null);

            await commitLazyInput(block.locator("input.form-control").nth(0), name);
            await commitLazyInput(block.locator("input.form-control").nth(1), "Cancel delete test");

            await block.locator('button:has-text("Save")').click();
            const createResponse = await createResponsePromise;

            if (createResponse !== null) {
                const createBody = await createResponse.json().catch(() => ({}));
                createdId = createBody.data?.id ?? null;
            }

            if (createdId === null) {
                // commitLazyInput may have fired POST already — try to find via API
                const brackets = await page.request.get(`${BASE_URL}/api/v1/brackets`);
                const bracketsBody = await brackets.json();
                const found = (bracketsBody.data ?? []).find((b: any) => b.name === name);
                if (found) createdId = found.id;
            }

            if (createdId === null) {
                throw new Error("Không thể tạo bracket để test cancel dialog");
            }

            // Reload the config page to stabilize DOM
            await openAdminConfigTab(page, "#brackets");
            // Extra wait to let the bracket list render
            await page.waitForTimeout(1000);

            const persistedBlock = await findConfigBlockByInputValue(page, "#brackets", name);
            await expect(persistedBlock).toBeVisible();

            // Dismiss dialog (cancel)
            page.once("dialog", (dialog) => dialog.dismiss());
            const deleteButton = persistedBlock.locator("button.close");
            await deleteButton.scrollIntoViewIfNeeded();
            await deleteButton.click({ force: true });

            // Small wait to ensure no DELETE request was sent
            await page.waitForTimeout(1000);

            // Verify bracket vẫn tồn tại qua API
            const brackets = await page.evaluate(async ({ BASE_URL }) => {
                const res = await fetch(`${BASE_URL}/api/v1/brackets`, {
                    headers: { "Content-Type": "application/json" },
                });
                const json = await res.json();
                return json.data;
            }, { BASE_URL: "https://admin.fctf.site" });

            const found = brackets.find((b: any) => b.id === createdId);
            expect(found, "Bracket phải vẫn tồn tại sau khi cancel dialog").toBeTruthy();
        } finally {
            if (createdId !== null) {
                await deleteBracketByApi(page, createdId);
            }
        }
    });
});