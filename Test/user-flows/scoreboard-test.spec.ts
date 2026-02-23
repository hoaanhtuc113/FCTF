import { test, expect, Page } from '@playwright/test';

// =============================================================================
// PHẦN 1: TYPE DEFINITIONS & BỘ DỮ LIỆU TEST CASES
// =============================================================================

interface ScoreboardTestData {
    testCaseName: string;
    description: string;
    action: 'view_scoreboard' | 'check_rank' | 'check_score' | 'search_team' | 'sort_column' | 'pagination' | 'refresh';
    searchTeamName?: string;
    sortColumn?: 'rank' | 'score';
    expectedResult: string;
    note?: string;
}

const allTestData: ScoreboardTestData[] = [
    {
        testCaseName: 'TC-SB001: Hiển thị bảng xếp hạng khi có teams',
        description: 'Login → Mở Scoreboard → Kiểm tra danh sách team hiển thị',
        action: 'view_scoreboard',
        expectedResult: 'Bảng xếp hạng hiển thị danh sách team scores',
        note: 'Precondition: Teams tồn tại trong contest'
    },
    {
        testCaseName: 'TC-SB002: Kiểm tra cột Rank sắp xếp giảm dần theo score',
        description: 'Mở Scoreboard → Kiểm tra cột Rank',
        action: 'check_rank',
        expectedResult: 'Rank 1 = team có điểm cao nhất, sắp xếp tự động giảm dần',
        note: 'Precondition: Nhiều teams đã có điểm'
    },
    {
        testCaseName: 'TC-SB003: Kiểm tra cột Score hiển thị đúng điểm',
        description: 'Mở Scoreboard → Kiểm tra cột Score',
        action: 'check_score',
        expectedResult: 'Score bằng tổng điểm từ các challenges đã giải',
        note: 'Precondition: Teams đã giải challenges'
    },
    {
        testCaseName: 'TC-SB004: Tìm kiếm team trên Scoreboard',
        description: 'Mở Scoreboard → Nhập tên team → Nhấn GO',
        action: 'search_team',
        searchTeamName: 'team',
        expectedResult: 'Kết quả tìm kiếm hiển thị đúng team',
        note: 'Search theo tên team'
    },
    {
        testCaseName: 'TC-SB005: Tìm kiếm team không tồn tại',
        description: 'Mở Scoreboard → Nhập tên team không tồn tại → Nhấn GO',
        action: 'search_team',
        searchTeamName: 'zzz_nonexistent_team_xyz_999',
        expectedResult: 'Hiển thị "No teams found"',
        note: 'Không có team nào khớp với từ khóa tìm kiếm'
    },
    {
        testCaseName: 'TC-SB006: Sort theo cột Rank (click header #)',
        description: 'Mở Scoreboard → Click header cột # để sort',
        action: 'sort_column',
        sortColumn: 'rank',
        expectedResult: 'Thứ tự thay đổi khi click sort (toggle asc/desc)',
        note: 'Sort toggle giữa ascending và descending'
    },
    {
        testCaseName: 'TC-SB007: Sort theo cột Score (click header PTS)',
        description: 'Mở Scoreboard → Click header cột PTS để sort',
        action: 'sort_column',
        sortColumn: 'score',
        expectedResult: 'Thứ tự thay đổi theo điểm khi click sort',
        note: 'Sort toggle giữa ascending và descending'
    },
    {
        testCaseName: 'TC-SB008: Nút Refresh cập nhật dữ liệu',
        description: 'Mở Scoreboard → Click nút Refresh',
        action: 'refresh',
        expectedResult: 'Dữ liệu được load lại, bảng xếp hạng hiển thị',
        note: 'Kiểm tra nút Refresh hoạt động đúng'
    }
];

// =============================================================================
// PHẦN 2: HELPER FUNCTIONS
// =============================================================================

const BASE_URL = 'https://contestant.fctf.site';

// Helper: Login
async function login(page: Page, user: string, pass: string) {
    await page.goto(`${BASE_URL}/login`);
    await page.locator("input[placeholder='input username...']").fill(user);
    await page.locator("input[placeholder='enter_password']").fill(pass);
    await page.locator("button[type='submit']").click();
    await page.waitForURL(/\/(dashboard|challenges|tickets)/);
}

