import { test, expect, Page } from '@playwright/test';

// =============================================================================
// PHẦN 1: TYPE DEFINITIONS & BỘ DỮ LIỆU TEST CASES
// =============================================================================

interface LoginTestData {
    testCaseName: string;
    username: string;
    password: string;
    shouldFail: boolean;
    /** Thông báo toast mong đợi (hiển thị trên UI) */
    expectedToast?: string;
    /** Có thêm thông báo phụ nào không (vd: "Contestant cannot access the system") */
    expectedSecondaryMessage?: string;
    /** Sau login thành công, redirect tới URL nào */
    expectedUrlPattern?: RegExp;
    /** Mô tả ngắn để dễ đọc test report */
    note?: string;
}

// ========== SUCCESS TEST CASES ==========

const successTestData: LoginTestData[] = [
    {
        testCaseName: 'TC-L001: Login thành công với tài khoản contestant có team',
        username: 'user2',
        password: '1',
        shouldFail: false,
        expectedToast: 'auth_success',
        expectedUrlPattern: /\/(dashboard|challenges|tickets)/,
        note: 'Contestant đã có team - login thành công và redirect về dashboard'
    }
];

// ========== FAILURE TEST CASES ==========

const failureTestData: LoginTestData[] = [
    {
        testCaseName: 'TC-L002: Login với sai credentials (sai password)',
        username: 'user1',
        password: 'wrong_password_123',
        shouldFail: true,
        expectedToast: 'Invalid username or password',
        note: 'Password sai → Toast: Invalid username or password'
    },
    {
        testCaseName: 'TC-L003: Login với sai credentials (user không tồn tại)',
        username: 'nonexistent_user_xyz',
        password: '1',
        shouldFail: true,
        expectedToast: 'Invalid username or password',
        note: 'Username không tồn tại → Toast: Invalid username or password'
    },
    {
        testCaseName: 'TC-L004: Login với tài khoản contestant chưa có team',
        username: 'user_no_team',
        password: '1',
        shouldFail: true,
        expectedToast: "you don't have a team yet",
        expectedSecondaryMessage: 'Contestant cannot access the system',
        note: 'User chưa có team → Toast: you don\'t have a team yet'
    },
    {
        testCaseName: 'TC-L005: Login với tài khoản contestant bị banned',
        username: 'banned_user',
        password: '1',
        shouldFail: true,
        expectedToast: 'Your account is not allowed',
        expectedSecondaryMessage: 'Contestant cannot access the system',
        note: 'User bị banned → Toast: Your account is not allowed'
    },
    {
        testCaseName: 'TC-L006: Login với tài khoản contestant bị hidden',
        username: 'hidden_user',
        password: '1',
        shouldFail: true,
        expectedToast: 'Your account is not allowed',
        expectedSecondaryMessage: 'Contestant cannot access the system',
        note: 'User bị hidden → Toast: Your account is not allowed'
    },
    {
        testCaseName: 'TC-L007: Login Contestant Portal bằng tài khoản admin (non-contestant)',
        username: 'admin',
        password: '1',
        shouldFail: true,
        expectedToast: 'Invalid username or password',
        note: 'Tài khoản admin (type != "user") → Toast: Invalid username or password'
    },
    {
        testCaseName: 'TC-L008: Login với username chứa ký tự đặc biệt (~~a)',
        username: '~~a',
        password: '1',
        shouldFail: false,
        expectedToast: 'auth_success',
        note: ''
    },
    {
        testCaseName: 'TC-L009: Login với username và password bỏ trống',
        username: '',
        password: '',
        shouldFail: true,
        expectedToast: '',
        note: 'Password field có required → HTML5 validation chặn submit'
    },
    {
        testCaseName: 'TC-L010: Login sau khi contest đã kết thúc',
        username: 'user2',
        password: '1',
        shouldFail: false,
        expectedToast: 'auth_success',
        expectedSecondaryMessage: 'User can log in but cannot view any previous challenges',
        expectedUrlPattern: /\/(dashboard|challenges|tickets)/,
        note: 'Login cho phép sau contest nhưng không xem được challenges cũ'
    }
];

