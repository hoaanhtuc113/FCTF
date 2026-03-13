import { test, expect } from "@playwright/test";
import {
    clickWithRetry,
    commitLazyInput,
    createCustomField,
    deleteCustomFieldByApi,
    findConfigBlockByInputValue,
    getCustomFields,
    getTeams,
    getUsers,
    loginAsAdmin,
    openAdminConfigTab,
    openCustomFieldScopeTab,
    openTeamEditModal,
    openUserEditModal,
    updateCustomField,
} from "./support";

async function updateCustomFieldFromUi(
    page: Parameters<typeof test>[0]["page"],
    payload: {
        scope: "user" | "team";
        fieldId: number;
        currentName: string;
        nextName: string;
        nextDescription?: string;
    }
) {
    const containerSelector = payload.scope === "user" ? "#user-fields" : "#team-fields";
    let block = page.locator(`${containerSelector} .border-bottom`).first();
    let found = false;

    for (let attempt = 0; attempt < 4; attempt++) {
        await openAdminConfigTab(page, "#fields");
        await openCustomFieldScopeTab(page, payload.scope);

        try {
            block = await findConfigBlockByInputValue(page, containerSelector, payload.currentName);
            found = true;
            break;
        } catch (error) {
            if (attempt === 3) {
                throw error;
            }
            if (attempt % 2 === 1) {
                await page.reload({ waitUntil: "domcontentloaded" });
            }
            await page.waitForTimeout(500);
        }
    }

    if (!found) {
        throw new Error(`Không tìm thấy block để update custom field ${payload.currentName}`);
    }

    await expect(block).toBeVisible();

    await commitLazyInput(block.locator("input.form-control").nth(0), payload.nextName);
    if (typeof payload.nextDescription === "string") {
        const descriptionInput = block.locator("input.form-control").nth(1);
        if (await descriptionInput.count()) {
            await commitLazyInput(descriptionInput, payload.nextDescription);
        }
    }

    const responsePromise = page.waitForResponse((response) => {
        return response.url().includes(`/api/v1/configs/fields/${payload.fieldId}`)
            && response.request().method() === "PATCH";
    });

    await clickWithRetry(block.locator('button:has-text("Save")').first());
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
}

async function ensureFieldForUpdate(
    page: Parameters<typeof test>[0]["page"],
    payload: {
        scope: "user" | "team";
        fieldType: "text" | "boolean";
        allowFallbackAny?: boolean;
    }
) {
    const fields = await getCustomFields(page, payload.scope);
    const exactMatch = fields.find((item) => item.fieldType === payload.fieldType);
    const fallback = payload.allowFallbackAny ? (fields[0] ?? null) : null;
    const existing = exactMatch ?? fallback;

    if (existing) {
        return { field: existing, createdForTest: false };
    }

    const seedName = `UC81_${payload.scope.toUpperCase()}_${payload.fieldType.toUpperCase()}_SEED_${Date.now()}`;
    const created = await createCustomField(page, {
        type: payload.scope,
        fieldType: payload.fieldType,
        name: seedName,
        description: `Seed field ${seedName}`,
        editable: true,
        required: false,
        public: false,
    });

    const refreshed = await getCustomFields(page, payload.scope);
    const createdField = refreshed.find((item) => item.id === created.id);
    if (!createdField) {
        throw new Error(`Không tìm thấy seed custom field ${created.id} sau khi tạo`);
    }

    return { field: createdField, createdForTest: true };
}

