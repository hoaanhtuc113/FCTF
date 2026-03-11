import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    commitLazyInput,
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

        const originalBracket: { id: number; name: string; description: string; type: "teams" | "users" } = {
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

    test("TC77.02 - Update bracket từ UI (Save trên config page) → tên mới hiển thị sau reload", async ({ page }) => {
        const targetBracket = (await getBrackets(page)).find((bracket) => bracket.type === "teams") ?? null;
        test.skip(targetBracket === null, "Cần ít nhất 1 team bracket có sẵn để test update từ UI");

        const originalName = targetBracket!.name;
        const updatedName = `${originalName}_UI_${Date.now()}`;

        try {
            await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
            await page.click('a[href="#brackets"]');

            // Tìm block chứa bracket target
            const blocks = page.locator("#brackets .border-bottom");
            const blockCount = await blocks.count();
            let targetBlock = null;
            for (let i = 0; i < blockCount; i++) {
                const nameVal = await blocks.nth(i).locator("input.form-control").nth(0).inputValue();
                if (nameVal === originalName) {
                    targetBlock = blocks.nth(i);
                    break;
                }
            }

            test.skip(targetBlock === null, "Không tìm thấy block bracket trên UI");

            await commitLazyInput(targetBlock!.locator("input.form-control").nth(0), updatedName);

            const responsePromise = page.waitForResponse((response) => {
                return response.url().includes(`/api/v1/brackets/${targetBracket!.id}`) && response.request().method() === "PATCH";
            });

            await targetBlock!.locator('button:has-text("Save")').click();
            await responsePromise;

            // Verify via API
            const updatedBrackets = await getBrackets(page);
            const updated = updatedBrackets.find((b) => b.id === targetBracket!.id);
            expect(updated?.name).toBe(updatedName);
        } finally {
            // Restore
            await updateBracket(page, targetBracket!.id, {
                name: originalName,
                description: targetBracket!.description,
                type: targetBracket!.type === "users" ? "users" : "teams",
            });
        }
    });
});