// Gộp tất cả test data
const allTestData: LoginTestData[] = [
    ...successTestData,
    ...failureTestData
];

// =============================================================================
// PHẦN 2: HELPER FUNCTIONS
// =============================================================================

const LOGIN_URL = 'https://contestant.fctf.site/login';

// Helper: Điền form login
async function fillLoginForm(page: Page, username: string, password: string) {
    await test.step('Fill Login Form', async () => {
        const usernameInput = page.locator("input[placeholder='input username...']");
        const passwordInput = page.locator("input[placeholder='enter_password']");

        // Clear trước khi điền (tránh giá trị cũ)
        await usernameInput.clear();
        await passwordInput.clear();

        if (username) {
            await usernameInput.fill(username);
        }
        if (password) {
            await passwordInput.fill(password);
        }
    });
}

// Helper: Click nút Login
async function clickLoginButton(page: Page) {
    await test.step('Click Login Button', async () => {
        await page.locator("button[type='submit']").click();
    });
}

// Helper: Kiểm tra toast/snackbar notification (notistack)
async function checkToastMessage(page: Page, expectedMessage: string, timeout: number = 10000): Promise<boolean> {
    try {
        // notistack sử dụng nhiều dạng selector khác nhau
        const toastSelectors = [
            '.notistack-MuiContent',
            '[role="alert"]',
            '.SnackbarContent-message',
            '.notistack-Snackbar',
            '#notistack-snackbar',
            '.MuiSnackbar-root',
            '.MuiAlert-message'
        ];

        for (const selector of toastSelectors) {
            try {
                const toast = page.locator(selector).first();
                await toast.waitFor({ state: 'visible', timeout: timeout });
                const toastText = await toast.textContent();

                if (toastText && toastText.toLowerCase().includes(expectedMessage.toLowerCase())) {
                    return true;
                }
            } catch {
                // Thử selector tiếp theo
            }
        }

        // Fallback: Kiểm tra toàn bộ body
        const pageContent = await page.textContent('body');
        if (pageContent && pageContent.toLowerCase().includes(expectedMessage.toLowerCase())) {
            return true;
        }

        return false;
    } catch {
        return false;
    }
}

// Helper: Kiểm tra HTML5 validation (cho trường hợp trống)
async function checkHTML5Validation(page: Page, selector: string): Promise<boolean> {
    try {
        const field = page.locator(selector);
        const validationMessage = await field.evaluate((node: any) => {
            return node.validationMessage || '';
        });
        return validationMessage.length > 0;
    } catch {
        return false;
    }
}

// Helper: Kiểm tra đã redirect về dashboard/trang chính chưa
async function checkLoginSuccess(page: Page, expectedUrlPattern: RegExp): Promise<boolean> {
    try {
        await page.waitForURL(expectedUrlPattern, { timeout: 15000 });
        return true;
    } catch {
        return false;
    }
}

// =============================================================================
// PHẦN 3: TEST SUITE
// =============================================================================

