import { test, expect } from '@playwright/test';
import {
    createChallenge,
    loginAdmin,
    searchChallenge,
    uniqueChallengeName,
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
});