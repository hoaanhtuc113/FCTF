import { test, expect, Page, Browser } from '@playwright/test';

// =============================================================================
// PHẦN 1: TYPE DEFINITIONS & BỘ DỮ LIỆU TEST CASES
// =============================================================================

interface ChangePassTestData {
    testCaseName: string;
    oldPass: string;
    newPass: string;
    confirmPass: string;
    shouldFail: boolean;
    expectedToast?: string;
    isFrontendValidation?: boolean;
    note?: string;
}

/**
 * LƯU Ý: Các test case được chạy theo trình tự (serialized).
 * TC-CP001 đổi mật khẩu từ 'User@123' thành 'User@111'.
 * Do đó các TC sau đó sẽ sử dụng 'User@111' làm mật khẩu hiện tại.
 */
const allTestData: ChangePassTestData[] = [
    {
        testCaseName: 'TC-CP001: Đổi mật khẩu thành công (Hợp lệ)',
        oldPass: '1',
        newPass: 'User@111',
        confirmPass: 'User@111',
        shouldFail: false,
        expectedToast: 'Password changed successfully',
        note: 'Đổi từ 1 -> User@111'
    },
    {
        testCaseName: 'TC-CP002: Thất bại - Sai mật khẩu hiện tại',
        oldPass: 'User@Wrong',
        newPass: 'User@123',
        confirmPass: 'User@123',
        shouldFail: true,
        expectedToast: 'Old password is incorrect',
        note: 'Dùng pass cũ hoặc pass sai'
    },
    {
        testCaseName: 'TC-CP003: Thất bại - Xác nhận mật khẩu không khớp',
        oldPass: 'User@111',
        newPass: 'User@1234',
        confirmPass: 'User@123',
        shouldFail: true,
        isFrontendValidation: true,
        note: 'Confirm pass khác New pass'
    },
    {
        testCaseName: 'TC-CP004: Thất bại - Thiếu chữ hoa (Uppercase)',
        oldPass: 'User@111',
        newPass: 'user@1234',
        confirmPass: 'user@1234',
        shouldFail: true,
        expectedToast: 'Password does not meet all security requirements',
        note: 'Toàn bộ chữ thường'
    },
    {
        testCaseName: 'TC-CP005: Thất bại - Thiếu chữ thường (Lowercase)',
        oldPass: 'User@111',
        newPass: 'USER@111',
        confirmPass: 'USER@111',
        shouldFail: true,
        expectedToast: 'Password does not meet all security requirements',
        note: 'Toàn bộ chữ hoa'
    },
    {
        testCaseName: 'TC-CP006: Thất bại - Thiếu số (Number)',
        oldPass: 'User@111',
        newPass: 'User@aaaa',
        confirmPass: 'User@aaaa',
        shouldFail: true,
        expectedToast: 'Password does not meet all security requirements',
        note: 'Không có số'
    },
    {
        testCaseName: 'TC-CP007: Thất bại - Thiếu ký tự đặc biệt',
        oldPass: 'User@111',
        newPass: 'User11111',
        confirmPass: 'User11111',
        shouldFail: true,
        expectedToast: 'Password does not meet all security requirements',
        note: 'Chỉ có chữ và số'
    },
    {
        testCaseName: 'TC-CP008: Thất bại - Độ dài quá ngắn (< 8)',
        oldPass: 'User@111',
        newPass: 'Us@1',
        confirmPass: 'Us@1',
        shouldFail: true,
        expectedToast: 'New password must be at least 8 characters long',
        note: 'Độ dài 4 ký tự'
    },
    {
        testCaseName: 'TC-CP009: Thành công - Ký tự Unicode',
        oldPass: 'User@111',
        newPass: 'User@123éàô',
        confirmPass: 'User@123éàô',
        shouldFail: false,
        expectedToast: 'Password changed successfully',
        note: 'Test hỗ trợ tiếng Việt/Unicode (User@111 -> User@123éàô)'
    },
    {
        testCaseName: 'TC-CP010: Thất bại - XSS Payload',
        oldPass: 'User@123éàô',
        newPass: '<script>alert(1)</script>',
        confirmPass: '<script>alert(1)</script>',
        shouldFail: true,
        expectedToast: 'Password does not meet all security requirements',
        note: 'Script tag thường bị chặn bởi criteria (thiếu số hoặc hoa)'
    },
    {
        testCaseName: 'TC-CP011: Thất bại - SQL Injection attempt',
        oldPass: 'User@123éàô',
        newPass: "' OR '1'='1",
        confirmPass: "' OR '1'='1",
        shouldFail: true,
        expectedToast: 'Password does not meet all security requirements',
        note: 'SQLi payload'
    },
    {
        testCaseName: 'TC-CP012: Thất bại - Password cực dài (1000+ chars)',
        oldPass: 'User@123éàô',
        newPass: 'A'.repeat(1000) + '1@a',
        confirmPass: 'A'.repeat(1000) + '1@a',
        shouldFail: true,
        note: 'Test giới hạn xử lý chuỗi dài'
    }
];

