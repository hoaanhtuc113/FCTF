import { test, expect, Page } from '@playwright/test';
import {
    ADMIN_URL,
    createChallenge,
    deleteChallengeViaApi,
    fillCreateStepOne,
    loginAdmin,
    openCreateChallenge,
    openChallengeTab,
    saveDeployChanges,
    selectChallengeType,
    submitCreateStepOne,
    uniqueChallengeName,
    waitForVersionCount,
    workspaceFile,
} from './challenge-admin-support';

test.describe('UC03 Create Challenge', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }: { page: Page }) => {
        test.setTimeout(360_000);
        await loginAdmin(page);
    });

    test('CCH-01: Create a standard challenge successfully', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-standard'),
            category: 'web',
            description: 'Standard challenge created by UC03 automation',
            pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
            timeLimit: '20',
            maxAttempts: '5',
            cooldown: '5',
            value: '100',
            difficulty: 2,
            flag: 'FCTF{uc03-standard}',
            state: 'hidden',
        });

        try {
            await expect(page.locator('input[name="name"]')).toHaveValue(created.name);
            await expect(page.locator('input[name="category"]')).toHaveValue('web');
            await expect(page.locator('input[name="value"]:not([disabled])')).toHaveValue('100');
            await openChallengeTab(page, 'Files');
            await expect(page.locator('#files')).toContainText('Challenge Files');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-02: Create a docker-backed challenge and record the first image version', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-docker'),
            category: 'pwn',
            description: 'Docker deployment challenge created by UC03 automation',
            pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
            timeLimit: '25',
            maxAttempts: '3',
            cooldown: '10',
            value: '200',
            difficulty: 4,
            flag: 'FCTF{uc03-docker}',
            state: 'visible',
            setUpDocker: true,
            exposePort: '3000',
            cpuLimit: '300',
            cpuRequest: '50',
            memoryLimit: '256',
            memoryRequest: '64',
            useGvisor: 'false',
            maxDeployCount: '1',
            deployFile: 'EZ_WEB.zip',
            waitForDeploySuccess: true,
        });

        try {
            await openChallengeTab(page, 'Deploy');
            await expect(page.locator('input[name="deploy_status"], #status-message')).toContainText(/DEPLOY_SUCCESS|success/i);
            await openChallengeTab(page, 'Versions');
            await expect(page.locator('#versions tbody tr')).not.toContainText('No versions recorded yet.');
            await expect(page.locator('#versions tbody tr').first()).toContainText('ACTIVE');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-03: Create a dynamic challenge successfully', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            type: 'dynamic',
            name: uniqueChallengeName('uc03-dynamic'),
            category: 'misc',
            description: 'Dynamic scoring challenge created by UC03 automation',
            timeLimit: '30',
            maxAttempts: '4',
            cooldown: '2',
            difficulty: 3,
            initial: '500',
            minimum: '100',
            decay: '50',
            decayFunction: 'linear',
            flag: 'FCTF{uc03-dynamic}',
            state: 'visible',
        });

        try {
            await expect(page.locator('input[name="initial"]')).toHaveValue('500');
            await expect(page.locator('input[name="minimum"]')).toHaveValue('100');
            await expect(page.locator('input[name="decay"]')).toHaveValue('50');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-04: Create a multiple-choice challenge successfully', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            type: 'multiple_choice',
            name: uniqueChallengeName('uc03-mcq'),
            category: 'quiz',
            description: 'Choose the correct answer',
            timeLimit: '15',
            maxAttempts: '3',
            cooldown: '2',
            value: '50',
            difficulty: 1,
            choices: [
                { text: 'Choice A', correct: false },
                { text: 'Choice B', correct: true },
                { text: 'Choice C', correct: false },
            ],
            flag: 'Choice B',
            state: 'hidden',
        });

        try {
            await expect(page.locator('textarea[name="description"]')).toContainText('Choice A');
            await expect(page.locator('textarea[name="description"]')).toContainText('Choice B');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-05: Reject a challenge name that becomes empty after trimming', async ({ page }: { page: Page }) => {
        await openCreateChallenge(page);
        await fillCreateStepOne(page, {
            name: '   ',
            category: 'web',
            description: 'Should fail because name is blank after trim',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            value: '100',
        });
        await submitCreateStepOne(page);

        await expect(page.locator('body')).toContainText('Name cannot be empty', { timeout: 10_000 });
    });

    test('CCH-06: Reject a category that becomes empty after trimming', async ({ page }: { page: Page }) => {
        await openCreateChallenge(page);
        await fillCreateStepOne(page, {
            name: uniqueChallengeName('uc03-empty-category'),
            category: '   ',
            description: 'Should fail because category is blank after trim',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            value: '100',
        });
        await submitCreateStepOne(page);

        await expect(page.locator('body')).toContainText('Category cannot be empty', { timeout: 10_000 });
    });

    test('CCH-07: Reject a category longer than 20 characters', async ({ page }: { page: Page }) => {
        await openCreateChallenge(page);
        await fillCreateStepOne(page, {
            name: uniqueChallengeName('uc03-long-category'),
            category: 'web',
            description: 'Should fail because category is too long',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            value: '100',
        });

        await page.locator('input[name="category"]').evaluate((node: HTMLInputElement) => {
            node.value = 'ThisCategoryIsWayTooLongForBackend';
            node.dispatchEvent(new Event('input', { bubbles: true }));
            node.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await submitCreateStepOne(page);

        await expect(page.locator('body')).toContainText('Category must be 20 characters or less', { timeout: 10_000 });
    });

    test('CCH-08: Reject a negative time limit with native validation', async ({ page }: { page: Page }) => {
        await openCreateChallenge(page);
        await fillCreateStepOne(page, {
            name: uniqueChallengeName('uc03-negative-time'),
            category: 'web',
            description: 'Negative time limit should be rejected',
            timeLimit: '-1',
            maxAttempts: '3',
            cooldown: '0',
            value: '100',
        });
        await submitCreateStepOne(page);

        const validationMessage = await page.locator('input[name="time_limit"]').evaluate((node: HTMLInputElement) => node.validationMessage);
        expect(validationMessage.length).toBeGreaterThan(0);
    });

    test('CCH-09: Reject a negative challenge value with native validation', async ({ page }: { page: Page }) => {
        await openCreateChallenge(page);
        await fillCreateStepOne(page, {
            name: uniqueChallengeName('uc03-negative-value'),
            category: 'web',
            description: 'Negative challenge value should be rejected',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            value: '-10',
        });
        await submitCreateStepOne(page);

        const validationMessage = await page.locator('input[name="value"]').evaluate((node: HTMLInputElement) => node.validationMessage);
        expect(validationMessage.length).toBeGreaterThan(0);
    });

    test('CCH-10: Reject a dynamic challenge when initial value is below minimum value', async ({ page }: { page: Page }) => {
        await openCreateChallenge(page);
        await selectChallengeType(page, 'dynamic');
        await fillCreateStepOne(page, {
            type: 'dynamic',
            name: uniqueChallengeName('uc03-invalid-dynamic'),
            category: 'misc',
            description: 'Dynamic validation failure case',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            initial: '50',
            minimum: '100',
            decay: '10',
        });
        await submitCreateStepOne(page);

        await expect(page.locator('body')).toContainText(/greater than minimum|initial/i, { timeout: 10_000 });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // TAB SETTINGS: Flags, Files, Topics, Tags, Hints, Requirements, Next
    // ──────────────────────────────────────────────────────────────────────────

    test('CCH-11: Add a static flag via the Flags tab', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-flag-static'),
            category: 'web',
            description: 'Flag tab static test',
            value: '100',
            flag: 'FCTF{initial-flag}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Flags');
            await page.locator('#flag-add-button').click();
            const modal = page.locator('#flag-create-modal');
            await modal.locator('select').first().selectOption('static');
            await expect(modal.locator('input[name="content"]')).toBeVisible({ timeout: 5_000 });
            await modal.locator('input[name="content"]').fill('FCTF{static-flag-test}');
            await modal.locator('button[type="submit"]').click();
            await expect(page.locator('#flagsboard tbody')).toContainText('FCTF{static-flag-test}', { timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-12: Add a case-insensitive static flag via the Flags tab', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-flag-case'),
            category: 'web',
            description: 'Case-insensitive flag test',
            value: '100',
            flag: 'FCTF{initial-flag}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Flags');
            await page.locator('#flag-add-button').click();
            const modal = page.locator('#flag-create-modal');
            await modal.locator('select').first().selectOption('static');
            await expect(modal.locator('input[name="content"]')).toBeVisible({ timeout: 5_000 });
            await modal.locator('input[name="content"]').fill('FCTF{case-insensitive-flag}');
            await modal.locator('select[name="data"]').selectOption('case_insensitive');
            await modal.locator('button[type="submit"]').click();
            await expect(page.locator('#flagsboard tbody')).toContainText('FCTF{case-insensitive-flag}', { timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-13: Add a regex flag via the Flags tab', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-flag-regex'),
            category: 'web',
            description: 'Regex flag test',
            value: '100',
            flag: 'FCTF{initial-flag}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Flags');
            await page.locator('#flag-add-button').click();
            const modal = page.locator('#flag-create-modal');
            await modal.locator('select').first().selectOption('regex');
            await expect(modal.locator('input[name="content"]')).toBeVisible({ timeout: 5_000 });
            const regexValue = 'FCTF\\{[a-z0-9-]+\\}';
            await modal.locator('input[name="content"]').fill(regexValue);
            await modal.locator('button[type="submit"]').click();
            await expect(page.locator('#flagsboard tbody')).toContainText(regexValue, { timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-14: Delete a flag via the Flags tab', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-flag-delete'),
            category: 'web',
            description: 'Flag delete test',
            value: '100',
            flag: 'FCTF{delete-me}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Flags');
            const initialCount = await page.locator('#flagsboard tbody tr').count();
            expect(initialCount).toBeGreaterThan(0);
            page.once('dialog', (d) => d.accept());
            await page.locator('.delete-flag').first().click();
            await expect(page.locator('#flagsboard tbody tr')).toHaveCount(initialCount - 1, { timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-15: Upload and delete a file via the Files tab', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-files-tab'),
            category: 'web',
            description: 'Files tab upload/delete test',
            value: '100',
            flag: 'FCTF{files-test}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Files');
            await page.locator('input#file').setInputFiles(workspaceFile('Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf'));
            await page.locator('#_submit').click();
            await expect(page.locator('#filesboard tbody tr')).toHaveCount(1, { timeout: 10_000 });

            // Delete the uploaded file via the ezQuery confirm modal
            await page.locator('.delete-file').first().click();
            await expect(page.locator('.modal.show button:has-text("Yes")')).toBeVisible({ timeout: 3_000 });
            await page.locator('.modal.show button:has-text("Yes")').click();
            await expect(page.locator('#filesboard tbody tr')).toHaveCount(0, { timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-16: Add and remove a topic via the Topics tab', async ({ page }: { page: Page }) => {
        const topicValue = `test-topic-${Date.now()}`;
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-topics-tab'),
            category: 'web',
            description: 'Topics tab test',
            value: '100',
            flag: 'FCTF{topics-test}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Topics');
            await page.locator('#topics #tags-add-input').fill(topicValue);
            await page.locator('#topics #tags-add-input').press('Enter');
            await expect(page.locator('#challenge-topics')).toContainText(topicValue, { timeout: 5_000 });

            // Remove the topic
            await page.locator('#topics .delete-tag').first().click();
            await expect(page.locator('#challenge-topics')).not.toContainText(topicValue, { timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-17: Add and remove a tag via the Tags tab', async ({ page }: { page: Page }) => {
        const tagValue = `test-tag-${Date.now()}`;
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-tags-tab'),
            category: 'web',
            description: 'Tags tab test',
            value: '100',
            flag: 'FCTF{tags-test}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Tags');
            await page.locator('#tags #tags-add-input').fill(tagValue);
            await page.locator('#tags #tags-add-input').press('Enter');
            await expect(page.locator('#tags span').filter({ hasText: tagValue })).toBeVisible({ timeout: 5_000 });

            // Remove the tag by clicking its × anchor
            await page.locator('#tags span').filter({ hasText: tagValue }).locator('a').click();
            await expect(page.locator('#tags span').filter({ hasText: tagValue })).not.toBeVisible({ timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-18: Create a hint with content and cost via the Hints tab', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-hints-create'),
            category: 'web',
            description: 'Hints tab creation test',
            value: '100',
            flag: 'FCTF{hints-test}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Hints');
            await page.locator('button:has-text("Create Hint")').click();
            const modal = page.locator('.modal.show').first();
            await expect(modal).toBeVisible({ timeout: 3_000 });
            await modal.locator('textarea[name="content"]').fill('This is a helpful hint for the challenge.');
            await modal.locator('input[name="cost"]').fill('10');
            await modal.locator('button.btn-primary').click();
            await expect(page.locator('#hints table tbody tr')).toHaveCount(1, { timeout: 5_000 });
            await expect(page.locator('#hints table tbody tr')).toContainText('10');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-19: Reject a negative hint cost via browser validation', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-hints-neg-cost'),
            category: 'web',
            description: 'Hint negative cost validation',
            value: '100',
            flag: 'FCTF{hints-neg-cost}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Hints');
            await page.locator('button:has-text("Create Hint")').click();
            const modal = page.locator('.modal.show').first();
            await expect(modal).toBeVisible({ timeout: 3_000 });
            await modal.locator('textarea[name="content"]').fill('Hint with negative cost.');
            await modal.locator('input[name="cost"]').fill('-5');
            await modal.locator('button.btn-primary').click();

            // The cost input has min=0; browser native validation should block submission
            const validationMessage = await modal
                .locator('input[name="cost"]')
                .evaluate((node: HTMLInputElement) => node.validationMessage);
            expect(validationMessage.length).toBeGreaterThan(0);
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-20: Delete a hint via the Hints tab', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-hints-delete'),
            category: 'web',
            description: 'Hint delete test',
            value: '100',
            flag: 'FCTF{hints-delete}',
            state: 'hidden',
        });
        try {
            // First create a hint
            await openChallengeTab(page, 'Hints');
            await page.locator('button:has-text("Create Hint")').click();
            const modal = page.locator('.modal.show').first();
            await expect(modal).toBeVisible({ timeout: 3_000 });
            await modal.locator('textarea[name="content"]').fill('Hint to be deleted.');
            await modal.locator('input[name="cost"]').fill('5');
            await modal.locator('button.btn-primary').click();
            await expect(page.locator('#hints table tbody tr')).toHaveCount(1, { timeout: 5_000 });

            // Delete the hint via the ezQuery confirm modal
            await page.locator('#hints .fas.fa-times').first().click();
            await expect(page.locator('.modal.show button:has-text("Yes")')).toBeVisible({ timeout: 3_000 });
            await page.locator('.modal.show button:has-text("Yes")').click();
            await expect(page.locator('#hints table tbody tr')).toHaveCount(0, { timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-21: Set a prerequisite challenge via the Requirements tab', async ({ page }: { page: Page }) => {
        const main = await createChallenge(page, {
            name: uniqueChallengeName('uc03-req-main'),
            category: 'web',
            description: 'Main challenge for requirements test',
            value: '100',
            flag: 'FCTF{req-main}',
            state: 'hidden',
        });
        const prereq = await createChallenge(page, {
            name: uniqueChallengeName('uc03-req-prereq'),
            category: 'misc',
            description: 'Prerequisite challenge for requirements test',
            value: '50',
            flag: 'FCTF{req-prereq}',
            state: 'hidden',
        });
        try {
            // Navigate to the main challenge detail page
            await page.goto(`${ADMIN_URL}/admin/challenges/${main.id}`);
            await expect(page).toHaveURL(/\/admin\/challenges\/\d+/, { timeout: 15_000 });

            await openChallengeTab(page, 'Requirements');
            // Wait for the requirement checkboxes to load
            await expect(page.locator('#requirements .form-check')).toHaveCount.call(undefined, 0);
            await expect(page.locator('#requirements .form-check').first()).toBeVisible({ timeout: 5_000 });

            // Check the prerequisite challenge checkbox
            const prereqLabel = page.locator('#requirements .form-check-label').filter({ hasText: prereq.name });
            await expect(prereqLabel).toBeVisible({ timeout: 5_000 });
            await prereqLabel.locator('.form-check-input').check();

            // The Save button is enabled when selection changes
            await expect(page.locator('#requirements button.btn-primary')).toBeEnabled({ timeout: 3_000 });
            await page.locator('#requirements button.btn-primary').click();
            await page.waitForTimeout(1_500);

            // Reload and verify the checkbox is still checked
            await page.reload();
            await openChallengeTab(page, 'Requirements');
            await expect(page.locator('#requirements .form-check').first()).toBeVisible({ timeout: 5_000 });
            await expect(
                page.locator('#requirements .form-check-label').filter({ hasText: prereq.name }).locator('.form-check-input')
            ).toBeChecked({ timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, main.id);
            await deleteChallengeViaApi(page, prereq.id);
        }
    });

    test('CCH-22: Set the next challenge via the Next tab', async ({ page }: { page: Page }) => {
        const main = await createChallenge(page, {
            name: uniqueChallengeName('uc03-next-main'),
            category: 'web',
            description: 'Main challenge for Next tab test',
            value: '100',
            flag: 'FCTF{next-main}',
            state: 'hidden',
        });
        const nextChallenge = await createChallenge(page, {
            name: uniqueChallengeName('uc03-next-target'),
            category: 'misc',
            description: 'Target for Next tab test',
            value: '50',
            flag: 'FCTF{next-target}',
            state: 'hidden',
        });
        try {
            // Navigate back to the main challenge
            await page.goto(`${ADMIN_URL}/admin/challenges/${main.id}`);
            await expect(page).toHaveURL(/\/admin\/challenges\/\d+/, { timeout: 15_000 });

            await openChallengeTab(page, 'Next');
            // Wait for the select to be populated with other challenges
            await expect(page.locator('#next select option').nth(1)).toBeVisible({ timeout: 5_000 });

            // Select the next challenge by its name
            await page.locator('#next select').selectOption({ label: nextChallenge.name });
            await expect(page.locator('#next button.btn-primary')).toBeEnabled({ timeout: 3_000 });
            await page.locator('#next button.btn-primary').click();
            await page.waitForTimeout(1_500);

            // Reload and verify the selection is persisted
            await page.reload();
            await openChallengeTab(page, 'Next');
            await expect(page.locator('#next select')).toHaveValue(String(nextChallenge.id), { timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, main.id);
            await deleteChallengeViaApi(page, nextChallenge.id);
        }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // BOUNDARY & EDGE CASES
    // ──────────────────────────────────────────────────────────────────────────

    test('CCH-23: Create challenge with name at maxlength boundary (40 chars)', async ({ page }: { page: Page }) => {
        // Name field has maxlength=40 in the form
        const baseName = 'B'.repeat(40 - String(Date.now()).length) + String(Date.now()).slice(-10);
        const boundaryName = baseName.slice(0, 40); // Exactly 40 chars

        const created = await createChallenge(page, {
            name: boundaryName,
            category: 'web',
            description: 'Boundary test: name at max length',
            value: '50',
            flag: 'FCTF{boundary-name}',
            state: 'hidden',
        });

        try {
            // Verify the name was saved correctly
            await expect(page.locator('input[name="name"]')).toHaveValue(boundaryName);
            expect(boundaryName.length).toBe(40);
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-24: Create challenge with duplicate name → server rejects or handles', async ({ page }: { page: Page }) => {
        const duplicateName = uniqueChallengeName('uc03-duplicate');

        const created = await createChallenge(page, {
            name: duplicateName,
            category: 'web',
            description: 'First challenge with this name',
            value: '100',
            flag: 'FCTF{dup-first}',
            state: 'hidden',
        });

        try {
            // Try to create a second challenge with the same name
            await openCreateChallenge(page);
            await fillCreateStepOne(page, {
                name: duplicateName,
                category: 'web',
                description: 'Second challenge with same name',
                timeLimit: '20',
                maxAttempts: '3',
                cooldown: '0',
                value: '100',
            });
            await submitCreateStepOne(page);

            // Server should either reject (show error) or accept (show step 2)
            // We check which behavior occurs
            const hasError = await page.locator('body').textContent({ timeout: 10_000 });
            if (hasError?.includes('already exists') || hasError?.includes('duplicate')) {
                // Server correctly rejects duplicate names
                expect(hasError).toMatch(/already exists|duplicate/i);
            } else {
                // Server may accept duplicate names - verify step 2 is shown
                const finishVisible = await page.locator('button:has-text("Finish")').isVisible({ timeout: 5_000 }).catch(() => false);
                expect(finishVisible).toBeTruthy();
            }
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });
});
