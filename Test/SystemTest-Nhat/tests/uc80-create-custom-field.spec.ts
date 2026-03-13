import { test, expect } from "@playwright/test";
import {
    clickWithRetry,
    commitLazyInput,
    deleteCustomFieldByApi,
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
        fieldType: "text" | "boolean";
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

    await selectOptionWithRetry(block.locator("select.custom-select").first(), payload.fieldType);
    await commitLazyInput(block.locator("input.form-control").nth(0), payload.name);

    if (payload.description) {
        await commitLazyInput(block.locator("input.form-control").nth(1), payload.description);
    }

    const responsePromise = page.waitForResponse((response) => {
        return response.url().includes("/api/v1/configs/fields") && response.request().method() === "POST";
    });

    await clickWithRetry(block.locator('button:has-text("Save")').first());
    const response = await responsePromise;
    const body = await response.json();

    if (!body?.data?.id) {
        throw new Error(`Không nhận được field id sau khi tạo custom field: ${JSON.stringify(body)}`);
    }

    return body.data.id as number;
}

test.describe("UC-80 Create Custom Field", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC80.01 - Admin tạo custom user field mới từ trang config", async ({ page }) => {
        const name = `UC80_FIELD_${Date.now()}`;
        let createdId: number | null = null;
        const targetUser = (await getUsers(page, 5)).find((user) => user.name !== "admin") ?? (await getUsers(page, 1))[0];

        try {
            createdId = await createCustomFieldFromUi(page, {
                scope: "user",
                fieldType: "text",
                name,
                description: "Automation field description",
            });

            await openUserEditModal(page, targetUser.id);
            await expect(page.locator("#user-info-edit-form")).toContainText(name);
        } finally {
            if (createdId !== null) {
                await deleteCustomFieldByApi(page, createdId);
            }
        }
    });

    test("TC80.02 - Admin tạo custom team field → hiển thị trên team edit form", async ({ page }) => {
        const name = `UC80_TEAM_FIELD_${Date.now()}`;
        let createdId: number | null = null;

        try {
            createdId = await createCustomFieldFromUi(page, {
                scope: "team",
                fieldType: "text",
                name,
                description: "Team automation field",
            });

            const teams = await getTeams(page, 1);
            await openTeamEditModal(page, teams[0].id);
            await expect(page.locator("#team-info-edit-form")).toContainText(name);
        } finally {
            if (createdId !== null) {
                await deleteCustomFieldByApi(page, createdId);
            }
        }
    });

    test("TC80.03 - Admin tạo custom field type boolean → field hiển thị đúng", async ({ page }) => {
        const name = `UC80_BOOL_${Date.now()}`;
        let createdId: number | null = null;
        const targetUser = (await getUsers(page, 5)).find((user) => user.name !== "admin") ?? (await getUsers(page, 1))[0];

        try {
            createdId = await createCustomFieldFromUi(page, {
                scope: "user",
                fieldType: "boolean",
                name,
            });

            await openUserEditModal(page, targetUser.id);
            const form = page.locator("#user-info-edit-form");
            await expect(form).toContainText(name);
            await expect(form.locator('input[type="checkbox"], .custom-control-input').first()).toBeVisible();
        } finally {
            if (createdId !== null) {
                await deleteCustomFieldByApi(page, createdId);
            }
        }
    });

    test("TC80.04 - Admin tạo custom team field type boolean → hiển thị trên team edit form", async ({ page }) => {
        const name = `UC80_TEAM_BOOL_${Date.now()}`;
        let createdId: number | null = null;
        const teams = await getTeams(page, 1);

        try {
            createdId = await createCustomFieldFromUi(page, {
                scope: "team",
                fieldType: "boolean",
                name,
            });

            await openTeamEditModal(page, teams[0].id);
            const form = page.locator("#team-info-edit-form");
            await expect(form).toContainText(name);
            await expect(form.locator('input[type="checkbox"], .custom-control-input').first()).toBeVisible();
        } finally {
            if (createdId !== null) {
                await deleteCustomFieldByApi(page, createdId);
            }
        }
    });

    test("TC80.05 - Tạo liên tiếp user và team custom field đều hiển thị đúng ở form edit", async ({ page }) => {
        const userName = `UC80_BATCH_USER_${Date.now()}`;
        const teamName = `UC80_BATCH_TEAM_${Date.now()}`;
        const createdIds: number[] = [];
        const targetUser = (await getUsers(page, 5)).find((user) => user.name !== "admin") ?? (await getUsers(page, 1))[0];
        const teams = await getTeams(page, 1);

        try {
            createdIds.push(await createCustomFieldFromUi(page, {
                scope: "user",
                fieldType: "text",
                name: userName,
                description: "Batch create user field",
            }));

            createdIds.push(await createCustomFieldFromUi(page, {
                scope: "team",
                fieldType: "text",
                name: teamName,
                description: "Batch create team field",
            }));

            await openUserEditModal(page, targetUser.id);
            await expect(page.locator("#user-info-edit-form")).toContainText(userName);

            await openTeamEditModal(page, teams[0].id);
            await expect(page.locator("#team-info-edit-form")).toContainText(teamName);
        } finally {
            for (const fieldId of createdIds) {
                await deleteCustomFieldByApi(page, fieldId);
            }
        }
    });
});