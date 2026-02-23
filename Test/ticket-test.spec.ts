import { test, expect, Page } from '@playwright/test';

// =============================================================================
// PHẦN 1: TYPE DEFINITIONS & BỘ DỮ LIỆU TEST CASES
// =============================================================================

interface ExpectedError {
    field: string;
    message: string;
}

interface TicketTestData {
    testCaseName: string;
    title: string;
    type: string; // 'Question' | 'Error' | 'Inform'
    description: string;
    shouldFail: boolean;
    expectedError?: ExpectedError;
    // Dùng cho TC trùng nội dung: cần tạo ticket trước rồi tạo lại
    isDuplicateTest?: boolean;
}

// ========== SUCCESS TEST CASES ==========

const successTestData: TicketTestData[] = [
    {
        testCaseName: 'TC-T001: Tạo ticket type Question thành công',
        title: 'Question_Ticket_Test',
        type: 'Question',
        description: 'Đây là câu hỏi về challenge web, không biết cách kết nối docker container.',
        shouldFail: false
    },
    {
        testCaseName: 'TC-T002: Tạo ticket type Error thành công',
        title: 'Error_Ticket_Test',
        type: 'Error',
        description: 'Báo lỗi: challenge crypto bị crash khi submit flag đúng, hệ thống không ghi nhận.',
        shouldFail: false
    },
    {
        testCaseName: 'TC-T003: Tạo ticket type Inform thành công',
        title: 'Inform_Ticket_Test',
        type: 'Inform',
        description: 'Thông báo: đã phát hiện lỗ hổng trong challenge reverse engineering, cần update đề.',
        shouldFail: false
    },
    {
        testCaseName: 'TC-T004: Tạo ticket với title dài (255 ký tự)',
        title: 'A'.repeat(255),
        type: 'Question',
        description: 'Test tạo ticket với title có độ dài tối đa cho phép (255 ký tự).',
        shouldFail: false
    },
    {
        testCaseName: 'TC-T005: Tạo ticket với description dài',
        title: 'Long_Description_Test',
        type: 'Error',
        description: 'Lorem ipsum dolor sit amet. '.repeat(50).trim(),
        shouldFail: false
    }
];

// ========== VALIDATION ERROR TEST CASES ==========

const validationErrorData: TicketTestData[] = [
    {
        testCaseName: 'TC-T101: Thiếu title (bỏ trống)',
        title: '',
        type: 'Question',
        description: 'Test thiếu title - phải hiển thị lỗi required',
        shouldFail: true,
        expectedError: {
            field: 'title',
            message: 'Please fill out this field.'
        }
    },
    {
        testCaseName: 'TC-T102: Thiếu description (bỏ trống)',
        title: 'Missing_Description_Test',
        type: 'Error',
        description: '',
        shouldFail: true,
        expectedError: {
            field: 'description',
            message: 'Please fill out this field.'
        }
    }
];

// ========== DUPLICATE TEST CASES ==========

const duplicateTestData: TicketTestData[] = [
    {
        testCaseName: 'TC-T201: Tạo ticket trùng nội dung (similarity >= 30%)',
        title: 'Duplicate_Content_Test',
        type: 'Question',
        description: 'Nội dung trùng lặp để kiểm tra chức năng chống spam ticket với similarity check.',
        shouldFail: true,
        isDuplicateTest: true,
        expectedError: {
            field: 'api',
            message: 'similar ticket'
        }
    }
];

// Gộp tất cả test data
const allTestData: TicketTestData[] = [
    ...successTestData,
    ...validationErrorData,
    ...duplicateTestData
];

// =============================================================================
// PHẦN 2: HELPER FUNCTIONS
// =============================================================================

// Helper: Đăng nhập contestant
async function loginContestant(page: Page) {
    await test.step('Login Contestant', async () => {
        await page.goto('https://contestant.fctf.site/login');
        await page.locator("input[placeholder='input username...']").fill('user1');
        await page.locator("input[placeholder='enter_password']").fill('1');
        await page.locator("button[type='submit']").click();

        // Đợi trang chính load xong (xuất hiện nút Tickets trong sidebar)
        await page.waitForSelector('xpath=//button[contains(., "Tickets")]', { timeout: 60000 });
    });
}

// Helper: Navigate đến trang Tickets
async function navigateToTickets(page: Page) {
    await test.step('Navigate to Tickets page', async () => {
        // Click nút Tickets trong sidebar
        await page.locator('xpath=//button[contains(., "Tickets")]').click();
        await page.waitForTimeout(2000);

        // Đợi trang Tickets load xong - kiểm tra header [SUPPORT_TICKETS]
        await page.waitForSelector('text=[SUPPORT_TICKETS]', { timeout: 10000 });
    });
}

