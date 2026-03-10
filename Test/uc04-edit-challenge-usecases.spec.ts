import { test, expect } from '@playwright/test';
import {
    createChallenge,
    deleteChallengeViaApi,
    fillCreateStepOne,
    loginAdmin,
    openChallengeDetailFromList,
    openChallengeTab,
    openCreateChallenge,
    saveDeployChanges,
    searchChallenge,
    selectChallengeType,
    setScoreVisibility,
    submitCreateStepOne,
    uniqueChallengeName,
    waitForVersionCount,
} from './challenge-admin-support';

test.describe('UC04 Edit Challenge', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        test.setTimeout(240_000);
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
            await page.locator('input[name="value"]').fill('250');
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
            await expect(page.locator('input[name="value"]')).toHaveValue('250');
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
});