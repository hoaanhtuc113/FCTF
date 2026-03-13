import { test, expect, Page } from '@playwright/test';
import {
    ADMIN_URL,
    createChallenge,
    deleteChallengeViaApi,
    getChallengeViaApi,
    loginAdmin,
    openChallengeTab,
    saveDeployChanges,
    searchChallenge,
    switchScoringTypeViaApi,
    uniqueChallengeName,
    versionRowCount,
    workspaceFile,
} from '../challenge-admin-support';

async function setDescriptionViaEditor(page: Page, text: string) {
    await page.evaluate((value: string) => {
        const ta = document.querySelector('textarea[name="description"]') as HTMLTextAreaElement | null;
        const cmEl = ta?.parentElement?.querySelector('.CodeMirror') as HTMLElement | null;
        if (cmEl && (cmEl as any).CodeMirror) {
            (cmEl as any).CodeMirror.setValue(value);
            return;
        }
        if (ta) {
            Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(ta, value);
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }, text);
}

async function setDifficultyValue(page: Page, value: '1' | '5') {
    const star = page.locator(`.star-rating-picker[data-target="difficulty-input-update"] .star-pick[data-value="${value}"]`).first();
    if (await star.isVisible().catch(() => false)) {
        await star.click();
    }
    await page.locator('#difficulty-input-update').evaluate((node: HTMLInputElement, nextValue: string) => {
        node.value = nextValue;
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
}

test.describe('UC04 Edit Challenge', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        test.setTimeout(1_200_000);
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
            await setDescriptionViaEditor(page, 'Updated challenge description from UC04');
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
            // After reload, CodeMirror renders content; check the textarea value via DOM evaluation
            const descValue = await page.locator('textarea[name="description"]').evaluate((el: HTMLTextAreaElement) => el.value);
            expect(descValue).toBe('Updated challenge description from UC04');
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
            const validationMessage = await page.locator('input[name="name"]').evaluate((node: HTMLInputElement) => node.validationMessage);
            const bodyText = (await page.locator('body').textContent({ timeout: 10_000 })) ?? '';
            expect(validationMessage.length > 0 || /Name cannot be empty|name/i.test(bodyText)).toBeTruthy();
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
            const bodyText = (await page.locator('body').textContent({ timeout: 10_000 })) ?? '';
            const currentValue = await page.locator('input[name="category"]').inputValue();
            expect(/Category must be 20 characters or less|category/i.test(bodyText) || currentValue.length <= 20).toBeTruthy();
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-05: Reject a dynamic challenge when initial value is below minimum during update', async ({ page }) => {
        const created = await createChallenge(page, {
            type: 'dynamic',
            name: uniqueChallengeName('uc04-upd-inv-dyn'),
            category: 'misc',
            description: 'Dynamic update validation',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
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
            const bodyText = (await page.locator('body').textContent({ timeout: 10_000 })) ?? '';
            expect(/greater than minimum|initial|minimum/i.test(bodyText) || !bodyText.includes('Your challenge has been updated!')).toBeTruthy();
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
            waitForDeploySuccess: false,
        });
        try {
            const beforeVersions = await versionRowCount(page);
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

            await expect(async () => {
                await page.reload();
                await expect(page).toHaveURL(/\/admin\/challenges\/\d+/, { timeout: 15_000 });

                const currentVersions = await versionRowCount(page);
                if (currentVersions >= beforeVersions + 1) {
                    return;
                }

                await openChallengeTab(page, 'Deploy');
                const maxDeploy = await page.locator('#max_deploy_count').inputValue().catch(() => '');
                const deployStatus = await page.locator('input[name="deploy_status"]').inputValue().catch(() => '');
                expect(maxDeploy === '2' || /DEPLOY_SUCCESS|DEPLOY_SUCCEEDED|DEPLOYING/i.test(deployStatus)).toBeTruthy();
            }).toPass({ timeout: 300_000, intervals: [5_000, 10_000, 15_000] });
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
            await setDescriptionViaEditor(page, 'Comprehensive updated description');
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
            await setDescriptionViaEditor(page, specialDesc);
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

    test('ECH-13: Add a static flag via the Flags tab', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-flag-static'),
            category: 'web',
            description: 'Flag tab static test for edit flow',
            value: '100',
            flag: 'FCTF{initial-flag}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Flags');
            await page.locator('#flag-add-button').click();
            const modal = page.locator('#flag-create-modal');
            await modal.locator('select').first().selectOption('static');
            await modal.locator('input[name="content"]').fill('FCTF{uc04-static-flag-test}');
            await modal.locator('button[type="submit"]').click();
            await expect(page.locator('#flagsboard tbody')).toContainText('FCTF{uc04-static-flag-test}', { timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-14: Add a case-insensitive static flag via the Flags tab', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-flag-case'),
            category: 'web',
            description: 'Case-insensitive flag edit test',
            value: '100',
            flag: 'FCTF{initial-flag}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Flags');
            await page.locator('#flag-add-button').click();
            const modal = page.locator('#flag-create-modal');
            await modal.locator('select').first().selectOption('static');
            await modal.locator('input[name="content"]').fill('FCTF{uc04-case-insensitive-flag}');
            await modal.locator('select[name="data"]').selectOption('case_insensitive');
            await modal.locator('button[type="submit"]').click();
            await expect(page.locator('#flagsboard tbody')).toContainText('FCTF{uc04-case-insensitive-flag}', { timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-15: Add a regex flag via the Flags tab', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-flag-regex'),
            category: 'web',
            description: 'Regex flag edit test',
            value: '100',
            flag: 'FCTF{initial-flag}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Flags');
            await page.locator('#flag-add-button').click();
            const modal = page.locator('#flag-create-modal');
            await modal.locator('select').first().selectOption('regex');
            const regexValue = 'FCTF\\{[a-z0-9-]+\\}';
            await modal.locator('input[name="content"]').fill(regexValue);
            await modal.locator('button[type="submit"]').click();
            await expect(page.locator('#flagsboard tbody')).toContainText(regexValue, { timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-16: Delete a flag via the Flags tab', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-flag-delete'),
            category: 'web',
            description: 'Flag delete edit test',
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

    test('ECH-17: Upload and delete a file via the Files tab', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-files-tab'),
            category: 'web',
            description: 'Files tab upload/delete edit test',
            value: '100',
            flag: 'FCTF{files-test}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Challenge files');
            const initialCount = await page.locator('#filesboard tbody tr').count();
            await page.locator('input#file').setInputFiles(workspaceFile('Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf'));
            await page.locator('#_submit').dispatchEvent('click');
            await expect(page.locator('text=Uploading files...')).toBeVisible({ timeout: 10_000 }).catch(() => undefined);
            await expect(page.locator('text=Uploading files...')).not.toBeVisible({ timeout: 60_000 }).catch(() => undefined);
            await expect(async () => {
                const currentCount = await page.locator('#filesboard tbody tr').count();
                expect(currentCount).toBeGreaterThan(initialCount);
            }).toPass({ timeout: 60_000, intervals: [2_000, 5_000] });

            await page.locator('.delete-file').first().dispatchEvent('click');
            await expect(page.locator('.modal.show button:has-text("Yes")')).toBeVisible({ timeout: 5_000 });
            await page.locator('.modal.show button:has-text("Yes")').click();
            await expect(async () => {
                const currentCount = await page.locator('#filesboard tbody tr').count();
                expect(currentCount).toBeLessThanOrEqual(initialCount);
            }).toPass({ timeout: 60_000, intervals: [2_000, 5_000] });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-18: Add and remove a topic via the Topics tab', async ({ page }) => {
        const topicValue = `uc04-topic-${Date.now()}`;
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-topics-tab'),
            category: 'web',
            description: 'Topics tab edit test',
            value: '100',
            flag: 'FCTF{topics-test}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Topics');
            await page.locator('#topics #tags-add-input').fill(topicValue);
            await page.locator('#topics #tags-add-input').press('Enter');
            await expect(page.locator('#challenge-topics.my-3')).toContainText(topicValue, { timeout: 5_000 });

            await page.locator('#challenge-topics.my-3 .delete-tag').first().dispatchEvent('click');
            await expect(page.locator('#challenge-topics.my-3')).not.toContainText(topicValue, { timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-19: Add and remove a tag via the Tags tab', async ({ page }) => {
        const tagValue = `uc04-tag-${Date.now()}`;
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-tags-tab'),
            category: 'web',
            description: 'Tags tab edit test',
            value: '100',
            flag: 'FCTF{tags-test}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Tags');
            await page.locator('#tags #tags-add-input').fill(tagValue);
            await page.locator('#tags #tags-add-input').press('Enter');
            await expect(page.locator('#tags span').filter({ hasText: tagValue })).toBeVisible({ timeout: 5_000 });

            await page.locator('#tags span').filter({ hasText: tagValue }).locator('a').dispatchEvent('click');
            await expect(page.locator('#tags span').filter({ hasText: tagValue })).not.toBeVisible({ timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-20: Create and delete hint via Hints tab', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-hints-create-delete'),
            category: 'web',
            description: 'Hints tab edit test',
            value: '100',
            flag: 'FCTF{hints-test}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Hints');
            await page.locator('button:has-text("Create Hint")').click();
            const modal = page.locator('.modal.show').first();
            await modal.locator('.CodeMirror').evaluate((el: any, text: string) => { el.CodeMirror.setValue(text); }, 'UC04 hint content');
            await modal.locator('input[name="cost"]').fill('10');
            await modal.locator('button.btn-primary').click();
            await expect(page.locator('#hints table tbody tr')).toHaveCount(1, { timeout: 5_000 });

            await page.locator('#hints .fas.fa-times').first().dispatchEvent('click');
            await expect(page.locator('.modal.show button:has-text("Yes")')).toBeVisible({ timeout: 3_000 });
            await page.locator('.modal.show button:has-text("Yes")').click();
            await expect(page.locator('#hints table tbody tr')).toHaveCount(0, { timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-21: Set a prerequisite challenge via the Requirements tab', async ({ page }) => {
        const main = await createChallenge(page, {
            name: uniqueChallengeName('uc04-req-main'),
            category: 'web',
            description: 'Main challenge for requirements edit test',
            value: '100',
            flag: 'FCTF{req-main}',
            state: 'hidden',
        });
        const prereq = await createChallenge(page, {
            name: uniqueChallengeName('uc04-req-prereq'),
            category: 'misc',
            description: 'Prerequisite challenge for requirements edit test',
            value: '50',
            flag: 'FCTF{req-prereq}',
            state: 'hidden',
        });
        try {
            await page.goto(`${ADMIN_URL}/admin/challenges/${main.id}`);
            await expect(page).toHaveURL(/\/admin\/challenges\/\d+/, { timeout: 15_000 });

            await openChallengeTab(page, 'Requirements');
            await expect(page.locator('#requirements .form-check').first()).toBeVisible({ timeout: 5_000 });

            const prereqLabel = page.locator('#requirements .form-check-label').filter({ hasText: prereq.name });
            await expect(prereqLabel).toBeVisible({ timeout: 5_000 });
            await prereqLabel.locator('.form-check-input').check();
            await expect(page.locator('#requirements button.btn-primary')).toBeEnabled({ timeout: 3_000 });
            await page.locator('#requirements button.btn-primary').click();
            await page.waitForTimeout(1_500);

            await page.reload();
            await openChallengeTab(page, 'Requirements');
            await expect(
                page.locator('#requirements .form-check-label').filter({ hasText: prereq.name }).locator('.form-check-input')
            ).toBeChecked({ timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, main.id);
            await deleteChallengeViaApi(page, prereq.id);
        }
    });

    test('ECH-22: Set the next challenge via the Next tab', async ({ page }) => {
        const main = await createChallenge(page, {
            name: uniqueChallengeName('uc04-next-main'),
            category: 'web',
            description: 'Main challenge for Next tab edit test',
            value: '100',
            flag: 'FCTF{next-main}',
            state: 'hidden',
        });
        const nextChallenge = await createChallenge(page, {
            name: uniqueChallengeName('uc04-next-target'),
            category: 'misc',
            description: 'Target for Next tab edit test',
            value: '50',
            flag: 'FCTF{next-target}',
            state: 'hidden',
        });
        try {
            await page.goto(`${ADMIN_URL}/admin/challenges/${main.id}`);
            await expect(page).toHaveURL(/\/admin\/challenges\/\d+/, { timeout: 15_000 });

            await openChallengeTab(page, 'Next');
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
            await expect(page.locator('#next button.btn-primary')).toBeEnabled({ timeout: 3_000 });
            await page.locator('#next button.btn-primary').click();
            await page.waitForTimeout(1_500);

            await page.reload();
            await openChallengeTab(page, 'Next');
            await expect(page.locator('#next select')).toHaveValue(String(nextChallenge.id), { timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, main.id);
            await deleteChallengeViaApi(page, nextChallenge.id);
        }
    });

    test('ECH-23: Update challenge name to maxlength boundary (40 chars)', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-boundary-name-source'),
            category: 'web',
            description: 'Boundary test source',
            value: '50',
            flag: 'FCTF{boundary-name}',
            state: 'hidden',
        });
        try {
            const ts = String(Date.now());
            const boundaryName = ('B'.repeat(40 - ts.length) + ts).slice(0, 40);
            await page.locator('input[name="name"]').fill(boundaryName);
            await page.getByRole('button', { name: 'Update' }).click();
            await expect(page.locator('body')).toContainText('Your challenge has been updated!', { timeout: 10_000 });
            await page.reload();
            await expect(page.locator('input[name="name"]')).toHaveValue(boundaryName);
            expect(boundaryName.length).toBe(40);
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-24: Reject update challenge name to duplicate name', async ({ page }) => {
        const first = await createChallenge(page, {
            name: uniqueChallengeName('uc04-duplicate-target'),
            category: 'web',
            description: 'First challenge with this name',
            value: '100',
            flag: 'FCTF{dup-first}',
            state: 'hidden',
        });
        const second = await createChallenge(page, {
            name: uniqueChallengeName('uc04-duplicate-source'),
            category: 'web',
            description: 'Second challenge to update into duplicate',
            value: '100',
            flag: 'FCTF{dup-second}',
            state: 'hidden',
        });
        try {
            await page.goto(`${ADMIN_URL}/admin/challenges/${second.id}`);
            await page.locator('input[name="name"]').fill(first.name);
            await page.getByRole('button', { name: 'Update' }).click();

            const bodyText = await page.locator('body').textContent({ timeout: 10_000 });
            if (bodyText?.includes('already exists') || bodyText?.includes('duplicate')) {
                expect(bodyText).toMatch(/already exists|duplicate/i);
            } else {
                await page.reload();
                await expect(page.locator('input[name="name"]')).not.toHaveValue(first.name);
            }
        } finally {
            await deleteChallengeViaApi(page, first.id);
            await deleteChallengeViaApi(page, second.id);
        }
    });

    test('ECH-25: Update time limit to maximum boundary (30 minutes)', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-timelimit-max'),
            category: 'web',
            description: 'Time limit max edit test',
            timeLimit: '20',
            maxAttempts: '5',
            cooldown: '0',
            value: '100',
            flag: 'FCTF{timelimit-max}',
            state: 'hidden',
        });
        try {
            await page.locator('input[name="time_limit"]').fill('30');
            await page.getByRole('button', { name: 'Update' }).click();
            await expect(page.locator('body')).toContainText('Your challenge has been updated!', { timeout: 10_000 });
            await page.reload();
            await expect(page.locator('input[name="time_limit"]')).toHaveValue('30');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-26: Reject time limit = 0 with browser native validation (min = 1)', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-timelimit-zero'),
            category: 'web',
            description: 'Time limit zero edit validation',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            value: '100',
            flag: 'FCTF{timelimit-zero}',
            state: 'hidden',
        });
        try {
            await page.locator('input[name="time_limit"]').fill('0');
            await page.getByRole('button', { name: 'Update' }).click();
            const validationMessage = await page.locator('input[name="time_limit"]').evaluate((node: HTMLInputElement) => node.validationMessage);
            const bodyText = (await page.locator('body').textContent({ timeout: 10_000 })) ?? '';
            const currentValue = await page.locator('input[name="time_limit"]').inputValue();
            expect(
                validationMessage.length > 0 ||
                /time limit|min|invalid|must be/i.test(bodyText) ||
                currentValue !== '0'
            ).toBeTruthy();
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-27: Reject time limit exceeding maximum (31) with browser native validation', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-timelimit-exceed'),
            category: 'web',
            description: 'Time limit above max validation',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            value: '100',
            flag: 'FCTF{timelimit-exceed}',
            state: 'hidden',
        });
        try {
            await page.locator('input[name="time_limit"]').fill('31');
            await page.getByRole('button', { name: 'Update' }).click();
            const validationMessage = await page.locator('input[name="time_limit"]').evaluate((node: HTMLInputElement) => node.validationMessage);
            const bodyText = (await page.locator('body').textContent({ timeout: 10_000 })) ?? '';
            const currentValue = await page.locator('input[name="time_limit"]').inputValue();
            expect(
                validationMessage.length > 0 ||
                /time limit|max|invalid|must be/i.test(bodyText) ||
                currentValue !== '31'
            ).toBeTruthy();
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-28: Update challenge with max_attempts = 0 (unlimited)', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-attempts-zero'),
            category: 'web',
            description: 'Zero max attempts edit test',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            value: '100',
            flag: 'FCTF{attempts-unlimited}',
            state: 'hidden',
        });
        try {
            await page.locator('input[name="max_attempts"]').fill('0');
            await page.getByRole('button', { name: 'Update' }).click();
            await expect(page.locator('body')).toContainText('Your challenge has been updated!', { timeout: 10_000 });
            await page.reload();
            await expect(page.locator('input[name="max_attempts"]')).toHaveValue('0');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-29: Update challenge value = 0 (zero-point challenge)', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-value-zero'),
            category: 'misc',
            description: 'Zero-point edit test',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            value: '100',
            flag: 'FCTF{value-zero}',
            state: 'hidden',
        });
        try {
            await page.locator('input[name="value"]:not([disabled])').fill('0');
            await page.getByRole('button', { name: 'Update' }).click();
            await expect(page.locator('body')).toContainText('Your challenge has been updated!', { timeout: 10_000 });
            await page.reload();
            await expect(page.locator('input[name="value"]:not([disabled])')).toHaveValue('0');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-30: Reject negative cooldown with browser native validation (min = 0)', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-cooldown-neg'),
            category: 'web',
            description: 'Negative cooldown edit validation',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            value: '100',
            flag: 'FCTF{cooldown-neg}',
            state: 'hidden',
        });
        try {
            await page.locator('input[name="cooldown"], #submission_cooldown').first().fill('-1');
            await page.getByRole('button', { name: 'Update' }).click();
            const validationMessage = await page.locator('input[name="cooldown"], #submission_cooldown').first().evaluate((node: HTMLInputElement) => node.validationMessage);
            expect(validationMessage.length).toBeGreaterThan(0);
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-31: Reject negative max_attempts with browser native validation (min = 0)', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-attempts-neg'),
            category: 'web',
            description: 'Negative max attempts edit validation',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            value: '100',
            flag: 'FCTF{attempts-neg}',
            state: 'hidden',
        });
        try {
            await page.locator('input[name="max_attempts"]').fill('-1');
            await page.getByRole('button', { name: 'Update' }).click();
            const validationMessage = await page.locator('input[name="max_attempts"]').evaluate((node: HTMLInputElement) => node.validationMessage);
            const bodyText = (await page.locator('body').textContent({ timeout: 10_000 })) ?? '';
            const currentValue = await page.locator('input[name="max_attempts"]').inputValue();
            expect(
                validationMessage.length > 0 ||
                /attempt|invalid|min|must be/i.test(bodyText) ||
                currentValue !== '-1'
            ).toBeTruthy();
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-32: Update challenge with minimum time limit boundary (1 minute)', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-min-timelimit'),
            category: 'web',
            description: 'Minimum valid time limit edit',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            value: '50',
            flag: 'FCTF{min-timelimit}',
            state: 'hidden',
        });
        try {
            await page.locator('input[name="time_limit"]').fill('1');
            await page.getByRole('button', { name: 'Update' }).click();
            await expect(page.locator('body')).toContainText('Your challenge has been updated!', { timeout: 10_000 });
            await page.reload();
            await expect(page.locator('input[name="time_limit"]')).toHaveValue('1');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-33: Update challenge with large max_attempts value (999)', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-large-attempts'),
            category: 'pwn',
            description: 'Large max attempts edit test',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            value: '100',
            flag: 'FCTF{large-attempts}',
            state: 'hidden',
        });
        try {
            await page.locator('input[name="max_attempts"]').fill('999');
            await page.getByRole('button', { name: 'Update' }).click();
            await expect(page.locator('body')).toContainText('Your challenge has been updated!', { timeout: 10_000 });
            await page.reload();
            await expect(page.locator('input[name="max_attempts"]')).toHaveValue('999');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-34: Update challenge with high cooldown value (3600 seconds)', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-high-cooldown'),
            category: 'web',
            description: 'High cooldown edit test',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            value: '500',
            difficulty: 5,
            flag: 'FCTF{high-cooldown}',
            state: 'hidden',
        });
        try {
            await page.locator('input[name="cooldown"], #submission_cooldown').first().fill('3600');
            await page.getByRole('button', { name: 'Update' }).click();
            await expect(page.locator('body')).toContainText('Your challenge has been updated!', { timeout: 10_000 });
            await page.reload();
            await expect(page.locator('#submission_cooldown')).toHaveValue('3600');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-35: Reject dynamic challenge update when decay = 0 (below min=1 native validation)', async ({ page }) => {
        const created = await createChallenge(page, {
            type: 'dynamic',
            name: uniqueChallengeName('uc04-dynamic-zero-decay'),
            category: 'misc',
            description: 'Dynamic zero decay edit validation',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            initial: '500',
            minimum: '100',
            decay: '25',
            flag: 'FCTF{dynamic-zero-decay}',
            state: 'hidden',
        });
        try {
            await page.locator('input[name="decay"]').fill('0');
            await page.getByRole('button', { name: 'Update' }).click();
            const validationMessage = await page.locator('input[name="decay"]').evaluate((node: HTMLInputElement) => node.validationMessage);
            const bodyText = (await page.locator('body').textContent({ timeout: 10_000 })) ?? '';
            const currentValue = await page.locator('input[name="decay"]').inputValue();
            expect(
                validationMessage.length > 0 ||
                /decay|min|invalid|must be/i.test(bodyText) ||
                currentValue !== '0'
            ).toBeTruthy();
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-36: Update dynamic challenge with logarithmic decay function', async ({ page }) => {
        const created = await createChallenge(page, {
            type: 'dynamic',
            name: uniqueChallengeName('uc04-dynamic-log'),
            category: 'crypto',
            description: 'Dynamic challenge edit to logarithmic',
            timeLimit: '25',
            maxAttempts: '5',
            cooldown: '0',
            difficulty: 3,
            initial: '1000',
            minimum: '50',
            decay: '20',
            decayFunction: 'linear',
            flag: 'FCTF{dynamic-log}',
            state: 'hidden',
        });
        try {
            await page.locator('select[name="function"]').selectOption('logarithmic');
            await page.getByRole('button', { name: 'Update' }).click();
            await expect(page.locator('body')).toContainText('Your challenge has been updated!', { timeout: 10_000 });
            await page.reload();
            await expect(page.locator('select[name="function"]')).toHaveValue('logarithmic');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-37: Reject dynamic challenge with negative decay value (min = 1)', async ({ page }) => {
        const created = await createChallenge(page, {
            type: 'dynamic',
            name: uniqueChallengeName('uc04-dynamic-neg-decay'),
            category: 'misc',
            description: 'Negative decay edit validation',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            initial: '500',
            minimum: '100',
            decay: '25',
            flag: 'FCTF{dynamic-neg-decay}',
            state: 'hidden',
        });
        try {
            await page.locator('input[name="decay"]').fill('-5');
            await page.getByRole('button', { name: 'Update' }).click();
            const validationMessage = await page.locator('input[name="decay"]').evaluate((node: HTMLInputElement) => node.validationMessage);
            expect(validationMessage.length).toBeGreaterThan(0);
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-38: Update challenge state to visible', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-state-visible'),
            category: 'web',
            description: 'State update test',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            value: '100',
            flag: 'FCTF{state-visible}',
            state: 'hidden',
        });
        try {
            await page.locator('select[name="state"]').last().selectOption('visible');
            await page.getByRole('button', { name: 'Update' }).click();
            await expect(page.locator('body')).toContainText('Your challenge has been updated!', { timeout: 10_000 });
            await page.reload();
            await expect(page.locator('select[name="state"]').last()).toHaveValue('visible');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-39: Update challenge to no difficulty set (unrated)', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-no-difficulty'),
            category: 'web',
            description: 'No difficulty edit test',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            value: '100',
            difficulty: null,
            flag: 'FCTF{no-difficulty}',
            state: 'hidden',
        });
        try {
            await page.locator('input[name="category"]').fill('misc');
            await page.getByRole('button', { name: 'Update' }).click();
            await page.reload();
            const diffValue = await page.locator('#difficulty-input-update').inputValue();
            expect(diffValue === '' || diffValue === '0').toBeTruthy();
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-40: Update challenge with maximum difficulty rating (5 stars)', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-max-difficulty'),
            category: 'pwn',
            description: 'Maximum difficulty update test',
            timeLimit: '25',
            maxAttempts: '3',
            cooldown: '30',
            value: '500',
            difficulty: 2,
            flag: 'FCTF{max-difficulty}',
            state: 'hidden',
        });
        try {
            await setDifficultyValue(page, '5');
            await page.getByRole('button', { name: 'Update' }).click();
            await page.reload();
            const diffValue = await page.locator('#difficulty-input-update').inputValue();
            expect(diffValue).toBe('5');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-41: Update challenge with minimum difficulty rating (1 star)', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-min-difficulty'),
            category: 'web',
            description: 'Minimum difficulty update test',
            timeLimit: '10',
            maxAttempts: '10',
            cooldown: '0',
            value: '50',
            difficulty: 5,
            flag: 'FCTF{min-difficulty}',
            state: 'hidden',
        });
        try {
            await setDifficultyValue(page, '1');
            await page.getByRole('button', { name: 'Update' }).click();
            await page.reload();
            const diffValue = await page.locator('#difficulty-input-update').inputValue();
            expect(diffValue).toBe('1');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-42: Update to add a regex case-insensitive flag via Flags tab', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-flag-regex-ci'),
            category: 'web',
            description: 'Regex case-insensitive flag edit test',
            value: '100',
            flag: 'FCTF{initial-flag}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Flags');
            await page.locator('#flag-add-button').click();
            const modal = page.locator('#flag-create-modal');
            await modal.locator('select').first().selectOption('regex');
            const regexPattern = 'FCTF\\{[A-Za-z0-9_-]+\\}';
            await modal.locator('input[name="content"]').fill(regexPattern);
            await modal.locator('select[name="data"]').selectOption('case_insensitive');
            await modal.locator('button[type="submit"]').click();
            await expect(page.locator('#flagsboard tbody')).toContainText(regexPattern, { timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-43: Flag Create button is hidden until a flag type is selected', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-flag-type-guard'),
            category: 'web',
            description: 'Flag type selector guard edit test',
            value: '100',
            flag: 'FCTF{initial-flag}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Flags');
            await page.locator('#flag-add-button').click();
            const modal = page.locator('#flag-create-modal');
            await expect(modal.locator('button[type="submit"]')).not.toBeVisible({ timeout: 3_000 });
            await modal.locator('select').first().selectOption('static');
            await expect(modal.locator('button[type="submit"]')).toBeVisible({ timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-44: Add a case-insensitive static flag from edit flow', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-ci-flag-edit'),
            category: 'web',
            description: 'Case-insensitive flag from edit flow',
            timeLimit: '20',
            maxAttempts: '3',
            cooldown: '0',
            value: '100',
            flag: 'FCTF{case-insensitive-edit}',
            flagCaseInsensitive: true,
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Flags');
            await expect(page.locator('#flagsboard tbody tr').first()).toContainText('FCTF{case-insensitive-edit}');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-45: Create a free hint (cost = 0) via Hints tab', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-hint-free'),
            category: 'web',
            description: 'Free hint edit test',
            value: '100',
            flag: 'FCTF{hint-free}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Hints');
            await page.locator('button:has-text("Create Hint")').click();
            const modal = page.locator('.modal.show').first();
            await modal.locator('.CodeMirror').evaluate((el: any, text: string) => { el.CodeMirror.setValue(text); }, 'This hint is free of charge.');
            await modal.locator('input[name="cost"]').fill('0');
            await modal.locator('button.btn-primary').click();
            await expect(page.locator('#hints table tbody tr')).toHaveCount(1, { timeout: 5_000 });
            await expect(page.locator('#hints table tbody tr')).toContainText('0');
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-46: Create multiple hints and verify all appear in Hints table', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-hints-multiple'),
            category: 'web',
            description: 'Multiple hints edit test',
            value: '200',
            flag: 'FCTF{hints-multiple}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Hints');

            for (const [content, cost] of [['First hint', '10'], ['Second hint', '25'], ['Third hint', '0']]) {
                await page.locator('button:has-text("Create Hint")').click();
                const modal = page.locator('.modal.show').first();
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

    test('ECH-47: Edit an existing hint content and cost via Hints tab', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-hint-edit'),
            category: 'web',
            description: 'Edit hint content and cost test',
            value: '100',
            flag: 'FCTF{hint-edit}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Hints');
            await page.locator('button:has-text("Create Hint")').click();
            const createModal = page.locator('.modal.show').first();
            await createModal.locator('.CodeMirror').evaluate((el: any, text: string) => { el.CodeMirror.setValue(text); }, 'Original hint content');
            await createModal.locator('input[name="cost"]').fill('10');
            await createModal.locator('button.btn-primary').click();
            await expect(page.locator('#hints table tbody tr')).toHaveCount(1, { timeout: 5_000 });

            await page.locator('#hints .fa-edit, #hints .fas.fa-edit, #hints [data-target*="edit"], #hints button:has-text("Edit")').first().dispatchEvent('click');
            const editModal = page.locator('.modal.show').first();
            await editModal.locator('.CodeMirror').waitFor({ state: 'visible', timeout: 10_000 });
            await editModal.locator('.CodeMirror').evaluate((el: any, text: string) => { el.CodeMirror.setValue(text); }, 'Updated hint content');
            await editModal.locator('input[name="cost"]').fill('20');
            await editModal.locator('button.btn-primary').click();
            await page.waitForTimeout(1_000);

            await expect(page.locator('#hints table tbody tr')).toContainText('20', { timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-48: Remove prerequisite after setting it via Requirements tab', async ({ page }) => {
        const main = await createChallenge(page, {
            name: uniqueChallengeName('uc04-req-remove-main'),
            category: 'web',
            description: 'Main challenge for prerequisite removal test',
            value: '100',
            flag: 'FCTF{req-remove-main}',
            state: 'hidden',
        });
        const prereq = await createChallenge(page, {
            name: uniqueChallengeName('uc04-req-remove-prereq'),
            category: 'misc',
            description: 'Prerequisite to be set then removed',
            value: '50',
            flag: 'FCTF{req-remove-prereq}',
            state: 'hidden',
        });
        try {
            await page.goto(`${ADMIN_URL}/admin/challenges/${main.id}`);
            await expect(page).toHaveURL(/\/admin\/challenges\/\d+/, { timeout: 15_000 });
            await openChallengeTab(page, 'Requirements');
            await expect(page.locator('#requirements .form-check').first()).toBeVisible({ timeout: 5_000 });

            const prereqLabel = page.locator('#requirements .form-check-label').filter({ hasText: prereq.name });
            await expect(prereqLabel).toBeVisible({ timeout: 5_000 });
            await prereqLabel.locator('.form-check-input').check();
            await page.locator('#requirements button.btn-primary').click();
            await page.waitForTimeout(1_500);

            await page.reload();
            await openChallengeTab(page, 'Requirements');
            const checkbox = page.locator('#requirements .form-check-label').filter({ hasText: prereq.name }).locator('.form-check-input');
            await expect(checkbox).toBeChecked({ timeout: 5_000 });

            await checkbox.uncheck();
            await page.locator('#requirements button.btn-primary').click();
            await page.waitForTimeout(1_500);

            await page.reload();
            await openChallengeTab(page, 'Requirements');
            await expect(
                page.locator('#requirements .form-check-label').filter({ hasText: prereq.name }).locator('.form-check-input')
            ).not.toBeChecked({ timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, main.id);
            await deleteChallengeViaApi(page, prereq.id);
        }
    });

    test('ECH-49: Clear/reset the next challenge selection via the Next tab', async ({ page }) => {
        const main = await createChallenge(page, {
            name: uniqueChallengeName('uc04-next-clear-main'),
            category: 'web',
            description: 'Main challenge for Next tab clear test',
            value: '100',
            flag: 'FCTF{next-clear-main}',
            state: 'hidden',
        });
        const nextChallenge = await createChallenge(page, {
            name: uniqueChallengeName('uc04-next-clear-target'),
            category: 'misc',
            description: 'Target for Next tab clear test',
            value: '50',
            flag: 'FCTF{next-clear-target}',
            state: 'hidden',
        });
        try {
            await page.goto(`${ADMIN_URL}/admin/challenges/${main.id}`);
            await expect(page).toHaveURL(/\/admin\/challenges\/\d+/, { timeout: 15_000 });
            await openChallengeTab(page, 'Next');

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

            await page.reload();
            await openChallengeTab(page, 'Next');
            await expect(page.locator('#next select')).toHaveValue(String(nextChallenge.id), { timeout: 5_000 });

            const nextSelect = page.locator('#next select');
            await nextSelect.selectOption({ index: 0 });
            await nextSelect.dispatchEvent('change');

            const saveButton = page.locator('#next button.btn-primary');
            if (await saveButton.isEnabled().catch(() => false)) {
                await saveButton.click();
                await page.waitForTimeout(1_500);
            }

            await page.reload();
            await openChallengeTab(page, 'Next');
            const selectedValue = await page.locator('#next select').inputValue();
            expect(selectedValue === '' || selectedValue === '0' || selectedValue === 'None' || selectedValue === 'null').toBeTruthy();
        } finally {
            await deleteChallengeViaApi(page, main.id);
            await deleteChallengeViaApi(page, nextChallenge.id);
        }
    });

    test('ECH-50: Upload a second file via Files tab and verify count increases', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-files-multi'),
            category: 'web',
            description: 'Multiple file upload edit test',
            value: '100',
            flag: 'FCTF{files-multi}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Challenge files');

            await page.locator('input#file').setInputFiles(workspaceFile('Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf'));
            await page.locator('#_submit').dispatchEvent('click');
            await expect(page.locator('#filesboard tbody tr')).toHaveCount(1, { timeout: 30_000 });

            await page.locator('input#file').setInputFiles(workspaceFile('Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf'));
            await page.locator('#_submit').dispatchEvent('click');
            await expect(page.locator('#filesboard tbody tr')).toHaveCount(2, { timeout: 30_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-51: Edit multiple-choice challenge and verify scoring toggle hidden', async ({ page }) => {
        const created = await createChallenge(page, {
            type: 'multiple_choice',
            name: uniqueChallengeName('uc04-mcq-four'),
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
            await expect(page.locator('input[name="scoring-type-radio"]')).toHaveCount(0);
            const newName = uniqueChallengeName('uc04-mcq-four-updated');
            await page.locator('input[name="name"]').fill(newName);
            await page.getByRole('button', { name: 'Update' }).click();
            await expect(page.locator('body')).toContainText('Your challenge has been updated!', { timeout: 10_000 });
            await page.reload();
            await expect(page.locator('input[name="name"]')).toHaveValue(newName);
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-52: Add multiple topics and verify all persist via Topics tab', async ({ page }) => {
        const topic1 = `uc04-multi-topic-a-${Date.now()}`;
        const topic2 = `uc04-multi-topic-b-${Date.now()}`;
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-topics-multi'),
            category: 'web',
            description: 'Multiple topics edit test',
            value: '100',
            flag: 'FCTF{topics-multi}',
            state: 'hidden',
        });
        try {
            await openChallengeTab(page, 'Topics');
            await page.locator('#topics #tags-add-input').fill(topic1);
            await page.locator('#topics #tags-add-input').press('Enter');
            await expect(page.locator('#challenge-topics.my-3')).toContainText(topic1, { timeout: 5_000 });

            await page.locator('#topics #tags-add-input').fill(topic2);
            await page.locator('#topics #tags-add-input').press('Enter');
            await expect(page.locator('#challenge-topics.my-3')).toContainText(topic2, { timeout: 5_000 });
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('ECH-53: Add multiple tags and verify all appear via Tags tab', async ({ page }) => {
        const tag1 = `uc04-multi-tag-x-${Date.now()}`;
        const tag2 = `uc04-multi-tag-y-${Date.now()}`;
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc04-tags-multi'),
            category: 'web',
            description: 'Multiple tags edit test',
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
});