// Helper: Mở modal tạo ticket
async function openCreateTicketModal(page: Page) {
    await test.step('Open Create Ticket Modal', async () => {
        // Click nút [+] NEW TICKET
        await page.locator('button', { hasText: 'NEW TICKET' }).click();
        await page.waitForTimeout(500);

        // Đợi modal xuất hiện - kiểm tra header [CREATE_TICKET]
        await page.waitForSelector('text=[CREATE_TICKET]', { timeout: 5000 });
    });
}

// Helper: Điền form tạo ticket
async function fillTicketForm(page: Page, data: TicketTestData, uniqueTitle: string) {
    await test.step('Fill Ticket Form', async () => {
        // Điền title
        if (data.title !== undefined) {
            await page.locator('input#title').fill(uniqueTitle);
        }

        // Chọn type
        if (data.type) {
            await page.locator('select#type').selectOption(data.type);
        }

        // Điền description
        if (data.description !== undefined) {
            await page.locator('textarea#description').fill(data.description);
        }
    });
}

// Helper: Click nút submit tạo ticket
async function submitTicket(page: Page) {
    await test.step('Submit Ticket', async () => {
        await page.locator('button[type="submit"]', { hasText: 'CREATE TICKET' }).click();
        await page.waitForTimeout(1500);
    });
}

// Helper: Kiểm tra Swal alert message
async function checkSwalAlert(page: Page, expectedMessage: string): Promise<boolean> {
    try {
        // Swal popup có class .swal2-popup
        const swalPopup = page.locator('.swal2-popup');
        const visible = await swalPopup.isVisible().catch(() => false);

        if (visible) {
            const swalText = await swalPopup.textContent();
            if (swalText?.toLowerCase().includes(expectedMessage.toLowerCase())) {
                return true;
            }
        }

        return false;
    } catch {
        return false;
    }
}

// Helper: Kiểm tra HTML5 validation error
async function checkHTML5Validation(page: Page, fieldSelector: string, expectedMessage: string): Promise<boolean> {
    try {
        const field = page.locator(fieldSelector);
        const validationMessage = await field.evaluate((node: any) => {
            if (node.validationMessage) {
                return node.validationMessage;
            }
            return '';
        });

        if (validationMessage && validationMessage.length > 0) {
            return validationMessage.toLowerCase().includes(expectedMessage.toLowerCase());
        }

        return false;
    } catch {
        return false;
    }
}

// Helper: Kiểm tra validation error (HTML5 hoặc Swal)
async function checkValidationError(page: Page, data: TicketTestData): Promise<boolean> {
    if (!data.expectedError) return false;

    const fieldMap: Record<string, string> = {
        'title': 'input#title',
        'description': 'textarea#description',
        'type': 'select#type'
    };

    // Trường hợp backend error (API response) → kiểm tra Swal alert
    if (data.expectedError.field === 'api') {
        return await checkSwalAlert(page, data.expectedError.message);
    }

    // Trường hợp HTML5 validation
    const selector = fieldMap[data.expectedError.field];
    if (selector) {
        return await checkHTML5Validation(page, selector, data.expectedError.message);
    }

    return false;
}

// Helper: Verify ticket xuất hiện trong danh sách
async function verifyTicketInList(page: Page, ticketTitle: string): Promise<boolean> {
    try {
        // Đợi danh sách tickets load
        await page.waitForTimeout(2000);

        // Tìm row chứa ticket title trong bảng
        const ticketRow = page.locator('tr', { hasText: ticketTitle });
        const count = await ticketRow.count();
        return count > 0;
    } catch {
        return false;
    }
}

// =============================================================================
// PHẦN 3: TEST SUITE
// =============================================================================

