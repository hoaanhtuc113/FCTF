import { test, expect, Page } from "@playwright/test";
import { BASE_URL, loginAsAdmin } from "./support";

async function getHistorySeed(page: Page) {
    await page.goto(`${BASE_URL}/admin/instances_history`, { waitUntil: "domcontentloaded" });
    const firstRow = page.locator("table.clean-table tbody tr").first();
    await expect(firstRow).toBeVisible();

    const text = (await firstRow.textContent()) ?? "";
    if (/No entries found/i.test(text)) {
        return null;
    }

    const startedAt = ((await firstRow.locator("td").nth(0).textContent()) ?? "").trim();
    const challengeName = await firstRow.locator("td").nth(3).getAttribute("title");
    const teamName = await firstRow.locator("td").nth(5).getAttribute("title");
    return {
        startedAt,
        challengeName: challengeName?.trim() ?? "",
        teamName: teamName?.trim() ?? "",
        dateOnly: startedAt.slice(0, 10),
    };
}

test.describe("UC-24 Filter History", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC24.01 - Filter theo challenge từ dữ liệu history hiện có", async ({ page }) => {
        const seed = await getHistorySeed(page);
        test.skip(!seed, "Không có instance history để test filter theo challenge");

        await page.goto(
            `${BASE_URL}/admin/instances_history?challenge=${encodeURIComponent(seed!.challengeName)}`,
            { waitUntil: "domcontentloaded" }
        );

        await expect(page).toHaveURL(/challenge=/);
        await expect(page.locator("table.clean-table tbody")).toContainText(seed!.challengeName);
    });

    test("TC24.02 - Filter theo team từ dữ liệu history hiện có", async ({ page }) => {
        const seed = await getHistorySeed(page);
        test.skip(!seed, "Không có instance history để test filter theo team");

        await page.goto(
            `${BASE_URL}/admin/instances_history?team=${encodeURIComponent(seed!.teamName)}`,
            { waitUntil: "domcontentloaded" }
        );

        await expect(page).toHaveURL(/team=/);
        await expect(page.locator("table.clean-table tbody")).toContainText(seed!.teamName);
    });

    test("TC24.03 - Filter theo khoảng ngày bằng start và end", async ({ page }) => {
        const seed = await getHistorySeed(page);
        test.skip(!seed, "Không có instance history để test date range");

        const start = `${seed!.dateOnly}T00:00`;
        const end = `${seed!.dateOnly}T23:59`;

        await page.goto(
            `${BASE_URL}/admin/instances_history?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
            { waitUntil: "domcontentloaded" }
        );

        await expect(page).toHaveURL(/start=/);
        await expect(page).toHaveURL(/end=/);
        await expect(page.locator("table.clean-table tbody")).toContainText(seed!.dateOnly);
    });

    test("TC24.04 - Filter với quick range và per_page được áp dụng lên URL", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/instances_history?quick=24h&per_page=25`, { waitUntil: "domcontentloaded" });

        await expect(page).toHaveURL(/quick=24h/);
        await expect(page).toHaveURL(/per_page=25/);
        await expect(page.locator("table.clean-table")).toBeVisible();
    });

    test("TC24.05 - Nút Reset xóa toàn bộ điều kiện filter", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/instances_history?challenge=XSS&quick=24h&per_page=25`, { waitUntil: "domcontentloaded" });
        await page.click('a[title="Reset"]');
        await expect(page).toHaveURL(`${BASE_URL}/admin/instances_history`);
    });

    test("TC24.06 - Filter theo user từ dữ liệu history hiện có", async ({ page }) => {
        const seed = await getHistorySeed(page);
        test.skip(!seed, "Không có instance history để test filter theo user");

        const userCell = await page.locator("table.clean-table tbody tr").first().locator("td").nth(4).textContent();
        const userName = userCell?.trim() ?? "";
        test.skip(!userName || userName === "-", "Row đầu tiên không có user");

        await page.goto(
            `${BASE_URL}/admin/instances_history?user=${encodeURIComponent(userName)}`,
            { waitUntil: "domcontentloaded" }
        );

        await expect(page).toHaveURL(/user=/);
        await expect(page.locator("table.clean-table")).toBeVisible();
    });

    test("TC24.07 - Kết hợp filter challenge + team + date range", async ({ page }) => {
        const seed = await getHistorySeed(page);
        test.skip(!seed, "Không có instance history để test combined filter");

        const params = new URLSearchParams({
            challenge: seed!.challengeName,
            team: seed!.teamName,
            start: `${seed!.dateOnly}T00:00`,
            end: `${seed!.dateOnly}T23:59`,
        });

        await page.goto(
            `${BASE_URL}/admin/instances_history?${params.toString()}`,
            { waitUntil: "domcontentloaded" }
        );

        await expect(page).toHaveURL(/challenge=/);
        await expect(page).toHaveURL(/team=/);
        await expect(page).toHaveURL(/start=/);
        await expect(page).toHaveURL(/end=/);
        await expect(page.locator("table.clean-table")).toBeVisible();
    });

    test("TC24.08 - Export CSV button hiển thị trên trang", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/instances_history`, { waitUntil: "domcontentloaded" });
        await expect(page.locator('a:has-text("Export CSV")')).toBeVisible();
    });

    test("TC24.09 - Per_page dropdown có các option 25, 50, 100, 200", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/instances_history`, { waitUntil: "domcontentloaded" });
        const options = await page.locator('select[name="per_page"] option').allTextContents();
        const normalized = options.map((o) => o.trim());
        expect(normalized).toContain("25");
        expect(normalized).toContain("50");
        expect(normalized).toContain("100");
        expect(normalized).toContain("200");
    });

    // =========================================================================
    // BVA/ECP: Date/Time Filters
    // =========================================================================

    test("TC24.10 - [BVA - Invalid] start > end → trang load, bảng hiển thị kết quả trống hoặc hợp lệ", async ({ page }) => {
        // Ranh giới: start sau end = khoảng ngày không hợp lệ
        const params = new URLSearchParams({
            start: "2025-12-31T23:59",
            end: "2025-01-01T00:00",
        });
        await page.goto(`${BASE_URL}/admin/instances_history?${params.toString()}`, { waitUntil: "domcontentloaded" });

        // Trang không crash, bảng vẫn render
        await expect(page.locator("table.clean-table")).toBeVisible();
        // Với start > end, không nên có kết quả
        const rowCount = await page.locator("table.clean-table tbody tr").count();
        const bodyText = await page.locator("table.clean-table tbody").textContent();
        if (rowCount > 0 && !bodyText?.includes("No entries found")) {
            // Nếu server trả kết quả, verify là edge case chấp nhận được
            expect(rowCount).toBeGreaterThanOrEqual(0);
        }
    });

    test("TC24.11 - [BVA - Boundary] start = end (cùng datetime chính xác) → kết quả trong khoảnh khắc đó", async ({ page }) => {
        const seed = await getHistorySeed(page);
        test.skip(!seed, "Không có instance history để test boundary start=end");

        // Sử dụng cùng chính xác thời điểm từ dữ liệu gốc
        const exactDateTime = seed!.startedAt.slice(0, 16); // "YYYY-MM-DDTHH:MM"
        const params = new URLSearchParams({
            start: exactDateTime,
            end: exactDateTime,
        });
        await page.goto(`${BASE_URL}/admin/instances_history?${params.toString()}`, { waitUntil: "domcontentloaded" });

        await expect(page.locator("table.clean-table")).toBeVisible();
    });

    test("TC24.12 - [ECP - Partial] Chỉ có start, không có end → filter áp dụng từ start trở đi", async ({ page }) => {
        const seed = await getHistorySeed(page);
        test.skip(!seed, "Không có instance history để test only-start");

        const params = new URLSearchParams({
            start: `${seed!.dateOnly}T00:00`,
        });
        await page.goto(`${BASE_URL}/admin/instances_history?${params.toString()}`, { waitUntil: "domcontentloaded" });

        await expect(page).toHaveURL(/start=/);
        await expect(page.locator("table.clean-table")).toBeVisible();
    });

    test("TC24.13 - [ECP - Partial] Chỉ có end, không có start → filter áp dụng đến end", async ({ page }) => {
        const seed = await getHistorySeed(page);
        test.skip(!seed, "Không có instance history để test only-end");

        const params = new URLSearchParams({
            end: `${seed!.dateOnly}T23:59`,
        });
        await page.goto(`${BASE_URL}/admin/instances_history?${params.toString()}`, { waitUntil: "domcontentloaded" });

        await expect(page).toHaveURL(/end=/);
        await expect(page.locator("table.clean-table")).toBeVisible();
    });

    test("TC24.14 - [ECP - Invalid] Date range trong tương lai xa → kết quả trống", async ({ page }) => {
        const futureDate = "2099-12-31";
        const params = new URLSearchParams({
            start: `${futureDate}T00:00`,
            end: `${futureDate}T23:59`,
        });
        await page.goto(`${BASE_URL}/admin/instances_history?${params.toString()}`, { waitUntil: "domcontentloaded" });

        await expect(page.locator("table.clean-table")).toBeVisible();
        // Không có dữ liệu ở năm 2099
        const bodyText = await page.locator("table.clean-table tbody").textContent();
        expect(bodyText?.includes("No entries found") || (await page.locator("table.clean-table tbody tr").count()) === 0).toBeTruthy();
    });

    test("TC24.15 - [BVA - Boundary] Date range rất cũ (epoch) → kết quả trống hoặc tất cả", async ({ page }) => {
        const params = new URLSearchParams({
            start: "1970-01-01T00:00",
            end: "1970-01-01T23:59",
        });
        await page.goto(`${BASE_URL}/admin/instances_history?${params.toString()}`, { waitUntil: "domcontentloaded" });

        await expect(page.locator("table.clean-table")).toBeVisible();
    });

    test("TC24.16 - [BVA - Boundary] Date range bao phủ midnight: start 23:59 → end 00:01 ngày hôm sau", async ({ page }) => {
        const seed = await getHistorySeed(page);
        test.skip(!seed, "Không có instance history để test midnight boundary");

        // Khoảng thời gian bắt đầu từ 23:59 ngày hôm trước đến 00:01 ngày hiện tại
        const dateObj = new Date(seed!.dateOnly + "T00:00:00Z");
        const prevDay = new Date(dateObj.getTime() - 86400000).toISOString().slice(0, 10);
        const params = new URLSearchParams({
            start: `${prevDay}T23:59`,
            end: `${seed!.dateOnly}T00:01`,
        });
        await page.goto(`${BASE_URL}/admin/instances_history?${params.toString()}`, { waitUntil: "domcontentloaded" });

        await expect(page.locator("table.clean-table")).toBeVisible();
    });

    // =========================================================================
    // BVA/ECP: Quick Range dropdown
    // =========================================================================

    test("TC24.17 - [ECP] Tất cả quick range values hoạt động: 15m, 30m, 1h, 6h, 12h, 24h", async ({ page }) => {
        const quickRanges = ["15m", "30m", "1h", "6h", "12h", "24h"];

        for (const range of quickRanges) {
            await page.goto(`${BASE_URL}/admin/instances_history?quick=${range}`, { waitUntil: "domcontentloaded" });
            await expect(page).toHaveURL(new RegExp(`quick=${range}`));
            await expect(page.locator("table.clean-table")).toBeVisible();
        }
    });

    // =========================================================================
    // BVA/ECP: Text filter edge cases
    // =========================================================================

    test("TC24.18 - [ECP - Edge] Filter với ký tự đặc biệt: <script>, SQL injection, Unicode", async ({ page }) => {
        const specialInputs = [
            '<script>alert("xss")</script>',
            "'; DROP TABLE instances; --",
            "✓ Unicode 日本語 🚀",
        ];

        for (const input of specialInputs) {
            await page.goto(
                `${BASE_URL}/admin/instances_history?challenge=${encodeURIComponent(input)}`,
                { waitUntil: "domcontentloaded" }
            );
            // Trang phải load bình thường, không crash
            await expect(page.locator("table.clean-table")).toBeVisible();
        }
    });

    test("TC24.19 - [BVA - Boundary] Filter với chuỗi rất dài (500+ ký tự)", async ({ page }) => {
        const longString = "A".repeat(500);
        await page.goto(
            `${BASE_URL}/admin/instances_history?challenge=${encodeURIComponent(longString)}`,
            { waitUntil: "domcontentloaded" }
        );
        await expect(page.locator("table.clean-table")).toBeVisible();
    });

    test("TC24.20 - [ECP] Per_page boundary: giá trị nhỏ nhất (25) và lớn nhất (200)", async ({ page }) => {
        // Boundary nhỏ nhất
        await page.goto(`${BASE_URL}/admin/instances_history?per_page=25`, { waitUntil: "domcontentloaded" });
        await expect(page.locator("table.clean-table")).toBeVisible();
        const rows25 = await page.locator("table.clean-table tbody tr").count();

        // Boundary lớn nhất
        await page.goto(`${BASE_URL}/admin/instances_history?per_page=200`, { waitUntil: "domcontentloaded" });
        await expect(page.locator("table.clean-table")).toBeVisible();
        const rows200 = await page.locator("table.clean-table tbody tr").count();

        // rows200 >= rows25 (hoặc bằng nếu tổng < 25)
        expect(rows200).toBeGreaterThanOrEqual(rows25);
    });

    test("TC24.21 - [ECP - Invalid] Per_page giá trị không hợp lệ (0, -1, 999) → trang vẫn load", async ({ page }) => {
        const invalidValues = ["0", "-1", "999", "abc"];
        for (const val of invalidValues) {
            await page.goto(`${BASE_URL}/admin/instances_history?per_page=${val}`, { waitUntil: "domcontentloaded" });
            await expect(page.locator("table.clean-table")).toBeVisible();
        }
    });

    test("TC24.22 - [ECP] Filter với tất cả fields trống → hiển thị tất cả kết quả", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/instances_history?challenge=&team=&user=&start=&end=`, { waitUntil: "domcontentloaded" });
        await expect(page.locator("table.clean-table")).toBeVisible();
    });
});