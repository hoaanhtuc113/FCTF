import { expect, Locator, Page } from "@playwright/test";

export const BASE_URL = "https://admin2.fctf.site";
export const CONTESTANT_URL = "https://contestant2.fctf.site";
export const ADMIN_USER = "admin";
export const ADMIN_PASS = "1";
export const SUBMIT_WAIT_MS = 3000;

export interface TeamInfo {
    id: number;
    name: string;
    email: string;
    website: string;
    affiliation: string;
}

export interface UserInfo {
    id: number;
    name: string;
    email: string;
    type: string;
}

export interface SubmissionInfo {
    id: number;
    type: string;
    provided: string;
    challengeId: number;
    challengeName: string;
    userId: number;
    userName: string;
    teamId: number;
    teamName: string;
    date: string;
}

export interface RewardTemplateInfo {
    id: string;
    name: string;
    description: string;
    category: string;
    customizable_params: string[];
}

export interface AwardInfo {
    id: number;
    userId: number | null;
    teamId: number | null;
    name: string;
    description: string;
    value: number;
    category: string;
    icon: string;
    type: string;
}

export interface CommentInfo {
    id: number;
    type: string;
    content: string;
    html: string;
    authorId: number;
    userId: number | null;
    teamId: number | null;
    challengeId: number | null;
}

export interface BracketInfo {
    id: number;
    name: string;
    description: string;
    type: string;
}

export interface CustomFieldInfo {
    id: number;
    type: string;
    fieldType: string;
    name: string;
    description: string;
    editable: boolean;
    required: boolean;
    public: boolean;
}

export type CustomFieldScope = "user" | "team";

export async function loginAsAdmin(page: Page) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });

            if (/\/admin\//.test(page.url())) {
                return;
            }

            await page.fill('input[name="name"]', ADMIN_USER);
            await page.fill('input[name="password"]', ADMIN_PASS);
            await Promise.all([
                page.waitForURL(/\/admin\//, { waitUntil: "domcontentloaded", timeout: 30_000 }),
                page.click('button[type="submit"], input[type="submit"]'),
            ]);
            return;
        } catch (err) {
            if (attempt === 1) {
                throw err;
            }
            if (page.isClosed()) {
                throw err;
            }
            await page.waitForTimeout(1500);
        }
    }
}

/** Alias for loginAsAdmin, compatible with challenge-admin-support naming */
export async function loginAdmin(page: Page) {
    return loginAsAdmin(page);
}

