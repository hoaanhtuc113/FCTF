import { test, expect } from "@playwright/test";
import { BASE_URL, getSubmissions, loginAsAdmin } from "./helpers";

test.describe("UC-45 Search Submission", () => {
    let sampleId: number;
    let sampleChallengeName: string;
    let sampleChallengeId: number;
    let sampleTeamId: number;
    let sampleUserId: number;
    let sampleDate: string;

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        await loginAsAdmin(page);
        const submissions = await getSubmissions(page, { page: 1, per_page: 10 });
        const sample = submissions[0];
        sampleId = sample.id;
        sampleChallengeName = sample.challengeName;
        sampleChallengeId = sample.challengeId;
        sampleTeamId = sample.teamId;
        sampleUserId = sample.userId;
        sampleDate = sample.date.slice(0, 10);
        await page.close();
    });

    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC45.01 - Search submission theo ID", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/submissions?field=id&q=${sampleId}`, { waitUntil: "domcontentloaded" });
        await expect(page.locator("#teamsboard tbody")).toContainText(String(sampleId));
    });

    test("TC45.02 - Search submission theo challenge name", async ({ page }) => {
        await page.goto(
            `${BASE_URL}/admin/submissions?field=challenge_name&q=${encodeURIComponent(sampleChallengeName)}`,
            { waitUntil: "domcontentloaded" }
        );
        await expect(page.locator("#teamsboard tbody")).toContainText(sampleChallengeName);
    });

    test("TC45.03 - Filter theo team_id và user_id", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/submissions?team_id=${sampleTeamId}&user_id=${sampleUserId}`, { waitUntil: "domcontentloaded" });
        await expect(page).toHaveURL(/team_id=/);
        await expect(page).toHaveURL(/user_id=/);
        await expect(page.locator("#teamsboard tbody")).toContainText(String(sampleTeamId));
    });

    test("TC45.04 - Filter theo challenge_id và date range", async ({ page }) => {
        await page.goto(
            `${BASE_URL}/admin/submissions?challenge_id=${sampleChallengeId}&date_from=${sampleDate}&date_to=${sampleDate}`,
            { waitUntil: "domcontentloaded" }
        );
        await expect(page).toHaveURL(/challenge_id=/);
        await expect(page).toHaveURL(/date_from=/);
        await expect(page).toHaveURL(/date_to=/);
        await expect(page.locator("#teamsboard tbody")).toContainText(sampleChallengeName);
    });

    test("TC45.05 - Nút Reset xóa toàn bộ search/filter submissions", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/submissions?field=id&q=${sampleId}&team_id=${sampleTeamId}`, { waitUntil: "domcontentloaded" });
        await page.click('button[title="Reset"]');
        await expect(page).toHaveURL(`${BASE_URL}/admin/submissions`);
    });
});