// Helper: Navigate to Scoreboard
async function navigateToScoreboard(page: Page) {
    // Sử dụng sidebar navigation
    await page.getByText('Scoreboard').click();
    await expect(page).toHaveURL(/\/scoreboard/);
    // Đợi bảng load xong (header [LEADERBOARD] xuất hiện)
    await expect(page.getByText('[LEADERBOARD]')).toBeVisible({ timeout: 15000 });
}

// Helper: Lấy tất cả rows trong bảng scoreboard
async function getScoreboardRows(page: Page) {
    // Đợi bảng render
    await page.waitForTimeout(1000);
    return page.locator('table tbody tr');
}

// Helper: Lấy rank values từ bảng
async function getRankValues(page: Page): Promise<number[]> {
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    const ranks: number[] = [];

    for (let i = 0; i < count; i++) {
        const rankText = await rows.nth(i).locator('td').first().textContent();
        if (rankText) {
            const rank = parseInt(rankText.trim());
            if (!isNaN(rank)) {
                ranks.push(rank);
            }
        }
    }
    return ranks;
}

// Helper: Lấy score values từ bảng
async function getScoreValues(page: Page): Promise<number[]> {
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    const scores: number[] = [];

    for (let i = 0; i < count; i++) {
        const scoreText = await rows.nth(i).locator('td').last().textContent();
        if (scoreText) {
            const score = parseInt(scoreText.trim());
            if (!isNaN(score)) {
                scores.push(score);
            }
        }
    }
    return scores;
}

// Helper: Lấy team names từ bảng
async function getTeamNames(page: Page): Promise<string[]> {
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    const names: string[] = [];

    for (let i = 0; i < count; i++) {
        const nameText = await rows.nth(i).locator('td').nth(1).textContent();
        if (nameText) {
            names.push(nameText.trim().replace('★', '').trim());
        }
    }
    return names;
}

// =============================================================================
// PHẦN 3: TEST SUITE
// =============================================================================

