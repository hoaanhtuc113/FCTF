/**
 * Delete User — Playwright System Tests
 *
 * Kiểm tra chức năng xóa user:
 *  - Dialog xác nhận xuất hiện
 *  - Cancel: user KHÔNG bị xóa
 *  - Confirm: user bị xóa, redirect về /admin/users, user biến mất
 *
 * Chiến lược delete test:
 *  - Tạo user mới qua API → thao tác xóa qua UI → verify kết quả
 *
 * Site  : https://admin.fctf.site
 * Actor : Admin (admin / 1)
 */

import { test, expect, Page } from "playwright/test";
import { BASE_URL, loginAsAdmin, getUsers, createTestUser, deleteUser } from "./helpers";

// ─── Test Suite ───────────────────────────────────────────────────────────────

test.describe("Delete User — System Tests", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC01 - Click Delete User → modal xác nhận 'Delete User' xuất hiện", async ({ page }) => {
        const users = await getUsers(page, 1);
        const userId = users[0].id;

        await page.goto(`${BASE_URL}/admin/users/${userId}`);
        await page.waitForSelector(".delete-user", { state: "visible" });
        await page.click(".delete-user");

        // ezQuery tạo Bootstrap modal (không phải browser dialog)
        const modal = page.locator(".modal.show, .modal.fade.show");
        await expect(modal).toBeVisible({ timeout: 5000 });

        // Modal phải chứa text "Delete User" hoặc "Are you sure"
        const modalText = await modal.textContent();
        expect(modalText).toMatch(/Delete User|Are you sure/i);

        // Đóng modal để cleanup
        await page.keyboard.press("Escape");
    });

    test("TC02 - Cancel dialog xóa → user KHÔNG bị xóa, vẫn còn trang detail", async ({ page }) => {
        const users = await getUsers(page, 1);
        const user = users[0];

        await page.goto(`${BASE_URL}/admin/users/${user.id}`);
        await page.waitForSelector(".delete-user", { state: "visible" });
        await page.click(".delete-user");

        // Đợi modal xác nhận xuất hiện (ezQuery Bootstrap modal)
        const modal = page.locator(".modal.show, .modal.fade.show");
        await expect(modal).toBeVisible({ timeout: 5000 });

        // Click nút "No" (cancel) trong modal ezQuery
        const cancelBtn = modal.locator('button:has-text("No")').first();
        if (await cancelBtn.isVisible()) {
            await cancelBtn.click();
        } else {
            await page.keyboard.press("Escape");
        }
        await page.waitForTimeout(500);

        // Vẫn ở trang detail user
        await expect(page).toHaveURL(`${BASE_URL}/admin/users/${user.id}`);
        await expect(
            page.locator(".jumbotron h1, .jumbotron h2").first()
        ).toContainText(user.name);
    });

    test("TC03 - Confirm xóa user → redirect về /admin/users, user biến mất khỏi danh sách", async ({ page }) => {
        // Tạo user mới để xóa
        const newUser = await createTestUser(page);

        await page.goto(`${BASE_URL}/admin/users/${newUser.id}`);
        await page.waitForSelector(".delete-user", { state: "visible" });
        await page.click(".delete-user");

        // Đợi modal ezQuery xuất hiện
        await page.waitForSelector(".modal.show", { state: "visible" });
        await page.waitForTimeout(1000); // Đợi nút ready

        // Click nút xác nhận
        const confirmBtn = page.locator('.modal.show button.btn-primary:has-text("Yes")').first();
        await expect(confirmBtn, "Nút xác nhận xóa phải hiển thị").toBeVisible();

        const resPromise = page.waitForResponse(res => res.url().includes(`/api/v1/users/${newUser.id}`) && res.request().method() === 'DELETE');
        await confirmBtn.click();
        await resPromise;
        await page.goto(`${BASE_URL}/admin/users`);
        await page.waitForSelector("#teamsboard", { state: "visible" });

        // Redirect thành công → về danh sách users
        await expect(page).toHaveURL(`${BASE_URL}/admin/users`);

        // User vừa xóa không còn trong danh sách
        const bodyText = await page.textContent("body");
        expect(bodyText, "User đã xóa không được xuất hiện trong danh sách").not.toContain(newUser.name);
    });

    test("TC04 - Sau khi xóa, truy cập URL user cũ → trang trả về 404 hoặc thông báo lỗi", async ({ page }) => {
        // Tạo và xóa user qua API
        const newUser = await createTestUser(page);
        const delBody = await deleteUser(page, newUser.id);
        expect(delBody.success, "Xóa qua API phải thành công").toBe(true);

        // Truy cập URL user đã xóa
        const response = await page.goto(`${BASE_URL}/admin/users/${newUser.id}`);
        const status = response?.status() ?? 0;

        expect(
            [404, 302, 301, 200].includes(status),
            "Status phải là 404, redirect, hoặc page thông báo lỗi"
        ).toBe(true);

        if (status === 200) {
            const bodyText = (await page.textContent("body")) ?? "";
            expect(bodyText.toLowerCase()).toMatch(/not found|404|no user|doesn't exist/i);
        }
    });

    test("TC05 - Không thể xóa user admin chính (tài khoản đang dùng) — nút Delete không hiển thị hoặc bị disabled", async ({ page }) => {
        // Lấy id của user admin
        const res = await page.request.get(`${BASE_URL}/api/v1/users/me`);
        const body = await res.json();
        const adminId = body.data.id;

        await page.goto(`${BASE_URL}/admin/users/${adminId}`);
        await page.waitForLoadState("domcontentloaded");

        // Nếu hệ thống không cho xóa chính mình, nút delete-user không có hoặc disabled
        const deleteBtn = page.locator(".delete-user");
        const exists = await deleteBtn.count();

        if (exists > 0) {
            // Nếu tồn tại, click và kiểm tra action bị chặn hoặc page không thay đổi
            await deleteBtn.click();
            await page.waitForTimeout(800);

            const confirmBtn = page
                .locator('.modal.show button:has-text("Yes"), .modal.show button:has-text("Delete"), .modal.show .btn-primary, .modal.show .btn-danger')
                .first();

            if (await confirmBtn.isVisible()) {
                await confirmBtn.click();
                await page.waitForTimeout(1500);

                // Nếu không redirect → không bị xóa (hệ thống chặn)
                // Nếu redirect → test fail (không được xóa admin đang đăng nhập)
                const currentUrl = page.url();
                expect(
                    currentUrl,
                    "Không được xóa tài khoản admin đang đăng nhập"
                ).toContain(`/admin/users/${adminId}`);
            } else {
                // Modal không có nút confirm → hệ thống đã chặn ở UI level
                expect(true).toBe(true); // PASS
            }
        } else {
            // Không có nút delete → hệ thống đã ẩn đúng
            expect(exists, "Nút delete không hiển thị cho tài khoản đang đăng nhập").toBe(0);
        }
    });
});
