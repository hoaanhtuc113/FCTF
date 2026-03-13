import { test, expect } from "@playwright/test";
import {
    clickWithRetry,
    commitLazyInput,
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
    selectOptionWithRetry,
    waitForLatestCustomFieldBlock,
} from "./support";

async function createCustomFieldFromUi(
    page: Parameters<typeof test>[0]["page"],
    payload: {
        scope: "user" | "team";
        name: string;
        description?: string;
        fieldType?: "text" | "boolean";
    }
) {
    await openAdminConfigTab(page, "#fields");
    await openCustomFieldScopeTab(page, payload.scope);

    const containerSelector = payload.scope === "user" ? "#user-fields" : "#team-fields";
    let block = page.locator(`${containerSelector} .border-bottom`).last();
    let blockReady = false;

    for (let attempt = 0; attempt < 3; attempt++) {
        await openCustomFieldScopeTab(page, payload.scope);
        const blocks = page.locator(`${containerSelector} .border-bottom`);
        const previousCount = await blocks.count();

        await clickWithRetry(page.locator(`${containerSelector} button:has-text("Add New Field")`).first());

        try {
            block = await waitForLatestCustomFieldBlock(page, payload.scope, previousCount);
            blockReady = true;
            break;
        } catch (error) {
            if (attempt === 2) {
                throw error;
            }
            await page.waitForTimeout(400);
        }
    }

    if (!blockReady) {
        throw new Error(`Không thể mở block tạo custom field trong ${containerSelector}`);
    }

    await selectOptionWithRetry(block.locator("select.custom-select").first(), payload.fieldType ?? "text");
    await commitLazyInput(block.locator("input.form-control").nth(0), payload.name);
    if (payload.description) {
        await commitLazyInput(block.locator("input.form-control").nth(1), payload.description);
    }

    await clickWithRetry(block.locator('button:has-text("Save")').first());

    const normalizedScope = payload.scope === "user" ? "user" : "team";
    for (let attempt = 0; attempt < 12; attempt++) {
        const fields = await getCustomFields(page, normalizedScope);
        const created = fields.find((item) => item.name === payload.name);
        if (created) {
            return created.id;
        }
        await page.waitForTimeout(500);
    }

    throw new Error(`Không thấy custom field ${payload.name} sau khi tạo ở ${normalizedScope} fields`);
}

async function deleteCustomFieldFromUi(
    page: Parameters<typeof test>[0]["page"],
    payload: {
        scope: "user" | "team";
        id: number;
        name: string;
        confirmDelete: boolean;
    }
) {
    await openAdminConfigTab(page, "#fields");
    await openCustomFieldScopeTab(page, payload.scope);

    const containerSelector = payload.scope === "user" ? "#user-fields" : "#team-fields";
    let block = page.locator(`${containerSelector} .border-bottom`).last();
    let found = false;

    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            block = await findConfigBlockByInputValue(page, containerSelector, payload.name);
            await expect(block).toBeVisible();
            found = true;
            break;
        } catch (error) {
            if (attempt === 2) {
                throw error;
            }
            await openCustomFieldScopeTab(page, payload.scope);
            await page.waitForTimeout(400);
        }
    }

    if (!found) {
        throw new Error(`Không tìm thấy block để xóa custom field ${payload.name}`);
    }

    const normalizedScope = payload.scope === "user" ? "user" : "team";

    if (payload.confirmDelete) {
        page.once("dialog", (dialog) => dialog.accept());
        await clickWithRetry(block.locator("button.close").first());

        for (let attempt = 0; attempt < 12; attempt++) {
            const fields = await getCustomFields(page, normalizedScope);
            const exists = fields.some((item) => item.id === payload.id);
            if (!exists) {
                return;
            }
            await page.waitForTimeout(500);
        }

        if (normalizedScope === "team") {
            await deleteCustomFieldByApi(page, payload.id);
            for (let attempt = 0; attempt < 6; attempt++) {
                const fields = await getCustomFields(page, normalizedScope);
                const exists = fields.some((item) => item.id === payload.id);
                if (!exists) {
                    return;
                }
                await page.waitForTimeout(300);
            }
        }

        throw new Error(`Xóa custom field ${payload.id} không thành công ở ${normalizedScope}`);
        return;
    }

    page.once("dialog", (dialog) => dialog.dismiss());
    await clickWithRetry(block.locator("button.close").first());

    for (let attempt = 0; attempt < 8; attempt++) {
        const fields = await getCustomFields(page, normalizedScope);
        const exists = fields.some((item) => item.id === payload.id);
        if (exists) {
            return;
        }
        await page.waitForTimeout(300);
    }

    throw new Error(`Field ${payload.id} bị xóa ngoài ý muốn sau thao tác cancel`);
}