export async function loginContestant(page: Page, username = 'user2', password = '1') {
    await page.goto(`${CONTESTANT_URL}/login`);
    await page.locator('input[placeholder="input username..."]').fill(username);
    await page.locator('input[placeholder="enter_password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

export async function setScoreVisibility(page: Page, visibility: 'public' | 'private' | 'hidden' | 'admins') {
    // Navigate to admin config to ensure a valid authenticated session
    await page.goto(`${BASE_URL}/admin/config`);
    // Read the CSRF nonce rendered in the page
    const nonce = await page.locator('input[name="nonce"]').first().getAttribute('value').catch(() => '');
    // Submit via Playwright's request API (shares session cookies, avoids UI dropdown limitations)
    await page.request.post(`${BASE_URL}/admin/config`, {
        form: {
            nonce: nonce ?? '',
            score_visibility: visibility,
        },
    });
}

export async function openAdminConfigTab(page: Page, hash: string) {
    let gotoError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await page.goto(`${BASE_URL}/admin/config${hash}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
            gotoError = null;
            break;
        } catch (error) {
            gotoError = error;
            const message = String(error);
            const retriable = message.includes("ERR_ABORTED") || message.includes("Timeout");
            if (!retriable || attempt === 2) {
                throw error;
            }
            await page.waitForTimeout(500);
        }
    }

    if (gotoError) {
        throw gotoError;
    }

    const tabLink = page
        .locator(`a[href="${hash}"][data-toggle="tab"], a[href="${hash}"][data-bs-toggle="tab"]`)
        .first();
    const tabPane = page.locator(hash).first();

    await tabLink.waitFor({ state: "visible" });

    if (!(await tabPane.evaluate((element) => element.classList.contains("active")).catch(() => false))) {
        await page.evaluate((targetHash) => {
            const anchor = document.querySelector(
                `a[href="${targetHash}"][data-toggle="tab"], a[href="${targetHash}"][data-bs-toggle="tab"]`
            ) as HTMLElement | null;

            if (!anchor) {
                throw new Error(`Cannot find config tab link for ${targetHash}`);
            }

            anchor.click();
            anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        }, hash);
    }

    await page.waitForFunction((targetHash) => {
        const pane = document.querySelector(targetHash);
        const link = document.querySelector(
            `a[href="${targetHash}"][data-toggle="tab"], a[href="${targetHash}"][data-bs-toggle="tab"]`
        );

        if (!(pane instanceof HTMLElement) || !(link instanceof HTMLElement)) {
            return false;
        }

        const paneStyle = window.getComputedStyle(pane);
        return (
            pane.classList.contains("active")
            && link.classList.contains("active")
            && paneStyle.display !== "none"
            && paneStyle.visibility !== "hidden"
        );
    }, hash);

    await expect(tabPane).toHaveClass(/active/);
}

export async function commitLazyInput(input: Locator, value: string) {
    await input.click();
    await input.fill(value);
    await input.evaluate((element, nextValue) => {
        if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
            throw new Error("commitLazyInput expects an input or textarea element");
        }

        element.value = nextValue;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.blur();
    }, value);
}

export function normalizeCustomFieldScope(type: "user" | "team" | "users" | "teams"): CustomFieldScope {
    return type === "users" || type === "user" ? "user" : "team";
}

export function getCustomFieldContainerSelector(scope: CustomFieldScope): string {
    return scope === "user" ? "#user-fields" : "#team-fields";
}

export async function openCustomFieldScopeTab(page: Page, scope: CustomFieldScope) {
    const hash = scope === "user" ? "#user-fields" : "#team-fields";
    const tab = page.locator(`a[href="${hash}"]`).first();
    await tab.scrollIntoViewIfNeeded();
    await tab.click({ force: true });
    await page.waitForFunction((targetHash) => {
        const pane = document.querySelector(targetHash);
        return pane instanceof HTMLElement && pane.classList.contains("active");
    }, hash);
}

export async function waitForLatestCustomFieldBlock(
    page: Page,
    scope: CustomFieldScope,
    previousCount?: number
): Promise<Locator> {
    const containerSelector = getCustomFieldContainerSelector(scope);
    const blocks = page.locator(`${containerSelector} .border-bottom`);

    if (typeof previousCount === "number") {
        await expect.poll(async () => blocks.count(), { timeout: 8000 }).toBeGreaterThan(previousCount);
    }

    const total = await blocks.count();
    if (total === 0) {
        throw new Error(`Không tìm thấy custom field block trong ${containerSelector}`);
    }

    const block = blocks.nth(total - 1);
    await expect(block).toBeVisible();
    return block;
}

export async function selectOptionWithRetry(select: Locator, value: string, retries = 4) {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            await select.selectOption(value);
            return;
        } catch (error) {
            lastError = error;
            const message = String(error);
            const retriable = message.includes("detached") || message.includes("Timeout") || message.includes("timeout");
            if (!retriable || attempt === retries - 1) {
                throw error;
            }
            await select.page().waitForTimeout(250);
        }
    }

    throw lastError;
}

export async function clickWithRetry(target: Locator, retries = 4) {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            await target.scrollIntoViewIfNeeded();
            await target.click({ force: true });
            return;
        } catch (error) {
            lastError = error;
            const message = String(error);
            const retriable = message.includes("detached") || message.includes("Timeout") || message.includes("timeout");
            if (!retriable || attempt === retries - 1) {
                throw error;
            }
            await target.page().waitForTimeout(250);
        }
    }

    throw lastError;
}

export async function findConfigBlockByInputValue(page: Page, containerSelector: string, value: string) {
    const blocks = page.locator(`${containerSelector} .border-bottom`);
    const normalizedExpected = value.trim().toLowerCase();

    for (let attempt = 0; attempt < 20; attempt++) {
        const matchIndex = await blocks.evaluateAll((nodes, expectedValue) => {
            return nodes.findIndex((node) => {
                const input = node.querySelector("input.form-control");
                if (!(input instanceof HTMLInputElement)) {
                    return false;
                }

                const actualValue = input.value.trim().toLowerCase();
                return (
                    actualValue === expectedValue
                    || actualValue.includes(expectedValue)
                    || expectedValue.includes(actualValue)
                );
            });
        }, normalizedExpected);

        if (matchIndex >= 0) {
            return blocks.nth(matchIndex);
        }

        await page.waitForTimeout(500);
    }

    throw new Error(`Cannot find config block in ${containerSelector} with value ${value}`);
}

export async function getTeams(page: Page, limit: number = 5): Promise<TeamInfo[]> {
    const res = await page.request.get(`${BASE_URL}/api/v1/teams?page=1&per_page=${limit}`, { timeout: 20_000 });
    const body = await res.json();
    const data = body.data as any[];
    if (!data || data.length === 0) throw new Error("Không có team nào trong hệ thống để test");
    return data.map((d: any) => ({
        id: d.id,
        name: d.name,
        email: d.email ?? "",
        website: d.website ?? "",
        affiliation: d.affiliation ?? "",
    }));
}

export async function getUsers(page: Page, limit: number = 5): Promise<UserInfo[]> {
    const res = await page.request.get(`${BASE_URL}/api/v1/users?page=1&per_page=${limit}`, { timeout: 20_000 });
    const body = await res.json();
    const data = body.data as any[];
    if (!data || data.length === 0) throw new Error("Không có user nào trong hệ thống để test");
    return data.map((d: any) => ({
        id: d.id,
        name: d.name,
        email: d.email ?? "",
        type: d.type ?? "user",
    }));
}

export async function getSubmissions(
    page: Page,
    params: Record<string, string | number | undefined> = {}
): Promise<SubmissionInfo[]> {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== "") {
            searchParams.set(key, String(value));
        }
    }

    const queryString = searchParams.toString();
    const res = await page.request.get(
        `${BASE_URL}/api/v1/submissions${queryString ? `?${queryString}` : ""}`
    );
    const body = await res.json();
    const data = (body.data ?? []) as any[];
    return data.map((d: any) => ({
        id: d.id,
        type: d.type ?? "",
        provided: d.provided ?? "",
        challengeId: d.challenge_id,
        challengeName: d.challenge?.name ?? "",
        userId: d.user?.id ?? d.user_id,
        userName: d.user?.name ?? "",
        teamId: d.team?.id ?? d.team_id,
        teamName: d.team?.name ?? "",
        date: d.date ?? "",
    }));
}

export async function getSubmissionById(page: Page, submissionId: number) {
    const res = await page.request.get(`${BASE_URL}/api/v1/submissions/${submissionId}`);
    if (res.status() === 404) {
        return null;
    }
    const body = await res.json();
    if (!body.success || !body.data) {
        return null;
    }

    const d = body.data;
    return {
        id: d.id,
        type: d.type ?? "",
        provided: d.provided ?? "",
        challengeId: d.challenge_id,
        challengeName: d.challenge?.name ?? "",
        userId: d.user?.id ?? d.user_id,
        userName: d.user?.name ?? "",
        teamId: d.team?.id ?? d.team_id,
        teamName: d.team?.name ?? "",
        date: d.date ?? "",
    } as SubmissionInfo;
}

export async function getSubmissionSeed(page: Page): Promise<SubmissionInfo> {
    const submissions = await getSubmissions(page);
    if (submissions.length === 0) {
        throw new Error("Không có submission nào trong hệ thống để tạo dữ liệu test");
    }
    const seed = submissions.find((item) => item.userId && item.teamId && item.challengeId) ?? submissions[0];
    if (!seed.userId || !seed.teamId || !seed.challengeId) {
        throw new Error("Không tìm được submission seed hợp lệ để tạo dữ liệu test");
    }
    return seed;
}

export async function createSubmission(
    page: Page,
    payload: {
        userId: number;
        teamId: number;
        challengeId: number;
        provided: string;
        type: string;
        ip?: string;
    }
) {
    await page.goto(`${BASE_URL}/admin/submissions`, { waitUntil: "domcontentloaded" });
    const body = await page.evaluate(async ({ payload, BASE_URL }) => {
        const csrfToken = (window as any).init?.csrfNonce || "";
        const res = await fetch(`${BASE_URL}/api/v1/submissions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "CSRF-Token": csrfToken,
            },
            body: JSON.stringify({
                user_id: payload.userId,
                team_id: payload.teamId,
                challenge_id: payload.challengeId,
                provided: payload.provided,
                type: payload.type,
                ip: payload.ip ?? "127.0.0.1",
            }),
        });
        return { status: res.status, body: await res.json() };
    }, { payload, BASE_URL });

    if (body.status !== 200 || !body.body?.success || !body.body?.data?.id) {
        throw new Error(`Không thể tạo submission test: ${JSON.stringify(body.body)}`);
    }
    return body.body.data;
}

