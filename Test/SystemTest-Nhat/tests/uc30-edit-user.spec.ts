/**
 * Edit User — Playwright System Tests
 *
 * Kiểm tra form Edit User trong trang admin:
 *  - Invalid input: modal vẫn mở, dữ liệu KHÔNG thay đổi
 *  - Valid input  : trang reload, dữ liệu mới hiển thị trên UI
 *
 * Site  : https://admin.fctf.site
 * Actor : Admin (admin / 1)
 *
 * Lưu ý: edit user KHÔNG có field website/affiliation visible trong form admin,
 * chỉ có name, email, password, type, verified, hidden, banned.
 * Validation rules (từ UserSchema):
 *   - name: required, 1–128 ký tự, không trùng
 *   - email: required, format email, 1–128 ký tự, không trùng
 */

import { test, expect, Page } from "playwright/test";
import {
    BASE_URL,
    SUBMIT_WAIT_MS,
    loginAsAdmin,
    getUsers,
    openUserEditModal,
    UserInfo,
} from "./helpers";

// ─── Helpers cục bộ ──────────────────────────────────────────────────────────

async function fillAndSubmit(page: Page, fieldName: string, value: string) {
    await page.fill(`#user-info-edit-form [name="${fieldName}"]`, value);
    await ensureRequiredUserFields(page);
    await submitUserEditForm(page);
    await page.waitForTimeout(SUBMIT_WAIT_MS);
}

async function ensureRequiredUserFields(page: Page) {
    const bracketSelect = page.locator('#user-info-edit-form select[name="bracket_id"]');
    if (await bracketSelect.count() === 0) {
        return;
    }

    const currentValue = await bracketSelect.inputValue();
    if (currentValue) {
        return;
    }

    const firstValidOption = await bracketSelect.locator("option").evaluateAll((options) => {
        const valid = options.find((option) => {
            if (!(option instanceof HTMLOptionElement)) {
                return false;
            }
            return Boolean(option.value && option.textContent?.trim());
        }) as HTMLOptionElement | undefined;

        return valid ? { value: valid.value, label: valid.textContent?.trim() ?? "" } : null;
    });

    if (!firstValidOption) {
        throw new Error("User edit form requires at least one valid bracket option");
    }

    await bracketSelect.selectOption(firstValidOption.value);
}

async function submitUserEditForm(page: Page) {
    await page.locator("#user-info-edit-form").evaluate((form) => {
        (form as HTMLFormElement).requestSubmit();
    });
}

async function expectModalStillOpen(page: Page) {
    await expect(
        page.locator("#user-info-edit-form"),
        "Modal phải vẫn còn mở — form không được submit thành công"
    ).toBeVisible();
}

