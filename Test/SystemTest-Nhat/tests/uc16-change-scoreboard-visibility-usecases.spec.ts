import { test, expect, type Browser, type Page } from '@playwright/test';
import {
    BASE_URL,
    getCSRFToken,
    loginAdmin,
    setScoreVisibility,
} from './support';

type ScoreboardTab = 'Teams' | 'Users';
type VisibilityState = 'Visible' | 'Hidden';

interface ScoreboardTargets {
    userId: number;
    userName: string;
    userHidden: boolean;
    teamId: number;
    teamName: string;
    teamHidden: boolean;
}

async function getUc16Targets(page: Page): Promise<ScoreboardTargets> {
    const usersResponse = await page.request.get(
        `${BASE_URL}/api/v1/users?q=${encodeURIComponent('user3')}&field=name`
    );
    const usersBody = await usersResponse.json();
    const user = (usersBody.data as Array<Record<string, unknown>> | undefined)?.find(
        (candidate) => candidate.name === 'user3'
    );

    if (!user?.id || !user.team_id) {
        throw new Error('UC16 requires an existing contestant user "user3" with an assigned team');
    }

    const teamResponse = await page.request.get(`${BASE_URL}/api/v1/teams/${user.team_id}`);
    const teamBody = await teamResponse.json();
    const team = teamBody.data as Record<string, unknown> | undefined;

    if (!team?.id || !team.name) {
        throw new Error(`UC16 could not load team details for user3 team_id=${String(user.team_id)}`);
    }

    return {
        userId: Number(user.id),
        userName: String(user.name),
        userHidden: Boolean(user.hidden),
        teamId: Number(team.id),
        teamName: String(team.name),
        teamHidden: Boolean(team.hidden),
    };
}

async function patchHiddenState(
    page: Page,
    type: 'user' | 'team',
    id: number,
    hidden: boolean
) {
    const apiUrl = type === 'user'
        ? `${BASE_URL}/api/v1/users/${id}`
        : `${BASE_URL}/api/v1/teams/${id}`;

    await page.goto(`${BASE_URL}/admin/scoreboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const csrfToken = await getCSRFToken(page);
    const result = await page.evaluate(async ({ apiUrl, csrfToken, hidden }) => {
        const response = await fetch(apiUrl, {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'CSRF-Token': csrfToken,
            },
            body: JSON.stringify({ hidden }),
        });

        const responseText = await response.text();
        let body = null;
        try {
            body = responseText ? JSON.parse(responseText) : null;
        } catch (_error) {
            body = null;
        }

        return { status: response.status, body, responseText };
    }, { apiUrl, csrfToken, hidden });

    if (result.status !== 200 || !result.body?.success) {
        throw new Error(
            `Failed to update ${type} ${id} hidden=${hidden}: status=${result.status} body=${JSON.stringify(result.body)} raw=${JSON.stringify(result.responseText)}`
        );
    }
}

async function openAdminScoreboard(page: Page) {
    await page.goto(`${BASE_URL}/admin/scoreboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(page.getByRole('button', { name: /Visibility/i })).toBeVisible({ timeout: 20_000 });
}

async function openScoreboardTab(page: Page, tab: ScoreboardTab) {
    await openAdminScoreboard(page);
    const targetId = tab === 'Teams' ? '#standings' : '#user-standings';
    const tabLink = page.locator(`.nav-tabs a[href="${targetId}"]`).first();

    if (await tabLink.count()) {
        await tabLink.click();
    }

    const pane = page.locator(`${targetId}.tab-pane.active, ${targetId}.show.active`).first();
    await expect(pane).toBeVisible({ timeout: 10_000 });
    return pane;
}

async function getScoreboardRow(page: Page, tab: ScoreboardTab, name: string) {
    const pane = await openScoreboardTab(page, tab);
    const row = pane.locator('tbody tr').filter({ hasText: name }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    return row;
}

async function bulkSetVisibility(
    page: Page,
    tab: ScoreboardTab,
    name: string,
    targetState: VisibilityState
) {
    const row = await getScoreboardRow(page, tab, name);
    await row.locator('input[type="checkbox"]').check();

    await expect(page.locator('#scoreboard-edit-button')).toBeVisible({ timeout: 10_000 });
    await page.locator('#scoreboard-edit-button').click();
    const modal = page.locator('.modal.show, .modal[style*="display: block"]').first();
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await modal.locator('select[name="visibility"]').selectOption(targetState.toLowerCase());
    await modal.getByRole('button', { name: /Submit/i }).click();

    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

    const updatedRow = await getScoreboardRow(page, tab, name);
    const button = updatedRow.locator('button').first();
    await expect(button).toHaveText(targetState, { timeout: 10_000 });
    await expect(button).toHaveClass(targetState === 'Hidden' ? /btn-danger/ : /btn-success/);
}

async function expectContestantCanFindTeam(browser: Browser, teamName: string, shouldExist: boolean) {
    const contestantPage = await browser.newPage();

    try {
        for (let attempt = 0; attempt < 15; attempt++) {
            const response = await contestantPage.request.get('https://api2.fctf.site/api/scoreboard/top/200', {
                headers: {
                    Accept: 'application/json',
                },
            });
            const body = await response.json();
            const teamNames = ((body.data ?? []) as Array<{ name?: string }>).map((entry) => entry.name ?? '');
            const isPresent = teamNames.includes(teamName);

            if (shouldExist && isPresent) {
                return;
            }

            if (!shouldExist && !isPresent) {
                return;
            }

            await contestantPage.waitForTimeout(5_000);
        }

        throw new Error(
            shouldExist
                ? `Contestant scoreboard never showed team ${teamName}`
                : `Contestant scoreboard still showed team ${teamName} after it was hidden`
        );
    } finally {
        await contestantPage.close();
    }
}

test.describe('UC16 Change Scoreboard Visibility', () => {
    test.describe.configure({ mode: 'serial' });

    let targets: ScoreboardTargets;

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            await loginAdmin(page);
            await setScoreVisibility(page, 'public');
            targets = await getUc16Targets(page);
            await patchHiddenState(page, 'team', targets.teamId, false);
            await patchHiddenState(page, 'user', targets.userId, false);
        } finally {
            await page.close();
        }
    });

    test.beforeEach(async ({ page }) => {
        test.setTimeout(180_000);
        await loginAdmin(page);
        await setScoreVisibility(page, 'public');
    });

    test.afterAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            await loginAdmin(page);
            await setScoreVisibility(page, 'public');
            await patchHiddenState(page, 'team', targets.teamId, targets.teamHidden);
            await patchHiddenState(page, 'user', targets.userId, targets.userHidden);
        } finally {
            await page.close();
        }
    });

    test('TC16.01: Hide selected team from scoreboard and contestant can no longer find it', async ({ page, browser }) => {
        await bulkSetVisibility(page, 'Teams', targets.teamName, 'Hidden');
        await expectContestantCanFindTeam(browser, targets.teamName, false);
    });

    test('TC16.02: Show selected team on scoreboard and contestant can find it again', async ({ page, browser }) => {
        await bulkSetVisibility(page, 'Teams', targets.teamName, 'Visible');
        await expectContestantCanFindTeam(browser, targets.teamName, true);
    });

    test('TC16.03: Hide selected user from the admin scoreboard users list', async ({ page }) => {
        await bulkSetVisibility(page, 'Users', targets.userName, 'Hidden');
    });

    test('TC16.04: Show selected user in the admin scoreboard users list again', async ({ page }) => {
        await bulkSetVisibility(page, 'Users', targets.userName, 'Visible');
    });
});