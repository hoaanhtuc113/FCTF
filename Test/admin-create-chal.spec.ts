import { test, expect } from '@playwright/test';
import { TIMEOUT } from 'node:dns';
// 1. BỘ DỮ LIỆU TỔNG HỢP (Bạn có thể thêm/bớt các bộ dữ liệu ở đây)
const challengeTestData = [
  {
    testCaseName: 'Web Challenge Cơ Bản',
    name: 'Auto_Web',
    category: 'web',
    description: 'Mô tả tự động cho Web',
    pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
    timeLimit: '25',
    maxAttempts: '5',
    cooldown: '5',
    points: '100',
    flag: 'FCTF{web_success}',
    setUpDocker: true,
    port: '3000',
    cpuLimit: '300',
    cpuRequest: '300',
    memoryLimit: '256',
    memoryRequest: '256',
    useGvisor: 'false',
    deployFile: 'EZ_WEB.zip',
    state: 'visible',
    deployStatus: 'DEPLOY_SUCCESS',
    expectedErrorForTimeLimit: null,
    expectedErrorForMaxAttemps: null,
    expectedErrorForSubCD: null,
    expectedErrorForValue: null
  },
  {
    testCaseName: 'Pwn Challenge Cấu Hình Cao',
    name: 'Auto_Pwn',
    category: 'pwn',
    description: 'Mô tả tự động cho Pwn',
    pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
    timeLimit: '70',
    maxAttempts: '0', 
    cooldown: '10',
    points: '500',
    flag: 'FCTF{pwn_hard_level}',
    setUpDocker: true,
    port: '3000',
    cpuLimit: '500',
    cpuRequest: '500',
    memoryLimit: '256',
    memoryRequest: '256',
    useGvisor: 'true',
    deployFile: 'EZ_WEB.zip',
    state: 'visible',
    deployStatus: 'DEPLOY_SUCCESS',
    expectedErrorForTimeLimit: '30',
    expectedErrorForMaxAttemps: null,
    expectedErrorForSubCD: null,
    expectedErrorForValue: null
  }
];

test.describe('Nhóm test tạo Challenge', () => {

  // KHU VỰC LOGIN: Chạy trước mỗi bài test
  test.beforeEach(async ({ page }) => {
    await page.goto('https://admin.fctf.mnhduc.site/login');
    await page.getByRole('textbox', { name: 'User Name or Email' }).fill('admin');
    await page.getByRole('textbox', { name: 'Password' }).fill('1');
    await page.getByRole('button', { name: 'Submit' }).click();
    // Đợi đến khi đăng nhập thành công mới làm việc tiếp
    await expect(page).toHaveURL(/.*admin/);
  });

  // KHU VỰC NHẬP LIỆU: Lặp qua từng bộ dữ liệu
  for (const data of challengeTestData) {
    test(`Chạy dữ liệu cho: ${data.testCaseName}`, async ({ page }) => {
      test.setTimeout(300000);
      const finalName = `${data.name}_${Date.now()}`;

      // 1. Vào form tạo
      await page.getByRole('link', { name: '+ Create Challenge' }).click();

      // 2. Nhập liệu (Sử dụng data từ mảng)
      const nameInput = page.getByRole('textbox', { name: 'Enter challenge name' });
      await nameInput.fill(finalName);
      await page.getByRole('textbox', { name: 'Enter challenge category' }).fill(data.category);
      await page.getByRole('button', { name: 'Choose File' }).first().setInputFiles(data.pdfFile);
      await page.getByRole('application').getByRole('textbox').fill(data.description);

      const timeLimitInput = page.locator('input[name="time_limit"]');
      await timeLimitInput.fill(data.timeLimit);
      const maxAttemptsInput = page.locator('input[name="max_attempts"]');
      await maxAttemptsInput.fill(data.maxAttempts);
      const maxCDInput = page.getByRole('spinbutton', { name: 'Submission cooldown (seconds' });
      await maxCDInput.fill(data.cooldown);
      const maxValueInput = page.locator('input[name="value"]');
      await maxValueInput.fill(data.points);

      // 3. Docker & Flag
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      if (data.expectedErrorForTimeLimit) {
        // Lấy tin nhắn từ HTML5 Validation
        const validationMessage = await timeLimitInput.evaluate((node: HTMLInputElement) => node.validationMessage);

        // Kiểm tra điều kiện
        expect(validationMessage).toContain(data.expectedErrorForTimeLimit);
        return; 
      }

       if (data.expectedErrorForMaxAttemps) {
        // Lấy tin nhắn từ HTML5 Validation
        const validationMessage = await maxAttemptsInput.evaluate((node: HTMLInputElement) => node.validationMessage);

        // Kiểm tra điều kiện
        expect(validationMessage).toContain(data.expectedErrorForMaxAttemps);
        return; 
      }
       if (data.expectedErrorForSubCD) {
        // Lấy tin nhắn từ HTML5 Validation
        const validationMessage = await maxCDInput.evaluate((node: HTMLInputElement) => node.validationMessage);


        // Kiểm tra điều kiện
        expect(validationMessage).toContain(data.expectedErrorForSubCD);
        return; 
      }
       if (data.expectedErrorForValue) {
        // Lấy tin nhắn từ HTML5 Validation
        const validationMessage = await maxValueInput.evaluate((node: HTMLInputElement) => node.validationMessage);

        // Kiểm tra điều kiện
        expect(validationMessage).toContain(data.expectedErrorForValue);
        return; 
      }

      if (data.setUpDocker) {
      await page.getByText('Setup Docker').click();

      await page.locator('#expose_port').fill(data.port);
      await page.locator('input[name="cpu_limit"]').fill(data.cpuLimit);
      await page.locator('input[name="memory_limit"]').fill(data.memoryLimit);
      
      await page.locator('select[name="use_gvisor"]').selectOption(data.useGvisor);
      await page.locator('input[name="deploy_file"]').setInputFiles(data.deployFile);
      }

      await page.locator('input[name="flag"]').fill(data.flag);
      await page.locator('select[name="state"]').selectOption(data.state);

      await page.getByRole('button', { name: 'Finish' }).click();
      await page.waitForTimeout(120000);
      // 4. Kiểm tra DEPLOY_SUCCESS
      await page.getByRole('link', { name: ' Challenges' }).click();
      const challengeRow = page.locator('tr', { hasText: finalName });

      await expect(async () => {
        await page.reload();
        await challengeRow.waitFor({ state: 'visible', timeout: 5000 });
        await challengeRow.scrollIntoViewIfNeeded();
        await Promise.all([
        expect(challengeRow).toContainText(data.deployStatus),
        expect(challengeRow).toContainText(data.state),
        expect(challengeRow).toContainText(data.points)
      ]);
      }).toPass({
        intervals: [10000], 
        timeout: 180000     
      });
    });
  }
});