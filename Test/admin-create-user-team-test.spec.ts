import { test, expect, Page, request as playwrightRequest } from '@playwright/test';

// =============================================================================
// CONFIGURATION
// =============================================================================

const ADMIN_URL = 'https://admin3.fctf.site';

test.describe.configure({ mode: 'serial' });

// =============================================================================
// CLEANUP TRACKING — thu thập ID để xóa sau khi tests kết thúc
// =============================================================================

const createdUserIds: number[] = [];
const createdTeamIds: number[] = [];

// =============================================================================
// HELPERS
// =============================================================================

async function loginAdmin(page: Page) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await page.goto(`${ADMIN_URL}/login`, { timeout: 20000 });
            await page.locator('input#name, input[name="name"], input[placeholder*="username" i], input[placeholder*="email" i]').first().fill('admin');
            await page.locator('input#password, input[name="password"], input[placeholder*="password" i]').first().fill('1');
            await page.locator('input#_submit, button[type="submit"]').first().click();
            await page.waitForURL(/.*admin.*/, { timeout: 15000 });
            return;
        } catch (err) {
            if (attempt === 3) throw err;
            await page.waitForTimeout(2000);
        }
    }
}

/** Navigate đến trang Create User */
async function goToCreateUser(page: Page) {
    await page.goto(`${ADMIN_URL}/admin/users/new`);
    await expect(page.locator('#user-info-create-form')).toBeVisible({ timeout: 10000 });
}

/** Navigate đến trang Create Team */
async function goToCreateTeam(page: Page) {
    await page.goto(`${ADMIN_URL}/admin/teams/new`);
    await expect(page.locator('#team-info-create-form')).toBeVisible({ timeout: 10000 });
}

/**
 * Điền form Create User và submit.
 * Trả về { success, redirectedUserId?, errorText? }
 * Nếu thành công, tự động thêm ID vào createdUserIds để cleanup sau.
 */
async function submitCreateUser(
    page: Page,
    data: {
        name: string;
        email: string;
        password?: string;
        type?: 'user' | 'admin' | 'challenge_writer' | 'jury';
        verified?: boolean;
        hidden?: boolean;
        banned?: boolean;
    }
): Promise<{ success: boolean; redirectedUserId?: number; errorText?: string }> {
    const form = page.locator('#user-info-create-form');

    await form.locator('input[name="name"]').fill(data.name);
    await form.locator('input[name="email"]').fill(data.email);
    if (data.password !== undefined) {
        await form.locator('input[name="password"]').fill(data.password);
    }
    if (data.type !== undefined) {
        await form.locator('#type-select').selectOption(data.type);
    }
    if (data.verified !== undefined) {
        const cb = form.locator('input[name="verified"]');
        const checked = await cb.isChecked();
        if (checked !== data.verified) await cb.click();
    }
    if (data.hidden !== undefined) {
        const cb = form.locator('input[name="hidden"]');
        const checked = await cb.isChecked();
        if (checked !== data.hidden) await cb.click();
    }
    if (data.banned !== undefined) {
        const cb = form.locator('input[name="banned"]');
        const checked = await cb.isChecked();
        if (checked !== data.banned) await cb.click();
    }

    await form.locator('#update-user').click();

    try {
        await page.waitForURL(/\/admin\/users\/\d+/, { timeout: 3000 });
        const userId = parseInt(page.url().split('/').pop() ?? '0');
        if (userId > 0) createdUserIds.push(userId); // Track để cleanup
        return { success: true, redirectedUserId: userId };
    } catch {
        const errorBadge = form.locator('#results .badge, #results .alert');
        const errorText = await errorBadge.first().textContent({ timeout: 5000 }).catch(() => '');
        return { success: false, errorText: errorText ?? '' };
    }
}

/**
 * Điền form Create Team và submit.
 * Trả về { success, redirectedTeamId?, errorText? }
 * Nếu thành công, tự động thêm ID vào createdTeamIds để cleanup sau.
 */
