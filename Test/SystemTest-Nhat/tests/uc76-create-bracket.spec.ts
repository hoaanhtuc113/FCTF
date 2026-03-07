import { test, expect } from "@playwright/test";
import { BASE_URL, deleteBracketByApi, getBrackets, loginAsAdmin } from "./helpers";

test.describe("UC-76 Create Bracket", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC76.01 - Admin tạo bracket mới từ trang config", async ({ page }) => {
        const name = `UC76_BRACKET_${Date.now()}`;
        let createdId: number | null = null;

        try {
            await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
            await page.click('a[href="#brackets"]');
            await page.click('#brackets button:has-text("Add New Bracket")');

            const block = page.locator("#brackets .border-bottom").last();
            await block.locator("input.form-control").nth(0).fill(name);
            await block.locator("input.form-control").nth(1).fill("Bracket created by automation");
            await block.locator("select.custom-select").selectOption("users");

            await block.locator('button:has-text("Save")').click();

            await expect.poll(async () => {
                const brackets = await getBrackets(page);
                const created = brackets.find((item) => item.name === name) ?? null;
                createdId = created?.id ?? null;
                return Boolean(created);
            }).toBeTruthy();
        } finally {
            if (createdId !== null) {
                await deleteBracketByApi(page, createdId);
            }
        }
    });
});