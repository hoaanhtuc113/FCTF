import { test, expect, Page } from "@playwright/test";
import { BASE_URL, getTeams, loginAsAdmin } from "./support";

async function searchTeams(page: Page, field: string, query: string) {
    const params = new URLSearchParams({ field, q: query });
    await page.goto(`${BASE_URL}/admin/teams?${params.toString()}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#teamsboard")).toBeVisible();
}

test.describe("UC-42 Search Team", () => {
    let sampleTeamName: string;
    let sampleTeamId: number;
    let sampleTeamAffiliation: string;

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        await loginAsAdmin(page);
        const teams = await getTeams(page, 5);
        sampleTeamName = teams[0].name;
        sampleTeamId = teams[0].id;
        sampleTeamAffiliation = teams.find((team) => team.affiliation)?.affiliation ?? "";
        await page.close();
    });

    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC42.01 - Search Team theo tên", async ({ page }) => {
        await searchTeams(page, "name", sampleTeamName);
        await expect(page.locator("#teamsboard tbody")).toContainText(sampleTeamName);
    });

    test("TC42.02 - Search Team theo ID", async ({ page }) => {
        await searchTeams(page, "id", String(sampleTeamId));
        const matchedRow = page.locator(`#teamsboard tbody tr:has(td[value="${sampleTeamId}"])`).first();
        await expect(matchedRow).toContainText(String(sampleTeamId));
        await expect(matchedRow).toContainText(sampleTeamName);
    });

    test("TC42.03 - Search Team theo affiliation khi dữ liệu có sẵn", async ({ page }) => {
        test.skip(!sampleTeamAffiliation, "Không có affiliation để test search theo affiliation");
        await searchTeams(page, "affiliation", sampleTeamAffiliation);
        await expect(page.locator("#teamsboard tbody")).toContainText(sampleTeamAffiliation);
    });

    test("TC42.04 - Search từ khóa không tồn tại trả về empty result hợp lệ", async ({ page }) => {
        await searchTeams(page, "name", "ZZZ_NO_TEAM_987654");
        await expect(page.locator("body")).toContainText("0 results");
        await expect(page.locator("#teamsboard tbody")).not.toContainText(sampleTeamName);
    });

    test("TC42.05 - Search Team theo website khi dữ liệu có sẵn", async ({ page }) => {
        const teams = await getTeams(page, 20);
        const teamWithWebsite = teams.find((team) => team.website);
        test.skip(!teamWithWebsite, "Không có team nào có website để test search theo website");
        await searchTeams(page, "website", teamWithWebsite!.website);
        await expect(page.locator("#teamsboard tbody")).toContainText(teamWithWebsite!.name);
    });

    test("TC42.06 - Search Team theo country → trang load thành công", async ({ page }) => {
        await searchTeams(page, "country", "VN");
        await expect(page.locator("#teamsboard")).toBeVisible();
    });

    // =========================================================================
    // BVA/ECP: Search edge cases
    // =========================================================================

    test("TC42.07 - [ECP - Edge] Search với ký tự đặc biệt: <script>, SQL injection, Unicode", async ({ page }) => {
        const specialInputs = [
            '<script>alert("xss")</script>',
            "'; DROP TABLE teams; --",
            "✓ Unicode 日本語 🚀",
            "-- OR 1=1",
            "<img onerror=alert(1) src=x>",
        ];

        for (const input of specialInputs) {
            await searchTeams(page, "name", input);
            // Trang phải load bình thường, không crash, không XSS
            await expect(page.locator("#teamsboard")).toBeVisible();
        }
    });

    test("TC42.08 - [ECP - Empty] Search với query trống → hiển thị tất cả teams", async ({ page }) => {
        await searchTeams(page, "name", "");
        await expect(page.locator("#teamsboard")).toBeVisible();
        const rows = await page.locator("#teamsboard tbody tr").count();
        expect(rows).toBeGreaterThanOrEqual(1);
    });

    test("TC42.09 - [BVA - Boundary] Search ID với giá trị biên: 0, -1, 99999", async ({ page }) => {
        const boundaryIds = ["0", "-1", "99999"];
        for (const id of boundaryIds) {
            await searchTeams(page, "id", id);
            // Trang phải load, không lỗi 500
            await expect(page.locator("#teamsboard")).toBeVisible();
        }
    });

    test("TC42.10 - [BVA - Boundary] Search với chuỗi rất dài (500+ ký tự) → trang vẫn load", async ({ page }) => {
        const longString = "A".repeat(500);
        await searchTeams(page, "name", longString);
        await expect(page.locator("#teamsboard")).toBeVisible();
    });

    test("TC42.11 - [ECP] Search tên team dùng substring (một phần tên) → tìm đúng team", async ({ page }) => {
        // Lấy phần đầu tên team (ít nhất 3 ký tự)
        const partial = sampleTeamName.length > 3 ? sampleTeamName.slice(0, 3) : sampleTeamName;
        await searchTeams(page, "name", partial);

        await expect(page.locator("#teamsboard tbody")).toContainText(partial);
    });

    test("TC42.12 - [ECP - Edge] Search với whitespace (khoảng trắng đầu/cuối)", async ({ page }) => {
        await searchTeams(page, "name", `  ${sampleTeamName}  `);
        // Server nên trim hoặc xử lý whitespace hợp lý
        await expect(page.locator("#teamsboard")).toBeVisible();
    });
});