async function expectUsernameUnchanged(page: Page, originalName: string) {
    const heading = page.locator(".jumbotron h1, .jumbotron h2").first();
    await expect(heading).toContainText(originalName);
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

test.describe("Edit User — System Tests", () => {
    let targetUser: UserInfo;
    let secondUserName: string | null;

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        await loginAsAdmin(page);
        const users = await getUsers(page, 5);

        // Chọn user KHÔNG phải admin để test (type = "user")
        // Nếu tất cả là admin thì lấy user đầu tiên
        const nonAdmin = users.find((u) => u.name !== "admin");
        targetUser = nonAdmin ?? users[0];
        secondUserName = users.find((u) => u.id !== targetUser.id)?.name ?? null;
        await page.close();
    });

    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        // Đảm bảo dữ liệu gốc luôn mới nhất trước mỗi test (name/email có thể đổi ở test trước).
        await page.goto(`${BASE_URL}/admin/users/${targetUser.id}`);
        const name = await page.locator(".jumbotron h1, .jumbotron h2").first().textContent();
        if (name) targetUser.name = name.trim();

        const email = await page.locator("#team-email").first().textContent();
        if (email) targetUser.email = email.trim();

        await openUserEditModal(page, targetUser.id);
    });

    // =========================================================================
    // INVALID CASES
    // =========================================================================

    test("TC01 - [Invalid] Tên user bị xóa trắng → modal vẫn mở, không cập nhật", async ({ page }) => {
        await page.fill('#user-info-edit-form [name="name"]', "");
        await ensureRequiredUserFields(page);
        await submitUserEditForm(page);
        await page.waitForTimeout(SUBMIT_WAIT_MS);

        await expectModalStillOpen(page);
        await expectUsernameUnchanged(page, targetUser.name);
    });

    test("TC02 - [Invalid] Tên user > 128 ký tự → modal vẫn mở", async ({ page }) => {
        await fillAndSubmit(page, "name", "U".repeat(129));

        await expectModalStillOpen(page);
        await expectUsernameUnchanged(page, targetUser.name);
    });

    test("TC03 - [Invalid] Tên user trùng với user khác → modal vẫn mở", async ({ page }) => {
        test.skip(secondUserName === null, "Cần ít nhất 2 user để test duplicate name");

        await fillAndSubmit(page, "name", secondUserName!);

        await expectModalStillOpen(page);
        await expectUsernameUnchanged(page, targetUser.name);
    });

    test("TC04 - [Invalid] Email bị xóa trắng → modal vẫn mở", async ({ page }) => {
        await page.fill('#user-info-edit-form [name="name"]', targetUser.name);
        await fillAndSubmit(page, "email", "");

        await expectModalStillOpen(page);
        await expectUsernameUnchanged(page, targetUser.name);
    });

    test("TC05 - [Invalid] Email sai định dạng (thiếu @) → modal vẫn mở", async ({ page }) => {
        await page.fill('#user-info-edit-form [name="name"]', targetUser.name);
        await fillAndSubmit(page, "email", "invalidemail.com");

        await expectModalStillOpen(page);
        await expectUsernameUnchanged(page, targetUser.name);
    });

    test("TC06 - [Invalid] Email sai định dạng (@@) → modal vẫn mở", async ({ page }) => {
        await page.fill('#user-info-edit-form [name="name"]', targetUser.name);
        await fillAndSubmit(page, "email", "bad@@format.com");

        await expectModalStillOpen(page);
        await expectUsernameUnchanged(page, targetUser.name);
    });

    test("TC07 - [Invalid] Email thiếu domain → modal vẫn mở", async ({ page }) => {
        await page.fill('#user-info-edit-form [name="name"]', targetUser.name);
        await fillAndSubmit(page, "email", "user@");

        await expectModalStillOpen(page);
        await expectUsernameUnchanged(page, targetUser.name);
    });

    test("TC08 - [Invalid] Email > 128 ký tự → modal vẫn mở", async ({ page }) => {
        await page.fill('#user-info-edit-form [name="name"]', targetUser.name);
        // "a".repeat(120) + "@example.com" length is 132
        const longEmail = "a".repeat(120) + "@example.com";
        await fillAndSubmit(page, "email", longEmail);

        await expectModalStillOpen(page);
        await expectUsernameUnchanged(page, targetUser.name);
    });

    // =========================================================================
    // VALID CASES
    // =========================================================================

    test("TC09 - [Valid] Cập nhật tên user hợp lệ → trang reload, tên mới hiển thị", async ({ page }) => {
        const newName = `AutoUser_${Date.now()}`;

        await ensureRequiredUserFields(page);
        await page.fill('#user-info-edit-form [name="name"]', newName);

        const updateResponsePromise = page.waitForResponse((res) =>
            res.url().includes(`/api/v1/users/${targetUser.id}`) && res.request().method() === "PATCH"
        );
        await submitUserEditForm(page);
        const updateResponse = await updateResponsePromise;
        expect(updateResponse.ok(), "PATCH /api/v1/users phải trả về HTTP thành công").toBe(true);
        await page.waitForLoadState("domcontentloaded");

        await expect(
            page.locator(".jumbotron h1, .jumbotron h2").first(),
            "Tên user mới phải hiển thị sau khi save"
        ).toContainText(newName, { timeout: 10000 });

        await openUserEditModal(page, targetUser.id);
        await ensureRequiredUserFields(page);
        await page.fill('#user-info-edit-form [name="name"]', targetUser.name);
        const restoreResponsePromise = page.waitForResponse((res) =>
            res.url().includes(`/api/v1/users/${targetUser.id}`) && res.request().method() === "PATCH"
        );
        await submitUserEditForm(page);
        const restoreResponse = await restoreResponsePromise;
        expect(restoreResponse.ok(), "Restore user sau test phải trả về HTTP thành công").toBe(true);
        await page.waitForLoadState("domcontentloaded");
        await expect(page.locator(".jumbotron h1, .jumbotron h2").first()).toContainText(targetUser.name);
    });

    test("TC10 - [Valid] Cập nhật email hợp lệ → trang reload thành công", async ({ page }) => {
        const newEmail = `autotest_${Date.now()}@example.com`;

        await ensureRequiredUserFields(page);
        await page.fill('#user-info-edit-form [name="name"]', targetUser.name);
        await page.fill('#user-info-edit-form [name="email"]', newEmail);

        const updateResponsePromise = page.waitForResponse((res) =>
            res.url().includes(`/api/v1/users/${targetUser.id}`) && res.request().method() === "PATCH"
        );
        await submitUserEditForm(page);
        const updateResponse = await updateResponsePromise;
        expect(updateResponse.ok(), "PATCH /api/v1/users phải trả về HTTP thành công").toBe(true);
        await page.waitForLoadState("domcontentloaded");

        await expect(page.locator("#team-email")).toContainText(newEmail, { timeout: 10000 });

        await openUserEditModal(page, targetUser.id);
        await ensureRequiredUserFields(page);
        await page.fill('#user-info-edit-form [name="name"]', targetUser.name);
        await page.fill('#user-info-edit-form [name="email"]', targetUser.email);
        const restoreResponsePromise = page.waitForResponse((res) =>
            res.url().includes(`/api/v1/users/${targetUser.id}`) && res.request().method() === "PATCH"
        );
        await submitUserEditForm(page);
        const restoreResponse = await restoreResponsePromise;
        expect(restoreResponse.ok(), "Restore user sau test phải trả về HTTP thành công").toBe(true);
        await page.waitForLoadState("domcontentloaded");
    });

    test("TC11 - [Valid] Cập nhật tên + email hợp lệ → trang reload, dữ liệu mới hiển thị", async ({ page }) => {
        const newName = `FullUser_${Date.now()}`;
        const newEmail = `fulluser_${Date.now()}@example.com`;

        await ensureRequiredUserFields(page);
        await page.fill('#user-info-edit-form [name="name"]', newName);
        await page.fill('#user-info-edit-form [name="email"]', newEmail);

        const updateResponsePromise = page.waitForResponse((res) =>
            res.url().includes(`/api/v1/users/${targetUser.id}`) && res.request().method() === "PATCH"
        );
        await submitUserEditForm(page);
        const updateResponse = await updateResponsePromise;
        expect(updateResponse.ok(), "PATCH /api/v1/users phải trả về HTTP thành công").toBe(true);
        await page.waitForLoadState("domcontentloaded");

        await expect(page.locator(".jumbotron h1, .jumbotron h2").first()).toContainText(newName, { timeout: 10000 });
        await expect(page.locator("#team-email")).toContainText(newEmail, { timeout: 10000 });

        await openUserEditModal(page, targetUser.id);
        await ensureRequiredUserFields(page);
        await page.fill('#user-info-edit-form [name="name"]', targetUser.name);
        await page.fill('#user-info-edit-form [name="email"]', targetUser.email);
        const restoreResponsePromise = page.waitForResponse((res) =>
            res.url().includes(`/api/v1/users/${targetUser.id}`) && res.request().method() === "PATCH"
        );
        await submitUserEditForm(page);
        const restoreResponse = await restoreResponsePromise;
        expect(restoreResponse.ok(), "Restore user sau test phải trả về HTTP thành công").toBe(true);
        await page.waitForLoadState("domcontentloaded");
        await expect(page.locator(".jumbotron h1, .jumbotron h2").first()).toContainText(targetUser.name);
        await expect(page.locator("#team-email")).toContainText(targetUser.email);
    });
});