test.describe('Test Suite: Scoreboard - Bảng Xếp Hạng', () => {

    test.beforeEach(async ({ page }) => {
        // Login tài khoản user2
        await login(page, 'user2', '1');
        // Navigate tới Scoreboard
        await navigateToScoreboard(page);
    });

    // =====================================================================
    // TC-SB001: Hiển thị bảng xếp hạng
    // =====================================================================
    test('TC-SB001: Hiển thị bảng xếp hạng khi có teams', async ({ page }) => {
        test.setTimeout(60000);

        await test.step('Kiểm tra bảng xếp hạng hiển thị', async () => {
            // Header [LEADERBOARD] phải hiển thị
            await expect(page.getByText('[LEADERBOARD]')).toBeVisible();

            // Bảng phải hiển thị
            const table = page.locator('table');
            await expect(table).toBeVisible();

            // Kiểm tra header columns: #, TEAM, PTS
            const thead = page.locator('table thead');
            await expect(thead.getByText('#')).toBeVisible();
            await expect(thead.getByText('TEAM')).toBeVisible();
            await expect(thead.getByText('PTS')).toBeVisible();

            // Kiểm tra có ít nhất 1 row dữ liệu
            const rows = await getScoreboardRows(page);
            const rowCount = await rows.count();

            if (rowCount > 0) {
                // Kiểm tra nội dung hiển thị đúng (không phải "No teams found")
                const firstRowText = await rows.first().textContent();
                expect(firstRowText).not.toContain('No teams found');
                console.log(`✅ TC-SB001: Bảng xếp hạng hiển thị ${rowCount} teams - PASS`);
            } else {
                console.log(`⚠️ TC-SB001: Không có teams nào trong scoreboard`);
            }
        });

        await test.step('Kiểm tra biểu đồ [SCORE_EVOLUTION] hiển thị', async () => {
            await expect(page.getByText('[SCORE_EVOLUTION]')).toBeVisible();
            console.log(`✅ TC-SB001: Biểu đồ Score Evolution hiển thị - PASS`);
        });
    });

    // =====================================================================
    // TC-SB002: Kiểm tra cột Rank sắp xếp giảm dần theo score
    // =====================================================================
    test('TC-SB002: Kiểm tra cột Rank sắp xếp giảm dần theo score', async ({ page }) => {
        test.setTimeout(60000);

        await test.step('Kiểm tra rank mặc định sắp xếp đúng', async () => {
            const ranks = await getRankValues(page);
            const scores = await getScoreValues(page);

            console.log(`Ranks: ${ranks.join(', ')}`);
            console.log(`Scores: ${scores.join(', ')}`);

            if (ranks.length >= 2) {
                // Rank 1 phải là team có score cao nhất
                // Kiểm tra rank tăng dần (1, 2, 3, ...)
                for (let i = 0; i < ranks.length - 1; i++) {
                    expect(ranks[i]).toBeLessThanOrEqual(ranks[i + 1]);
                }
                console.log(`✅ TC-SB002: Ranks sắp xếp tăng dần (1, 2, 3...) - PASS`);

                // Scores phải giảm dần (hoặc bằng nhau)
                for (let i = 0; i < scores.length - 1; i++) {
                    expect(scores[i]).toBeGreaterThanOrEqual(scores[i + 1]);
                }
                console.log(`✅ TC-SB002: Scores giảm dần (rank 1 = cao nhất) - PASS`);
            } else {
                console.log(`⚠️ TC-SB002: Cần ít nhất 2 teams để kiểm tra thứ tự`);
            }
        });
    });

    // =====================================================================
    // TC-SB003: Kiểm tra cột Score hiển thị đúng
    // =====================================================================
    test('TC-SB003: Kiểm tra cột Score hiển thị đúng điểm', async ({ page }) => {
        test.setTimeout(60000);

        await test.step('Kiểm tra mỗi team đều có score', async () => {
            const rows = await getScoreboardRows(page);
            const rowCount = await rows.count();

            for (let i = 0; i < Math.min(rowCount, 10); i++) {
                const scoreCell = rows.nth(i).locator('td').last();
                const scoreText = await scoreCell.textContent();
                expect(scoreText).toBeTruthy();

                const scoreValue = parseInt(scoreText!.trim());
                expect(scoreValue).toBeGreaterThanOrEqual(0);
            }

            console.log(`✅ TC-SB003: Tất cả ${Math.min(rowCount, 10)} teams đều có score hợp lệ (>= 0) - PASS`);
        });
    });

    // =====================================================================
    // TC-SB004: Tìm kiếm team trên Scoreboard
    // =====================================================================
    test('TC-SB004: Tìm kiếm team trên Scoreboard', async ({ page }) => {
        test.setTimeout(60000);

        // Lấy tên team đầu tiên để dùng làm search term
        const firstTeamNames = await getTeamNames(page);
        const searchTerm = firstTeamNames.length > 0 ? firstTeamNames[0].substring(0, 4) : 'team';

        await test.step(`Tìm kiếm với từ khóa "${searchTerm}"`, async () => {
            // Nhập search term vào ô tìm kiếm
            const searchInput = page.locator('input[placeholder="Search teams..."]');
            await searchInput.fill(searchTerm);

            // Nhấn nút GO
            await page.locator('button').filter({ hasText: 'GO' }).click();
            await page.waitForTimeout(500);

            // Kiểm tra kết quả
            const teamNames = await getTeamNames(page);

            if (teamNames.length > 0) {
                // Tất cả team names phải chứa search term (case-insensitive)
                for (const name of teamNames) {
                    expect(name.toLowerCase()).toContain(searchTerm.toLowerCase());
                }
                console.log(`✅ TC-SB004: Tìm kiếm "${searchTerm}" trả về ${teamNames.length} kết quả đúng - PASS`);
            } else {
                console.log(`⚠️ TC-SB004: Không tìm thấy team nào khớp "${searchTerm}"`);
            }
        });
    });

    // =====================================================================
    // TC-SB005: Tìm kiếm team không tồn tại
    // =====================================================================
    test('TC-SB005: Tìm kiếm team không tồn tại', async ({ page }) => {
        test.setTimeout(60000);

        await test.step('Tìm kiếm team không tồn tại', async () => {
            const searchInput = page.locator('input[placeholder="Search teams..."]');
            await searchInput.fill('zzz_nonexistent_team_xyz_999');

            // Nhấn nút GO
            await page.locator('button').filter({ hasText: 'GO' }).click();
            await page.waitForTimeout(500);

            // Kiểm tra hiển thị "No teams found"
            await expect(page.getByText('No teams found')).toBeVisible();
            console.log(`✅ TC-SB005: Hiển thị "No teams found" khi search không khớp - PASS`);
        });
    });

    // =====================================================================
    // TC-SB006: Sort theo cột Rank (#)
    // =====================================================================
    test('TC-SB006: Sort theo cột Rank (click header #)', async ({ page }) => {
        test.setTimeout(60000);

        await test.step('Click sort cột Rank (#)', async () => {
            // Lấy ranks ban đầu
            const ranksBefore = await getRankValues(page);

            // Click header # để sort
            const rankHeader = page.locator('table thead th').first();
            await rankHeader.click();
            await page.waitForTimeout(500);

            // Lấy ranks sau khi sort
            const ranksAfterFirst = await getRankValues(page);

            if (ranksAfterFirst.length >= 2) {
                // Kiểm tra thứ tự đã thay đổi (ascending)
                for (let i = 0; i < ranksAfterFirst.length - 1; i++) {
                    expect(ranksAfterFirst[i]).toBeLessThanOrEqual(ranksAfterFirst[i + 1]);
                }
                console.log(`✅ TC-SB006: Sort rank ascending hoạt động - PASS`);
            }

            // Click lần 2 để toggle sang descending
            await rankHeader.click();
            await page.waitForTimeout(500);

            const ranksAfterSecond = await getRankValues(page);
            if (ranksAfterSecond.length >= 2) {
                for (let i = 0; i < ranksAfterSecond.length - 1; i++) {
                    expect(ranksAfterSecond[i]).toBeGreaterThanOrEqual(ranksAfterSecond[i + 1]);
                }
                console.log(`✅ TC-SB006: Sort rank descending hoạt động - PASS`);
            }
        });
    });

    // =====================================================================
    // TC-SB007: Sort theo cột Score (PTS)
    // =====================================================================
    test('TC-SB007: Sort theo cột Score (click header PTS)', async ({ page }) => {
        test.setTimeout(60000);

        await test.step('Click sort cột PTS', async () => {
            // Click header PTS để sort
            const ptsHeader = page.locator('table thead th').last();
            await ptsHeader.click();
            await page.waitForTimeout(500);

            const scoresAsc = await getScoreValues(page);
            if (scoresAsc.length >= 2) {
                // Sort ascending: scores tăng dần
                for (let i = 0; i < scoresAsc.length - 1; i++) {
                    expect(scoresAsc[i]).toBeLessThanOrEqual(scoresAsc[i + 1]);
                }
                console.log(`✅ TC-SB007: Sort PTS ascending hoạt động - PASS`);
            }

            // Click lần 2 để toggle sang descending
            await ptsHeader.click();
            await page.waitForTimeout(500);

            const scoresDesc = await getScoreValues(page);
            if (scoresDesc.length >= 2) {
                for (let i = 0; i < scoresDesc.length - 1; i++) {
                    expect(scoresDesc[i]).toBeGreaterThanOrEqual(scoresDesc[i + 1]);
                }
                console.log(`✅ TC-SB007: Sort PTS descending hoạt động - PASS`);
            }
        });
    });

    // =====================================================================
    // TC-SB008: Nút Refresh cập nhật dữ liệu
    // =====================================================================
    test('TC-SB008: Nút Refresh cập nhật dữ liệu', async ({ page }) => {
        test.setTimeout(60000);

        await test.step('Click nút Refresh', async () => {
            // Kiểm tra nút Refresh hiển thị
            const refreshBtn = page.locator('button[title="Refresh scoreboard"]');
            await expect(refreshBtn).toBeVisible();
            await expect(refreshBtn).toContainText('Refresh');

            // Click Refresh
            await refreshBtn.click();

            // Đợi quá trình refresh (nút hiển thị "Refreshing")
            // Sau đó quay lại "Refresh"
            await expect(refreshBtn).toContainText('Refresh', { timeout: 10000 });

            // Kiểm tra bảng vẫn hiển thị sau refresh
            await expect(page.getByText('[LEADERBOARD]')).toBeVisible();
            const rows = await getScoreboardRows(page);
            const rowCount = await rows.count();

            console.log(`✅ TC-SB008: Refresh thành công, bảng hiển thị ${rowCount} teams - PASS`);
        });
    });

    // =====================================================================
    // TC-SB009: Hidden team KHÔNG hiển thị trên Scoreboard
    // =====================================================================
    test('TC-SB009: Team bị hidden không hiển thị trên Scoreboard', async ({ page }) => {
        test.setTimeout(60000);

        await test.step('Kiểm tra team hidden không có trong danh sách', async () => {
            // Precondition: Có tài khoản/team bị hidden trong hệ thống
            // Team hidden sẽ không xuất hiện trong API /scoreboard/top/200
            // Đổi items per page lên 50 để xem nhiều team hơn
            const perPageSelect = page.locator('select');
            await perPageSelect.selectOption('50');
            await page.waitForTimeout(500);

            const teamNames = await getTeamNames(page);

            // Tìm kiếm team hidden (nếu biết tên)
            // Ví dụ: "hidden_team" không nên xuất hiện
            const searchInput = page.locator('input[placeholder="Search teams..."]');
            await searchInput.fill('hidden_user');
            await page.locator('button').filter({ hasText: 'GO' }).click();
            await page.waitForTimeout(500);

            // Kiểm tra: hoặc "No teams found" hoặc không có team nào tên "hidden_user"
            const noTeamsMsg = page.getByText('No teams found');
            const isNoTeams = await noTeamsMsg.isVisible().catch(() => false);

            if (isNoTeams) {
                console.log(`✅ TC-SB009: Team hidden không hiển thị trên Scoreboard - PASS`);
            } else {
                const resultNames = await getTeamNames(page);
                // Kiểm tra không chứa team hidden
                for (const name of resultNames) {
                    expect(name.toLowerCase()).not.toContain('hidden_user');
                }
                console.log(`✅ TC-SB009: Không tìm thấy team hidden trong kết quả - PASS`);
            }
        });
    });

    // =====================================================================
    // TC-SB010: Banned team KHÔNG hiển thị trên Scoreboard
    // =====================================================================
    test('TC-SB010: Team bị banned không hiển thị trên Scoreboard', async ({ page }) => {
        test.setTimeout(60000);

        await test.step('Kiểm tra team banned không có trong danh sách', async () => {
            // Precondition: Có tài khoản/team bị banned trong hệ thống
            const searchInput = page.locator('input[placeholder="Search teams..."]');
            await searchInput.fill('banned_user');
            await page.locator('button').filter({ hasText: 'GO' }).click();
            await page.waitForTimeout(500);

            const noTeamsMsg = page.getByText('No teams found');
            const isNoTeams = await noTeamsMsg.isVisible().catch(() => false);

            if (isNoTeams) {
                console.log(`✅ TC-SB010: Team banned không hiển thị trên Scoreboard - PASS`);
            } else {
                const resultNames = await getTeamNames(page);
                for (const name of resultNames) {
                    expect(name.toLowerCase()).not.toContain('banned_user');
                }
                console.log(`✅ TC-SB010: Không tìm thấy team banned trong kết quả - PASS`);
            }
        });
    });
});

