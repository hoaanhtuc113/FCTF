import { test, expect } from "@playwright/test";
import {
    commitLazyInput,
    deleteCustomFieldByApi,
    getUsers,
    loginAsAdmin,
    openUserEditModal,
    openAdminConfigTab,
} from "./support";

test.describe("UC-80 Create Custom Field", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC80.01 - Admin tạo custom user field mới từ trang config", async ({ page }) => {
        const name = `UC80_FIELD_${Date.now()}`;
        let createdId: number | null = null;
        const targetUser = (await getUsers(page, 5)).find((user) => user.name !== "admin") ?? (await getUsers(page, 1))[0];

        try {
            await openAdminConfigTab(page, "#fields");
            await page.click('#user-fields button:has-text("Add New Field")');

            const block = page.locator("#user-fields .border-bottom").last();
            await expect(block).toBeVisible();
            await block.locator("select.custom-select").selectOption("text");
            await commitLazyInput(block.locator("input.form-control").nth(0), name);
            await commitLazyInput(block.locator("input.form-control").nth(1), "Automation field description");

            const responsePromise = page.waitForResponse((response) => {
                return response.url().includes("/api/v1/configs/fields") && response.request().method() === "POST";
            });

            const saveButton = block.locator('button:has-text("Save")');
            await saveButton.scrollIntoViewIfNeeded();
            await saveButton.click({ force: true });
            const response = await responsePromise;
            const body = await response.json();
            createdId = body.data.id;

            await openUserEditModal(page, targetUser.id);
            await expect(page.locator("#user-info-edit-form")).toContainText(name);
        } finally {
            if (createdId !== null) {
                await deleteCustomFieldByApi(page, createdId);
            }
        }
    });
});