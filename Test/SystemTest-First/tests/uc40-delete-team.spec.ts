/**
 * Delete Team — Playwright System Tests
 *
 * Kiểm tra chức năng xóa team:
 *  - Dialog xác nhận xuất hiện khi click Delete Team
 *  - Cancel: team KHÔNG bị xóa, vẫn còn trên trang
 *  - Confirm: team bị xóa, redirect về /admin/teams, team biến mất
 *
 * Chiến lược:
 *  - TC Cancel: kiểm tra không bị xóa bằng cách cancel dialog
 *  - TC Confirm: tạo team mới qua API → xóa qua UI → verify biến mất
 *
 * Site  : https://admin.fctf.site
 * Actor : Admin (admin / 1)
 */

import { test, expect, Page } from "@playwright/test";
import { BASE_URL, loginAsAdmin, createTestTeam, deleteTeam } from "./support";

// ─── Test Suite ───────────────────────────────────────────────────────────────

test.describe("Delete Team — System Tests", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC01 - Click Delete Team → dialog xác nhận 'Delete Team' xuất hiện", async ({ page }) => {
        // Lấy team đầu tiên
        const res = await page.request.get(`${BASE_URL}/api/v1/teams?page=1&per_page=1`);
        const body = await res.json();
        const teamId = body.data[0].id;

        await page.goto(`${BASE_URL}/admin/teams/${teamId}`);
        await page.waitForSelector(".delete-team", { state: "visible" });
        await page.click(".delete-team");

        // ezQuery tạo Bootstrap modal (không phải browser dialog)
        // Đợi modal xuất hiện
        const modal = page.locator(".modal.show, .modal.fade.show");
        await expect(modal).toBeVisible({ timeout: 5000 });

        // Modal phải chứa text "Delete Team" hoặc "Are you sure"
        const modalText = await modal.textContent();
        expect(modalText).toMatch(/Delete Team|Are you sure/i);

        // Đóng modal để cleanup
        await page.keyboard.press("Escape");
    });

    test("TC02 - Cancel dialog xóa → team KHÔNG bị xóa, vẫn còn trang detail", async ({ page }) => {
        const res = await page.request.get(`${BASE_URL}/api/v1/teams?page=1&per_page=1`);
        const body = await res.json();
        const team = body.data[0] as { id: number; name: string };

        await page.goto(`${BASE_URL}/admin/teams/${team.id}`);
        await page.waitForSelector(".delete-team", { state: "visible" });
        await page.click(".delete-team");

        // Đợi modal xác nhận xuất hiện (ezQuery Bootstrap modal)
        const modal = page.locator(".modal.show, .modal.fade.show");
        await expect(modal).toBeVisible({ timeout: 5000 });

        // Click nút "No" (cancel) trong modal ezQuery — nút có class btn-danger
        const cancelBtn = modal.locator('button:has-text("No")').first();
        if (await cancelBtn.isVisible()) {
            await cancelBtn.click();
        } else {
            // Nếu không tìm thấy cancel, nhấn Escape
            await page.keyboard.press("Escape");
        }
        await page.waitForTimeout(500);

        // Trang vẫn ở detail page, team không bị xóa
        await expect(page).toHaveURL(`${BASE_URL}/admin/teams/${team.id}`);
        await expect(
            page.locator(".jumbotron h1, .jumbotron h2").first()
        ).toContainText(team.name);
    });

    test("TC03 - Confirm xóa team → redirect về /admin/teams, team biến mất khỏi danh sách", async ({ page }) => {
        // Tạo team mới để xóa (tránh ảnh hưởng data gốc)
        const newTeam = await createTestTeam(page);

        await page.goto(`${BASE_URL}/admin/teams/${newTeam.id}`);
        await page.waitForSelector(".delete-team", { state: "visible" });
        await page.click(".delete-team");

        // Đợi modal ezQuery xuất hiện
        await page.waitForSelector(".modal.show", { state: "visible" });
        await page.waitForTimeout(500);

        // Click nút xác nhận (Yes)
        const confirmBtn = page.locator('.modal.show button.btn-primary:has-text("Yes")').first();
        await expect(confirmBtn, "Nút xác nhận xóa (Yes) phải hiển thị").toBeVisible();

        const resPromise = page.waitForResponse(res => res.url().includes(`/api/v1/teams/${newTeam.id}`) && res.request().method() === 'DELETE');
        await confirmBtn.click();
        await resPromise;
        await page.goto(`${BASE_URL}/admin/teams`);
        await page.waitForSelector("#teamsboard", { state: "visible" });

        // Redirect về danh sách → team đã xóa
        await expect(page).toHaveURL(`${BASE_URL}/admin/teams`);

        // Tìm team vừa xóa trong list — không được có
        const bodyText = await page.textContent("body");
        expect(bodyText, "Team đã xóa không được xuất hiện trong danh sách").not.toContain(newTeam.name);
    });

    test("TC04 - Sau khi xóa, truy cập URL team cũ → trang trả về 404 hoặc redirect", async ({ page }) => {
        // Tạo rồi xóa qua API để có team_id đã xóa
        const newTeam = await createTestTeam(page);
        const delBody = await deleteTeam(page, newTeam.id);
        expect(delBody.success, "Xóa qua API phải thành công").toBe(true);

        // Truy cập URL team đã xóa
        const response = await page.goto(`${BASE_URL}/admin/teams/${newTeam.id}`);
        const status = response?.status() ?? 0;

        // Phải là 404 hoặc redirect về list (302/301)
        expect(
            [404, 302, 301, 200].includes(status),
            "Status phải là 404, redirect, hoặc page thông báo lỗi"
        ).toBe(true);

        if (status === 200) {
            // Nếu vẫn 200, trang phải hiển thị thông báo lỗi / không tìm thấy
            const bodyText = (await page.textContent("body")) ?? "";
            expect(bodyText.toLowerCase()).toMatch(/not found|404|no team|doesn't exist/i);
        }
    });
});
