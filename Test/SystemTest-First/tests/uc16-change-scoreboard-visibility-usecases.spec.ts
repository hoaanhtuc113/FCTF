import { test, expect, type Locator, type Page } from '@playwright/test';
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

function getTabSelectors(tab: ScoreboardTab) {
    return tab === 'Teams'
        ? {
            idAttribute: 'data-account-id',
            rowSelector: 'tbody tr:has(input[data-account-id])',
        }
        : {
            idAttribute: 'data-user-id',
            rowSelector: 'tbody tr:has(input[data-user-id])',
        };
}

async function getRowHiddenState(row: Locator): Promise<boolean> {
    const visibilityButton = row.locator('button').first();
    await expect(visibilityButton).toBeVisible({ timeout: 10_000 });

    const state = (await visibilityButton.getAttribute('data-state'))?.toLowerCase();
    if (state === 'hidden') {
        return true;
    }
    if (state === 'visible') {
        return false;
    }

    const text = ((await visibilityButton.textContent()) ?? '').trim().toLowerCase();
    if (text.includes('hidden')) {
        return true;
    }
    if (text.includes('visible')) {
        return false;
    }

    throw new Error(`Unable to infer visibility state from row text=${JSON.stringify(text)}`);
}

async function getFirstScoreboardEntry(page: Page, tab: ScoreboardTab) {
    const pane = await openScoreboardTab(page, tab);
    const { idAttribute, rowSelector } = getTabSelectors(tab);
    const row = pane.locator(`${rowSelector}:visible`).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    const idRaw = await row.locator(`input[${idAttribute}]`).first().getAttribute(idAttribute);
    const id = Number(idRaw);
    if (!idRaw || Number.isNaN(id) || id <= 0) {
        throw new Error(`Invalid ${tab} row ID: ${String(idRaw)}`);
    }

    const name = ((await row.locator('td a').first().textContent()) ?? '').trim();
    if (!name) {
        throw new Error(`Could not read ${tab} row name for id=${id}`);
    }

    const hidden = await getRowHiddenState(row);
    return { id, name, hidden };
}

async function getUc16Targets(page: Page): Promise<ScoreboardTargets> {
    const team = await getFirstScoreboardEntry(page, 'Teams');
    const user = await getFirstScoreboardEntry(page, 'Users');

    return {
        userId: user.id,
        userName: user.name,
        userHidden: user.hidden,
        teamId: team.id,
        teamName: team.name,
        teamHidden: team.hidden,
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
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await page.goto(`${BASE_URL}/admin/scoreboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await expect(page.getByRole('button', { name: /Visibility/i })).toBeVisible({ timeout: 20_000 });
            return;
        } catch (error) {
            lastError = error;
            const isRetryable = /ERR_ABORTED|Navigation timeout/i.test(String(error));
            const isLastAttempt = attempt === 2;

            if (isLastAttempt || !isRetryable) {
                throw error;
            }

            await page.waitForTimeout(1_000 + (attempt * 500));
        }
    }

    throw lastError;
}

async function openScoreboardTab(page: Page, tab: ScoreboardTab) {
    await openAdminScoreboard(page);
    const tabButton = page.getByRole('tab', { name: new RegExp(`^${tab}$`, 'i') }).first();

    if (await tabButton.count()) {
        await tabButton.click();

        const hasAriaSelected = (await tabButton.getAttribute('aria-selected')) !== null;
        if (hasAriaSelected) {
            await expect(tabButton).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
        } else {
            await expect(tabButton).toHaveClass(/active/, { timeout: 10_000 });
        }
    }

    const { rowSelector } = getTabSelectors(tab);
    const activePane = page
        .locator('.tab-pane:visible, [role="tabpanel"]:visible')
        .filter({ has: page.locator(rowSelector) })
        .first();

    if (await activePane.count()) {
        await expect(activePane).toBeVisible({ timeout: 10_000 });
        return activePane;
    }

    const fallbackRow = page.locator(`${rowSelector}:visible`).first();
    await expect(fallbackRow).toBeVisible({ timeout: 10_000 });
    return page.locator('body');
}

async function getScoreboardRow(page: Page, tab: ScoreboardTab, id: number) {
    const pane = await openScoreboardTab(page, tab);
    const { idAttribute, rowSelector } = getTabSelectors(tab);
    const row = pane.locator(`${rowSelector}:has(input[${idAttribute}="${id}"]):visible`).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    return row;
}

async function bulkSetVisibility(
    page: Page,
    tab: ScoreboardTab,
    id: number,
    targetState: VisibilityState
) {
    const row = await getScoreboardRow(page, tab, id);
    await row.locator('input[type="checkbox"]').check();

    await expect(page.locator('#scoreboard-edit-button')).toBeVisible({ timeout: 10_000 });
    await page.locator('#scoreboard-edit-button').click();
    const modal = page.locator('.modal.show, .modal[style*="display: block"]').first();
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await modal.locator('select[name="visibility"]').selectOption(targetState.toLowerCase());
    await modal.getByRole('button', { name: /Submit/i }).click();

    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

    const updatedRow = await getScoreboardRow(page, tab, id);
    const button = updatedRow.locator('button').first();
    await expect(button).toContainText(targetState, { timeout: 10_000 });

    const dataState = await button.getAttribute('data-state');
    if (dataState !== null) {
        await expect(button).toHaveAttribute('data-state', targetState.toLowerCase());
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

    test('TC16.01: Hide selected team from scoreboard', async ({ page }) => {
        await bulkSetVisibility(page, 'Teams', targets.teamId, 'Hidden');
    });

    test('TC16.02: Show selected team on scoreboard', async ({ page }) => {
        await bulkSetVisibility(page, 'Teams', targets.teamId, 'Visible');
    });

    test('TC16.03: Hide selected user from the admin scoreboard users list', async ({ page }) => {
        await bulkSetVisibility(page, 'Users', targets.userId, 'Hidden');
    });

    test('TC16.04: Show selected user in the admin scoreboard users list again', async ({ page }) => {
        await bulkSetVisibility(page, 'Users', targets.userId, 'Visible');
    });
});