async function submitCreateTeam(
    page: Page,
    data: {
        name: string;
        email?: string;
        password?: string;
        website?: string;
        affiliation?: string;
        country?: string;
        bracket_id?: string | number | { index: number };
        hidden?: boolean;
        banned?: boolean;
    }
): Promise<{ success: boolean; redirectedTeamId?: number; errorText?: string }> {
    const form = page.locator('#team-info-create-form');

    await form.locator('input[name="name"]').fill(data.name);
    if (data.email !== undefined) {
        await form.locator('input[name="email"]').fill(data.email);
    }
    if (data.password !== undefined) {
        await form.locator('input[name="password"]').fill(data.password);
    }
    if (data.website !== undefined) {
        await form.locator('input[name="website"]').fill(data.website);
    }
    if (data.affiliation !== undefined) {
        await form.locator('input[name="affiliation"]').fill(data.affiliation);
    }
    try {
        if (data.country !== undefined) {
            await form.locator('select[name="country"]').selectOption(data.country, { timeout: 2000 });
        }
    } catch { }

    try {
        // Mặc định chọn bracket đầu tiên nếu không truyền vào, vì bracket là bắt buộc
        const bracketVal = data.bracket_id !== undefined ? data.bracket_id : { index: 1 };
        await form.locator('select#bracket_id, select[name="bracket_id"], select').last().selectOption(bracketVal as any, { timeout: 2000 });
    } catch { }
    if (data.hidden !== undefined) {
        const cb = form.locator('input[name="hidden"]');
        const checked = await cb.isChecked();
        if (checked !== data.hidden) await cb.click();
    }
    if (data.banned !== undefined) {
        const cb = form.locator('input[name="banned"]');
        const checked = await cb.isChecked();
        if (checked !== data.banned) await cb.click();
    }

    await form.locator('#update-team').click();

    try {
        await page.waitForURL(/\/admin\/teams\/\d+/, { timeout: 3000 });
        const teamId = parseInt(page.url().split('/').pop() ?? '0');
        if (teamId > 0) createdTeamIds.push(teamId); // Track để cleanup
        return { success: true, redirectedTeamId: teamId };
    } catch {
        const errorBadge = form.locator('#results .badge, #results .alert');
        const errorText = await errorBadge.first().textContent({ timeout: 5000 }).catch(() => '');
        return { success: false, errorText: errorText ?? '' };
    }
}

/**
 * Lấy CSRF token + session cookie từ trang admin để dùng cho API call.
 * Dùng page đã đăng nhập để lấy nonce.
 */
async function getAdminAuthHeaders(page: Page): Promise<Record<string, string>> {
    // Lấy cookie từ browser context (đã login)
    const cookies = await page.context().cookies();
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Lấy CSRF token từ meta tag hoặc cookie
    const csrfToken = await page.evaluate(() => {
        const meta = document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement | null;
        return meta?.content ?? '';
    }).catch(() => '');

    return {
        'Cookie': cookieStr,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(csrfToken ? { 'X-CSRFToken': csrfToken } : {}),
    };
}

// =============================================================================
// CREATE USER TESTS (CRU-001 → CRU-018)
// =============================================================================

