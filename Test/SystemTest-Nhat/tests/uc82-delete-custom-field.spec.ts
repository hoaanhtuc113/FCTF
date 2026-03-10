import { test, expect } from "@playwright/test";
import { commitLazyInput, deleteCustomFieldByApi, getCustomFields, loginAsAdmin, openAdminConfigTab } from "./helpers";

test.describe("UC-82 Delete Custom Field", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC82.01 - Admin xóa custom field từ trang config", async ({ page }) => {
        const name = `UC82_FIELD_${Date.now()}`;
        let createdId: number | null = null;

        try {
            await openAdminConfigTab(page, "#fields");
            await page.click('#user-fields button:has-text("Add New Field")');

            const block = page.locator("#user-fields .border-bottom").last();
            await expect(block).toBeVisible();

            await commitLazyInput(block.locator("input.form-control").nth(0), name);
            await commitLazyInput(block.locator("input.form-control").nth(1), "Field to delete");

            const createResponsePromise = page.waitForResponse((response) => {
                return response.url().includes("/api/v1/configs/fields") && response.request().method() === "POST";
            });

            const saveButton = block.locator('button:has-text("Save")');
            await saveButton.scrollIntoViewIfNeeded();
            await saveButton.click({ force: true });
            const createResponse = await createResponsePromise;
            const createBody = await createResponse.json();
            createdId = createBody.data.id;

            page.once("dialog", (dialog) => dialog.accept());
            const responsePromise = page.waitForResponse((response) => {
                return createdId !== null
                    && response.url().includes(`/api/v1/configs/fields/${createdId}`)
                    && response.request().method() === "DELETE";
            });

            const deleteButton = block.locator("button.close");
            await deleteButton.scrollIntoViewIfNeeded();
            await deleteButton.click({ force: true });
            await responsePromise;

            const updatedFields = await getCustomFields(page, "user");
            expect(updatedFields.find((item) => item.id === createdId)).toBeUndefined();
            createdId = null;
        } finally {
            if (createdId !== null) {
                await deleteCustomFieldByApi(page, createdId);
            }
        }
    });
});