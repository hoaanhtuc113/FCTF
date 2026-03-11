import { test, expect } from '@playwright/test';
import {
    ADMIN_URL,
    createChallenge,
    loginAdmin,
    searchChallenge,
    uniqueChallengeName,
    deleteChallengeViaApi,
    deleteChallengeViaUi,
} from './challenge-admin-support';

test.describe('UC05 Delete Challenge', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        test.setTimeout(180_000);
        await loginAdmin(page);
    });

    test('DCH-01: Delete an existing challenge from detail page', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc05-delete'),
            category: 'forensics',
            description: 'Challenge created for delete use case',
            timeLimit: '20',
            maxAttempts: '2',
            cooldown: '0',
            value: '150',
            flag: 'FCTF{uc05-delete}',
            state: 'hidden',
        });

        await deleteChallengeViaUi(page);

        const row = await searchChallenge(page, created.name);
        await expect(row).toHaveCount(0);
    });

    test('DCH-02: Cancel delete confirmation → challenge still exists', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc05-cancel-delete'),
            category: 'web',
            description: 'Challenge for cancel delete test',
            value: '100',
            flag: 'FCTF{uc05-cancel-delete}',
            state: 'hidden',
        });

        try {
            // Click delete but cancel the confirmation
            await page.locator('.delete-challenge').click();
            const cancelBtn = page.locator('.swal2-cancel, button:has-text("Cancel"), button:has-text("No")').first();
            if (await cancelBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
                await cancelBtn.click();
            } else {
                // If there's a native dialog, dismiss it
                page.once('dialog', (d) => d.dismiss());
                await page.locator('.delete-challenge').click();
            }

            await page.waitForTimeout(1_000);

            // Challenge should still exist
            const row = await searchChallenge(page, created.name);
            await expect(row).toBeVisible();
        } finally {
            await deleteChallengeViaApi(page, created.id);
        }
    });

    test('DCH-03: Delete a visible challenge → removed from list', async ({ page }) => {
        const created = await createChallenge(page, {
            name: uniqueChallengeName('uc05-delete-visible'),
            category: 'crypto',
            description: 'Visible challenge for delete test',
            value: '200',
            flag: 'FCTF{uc05-delete-visible}',
            state: 'visible',
        });

        await deleteChallengeViaUi(page);

        const row = await searchChallenge(page, created.name);
        await expect(row).toHaveCount(0);
    });

    test('DCH-04: Delete a dynamic scoring challenge → removed from list', async ({ page }) => {
        const created = await createChallenge(page, {
            type: 'dynamic',
            name: uniqueChallengeName('uc05-delete-dynamic'),
            category: 'misc',
            description: 'Dynamic challenge for delete test',
            initial: '500',
            minimum: '100',
            decay: '25',
            decayFunction: 'linear',
            flag: 'FCTF{uc05-delete-dynamic}',
            state: 'hidden',
        });

        await deleteChallengeViaUi(page);

        const row = await searchChallenge(page, created.name);
        await expect(row).toHaveCount(0);
    });
});