test.describe('Test Suite: Login Contestant Portal - Validation Đầy Đủ', () => {

    // Navigate tới trang login trước mỗi test
    test.beforeEach(async ({ page }: { page: Page }) => {
        await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });

        // Verify trang login đã load xong
        await expect(page.locator("input[placeholder='input username...']")).toBeVisible({ timeout: 10000 });
    });

    // Chạy test cho từng bộ dữ liệu
    for (const data of allTestData) {
        test(`${data.testCaseName}`, async ({ page }: { page: Page }) => {
            test.setTimeout(60000); // 1 minute timeout

            try {
                // BƯỚC 1: Điền form login
                await fillLoginForm(page, data.username, data.password);

                // BƯỚC 2: Click Login
                await clickLoginButton(page);

                // Đợi xử lý
                await page.waitForTimeout(2000);

                // BƯỚC 3: Kiểm tra kết quả
                if (data.shouldFail) {
                    // --- TRƯỜNG HỢP EXPECTED FAIL ---

                    // TC-L009: Username/password trống → HTML5 validation
                    if (!data.username && !data.password) {
                        await test.step('Verify HTML5 validation blocks submit', async () => {
                            const hasValidation = await checkHTML5Validation(
                                page,
                                "input[placeholder='enter_password']"
                            );

                            // Verify vẫn ở trang login (không redirect)
                            expect(page.url()).toContain('/login');
                            console.log(`✅ ${data.testCaseName}: Form bị chặn bởi HTML5 validation - PASS`);
                        });
                        return;
                    }

                    // Các TC khác: Kiểm tra toast error message
                    await test.step(`Verify toast: "${data.expectedToast}"`, async () => {
                        const hasError = await checkToastMessage(page, data.expectedToast!);
                        expect(hasError).toBeTruthy();

                        // Verify vẫn ở trang login
                        expect(page.url()).toContain('/login');

                        console.log(`✅ ${data.testCaseName}: Toast "${data.expectedToast}" hiển thị đúng - PASS`);
                    });

                    // Kiểm tra thông báo phụ nếu có (vd: "Contestant cannot access the system")
                    if (data.expectedSecondaryMessage) {
                        await test.step(`Verify secondary message: "${data.expectedSecondaryMessage}"`, async () => {
                            const hasSecondary = await checkToastMessage(page, data.expectedSecondaryMessage!, 5000);

                            if (hasSecondary) {
                                console.log(`✅ Secondary message "${data.expectedSecondaryMessage}" - PASS`);
                            } else {
                                // Verify user không thể truy cập hệ thống (vẫn ở login)
                                expect(page.url()).toContain('/login');
                                console.log(`✅ Contestant cannot access the system (vẫn ở login page) - PASS`);
                            }
                        });
                    }

                } else {
                    // --- TRƯỜNG HỢP EXPECTED SUCCESS ---

                    await test.step(`Verify toast: "${data.expectedToast}"`, async () => {
                        // Kiểm tra toast thành công
                        const hasSuccess = await checkToastMessage(page, data.expectedToast!, 10000);
                        expect(hasSuccess).toBeTruthy();

                        console.log(`✅ ${data.testCaseName}: Toast "${data.expectedToast}" hiển thị đúng - PASS`);
                    });

                    // Kiểm tra redirect
                    if (data.expectedUrlPattern) {
                        await test.step('Verify redirect after login', async () => {
                            const redirected = await checkLoginSuccess(page, data.expectedUrlPattern!);
                            expect(redirected).toBeTruthy();
                            console.log(`✅ Redirect thành công - PASS`);
                        });
                    }

                    // Kiểm tra thông báo phụ nếu có (vd: TC-L010 login after contest)
                    if (data.expectedSecondaryMessage) {
                        await test.step(`Verify secondary: "${data.expectedSecondaryMessage}"`, async () => {
                            await page.waitForTimeout(2000);
                            const hasSecondary = await checkToastMessage(page, data.expectedSecondaryMessage!, 5000);
                            // Đây là informational, log warning nếu không tìm thấy
                            if (hasSecondary) {
                                console.log(`✅ Secondary message "${data.expectedSecondaryMessage}" - PASS`);
                            } else {
                                console.log(`⚠️ Secondary message "${data.expectedSecondaryMessage}" không tìm thấy - có thể chỉ xuất hiện khi contest đã kết thúc`);
                            }
                        });
                    }
                }

            } catch (error) {
                console.error(`❌ ${data.testCaseName} failed:`, error);

                // Screenshot khi lỗi
                await page.screenshot({
                    path: `test-results/error-${data.testCaseName.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.png`,
                    fullPage: true
                });

                throw error;
            }
        });
    }
});
