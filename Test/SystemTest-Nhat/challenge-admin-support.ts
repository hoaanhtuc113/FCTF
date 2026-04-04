// @ts-nocheck
import fs from 'fs';
import path from 'path';
import { expect, Page } from '@playwright/test';

const adminUrlCandidates = [
    process.env.ADMIN_URL,
    'https://admin0.fctf.site',
].filter((url): url is string => Boolean(url));

let resolvedAdminUrl = adminUrlCandidates[0];

export let ADMIN_URL = resolvedAdminUrl;

export const CONTESTANT_URL = process.env.CONTESTANT_URL ?? 'https://contestant0.fctf.site';

export type ChallengeType = 'standard' | 'dynamic' | 'multiple_choice';

export interface ChallengeChoice {
    text: string;
    correct: boolean;
}

export interface ChallengeCreateOptions {
    type?: ChallengeType;
    name: string;
    category: string;
    description: string;
    pdfFile?: string;
    timeLimit?: string;
    maxAttempts?: string;
    cooldown?: string;
    value?: string;
    state?: 'visible' | 'hidden';
    difficulty?: number | null;
    flag?: string;
    flagCaseInsensitive?: boolean;
    setUpDocker?: boolean;
    exposePort?: string;
    cpuLimit?: string;
    cpuRequest?: string;
    memoryLimit?: string;
    memoryRequest?: string;
    useGvisor?: 'true' | 'false';
    maxDeployCount?: string;
    deployFile?: string;
    choices?: ChallengeChoice[];
    initial?: string;
    minimum?: string;
    decay?: string;
    decayFunction?: 'linear' | 'logarithmic';
    waitForDeploySuccess?: boolean;
    skipRowStateCheck?: boolean;
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const cloudflareTimeoutPattern = /(error\s*code\s*522|connection\s+timed\s+out|cloudflare\s+ray\s+id|host\s+error)/i;

async function isCloudflareTimeoutPage(page: Page) {
    if (page.isClosed()) {
        return false;
    }

    const body = page.locator('body').first();
    if (!(await body.isVisible().catch(() => false))) {
        return false;
    }

    const text = (await body.innerText().catch(() => '')) ?? '';
    return cloudflareTimeoutPattern.test(text);
}

async function waitBackoff(page: Page, attempt: number) {
    const delay = Math.min(15_000, 1_500 * (attempt + 1));
    await page.waitForTimeout(delay).catch(() => undefined);
}

export function workspaceFile(fileName: string) {
    if (path.isAbsolute(fileName)) {
        return fileName;
    }

    const candidates = [
        path.join(process.cwd(), 'assets', fileName),
        path.join(process.cwd(), fileName),
        path.join(__dirname, 'assets', fileName),
        path.join(__dirname, fileName),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    throw new Error(
        `Missing required local test asset: ${fileName}. Place it in SystemTest-Nhat/assets or SystemTest-Nhat root.`,
    );
}

export function uniqueChallengeName(prefix: string) {
    return `${prefix}-${Date.now()}`;
}

async function gotoAdminWithFallback(page: Page, route: string, timeout = 60_000) {
    let lastError: unknown;
    for (const baseUrl of adminUrlCandidates) {
        for (let navAttempt = 0; navAttempt < 8; navAttempt++) {
            try {
                const target = `${baseUrl}${route}`;
                const response = await page.goto(target, { waitUntil: 'commit', timeout });
                const status = response?.status() ?? 0;
                if (status >= 400 || status === 0) {
                    throw new Error(`Navigation to ${target} returned HTTP ${status}`);
                }

                await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => undefined);
                if (await isCloudflareTimeoutPage(page)) {
                    throw new Error(`Navigation to ${target} loaded Cloudflare timeout page`);
                }

                resolvedAdminUrl = baseUrl;
                ADMIN_URL = baseUrl;
                return;
            } catch (error) {
                lastError = error;
                if (page.isClosed()) {
                    throw error;
                }
                await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => undefined);
                await waitBackoff(page, navAttempt);
                continue;
            }
        }
    }