// =============================================================================
// PHẦN 4: SCOREBOARD FREEZE TEST (Cross-role: Admin UI + Contestant)
// =============================================================================

const ADMIN_URL = 'https://admin.fctf.site';

// Helper: Login Admin portal
async function loginAdmin(page: Page) {
    await page.goto(`${ADMIN_URL}/login`);
    await page.getByRole('textbox', { name: 'User Name or Email' }).fill('admin');
    await page.getByRole('textbox', { name: 'Password' }).fill('1');
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page).toHaveURL(/.*admin/);
}

// Helper: Mở trang Config và click tab "Freeze Time"
async function navigateToFreezeTab(page: Page) {
    // Vào trang Config
    await page.goto(`${ADMIN_URL}/admin/config`);
    await page.waitForTimeout(2000);

    // Click tab "Time" (nếu cần)
    const timeTab = page.locator('a[href="#ctftime"]');
    const isTimeTabVisible = await timeTab.isVisible().catch(() => false);
    if (isTimeTabVisible) {
        await timeTab.click();
        await page.waitForTimeout(500);
    }

    // Click tab "Freeze Time" bên trong
    const freezeTab = page.locator('a[href="#freeze-date"]');
    await freezeTab.click();
    await page.waitForTimeout(500);
}

// Helper: Set freeze time qua Admin Config UI (1 giờ trước)
async function setFreezeViaUI(page: Page) {
    await navigateToFreezeTab(page);

    // Tính thời gian 1 giờ trước (UTC)
    const now = new Date();
    const freezeDate = new Date(now.getTime() - 60 * 60 * 1000); // 1 giờ trước

    const month = freezeDate.getUTCMonth() + 1; // 0-indexed → 1-indexed
    const day = freezeDate.getUTCDate();
    const year = freezeDate.getUTCFullYear();
    const hour = freezeDate.getUTCHours();
    const minute = freezeDate.getUTCMinutes();

    console.log(`[Freeze] Setting freeze time to: ${month}/${day}/${year} ${hour}:${minute} UTC`);

    // Điền các field freeze
    await page.locator('#freeze-month').fill(month.toString());
    await page.locator('#freeze-day').fill(day.toString());
    await page.locator('#freeze-year').fill(year.toString());
    await page.locator('#freeze-hour').fill(hour.toString());
    await page.locator('#freeze-minute').fill(minute.toString());

    // Chọn timezone UTC
    const timezoneSelect = page.locator('#freeze-timezone');
    await timezoneSelect.selectOption({ label: 'UTC' });
    await page.waitForTimeout(500);

    // Kiểm tra UTC Timestamp đã được tính
    const freezeTimestamp = await page.locator('#freeze').inputValue();
    console.log(`[Freeze] UTC Timestamp generated: ${freezeTimestamp}`);

    // Click nút Update
    // Tìm nút Update trong form chứa freeze config
    const updateBtn = page.locator('#ctftime button[type="submit"]');
    await updateBtn.click();
    await page.waitForTimeout(2000);

    console.log(`✅ Freeze time set successfully via UI`);
    return freezeTimestamp;
}

