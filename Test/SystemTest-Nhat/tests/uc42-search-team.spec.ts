import { test, expect } from "@playwright/test";
import { BASE_URL, getTeams, loginAsAdmin } from "./support";

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
        await page.goto(`${BASE_URL}/admin/teams?field=name&q=${encodeURIComponent(sampleTeamName)}`, { waitUntil: "domcontentloaded" });
        await expect(page.locator("#teamsboard tbody")).toContainText(sampleTeamName);
    });

    test("TC42.02 - Search Team theo ID", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/teams?field=id&q=${sampleTeamId}`, { waitUntil: "domcontentloaded" });
        await expect(page.locator("#teamsboard tbody")).toContainText(String(sampleTeamId));
    });

    test("TC42.03 - Search Team theo affiliation khi dữ liệu có sẵn", async ({ page }) => {
        test.skip(!sampleTeamAffiliation, "Không có affiliation để test search theo affiliation");
        await page.goto(`${BASE_URL}/admin/teams?field=affiliation&q=${encodeURIComponent(sampleTeamAffiliation)}`, { waitUntil: "domcontentloaded" });
        await expect(page.locator("#teamsboard tbody")).toContainText(sampleTeamAffiliation);
    });

    test("TC42.04 - Search từ khóa không tồn tại trả về empty result hợp lệ", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/teams?field=name&q=ZZZ_NO_TEAM_987654`, { waitUntil: "domcontentloaded" });
        await expect(page.locator("body")).not.toContainText(sampleTeamName);
    });
});