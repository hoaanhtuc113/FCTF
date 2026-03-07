import { test, expect } from "playwright/test";
import {
    BASE_URL,
    createTeamWithMembers,
    deleteTeam,
    deleteUser,
    loginAsAdmin,
    openTeamCaptainModal,
} from "./helpers";

test.describe("UC-64 Assign Captain", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC64.01 - Admin đổi captain của team từ modal Choose Captain", async ({ page }) => {
        const { team, users } = await createTeamWithMembers(page, 2);

        try {
            await openTeamCaptainModal(page, team.id);
            await expect(page.locator("#team-captain-form")).toBeVisible();

            const responsePromise = page.waitForResponse((response) => {
                return response.url().includes(`/api/v1/teams/${team.id}`) && response.request().method() === "PATCH";
            });

            await page.selectOption("#captain", String(users[1].id));
            await page.click('#team-captain-form button[type="submit"]');
            await responsePromise;

            await page.goto(`${BASE_URL}/admin/teams/${team.id}`, { waitUntil: "domcontentloaded" });
            const captainRow = page.locator("tbody tr").filter({ hasText: users[1].name }).first();
            await expect(captainRow).toContainText("Captain");
        } finally {
            await deleteTeam(page, team.id);
            for (const user of users) {
                await deleteUser(page, user.id);
            }
        }
    });
});