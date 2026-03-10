import { test, expect } from '@playwright/test';
import {
    createChallenge,
    deleteChallengeViaApi,
    loginAdmin,
    openChallengeTab,
    saveDeployChanges,
    versionRowCount,
    waitForVersionCount,
    uniqueChallengeName,
} from './challenge-admin-support';

test.describe('UC13 View Version Detail and UC14 Rollback Version', () => {
    test.describe.configure({ mode: 'serial' });

    let challengeId = 0;
    let challengeName = '';

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            await loginAdmin(page);
            challengeName = uniqueChallengeName('uc13-versioned');
            const created = await createChallenge(page, {
                name: challengeName,
                category: 'web',
                description: 'Versioned docker challenge for UC13 and UC14',
                timeLimit: '20',
                maxAttempts: '3',
                cooldown: '5',
                value: '100',
                flag: 'FCTF{uc13-versioned}',
                state: 'visible',
                setUpDocker: true,
                exposePort: '3000',
                cpuLimit: '200',
                cpuRequest: '50',
                memoryLimit: '256',
                memoryRequest: '64',
                useGvisor: 'false',
                maxDeployCount: '1',
                deployFile: 'EZ_WEB.zip',
                waitForDeploySuccess: true,
            });
            challengeId = created.id;

            await saveDeployChanges(page, {
                exposePort: '3000',
                cpuLimit: '250',
                cpuRequest: '60',
                memoryLimit: '384',
                memoryRequest: '96',
                useGvisor: 'true',
                maxDeployCount: '2',
                deployFile: 'EZ_WEB.zip',
            });
            await waitForVersionCount(page, 2, 300_000);
        } finally {
            await page.close();
        }
    });

    test.afterAll(async ({ browser }) => {
        if (!challengeId) {
            return;
        }

        const page = await browser.newPage();
        try {
            await loginAdmin(page);
            await deleteChallengeViaApi(page, challengeId);
        } finally {
            await page.close();
        }
    });

    test.beforeEach(async ({ page }) => {
        test.setTimeout(360_000);
        await loginAdmin(page);
        await page.goto(`https://admin.fctf.site/admin/challenges/${challengeId}`);
        await expect(page).toHaveURL(new RegExp(`/admin/challenges/${challengeId}$`), { timeout: 20_000 });
    });

    test('VVD-01: View an inactive image version detail page', async ({ page }) => {
        await openChallengeTab(page, 'Versions');
        expect(await versionRowCount(page)).toBeGreaterThanOrEqual(2);

        const inactiveRow = page.locator('#versions tbody tr', { hasText: 'OLD' }).first();
        await expect(inactiveRow).toBeVisible();
        await inactiveRow.locator('a[title="View detail"]').click();

        await expect(page).toHaveURL(/\/versions\/\d+$/, { timeout: 15_000 });
        await expect(page.locator('h1')).toContainText('Version');
        await expect(page.locator('body')).toContainText('Image Information');
        await expect(page.locator('body')).toContainText('Resource Configuration');
        await expect(page.locator('body')).toContainText('Metadata');
        await expect(page.locator('body')).toContainText('Notes');
    });

    test('RBV-01: Roll back the challenge to a previous image version', async ({ page }) => {
        await openChallengeTab(page, 'Versions');
        const inactiveRow = page.locator('#versions tbody tr', { hasText: 'OLD' }).first();
        await inactiveRow.locator('a[title="View detail"]').click();

        await page.locator('#rollback-btn').click();
        await expect(page.locator('#rollback-modal')).toHaveClass(/show/);
        await page.locator('#confirm-rollback-btn').click();

        await expect(page.locator('#rollback-status')).toContainText('Challenge rolled back to version', { timeout: 20_000 });
        await page.waitForLoadState('load');
        await expect(page.locator('.active-banner')).toContainText('currently active version', { timeout: 20_000 });

        await page.goto(`https://admin.fctf.site/admin/challenges/${challengeId}`);
        await openChallengeTab(page, 'Versions');
        await expect(page.locator('#versions tbody tr', { hasText: 'ACTIVE' }).first()).toBeVisible();
    });
});