export async function patchSubmissionType(page: Page, submissionId: number, nextType: string) {
    await page.goto(`${BASE_URL}/admin/submissions`, { waitUntil: "domcontentloaded" });
    const body = await page.evaluate(async ({ submissionId, nextType, BASE_URL }) => {
        const csrfToken = (window as any).init?.csrfNonce || "";
        const res = await fetch(`${BASE_URL}/api/v1/submissions/${submissionId}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "CSRF-Token": csrfToken,
            },
            body: JSON.stringify({ type: nextType }),
        });

        let responseBody;
        try {
            responseBody = await res.json();
        } catch (_err) {
            responseBody = null;
        }

        return { status: res.status, body: responseBody };
    }, { submissionId, nextType, BASE_URL });

    if (body.status !== 200 || !body.body?.success) {
        throw new Error(`Không thể đổi trạng thái submission ${submissionId}: ${JSON.stringify(body.body)}`);
    }
    return body.body;
}

export async function deleteSubmissionByApi(page: Page, submissionId: number) {
    await page.goto(`${BASE_URL}/admin/submissions`, { waitUntil: "domcontentloaded" });
    const body = await page.evaluate(async ({ submissionId, BASE_URL }) => {
        const csrfToken = (window as any).init?.csrfNonce || "";
        const res = await fetch(`${BASE_URL}/api/v1/submissions/${submissionId}`, {
            method: "DELETE",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "CSRF-Token": csrfToken,
            },
        });

        let responseBody;
        try {
            responseBody = await res.json();
        } catch (_err) {
            responseBody = null;
        }

        return { status: res.status, body: responseBody };
    }, { submissionId, BASE_URL });

    if (body.status !== 200 || !body.body?.success) {
        throw new Error(`Không thể xóa submission ${submissionId}: ${JSON.stringify(body.body)}`);
    }
    return body.body;
}

export async function deleteSubmissionsByProvided(page: Page, provided: string) {
    const matches = await getSubmissions(page, { q: provided, field: "provided" });
    for (const submission of matches) {
        await deleteSubmissionByApi(page, submission.id);
    }
}

export async function getRewardTemplates(page: Page): Promise<RewardTemplateInfo[]> {
    const res = await page.request.get(`${BASE_URL}/admin/rewards/templates`);
    const body = await res.json();
    if (!body.success) {
        throw new Error("Không tải được danh sách reward templates");
    }
    return (body.templates ?? []) as RewardTemplateInfo[];
}

export async function confirmEzQueryModal(page: Page) {
    const confirmButton = page
        .locator('.modal.show button:has-text("Yes"), .modal.show button:has-text("Delete"), .modal.show .btn-primary')
        .first();
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();
}

export async function cancelEzQueryModal(page: Page) {
    const cancelButton = page
        .locator('.modal.show button:has-text("No"), .modal.show button:has-text("Cancel"), .modal.show .btn-danger')
        .first();

    if (await cancelButton.isVisible()) {
        await cancelButton.click();
        return;
    }

    await page.keyboard.press("Escape");
}

export async function openUserEditModal(page: Page, userId: number) {
    await page.goto(`${BASE_URL}/admin/users/${userId}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForSelector(".edit-user", { state: "visible" });
    await page.click(".edit-user");
    await page.waitForSelector("#user-info-edit-form", { state: "visible", timeout: 8000 });
    await page.waitForTimeout(400);
}

export async function openTeamEditModal(page: Page, teamId: number) {
    await page.goto(`${BASE_URL}/admin/teams/${teamId}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForSelector(".edit-team", { state: "visible" });
    await page.click(".edit-team");
    await page.waitForSelector("#team-info-edit-form", { state: "visible", timeout: 8000 });
    await page.waitForTimeout(400);
}

export async function getCSRFToken(page: Page): Promise<string> {
    const token = await page.evaluate(() => {
        return (window as any).init?.csrfNonce ||
            document.querySelector('input[name="nonce"]')?.getAttribute("value") ||
            "";
    });
    if (token) return token;

    const html = await page.content();
    const match = html.match(/csrfNonce":\s*"([^"]+)"/) || html.match(/name="nonce" value="([^"]+)"/);
    return match ? match[1] : "";
}

export async function createTestTeam(page: Page): Promise<{ id: number; name: string }> {
    const teamName = `DeleteTest_${Date.now()}`;
    const email = `del_${Date.now()}@test.com`;

    await page.goto(`${BASE_URL}/admin/teams/new`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.fill('#team-info-create-form [name="name"]', teamName);
    await page.fill('#team-info-create-form [name="email"]', email);
    await page.fill('#team-info-create-form [name="password"]', "TestPass123!");

    const bracketSelect = page.locator('#team-info-create-form select[name="bracket_id"]');
    if (await bracketSelect.count()) {
        const bracketValue = await bracketSelect.locator('option').evaluateAll((options) => {
            const candidate = options.find((option) => {
                return option instanceof HTMLOptionElement && option.value.trim() !== "";
            });
            return candidate instanceof HTMLOptionElement ? candidate.value : null;
        });

        if (bracketValue) {
            await bracketSelect.selectOption(bracketValue);
        }
    }

    await Promise.all([
        page.waitForURL(/\/admin\/teams\/\d+$/, { waitUntil: "domcontentloaded", timeout: 30_000 }),
        page.click('#team-info-create-form #update-team'),
    ]);

    const match = page.url().match(/\/admin\/teams\/(\d+)$/);
    if (!match) {
        throw new Error("Không thể xác định team id sau khi tạo team test");
    }

    return { id: Number(match[1]), name: teamName };
}

export async function createTestUser(page: Page): Promise<{ id: number; name: string }> {
    await page.goto(`${BASE_URL}/admin/users`);
    const userName = `DelUser_${Date.now()}`;

    const body = await page.evaluate(async ({ userName, BASE_URL }) => {
        const csrfToken = (window as any).init?.csrfNonce || "";
        const res = await fetch(`${BASE_URL}/api/v1/users`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'CSRF-Token': csrfToken
            },
            body: JSON.stringify({
                name: userName,
                email: `deluser_${Date.now()}@test.com`,
                password: "TestPass123!",
                type: "user",
            })
        });
        return await res.json();
    }, { userName, BASE_URL });

    if (!body.success || !body.data?.id) {
        throw new Error(`Không thể tạo user test: ${JSON.stringify(body)}`);
    }
    return { id: body.data.id, name: userName };
}

export async function deleteTeam(page: Page, teamId: number) {
    const result = await page.evaluate(async ({ teamId, BASE_URL }) => {
        const csrfToken = (window as any).init?.csrfNonce || "";
        const res = await fetch(`${BASE_URL}/api/v1/teams/${teamId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'CSRF-Token': csrfToken
            }
        });
        const status = res.status;
        let body;
        try {
            body = await res.json();
        } catch (e) {
            body = { message: "Not a JSON response" };
        }
        return { status, body };
    }, { teamId, BASE_URL });

    if (result.status !== 200 || (result.body && result.body.success === false)) {
        console.error(`Delete Team FAILED for ${teamId}. Status: ${result.status}, Body: ${JSON.stringify(result.body)}`);
    }
    return result.body;
}