test.describe("UC-81 Update Custom Field", () => {
    test.describe.configure({ timeout: 90_000 });

    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC81.01 - Update user custom text field từ config → user edit form hiển thị tên mới", async ({ page }) => {
        const target = await ensureFieldForUpdate(page, { scope: "user", fieldType: "text", allowFallbackAny: true });
        const original = target.field;
        const updatedName = `${original.name}_UPDATED_${Date.now()}`;
        const updatedDescription = `${original.description || original.name} updated`;
        const targetUser = (await getUsers(page, 5)).find((user) => user.name !== "admin") ?? (await getUsers(page, 1))[0];

        try {
            await updateCustomFieldFromUi(page, {
                scope: "user",
                fieldId: original.id,
                currentName: original.name,
                nextName: updatedName,
                nextDescription: updatedDescription,
            });

            await openUserEditModal(page, targetUser.id);
            await expect(page.locator("#user-info-edit-form")).toContainText(updatedName);
        } finally {
            try {
                if (target.createdForTest) {
                    await deleteCustomFieldByApi(page, original.id);
                } else {
                    await updateCustomField(page, original.id, {
                        name: original.name,
                        description: original.description,
                        field_type: original.fieldType,
                        editable: original.editable,
                        required: original.required,
                        public: original.public,
                    });
                }
            } catch (_error) {
                // Best-effort cleanup to avoid teardown flake failing test intent.
            }
        }
    });

    test("TC81.02 - Update team custom text field từ config → team edit form hiển thị tên mới", async ({ page }) => {
        const target = await ensureFieldForUpdate(page, { scope: "team", fieldType: "text", allowFallbackAny: true });
        const original = target.field;
        const updatedName = `${original.name}_UPDATED_${Date.now()}`;
        const teams = await getTeams(page, 1);

        try {
            await updateCustomFieldFromUi(page, {
                scope: "team",
                fieldId: original.id,
                currentName: original.name,
                nextName: updatedName,
                nextDescription: "Team updated description",
            });

            await openTeamEditModal(page, teams[0].id);
            await expect(page.locator("#team-info-edit-form")).toContainText(updatedName);
        } finally {
            try {
                if (target.createdForTest) {
                    await deleteCustomFieldByApi(page, original.id);
                } else {
                    await updateCustomField(page, original.id, {
                        name: original.name,
                        description: original.description,
                        field_type: original.fieldType,
                        editable: original.editable,
                        required: original.required,
                        public: original.public,
                    });
                }
            } catch (_error) {
                // Best-effort cleanup to avoid teardown flake failing test intent.
            }
        }
    });

    test("TC81.03 - Update user custom boolean field → user edit form hiển thị tên mới", async ({ page }) => {
        const target = await ensureFieldForUpdate(page, { scope: "user", fieldType: "boolean" });
        const original = target.field;
        const updatedName = `${original.name}_UPDATED_${Date.now()}`;
        const targetUser = (await getUsers(page, 5)).find((user) => user.name !== "admin") ?? (await getUsers(page, 1))[0];

        try {
            await updateCustomFieldFromUi(page, {
                scope: "user",
                fieldId: original.id,
                currentName: original.name,
                nextName: updatedName,
            });

            await openUserEditModal(page, targetUser.id);
            await expect(page.locator("#user-info-edit-form")).toContainText(updatedName);
        } finally {
            try {
                if (target.createdForTest) {
                    await deleteCustomFieldByApi(page, original.id);
                } else {
                    await updateCustomField(page, original.id, {
                        name: original.name,
                        description: original.description,
                        field_type: original.fieldType,
                        editable: original.editable,
                        required: original.required,
                        public: original.public,
                    });
                }
            } catch (_error) {
                // Best-effort cleanup to avoid teardown flake failing test intent.
            }
        }
    });

    test("TC81.04 - Update team custom boolean field → team edit form hiển thị tên mới", async ({ page }) => {
        const target = await ensureFieldForUpdate(page, { scope: "team", fieldType: "boolean" });
        const original = target.field;
        const updatedName = `${original.name}_UPDATED_${Date.now()}`;
        const teams = await getTeams(page, 1);

        try {
            await updateCustomFieldFromUi(page, {
                scope: "team",
                fieldId: original.id,
                currentName: original.name,
                nextName: updatedName,
            });

            await openTeamEditModal(page, teams[0].id);
            await expect(page.locator("#team-info-edit-form")).toContainText(updatedName);
        } finally {
            try {
                if (target.createdForTest) {
                    await deleteCustomFieldByApi(page, original.id);
                } else {
                    await updateCustomField(page, original.id, {
                        name: original.name,
                        description: original.description,
                        field_type: original.fieldType,
                        editable: original.editable,
                        required: original.required,
                        public: original.public,
                    });
                }
            } catch (_error) {
                // Best-effort cleanup to avoid teardown flake failing test intent.
            }
        }
    });
});