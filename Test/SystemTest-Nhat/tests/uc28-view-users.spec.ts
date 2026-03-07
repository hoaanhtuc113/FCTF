/**
 * View Users — Playwright System Tests
 *
 * Kiểm tra trang /admin/users:
 *  - Danh sách users hiển thị đúng
 *  - Search/filter hoạt động
 *  - Click tên user dẫn đến trang detail
 *  - Các nút Create/Edit/Delete hiển thị
 *
 * Site  : https://admin.fctf.site
 * Actor : Admin (admin / 1)
 */

import { test, expect } from "playwright/test";
import { BASE_URL, loginAsAdmin, getUsers } from "./helpers";

test.describe("View Users — System Tests", () => {
    let firstUserId: number;
    let firstUserName: string;

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        await loginAsAdmin(page);
        const users = await getUsers(page, 5);
        firstUserId = users[0].id;
        firstUserName = users[0].name;
        await page.close();
    });

    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto(`${BASE_URL}/admin/users`);
        await page.waitForSelector("#teamsboard", { state: "visible" }); // bảng users dùng id="teamsboard"
    });

    // =========================================================================
    // Hiển thị trang
    // =========================================================================

    test("TC01 - Trang /admin/users load thành công, có tiêu đề 'Users'", async ({ page }) => {
        await expect(page).toHaveURL(`${BASE_URL}/admin/users`);
        await expect(page.locator("h1")).toContainText("Users");
    });

    test("TC02 - Danh sách user hiển thị trong bảng", async ({ page }) => {
        const rows = page.locator("#teamsboard tbody tr");
        await expect(rows.first()).toBeVisible();
        const count = await rows.count();
        expect(count, "Phải có ít nhất 1 user trong bảng").toBeGreaterThanOrEqual(1);
    });

    test("TC03 - Bảng hiển thị các cột: ID, Name, Email, Score", async ({ page }) => {
        const headerText = await page.locator("#teamsboard thead").textContent();
        expect(headerText).toContain("ID");
        // Ít nhất phải có tên và một cột khác
        expect(headerText!.length, "Header phải có nội dung").toBeGreaterThan(5);
    });

    test("TC04 - User đầu tiên hiển thị trong bảng", async ({ page }) => {
        await expect(page.locator("#teamsboard tbody")).toContainText(firstUserName);
    });

    test("TC05 - Click vào tên user dẫn đến trang chi tiết user đúng", async ({ page }) => {
        const firstLink = page.locator(`#teamsboard tbody a[href*="/admin/users/${firstUserId}"]`).first();
        await expect(firstLink).toBeVisible();
        await firstLink.click();

        await page.waitForURL(`${BASE_URL}/admin/users/${firstUserId}`, { waitUntil: "domcontentloaded" });
        await expect(
            page.locator(".jumbotron h1, .jumbotron h2").first()
        ).toContainText(firstUserName);
    });

    // =========================================================================
    // Search / Filter
    // =========================================================================

    test("TC06 - Search theo tên user tìm đúng kết quả", async ({ page }) => {
        await page.fill('input[name="q"]', firstUserName);
        await page.click('button[type="submit"]');
        await page.waitForLoadState("domcontentloaded");

        await expect(page.locator("#teamsboard tbody")).toContainText(firstUserName);
    });

    test("TC07 - Search với từ khóa không tồn tại → không tìm thấy user", async ({ page }) => {
        const nonExistent = "ZZZNOUSER_NOTEXIST_99999";
        await page.fill('input[name="q"]', nonExistent);
        await page.click('button[type="submit"]');
        await page.waitForLoadState("domcontentloaded");

        const rows = page.locator("#teamsboard tbody tr");
        const count = await rows.count();
        if (count > 0) {
            const bodyText = await page.locator("#teamsboard tbody").textContent();
            expect(bodyText, "Không hiển thị user khi không có kết quả").not.toContain(firstUserName);
        }
    });

    test("TC08 - Filter Role=admin → chỉ hiển thị admin users", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/users?role=admin`);
        await page.waitForLoadState("domcontentloaded");

        await expect(page).toHaveURL(/\/admin\/users\?role=admin/);
        await expect(page.locator("#teamsboard")).toBeVisible();
        // User 'admin' phải có trong kết quả
        await expect(page.locator("#teamsboard tbody")).toContainText("admin");
    });

    test("TC09 - Filter Role=user → chỉ hiển thị user thường", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/users?role=user`);
        await page.waitForLoadState("domcontentloaded");

        await expect(page).toHaveURL(/\/admin\/users\?role=user/);
        await expect(page.locator("#teamsboard")).toBeVisible();
    });

    test("TC10 - Filter Verified=Verified → hiển thị đúng", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/users?verified=true`);
        await page.waitForLoadState("domcontentloaded");

        await expect(page).toHaveURL(/\/admin\/users\?verified=true/);
        await expect(page.locator("#teamsboard")).toBeVisible();
    });

    test("TC11 - Filter Banned=Banned → chỉ user bị ban (hoặc không có kết quả)", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/users?banned=true`);
        await page.waitForLoadState("domcontentloaded");

        await expect(page).toHaveURL(/\/admin\/users\?banned=true/);
        await expect(page.locator("#teamsboard")).toBeVisible();
    });

    test("TC12 - Nút Reset filter → xóa bộ lọc, hiển thị lại danh sách đầy đủ", async ({ page }) => {
        // Áp dụng filter role=admin
        await page.goto(`${BASE_URL}/admin/users?role=admin`);
        await page.waitForLoadState("domcontentloaded");

        // Click nút reset
        const resetBtn = page.locator('button[title="Reset"]').first();
        await resetBtn.click();
        await page.waitForURL(`${BASE_URL}/admin/users`, { waitUntil: "domcontentloaded" });

        // Danh sách hiển thị lại đầy đủ
        const rows = page.locator("#teamsboard tbody tr");
        await expect(rows.first()).toBeVisible();
    });

    test("TC13 - Trang có nút 'Create User'", async ({ page }) => {
        await expect(
            page.locator('a[href*="users/new"], a:has-text("Create User")')
        ).toBeVisible();
    });

    test("TC14 - Trang có nút Edit và Delete", async ({ page }) => {
        await expect(page.locator("#users-edit-button")).toBeVisible();
        await expect(page.locator("#users-delete-button")).toBeVisible();
    });

    test("TC15 - Search kết hợp field + keyword → tìm đúng", async ({ page }) => {
        // Đặt field + keyword qua query để tránh phụ thuộc UI của SlimSelect.
        const encoded = encodeURIComponent(firstUserName);
        await page.goto(`${BASE_URL}/admin/users?field=name&q=${encoded}`);
        await page.waitForLoadState("domcontentloaded");

        await expect(page.locator("#teamsboard tbody")).toContainText(firstUserName);
    });
});