export async function deleteUser(page: Page, userId: number) {
    const result = await page.evaluate(async ({ userId, BASE_URL }) => {
        const csrfToken = (window as any).init?.csrfNonce || "";
        const res = await fetch(`${BASE_URL}/api/v1/users/${userId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'CSRF-Token': csrfToken
            }
        });
        const status = res.status;
        let body;
        try {
            body = await res.json();
        } catch (e) {
            body = { message: "Not a JSON response" };
        }
        return { status, body };
    }, { userId, BASE_URL });

    if (result.status !== 200 || (result.body && result.body.success === false)) {
        console.error(`Delete User FAILED for ${userId}. Status: ${result.status}, Body: ${JSON.stringify(result.body)}`);
    }
    return result.body;
}

export async function getTeamMembers(page: Page, teamId: number): Promise<UserInfo[]> {
    const res = await page.request.get(`${BASE_URL}/api/v1/teams/${teamId}/members`);
    const body = await res.json();
    const data = (body.data ?? []) as any[];
    return data.map((item) => ({
        id: item.id,
        name: item.name ?? "",
        email: item.email ?? "",
        type: item.type ?? "user",
    }));
}

export async function addUserToTeam(page: Page, teamId: number, userId: number) {
    await page.goto(`${BASE_URL}/admin/teams/${teamId}`, { waitUntil: "domcontentloaded" });
    const body = await page.evaluate(async ({ teamId, userId, BASE_URL }) => {
        const csrfToken = (window as any).init?.csrfNonce || "";
        const res = await fetch(`${BASE_URL}/api/v1/teams/${teamId}/members`, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "CSRF-Token": csrfToken,
            },
            body: JSON.stringify({ user_id: userId }),
        });
        return { status: res.status, body: await res.json() };
    }, { teamId, userId, BASE_URL });

    if (body.status !== 200 || !body.body?.success) {
        throw new Error(`Không thể thêm user ${userId} vào team ${teamId}: ${JSON.stringify(body.body)}`);
    }

    return body.body.data;
}

export async function patchTeam(page: Page, teamId: number, payload: Record<string, unknown>) {
    await page.goto(`${BASE_URL}/admin/teams/${teamId}`, { waitUntil: "domcontentloaded" });
    const body = await page.evaluate(async ({ teamId, payload, BASE_URL }) => {
        const csrfToken = (window as any).init?.csrfNonce || "";
        const res = await fetch(`${BASE_URL}/api/v1/teams/${teamId}`, {
            method: "PATCH",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "CSRF-Token": csrfToken,
            },
            body: JSON.stringify(payload),
        });
        return { status: res.status, body: await res.json() };
    }, { teamId, payload, BASE_URL });

    if (body.status !== 200 || !body.body?.success) {
        throw new Error(`Không thể cập nhật team ${teamId}: ${JSON.stringify(body.body)}`);
    }

    return body.body.data;
}

export async function createTeamWithMembers(page: Page, memberCount: number = 2) {
    const team = await createTestTeam(page);
    const users: UserInfo[] = [];

    for (let index = 0; index < memberCount; index++) {
        const user = await createTestUser(page);
        await addUserToTeam(page, team.id, user.id);
        users.push({ ...user, email: "", type: "user" });
    }

    if (users.length > 0) {
        await patchTeam(page, team.id, { captain_id: users[0].id });
    }

    return { team, users };
}

export async function openTeamCaptainModal(page: Page, teamId: number) {
    await page.goto(`${BASE_URL}/admin/teams/${teamId}`, { waitUntil: "domcontentloaded" });
    await page.click(".edit-captain");
    await page.waitForSelector("#team-captain-form", { state: "visible", timeout: 10_000 });
    await page.waitForTimeout(300);
}

export async function openTeamAwardModal(page: Page, teamId: number) {
    await page.goto(`${BASE_URL}/admin/teams/${teamId}`, { waitUntil: "domcontentloaded" });
    await page.click(".award-team");
    await page.waitForSelector("#user-award-form", { state: "visible", timeout: 10_000 });
    await page.waitForTimeout(300);
}

export async function openUserAwardModal(page: Page, userId: number) {
    await page.goto(`${BASE_URL}/admin/users/${userId}`, { waitUntil: "domcontentloaded" });
    await page.click(".award-user");
    await page.waitForSelector("#user-award-form", { state: "visible", timeout: 10_000 });
    await page.waitForTimeout(300);
}

export async function getAwards(
    page: Page,
    params: Record<string, string | number | undefined> = {}
): Promise<AwardInfo[]> {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== "") {
            searchParams.set(key, String(value));
        }
    }

    const queryString = searchParams.toString();
    const res = await page.request.get(`${BASE_URL}/api/v1/awards${queryString ? `?${queryString}` : ""}`);
    const body = await res.json();
    const data = (body.data ?? []) as any[];

    return data.map((item) => ({
        id: item.id,
        userId: item.user_id ?? null,
        teamId: item.team_id ?? null,
        name: item.name ?? "",
        description: item.description ?? "",
        value: item.value ?? 0,
        category: item.category ?? "",
        icon: item.icon ?? "",
        type: item.type ?? "standard",
    }));
}

export async function getAwardById(page: Page, awardId: number): Promise<AwardInfo | null> {
    const res = await page.request.get(`${BASE_URL}/api/v1/awards/${awardId}`);
    if (res.status() === 404) {
        return null;
    }
    const body = await res.json();
    if (!body.success || !body.data) {
        return null;
    }

    const item = body.data;
    return {
        id: item.id,
        userId: item.user_id ?? null,
        teamId: item.team_id ?? null,
        name: item.name ?? "",
        description: item.description ?? "",
        value: item.value ?? 0,
        category: item.category ?? "",
        icon: item.icon ?? "",
        type: item.type ?? "standard",
    };
}

export async function createAward(
    page: Page,
    payload: {
        userId: number;
        teamId?: number;
        name: string;
        value: number;
        description?: string;
        category?: string;
        icon?: string;
    }
) {
    await page.goto(`${BASE_URL}/admin/users/${payload.userId}`, { waitUntil: "domcontentloaded" });
    const body = await page.evaluate(async ({ payload, BASE_URL }) => {
        const csrfToken = (window as any).init?.csrfNonce || "";
        const res = await fetch(`${BASE_URL}/api/v1/awards`, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "CSRF-Token": csrfToken,
            },
            body: JSON.stringify({
                user_id: payload.userId,
                team_id: payload.teamId,
                name: payload.name,
                value: payload.value,
                description: payload.description ?? "",
                category: payload.category ?? "general",
                icon: payload.icon ?? "shield",
            }),
        });
        return { status: res.status, body: await res.json() };
    }, { payload, BASE_URL });

    if (body.status !== 200 || !body.body?.success || !body.body?.data?.id) {
        throw new Error(`Không thể tạo award test: ${JSON.stringify(body.body)}`);
    }

    return body.body.data;
}

export async function deleteAwardByApi(page: Page, awardId: number) {
    await page.goto(`${BASE_URL}/admin/users`, { waitUntil: "domcontentloaded" });
    const body = await page.evaluate(async ({ awardId, BASE_URL }) => {
        const csrfToken = (window as any).init?.csrfNonce || "";
        const res = await fetch(`${BASE_URL}/api/v1/awards/${awardId}`, {
            method: "DELETE",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "CSRF-Token": csrfToken,
            },
        });

        let responseBody;
        try {
            responseBody = await res.json();
        } catch (_err) {
            responseBody = null;
        }

        return { status: res.status, body: responseBody };
    }, { awardId, BASE_URL });

    if (body.status !== 200 || !body.body?.success) {
        throw new Error(`Không thể xóa award ${awardId}: ${JSON.stringify(body.body)}`);
    }

    return body.body;
}

export async function deleteAwardsByName(page: Page, name: string) {
    const awards = await getAwards(page, { q: name, field: "name" });
    for (const award of awards) {
        await deleteAwardByApi(page, award.id);
    }
}

export async function getComments(
    page: Page,
    params: Record<string, string | number | undefined> = {}
): Promise<CommentInfo[]> {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== "") {
            searchParams.set(key, String(value));
        }
    }

    const queryString = searchParams.toString();
    const res = await page.request.get(`${BASE_URL}/api/v1/comments${queryString ? `?${queryString}` : ""}`);
    const body = await res.json();
    const data = (body.data ?? []) as any[];

    return data.map((item) => ({
        id: item.id,
        type: item.type ?? "",
        content: item.content ?? "",
        html: item.html ?? "",
        authorId: item.author_id,
        userId: item.user_id ?? null,
        teamId: item.team_id ?? null,
        challengeId: item.challenge_id ?? null,
    }));
}

export async function createComment(
    page: Page,
    payload: {
        content: string;
        type: "user" | "team" | "challenge";
        userId?: number;
        teamId?: number;
        challengeId?: number;
    }
) {
    const targetUrl = payload.userId
        ? `${BASE_URL}/admin/users/${payload.userId}`
        : payload.teamId
            ? `${BASE_URL}/admin/teams/${payload.teamId}`
            : `${BASE_URL}/admin/challenges/${payload.challengeId}`;

    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    const body = await page.evaluate(async ({ payload, BASE_URL }) => {
        const csrfToken = (window as any).init?.csrfNonce || "";
        const res = await fetch(`${BASE_URL}/api/v1/comments`, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "CSRF-Token": csrfToken,
            },
            body: JSON.stringify({
                content: payload.content,
                type: payload.type,
                user_id: payload.userId,
                team_id: payload.teamId,
                challenge_id: payload.challengeId,
            }),
        });
        return { status: res.status, body: await res.json() };
    }, { payload, BASE_URL });

    if (body.status !== 200 || !body.body?.success || !body.body?.data?.id) {
        throw new Error(`Không thể tạo comment test: ${JSON.stringify(body.body)}`);
    }

    return body.body.data;
}

export async function deleteCommentByApi(page: Page, commentId: number) {
    await page.goto(`${BASE_URL}/admin/users`, { waitUntil: "domcontentloaded" });
    const body = await page.evaluate(async ({ commentId, BASE_URL }) => {
        const csrfToken = (window as any).init?.csrfNonce || "";
        const res = await fetch(`${BASE_URL}/api/v1/comments/${commentId}`, {
            method: "DELETE",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "CSRF-Token": csrfToken,
            },
        });

        let responseBody;
        try {
            responseBody = await res.json();
        } catch (_err) {
            responseBody = null;
        }

        return { status: res.status, body: responseBody };
    }, { commentId, BASE_URL });

    if (body.status !== 200 || !body.body?.success) {
        throw new Error(`Không thể xóa comment ${commentId}: ${JSON.stringify(body.body)}`);
    }

    return body.body;
}

export async function deleteCommentsByContent(page: Page, content: string) {
    const comments = await getComments(page, { q: content, field: "content" });
    for (const comment of comments) {
        await deleteCommentByApi(page, comment.id);
    }
}

export async function getBrackets(page: Page): Promise<BracketInfo[]> {
    const res = await page.request.get(`${BASE_URL}/api/v1/brackets`);
    const body = await res.json();
    const data = (body.data ?? []) as any[];
    return data.map((item) => ({
        id: item.id,
        name: item.name ?? "",
        description: item.description ?? "",
        type: item.type ?? "",
    }));
}

export async function createBracket(
    page: Page,
    payload: { name: string; description: string; type: "users" | "teams" }
) {
    await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
    const body = await page.evaluate(async ({ payload, BASE_URL }) => {
        const csrfToken = (window as any).init?.csrfNonce || "";
        const res = await fetch(`${BASE_URL}/api/v1/brackets`, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "CSRF-Token": csrfToken,
            },
            body: JSON.stringify(payload),
        });
        return { status: res.status, body: await res.json() };
    }, { payload, BASE_URL });

    if (body.status !== 200 || !body.body?.success || !body.body?.data?.id) {
        throw new Error(`Không thể tạo bracket test: ${JSON.stringify(body.body)}`);
    }

    return body.body.data;
}

export async function updateBracket(
    page: Page,
    bracketId: number,
    payload: { name?: string; description?: string; type?: "users" | "teams" }
) {
    await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
    const body = await page.evaluate(async ({ bracketId, payload, BASE_URL }) => {
        const csrfToken = (window as any).init?.csrfNonce || "";
        const res = await fetch(`${BASE_URL}/api/v1/brackets/${bracketId}`, {
            method: "PATCH",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "CSRF-Token": csrfToken,
            },
            body: JSON.stringify(payload),
        });
        return { status: res.status, body: await res.json() };
    }, { bracketId, payload, BASE_URL });

    if (body.status !== 200 || !body.body?.success) {
        throw new Error(`Không thể cập nhật bracket ${bracketId}: ${JSON.stringify(body.body)}`);
    }

    return body.body.data;
}

export async function deleteBracketByApi(page: Page, bracketId: number) {
    await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
    const body = await page.evaluate(async ({ bracketId, BASE_URL }) => {
        const csrfToken = (window as any).init?.csrfNonce || "";
        const res = await fetch(`${BASE_URL}/api/v1/brackets/${bracketId}`, {
            method: "DELETE",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "CSRF-Token": csrfToken,
            },
        });
        return { status: res.status, body: await res.json() };
    }, { bracketId, BASE_URL });

    if (body.status !== 200 || !body.body?.success) {
        throw new Error(`Không thể xóa bracket ${bracketId}: ${JSON.stringify(body.body)}`);
    }

    return body.body;
}

export async function getCustomFields(page: Page, type: "user" | "team" | "users" | "teams"): Promise<CustomFieldInfo[]> {
    const normalizedType = normalizeCustomFieldScope(type);
    const res = await page.request.get(`${BASE_URL}/api/v1/configs/fields?type=${normalizedType}`, { timeout: 20_000 });
    const body = await res.json();
    const data = (body.data ?? []) as any[];
    return data.map((item) => ({
        id: item.id,
        type: item.type ?? normalizedType,
        fieldType: item.field_type ?? "text",
        name: item.name ?? "",
        description: item.description ?? "",
        editable: Boolean(item.editable),
        required: Boolean(item.required),
        public: Boolean(item.public),
    }));
}

export async function createCustomField(
    page: Page,
    payload: {
        type: "user" | "team" | "users" | "teams";
        fieldType?: "text" | "boolean";
        name: string;
        description: string;
        editable?: boolean;
        required?: boolean;
        public?: boolean;
    }
) {
    await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
    const body = await page.evaluate(async ({ payload, BASE_URL }) => {
        const normalizedType = payload.type === "users" || payload.type === "user" ? "user" : "team";
        const csrfToken = (window as any).init?.csrfNonce || "";
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 20_000);
        const res = await fetch(`${BASE_URL}/api/v1/configs/fields`, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "CSRF-Token": csrfToken,
            },
            signal: controller.signal,
            body: JSON.stringify({
                type: normalizedType,
                field_type: payload.fieldType ?? "text",
                name: payload.name,
                description: payload.description,
                editable: payload.editable ?? false,
                required: payload.required ?? false,
                public: payload.public ?? false,
            }),
        });
        window.clearTimeout(timeoutId);
        return { status: res.status, body: await res.json() };
    }, { payload, BASE_URL });

    if (body.status !== 200 || !body.body?.success || !body.body?.data?.id) {
        throw new Error(`Không thể tạo custom field test: ${JSON.stringify(body.body)}`);
    }

    return body.body.data;
}

export async function updateCustomField(
    page: Page,
    fieldId: number,
    payload: Record<string, unknown>
) {
    await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
    const body = await page.evaluate(async ({ fieldId, payload, BASE_URL }) => {
        const csrfToken = (window as any).init?.csrfNonce || "";
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 20_000);
        const res = await fetch(`${BASE_URL}/api/v1/configs/fields/${fieldId}`, {
            method: "PATCH",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "CSRF-Token": csrfToken,
            },
            signal: controller.signal,
            body: JSON.stringify(payload),
        });
        window.clearTimeout(timeoutId);
        return { status: res.status, body: await res.json() };
    }, { fieldId, payload, BASE_URL });

    if (body.status !== 200 || !body.body?.success) {
        throw new Error(`Không thể cập nhật custom field ${fieldId}: ${JSON.stringify(body.body)}`);
    }

    return body.body.data;
}

export async function deleteCustomFieldByApi(page: Page, fieldId: number) {
    await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
    const body = await page.evaluate(async ({ fieldId, BASE_URL }) => {
        const csrfToken = (window as any).init?.csrfNonce || "";
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 20_000);
        const res = await fetch(`${BASE_URL}/api/v1/configs/fields/${fieldId}`, {
            method: "DELETE",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "CSRF-Token": csrfToken,
            },
            signal: controller.signal,
        });
        window.clearTimeout(timeoutId);
        return { status: res.status, body: await res.json() };
    }, { fieldId, BASE_URL });

    if (body.status !== 200 || !body.body?.success) {
        throw new Error(`Không thể xóa custom field ${fieldId}: ${JSON.stringify(body.body)}`);
    }

    return body.body;
}

/**
 * Ensures a contestant user with a team exists in the shared DB.
 * Call this from a beforeAll/beforeEach on the admin page.
 */
export async function ensureContestantUser(
    page: Page,
    username = 'user2',
    password = '1',
    teamName = 'team2',
): Promise<void> {
    const result = await page.evaluate(async ({ username, password, teamName, BASE_URL }) => {
        const errors: string[] = [];
        const userMode: string = (window as any).init?.userMode ?? 'unknown';
        const adminTeamId: number | null = (window as any).init?.teamId ?? null;
        const csrfToken: string =
            (window as any).init?.csrfNonce ||
            (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement | null)?.content ||
            '';
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'CSRF-Token': csrfToken,
        };

        // Step 1: Create team (ignore 400 = already exists, 404 = users mode)
        let teamId: number | null = null;
        const teamCreateResp = await fetch(`${BASE_URL}/api/v1/teams`, {
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
            const listResp = await fetch(`${BASE_URL}/api/v1/teams?q=${encodeURIComponent(teamName)}&field=name`, {
                credentials: 'same-origin',
                headers: { Accept: 'application/json', 'CSRF-Token': csrfToken },
            });
            if (listResp.ok) {
                const listData = await listResp.json();
                const found = (listData.data as any[])?.find((t: any) => t.name === teamName);
                if (found) teamId = found.id;
                else errors.push(`Team not found in search`);
            } else {
                errors.push(`Team search ${listResp.status}`);
            }
        }

        // Step 2: Create user (ignore 400 = already exists)
        let userId: number | null = null;
        const userCreateResp = await fetch(`${BASE_URL}/api/v1/users`, {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: JSON.stringify({ name: username, email: `${username}@test.local`, password, type: 'user', verified: true }),
        });
        if (userCreateResp.ok) {
            const userData = await userCreateResp.json();
            userId = userData.data?.id ?? null;
        } else {
            errors.push(`User POST ${userCreateResp.status}`);
            const listResp = await fetch(`${BASE_URL}/api/v1/users?q=${encodeURIComponent(username)}&field=name`, {
                credentials: 'same-origin',
                headers: { Accept: 'application/json', 'CSRF-Token': csrfToken },
            });
            if (listResp.ok) {
                const listData = await listResp.json();
                const found = (listData.data as any[])?.find((u: any) => u.name === username);
                if (found) userId = found.id;
                else errors.push(`User not found in search`);
            } else {
                errors.push(`User search ${listResp.status}`);
            }
        }

        // Step 3: Check if user already has a team assigned
        let existingTeamId: number | null = null;
        if (userId) {
            const userInfoResp = await fetch(`${BASE_URL}/api/v1/users/${userId}`, {
                credentials: 'same-origin',
                headers: { Accept: 'application/json', 'CSRF-Token': csrfToken },
            });
            if (userInfoResp.ok) {
                const userInfo = await userInfoResp.json();
                existingTeamId = userInfo.data?.team_id ?? null;
            }
        }

        // If user already has the correct team, nothing more to do
        if (existingTeamId && (teamId === null || existingTeamId === teamId)) {
            if (teamId === null) teamId = existingTeamId;
            return { userMode, teamId, userId, errors, skippedAssignment: true };
        }

        // Step 4: Assign user to team via PATCH (works regardless of user_mode)
        // Fall back to admin's own teamId if teams API was blocked (users mode)
        const effectiveTeamId = teamId ?? adminTeamId;
        if (userId && effectiveTeamId) {
            const patchResp = await fetch(`${BASE_URL}/api/v1/users/${userId}`, {
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
    }, { username, password, teamName, BASE_URL });

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