// =============================================================================
// PHẦN 2: HELPER FUNCTIONS
// =============================================================================

const BASE_URL = 'https://contestant0.fctf.site';
const CONTESTANT_API_URL = 'https://api0.fctf.site/api';
const ADMIN_URL = 'https://admin0.fctf.site';
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = '1';

async function loginContestantViaApi(page: Page, username: string, password: string): Promise<boolean> {
    const result = await page.evaluate(async ({ username, password, defaultApiBase }) => {
        const runtimeApi = (window as { __ENV__?: { VITE_API_URL?: string } }).__ENV__?.VITE_API_URL;
        const candidates = Array.from(new Set(
            [runtimeApi, defaultApiBase]
                .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                .map((item) => item.replace(/\/+$/, ''))
        ));
        const loginPaths = ['/auth/login-contestant', '/Auth/login-contestant'];
        const errors: string[] = [];

        for (const apiBase of candidates) {
            for (const loginPath of loginPaths) {
                try {
                    const response = await fetch(`${apiBase}${loginPath}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                        body: JSON.stringify({ username, password }),
                    });
                    const rawText = await response.text();
                    let body: {
                        generatedToken?: string;
                        token?: string;
                        user?: unknown;
                        data?: { token?: string; generatedToken?: string; user?: unknown };
                    } | null = null;
                    try {
                        body = JSON.parse(rawText);
                    } catch {
                        body = null;
                    }

                    const token = body?.generatedToken ?? body?.data?.generatedToken ?? body?.data?.token ?? body?.token ?? null;
                    const userInfo = body?.user ?? body?.data?.user ?? null;

                    if (response.ok && token) {
                        localStorage.setItem('auth_token', token);
                        if (userInfo) {
                            localStorage.setItem('user_info', JSON.stringify(userInfo));
                        }
                        return { ok: true, apiBase, loginPath, status: response.status, errors };
                    }

                    errors.push(`base=${apiBase} path=${loginPath} status=${response.status} raw=${rawText.slice(0, 200)}`);
                } catch (error) {
                    errors.push(`base=${apiBase} path=${loginPath} error=${String(error)}`);
                }
            }
        }

        return { ok: false, errors };
    }, { username, password, defaultApiBase: CONTESTANT_API_URL });

    if (result?.ok !== true) {
        const errorPreview = Array.isArray(result?.errors) ? result.errors.slice(0, 3).join(' | ') : 'unknown API login error';
        console.log(`⚠️ API login failed for ${username}: ${errorPreview}`);
    }

    return result?.ok === true;
}

async function loginAdminForSetup(page: Page, retries = 3): Promise<void> {
    for (let i = 0; i < retries; i++) {
        try {
            await page.goto(`${ADMIN_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });

            if (/\/admin(\/|$)/.test(new URL(page.url()).pathname)) {
                return;
            }

            const usernameInput = page.locator('#name, input[name="name"]').first();
            const passwordInput = page.locator('#password, input[name="password"]').first();
            const submitButton = page.locator('#_submit, button[type="submit"], input[type="submit"]').first();

            await usernameInput.waitFor({ state: 'visible', timeout: 15000 });
            await usernameInput.fill(ADMIN_USERNAME);
            await passwordInput.fill(ADMIN_PASSWORD);

            await Promise.all([
                page.waitForURL((url) => /\/admin(\/|$)/.test(url.pathname), { timeout: 30000 }),
                submitButton.click(),
            ]);

            return;
        } catch (e) {
            if (i === retries - 1) {
                throw e;
            }
            await page.waitForTimeout(1500 * (i + 1));
        }
    }
}

async function resolveContestantUserIdFromAdminApi(page: Page, username: string): Promise<number> {
    const normalized = username.trim().toLowerCase();
    const candidates = [
        `${ADMIN_URL}/api/v1/users?field=name&q=${encodeURIComponent(username)}&page=1&per_page=100`,
        `${ADMIN_URL}/api/v1/users?page=1&per_page=500`,
    ];

    for (const endpoint of candidates) {
        try {
            const response = await page.request.get(endpoint);
            if (!response.ok()) {
                continue;
            }

            const body = await response.json().catch(() => null) as { data?: Array<{ id?: number; name?: string }> } | null;
            const users = Array.isArray(body?.data) ? body.data : [];

            const found = users.find((u) => typeof u?.id === 'number' && typeof u?.name === 'string' && u.name.toLowerCase() === normalized);
            if (found?.id) {
                return found.id;
            }
        } catch {
            // Try next candidate endpoint
        }
    }

    throw new Error(`Cannot resolve user id for ${username} via admin API.`);
}

async function patchContestantPasswordViaAdmin(page: Page, userId: number, nextPassword: string): Promise<void> {
    await page.goto(`${ADMIN_URL}/admin/users/${userId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const result = await page.evaluate(async ({ userId, nextPassword, adminBaseUrl }) => {
        const csrfToken = (window as { init?: { csrfNonce?: string } }).init?.csrfNonce || '';
        const response = await fetch(`${adminBaseUrl}/api/v1/users/${userId}`, {
            method: 'PATCH',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'CSRF-Token': csrfToken,
            },
            body: JSON.stringify({ password: nextPassword }),
        });

        const rawText = await response.text();
        let body: { success?: boolean; message?: string } | null = null;
        try {
            body = JSON.parse(rawText);
        } catch {
            body = null;
        }

        return {
            status: response.status,
            body,
            rawText: rawText.slice(0, 300),
        };
    }, { userId, nextPassword, adminBaseUrl: ADMIN_URL });

    if (result.status !== 200 || !result.body?.success) {
        throw new Error(`PATCH /api/v1/users/${userId} failed: status=${result.status}, raw=${result.rawText}`);
    }
}

async function ensureContestantPasswordBaseline(browser: Browser, username: string, baselinePassword: string): Promise<boolean> {
    const adminPage = await browser.newPage();

    try {
        await loginAdminForSetup(adminPage);
        const userId = await resolveContestantUserIdFromAdminApi(adminPage, username);
        await patchContestantPasswordViaAdmin(adminPage, userId, baselinePassword);
        console.log(`✅ Baseline password reset via admin for ${username}`);
        return true;
    } catch (e) {
        console.log(`⚠️ Baseline reset via admin failed: ${(e as Error).message}`);
        return false;
    } finally {
        await adminPage.close();
    }
}

// Helper: Login
async function login(page: Page, user: string, pass: string) {
    const usernameCandidates = [user];

    // Step 1: Go to login page
    await page.goto(`${BASE_URL}/login`, { timeout: 60000 });

    // Step 2: Try UI form login first
    try {
        await page.locator("input[placeholder='input username...']").waitFor({ state: 'visible', timeout: 15000 });
        await page.locator("input[placeholder='input username...']").fill(user);
        await page.locator("input[placeholder='enter_password']").fill(pass);
        await page.locator("button[type='submit']").click();
        await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30000 });
        console.log(`✅ Contestant logged in as ${user}: ${page.url()}`);
        return;
    } catch (e) {
        console.log(`⚠️ UI login failed for ${user}: ${(e as Error).message.substring(0, 100)}`);
    }

    // Step 3: API login fallback (sets localStorage token + page.reload)
    console.log('🔄 Trying API-based login as fallback...');
    await page.goto(`${BASE_URL}/login`, { timeout: 60000 });

    for (const username of usernameCandidates) {
        const ok = await loginContestantViaApi(page, username, pass);
        if (ok) {
            console.log(`✅ API login succeeded for ${username}, navigating to dashboard...`);
            await page.goto(`${BASE_URL}/dashboard`, { timeout: 30000 });
            if (page.url().includes('/login')) {
                console.log(`⚠️ API login token not accepted for ${username}, trying next...`);
                continue;
            }
            return;
        }
    }

    console.log('🔄 Falling back to UI form login with original username...');
    for (let i = 0; i < 2; i++) {
        try {
            await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.locator("input[placeholder='input username...']").waitFor({ state: 'visible', timeout: 15000 });
            await page.locator("input[placeholder='input username...']").fill(user);
            await page.locator("input[placeholder='enter_password']").fill(pass);
            await page.locator("button[type='submit']").click();
            await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30000 });
            console.log(`✅ UI form login succeeded: ${page.url()}`);
            return;
        } catch (e) {
            if (i === 1) throw e;
            await page.waitForTimeout(5000);
        }
    }
}

// Helper: Đi tới Profile
async function navigateToProfile(page: Page) {
    // Click Avatar
    await page.locator('.MuiAvatar-root').first().click();
    // Click Profile item
    await page.getByText('Profile').click();
    await expect(page).toHaveURL(/\/profile/);
}

// Helper: Mở modal đổi pass
async function openChangePasswordModal(page: Page) {
    await page.getByText('CHANGE PASSWORD').click();
    // Chờ modal xuất hiện
    await expect(page.getByText('[CHANGE_PASSWORD]')).toBeVisible();
}

// Helper: Điền form đổi pass
async function fillChangePassForm(page: Page, oldPass: string, newPass: string, confirmPass: string) {
    // 1. Tìm ô mật khẩu hiện tại (input đầu tiên trong modal) và focus
    const currentInput = page.locator('input[type="password"], input[type="text"]').first();
    await currentInput.waitFor({ state: 'visible' });
    await currentInput.click(); // Đảm bảo focus

    // Xóa trắng và điền mật khẩu hiện tại
    await currentInput.fill('');
    await currentInput.fill(oldPass);
    console.log(`- Filled Current Password: ${oldPass}`);

    // 2. Tab 2 lần để tới New Password (theo cấu trúc UI có nút toggle ở giữa)
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    // Dùng type hoặc insertText để mô phỏng người dùng nhập và trigger criteria check
    await page.keyboard.press('Control+A'); // Xóa text cũ nếu có
    await page.keyboard.press('Backspace');
    // Với chuỗi dài > 100 ký tự, dùng insertText cho nhanh để tránh timeout, ngược lại dùng type để trigger event
    if (newPass.length > 100) {
        await page.keyboard.insertText(newPass);
    } else {
        await page.keyboard.type(newPass);
    }
    console.log(`- Inputted New Password: ${newPass.slice(0, 20)}${newPass.length > 20 ? '...' : ''}`);

    // 3. Tab 2 lần để tới Confirm New Password
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    if (confirmPass.length > 100) {
        await page.keyboard.insertText(confirmPass);
    } else {
        await page.keyboard.type(confirmPass);
    }
    console.log(`- Inputted Confirm New Password: ${confirmPass.slice(0, 20)}${confirmPass.length > 20 ? '...' : ''}`);

    // Đợi UI cập nhật trạng thái lỗi khớp password hoặc criteria
    await page.waitForTimeout(500);
}

// Helper: Submit đổi pass
async function submitChangePass(page: Page) {
    // Từ ô Confirm Password, cần tab 3 lần để tới nút CHANGE PASSWORD
    // 1: Nút toggle của Confirm, 2: Nút CANCEL, 3: Nút CHANGE PASSWORD
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    // Nhấn Enter để submit
    await page.keyboard.press('Enter');
    console.log('- Pressed Enter to submit change password');
}

// Helper: Kiểm tra SweetAlert2 (Swal)
async function checkSwalAlert(page: Page, expectedMessage: string): Promise<boolean> {
    try {
        console.log(`Checking for Swal alert containing: "${expectedMessage}"`);
        const swalPopup = page.locator('.swal2-popup');
        await swalPopup.waitFor({ state: 'visible', timeout: 5000 });
        const content = await swalPopup.textContent();
        console.log(`- Found Swal content: "${content?.trim()}"`);

        if (content && content.toLowerCase().includes(expectedMessage.toLowerCase())) {
            console.log(`✅ MATCH FOUND`);
            return true;
        }
        console.log(`❌ NO MATCH FOUND`);
        return false;
    } catch (e) {
        console.log(`❌ Swal not found or error: ${e}`);
        return false;
    }
}

// =============================================================================
// PHẦN 3: TEST SUITE
// =============================================================================

// Chúng ta dùng serial để các TC đổi password có thể kế thừa mật khẩu mới từ TC trước
test.describe.serial('Chức năng: Thay đổi mật khẩu (Change Password)', () => {
    test.setTimeout(180000); // 180 seconds timeout for the tests
    let page: Page;

    test.beforeAll(async ({ browser }) => {
        test.setTimeout(180000); // Explicitly increase timeout for the hook itself
        page = await browser.newPage();

        // Must navigate to the site first so that page.evaluate fetch avoids cross-origin CORS errors from about:blank
        await page.goto(`${BASE_URL}/login`, { timeout: 60000 });

        const baselinePassword = '1';
        const baselineResetOk = await ensureContestantPasswordBaseline(browser, 'user2', baselinePassword);

        let currentPass = '';
        let loggedIn = false;

        if (baselineResetOk) {
            for (let attempt = 1; attempt <= 3; attempt++) {
                console.log(`🔄 Pre-flight: Verifying baseline password via API (attempt ${attempt}/3)`);
                const ok = await loginContestantViaApi(page, 'user2', baselinePassword);
                if (ok) {
                    currentPass = baselinePassword;
                    loggedIn = true;
                    console.log(`✅ Pre-flight baseline login successful with password: ${baselinePassword}`);
                    break;
                }
                await page.waitForTimeout(1000);
            }
        }

        if (!loggedIn) {
            const knownPasswords = ['1', 'User@111', 'User@123éàô', 'User@123', 'User11111'];
            for (const p of knownPasswords) {
                console.log(`🔄 Pre-flight fallback: Trying API login with pass: ${p}`);
                const ok = await loginContestantViaApi(page, 'user2', p);
                if (ok) {
                    currentPass = p;
                    loggedIn = true;
                    console.log(`✅ Pre-flight fallback successful! Current DB password is: ${p}`);
                    break;
                }
            }
        }

        if (!loggedIn) {
            // Last fallback: try UI login with baseline password in case API login endpoint is unhealthy.
            try {
                await login(page, 'user2', baselinePassword);
                currentPass = baselinePassword;
                loggedIn = true;
                console.log(`✅ Pre-flight UI fallback successful with baseline password.`);
            } catch {
                // Keep final error below for full context
            }
        }

        if (!loggedIn) {
            throw new Error(`Failed to login with any known password even after admin baseline reset. DB/auth service may be in an unknown state.`);
        }

        // Ensure token is present on this shared page, even if login succeeded via UI fallback.
        if (!(await loginContestantViaApi(page, 'user2', currentPass))) {
            await login(page, 'user2', currentPass);
        }

        // Navigate to dashboard using the token/session set by API/UI login
        await page.goto(`${BASE_URL}/dashboard`, { timeout: 30000 });
        if (page.url().includes('/login')) {
            // Fallback to UI login if API token wasn't persisted
            await login(page, 'user2', currentPass);
        }

        // If the password is ALREADY 'User@111', TC-CP001 will fail because it expects to change it TO 'User@111'.
        // We must change it to something else (e.g., 'User@123éàô') so TC-CP001 can successfully change it.
        if (currentPass === 'User@111') {
            console.log("⚠️ Current password is User@111, resetting to User@123éàô via UI so TC-CP001 can run properly.");
            await navigateToProfile(page);
            await openChangePasswordModal(page);
            await fillChangePassForm(page, currentPass, 'User@123éàô', 'User@123éàô');
            await submitChangePass(page);
            await page.waitForTimeout(1000);
            const closeBtn = page.locator('button:has-text("OK")');
            if (await closeBtn.isVisible().catch(() => false)) {
                await closeBtn.click();
            }
            await page.waitForTimeout(1000); // wait for modal to close fully
            currentPass = 'User@123éàô';
            await page.goto(`${BASE_URL}/dashboard`);
        }

        // Dynamically update the first test's oldPass so it works with the actual DB state
        allTestData[0].oldPass = currentPass;
    });

    test.afterAll(async () => {
        await page.close();
    });

    for (const data of allTestData) {
        test(data.testCaseName, async () => {
            await test.step('Navigate to Profile and Open Modal', async () => {
                await navigateToProfile(page);
                await openChangePasswordModal(page);
            });

            await test.step('Fill Form', async () => {
                console.log(`Filling form for case: ${data.testCaseName}`);
                await fillChangePassForm(page, data.oldPass, data.newPass, data.confirmPass);
                await page.waitForTimeout(1000); // Đợi UI cập nhật trạng thái
            });

            await test.step('Verify and Submit', async () => {
                // ĐẶC BIỆT: Cho CP003 chỉ cần check message trên modal
                if (data.testCaseName.includes('TC-CP003')) {
                    await expect(page.getByText('Passwords do not match')).toBeVisible();
                    console.log(`✅ ${data.testCaseName}: Tìm thấy message "Passwords do not match" - PASS`);
                    // Đóng modal
                    await page.locator('button').filter({ hasText: /^CANCEL$/ }).first().click();
                    return;
                }

                const submitBtn = page.locator('button').filter({ hasText: /^\[>\] CHANGE PASSWORD$/ }).last();
                const isDisabled = await submitBtn.isDisabled();

                if (isDisabled) {
                    if (!data.shouldFail) {
                        console.error(`❌ LỖI: Nút bị disable cho case ${data.testCaseName}`);
                        throw new Error(`Nút Change Password bị disable ngoài dự kiến cho dữ liệu hợp lệ!`);
                    } else {
                        console.log(`✅ ${data.testCaseName}: Nút bị disable (Đúng dự kiến) - PASS`);

                        // Nếu là frontend validation, kiểm tra xem có hiện message thông báo lỗi không
                        if (data.isFrontendValidation) {
                            await expect(page.getByText('Passwords do not match')).toBeVisible();
                            console.log(`✅ Tìm thấy message: Passwords do not match`);
                        }

                        // Đóng modal - Sử dụng selector đặc thù để tránh trùng với nút Cancel của Swal
                        await page.locator('button').filter({ hasText: /^CANCEL$/ }).first().click();
                        return;
                    }
                }

                await submitChangePass(page);

                if (data.shouldFail) {
                    const hasError = await checkSwalAlert(page, data.expectedToast || '');
                    expect(hasError).toBeTruthy();
                    // Click OK trên Swal
                    await page.locator('button:has-text("OK")').click();
                    // Đóng modal - Sử dụng selector đặc thù để tránh trùng với nút Cancel của Swal
                    await page.locator('button').filter({ hasText: /^CANCEL$/ }).first().click();
                } else {
                    const hasSuccess = await checkSwalAlert(page, data.expectedToast || 'successfully');
                    expect(hasSuccess).toBeTruthy();
                    // Đợi modal tự đóng (thành công modal sẽ đóng)
                    await expect(page.getByText('[CHANGE_PASSWORD]')).not.toBeVisible({ timeout: 5000 });
                    console.log(`✅ ${data.testCaseName}: SUCCESS - PASS`);
                }
            });
        });
    }
});
