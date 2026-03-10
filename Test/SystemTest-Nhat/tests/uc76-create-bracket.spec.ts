import { test, expect } from "@playwright/test";
import { BASE_URL, commitLazyInput, deleteBracketByApi, getTeams, loginAsAdmin, openTeamEditModal } from "./support";

test.describe("UC-76 Create Bracket", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC76.01 - Admin tạo bracket mới từ trang config", async ({ page }) => {
        const name = `UC76_BRACKET_${Date.now()}`;
        let createdId: number | null = null;
        const targetTeam = (await getTeams(page, 1))[0];

        try {
            await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
            await page.click('a[href="#brackets"]');
            await page.click('#brackets button:has-text("Add New Bracket")');

            const block = page.locator("#brackets .border-bottom").last();
            await commitLazyInput(block.locator("input.form-control").nth(0), name);
            await commitLazyInput(block.locator("input.form-control").nth(1), "Bracket created by automation");

            const createResponsePromise = page.waitForResponse((response) => {
                return response.url().includes("/api/v1/brackets") && response.request().method() === "POST";
            });

            await block.locator('button:has-text("Save")').click();
            const createResponse = await createResponsePromise;
            const createBody = await createResponse.json();
            createdId = createBody.data?.id ?? null;

            await openTeamEditModal(page, targetTeam.id);
            await expect(page.locator('#team-info-edit-form select[name="bracket_id"]')).toContainText(name);
        } finally {
            if (createdId !== null) {
                await deleteBracketByApi(page, createdId);
            }
        }
    });
});