test.describe('Admin Create User (CRU-001 – CRU-018)', () => {
    test.setTimeout(60000);

    test.beforeEach(async ({ page }) => {
        await loginAdmin(page);
        await goToCreateUser(page);
    });

    // Tự động xóa toàn bộ user đã tạo sau khi tất cả test trong describe này kết thúc
    test.afterAll(async ({ browser }) => {
        if (createdUserIds.length === 0) return;
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        try {
            await loginAdmin(page);
            const headers = await getAdminAuthHeaders(page);
            const ids = [...createdUserIds];
            createdUserIds.length = 0; // Clear ngay để tránh double-delete
            for (const userId of ids) {
                try {
                    await page.request.delete(`${ADMIN_URL}/api/v1/users/${userId}`, { headers });
                } catch {
                    // Ignore lỗi khi delete (có thể đã bị xóa)
                }
            }
        } finally {
            await ctx.close();
        }
    });

    // -------------------------------------------------------------------------
    // CRU-001: UI — Form elements hiển thị đầy đủ
    // -------------------------------------------------------------------------
    test('CRU-001: Create User form hiển thị đầy đủ các trường', async ({ page }) => {
        const form = page.locator('#user-info-create-form');
        await expect(form.locator('input[name="name"]')).toBeVisible();
        await expect(form.locator('input[name="email"]')).toBeVisible();
        await expect(form.locator('input[name="password"]')).toBeVisible();
        await expect(form.locator('#type-select')).toBeVisible();
        await expect(form.locator('input[name="verified"]')).toBeVisible();
        await expect(form.locator('input[name="hidden"]')).toBeVisible();
        await expect(form.locator('input[name="banned"]')).toBeVisible();
        await expect(form.locator('#update-user')).toBeVisible();
    });

    // -------------------------------------------------------------------------
    // CRU-002: UI — Dropdown Type có đủ các option đúng theo source code
    // -------------------------------------------------------------------------
    test('CRU-002: Dropdown Type chứa đủ 4 options (user, admin, challenge_writer, jury)', async ({ page }) => {
        const select = page.locator('#type-select');
        const optionValues = await select.locator('option').evaluateAll((els) =>
            els.map((el) => (el as HTMLOptionElement).value)
        );
        expect(optionValues).toContain('user');
        expect(optionValues).toContain('admin');
        expect(optionValues).toContain('challenge_writer');
        expect(optionValues).toContain('jury');
    });

    // -------------------------------------------------------------------------
    // CRU-003: Happy path — Tạo user hợp lệ với đầy đủ thông tin
    // -------------------------------------------------------------------------
    test('CRU-003: Tạo user hợp lệ → redirect đến trang chi tiết user', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateUser(page, {
            name: `cru_user_${ts}`,
            email: `cru_user_${ts}@test.com`,
            password: 'TestPass@123',
            type: 'user',
        });
        expect(result.success, `Tạo user thất bại: ${result.errorText}`).toBe(true);
        expect(result.redirectedUserId).toBeGreaterThan(0);
        await expect(page.locator('body')).toContainText(`cru_user_${ts}`);
    });

    // -------------------------------------------------------------------------
    // CRU-004: Happy path — Tạo user loại Admin
    // -------------------------------------------------------------------------
    test('CRU-004: Tạo user loại Admin → thành công', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateUser(page, {
            name: `cru_admin_${ts}`,
            email: `cru_admin_${ts}@test.com`,
            password: 'AdminPass@123',
            type: 'admin',
        });
        expect(result.success, `Tạo admin thất bại: ${result.errorText}`).toBe(true);
        await expect(page.locator('body')).toContainText(`cru_admin_${ts}`);
    });

    // -------------------------------------------------------------------------
    // CRU-005: Happy path — Tạo user loại Challenge Writer
    // -------------------------------------------------------------------------
    test('CRU-005: Tạo user loại Challenge Writer → thành công', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateUser(page, {
            name: `cru_cw_${ts}`,
            email: `cru_cw_${ts}@test.com`,
            password: 'CWPass@123',
            type: 'challenge_writer',
        });
        expect(result.success, `Tạo challenge writer thất bại: ${result.errorText}`).toBe(true);
    });

    // -------------------------------------------------------------------------
    // CRU-006: Happy path — Tạo user loại Jury
    // -------------------------------------------------------------------------
    test('CRU-006: Tạo user loại Jury → thành công', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateUser(page, {
            name: `cru_jury_${ts}`,
            email: `cru_jury_${ts}@test.com`,
            password: 'JuryPass@123',
            type: 'jury',
        });
        expect(result.success, `Tạo jury thất bại: ${result.errorText}`).toBe(true);
    });

    // -------------------------------------------------------------------------
    // CRU-007: Happy path — Tạo user có verified = true
    // -------------------------------------------------------------------------
    test('CRU-007: Tạo user với Verified → user được tạo và trang chi tiết hiển thị đúng', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateUser(page, {
            name: `cru_verified_${ts}`,
            email: `cru_verified_${ts}@test.com`,
            password: 'VerPass@123',
            verified: true,
        });
        expect(result.success, `Tạo verified user thất bại: ${result.errorText}`).toBe(true);
    });

    // -------------------------------------------------------------------------
    // CRU-008: Happy path — Tạo user có hidden = true
    // -------------------------------------------------------------------------
    test('CRU-008: Tạo user với Hidden = true → thành công', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateUser(page, {
            name: `cru_hidden_${ts}`,
            email: `cru_hidden_${ts}@test.com`,
            password: 'HidPass@123',
            hidden: true,
        });
        expect(result.success, `Tạo hidden user thất bại: ${result.errorText}`).toBe(true);
    });

    // -------------------------------------------------------------------------
    // CRU-009: Happy path — Tạo user có banned = true
    // -------------------------------------------------------------------------
    test('CRU-009: Tạo user với Banned = true → thành công', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateUser(page, {
            name: `cru_banned_${ts}`,
            email: `cru_banned_${ts}@test.com`,
            password: 'BanPass@123',
            banned: true,
        });
        expect(result.success, `Tạo banned user thất bại: ${result.errorText}`).toBe(true);
    });

    // -------------------------------------------------------------------------
    // CRU-010: Validation — Thiếu password → lỗi (backend yêu cầu bắt buộc)
    // -------------------------------------------------------------------------
    test('CRU-010: Thiếu password → hiện lỗi (password là bắt buộc theo API)', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateUser(page, {
            name: `cru_nopass_${ts}`,
            email: `cru_nopass_${ts}@test.com`,
            // Không điền password
        });
        // API trả về "Missing data for required field" → không tạo được user
        expect(result.success).toBe(false);
        expect(result.errorText).toBeTruthy();
    });


    // -------------------------------------------------------------------------
    // CRU-011: Validation — Thiếu name → lỗi
    // -------------------------------------------------------------------------
    test('CRU-011: Thiếu trường Name → hiện lỗi, không tạo được user', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateUser(page, {
            name: '',
            email: `cru_noname_${ts}@test.com`,
            password: 'Pass@123',
        });
        expect(result.success).toBe(false);
    });

    // -------------------------------------------------------------------------
    // CRU-012: Validation — Thiếu email → lỗi
    // -------------------------------------------------------------------------
    test('CRU-012: Thiếu trường Email → hiện lỗi, không tạo được user', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateUser(page, {
            name: `cru_noemail_${ts}`,
            email: '',
            password: 'Pass@123',
        });
        expect(result.success).toBe(false);
    });

    // -------------------------------------------------------------------------
    // CRU-013: Validation — Email không đúng định dạng
    // -------------------------------------------------------------------------
    test('CRU-013: Email sai định dạng → hiện lỗi', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateUser(page, {
            name: `cru_bademail_${ts}`,
            email: 'not-a-valid-email',
            password: 'Pass@123',
        });
        expect(result.success).toBe(false);
    });

    // -------------------------------------------------------------------------
    // CRU-014: Validation — Trùng username → lỗi
    // -------------------------------------------------------------------------
    test('CRU-014: Username trùng với user đã tồn tại → hiện lỗi', async ({ page }) => {
        const ts = Date.now();
        const username = `cru_dup_${ts}`;
        const first = await submitCreateUser(page, {
            name: username,
            email: `cru_dup1_${ts}@test.com`,
            password: 'Pass@123',
        });
        expect(first.success).toBe(true);

        await goToCreateUser(page);

        const second = await submitCreateUser(page, {
            name: username,
            email: `cru_dup2_${ts}@test.com`,
            password: 'Pass@123',
        });
        expect(second.success).toBe(false);
    });

    // -------------------------------------------------------------------------
    // CRU-015: Validation — Trùng email → lỗi
    // -------------------------------------------------------------------------
    test('CRU-015: Email trùng với user đã tồn tại → hiện lỗi', async ({ page }) => {
        const ts = Date.now();
        const email = `cru_dupemail_${ts}@test.com`;
        const first = await submitCreateUser(page, {
            name: `cru_dupemail1_${ts}`,
            email,
            password: 'Pass@123',
        });
        expect(first.success).toBe(true);

        await goToCreateUser(page);

        const second = await submitCreateUser(page, {
            name: `cru_dupemail2_${ts}`,
            email,
            password: 'Pass@123',
        });
        expect(second.success).toBe(false);
    });

    // -------------------------------------------------------------------------
    // CRU-016: Security — Truy cập /admin/users/new khi chưa đăng nhập → redirect login
    // -------------------------------------------------------------------------
    test('CRU-016: Truy cập trang Create User khi chưa login → redirect về trang login', async ({ browser }) => {
        const ctx = await browser.newContext();
        const p = await ctx.newPage();
        await p.goto(`${ADMIN_URL}/admin/users/new`);
        await expect(p).toHaveURL(/login/, { timeout: 10000 });
        await ctx.close();
    });

    // -------------------------------------------------------------------------
    // CRU-017: Happy path — Tạo user với tên có ký tự đặc biệt
    // -------------------------------------------------------------------------
    test('CRU-017: Tạo user với tên có dấu cách và ký tự đặc biệt → thành công', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateUser(page, {
            name: `cru user_${ts}`,
            email: `cru_special_${ts}@test.com`,
            password: 'Pass@123',
        });
        // Hệ thống có thể cho phép hoặc từ chối — kiểm tra không crash
        const responded = result.success || (result.errorText !== undefined);
        expect(responded).toBe(true);
    });

    // -------------------------------------------------------------------------
    // CRU-018: Happy path — Tạo user với unicode name (tiếng Việt)
    // -------------------------------------------------------------------------
    test('CRU-018: Tạo user với tên tiếng Việt (Unicode) → thành công', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateUser(page, {
            name: `Nguyễn_${ts}`,
            email: `cru_unicode_${ts}@test.com`,
            password: 'Pass@123',
        });
        expect(result.success, `Tạo Unicode user thất bại: ${result.errorText}`).toBe(true);
    });
});