    if (lastError) {
        throw lastError;
    }

    throw new Error('No ADMIN_URL candidate is configured');
}

export async function loginAdmin(page: Page) {
    for (let attempt = 0; attempt < 6; attempt++) {
        await gotoAdminWithFallback(page, '/login');
        if (!(await isCloudflareTimeoutPage(page))) {
            break;
        }

        await waitBackoff(page, attempt);
    }

    // If the session is already authenticated, /login can redirect to /admin directly.
    if (/\/admin(\/|$)/.test(page.url())) {
        return;
    }

    const usernameInput = page
        .locator('#name, input[name="name"], input[name="username"], input[type="text"]')
        .first();
    const passwordInput = page
        .locator('#password, input[name="password"], input[type="password"]')
        .first();
    const submitButton = page
        .locator('#_submit, button[type="submit"], input[type="submit"]')
        .first();

    await usernameInput.waitFor({ state: 'visible', timeout: 30_000 });
    await usernameInput.fill('admin');
    await passwordInput.fill('1');
    await submitButton.click();
    await expect(page).toHaveURL(/\/admin(\/|$)/, { timeout: 45_000 });
}

export async function loginContestant(page: Page, username = 'user2', password = '1') {
    await page.goto(`${CONTESTANT_URL}/login`);
    await page.locator('input[placeholder="input username..."]').fill(username);
    await page.locator('input[placeholder="enter_password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

export async function gotoAdminChallenges(page: Page) {
    for (let attempt = 0; attempt < 6; attempt++) {
        await gotoAdminWithFallback(page, '/admin/challenges');
        if (!(await isCloudflareTimeoutPage(page))) {
            break;
        }
        await waitBackoff(page, attempt);
    }

    await expect(page.locator('h1').filter({ hasText: 'Challenges' })).toBeVisible({ timeout: 25_000 });
}

export async function openCreateChallenge(page: Page) {
    await gotoAdminChallenges(page);
    const directLink = page.getByRole('link', { name: 'Create Challenge' });
    if (await directLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await directLink.click();
    } else {
        await page.goto(`${ADMIN_URL}/admin/challenges/new`);
    }
    await expect(page.getByRole('heading', { name: 'Create Challenge' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#create-chal-entry-div input[name="name"]').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => { });
}

async function fillDescription(page: Page, value: string) {
    const textarea = page.locator('textarea[name="description"]').first();
    if (await textarea.isVisible().catch(() => false)) {
        await textarea.fill(value);
        return;
    }

    const editor = page.getByRole('application').getByRole('textbox').first();
    await editor.fill(value);
}

async function setDifficulty(page: Page, scope: 'create' | 'update', difficulty: number | null | undefined) {
    if (!difficulty) {
        return;
    }

    const targetId = scope === 'create' ? 'difficulty-input-create' : 'difficulty-input-update';
    const star = page.locator(`.star-rating-picker[data-target="${targetId}"] .star-pick[data-value="${difficulty}"]`).first();
    if (await star.isVisible().catch(() => false)) {
        await star.click();
    }
}

export async function selectChallengeType(page: Page, type: ChallengeType) {
    if (type === 'standard') {
        return;
    }

    const radio = page.locator(`#create-chals-select input[value="${type}"]`).first();
    if (await radio.count()) {
        await radio.check({ force: true }).catch(() => undefined);
        await radio.dispatchEvent('change').catch(() => undefined);
        await page.waitForTimeout(750);
    }

    const label = page.locator('.form-check-label, .card .form-check-label, label').filter({ hasText: new RegExp(`^${escapeRegExp(type)}$`, 'i') }).first();
    if (await label.isVisible().catch(() => false)) {
        await label.click({ force: true });
        await page.waitForTimeout(750);
    }
}

function multipleChoiceDescription(base: string, choices: ChallengeChoice[] | undefined) {
    if (!choices || choices.length === 0) {
        return base;
    }

    return `${base}\n${choices.map((choice) => `*() ${choice.text}`).join('\n')}`;
}

export async function fillCreateStepOne(page: Page, options: ChallengeCreateOptions) {
    const type = options.type ?? 'standard';
    await selectChallengeType(page, type);

    await page.locator('input[name="name"]').fill(options.name);
    await page.locator('input[name="category"]').fill(options.category);

    if (options.pdfFile) {
        const fileInput = page.locator('input[name="file"]').first();
        if (await fileInput.isVisible().catch(() => false)) {
            await fileInput.setInputFiles(workspaceFile(options.pdfFile));
        }
    }

    const description = type === 'multiple_choice'
        ? multipleChoiceDescription(options.description, options.choices)
        : options.description;
    await fillDescription(page, description);

    if (options.timeLimit !== undefined) {
        await page.locator('input[name="time_limit"]').fill(options.timeLimit);
    }
    if (options.maxAttempts !== undefined) {
        await page.locator('input[name="max_attempts"]').fill(options.maxAttempts);
    }
    if (options.cooldown !== undefined) {
        await page.locator('input[name="cooldown"], #submission_cooldown').first().fill(options.cooldown);
    }

    if (type === 'dynamic') {
        await page.locator('input[name="initial"]').fill(options.initial ?? '500');
        await page.locator('input[name="minimum"]').fill(options.minimum ?? '100');
        await page.locator('input[name="decay"]').fill(options.decay ?? '50');
        const functionSelect = page.locator('select[name="function"]').first();
        if (await functionSelect.isVisible().catch(() => false)) {
            await functionSelect.selectOption(options.decayFunction ?? 'linear');
        }
    } else if (options.value !== undefined) {
        await page.locator('input[name="value"]').fill(options.value);
    }

    await setDifficulty(page, 'create', options.difficulty);
}

export async function submitCreateStepOne(page: Page) {
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForTimeout(3_000);
    const networkErrorModal = page.locator('.modal.show').filter({ hasText: 'Network error' });
    if (await networkErrorModal.isVisible().catch(() => false)) {
        await page.locator('.modal.show button:has-text("OK")').click();
        await page.waitForTimeout(2_000);
        await page.getByRole('button', { name: 'Create', exact: true }).click();
        await page.waitForTimeout(3_000);
    }
}

export async function finishCreateChallenge(page: Page, options: ChallengeCreateOptions) {
    await expect(page.locator('input[name="flag"], #challenge-create-options, button:has-text("Finish")').first()).toBeVisible({ timeout: 30_000 });

    if (options.setUpDocker) {
        const dockerToggle = page.locator('#setup_docker').first();
        if (!(await dockerToggle.isChecked().catch(() => false))) {
            await dockerToggle.check({ force: true });
        }
        await page.waitForTimeout(500);
        await page.locator('#expose_port').fill(options.exposePort ?? '3000');
        await page.locator('input[name="cpu_limit"]').fill(options.cpuLimit ?? '200');
        const cpuRequest = page.locator('input[name="cpu_request"]').first();
        if (await cpuRequest.isVisible().catch(() => false)) {
            await cpuRequest.fill(options.cpuRequest ?? '50');
        }
        await page.locator('input[name="memory_limit"]').fill(options.memoryLimit ?? '256');
        const memoryRequest = page.locator('input[name="memory_request"]').first();
        if (await memoryRequest.isVisible().catch(() => false)) {
            await memoryRequest.fill(options.memoryRequest ?? '64');
        }
        const useGvisor = page.locator('select[name="use_gvisor"]').first();
        if (await useGvisor.isVisible().catch(() => false)) {
            await useGvisor.selectOption(options.useGvisor ?? 'false');
        }
        const maxDeployCount = page.locator('input[name="max_deploy_count"]').first();
        if (await maxDeployCount.isVisible().catch(() => false)) {
            await maxDeployCount.fill(options.maxDeployCount ?? '1');
        }
        const deployFile = page.locator('input[name="deploy_file"]').first();
        await deployFile.setInputFiles(workspaceFile(options.deployFile ?? 'EZ_WEB.zip'));
    }

    const flagInput = page.locator('input[name="flag"]').first();
    if (await flagInput.isVisible().catch(() => false)) {
        await flagInput.fill(options.flag ?? 'FCTF{auto-generated-flag}');
    }

    const flagMode = page.locator('select[name="flag_data"]').first();
    if (options.flagCaseInsensitive && await flagMode.isVisible().catch(() => false)) {
        await flagMode.selectOption('case_insensitive');
    }

    const stateSelect = page.locator('select[name="state"]').last();
    if (await stateSelect.isVisible().catch(() => false)) {
        await stateSelect.selectOption(options.state ?? 'hidden');
    }

    await page.getByRole('button', { name: 'Finish' }).click();
    await page.waitForTimeout(3_000);
    const networkErrorModal = page.locator('.modal.show').filter({ hasText: 'Network error' });
    if (await networkErrorModal.isVisible().catch(() => false)) {
        await page.locator('.modal.show button:has-text("OK")').click();
        await page.waitForTimeout(2_000);
        await page.getByRole('button', { name: 'Finish' }).click();
        await page.waitForTimeout(3_000);
    }
}

export async function searchChallenge(page: Page, challengeName: string) {
    const params = new URLSearchParams({
        field: 'name',
        q: challengeName,
    });
    await page.goto(`${ADMIN_URL}/admin/challenges?${params.toString()}`);
    await expect(page.locator('h1').filter({ hasText: 'Challenges' })).toBeVisible({ timeout: 15_000 });
    const qInput = page.locator('input[name="q"]');
    if (await qInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await expect(qInput).toHaveValue(challengeName, { timeout: 5_000 });
    }
    const fieldSelect = page.locator('select[name="field"]');
    if (await fieldSelect.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await expect(fieldSelect).toHaveValue('name', { timeout: 5_000 });
    }
    await expect(page.locator('#challenges')).toBeVisible({ timeout: 15_000 });
    return page.locator('#challenges tbody tr', { hasText: challengeName }).first();
}

export async function openChallengeDetailFromList(page: Page, challengeName: string) {
    const row = await searchChallenge(page, challengeName);
    await expect(row).toBeVisible({ timeout: 15_000 });
    const challengeLink = row.locator('a').first();
    await challengeLink.click();
    await expect(page).toHaveURL(/\/admin\/challenges\/\d+/, { timeout: 15_000 });
}

export function currentChallengeId(page: Page) {
    const match = page.url().match(/\/admin\/challenges\/(\d+)/);
    if (!match) {
        throw new Error(`Unable to read challenge id from URL: ${page.url()}`);
    }
    return Number(match[1]);
}

export async function waitForChallengeRow(page: Page, challengeName: string, expectedTexts: string[], timeout = 180_000) {
    await expect(async () => {
        const row = await searchChallenge(page, challengeName);
        await expect(row).toBeVisible({ timeout: 10_000 });
        for (const expected of expectedTexts) {
            await expect(row).toContainText(expected);
        }
    }).toPass({ timeout, intervals: [5_000, 10_000] });
}

export async function createChallenge(page: Page, options: ChallengeCreateOptions) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await openCreateChallenge(page);
            await fillCreateStepOne(page, options);
            await submitCreateStepOne(page);
            await finishCreateChallenge(page, options);
            break;
        } catch (error) {
            const notFoundVisible = await page
                .locator('h1, h2')
                .filter({ hasText: /File not found|404 Not Found/i })
                .first()
                .isVisible()
                .catch(() => false);

            if (attempt === 1 || !notFoundVisible) {
                throw error;
            }

            await page.goto(`${ADMIN_URL}/admin/challenges`, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined);
            await page.waitForTimeout(1_500);
        }
    }

    const expectedTexts = [options.category];
    if (!options.skipRowStateCheck) {
        expectedTexts.push(options.state ?? 'hidden');
    }
    if (options.value) {
        expectedTexts.push(options.value);
    }
    if (options.setUpDocker && (options.waitForDeploySuccess ?? true)) {
        expectedTexts.push('DEPLOY_SUCCESS');
    }

    await waitForChallengeRow(page, options.name, expectedTexts, options.setUpDocker ? 900_000 : 180_000);
    await openChallengeDetailFromList(page, options.name);

    return { id: currentChallengeId(page), name: options.name };
}

export async function openChallengeTab(page: Page, tabName: string) {
    const tab = page.locator('#challenge-properties a').filter({ hasText: new RegExp(`^${escapeRegExp(tabName)}$`, 'i') }).first();
    await tab.waitFor({ state: 'visible', timeout: 10_000 });
    for (let attempt = 0; attempt < 3; attempt++) {
        await tab.dispatchEvent('click');
        await page.waitForTimeout(1_000);
        const isSelected = await tab.evaluate((el) =>
            el.getAttribute('aria-selected') === 'true' || el.classList.contains('active')
        ).catch(() => false);
        if (isSelected) break;
    }
}

export async function deleteChallengeViaUi(page: Page) {
    await page.locator('.delete-challenge').click();
    const confirm = page.locator('.swal2-confirm, button:has-text("Delete"), button:has-text("Yes")').first();
    await confirm.click();
    await expect(page).toHaveURL(/\/admin\/challenges(\?|$)/, { timeout: 15_000 });
}

export async function deleteChallengeViaApi(page: Page, challengeId: number) {
    let lastStatus = 0;

    for (let attempt = 0; attempt < 6; attempt++) {
        const result = await page.evaluate(async (id) => {
            const csrfToken =
                window.init?.csrfNonce ||
                document.querySelector('meta[name="csrf-token"]')?.content ||
                '';
            const response = await fetch(`/api/v1/challenges/${id}`, {
                method: 'DELETE',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'CSRF-Token': csrfToken,
                },
            });

            let body = null;
            try {
                body = await response.json();
            } catch {
                body = null;
            }

            return { ok: response.ok, status: response.status, body };
        }, challengeId);

        if (result.ok || result.status === 404) {
            return;
        }

        lastStatus = result.status;
        await page.waitForTimeout(1_500 * (attempt + 1));
    }

    // Cleanup failure should not make the functional test fail under rate limiting.
    console.warn(`Delete challenge ${challengeId} did not complete after retries (last status: ${lastStatus}).`);
}

export async function versionRowCount(page: Page) {
    await openChallengeTab(page, 'Versions');
    const texts = await page.locator('#versions tbody tr').allTextContents();
    return texts.filter((text) => !text.includes('No versions recorded yet.')).length;
}

export async function waitForVersionCount(page: Page, minimumRows: number, timeout = 240_000) {
    await expect(async () => {
        await page.reload();
        await expect(page).toHaveURL(/\/admin\/challenges\/\d+/, { timeout: 15_000 });
        const count = await versionRowCount(page);
        expect(count).toBeGreaterThanOrEqual(minimumRows);
    }).toPass({ timeout, intervals: [5_000, 10_000] });
}

export async function saveDeployChanges(page: Page, options: Pick<ChallengeCreateOptions, 'exposePort' | 'cpuLimit' | 'cpuRequest' | 'memoryLimit' | 'memoryRequest' | 'useGvisor' | 'maxDeployCount' | 'deployFile'>) {
    await openChallengeTab(page, 'Deploy');
    const port = page.locator('#expose_port');
    await port.fill(options.exposePort ?? '3000');
    await page.locator('#cpu_limit').fill(options.cpuLimit ?? '250');
    const cpuRequest = page.locator('#cpu_request');
    if (await cpuRequest.isVisible().catch(() => false)) {
        await cpuRequest.fill(options.cpuRequest ?? '60');
    }
    await page.locator('#memory_limit').fill(options.memoryLimit ?? '256');
    const memoryRequest = page.locator('#memory_request');
    if (await memoryRequest.isVisible().catch(() => false)) {
        await memoryRequest.fill(options.memoryRequest ?? '64');
    }
    const gvisor = page.locator('#use_gvisor');
    if (await gvisor.isVisible().catch(() => false)) {
        await gvisor.selectOption(options.useGvisor ?? 'false');
    }
    const maxDeployCount = page.locator('#max_deploy_count');
    if (await maxDeployCount.isVisible().catch(() => false)) {
        await maxDeployCount.fill(options.maxDeployCount ?? '2');
    }
    await page.locator('input[name="deploy_file"]').setInputFiles(workspaceFile(options.deployFile ?? 'EZ_WEB.zip'));
    await page.locator('#deploy-btn').click();
}

export async function setScoreVisibility(page: Page, visibility: 'public' | 'private' | 'hidden' | 'admins') {
    await page.goto(`${ADMIN_URL}/admin/config`);
    await page.locator('a[href="#visibility"]').click();
    await expect(page.locator('#visibility')).toBeVisible({ timeout: 10_000 });
    await page.locator('select[name="score_visibility"]').selectOption(visibility);
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'load', timeout: 30_000 }).catch(() => undefined),
        page.locator('#visibility button[type="submit"]').click(),
    ]);
}

