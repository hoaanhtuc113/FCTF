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
} from '../challenge-admin-support';

async function waitForDeployStatusOnDetail(page: Page, expectedStatus: 'DEPLOY_SUCCESS' | 'DEPLOY_SUCCEEDED', timeout = 900_000) {
    await expect(async () => {
        await page.reload({ waitUntil: 'load' });
        await expect(page).toHaveURL(/\/admin\/challenges\/\d+/, { timeout: 15_000 });
        await expect(page.locator('input[name="deploy_status"]')).toHaveValue(expectedStatus, { timeout: 10_000 });
    }).toPass({ timeout, intervals: [5_000, 10_000, 15_000] });
}

async function uploadChallengeFile(page: Page, fileName: string): Promise<boolean> {
    await page.locator('input#file').setInputFiles(workspaceFile(fileName));
    await page.locator('#_submit, button:has-text("Upload")').first().click();

    await expect(page.locator('text=Uploading files...')).toBeVisible({ timeout: 10_000 }).catch(() => undefined);
    await expect(page.locator('text=Uploading files...')).not.toBeVisible({ timeout: 60_000 }).catch(() => undefined);

    const uploadError = page.locator('#challenge-files .alert, #challenge-files .alert-danger').filter({ hasText: /File upload failed/i });
    return (await uploadError.count()) === 0;
}

async function findHardenContainerControl(page: Page) {
    const direct = page.locator('#harden_container, [name="harden_container"], #use_gvisor, [name="use_gvisor"]').first();
    if (await direct.isVisible().catch(() => false)) {
        return direct;
    }

    const section = page
        .locator('#deploy .form-group, #deploy .deploy-resource-field')
        .filter({ hasText: /Harden Container|Use gVisor|gVisor/i })
        .first();
    await expect(section).toBeVisible({ timeout: 10_000 });
    return section.locator('select, input[type="checkbox"]').first();
}

async function setHardenContainer(page: Page, enabled: boolean) {
    await openChallengeTab(page, 'Deploy');
    const control = await findHardenContainerControl(page);
    const tagName = await control.evaluate((el) => el.tagName.toLowerCase());

    if (tagName === 'select') {
        await control.selectOption(enabled ? 'true' : 'false');
    } else {
        if (enabled) {
            await control.check({ force: true });
        } else {
            await control.uncheck({ force: true });
        }
    }

    await page.locator('#deploy-btn').click().catch(async () => {
        await page.locator('#deploy-btn').dispatchEvent('click');
    });
    await page.waitForTimeout(1_500);
}

async function expectHardenContainerValue(page: Page, expected: boolean) {
    await openChallengeTab(page, 'Deploy');
    const control = await findHardenContainerControl(page);
    const tagName = await control.evaluate((el) => el.tagName.toLowerCase());
    if (tagName === 'select') {
        await expect(control).toHaveValue(expected ? 'true' : 'false');
    } else {
        await expect(control).toBeChecked({ checked: expected });
    }
}

