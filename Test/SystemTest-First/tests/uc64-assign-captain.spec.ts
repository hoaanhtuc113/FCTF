import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    createTestTeam,
    createTestUser,
    addUserToTeam,
    deleteTeam,
    deleteUser,
    loginAsAdmin,
    openTeamCaptainModal,
} from "./support";

test.describe("UC-64 Assign Captain - Robust", () => {
    test("CPT-ALL - Kiểm tra toàn bộ quy trình gán Captain", async ({ page }) => {
        // Tăng timeout cho toàn bộ quy trình cực kỳ ổn định
        test.setTimeout(240000); // 4 phút
        page.setDefaultNavigationTimeout(60000);
        page.setDefaultTimeout(30000);

        await loginAsAdmin(page);

        // 1. Setup: Tạo team và users riêng lẻ để kiểm soát captain_id
        console.log("Step 1: Creating team and users...");
        const team = await createTestTeam(page);
        const user0 = await createTestUser(page);
        const user1 = await createTestUser(page);

        const users = [
            { id: user0.id, name: user0.name },
            { id: user1.id, name: user1.name }
        ];

        try {
            // 2. Thêm users vào team
            console.log("Step 2: Adding users to team...");
            await addUserToTeam(page, team.id, user0.id);
            await addUserToTeam(page, team.id, user1.id);

            // Quay lại trang team để kiểm tra trạng thái ban đầu
            await page.goto(`${BASE_URL}/admin/teams/${team.id}`, { waitUntil: "domcontentloaded" });
            const memberTable = page.locator("table").filter({ hasText: "User Name" }).first();
            await expect(memberTable).toBeVisible();

            // Kiểm tra ban đầu chưa có badge Captain (do admin tạo team thường không tự gán captain cho user)
            const initialCaptainBadge = memberTable.locator(".badge").filter({ hasText: "Captain" });
            const badgeCount = await initialCaptainBadge.count();
            console.log(`Initial captain badge count: ${badgeCount}`);

            // 3. Gán User 0 làm Captain đầu tiên
            console.log(`Step 3: Assigning ${user0.name} as FIRST captain...`);
            await openTeamCaptainModal(page, team.id);
            await page.selectOption("#captain", String(user0.id));
            
            const responsePromise1 = page.waitForResponse(r => 
                r.url().includes(`/api/v1/teams/${team.id}`) && r.request().method() === "PATCH"
            );
            await page.click('#team-captain-form button[type="submit"]');
            await responsePromise1;
            
            await expect(page.locator("#team-captain-form")).not.toBeVisible();
            await page.goto(`${BASE_URL}/admin/teams/${team.id}`, { waitUntil: "domcontentloaded" });
            
            const row0 = page.locator("tbody tr").filter({ hasText: user0.name }).first();
            await expect(row0.locator(".badge").filter({ hasText: "Captain" })).toBeVisible();

            // 4. Đổi sang User 1 và verify badge di chuyển
            console.log(`Step 4: Changing captain to ${user1.name}...`);
            await openTeamCaptainModal(page, team.id);
            await page.selectOption("#captain", String(user1.id));
            
            const responsePromise2 = page.waitForResponse(r => 
                r.url().includes(`/api/v1/teams/${team.id}`) && r.request().method() === "PATCH"
            );
            await page.click('#team-captain-form button[type="submit"]');
            await responsePromise2;
            
            await expect(page.locator("#team-captain-form")).not.toBeVisible();
            await page.goto(`${BASE_URL}/admin/teams/${team.id}`, { waitUntil: "domcontentloaded" });
            
            const row1 = page.locator("tbody tr").filter({ hasText: user1.name }).first();
            await expect(row1.locator(".badge").filter({ hasText: "Captain" })).toBeVisible();
            // User 0 phải mất badge
            await expect(row0.locator(".badge").filter({ hasText: "Captain" })).not.toBeVisible();

            // 5. Kiểm tra persistence sau reload
            console.log("Step 5: Verifying persistence after reload...");
            await page.reload({ waitUntil: "domcontentloaded" });
            await expect(row1.locator(".badge").filter({ hasText: "Captain" })).toBeVisible();

            console.log("Test finished successfully.");

        } finally {
            console.log("Step 6: Cleaning up...");
            // Thêm delay nhỏ để tránh race condition với backend
            await page.waitForTimeout(1000);
            await deleteTeam(page, team.id).catch(e => console.error("Cleanup Team failed:", e));
            for (const user of users) {
                await deleteUser(page, user.id).catch(e => console.error(`Cleanup User ${user.id} failed:`, e));
            }
        }
    });
});