export async function switchScoringTypeViaApi(
    page: Page,
    challengeId: number,
    targetType: 'standard' | 'dynamic',
    dynamicParams?: { initial?: string; minimum?: string; decay?: string; function?: string },
): Promise<{ success: boolean; data?: any }> {
    const body: Record<string, unknown> = {
        'scoring-type-radio': targetType,
    };

    if (targetType === 'dynamic') {
        body.initial = dynamicParams?.initial ?? '500';
        body.minimum = dynamicParams?.minimum ?? '100';
        body.decay = dynamicParams?.decay ?? '25';
        body.function = dynamicParams?.function ?? 'linear';
    }

    return page.evaluate(
        async ({ id, payload }) => {
            const csrfToken =
                window.init?.csrfNonce ||
                document.querySelector('meta[name="csrf-token"]')?.content ||
                '';
            const response = await fetch(`/api/v1/challenges/${id}`, {
                method: 'PATCH',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'CSRF-Token': csrfToken,
                },
                body: JSON.stringify(payload),
            });
            return response.json();
        },
        { id: challengeId, payload: body },
    );
}

export async function getChallengeViaApi(page: Page, challengeId: number): Promise<any> {
    return page.evaluate(async (id) => {
        const response = await fetch(`/api/v1/challenges/${id}?view=admin`, {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        });
        return response.json();
    }, challengeId);
}

