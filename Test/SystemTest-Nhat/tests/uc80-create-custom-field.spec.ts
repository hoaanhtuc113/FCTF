import { test, expect } from "@playwright/test";
import {
    commitLazyInput,
    deleteCustomFieldByApi,
    getTeams,
    getUsers,
    loginAsAdmin,
    openAdminConfigTab,
    openTeamEditModal,
    openUserEditModal,
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

    test("TC80.02 - Admin tạo custom team field → hiển thị trên team edit form", async ({ page }) => {
        const name = `UC80_TEAM_FIELD_${Date.now()}`;
        let createdId: number | null = null;

        try {
            await openAdminConfigTab(page, "#fields");
            await page.click('a[href="#team-fields"]');
            await page.click('#team-fields button:has-text("Add New Field")');

            const block = page.locator("#team-fields .border-bottom").last();
            await expect(block).toBeVisible();
            await block.locator("select.custom-select").selectOption("text");
            await commitLazyInput(block.locator("input.form-control").nth(0), name);
            await commitLazyInput(block.locator("input.form-control").nth(1), "Team automation field");

            const responsePromise = page.waitForResponse((response) => {
                return response.url().includes("/api/v1/configs/fields") && response.request().method() === "POST";
            });

            const saveButton = block.locator('button:has-text("Save")');
            await saveButton.scrollIntoViewIfNeeded();
            await saveButton.click({ force: true });
            const response = await responsePromise;
            const body = await response.json();
            createdId = body.data.id;

            // Verify trên team edit form
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
            await openAdminConfigTab(page, "#fields");
            await page.click('#user-fields button:has-text("Add New Field")');

            const block = page.locator("#user-fields .border-bottom").last();
            await expect(block).toBeVisible();
            await block.locator("select.custom-select").selectOption("boolean");
            await commitLazyInput(block.locator("input.form-control").nth(0), name);

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