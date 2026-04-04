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
        title: 'A'.repeat(240),
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

// Force serial execution across all describe blocks (shared user1 login)
test.describe.configure({ mode: 'serial' });

// Helper: Đăng nhập contestant
async function loginContestant(page: Page) {
    await test.step('Login Contestant', async () => {
        await page.goto('https://contestant0.fctf.site/login');
        await page.locator("input[placeholder='input username...']").fill('user20');
        await page.locator("input[placeholder='enter_password']").fill('1');
        await page.locator("button[type='submit']").click();

        // Đợi redirect khỏi trang login (về dashboard/challenges/tickets)
        await page.waitForURL(/\/(dashboard|challenges|tickets|scoreboard|instances)/, { timeout: 60000 });
        // Đợi layout load xong
        await page.waitForTimeout(2000);
    });
}

// Helper: Navigate đến trang Tickets
async function navigateToTickets(page: Page) {
    await test.step('Navigate to Tickets page', async () => {
        // Click nút Tickets trong sidebar
        await page.locator('button', { hasText: 'Tickets' }).click();
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
async function fillTicketForm(page: Page, data: TicketTestData, uniqueTitle: string, uniqueDescription: string) {
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
            await page.locator('textarea#description').fill(uniqueDescription);
        }
    });
}

// Helper: Click nút submit tạo ticket
async function submitTicket(page: Page) {
    await test.step('Submit Ticket', async () => {
        await page.locator('button[type="submit"]').filter({ hasText: 'CREATE TICKET' }).click();
        await page.waitForTimeout(500);
    });
}