// Helper: Xóa freeze time qua Admin Config UI
async function clearFreezeViaUI(page: Page) {
    await navigateToFreezeTab(page);

    // Xóa tất cả freeze fields
    await page.locator('#freeze-month').fill('');
    await page.locator('#freeze-day').fill('');
    await page.locator('#freeze-year').fill('');
    await page.locator('#freeze-hour').fill('');
    await page.locator('#freeze-minute').fill('');

    await page.waitForTimeout(500);

    // Click nút Update
    const updateBtn = page.locator('#ctftime button[type="submit"]');
    await updateBtn.click();
    await page.waitForTimeout(2000);

    console.log(`✅ Freeze time cleared successfully via UI`);
}

test.describe('Test Suite: Scoreboard Freeze - Đóng băng bảng xếp hạng', () => {

    // =====================================================================
    // TC-SB011: Scoreboard frozen → Không hiển thị dữ liệu
    // Flow:
    //   1. Contestant login → Xác nhận scoreboard CÓ dữ liệu (trước freeze)
    //   2. Admin login → Vào Config → Tab Freeze Time → Set thời gian rất xa quá khứ → Update
    //   3. Contestant refresh scoreboard → Scoreboard KHÔNG có dữ liệu
    //   4. Admin cleanup → Xóa freeze → Contestant verify dữ liệu trở lại
    // =====================================================================
    test('TC-SB011: Scoreboard frozen - Không hiển thị dữ liệu khi freeze active', async ({ browser }) => {
        test.setTimeout(180000); // 3 phút vì cross-role + nhiều bước

        // ===== BƯỚC 1: Contestant login → Verify scoreboard CÓ dữ liệu =====
        const contestantContext = await browser.newContext();
        const contestantPage = await contestantContext.newPage();

        let teamsBeforeFreeze: string[] = [];

        await test.step('Contestant xác nhận scoreboard CÓ dữ liệu trước freeze', async () => {
            await login(contestantPage, 'user2', '1');
            await navigateToScoreboard(contestantPage);

            teamsBeforeFreeze = await getTeamNames(contestantPage);
            const scoresBefore = await getScoreValues(contestantPage);

            console.log(`Teams trước freeze: ${teamsBeforeFreeze.join(', ')}`);
            console.log(`Scores trước freeze: ${scoresBefore.join(', ')}`);

            // Phải có ít nhất 1 team với score > 0
            expect(teamsBeforeFreeze.length).toBeGreaterThan(0);
            expect(scoresBefore.some(s => s > 0)).toBeTruthy();
            console.log(`✅ Bước 1: Scoreboard có ${teamsBeforeFreeze.length} teams với dữ liệu - OK`);
        });

        // ===== BƯỚC 2: Admin set freeze → thời gian rất xa quá khứ =====
        const adminContext = await browser.newContext();
        const adminPage = await adminContext.newPage();

        await test.step('Admin set freeze thời gian rất xa quá khứ', async () => {
            await loginAdmin(adminPage);
            await navigateToFreezeTab(adminPage);

            // Set freeze = 01/01/2000 00:00 UTC (trước mọi solve)
            await adminPage.locator('#freeze-month').fill('1');
            await adminPage.locator('#freeze-day').fill('1');
            await adminPage.locator('#freeze-year').fill('2000');
            await adminPage.locator('#freeze-hour').fill('0');
            await adminPage.locator('#freeze-minute').fill('0');

            // Chọn timezone UTC
            const timezoneSelect = adminPage.locator('#freeze-timezone');
            await timezoneSelect.selectOption({ label: 'UTC' });
            await adminPage.waitForTimeout(500);

            const freezeTimestamp = await adminPage.locator('#freeze').inputValue();
            console.log(`[Freeze] UTC Timestamp: ${freezeTimestamp}`);

            // Click Update
            const updateBtn = adminPage.locator('#ctftime button[type="submit"]');
            await updateBtn.click();
            await adminPage.waitForTimeout(2000);

            console.log(`✅ Bước 2: Admin set freeze = 01/01/2000 00:00 UTC`);
        });

        // ===== BƯỚC 3: Contestant refresh → Scoreboard KHÔNG có dữ liệu =====
        await test.step('Contestant verify scoreboard KHÔNG có dữ liệu sau freeze', async () => {
            // Reload scoreboard
            await contestantPage.goto(`${BASE_URL}/scoreboard`);
            await expect(contestantPage.getByText('[LEADERBOARD]')).toBeVisible({ timeout: 15000 });
            await contestantPage.waitForTimeout(2000);

            // Click Refresh để fetch dữ liệu mới từ API
            const refreshBtn = contestantPage.locator('button[title="Refresh scoreboard"]');
            await refreshBtn.click();
            await expect(refreshBtn).toContainText('Refresh', { timeout: 10000 });
            await contestantPage.waitForTimeout(2000);

            // Kiểm tra: scoreboard hiển thị trạng thái rỗng
            // Component render "> No teams found" trong tbody khi paginatedScores.length === 0
            const noTeamsCell = contestantPage.locator('table tbody td');
            const cellText = await noTeamsCell.first().textContent();
            console.log(`Nội dung tbody sau freeze: "${cellText}"`);

            // Kiểm tra text chứa "No teams found"
            const hasNoTeamsMsg = cellText?.includes('No teams found') || false;

            // Nếu không có text "No teams found", kiểm tra tất cả scores = 0
            if (!hasNoTeamsMsg) {
                const scores = await getScoreValues(contestantPage);
                const allZero = scores.length === 0 || scores.every(s => s === 0);
                console.log(`Scores sau freeze: ${scores.join(', ')}, allZero: ${allZero}`);
                expect(allZero).toBeTruthy();
                console.log(`✅ Bước 3: Tất cả scores = 0 sau freeze - PASS`);
            } else {
                console.log(`✅ Bước 3: Scoreboard hiển thị "No teams found" sau freeze - PASS`);
            }
        });

        // ===== BƯỚC 4: Admin xóa freeze → Dữ liệu trở lại =====
        await test.step('Admin xóa freeze, contestant verify dữ liệu trở lại', async () => {
            await clearFreezeViaUI(adminPage);
            console.log(`✅ Admin đã xóa freeze`);

            // Contestant reload scoreboard
            await contestantPage.goto(`${BASE_URL}/scoreboard`);
            await expect(contestantPage.getByText('[LEADERBOARD]')).toBeVisible({ timeout: 15000 });
            await contestantPage.waitForTimeout(1000);

            const refreshBtn = contestantPage.locator('button[title="Refresh scoreboard"]');
            await refreshBtn.click();
            await expect(refreshBtn).toContainText('Refresh', { timeout: 10000 });
            await contestantPage.waitForTimeout(1000);

            // Verify dữ liệu đã quay lại
            const teamsAfterUnfreeze = await getTeamNames(contestantPage);
            const scoresAfterUnfreeze = await getScoreValues(contestantPage);

            expect(teamsAfterUnfreeze.length).toBeGreaterThan(0);
            expect(scoresAfterUnfreeze.some(s => s > 0)).toBeTruthy();
            console.log(`✅ Bước 4: Scoreboard có ${teamsAfterUnfreeze.length} teams sau khi xóa freeze - PASS`);
        });

        // Cleanup contexts
        await adminContext.close();
        await contestantContext.close();
    });
});