test.describe('Test Suite: Tạo Ticket - Validation Đầy Đủ', () => {

    // Login và navigate đến trang Tickets trước mỗi test
    test.beforeEach(async ({ page }: { page: Page }) => {
        await loginContestant(page);
        await navigateToTickets(page);
    });

    // Chạy test cho từng bộ dữ liệu
    for (const data of allTestData) {
        test(`${data.testCaseName}`, async ({ page }: { page: Page }) => {
            test.setTimeout(120000); // 2 minutes timeout

            // Tạo tên unique để tránh trùng lặp giữa các lần chạy test
            let uniqueTitle = data.title ? `${data.title}_${Date.now()}` : data.title;

            try {
                // ===== XỬ LÝ ĐẶC BIỆT CHO DUPLICATE TEST =====
                if (data.isDuplicateTest) {
                    // Bước 1: Tạo ticket đầu tiên (phải thành công)
                    await test.step('Create first ticket (for duplicate test)', async () => {
                        await openCreateTicketModal(page);
                        const firstTitle = `First_${uniqueTitle}`;
                        await fillTicketForm(page, {
                            ...data,
                            title: firstTitle,
                            shouldFail: false
                        }, firstTitle);
                        await submitTicket(page);

                        // Chờ Swal success tự đóng
                        await page.waitForTimeout(3000);

                        // Verify ticket đầu tiên được tạo
                        const swalSuccess = await checkSwalAlert(page, 'successfully');
                        if (!swalSuccess) {
                            // Đợi modal đóng bởi success alert
                            await page.waitForTimeout(2000);
                        }
                    });

                    // Bước 2: Tạo ticket thứ hai với cùng description (phải thất bại)
                    await test.step('Create duplicate ticket', async () => {
                        await openCreateTicketModal(page);
                        const secondTitle = `Second_${uniqueTitle}`;
                        await fillTicketForm(page, data, secondTitle);
                        await submitTicket(page);

                        // Kiểm tra error message từ backend
                        await page.waitForTimeout(2000);
                        const hasError = await checkSwalAlert(page, data.expectedError!.message);

                        if (hasError) {
                            console.log(`✅ ${data.testCaseName}: Đã bắt được lỗi trùng nội dung - PASS`);
                            return;
                        } else {
                            throw new Error(`Expected error "${data.expectedError!.message}" but none found`);
                        }
                    });

                    return; // Kết thúc test cho duplicate case
                }

                // ===== FLOW TEST BÌNH THƯỜNG =====

                // BƯỚC 1: Mở modal tạo ticket
                await openCreateTicketModal(page);

                // BƯỚC 2: Điền form
                await fillTicketForm(page, data, uniqueTitle);

                // BƯỚC 3: Click submit
                await submitTicket(page);

                // BƯỚC 4: Kiểm tra kết quả
                if (data.shouldFail) {
                    // --- TRƯỜNG HỢP EXPECTED FAIL ---
                    const hasError = await checkValidationError(page, data);

                    if (hasError) {
                        console.log(`✅ ${data.testCaseName}: Đã bắt được lỗi validation - PASS`);
                        return;
                    } else {
                        throw new Error(
                            `Expected validation error for field "${data.expectedError?.field}" ` +
                            `with message "${data.expectedError?.message}" but none found`
                        );
                    }
                }

                // --- TRƯỜNG HỢP EXPECTED SUCCESS ---

                // BƯỚC 5: Verify Swal success alert
                await test.step('Verify success alert', async () => {
                    await expect(async () => {
                        const hasSuccess = await checkSwalAlert(page, 'successfully');
                        expect(hasSuccess).toBeTruthy();
                    }).toPass({
                        intervals: [1000],
                        timeout: 10000
                    });
                });

                // BƯỚC 6: Đợi Swal tự đóng + modal đóng
                await page.waitForTimeout(3000);

                // BƯỚC 7: Verify ticket xuất hiện trong danh sách
                await test.step('Verify ticket in list', async () => {
                    // Tìm trong bảng tickets (có thể cần search)
                    const searchInput = page.locator('input[placeholder="Search tickets..."]');
                    if (await searchInput.isVisible()) {
                        // Dùng phần tên gốc (không có timestamp) để search, tránh quá dài
                        const searchTerm = data.title.length > 30
                            ? data.title.substring(0, 30)
                            : uniqueTitle;
                        await searchInput.fill(searchTerm);
                        await page.waitForTimeout(1000);
                    }

                    await expect(async () => {
                        const searchName = data.title.length > 30
                            ? data.title.substring(0, 30)
                            : uniqueTitle;
                        const found = await verifyTicketInList(page, searchName);
                        expect(found).toBeTruthy();
                    }).toPass({
                        intervals: [2000],
                        timeout: 15000
                    });

                    // Verify type hiển thị đúng
                    const searchName = data.title.length > 30
                        ? data.title.substring(0, 30)
                        : uniqueTitle;
                    const ticketRow = page.locator('tr', { hasText: searchName }).first();
                    await expect(ticketRow).toContainText(data.type);

                    // Verify status mặc định là "open" hoặc "Open"
                    await expect(ticketRow).toContainText(/open/i);

                    console.log(`✅ ${data.testCaseName}: Ticket tạo thành công và hiển thị trong danh sách - PASS`);
                });

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