export async function setContestPaused(page: Page) {
    await page.goto(`${ADMIN_URL}/admin/config`);
    await page.locator('a[href="#accounts"]').click();
    await expect(page.locator('#accounts')).toBeVisible({ timeout: 10_000 });

    const pauseCheckbox = page.locator('input[name="paused"]');
    if (await pauseCheckbox.isVisible().catch(() => false)) {
        if (!(await pauseCheckbox.isChecked())) {
            await pauseCheckbox.check();
        }
        await page.locator('#accounts button[type="submit"]').click();
        await page.waitForTimeout(2_000);
    }
}

export async function setContestUnpaused(page: Page) {
    await page.goto(`${ADMIN_URL}/admin/config`);
    await page.locator('a[href="#accounts"]').click();
    await expect(page.locator('#accounts')).toBeVisible({ timeout: 10_000 });

    const pauseCheckbox = page.locator('input[name="paused"]');
    if (await pauseCheckbox.isVisible().catch(() => false)) {
        if (await pauseCheckbox.isChecked()) {
            await pauseCheckbox.uncheck();
        }
        await page.locator('#accounts button[type="submit"]').click();
        await page.waitForTimeout(2_000);
    }
}

export async function ensureContestantUser(
    page: Page,
    username = 'user2',
    password = '1',
    teamName = 'team2',
): Promise<void> {
    const result = await page.evaluate(async ({ username, password, teamName }) => {
        const errors: string[] = [];
        const userMode: string = window.init?.userMode ?? 'unknown';
        const adminTeamId: number | null = window.init?.teamId ?? null;
        const csrfToken: string =
            window.init?.csrfNonce ||
            document.querySelector('meta[name="csrf-token"]')?.content ||
            '';
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'CSRF-Token': csrfToken,
        };

        let teamId: number | null = null;
        const teamCreateResp = await fetch('/api/v1/teams', {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: JSON.stringify({ name: teamName, password: teamName }),
        });
        if (teamCreateResp.ok) {
            const teamData = await teamCreateResp.json();
            teamId = teamData.data?.id ?? null;
        } else {
            errors.push(`Team POST ${teamCreateResp.status}`);
            const listResp = await fetch(`/api/v1/teams?q=${encodeURIComponent(teamName)}&field=name`, {
                credentials: 'same-origin',
                headers: { Accept: 'application/json', 'CSRF-Token': csrfToken },
            });
            if (listResp.ok) {
                const listData = await listResp.json();
                const found = listData.data?.find((team) => team.name === teamName);
                if (found) {
                    teamId = found.id;
                } else {
                    errors.push('Team not found in search');
                }
            } else {
                errors.push(`Team search ${listResp.status}`);
            }
        }

        let userId: number | null = null;
        const userCreateResp = await fetch('/api/v1/users', {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: JSON.stringify({
                name: username,
                email: `${username}@test.local`,
                password,
                type: 'user',
                verified: true,
            }),
        });
        if (userCreateResp.ok) {
            const userData = await userCreateResp.json();
            userId = userData.data?.id ?? null;
        } else {
            errors.push(`User POST ${userCreateResp.status}`);
            const listResp = await fetch(`/api/v1/users?q=${encodeURIComponent(username)}&field=name`, {
                credentials: 'same-origin',
                headers: { Accept: 'application/json', 'CSRF-Token': csrfToken },
            });
            if (listResp.ok) {
                const listData = await listResp.json();
                const found = listData.data?.find((user) => user.name === username);
                if (found) {
                    userId = found.id;
                } else {
                    errors.push('User not found in search');
                }
            } else {
                errors.push(`User search ${listResp.status}`);
            }
        }

        let existingTeamId: number | null = null;
        if (userId) {
            const userInfoResp = await fetch(`/api/v1/users/${userId}`, {
                credentials: 'same-origin',
                headers: { Accept: 'application/json', 'CSRF-Token': csrfToken },
            });
            if (userInfoResp.ok) {
                const userInfo = await userInfoResp.json();
                existingTeamId = userInfo.data?.team_id ?? null;
            }
        }

        if (existingTeamId && (teamId === null || existingTeamId === teamId)) {
            if (teamId === null) {
                teamId = existingTeamId;
            }
            return { userMode, teamId, userId, errors, skippedAssignment: true };
        }

        const effectiveTeamId = teamId ?? adminTeamId;
        if (userId && effectiveTeamId) {
            const patchResp = await fetch(`/api/v1/users/${userId}`, {
                method: 'PATCH',
                credentials: 'same-origin',
                headers,
                body: JSON.stringify({ team_id: effectiveTeamId }),
            });
            if (!patchResp.ok) {
                const patchBody = await patchResp.json().catch(() => null);
                errors.push(`User PATCH ${patchResp.status}: ${JSON.stringify(patchBody)}`);
            } else {
                teamId = effectiveTeamId;
            }
        } else if (!effectiveTeamId) {
            errors.push(`Cannot assign team: teamId is null and adminTeamId is null (userMode=${userMode})`);
        }

        return { userMode, teamId, userId, errors, skippedAssignment: false };
    }, { username, password, teamName });

    if (result.errors.length > 0) {
        console.warn(`[ensureContestantUser] userMode=${result.userMode} teamId=${result.teamId} userId=${result.userId} errors: ${result.errors.join(' | ')}`);
    }

    if (!result.userId) {
        throw new Error(`[ensureContestantUser] Could not create/find user "${username}". Errors: ${result.errors.join(' | ')}`);
    }
    if (!result.teamId) {
        throw new Error(`[ensureContestantUser] User "${username}" has no team (userMode=${result.userMode}). ContestantBE login will fail. Errors: ${result.errors.join(' | ')}`);
    }
}