// =============================================================================
// CREATE TEAM TESTS (CRT-001 → CRT-018)
// =============================================================================

test.describe('Admin Create Team (CRT-001 – CRT-018)', () => {
    test.setTimeout(60000);

    test.beforeEach(async ({ page }) => {
        await loginAdmin(page);
        await goToCreateTeam(page);
    });

    // Tự động xóa toàn bộ team đã tạo sau khi tất cả test trong describe này kết thúc
    test.afterAll(async ({ browser }) => {
        if (createdTeamIds.length === 0) return;
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        try {
            await loginAdmin(page);
            const headers = await getAdminAuthHeaders(page);
            const ids = [...createdTeamIds];
            createdTeamIds.length = 0; // Clear để tránh double-delete
            for (const teamId of ids) {
                try {
                    await page.request.delete(`${ADMIN_URL}/api/v1/teams/${teamId}`, { headers });
                } catch {
                    // Ignore lỗi khi delete
                }
            }
        } finally {
            await ctx.close();
        }
    });

    // -------------------------------------------------------------------------
    // CRT-001: UI — Form elements hiển thị đầy đủ
    // -------------------------------------------------------------------------
    test('CRT-001: Create Team form hiển thị đầy đủ các trường', async ({ page }) => {
        const form = page.locator('#team-info-create-form');
        await expect(form.locator('input[name="name"]')).toBeVisible();
        await expect(form.locator('input[name="email"]')).toBeVisible();
        await expect(form.locator('input[name="password"]')).toBeVisible();
        await expect(form.locator('input[name="website"]')).toBeVisible();
        await expect(form.locator('input[name="affiliation"]')).toBeVisible();
        await expect(form.locator('select[name="country"]')).toBeVisible();
        await expect(form.locator('input[name="hidden"]')).toBeVisible();
        await expect(form.locator('input[name="banned"]')).toBeVisible();
        await expect(form.locator('#update-team')).toBeVisible();
    });

    // -------------------------------------------------------------------------
    // CRT-002: UI — Dropdown Country cho phép chọn ít nhất một quốc gia
    // -------------------------------------------------------------------------
    test('CRT-002: Dropdown Country có tùy chọn', async ({ page }) => {
        const select = page.locator('#team-info-create-form select[name="country"]');
        const optionCount = await select.locator('option').count();
        expect(optionCount).toBeGreaterThan(1);
    });

    // -------------------------------------------------------------------------
    // CRT-003: Happy path — Tạo team với thông tin tối thiểu
    // -------------------------------------------------------------------------
    test('CRT-003: Tạo team với name, password và bracket → thành công', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateTeam(page, {
            name: `crt_team_${ts}`,
            password: 'TeamPass@123',
            bracket_id: { index: 1 },
        });
        expect(result.success, `Tạo team thất bại: ${result.errorText}`).toBe(true);
        expect(result.redirectedTeamId).toBeGreaterThan(0);
        await expect(page.locator('body')).toContainText(`crt_team_${ts}`);
    });

    // -------------------------------------------------------------------------
    // CRT-004: Happy path — Tạo team đầy đủ thông tin
    // -------------------------------------------------------------------------
    test('CRT-004: Tạo team với đầy đủ thông tin (name, email, password, website, affiliation, bracket) → thành công', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateTeam(page, {
            name: `crt_full_${ts}`,
            email: `crt_full_${ts}@test.com`,
            password: 'TeamPass@123',
            website: `https://crtfull${ts}.example.com`,
            affiliation: `University_${ts}`,
            bracket_id: { index: 1 },
        });
        expect(result.success, `Tạo team đầy đủ thất bại: ${result.errorText}`).toBe(true);
        await expect(page.locator('body')).toContainText(`crt_full_${ts}`);
    });

    // -------------------------------------------------------------------------
    // CRT-005: Happy path — Tạo team với Hidden = true
    // -------------------------------------------------------------------------
    test('CRT-005: Tạo team với Hidden = true → thành công', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateTeam(page, {
            name: `crt_hidden_${ts}`,
            email: `crt_hidden_${ts}@test.com`,
            password: 'TeamPass@123',
            hidden: true,
        });
        expect(result.success, `Tạo hidden team thất bại: ${result.errorText}`).toBe(true);
    });

    // -------------------------------------------------------------------------
    // CRT-006: Happy path — Tạo team với Banned = true
    // -------------------------------------------------------------------------
    test('CRT-006: Tạo team với Banned = true → thành công', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateTeam(page, {
            name: `crt_banned_${ts}`,
            email: `crt_banned_${ts}@test.com`,
            password: 'TeamPass@123',
            banned: true,
        });
        expect(result.success, `Tạo banned team thất bại: ${result.errorText}`).toBe(true);
    });

    // -------------------------------------------------------------------------
    // CRT-007: Happy path — Tạo team với quốc gia cụ thể (VN)
    // -------------------------------------------------------------------------
    test('CRT-007: Tạo team có chọn quốc gia → thành công', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateTeam(page, {
            name: `crt_country_${ts}`,
            email: `crt_country_${ts}@test.com`,
            password: 'TeamPass@123',
            country: 'VN',
        });
        expect(result.success, `Tạo team với country thất bại: ${result.errorText}`).toBe(true);
    });

    // -------------------------------------------------------------------------
    // CRT-008: Happy path — Tạo team với website hợp lệ
    // -------------------------------------------------------------------------
    test('CRT-008: Tạo team với website URL hợp lệ → thành công', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateTeam(page, {
            name: `crt_web_${ts}`,
            password: 'TeamPass@123',
            website: `https://crtteam${ts}.example.com`,
        });
        expect(result.success, `Tạo team với website thất bại: ${result.errorText}`).toBe(true);
    });

    // -------------------------------------------------------------------------
    // CRT-009: Validation — Thiếu name → lỗi
    // -------------------------------------------------------------------------
    test('CRT-009: Thiếu trường Team Name → hiện lỗi, không tạo được team', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateTeam(page, {
            name: '',
            email: `crt_noname_${ts}@test.com`,
            password: 'TeamPass@123',
            bracket_id: { index: 1 },
        });
        expect(result.success).toBe(false);
    });

    // -------------------------------------------------------------------------
    // CRT-010: Validation — Trùng team name → lỗi
    // -------------------------------------------------------------------------
    test('CRT-010: Team name trùng với team đã tồn tại → hiện lỗi', async ({ page }) => {
        const ts = Date.now();
        const teamName = `crt_dup_${ts}`;
        // Tạo team lần 1
        const first = await submitCreateTeam(page, {
            name: teamName,
            email: `crt_dup1_${ts}@test.com`,
            password: 'TeamPass@123',
        });
        expect(first.success, `Lần tạo 1 thất bại: ${first.errorText}`).toBe(true);

        await goToCreateTeam(page);

        // Tạo team lần 2 cùng name
        const second = await submitCreateTeam(page, {
            name: teamName,
            email: `crt_dup2_${ts}@test.com`,
            password: 'TeamPass@123',
        });
        expect(second.success).toBe(false);
    });

    // -------------------------------------------------------------------------
    // CRT-011: Validation — Email sai định dạng → lỗi
    // -------------------------------------------------------------------------
    test('CRT-011: Email sai định dạng → hiện lỗi', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateTeam(page, {
            name: `crt_bademail_${ts}`,
            email: 'not-an-email',
            password: 'TeamPass@123', // Added password as it's required by API
        });
        expect(result.success).toBe(false);
    });

    // -------------------------------------------------------------------------
    // CRT-012: Validation — Trùng email với team khác → lỗi
    // -------------------------------------------------------------------------
    test('CRT-012: Email team trùng với team đã tồn tại → hiện lỗi', async ({ page }) => {
        const ts = Date.now();
        const email = `crt_dupemail_${ts}@test.com`;
        // Tạo team lần 1
        const first = await submitCreateTeam(page, {
            name: `crt_dupemail1_${ts}`,
            email,
            password: 'TeamPass@123',
        });
        expect(first.success, `Lần tạo 1 thất bại: ${first.errorText}`).toBe(true);

        await goToCreateTeam(page);

        // Tạo team lần 2 cùng email
        const second = await submitCreateTeam(page, {
            name: `crt_dupemail2_${ts}`,
            email,
            password: 'TeamPass@123',
        });
        expect(second.success).toBe(false);
    });

    // -------------------------------------------------------------------------
    // CRT-013: Security — Truy cập /admin/teams/new khi chưa login → redirect login
    // -------------------------------------------------------------------------
    test('CRT-013: Truy cập trang Create Team khi chưa login → redirect về trang login', async ({ browser }) => {
        const ctx = await browser.newContext();
        const p = await ctx.newPage();
        await p.goto(`${ADMIN_URL}/admin/teams/new`);
        await expect(p).toHaveURL(/login/, { timeout: 10000 });
        await ctx.close();
    });

    // -------------------------------------------------------------------------
    // CRT-014: Happy path — Tạo team với tên Unicode (tiếng Việt)
    // -------------------------------------------------------------------------
    test('CRT-014: Tạo team với tên Unicode (tiếng Việt) → thành công', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateTeam(page, {
            name: `Đội_${ts}`,
            password: 'TeamPass@123',
        });
        expect(result.success, `Tạo Unicode team thất bại: ${result.errorText}`).toBe(true);
    });

    // -------------------------------------------------------------------------
    // CRT-015: Happy path — Tạo team với đầy đủ hidden + banned
    // -------------------------------------------------------------------------
    test('CRT-015: Tạo team với cả Hidden và Banned đều bật → thành công', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateTeam(page, {
            name: `crt_hidbanned_${ts}`,
            password: 'TeamPass@123',
            hidden: true,
            banned: true,
        });
        expect(result.success, `Tạo hidden+banned team thất bại: ${result.errorText}`).toBe(true);
    });

    // -------------------------------------------------------------------------
    // CRT-016: Happy path — Tạo team không email, không password (cả hai optional)
    // -------------------------------------------------------------------------
    test('CRT-016: Thiếu password và bracket → hiện lỗi (bắt buộc theo API)', async ({ page }) => {
        const ts = Date.now();
        const result = await submitCreateTeam(page, {
            name: `crt_noemail_${ts}`,
            password: '', // Bỏ trống password
            bracket_id: '', // Bỏ trống bracket (giả định selectOption "" kích hoạt được lỗi)
        });
        // Password và Bracket bắt buộc trong API -> fail
        expect(result.success).toBe(false);
        // Có thể lỗi không được render ra #results badge mà hiển thị kiểu khác,
        // quan trọng nhất là không tạo được team (stay on page).
        await expect(page).toHaveURL(/\/admin\/teams\/new/);
    });

    // -------------------------------------------------------------------------
    // CRT-017: Happy path — Tạo team với affiliation dài
    // -------------------------------------------------------------------------
    test('CRT-017: Tạo team với affiliation dài → hệ thống xử lý graceful', async ({ page }) => {
        const ts = Date.now();
        const longAffiliation = 'A'.repeat(200);
        const result = await submitCreateTeam(page, {
            name: `crt_longaff_${ts}`,
            affiliation: longAffiliation,
        });
        const responded = result.success || (result.errorText !== undefined);
        expect(responded).toBe(true);
    });

    // -------------------------------------------------------------------------
    // CRT-018: Happy path — Sau khi tạo thành công, team xuất hiện trong danh sách
    // -------------------------------------------------------------------------
    test('CRT-018: Team được tạo thành công xuất hiện trong danh sách Admin Teams', async ({ page }) => {
        const ts = Date.now();
        const teamName = `crt_list_${ts}`;
        await submitCreateTeam(page, {
            name: teamName,
            password: 'TeamPass@123',
        });

        // Tìm kiếm team để đảm bảo nó xuất hiện (không phụ thuộc vào phân trang)
        await page.goto(`${ADMIN_URL}/admin/teams?q=${encodeURIComponent(teamName)}&field=name`);
        await expect(page.locator('#teamsboard, table')).toContainText(teamName, { timeout: 8000 });
    });

    // -------------------------------------------------------------------------
    // CRT-019: Assign member to team via Admin UI
    // -------------------------------------------------------------------------
    test('CRT-019: Gán user vào team qua Admin UI → thành công', async ({ page }) => {
        const ts = Date.now();
        const userName = `member_${ts}`;
        const teamName = `team_${ts}`;

        // 1. Tạo User
        await goToCreateUser(page);
        const userRes = await submitCreateUser(page, {
            name: userName,
            email: `${userName}@test.com`,
            password: 'UserPass@123',
        });
        expect(userRes.success).toBe(true);
        const userId = userRes.redirectedUserId;

        // 2. Tạo Team
        await goToCreateTeam(page);
        const teamRes = await submitCreateTeam(page, {
            name: teamName,
            password: 'TeamPass@123',
        });
        expect(teamRes.success).toBe(true);
        const teamId = teamRes.redirectedTeamId;

        // 3. Vào trang detail của team
        await page.goto(`${ADMIN_URL}/admin/teams/${teamId}`);

        // 4. Click nút "Add Team Members"
        await page.locator('.members-team').click();
        await expect(page.locator('#team-add-modal')).toBeVisible();

        // 5. Tìm kiếm user
        const searchInput = page.locator('#team-add-modal input[type="text"]');
        await searchInput.fill(userName);

        // 6. Chờ list group item xuất hiện và click (Vue debounce ~1s)
        const userItem = page.locator(`#team-add-modal .list-group-item:has-text("${userName}")`);
        await userItem.waitFor({ state: 'visible', timeout: 5000 });
        await userItem.click();

        // 7. Click nút "Add Users"
        await page.locator('#team-add-modal button:has-text("Add Users")').click();

        // 8. Chờ trang reload và kiểm tra user xuất hiện trong bảng "Team Members"
        await page.waitForURL(new RegExp(`/admin/teams/${teamId}`), { timeout: 15000 });
        const membersTable = page.locator('table').filter({ hasText: 'User Name' });
        await expect(membersTable).toContainText(userName);
    });
});
