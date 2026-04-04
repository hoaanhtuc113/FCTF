import { test, expect, Page } from '@playwright/test';

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

// Helper: Login
async function login(page: Page, user: string, pass: string) {
    await page.goto(`${BASE_URL}/login`);
    await page.locator("input[placeholder='input username...']").fill(user);
    await page.locator("input[placeholder='enter_password']").fill(pass);
    await page.locator("button[type='submit']").click();
    await page.waitForURL(/\/dashboard|challenges|tickets/);
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
    let page: Page;

    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
        // Login tài khoản user2 (Mật khẩu ban đầu: 1)
        await login(page, 'user2', '1');
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