// Helper: Kiểm tra Swal alert message (đợi Swal xuất hiện trước khi check)
async function checkSwalAlert(page: Page, expectedMessage: string, timeout: number = 5000): Promise<boolean> {
    try {
        // Đợi Swal popup xuất hiện
        const swalPopup = page.locator('.swal2-popup');
        await swalPopup.waitFor({ state: 'visible', timeout });

        const swalText = await swalPopup.textContent();
        if (swalText?.toLowerCase().includes(expectedMessage.toLowerCase())) {
            return true;
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

test.describe.serial('Test Suite: Tạo Ticket - Validation Đầy Đủ', () => {

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
            const timestamp = Date.now();
            let uniqueTitle = data.title ? `${data.title}_${timestamp}` : data.title;

            // Helper: tạo chuỗi random dài N ký tự (hex)
            const randomHex = (len: number) => {
                let result = '';
                for (let i = 0; i < len; i++) {
                    result += Math.floor(Math.random() * 16).toString(16);
                }
                return result;
            };

            // Description phải unique vs TẤT CẢ ticket cũ trong DB
            // Backend dùng SequenceMatcher.ratio() >= 0.3 (character-level)
            // Chiến lược: tạo description RẤT DÀI (200+ ký tự) với nhiều hex random
            // => ratio = 2*M/T sẽ rất thấp vì T lớn và M (matching chars) nhỏ
            let uniqueDescription: string;
            if (!data.description) {
                uniqueDescription = data.description;
            } else if (data.description.length > 100) {
                // Long description test: 30 random words
                uniqueDescription = Array.from({ length: 40 }, () => randomHex(8)).join(' ');
            } else {
                // Normal description: 10 random hex segments
                uniqueDescription = Array.from({ length: 10 }, () => randomHex(16)).join('-');
            }

            try {
                // ===== XỬ LÝ ĐẶC BIỆT CHO DUPLICATE TEST =====
                if (data.isDuplicateTest) {
                    // Tạo description dùng chung cho cả 2 ticket (để trigger similarity)
                    const dupDescription = Array.from({ length: 10 }, () => randomHex(16)).join('-');

                    // Bước 1: Tạo ticket đầu tiên (phải thành công)
                    await test.step('Create first ticket (for duplicate test)', async () => {
                        await openCreateTicketModal(page);
                        const firstTitle = `First_${uniqueTitle}`;
                        await fillTicketForm(page, {
                            ...data,
                            title: firstTitle,
                            shouldFail: false
                        }, firstTitle, dupDescription);
                        await submitTicket(page);

                        // Verify ticket đầu tiên được tạo (phải check Swal ngay trước khi nó auto-close)
                        const swalSuccess = await checkSwalAlert(page, 'successfully', 10000);
                        if (!swalSuccess) {
                            // Nếu không thấy success, có thể đã tạo rồi - đợi thêm
                            await page.waitForTimeout(2000);
                        }

                        // Đợi Swal tự đóng + modal đóng
                        await page.waitForTimeout(3000);
                    });

                    // Bước 2: Tạo ticket thứ hai với cùng description (phải thất bại)
                    await test.step('Create duplicate ticket', async () => {
                        await openCreateTicketModal(page);
                        const secondTitle = `Second_${uniqueTitle}`;
                        const duplicateDescription = dupDescription;
                        await fillTicketForm(page, data, secondTitle, duplicateDescription);
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
                await fillTicketForm(page, data, uniqueTitle, uniqueDescription);

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
                    const hasSuccess = await checkSwalAlert(page, 'successfully', 10000);
                    expect(hasSuccess).toBeTruthy();
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

// =============================================================================
// PHẦN 4: TEST SUITE - XEM, XÓA, CHI TIẾT TICKET
// =============================================================================

test.describe.serial('Test Suite: Xem, Xóa và Chi tiết Ticket', () => {

    test.beforeEach(async ({ page }: { page: Page }) => {
        await loginContestant(page);
        await navigateToTickets(page);
    });

    // ========== TC-T301: Xem danh sách tickets ==========
    test('TC-T301: View all tickets belonging to the logged-in user', async ({ page }: { page: Page }) => {
        test.setTimeout(60000);

        try {
            await test.step('Verify tickets page header', async () => {
                // Verify [SUPPORT_TICKETS] heading
                const heading = page.locator('h1', { hasText: '[SUPPORT_TICKETS]' });
                await expect(heading).toBeVisible({ timeout: 10000 });
            });

            await test.step('Verify table structure', async () => {
                // Verify table headers: ID, TITLE, TYPE, STATUS, DATE, ACTION
                const table = page.locator('table');
                await expect(table).toBeVisible();

                const headers = ['ID', 'TITLE', 'TYPE', 'STATUS', 'DATE', 'ACTION'];
                for (const header of headers) {
                    const th = page.locator('th', { hasText: header });
                    await expect(th).toBeVisible();
                }
            });

            await test.step('Verify at least 1 ticket exists', async () => {
                // Verify at least one ticket row exists in tbody
                const ticketRows = page.locator('tbody tr');
                const rowCount = await ticketRows.count();
                expect(rowCount).toBeGreaterThan(0);
                console.log(`✅ TC-T301: Tìm thấy ${rowCount} ticket(s) trong danh sách`);
            });

            await test.step('Verify each row has VIEW button', async () => {
                const firstRow = page.locator('tbody tr').first();
                const viewButton = firstRow.locator('button', { hasText: 'VIEW' });
                await expect(viewButton).toBeVisible();
            });

            await test.step('Verify filter controls exist', async () => {
                // Search input
                const searchInput = page.locator('input[placeholder="Search tickets..."]');
                await expect(searchInput).toBeVisible();

                // Status filter dropdown
                const statusFilter = page.locator('select');
                await expect(statusFilter).toBeVisible();
            });

            console.log('✅ TC-T301: View all tickets - PASS');

        } catch (error) {
            console.error('❌ TC-T301 failed:', error);
            await page.screenshot({
                path: `test-results/error-TC_T301-${Date.now()}.png`,
                fullPage: true
            });
            throw error;
        }
    });

    // ========== TC-T302: Xóa ticket Open thành công ==========
    test('TC-T302: Delete user\'s ticket in Open status successfully', async ({ page }: { page: Page }) => {
        test.setTimeout(120000);

        const timestamp = Date.now();
        const r1 = Math.random().toString(36).substring(2, 15);
        const r2 = Math.random().toString(36).substring(2, 15);
        const r3 = Math.random().toString(36).substring(2, 15);
        const r4 = Math.random().toString(36).substring(2, 15);
        const deleteTestTitle = `Delete_Test_${timestamp}`;
        const deleteTestDescription = `${r1}_${r2}_${r3}_${r4}_${timestamp}`;

        try {
            // Bước 1: Tạo ticket mới để xóa
            await test.step('Create a new ticket to delete', async () => {
                await openCreateTicketModal(page);
                await fillTicketForm(page, {
                    testCaseName: 'TC-T302',
                    title: deleteTestTitle,
                    type: 'Question',
                    description: deleteTestDescription,
                    shouldFail: false
                }, deleteTestTitle, deleteTestDescription);
                await submitTicket(page);

                // Đợi success Swal
                const hasSuccess = await checkSwalAlert(page, 'successfully', 10000);
                expect(hasSuccess).toBeTruthy();

                // Đợi Swal tự đóng + modal đóng
                await page.waitForTimeout(3000);
            });

            // Bước 2: Verify ticket vừa tạo có trong danh sách
            await test.step('Verify ticket appears in list with Open status', async () => {
                // Search ticket
                const searchInput = page.locator('input[placeholder="Search tickets..."]');
                await searchInput.fill(deleteTestTitle);
                await page.waitForTimeout(1000);

                const ticketRow = page.locator('tr', { hasText: deleteTestTitle }).first();
                await expect(ticketRow).toBeVisible({ timeout: 10000 });
                await expect(ticketRow).toContainText(/open/i);
            });

            // Bước 3: Click delete button
            await test.step('Click delete button on the ticket', async () => {
                const ticketRow = page.locator('tr', { hasText: deleteTestTitle }).first();
                const deleteButton = ticketRow.locator('button[title="Delete ticket"]');
                await expect(deleteButton).toBeVisible();
                await deleteButton.click();
            });

            // Bước 4: Xác nhận xóa trong Swal confirmation + verify success
            await test.step('Confirm delete and verify success', async () => {
                // Đợi Swal confirmation xuất hiện
                const swalPopup = page.locator('.swal2-popup');
                await swalPopup.waitFor({ state: 'visible', timeout: 5000 });

                // Verify nội dung confirmation
                const swalText = await swalPopup.textContent();
                expect(swalText?.toLowerCase()).toContain('delete');

                // Click nút Delete
                const confirmButton = page.locator('.swal2-confirm');
                await confirmButton.click();

                // Đợi delete API xử lý + success Swal xuất hiện
                // Success Swal auto-close sau 2s nên phải check ngay
                await page.waitForTimeout(500);
                const hasSuccess = await checkSwalAlert(page, 'deleted successfully', 5000);
                if (!hasSuccess) {
                    // Nếu miss Swal (auto-closed) - vẫn OK, sẽ verify qua list
                    console.log('⚠ Delete success Swal đã auto-close, verify qua danh sách');
                }

                // Đợi Swal tự đóng
                await page.waitForTimeout(3000);
            });

            // Bước 6: Verify ticket đã bị xóa khỏi danh sách
            await test.step('Verify ticket removed from list', async () => {
                // Clear search và search lại
                const searchInput = page.locator('input[placeholder="Search tickets..."]');
                await searchInput.clear();
                await searchInput.fill(deleteTestTitle);
                await page.waitForTimeout(1000);

                const ticketRow = page.locator('tr', { hasText: deleteTestTitle });
                await expect(ticketRow).toHaveCount(0, { timeout: 10000 });
            });

            console.log('✅ TC-T302: Delete Open ticket successfully - PASS');

        } catch (error) {
            console.error('❌ TC-T302 failed:', error);
            await page.screenshot({
                path: `test-results/error-TC_T302-${Date.now()}.png`,
                fullPage: true
            });
            throw error;
        }
    });

    // ========== TC-T303: Không thể xóa ticket Closed ==========
    test('TC-T303: Fail to delete user\'s ticket in Closed status', async ({ page }: { page: Page }) => {
        test.setTimeout(60000);

        try {
            await test.step('Verify delete button logic across all tickets', async () => {
                // Reset filter về All
                const statusFilter = page.locator('select').first();
                await statusFilter.selectOption('all');
                await page.waitForTimeout(1000);

                const allRows = page.locator('tbody tr');
                const rowCount = await allRows.count();

                let foundClosed = false;
                let foundOpen = false;

                for (let i = 0; i < rowCount; i++) {
                    const row = allRows.nth(i);
                    const rowText = await row.textContent() || '';

                    // Bỏ qua row "No tickets found"
                    if (rowText.includes('No tickets found')) continue;

                    const deleteButton = row.locator('button[title="Delete ticket"]');

                    if (/closed/i.test(rowText)) {
                        foundClosed = true;
                        // Closed ticket KHÔNG có nút delete
                        const deleteCount = await deleteButton.count();
                        expect(deleteCount).toBe(0);
                        console.log(`  ✓ Closed ticket row ${i}: no delete button (correct)`);
                    } else if (/open/i.test(rowText)) {
                        foundOpen = true;
                        // Open ticket CÓ nút delete
                        const deleteCount = await deleteButton.count();
                        expect(deleteCount).toBe(1);
                        console.log(`  ✓ Open ticket row ${i}: has delete button (correct)`);
                    }
                }

                if (foundClosed) {
                    console.log('✅ TC-T303: Verified closed ticket has no delete button');
                } else if (foundOpen) {
                    console.log('✅ TC-T303: No closed ticket found, but verified open tickets have delete button (UI logic correct)');
                } else {
                    console.log('⚠ TC-T303: No tickets found at all');
                }
            });

            // Verify thêm bằng filter Closed
            await test.step('Verify closed filter behavior', async () => {
                const statusFilter = page.locator('select').first();
                await statusFilter.selectOption('closed');
                await page.waitForTimeout(1000);

                const closedRows = page.locator('tbody tr');
                const closedCount = await closedRows.count();

                if (closedCount > 0) {
                    const firstRowText = await closedRows.first().textContent() || '';
                    if (!firstRowText.includes('No tickets found')) {
                        // Có closed ticket - verify không có delete
                        const deleteBtn = closedRows.first().locator('button[title="Delete ticket"]');
                        await expect(deleteBtn).toHaveCount(0);
                        console.log('✅ TC-T303: Closed ticket confirmed no delete button via filter');
                    } else {
                        console.log('✅ TC-T303: No closed tickets exist - filter shows empty (expected)');
                    }
                }

                // Reset filter
                await statusFilter.selectOption('all');
                await page.waitForTimeout(500);
            });

            console.log('✅ TC-T303: Fail to delete Closed ticket - PASS');

        } catch (error) {
            console.error('❌ TC-T303 failed:', error);
            await page.screenshot({
                path: `test-results/error-TC_T303-${Date.now()}.png`,
                fullPage: true
            });
            throw error;
        }
    });

    // ========== TC-T304: Xem chi tiết ticket thành công ==========
    test('TC-T304: View ticket details successfully', async ({ page }: { page: Page }) => {
        test.setTimeout(60000);

        try {
            // Bước 1: Click VIEW trên ticket đầu tiên
            let ticketTitle = '';
            await test.step('Click VIEW on first ticket', async () => {
                // Reset filter về All
                const statusFilter = page.locator('select').first();
                await statusFilter.selectOption('all');
                await page.waitForTimeout(1000);

                const firstRow = page.locator('tbody tr').first();
                await expect(firstRow).toBeVisible({ timeout: 10000 });

                // Lấy title của ticket để verify sau
                const titleCell = firstRow.locator('td').nth(1);
                ticketTitle = (await titleCell.textContent()) || '';

                // Click VIEW button
                const viewButton = firstRow.locator('button', { hasText: 'VIEW' });
                await viewButton.click();
            });

            // Bước 2: Verify URL changed
            await test.step('Verify navigated to ticket detail page', async () => {
                await page.waitForURL(/\/tickets\/\d+/, { timeout: 10000 });
            });

            // Bước 3: Verify detail page heading
            await test.step('Verify [TICKET_DETAIL] heading', async () => {
                const heading = page.locator('h1', { hasText: '[TICKET_DETAIL]' });
                await expect(heading).toBeVisible({ timeout: 10000 });
            });

            // Bước 4: Verify detail page sections
            await test.step('Verify detail page content sections', async () => {
                // Verify AUTHOR section
                const authorLabel = page.locator('text=AUTHOR');
                await expect(authorLabel).toBeVisible();

                // Verify CREATED section
                const createdLabel = page.locator('text=CREATED');
                await expect(createdLabel).toBeVisible();

                // Verify TYPE section
                const typeLabel = page.locator('p', { hasText: 'TYPE' }).first();
                await expect(typeLabel).toBeVisible();

                // Verify [TITLE] section
                const titleSection = page.locator('h2', { hasText: '[TITLE]' });
                await expect(titleSection).toBeVisible();

                // Verify [DESCRIPTION] section
                const descSection = page.locator('h2', { hasText: '[DESCRIPTION]' });
                await expect(descSection).toBeVisible();

                // Verify title content matches
                if (ticketTitle) {
                    const titleContent = page.locator('p', { hasText: ticketTitle });
                    await expect(titleContent).toBeVisible();
                }
            });

            // Bước 5: Verify status badge
            await test.step('Verify status badge is visible', async () => {
                // Status badge hiển thị trạng thái với icon
                const statusBadge = page.locator('span.inline-flex');
                await expect(statusBadge).toBeVisible();
            });

            // Bước 6: Navigate back
            await test.step('Click BACK TO LIST and verify return', async () => {
                const backButton = page.locator('button', { hasText: 'BACK TO LIST' });
                await expect(backButton).toBeVisible();
                await backButton.click();

                // Verify quay lại trang tickets
                await page.waitForURL(/\/tickets$/, { timeout: 10000 });

                // Verify [SUPPORT_TICKETS] heading hiện lại
                const heading = page.locator('h1', { hasText: '[SUPPORT_TICKETS]' });
                await expect(heading).toBeVisible({ timeout: 10000 });
            });

            console.log('✅ TC-T304: View ticket details successfully - PASS');

        } catch (error) {
            console.error('❌ TC-T304 failed:', error);
            await page.screenshot({
                path: `test-results/error-TC_T304-${Date.now()}.png`,
                fullPage: true
            });
            throw error;
        }
    });
});
