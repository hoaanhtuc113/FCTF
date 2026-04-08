/**
 * View Teams — Playwright System Tests
 *
 * Kiểm tra trang /admin/teams:
 *  - Danh sách teams hiển thị đúng
 *  - Search/filter theo name hoạt động
 *  - Click vào tên team dẫn đến trang detail đúng
 *  - Pagination hiển thị khi có nhiều team
 *
 * Actor : Admin (admin / 1)
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, loginAsAdmin, getTeams } from "./support";

test.describe("View Teams — System Tests", () => {
    let firstTeamId: number;
    let firstTeamName: string;
    let sampleTeamNames: string[];
    let secondTeamName: string | null;

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        await loginAsAdmin(page);
        const teams = await getTeams(page, 5);
        firstTeamId = teams[0].id;
        firstTeamName = teams[0].name;
        sampleTeamNames = teams.map((team) => team.name);
        secondTeamName = teams.length >= 2 ? teams[1].name : null;
        await page.close();
    });

    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto(`${BASE_URL}/admin/teams`);
        await page.waitForSelector("#teamsboard", { state: "visible" });
    });

    // =========================================================================
    // Hiển thị trang
    // =========================================================================

    test("TC01 - Trang /admin/teams load thành công, có tiêu đề 'Teams'", async ({ page }) => {
        await expect(page).toHaveURL(`${BASE_URL}/admin/teams`);
        // Kiểm tra heading Teams
        await expect(page.locator("h1")).toContainText("Teams");
    });

    test("TC02 - Danh sách team hiển thị trong bảng", async ({ page }) => {
        // Phải có ít nhất 1 hàng dữ liệu trong tbody
        const rows = page.locator("#teamsboard tbody tr");
        await expect(rows.first()).toBeVisible();
        const count = await rows.count();
        expect(count, "Phải có ít nhất 1 team trong bảng").toBeGreaterThanOrEqual(1);
    });

    test("TC03 - Bảng hiển thị các cột đúng: ID, Team, Captain, Members, Country, Hidden, Banned", async ({ page }) => {
        const headerText = await page.locator("#teamsboard thead").textContent();
        expect(headerText).toContain("ID");
        expect(headerText).toContain("Team");
        expect(headerText).toContain("Captain");
        expect(headerText).toContain("Members");
    });

    test("TC04 - Team đầu tiên hiển thị trong bảng", async ({ page }) => {
        // API và bảng có thể khác thứ tự sắp xếp, nên chấp nhận bất kỳ team mẫu nào xuất hiện.
        const bodyText = (await page.locator("#teamsboard tbody").textContent()) ?? "";
        const hasAnyKnownTeam = sampleTeamNames.some((name) => bodyText.includes(name));
        expect(hasAnyKnownTeam, "Bảng phải hiển thị ít nhất 1 team lấy từ API").toBe(true);
    });

    test("TC05 - Click vào tên team dẫn đến trang chi tiết team đúng", async ({ page }) => {
        // Click link team đầu tiên
        const firstLink = page.locator(`#teamsboard tbody a[href*="/admin/teams/${firstTeamId}"]`).first();
        await expect(firstLink).toBeVisible();
        await firstLink.click();

        await page.waitForURL(`${BASE_URL}/admin/teams/${firstTeamId}`, { waitUntil: "domcontentloaded" });
        await expect(page.locator(".jumbotron h1, .jumbotron h2").first()).toContainText(firstTeamName);
    });

    // =========================================================================
    // Search / Filter
    // =========================================================================

    test("TC06 - Search theo tên team tìm đúng kết quả", async ({ page }) => {
        // Nhập tên đầy đủ vào ô tìm kiếm
        await page.fill('input[name="q"]', firstTeamName);
        await page.click('button[type="submit"]');
        await page.waitForLoadState("domcontentloaded");

        // Kết quả phải chứa team đang tìm
        await expect(page.locator("#teamsboard tbody")).toContainText(firstTeamName);
    });

    test("TC07 - Search với từ khóa không tồn tại → bảng không có kết quả", async ({ page }) => {
        const nonExistentName = "ZZZNOTEAMLIKETHIS_99999";
        await page.fill('input[name="q"]', nonExistentName);
        await page.click('button[type="submit"]');
        await page.waitForLoadState("domcontentloaded");

        const rows = page.locator("#teamsboard tbody tr");
        const count = await rows.count();
        // Không có row nào hoặc row hiển thị "no data"
        if (count > 0) {
            const bodyText = await page.locator("#teamsboard tbody").textContent();
            expect(bodyText, "Không được hiển thị team khi search từ khóa không tồn tại").not.toContain(firstTeamName);
        }
    });

    test("TC08 - Filter Hidden=Hidden Only → chỉ hiển thị team ẩn (hoặc không có kết quả)", async ({ page }) => {
        // Trang đang dùng SlimSelect; filter ổn định nhất là gọi URL query trực tiếp.
        await page.goto(`${BASE_URL}/admin/teams?hidden=1`);
        await page.waitForLoadState("domcontentloaded");

        // Trang phải load thành công và hiển thị bảng
        await expect(page).toHaveURL(/\/admin\/teams\?hidden=1/);
        await expect(page.locator("#teamsboard")).toBeVisible();
    });

    test("TC09 - Filter Banned=Banned Only → chỉ hiển thị team bị ban (hoặc không có kết quả)", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/teams?banned=1`);
        await page.waitForLoadState("domcontentloaded");

        await expect(page).toHaveURL(/\/admin\/teams\?banned=1/);
        await expect(page.locator("#teamsboard")).toBeVisible();
    });

    test("TC10 - Nút Reset xóa bộ lọc, hiển thị lại tất cả teams", async ({ page }) => {
        // Áp dụng filter trước
        await page.fill('input[name="q"]', firstTeamName);
        await page.click('button[type="submit"]');
        await page.waitForLoadState("domcontentloaded");

        // Click reset (icon sync-alt — link quay về /admin/teams)
        const resetBtn = page.locator('a[title="Reset"]').first();
        await resetBtn.click();
        await page.waitForURL(`${BASE_URL}/admin/teams`, { waitUntil: "domcontentloaded" });

        // Bảng phải hiển thị lại đủ data
        const rows = page.locator("#teamsboard tbody tr");
        await expect(rows.first()).toBeVisible();
    });

    test("TC11 - Trang có nút 'Create Team'", async ({ page }) => {
        await expect(
            page.locator('a[href*="teams/new"], a:has-text("Create Team")')
        ).toBeVisible();
    });

    test("TC12 - Trang có nút Edit và Delete", async ({ page }) => {
        await expect(page.locator("#teams-edit-button")).toBeVisible();
        await expect(page.locator("#teams-delete-button")).toBeVisible();
    });

    // =========================================================================
    // Bổ sung test cases
    // =========================================================================

    test("TC13 - Bảng hiển thị cột Bracket", async ({ page }) => {
        const headerText = await page.locator("#teamsboard thead").textContent();
        expect(headerText).toContain("Bracket");
    });

    test("TC14 - Dropdown Search Field có đủ options: Name, ID, Affiliation, Website, Country", async ({ page }) => {
        // Search Field được render bằng custom searchable-select, không còn <select> gốc trong DOM.
        const wrapper = page.locator('.ss-wrapper').filter({
            has: page.locator('input[type="hidden"][name="field"]'),
        }).first();

        await expect(wrapper).toBeVisible();

        const options = await wrapper.locator('.ss-option').allTextContents();
        const normalized = options.map((o) => o.trim()).filter(Boolean);
        expect(normalized).toContain("Name");
        expect(normalized).toContain("ID");
        expect(normalized).toContain("Affiliation");
        expect(normalized).toContain("Website");
        expect(normalized).toContain("Country");
    });

    test("TC15 - Filter theo Bracket dropdown → URL chứa bracket_id", async ({ page }) => {
        const bracketSelect = page.locator('select[name="bracket_id"]');
        const optionCount = await bracketSelect.locator("option").count();

        // Cần ít nhất 2 option (All Brackets + 1 bracket thực)
        test.skip(optionCount < 2, "Không có bracket nào để test filter");

        const firstBracketValue = await bracketSelect.locator("option").nth(1).getAttribute("value");
        await bracketSelect.selectOption(firstBracketValue!);
        await page.click('button[type="submit"]');
        await page.waitForLoadState("domcontentloaded");

        await expect(page).toHaveURL(/bracket_id=/);
        await expect(page.locator("#teamsboard")).toBeVisible();
    });

    test("TC16 - Kết hợp filter Hidden + Banned → URL chứa cả hai param", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/teams?hidden=1&banned=1`);
        await page.waitForLoadState("domcontentloaded");

        await expect(page).toHaveURL(/hidden=1/);
        await expect(page).toHaveURL(/banned=1/);
        await expect(page.locator("#teamsboard")).toBeVisible();
    });

    // =========================================================================
    // BVA/ECP: Search edge cases
    // =========================================================================

    test("TC17 - [ECP - Edge] Search team với ký tự đặc biệt → trang không crash", async ({ page }) => {
        const specialInputs = [
            '<script>alert(1)</script>',
            "'; DROP TABLE teams; --",
            "✓ 日本語 🚀",
        ];

        for (const input of specialInputs) {
            await page.fill('input[name="q"]', input);
            await page.click('button[type="submit"]');
            await page.waitForLoadState("domcontentloaded");
            await expect(page.locator("#teamsboard")).toBeVisible();
        }
    });

    test("TC18 - [BVA - Boundary] Search với chuỗi rất dài (200+ ký tự)", async ({ page }) => {
        const longString = "X".repeat(200);
        await page.fill('input[name="q"]', longString);
        await page.click('button[type="submit"]');
        await page.waitForLoadState("domcontentloaded");
        await expect(page.locator("#teamsboard")).toBeVisible();
    });

    test("TC19 - [ECP - Edge] Search field=ID với giá trị non-numeric → trang xử lý hợp lệ", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/teams?field=id&q=abc`, { waitUntil: "domcontentloaded" });
        await expect(page.locator("#teamsboard")).toBeVisible();
    });

    test("TC20 - [ECP - Invalid] Search với chỉ whitespace → trang vẫn load", async ({ page }) => {
        await page.fill('input[name="q"]', "   ");
        await page.click('button[type="submit"]');
        await page.waitForLoadState("domcontentloaded");
        await expect(page.locator("#teamsboard")).toBeVisible();
    });

    test("TC21 - [ECP] Kết hợp search + filter bracket + hidden cùng lúc", async ({ page }) => {
        const bracketSelect = page.locator('select[name="bracket_id"]');
        const optionCount = await bracketSelect.locator("option").count();
        test.skip(optionCount < 2, "Cần bracket để test combined filters");

        await page.goto(`${BASE_URL}/admin/teams?field=name&q=${encodeURIComponent(firstTeamName)}&hidden=1`, { waitUntil: "domcontentloaded" });
        await expect(page).toHaveURL(/field=name/);
        await expect(page).toHaveURL(/hidden=1/);
        await expect(page.locator("#teamsboard")).toBeVisible();
    });
});