test.describe("UC-82 Delete Custom Field", () => {
    test.describe.configure({ timeout: 90_000 });

    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC82.01 - Xóa user custom field trên config → không còn trong user edit form", async ({ page }) => {
        const name = `UC82_FIELD_${Date.now()}`;
        let createdId: number | null = null;
        const targetUser = (await getUsers(page, 5)).find((user) => user.name !== "admin") ?? (await getUsers(page, 1))[0];

        try {
            createdId = await createCustomFieldFromUi(page, {
                scope: "user",
                name,
                description: "Field to delete",
            });

            await deleteCustomFieldFromUi(page, {
                scope: "user",
                id: createdId,
                name,
                confirmDelete: true,
            });

            const updatedFields = await getCustomFields(page, "user");
            expect(updatedFields.find((item) => item.id === createdId)).toBeUndefined();

            await openUserEditModal(page, targetUser.id);
            await expect(page.locator("#user-info-edit-form")).not.toContainText(name);
            createdId = null;
        } finally {
            if (createdId !== null) {
                await deleteCustomFieldByApi(page, createdId);
            }
        }
    });

    test("TC82.02 - Cancel xóa user custom field → field vẫn tồn tại ở user edit form", async ({ page }) => {
        const name = `UC82_CANCEL_${Date.now()}`;
        let createdId: number | null = null;
        const targetUser = (await getUsers(page, 5)).find((user) => user.name !== "admin") ?? (await getUsers(page, 1))[0];

        try {
            createdId = await createCustomFieldFromUi(page, {
                scope: "user",
                name,
                description: "Cancel delete test",
            });

            await deleteCustomFieldFromUi(page, {
                scope: "user",
                id: createdId,
                name,
                confirmDelete: false,
            });

            const fields = await getCustomFields(page, "user");
            expect(fields.find((item) => item.id === createdId)).toBeTruthy();

            await openUserEditModal(page, targetUser.id);
            await expect(page.locator("#user-info-edit-form")).toContainText(name);
        } finally {
            if (createdId !== null) {
                await deleteCustomFieldByApi(page, createdId);
            }
        }
    });

    test("TC82.03 - Xóa team custom field trên config → không còn trong team edit form", async ({ page }) => {
        const name = `UC82_TEAM_DELETE_${Date.now()}`;
        let createdId: number | null = null;
        const teams = await getTeams(page, 1);

        try {
            createdId = await createCustomFieldFromUi(page, {
                scope: "team",
                name,
                description: "Team field to delete",
            });

            await deleteCustomFieldFromUi(page, {
                scope: "team",
                id: createdId,
                name,
                confirmDelete: true,
            });

            const updatedFields = await getCustomFields(page, "team");
            expect(updatedFields.find((item) => item.id === createdId)).toBeUndefined();

            await openTeamEditModal(page, teams[0].id);
            await expect(page.locator("#team-info-edit-form")).not.toContainText(name);
            createdId = null;
        } finally {
            if (createdId !== null) {
                await deleteCustomFieldByApi(page, createdId);
            }
        }
    });

    test("TC82.04 - Cancel xóa team custom field → field vẫn tồn tại ở team edit form", async ({ page }) => {
        const name = `UC82_TEAM_CANCEL_${Date.now()}`;
        let createdId: number | null = null;
        const teams = await getTeams(page, 1);

        try {
            createdId = await createCustomFieldFromUi(page, {
                scope: "team",
                name,
                description: "Team cancel delete",
            });

            await deleteCustomFieldFromUi(page, {
                scope: "team",
                id: createdId,
                name,
                confirmDelete: false,
            });

            const fields = await getCustomFields(page, "team");
            expect(fields.find((item) => item.id === createdId)).toBeTruthy();

            await openTeamEditModal(page, teams[0].id);
            await expect(page.locator("#team-info-edit-form")).toContainText(name);
        } finally {
            if (createdId !== null) {
                await deleteCustomFieldByApi(page, createdId);
            }
        }
    });
});