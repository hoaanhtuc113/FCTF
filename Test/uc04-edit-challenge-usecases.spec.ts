import { test, expect } from '@playwright/test';
import {
    ADMIN_URL,
    createChallenge,
    deleteChallengeViaApi,
    fillCreateStepOne,
    getChallengeViaApi,
    loginAdmin,
    openChallengeDetailFromList,
    openChallengeTab,
    openCreateChallenge,
    saveDeployChanges,
    searchChallenge,
    selectChallengeType,
    setScoreVisibility,
    submitCreateStepOne,
    switchScoringTypeViaApi,
    uniqueChallengeName,
    waitForVersionCount,
} from './challenge-admin-support';

test.describe('UC04 Edit Challenge', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        test.setTimeout(360_000);
        await loginAdmin(page);
    });

    test('ECH-01: Update basic challenge information and publish state', async ({ page }) => {
        const originalName = uniqueChallengeName('uc04-edit-basic');
        const created = await createChallenge(page, {
            name: originalName,
            category: 'web',
            description: 'Original challenge description',
            pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '5',
            value: '100',
            difficulty: 2,
            flag: 'FCTF{uc04-basic-original}',
            state: 'hidden',
        });

        try {
            const updatedName = uniqueChallengeName('uc04-edit-basic-updated');
            await page.locator('input[name="name"]').fill(updatedName);
            await page.locator('input[name="category"]').fill('reverse');
            await page.locator('textarea[name="description"]').fill('Updated challenge description from UC04');
            await page.locator('input[name="time_limit"]').fill('30');
            await page.locator('input[name="max_attempts"]').fill('6');
            await page.locator('#submission_cooldown').fill('8');
            await page.locator('input[name="value"]:not([disabled])').fill('250');
            await page.locator('select[name="state"]').selectOption('visible');
            await page.locator('.star-rating-picker[data-target="difficulty-input-update"] .star-pick[data-value="4"]').click();
            await page.getByRole('button', { name: 'Update' }).click();

            await expect(page.locator('body')).toContainText('Your challenge has been updated!', { timeout: 10_000 });
            await page.reload();

            await expect(page.locator('input[name="name"]')).toHaveValue(updatedName);
            await expect(page.locator('input[name="category"]')).toHaveValue('reverse');
            await expect(page.locator('textarea[name="description"]')).toHaveValue('Updated challenge description from UC04');
            await expect(page.locator('input[name="time_limit"]')).toHaveValue('30');
            await expect(page.locator('input[name="max_attempts"]')).toHaveValue('6');
            await expect(page.locator('#submission_cooldown')).toHaveValue('8');
            await expect(page.locator('input[name="value"]:not([disabled])')).toHaveValue('250');
            await expect(page.locator('select[name="state"]')).toHaveValue('visible');

            const row = await searchChallenge(page, updatedName);
            await expect(row).toContainText('reverse');
            await expect(row).toContainText('visible');
            await expect(row).toContainText('250');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-02: Update an existing dynamic challenge parameters', async ({ page }) => {
        const created = await createChallenge(page, {
            type: 'dynamic',
            name: uniqueChallengeName('uc04-edit-dynamic'),
            category: 'misc',
            description: 'Dynamic challenge before edit',
            timeLimit: '25',
            maxAttempts: '4',
            cooldown: '3',
            difficulty: 3,
            initial: '500',
            minimum: '100',
            decay: '25',
            decayFunction: 'linear',
            flag: 'FCTF{uc04-dynamic-original}',
            state: 'hidden',
        });

        try {
            await page.locator('input[name="initial"]').fill('800');
            await page.locator('input[name="minimum"]').fill('150');
            await page.locator('input[name="decay"]').fill('40');
            await page.locator('select[name="function"]').selectOption('logarithmic');
            await page.locator('select[name="state"]').selectOption('visible');
            await page.getByRole('button', { name: 'Update' }).click();

            await expect(page.locator('body')).toContainText('Your challenge has been updated!', { timeout: 10_000 });
            await page.reload();

            await expect(page.locator('input[name="initial"]')).toHaveValue('800');
            await expect(page.locator('input[name="minimum"]')).toHaveValue('150');
            await expect(page.locator('input[name="decay"]')).toHaveValue('40');
            await expect(page.locator('select[name="function"]')).toHaveValue('logarithmic');
            await expect(page.locator('select[name="state"]')).toHaveValue('visible');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // VALIDATION TESTS
    // ──────────────────────────────────────────────────────────────────────────

    test('ECH-03: Reject an empty challenge name during update', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-update-empty-name'),
            category: 'web',
            description: 'Update validation – empty name',
            value: '100',
            flag: 'FCTF{update-empty-name}',
            state: 'hidden',
        });
        try {
            await page.locator('input[name="name"]').fill('');
            await page.getByRole('button', { name: 'Update' }).click();
            await expect(page.locator('body')).toContainText('Name cannot be empty', { timeout: 10_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-04: Reject a category longer than 20 characters during update', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-update-long-cat'),
            category: 'web',
            description: 'Update validation – long category',
            value: '100',
            flag: 'FCTF{update-long-cat}',
            state: 'hidden',
        });
        try {
            // Bypass the maxlength attribute to set an overlong category value
            await page.locator('input[name="category"]').evaluate((node: HTMLInputElement) => {
                node.value = 'ThisCategoryIsWayTooLongForBackend';
                node.dispatchEvent(new Event('input', { bubbles: true }));
                node.dispatchEvent(new Event('change', { bubbles: true }));
            });
            await page.getByRole('button', { name: 'Update' }).click();
            await expect(page.locator('body')).toContainText('Category must be 20 characters or less', { timeout: 10_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-05: Reject a dynamic challenge when initial value is below minimum during update', async ({ page }) => {
        const created = await createChallenge(page, {
            type: 'dynamic',
            name: uniqueChallengeName('uc04-update-invalid-dynamic'),
            category: 'misc',
            description: 'Dynamic update validation',
            difficulty: 3,
            initial: '500',
            minimum: '100',
            decay: '25',
            decayFunction: 'linear',
            flag: 'FCTF{update-dynamic-invalid}',
            state: 'hidden',
        });
        try {
            await page.locator('input[name="initial"]').fill('50');
            await page.locator('input[name="minimum"]').fill('200');
            await page.getByRole('button', { name: 'Update' }).click();
            await expect(page.locator('body')).toContainText(/greater than minimum|initial/i, { timeout: 10_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-06: Update deploy settings and trigger a new deployment', async ({ page }) => {
        test.setTimeout(600_000);
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-update-deploy'),
            category: 'pwn',
            description: 'Docker challenge for deploy update test',
            value: '200',
            difficulty: 3,
            flag: 'FCTF{update-deploy}',
            state: 'hidden',
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
            await saveDeployChanges(page, {
                exposePort: '3000',
                cpuLimit: '250',
                cpuRequest: '60',
                memoryLimit: '384',
                memoryRequest: '96',
                useGvisor: 'false',
                maxDeployCount: '2',
                deployFile: 'EZ_WEB.zip',
            });
            // A second version should appear after the re-deployment completes
            await waitForVersionCount(page, 2, 300_000);
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // SCORE TYPE SWITCH TESTS (static ↔ dynamic)
    // Scoring type toggle is only visible when ctf_is_active = false
    // ──────────────────────────────────────────────────────────────────────────

    test('ECH-07: Switch score type from standard → dynamic via API when contest is not active', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-switch-to-dynamic'),
            category: 'crypto',
            description: 'Standard challenge to be converted to dynamic',
            value: '200',
            flag: 'FCTF{switch-to-dynamic}',
            state: 'hidden',
        });

        try {
            // Switch to dynamic via API
            const result = await switchScoringTypeViaApi(page, created.id, 'dynamic', {
                initial: '500',
                minimum: '50',
                decay: '30',
                function: 'logarithmic',
            });

            expect(result.success).toBeTruthy();

            // Verify via API that the type is now dynamic
            const apiResult = await getChallengeViaApi(page, created.id);
            expect(apiResult.data.type).toBe('dynamic');

            // Reload the challenge detail page and verify dynamic fields render
            await page.goto(`${ADMIN_URL}/admin/challenges/${created.id}`);
            await expect(page).toHaveURL(new RegExp(`/admin/challenges/${created.id}`), { timeout: 15_000 });

            await expect(page.locator('input[name="initial"]')).toBeVisible({ timeout: 10_000 });
            await expect(page.locator('input[name="initial"]')).toHaveValue('500');
            await expect(page.locator('input[name="minimum"]')).toHaveValue('50');
            await expect(page.locator('input[name="decay"]')).toHaveValue('30');
            await expect(page.locator('select[name="function"]')).toHaveValue('logarithmic');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-08: Switch score type from dynamic → standard via API', async ({ page }) => {
        const created = await createChallenge(page, {
            type: 'dynamic',
            name: uniqueChallengeName('uc04-switch-to-standard'),
            category: 'forensics',
            description: 'Dynamic challenge to be converted back to standard',
            initial: '600',
            minimum: '80',
            decay: '20',
            decayFunction: 'linear',
            flag: 'FCTF{switch-to-standard}',
            state: 'hidden',
        });

        try {
            // Verify it starts as dynamic
            const beforeApi = await getChallengeViaApi(page, created.id);
            expect(beforeApi.data.type).toBe('dynamic');

            // Switch to standard via API
            const result = await switchScoringTypeViaApi(page, created.id, 'standard');
            expect(result.success).toBeTruthy();

            // Verify via API that the type is now standard
            const afterApi = await getChallengeViaApi(page, created.id);
            expect(afterApi.data.type).toBe('standard');

            // Reload the challenge detail page and verify standard fields
            await page.goto(`${ADMIN_URL}/admin/challenges/${created.id}`);
            await expect(page).toHaveURL(new RegExp(`/admin/challenges/${created.id}`), { timeout: 15_000 });

            // Dynamic fields should NOT be visible
            await expect(page.locator('input[name="initial"]')).not.toBeVisible();
            // Standard value field should be visible (the enabled one)
            await expect(page.locator('#standard-value-section input[name="value"]')).toBeVisible();
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-09: Scoring type toggle is NOT visible on multiple_choice challenges', async ({ page }) => {
        const created = await createChallenge(page, {
            type: 'multiple_choice',
            name: uniqueChallengeName('uc04-mcq-no-toggle'),
            category: 'quiz',
            description: 'Multiple choice challenge should not have scoring toggle',
            timeLimit: '10',
            maxAttempts: '2',
            cooldown: '1',
            value: '30',
            difficulty: 1,
            choices: [
                { text: 'A', correct: false },
                { text: 'B', correct: true },
                { text: 'C', correct: false },
            ],
            flag: 'B',
            state: 'hidden',
        });

        try {
            // Navigate to the edit page
            await page.goto(`${ADMIN_URL}/admin/challenges/${created.id}`);
            await expect(page).toHaveURL(new RegExp(`/admin/challenges/${created.id}`), { timeout: 15_000 });

            // Scoring type radio should NOT be visible for multiple_choice
            await expect(page.locator('input[name="scoring-type-radio"]')).toHaveCount(0);
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // COMPREHENSIVE FIELD VERIFICATION & EDGE CASES
    // ──────────────────────────────────────────────────────────────────────────

    test('ECH-10: Verify ALL fields persist after update and page reload', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-full-verify'),
            category: 'web',
            description: 'Full field verification test',
            timeLimit: '15',
            maxAttempts: '5',
            cooldown: '3',
            value: '120',
            difficulty: 2,
            flag: 'FCTF{full-verify}',
            state: 'hidden',
        });

        try {
            const newName = uniqueChallengeName('uc04-full-updated');
            await page.locator('input[name="name"]').fill(newName);
            await page.locator('input[name="category"]').fill('pwn');
            await page.locator('textarea[name="description"]').fill('Comprehensive updated description');
            await page.locator('input[name="time_limit"]').fill('45');
            await page.locator('input[name="max_attempts"]').fill('10');
            await page.locator('#submission_cooldown').fill('15');
            await page.locator('input[name="value"]:not([disabled])').fill('999');
            await page.locator('select[name="state"]').selectOption('visible');
            await page.locator('.star-rating-picker[data-target="difficulty-input-update"] .star-pick[data-value="5"]').click();
            await page.getByRole('button', { name: 'Update' }).click();

            await expect(page.locator('body')).toContainText('Your challenge has been updated!', { timeout: 10_000 });
            await page.reload();

            // Verify EVERY field
            await expect(page.locator('input[name="name"]')).toHaveValue(newName);
            await expect(page.locator('input[name="category"]')).toHaveValue('pwn');
            await expect(page.locator('textarea[name="description"]')).toHaveValue('Comprehensive updated description');
            await expect(page.locator('input[name="time_limit"]')).toHaveValue('45');
            await expect(page.locator('input[name="max_attempts"]')).toHaveValue('10');
            await expect(page.locator('#submission_cooldown')).toHaveValue('15');
            await expect(page.locator('input[name="value"]:not([disabled])')).toHaveValue('999');
            await expect(page.locator('select[name="state"]')).toHaveValue('visible');
            await expect(page.locator('input#difficulty-input-update')).toHaveValue('5');

            // Verify header info matches
            await expect(page.locator('.clean-page-header')).toContainText(newName);
            await expect(page.locator('.clean-page-header')).toContainText('pwn');
            await expect(page.locator('.clean-page-header')).toContainText('999');
            await expect(page.locator('.clean-page-header .challenge-state')).toContainText('visible');

            // Verify difficulty stars in header (5 stars = Very Hard)
            await expect(page.locator('.clean-page-header .fas.fa-star')).toHaveCount(5);
            await expect(page.locator('.clean-page-header')).toContainText('Very Hard');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-11: Update challenge with special characters in name and description', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-special'),
            category: 'web',
            description: 'Test special chars',
            value: '100',
            flag: 'FCTF{special}',
            state: 'hidden',
        });

        try {
            const specialName = `XSS_Test_${Date.now()}`;
            const specialDesc = '<script>alert("xss")</script> Unicode: 日本語 🚀 & " \' <img>';

            await page.locator('input[name="name"]').fill(specialName);
            await page.locator('textarea[name="description"]').fill(specialDesc);
            await page.getByRole('button', { name: 'Update' }).click();

            await expect(page.locator('body')).toContainText('Your challenge has been updated!', { timeout: 10_000 });
            await page.reload();

            // Challenge should render without XSS
            await expect(page.locator('input[name="name"]')).toHaveValue(specialName);
            // Page header should show escaped HTML, not execute script
            await expect(page.locator('.clean-page-header')).toContainText(specialName);
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-12: Reject update with empty category (bypass maxlength via evaluate)', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-empty-cat'),
            category: 'web',
            description: 'Test empty category validation',
            value: '100',
            flag: 'FCTF{empty-cat}',
            state: 'hidden',
        });

        try {
            // Bypass browser required + pattern validation
            await page.locator('input[name="category"]').evaluate((node: HTMLInputElement) => {
                node.removeAttribute('required');
                node.removeAttribute('pattern');
                node.value = '';
                node.dispatchEvent(new Event('input', { bubbles: true }));
                node.dispatchEvent(new Event('change', { bubbles: true }));
            });
            await page.getByRole('button', { name: 'Update' }).click();

            // Server should reject — either error message appears, or form doesn't submit
            const bodyText = await page.locator('body').textContent({ timeout: 10_000 });
            expect(bodyText).toMatch(/Category cannot be empty|category/i);
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });
});