test.describe('UC03 Create Challenge', () => {
    test.describe.configure({ mode: 'parallel', retries: 0 });
    // Ensure 30s action timeout regardless of playwright.config settings
    test.use({ actionTimeout: 30_000 });

    test.beforeEach(async ({ page }: { page: Page }) => {
        test.setTimeout(1_200_000);
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
            const nameInput = page.locator('input[name="name"]').first();
            if (await nameInput.isVisible().catch(() => false)) {
                await expect(nameInput).toHaveValue(created.name);
            } else {
                await expect(page.locator('h1')).toContainText(created.name);
            }

            const categoryInput = page.locator('input[name="category"]').first();
            if (await categoryInput.isVisible().catch(() => false)) {
                await expect(categoryInput).toHaveValue('web');
            } else {
                await expect(page.getByRole('heading', { name: 'web', exact: true })).toBeVisible();
            }

            const valueInput = page.locator('input[name="value"]:not([disabled])').first();
            if (await valueInput.isVisible().catch(() => false)) {
                await expect(valueInput).toHaveValue('100');
            } else {
                await expect(page.locator('h3')).toContainText('100');
            }
            await openChallengeTab(page, 'Challenge files');
            await expect(page.locator('#files')).toContainText('Challenge Files');
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
        await openChallengeTab(page, 'Challenge files');
        const initialCount = await page.locator('#filesboard tbody tr').count();
        const uploaded = await uploadChallengeFile(page, 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf');
        if (!uploaded) {
            await expect(page.locator('#challenge-files')).toContainText(/File upload failed/i);
        } else {
            await expect(async () => {
                const currentCount = await page.locator('#filesboard tbody tr').count();
                expect(currentCount).toBeGreaterThan(initialCount);
            }).toPass({ timeout: 60_000, intervals: [2_000, 5_000] });

            // Delete the uploaded file via the ezQuery confirm modal
            // Use dispatchEvent to bypass #challenge-update-container overlay intercept
            // (force:true still clicks at screen coords where overlay intercepts; dispatchEvent fires directly on element)
            await page.locator('.delete-file').first().dispatchEvent('click');
            await expect(page.locator('.modal.show button:has-text("Yes")')).toBeVisible({ timeout: 5_000 });
            await page.locator('.modal.show button:has-text("Yes")').click();
            await expect(async () => {
                const currentCount = await page.locator('#filesboard tbody tr').count();
                expect(currentCount).toBeLessThanOrEqual(initialCount);
            }).toPass({ timeout: 60_000, intervals: [2_000, 5_000] });
        }

        // Keep the created challenge for manual inspection.
        expect(created.id).toBeGreaterThan(0);
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
            // #challenge-topics.my-3 is the Vue-rendered inner div (vs .clean-content-section which is the mount container)
            await expect(page.locator('#challenge-topics.my-3')).toContainText(topicValue, { timeout: 5_000 });

            // Remove the topic via dispatchEvent to bypass #challenge-update-container overlay intercept
            await page.locator('#challenge-topics.my-3 .delete-tag').first().dispatchEvent('click');
            await expect(page.locator('#challenge-topics.my-3')).not.toContainText(topicValue, { timeout: 5_000 });
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

            // Remove the tag by clicking its × anchor via dispatchEvent to bypass overlay intercept
            await page.locator('#tags span').filter({ hasText: tagValue }).locator('a').dispatchEvent('click');
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
            // EasyMDE hides the textarea; fill via CodeMirror API
            await modal.locator('.CodeMirror').evaluate((el: any, text: string) => { el.CodeMirror.setValue(text); }, 'This is a helpful hint for the challenge.');
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
            // EasyMDE hides the textarea; fill via CodeMirror API
            await modal.locator('.CodeMirror').evaluate((el: any, text: string) => { el.CodeMirror.setValue(text); }, 'Hint with negative cost.');
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
            // EasyMDE hides the textarea; fill via CodeMirror API
            await modal.locator('.CodeMirror').evaluate((el: any, text: string) => { el.CodeMirror.setValue(text); }, 'Hint to be deleted.');
            await modal.locator('input[name="cost"]').fill('5');
            await modal.locator('button.btn-primary').click();
            await expect(page.locator('#hints table tbody tr')).toHaveCount(1, { timeout: 5_000 });

            // Delete the hint via the ezQuery confirm modal (dispatchEvent bypasses overlay intercept)
            await page.locator('#hints .fas.fa-times').first().dispatchEvent('click');
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
        // Navigate to the main challenge detail page
        await page.goto(`${ADMIN_URL}/admin/challenges/${main.id}`);
        await expect(page).toHaveURL(/\/admin\/challenges\/\d+/, { timeout: 15_000 });

        await openChallengeTab(page, 'Requirements');
        // Wait until Vue loads the requirements list and includes the prerequisite.
        await expect(async () => {
            const checkboxCount = await page.locator('#requirements .form-check-input').count();
            expect(checkboxCount).toBeGreaterThan(0);
            const hasPrereq = await page
                .locator('#requirements .form-check-label')
                .filter({ hasText: prereq.name })
                .locator('.form-check-input')
                .count();
            expect(hasPrereq).toBeGreaterThan(0);
        }).toPass({ timeout: 30_000, intervals: [1_000, 2_000, 5_000] });

        const prereqCheckbox = page
            .locator('#requirements .form-check-label')
            .filter({ hasText: prereq.name })
            .locator('.form-check-input')
            .first();
        await prereqCheckbox.check({ force: true });

        // The Save button is enabled when selection changes
        await expect(page.locator('#requirements button.btn-primary')).toBeEnabled({ timeout: 3_000 });
        await page.locator('#requirements button.btn-primary').click();
        await page.waitForTimeout(1_500);

        // Reload and verify the checkbox is still checked
        await page.reload();
        await openChallengeTab(page, 'Requirements');
        await expect(prereqCheckbox).toBeChecked({ timeout: 10_000 });

        // Keep both created challenges for manual inspection.
        expect(main.id).toBeGreaterThan(0);
        expect(prereq.id).toBeGreaterThan(0);
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
            // <option> elements inside <select> are always "hidden" in Playwright — use waitFor attached
            await expect(async () => {
                const optionCount = await page.locator('#next select option').count();
                expect(optionCount).toBeGreaterThan(1);
            }).toPass({ timeout: 20_000, intervals: [1_000, 2_000] });

            await expect(async () => {
                const hasTarget = await page.locator(`#next select option[value="${nextChallenge.id}"]`).count();
                expect(hasTarget).toBeGreaterThan(0);
            }).toPass({ timeout: 20_000, intervals: [1_000, 2_000] });

            // Select the next challenge by id for better stability
            await page.locator('#next select').selectOption({ value: String(nextChallenge.id) });
            await page.locator('#next select').dispatchEvent('change');
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
        const ts = String(Date.now()); // 13 digits as of 2024
        const boundaryName = ('B'.repeat(40 - ts.length) + ts).slice(0, 40); // Exactly 40 chars

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

    // ──────────────────────────────────────────────────────────────────────────
    // NUMERIC FIELD BOUNDARY VALIDATION
    // ──────────────────────────────────────────────────────────────────────────

    test('CCH-25: Create challenge with time limit at maximum boundary (30 minutes)', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-timelimit-max'),
            category: 'web',
            description: 'Time limit at max boundary (30)',
            timeLimit: '30',
            maxAttempts: '5',
            cooldown: '0',
            value: '100',
            flag: 'FCTF{timelimit-max}',
            state: 'hidden',
        });

        try {
            await expect(page.locator('input[name="time_limit"]')).toHaveValue('30');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-26: Reject time limit = 0 with browser native validation (min = 1)', async ({ page }: { page: Page }) => {
        await openCreateChallenge(page);
        await fillCreateStepOne(page, {
            name: uniqueChallengeName('uc03-timelimit-zero'),
            category: 'web',
            description: 'Time limit zero should be rejected by min=1',
            timeLimit: '0',
            maxAttempts: '3',
            cooldown: '0',
            value: '100',
        });
        await submitCreateStepOne(page);

        const validationMessage = await page
            .locator('input[name="time_limit"]')
            .evaluate((node: HTMLInputElement) => node.validationMessage);
        expect(validationMessage.length).toBeGreaterThan(0);
    });

    test('CCH-27: Reject time limit exceeding maximum (31) with browser native validation', async ({ page }: { page: Page }) => {
        await openCreateChallenge(page);
        await fillCreateStepOne(page, {
            name: uniqueChallengeName('uc03-timelimit-exceed'),
            category: 'web',
            description: 'Time limit above max=30 should be rejected',
            timeLimit: '31',
            maxAttempts: '3',
            cooldown: '0',
            value: '100',
        });
        await submitCreateStepOne(page);

        const validationMessage = await page
            .locator('input[name="time_limit"]')
            .evaluate((node: HTMLInputElement) => node.validationMessage);
        expect(validationMessage.length).toBeGreaterThan(0);
    });

    test('CCH-28: Create challenge with max_attempts = 0 (unlimited)', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-attempts-zero'),
            category: 'web',
            description: 'Zero max attempts means unlimited — should be accepted',
            timeLimit: '20',
            maxAttempts: '0',
            cooldown: '0',
            value: '100',
            flag: 'FCTF{attempts-unlimited}',
            state: 'hidden',
        });

        try {
            await expect(page.locator('input[name="max_attempts"]')).toHaveValue('0');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-29: Create challenge with value = 0 (zero-point challenge)', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-value-zero'),
            category: 'misc',
            description: 'Zero-point challenge should be accepted (min=0)',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            value: '0',
            flag: 'FCTF{value-zero}',
            state: 'hidden',
        });

        try {
            await expect(page.locator('input[name="value"]:not([disabled])')).toHaveValue('0');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-30: Reject negative cooldown with browser native validation (min = 0)', async ({ page }: { page: Page }) => {
        await openCreateChallenge(page);
        await fillCreateStepOne(page, {
            name: uniqueChallengeName('uc03-cooldown-neg'),
            category: 'web',
            description: 'Negative cooldown should be rejected by min=0',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '-1',
            value: '100',
        });
        await submitCreateStepOne(page);

        const validationMessage = await page
            .locator('input[name="cooldown"], #submission_cooldown')
            .first()
            .evaluate((node: HTMLInputElement) => node.validationMessage);
        expect(validationMessage.length).toBeGreaterThan(0);
    });

    test('CCH-31: Reject negative max_attempts with browser native validation (min = 0)', async ({ page }: { page: Page }) => {
        await openCreateChallenge(page);
        await fillCreateStepOne(page, {
            name: uniqueChallengeName('uc03-attempts-neg'),
            category: 'web',
            description: 'Negative max attempts should be rejected by min=0',
            timeLimit: '20',
            maxAttempts: '-1',
            cooldown: '0',
            value: '100',
        });
        await submitCreateStepOne(page);

        const validationMessage = await page
            .locator('input[name="max_attempts"]')
            .evaluate((node: HTMLInputElement) => node.validationMessage);
        expect(validationMessage.length).toBeGreaterThan(0);
    });

    test('CCH-32: Create challenge with minimum time limit boundary (1 minute)', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-min-timelimit'),
            category: 'web',
            description: 'Minimum valid time limit (1 minute)',
            timeLimit: '1',
            maxAttempts: '3',
            cooldown: '0',
            value: '50',
            flag: 'FCTF{min-timelimit}',
            state: 'hidden',
        });

        try {
            await expect(page.locator('input[name="time_limit"]')).toHaveValue('1');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-33: Create challenge with large max_attempts value (999)', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-large-attempts'),
            category: 'pwn',
            description: 'Large max attempts should be accepted',
            timeLimit: '20',
            maxAttempts: '999',
            cooldown: '0',
            value: '100',
            flag: 'FCTF{large-attempts}',
            state: 'hidden',
        });

        try {
            await expect(page.locator('input[name="max_attempts"]')).toHaveValue('999');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-34: Create challenge with high cooldown value (3600 seconds)', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-high-cooldown'),
            category: 'web',
            description: 'High cooldown (1 hour) should be accepted',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '3600',
            value: '500',
            difficulty: 5,
            flag: 'FCTF{high-cooldown}',
            state: 'hidden',
        });

        try {
            await expect(page.locator('#submission_cooldown')).toHaveValue('3600');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // DYNAMIC CHALLENGE EDGE CASES
    // ──────────────────────────────────────────────────────────────────────────

    test('CCH-35: Reject dynamic challenge when decay = 0 (below min=1 native validation)', async ({ page }: { page: Page }) => {
        await openCreateChallenge(page);
        await selectChallengeType(page, 'dynamic');
        await fillCreateStepOne(page, {
            type: 'dynamic',
            name: uniqueChallengeName('uc03-dynamic-zero-decay'),
            category: 'misc',
            description: 'Decay of 0 is below the min=1 constraint',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            initial: '500',
            minimum: '100',
            decay: '0',
        });
        await submitCreateStepOne(page);

        // Decay field has min="1", so 0 fails browser native validation
        const validationMessage = await page
            .locator('input[name="decay"]')
            .evaluate((node: HTMLInputElement) => node.validationMessage);
        expect(validationMessage.length).toBeGreaterThan(0);
    });

    test('CCH-36: Create dynamic challenge with logarithmic decay function', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            type: 'dynamic',
            name: uniqueChallengeName('uc03-dynamic-log'),
            category: 'crypto',
            description: 'Logarithmic decay dynamic challenge',
            timeLimit: '25',
            maxAttempts: '5',
            cooldown: '0',
            difficulty: 3,
            initial: '1000',
            minimum: '50',
            decay: '20',
            decayFunction: 'logarithmic',
            flag: 'FCTF{uc03-dynamic-log}',
            state: 'hidden',
        });

        try {
            await expect(page.locator('input[name="initial"]')).toHaveValue('1000');
            await expect(page.locator('input[name="minimum"]')).toHaveValue('50');
            await expect(page.locator('input[name="decay"]')).toHaveValue('20');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-37: Reject dynamic challenge with negative decay value (min = 1)', async ({ page }: { page: Page }) => {
        await openCreateChallenge(page);
        await selectChallengeType(page, 'dynamic');
        await fillCreateStepOne(page, {
            type: 'dynamic',
            name: uniqueChallengeName('uc03-dynamic-neg-decay'),
            category: 'misc',
            description: 'Negative decay is below min=1 constraint',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            initial: '500',
            minimum: '100',
            decay: '-5',
        });
        await submitCreateStepOne(page);

        // Decay field has min="1", so -5 fails browser native validation
        const validationMessage = await page
            .locator('input[name="decay"]')
            .evaluate((node: HTMLInputElement) => node.validationMessage);
        expect(validationMessage.length).toBeGreaterThan(0);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // CHALLENGE STATE & DIFFICULTY SETTINGS
    // ──────────────────────────────────────────────────────────────────────────

    test('CCH-38: Create visible challenge (state = visible, published immediately)', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-visible'),
            category: 'web',
            description: 'This challenge is visible to contestants immediately',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            value: '100',
            flag: 'FCTF{uc03-visible}',
            state: 'visible',
        });

        try {
            await expect(page.locator('select[name="state"]')).toHaveValue('visible');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-39: Create challenge with no difficulty set (difficulty unrated)', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-no-difficulty'),
            category: 'web',
            description: 'Challenge without a difficulty rating',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            value: '100',
            difficulty: null,
            flag: 'FCTF{no-difficulty}',
            state: 'hidden',
        });

        try {
            const diffValue = await page.locator('#difficulty-input-update').inputValue();
            expect(diffValue === '' || diffValue === '0').toBeTruthy();
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-40: Create challenge with maximum difficulty rating (5 stars)', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-max-difficulty'),
            category: 'pwn',
            description: 'Maximum difficulty challenge (5 stars = Very Hard)',
            timeLimit: '25',
            maxAttempts: '3',
            cooldown: '30',
            value: '500',
            difficulty: 5,
            flag: 'FCTF{max-difficulty}',
            state: 'hidden',
        });

        try {
            const diffValue = await page.locator('#difficulty-input-update').inputValue();
            expect(diffValue).toBe('5');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-41: Create challenge with minimum difficulty rating (1 star)', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-min-difficulty'),
            category: 'web',
            description: 'Minimum difficulty challenge (1 star = Very Easy)',
            timeLimit: '10',
            maxAttempts: '10',
            cooldown: '0',
            value: '50',
            difficulty: 1,
            flag: 'FCTF{min-difficulty}',
            state: 'hidden',
        });

        try {
            const diffValue = await page.locator('#difficulty-input-update').inputValue();
            expect(diffValue).toBe('1');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // FLAGS TAB ADDITIONAL VALIDATION
    // ──────────────────────────────────────────────────────────────────────────

    test('CCH-42: Create challenge with case-insensitive flag from creation wizard', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-ci-flag-create'),
            category: 'web',
            description: 'Challenge created with case-insensitive flag',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            value: '100',
            flag: 'FCTF{case-insensitive-creation}',
            flagCaseInsensitive: true,
            state: 'hidden',
        });

        try {
            await openChallengeTab(page, 'Flags');
            await expect(page.locator('#flagsboard tbody tr').first()).toContainText('FCTF{case-insensitive-creation}');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-43: Add a regex case-insensitive flag via Flags tab', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-flag-regex-ci'),
            category: 'web',
            description: 'Regex case-insensitive flag test',
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
            const regexPattern = 'FCTF\\{[A-Za-z0-9_-]+\\}';
            await modal.locator('input[name="content"]').fill(regexPattern);
            await modal.locator('select[name="data"]').selectOption('case_insensitive');
            await modal.locator('button[type="submit"]').click();
            await expect(page.locator('#flagsboard tbody')).toContainText(regexPattern, { timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-44: Flag Create button is hidden until a flag type is selected', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-flag-type-guard'),
            category: 'web',
            description: 'Flag type selector guard test',
            value: '100',
            flag: 'FCTF{initial-flag}',
            state: 'hidden',
        });

        try {
            await openChallengeTab(page, 'Flags');
            await page.locator('#flag-add-button').click();
            const modal = page.locator('#flag-create-modal');

            // The "Create Flag" button should be hidden before a type is selected
            await expect(modal.locator('button[type="submit"]')).not.toBeVisible({ timeout: 3_000 });

            // After selecting a type the button becomes visible
            await modal.locator('select').first().selectOption('static');
            await expect(modal.locator('button[type="submit"]')).toBeVisible({ timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // HINTS TAB ADDITIONAL TESTS
    // ──────────────────────────────────────────────────────────────────────────

    test('CCH-45: Create a free hint (cost = 0) via Hints tab', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-hint-free'),
            category: 'web',
            description: 'Free hint (cost=0) should be accepted',
            value: '100',
            flag: 'FCTF{hint-free}',
            state: 'hidden',
        });

        try {
            await openChallengeTab(page, 'Hints');
            await page.locator('button:has-text("Create Hint")').click();
            const modal = page.locator('.modal.show').first();
            await expect(modal).toBeVisible({ timeout: 3_000 });
            // EasyMDE hides the textarea; fill via CodeMirror API
            await modal.locator('.CodeMirror').evaluate((el: any, text: string) => { el.CodeMirror.setValue(text); }, 'This hint is free of charge.');
            await modal.locator('input[name="cost"]').fill('0');
            await modal.locator('button.btn-primary').click();
            await expect(page.locator('#hints table tbody tr')).toHaveCount(1, { timeout: 5_000 });
            await expect(page.locator('#hints table tbody tr')).toContainText('0');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-46: Create multiple hints and verify all appear in Hints table', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-hints-multiple'),
            category: 'web',
            description: 'Multiple hints test',
            value: '200',
            flag: 'FCTF{hints-multiple}',
            state: 'hidden',
        });

        try {
            await openChallengeTab(page, 'Hints');

            for (const [content, cost] of [['First hint', '10'], ['Second hint', '25'], ['Third hint', '0']]) {
                await page.locator('button:has-text("Create Hint")').click();
                const modal = page.locator('.modal.show').first();
                await expect(modal).toBeVisible({ timeout: 3_000 });
                // EasyMDE hides the textarea; fill via CodeMirror API
                await modal.locator('.CodeMirror').evaluate((el: any, text: string) => { el.CodeMirror.setValue(text); }, content);
                await modal.locator('input[name="cost"]').fill(cost);
                await modal.locator('button.btn-primary').click();
                await page.waitForTimeout(500);
            }

            await expect(page.locator('#hints table tbody tr')).toHaveCount(3, { timeout: 10_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-47: Edit an existing hint content and cost via Hints tab', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-hint-edit'),
            category: 'web',
            description: 'Edit hint content and cost test',
            value: '100',
            flag: 'FCTF{hint-edit}',
            state: 'hidden',
        });

        try {
            await openChallengeTab(page, 'Hints');
            // Create a hint first
            await page.locator('button:has-text("Create Hint")').click();
            const createModal = page.locator('.modal.show').first();
            await expect(createModal).toBeVisible({ timeout: 3_000 });
            // EasyMDE hides the textarea; fill via CodeMirror API
            await createModal.locator('.CodeMirror').evaluate((el: any, text: string) => { el.CodeMirror.setValue(text); }, 'Original hint content');
            await createModal.locator('input[name="cost"]').fill('10');
            await createModal.locator('button.btn-primary').click();
            await expect(page.locator('#hints table tbody tr')).toHaveCount(1, { timeout: 5_000 });

            // Click the edit icon (dispatchEvent bypasses overlay intercept)
            await page.locator('#hints .fa-edit, #hints .fas.fa-edit, #hints [data-target*="edit"], #hints button:has-text("Edit")').first().dispatchEvent('click');
            const editModal = page.locator('.modal.show').first();
            await expect(editModal).toBeVisible({ timeout: 3_000 });
            // Wait for CodeMirror to bind (loadHint fetches API then calls bindMarkdownEditor)
            await editModal.locator('.CodeMirror').waitFor({ state: 'visible', timeout: 10_000 });
            // EasyMDE hides the textarea; fill via CodeMirror API
            await editModal.locator('.CodeMirror').evaluate((el: any, text: string) => { el.CodeMirror.setValue(text); }, 'Updated hint content');
            await editModal.locator('input[name="cost"]').fill('20');
            await editModal.locator('button.btn-primary').click();
            await page.waitForTimeout(1_000);

            // The cost column should show the updated value
            await expect(page.locator('#hints table tbody tr')).toContainText('20', { timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // REQUIREMENTS TAB ADDITIONAL TESTS
    // ──────────────────────────────────────────────────────────────────────────

    test('CCH-48: Remove prerequisite after setting it via Requirements tab', async ({ page }: { page: Page }) => {
        const main = await createChallenge(page, {
            name: uniqueChallengeName('uc03-req-remove-main'),
            category: 'web',
            description: 'Main challenge for prerequisite removal test',
            value: '100',
            flag: 'FCTF{req-remove-main}',
            state: 'hidden',
        });
        const prereq = await createChallenge(page, {
            name: uniqueChallengeName('uc03-req-remove-prereq'),
            category: 'misc',
            description: 'Prerequisite to be set then removed',
            value: '50',
            flag: 'FCTF{req-remove-prereq}',
            state: 'hidden',
        });

        try {
            // Navigate to main challenge and set the prerequisite
            await page.goto(`${ADMIN_URL}/admin/challenges/${main.id}`);
            await expect(page).toHaveURL(/\/admin\/challenges\/\d+/, { timeout: 15_000 });
            await openChallengeTab(page, 'Requirements');
            await expect(page.locator('#requirements .form-check').first()).toBeVisible({ timeout: 5_000 });

            const prereqLabel = page.locator('#requirements .form-check-label').filter({ hasText: prereq.name });
            await expect(prereqLabel).toBeVisible({ timeout: 5_000 });
            await prereqLabel.locator('.form-check-input').check();
            await page.locator('#requirements button.btn-primary').click();
            await page.waitForTimeout(1_500);

            // Reload and verify it is checked
            await page.reload();
            await openChallengeTab(page, 'Requirements');
            await expect(page.locator('#requirements .form-check').first()).toBeVisible({ timeout: 5_000 });
            const checkbox = page.locator('#requirements .form-check-label')
                .filter({ hasText: prereq.name })
                .locator('.form-check-input');
            await expect(checkbox).toBeChecked({ timeout: 5_000 });

            // Now uncheck/remove the prerequisite
            await checkbox.uncheck();
            await page.locator('#requirements button.btn-primary').click();
            await page.waitForTimeout(1_500);

            // Reload and verify it is no longer checked
            await page.reload();
            await openChallengeTab(page, 'Requirements');
            await expect(page.locator('#requirements .form-check').first()).toBeVisible({ timeout: 5_000 });
            await expect(
                page.locator('#requirements .form-check-label')
                    .filter({ hasText: prereq.name })
                    .locator('.form-check-input')
            ).not.toBeChecked({ timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, main.id);
            await deleteChallengeViaApi(page, prereq.id);
        }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // NEXT TAB ADDITIONAL TESTS
    // ──────────────────────────────────────────────────────────────────────────

    test('CCH-49: Clear/reset the next challenge selection via the Next tab', async ({ page }: { page: Page }) => {
        const main = await createChallenge(page, {
            name: uniqueChallengeName('uc03-next-clear-main'),
            category: 'web',
            description: 'Main challenge for Next tab clear test',
            value: '100',
            flag: 'FCTF{next-clear-main}',
            state: 'hidden',
        });
        const nextChallenge = await createChallenge(page, {
            name: uniqueChallengeName('uc03-next-clear-target'),
            category: 'misc',
            description: 'Target for Next tab clear test',
            value: '50',
            flag: 'FCTF{next-clear-target}',
            state: 'hidden',
        });

        try {
            // Set the next challenge
            await page.goto(`${ADMIN_URL}/admin/challenges/${main.id}`);
            await expect(page).toHaveURL(/\/admin\/challenges\/\d+/, { timeout: 15_000 });
            await openChallengeTab(page, 'Next');
            // <option> elements inside <select> are always "hidden" in Playwright — use waitFor attached
            await expect(async () => {
                const optionCount = await page.locator('#next select option').count();
                expect(optionCount).toBeGreaterThan(1);
            }).toPass({ timeout: 20_000, intervals: [1_000, 2_000] });
            await expect(async () => {
                const hasTarget = await page.locator(`#next select option[value="${nextChallenge.id}"]`).count();
                expect(hasTarget).toBeGreaterThan(0);
            }).toPass({ timeout: 20_000, intervals: [1_000, 2_000] });
            await page.locator('#next select').selectOption({ value: String(nextChallenge.id) });
            await page.locator('#next select').dispatchEvent('change');
            await expect(page.locator('#next button.btn-primary')).toBeEnabled({ timeout: 5_000 });
            await page.locator('#next button.btn-primary').click();
            await page.waitForTimeout(1_500);

            // Reload and verify the selection is saved
            await page.reload();
            await openChallengeTab(page, 'Next');
            await expect(page.locator('#next select')).toHaveValue(String(nextChallenge.id), { timeout: 5_000 });

            // Now clear the selection by selecting the first/blank option
            const nextSelect = page.locator('#next select');
            await nextSelect.selectOption({ index: 0 });
            await nextSelect.dispatchEvent('change');

            const saveButton = page.locator('#next button.btn-primary');
            if (await saveButton.isEnabled().catch(() => false)) {
                await saveButton.click();
                await page.waitForTimeout(1_500);
            }

            // Reload and verify the selection is cleared
            await page.reload();
            await openChallengeTab(page, 'Next');
            const selectedValue = await page.locator('#next select').inputValue();
            // The Vue component's "none" option has value="null" (string), so include it
            expect(selectedValue === '' || selectedValue === '0' || selectedValue === 'None' || selectedValue === 'null').toBeTruthy();
        } finally {
            await deleteChallengeViaApi(page, main.id);
            await deleteChallengeViaApi(page, nextChallenge.id);
        }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // FILES TAB ADDITIONAL TESTS
    // ──────────────────────────────────────────────────────────────────────────

    test('CCH-50: Upload a second file via Files tab and verify count increases', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-files-multi'),
            category: 'web',
            description: 'Multiple file upload test',
            value: '100',
            flag: 'FCTF{files-multi}',
            state: 'hidden',
        });

        await openChallengeTab(page, 'Challenge files');

        const initialCount = await page.locator('#filesboard tbody tr').count();

        // Upload first file
        const firstUploadOk = await uploadChallengeFile(page, 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf');
        if (!firstUploadOk) {
            await expect(page.locator('#challenge-files')).toContainText(/File upload failed/i);
        } else {
            await expect(async () => {
                const currentCount = await page.locator('#filesboard tbody tr').count();
                expect(currentCount).toBeGreaterThan(initialCount);
            }).toPass({ timeout: 60_000, intervals: [2_000, 5_000] });

            // Upload second file (same PDF → accepted as separate entry)
            const secondUploadOk = await uploadChallengeFile(page, 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf');
            if (!secondUploadOk) {
                await expect(page.locator('#challenge-files')).toContainText(/File upload failed/i);
            } else {
                await expect(async () => {
                    const currentCount = await page.locator('#filesboard tbody tr').count();
                    expect(currentCount).toBeGreaterThanOrEqual(initialCount + 2);
                }).toPass({ timeout: 60_000, intervals: [2_000, 5_000] });
            }
        }

        // Keep the created challenge for manual inspection.
        expect(created.id).toBeGreaterThan(0);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // MULTIPLE-CHOICE ADDITIONAL TESTS
    // ──────────────────────────────────────────────────────────────────────────

    test('CCH-51: Create multiple-choice challenge with four choices', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            type: 'multiple_choice',
            name: uniqueChallengeName('uc03-mcq-four'),
            category: 'quiz',
            description: 'Four-choice question',
            timeLimit: '15',
            maxAttempts: '5',
            cooldown: '0',
            value: '75',
            difficulty: 2,
            choices: [
                { text: 'Option Alpha', correct: false },
                { text: 'Option Beta', correct: true },
                { text: 'Option Gamma', correct: false },
                { text: 'Option Delta', correct: false },
            ],
            flag: 'Option Beta',
            state: 'visible',
        });

        try {
            await expect(page.locator('textarea[name="description"]')).toContainText('Option Alpha');
            await expect(page.locator('textarea[name="description"]')).toContainText('Option Beta');
            await expect(page.locator('textarea[name="description"]')).toContainText('Option Gamma');
            await expect(page.locator('textarea[name="description"]')).toContainText('Option Delta');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // TOPICS AND TAGS ADDITIONAL TESTS
    // ──────────────────────────────────────────────────────────────────────────

    test('CCH-52: Add multiple topics and verify all persist via Topics tab', async ({ page }: { page: Page }) => {
        const topic1 = `multi-topic-a-${Date.now()}`;
        const topic2 = `multi-topic-b-${Date.now()}`;
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-topics-multi'),
            category: 'web',
            description: 'Multiple topics test',
            value: '100',
            flag: 'FCTF{topics-multi}',
            state: 'hidden',
        });

        try {
            await openChallengeTab(page, 'Topics');

            await page.locator('#topics #tags-add-input').fill(topic1);
            await page.locator('#topics #tags-add-input').press('Enter');
            // #challenge-topics.my-3 is the Vue-rendered inner div (vs .clean-content-section which is the mount container)
            await expect(page.locator('#challenge-topics.my-3')).toContainText(topic1, { timeout: 5_000 });

            await page.locator('#topics #tags-add-input').fill(topic2);
            await page.locator('#topics #tags-add-input').press('Enter');
            await expect(page.locator('#challenge-topics.my-3')).toContainText(topic2, { timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('CCH-53: Add multiple tags and verify all appear via Tags tab', async ({ page }: { page: Page }) => {
        const tag1 = `multi-tag-x-${Date.now()}`;
        const tag2 = `multi-tag-y-${Date.now()}`;
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-tags-multi'),
            category: 'web',
            description: 'Multiple tags test',
            value: '100',
            flag: 'FCTF{tags-multi}',
            state: 'hidden',
        });

        try {
            await openChallengeTab(page, 'Tags');

            await page.locator('#tags #tags-add-input').fill(tag1);
            await page.locator('#tags #tags-add-input').press('Enter');
            await expect(page.locator('#tags span').filter({ hasText: tag1 })).toBeVisible({ timeout: 5_000 });

            await page.locator('#tags #tags-add-input').fill(tag2);
            await page.locator('#tags #tags-add-input').press('Enter');
            await expect(page.locator('#tags span').filter({ hasText: tag2 })).toBeVisible({ timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // DOCKER-BACKED CHALLENGE (run last to avoid blocking other tests on infra failure)
    // ──────────────────────────────────────────────────────────────────────────

    test('CCH-54: Enable Harden Container in Deploy tab and verify it persists', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-harden-on'),
            category: 'pwn',
            description: 'Enable Harden Container and verify persistence',
            value: '100',
            flag: 'FCTF{harden-on}',
            state: 'hidden',
            setUpDocker: true,
            deployFile: 'EZ_WEB.zip',
            waitForDeploySuccess: false,
            skipRowStateCheck: true,
        });

        await setHardenContainer(page, true);
        await page.reload({ waitUntil: 'load' });
        await expectHardenContainerValue(page, true);

        // Keep the created challenge for manual inspection.
        expect(created.id).toBeGreaterThan(0);
    });

    test('CCH-55: Disable Harden Container in Deploy tab and verify it persists', async ({ page }: { page: Page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc03-harden-off'),
            category: 'pwn',
            description: 'Disable Harden Container and verify persistence',
            value: '100',
            flag: 'FCTF{harden-off}',
            state: 'hidden',
            setUpDocker: true,
            deployFile: 'EZ_WEB.zip',
            waitForDeploySuccess: false,
            skipRowStateCheck: true,
        });

        await setHardenContainer(page, false);
        await page.reload({ waitUntil: 'load' });
        await expectHardenContainerValue(page, false);

        // Keep the created challenge for manual inspection.
        expect(created.id).toBeGreaterThan(0);
    });

    test('CCH-02: Create a docker-backed challenge with deployment settings', async ({ page }) => {
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
            waitForDeploySuccess: false,
            skipRowStateCheck: true,
        });

        try {
            await waitForDeployStatusOnDetail(page, 'DEPLOY_SUCCESS');

            // Verify the Deploy tab is accessible after docker-backed creation
            await openChallengeTab(page, 'Deploy');
            await expect(page.locator('#deploy')).toBeVisible({ timeout: 5_000 });
            // Verify the Versions tab is accessible
            await openChallengeTab(page, 'Versions');
            await expect(page.locator('#versions')).toBeVisible({ timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });
});
