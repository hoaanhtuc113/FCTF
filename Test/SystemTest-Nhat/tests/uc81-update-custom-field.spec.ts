import { test, expect } from "@playwright/test";
import {
    commitLazyInput,
    findConfigBlockByInputValue,
    getCustomFields,
    loginAsAdmin,
    openAdminConfigTab,
    openUserEditModal,
    updateCustomField,
    getUsers,
} from "./support";

test.describe("UC-81 Update Custom Field", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC81.01 - Admin cập nhật custom field từ trang config", async ({ page }) => {
        const targetField = (await getCustomFields(page, "user"))[0] ?? null;
        const targetUser = (await getUsers(page, 5)).find((user) => user.name !== "admin") ?? (await getUsers(page, 1))[0];

        test.skip(targetField === null, "Cần ít nhất 1 user custom field có sẵn để test update");

        const originalField = {
            id: targetField!.id,
            name: targetField!.name,
            description: targetField!.description,
            editable: targetField!.editable,
            required: targetField!.required,
            public: targetField!.public,
            field_type: targetField!.fieldType,
        };
        const updatedName = `${originalField.name}_UPDATED_${Date.now()}`;
        const updatedDescription = `${originalField.description || originalField.name} updated`;

        try {
            await openAdminConfigTab(page, "#fields");
            const block = await findConfigBlockByInputValue(page, "#user-fields", originalField.name);
            await expect(block).toBeVisible();

            await commitLazyInput(block.locator("input.form-control").nth(0), updatedName);
            await commitLazyInput(block.locator("input.form-control").nth(1), updatedDescription);

            const responsePromise = page.waitForResponse((response) => {
                return response.url().includes(`/api/v1/configs/fields/${originalField.id}`)
                    && response.request().method() === "PATCH";
            });

            const saveButton = block.locator('button:has-text("Save")');
            await saveButton.scrollIntoViewIfNeeded();
            await saveButton.click({ force: true });
            await responsePromise;

            const updatedFields = await getCustomFields(page, "user");
            const updated = updatedFields.find((item) => item.id === originalField.id);
            expect(updated?.name).toBe(updatedName);
            expect(updated?.description).toBe(updatedDescription);

            await openUserEditModal(page, targetUser.id);
            await expect(page.locator("#user-info-edit-form")).toContainText(updatedName);
        } finally {
            await updateCustomField(page, originalField.id, {
                name: originalField.name,
                description: originalField.description,
                field_type: originalField.field_type,
                editable: originalField.editable,
                required: originalField.required,
                public: originalField.public,
            });

            const restoredFields = await getCustomFields(page, "user");
            const restored = restoredFields.find((item) => item.id === originalField.id);
            expect(restored?.name).toBe(originalField.name);
            expect(restored?.description).toBe(originalField.description);
        }
    });
});