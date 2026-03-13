import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    createTestTeam,
    deleteTeam,
    loginAsAdmin,
    patchTeam,
    getBrackets,
} from "./support";

test.describe("UC-65 Team Search Tests - Code Verified & Robust", () => {
    test("TSR-ALL - Kiểm tra toàn bộ quy trình tìm kiếm Team", async ({ page }) => {
        // Tăng timeout cho toàn bộ quy trình
        test.setTimeout(240000);
        page.setDefaultNavigationTimeout(60000);
        page.setDefaultTimeout(60000);

        const uniquePrefix = `SRCH${Date.now()}`;
        const teamName = `${uniquePrefix}TEAM`;
        const teamEmail = `${uniquePrefix}@test.com`.toLowerCase();
        const teamAffiliation = `AFF${uniquePrefix}`;
        const teamWebsite = `https://test${uniquePrefix}.com`;
        const teamCountry = "VN"; 

        await loginAsAdmin(page);

        // 1. Setup: Lấy bracket và tạo team với đầy đủ thông tin
        console.log("Step 1: Setup - Getting bracket and creating unique team...");
        const brackets = await getBrackets(page);
        const bracketId = brackets.length > 0 ? brackets[0].id : null;
        const bracketName = brackets.length > 0 ? brackets[0].name : null;

        const team = await createTestTeam(page);
        console.log(`Team created with ID: ${team.id}. Applying patches...`);
        
        await patchTeam(page, team.id, {
            name: teamName,
            email: teamEmail,
            affiliation: teamAffiliation,
            website: teamWebsite,
            country: teamCountry,
            bracket_id: bracketId,
            hidden: true
        });

        try {
            // 2. TSR-001: Search by Name (UI Interaction)
            console.log("Step 2: Searching by name via UI...");
            await page.goto(`${BASE_URL}/admin/teams`, { waitUntil: "domcontentloaded" });
            await page.waitForSelector("#teamsboard");
            
            await page.fill('input[name="q"]', teamName);
            await Promise.all([
                page.waitForLoadState("domcontentloaded"),
                page.click('button.clean-btn-primary:has-text("Search")'),
            ]);
            
            await expect(page.locator("#teamsboard")).toContainText(teamName);

            // 3. TSR-002: Search by ID (URL)
            console.log("Step 3: Searching by ID via URL...");
            await page.goto(`${BASE_URL}/admin/teams?field=id&q=${team.id}`, { waitUntil: "domcontentloaded" });
            await expect(page.locator("#teamsboard tbody tr")).toHaveCount(1);
            await expect(page.locator("#teamsboard tr").filter({ hasText: team.id.toString() })).toBeVisible();

            // 4. TSR-003: Search by Affiliation (URL)
            console.log("Step 4: Searching by affiliation via URL...");
            await page.goto(`${BASE_URL}/admin/teams?field=affiliation&q=${teamAffiliation}`, { waitUntil: "domcontentloaded" });
            await expect(page.locator("#teamsboard")).toContainText(teamName);

            // 5. TSR-004: Search by Website (URL)
            console.log("Step 5: Searching by website via URL...");
            await page.goto(`${BASE_URL}/admin/teams?field=website&q=${teamWebsite}`, { waitUntil: "domcontentloaded" });
            await expect(page.locator("#teamsboard")).toContainText(teamName);

            // 6. TSR-005: Search by Country (URL)
            console.log("Step 6: Searching by country via URL...");
            await page.goto(`${BASE_URL}/admin/teams?field=country&q=${teamCountry}`, { waitUntil: "domcontentloaded" });
            const countryRow = page.locator("#teamsboard tr").filter({ hasText: teamName }).first();
            await expect(countryRow.locator(`i.flag-${teamCountry.toLowerCase()}`)).toBeVisible();

            // 7. TSR-006: Search by Email (Manual URL - Backend supports it)
            console.log("Step 7: Searching by team email via URL...");
            await page.goto(`${BASE_URL}/admin/teams?field=email&q=${teamEmail}`, { waitUntil: "domcontentloaded" });
            await expect(page.locator("#teamsboard")).toContainText(teamName);

            // 8. TSR-007: Filter by Status (Hidden)
            console.log("Step 8: Filtering by hidden status via URL...");
            // LƯU Ý: Phải có field=name để backend handle q
            await page.goto(`${BASE_URL}/admin/teams?field=name&hidden=1&q=${uniquePrefix}`, { waitUntil: "domcontentloaded" });
            await expect(page.locator("#teamsboard")).toContainText(teamName);
            const hiddenRow = page.locator("#teamsboard tr").filter({ hasText: teamName }).first();
            await expect(hiddenRow.locator('.clean-badge-danger').filter({ hasText: 'hidden' })).toBeVisible();

            // 9. TSR-008: Filter by Bracket
            if (bracketId) {
                console.log("Step 9: Filtering by bracket via URL...");
                // LƯU Ý: Phải có field=name để backend handle q
                await page.goto(`${BASE_URL}/admin/teams?field=name&bracket_id=${bracketId}&q=${uniquePrefix}`, { waitUntil: "domcontentloaded" });
                await expect(page.locator("#teamsboard")).toContainText(teamName);
                if (bracketName) {
                    await expect(page.locator("#teamsboard")).toContainText(bracketName);
                }
            }

            // 10. TSR-009: Reset Search (UI)
            console.log("Step 10: Testing reset button UI...");
            await page.goto(`${BASE_URL}/admin/teams?field=id&q=${team.id}`, { waitUntil: "domcontentloaded" });
            await page.waitForSelector("#teamsboard");
            // Kiểm tra field q được sync từ URL
            await expect(page.locator('input[name="q"]')).toHaveValue(team.id.toString());
            
            await Promise.all([
                page.waitForURL(`${BASE_URL}/admin/teams`, { waitUntil: "domcontentloaded" }),
                page.click('a[title="Reset"]'),
            ]);
            
            await expect(page.locator('input[name="q"]')).toHaveValue("");

            console.log("All code-verified search tests finished successfully.");

        } finally {
            console.log("Cleanup: Deleting team...");
            await deleteTeam(page, team.id).catch(() => {});
        }
    });
});
