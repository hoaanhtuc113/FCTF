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
});