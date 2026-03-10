// @ts-nocheck
/**
 * Edit User - Playwright System Tests
 *
 * Scope:
 * - Use only existing users already present in the system
 * - Keep assertions UI-based for the Edit User flow
 * - Generate the normal Playwright HTML report when the suite runs
 */

import { test, expect, Page, Browser } from "@playwright/test";

const BASE_URL = "https://admin.fctf.site";
const CONTESTANT_URL = "https://contestant.fctf.site";
const ADMIN_USER = "admin";
const ADMIN_PASS = "1";
const KNOWN_EXISTING_USER_PASSWORD = "1";
const STABLE_RESTORED_PASSWORD = "RestoredPass123!";
const SUBMIT_WAIT_MS = 3000;
const KNOWN_EXISTING_USER_NAMES = ["user20", "user22", "user2", "user9", "user1"];

type StaffRole = "admin" | "jury" | "challenge_writer";

type UserInfo = {
    id: number;
    name: string;
    email: string;
    type: string;
    verified: boolean;
    hidden: boolean;
    banned: boolean;
};

const knownPasswordsByUserId = new Map<number, string>();

async function loginAsAdmin(page: Page) {
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
        } catch (error) {
            if (attempt === 1 || page.isClosed()) {
                throw error;
            }
            await page.waitForTimeout(1500);
        }
    }
}

async function getUsers(page: Page, limit: number = 100): Promise<UserInfo[]> {
    const res = await page.request.get(`${BASE_URL}/api/v1/users?page=1&per_page=${limit}`);
    const body = await res.json();
    const data = (body.data ?? []) as any[];

    if (data.length === 0) {
        throw new Error("No existing users are available in the system for UC30");
    }

    return data.map((item) => ({
        id: item.id,
        name: item.name ?? "",
        email: item.email ?? "",
        type: item.type ?? "user",
        verified: Boolean(item.verified),
        hidden: Boolean(item.hidden),
        banned: Boolean(item.banned),
    }));
}

async function getUserDetails(page: Page, userId: number): Promise<UserInfo> {
    const res = await page.request.get(`${BASE_URL}/api/v1/users/${userId}`);
    const body = await res.json();
    const item = body.data;

    if (!item?.id) {
        throw new Error(`Unable to load details for user ${userId}`);
    }

    return {
        id: item.id,
        name: item.name ?? "",
        email: item.email ?? "",
        type: item.type ?? "user",
        verified: Boolean(item.verified),
        hidden: Boolean(item.hidden),
        banned: Boolean(item.banned),
    };
}

async function findKnownExistingUser(page: Page, excludedIds: number[] = []) {
    const users = await getUsers(page, 100);

    for (const candidateName of KNOWN_EXISTING_USER_NAMES) {
        const candidate = users.find((user) => user.name === candidateName && !excludedIds.includes(user.id));
        if (!candidate) {
            continue;
        }

        const detail = await getUserDetails(page, candidate.id);
        if (detail.type === "user" && !detail.hidden && !detail.banned) {
            return detail;
        }
    }

    throw new Error(
        `UC30 requires an existing contestant account with known password '${KNOWN_EXISTING_USER_PASSWORD}'. Checked: ${KNOWN_EXISTING_USER_NAMES.join(", ")}`
    );
}

async function openUserEditModal(page: Page, userId: number) {
    await page.goto(`${BASE_URL}/admin/users/${userId}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForSelector(".edit-user", { state: "visible" });
    await page.click(".edit-user");
    await page.waitForSelector("#user-info-edit-form", { state: "visible", timeout: 8_000 });
    await page.waitForTimeout(400);
}

async function ensureRequiredUserFields(page: Page) {
    const bracketSelect = page.locator('#user-info-edit-form select[name="bracket_id"]');
    if (await bracketSelect.count() === 0) {
        return;
    }

    const currentValue = await bracketSelect.inputValue();
    if (currentValue) {
        return;
    }

    const firstValidOption = await bracketSelect.locator("option").evaluateAll((options) => {
        const valid = options.find((option) => {
            if (!(option instanceof HTMLOptionElement)) {
                return false;
            }
            return Boolean(option.value && option.textContent?.trim());
        }) as HTMLOptionElement | undefined;

        return valid ? valid.value : null;
    });

    if (!firstValidOption) {
        throw new Error("User edit form requires a valid bracket option");
    }

    await bracketSelect.selectOption(firstValidOption);
}

async function submitUserEditForm(page: Page) {
    await page.locator("#user-info-edit-form").evaluate((form) => {
        (form as HTMLFormElement).requestSubmit();
    });
}

async function fillAndSubmit(page: Page, fieldName: string, value: string) {
    await page.fill(`#user-info-edit-form [name="${fieldName}"]`, value);
    await ensureRequiredUserFields(page);
    await submitUserEditForm(page);
    await page.waitForTimeout(SUBMIT_WAIT_MS);
}

async function expectModalStillOpen(page: Page) {
    await expect(page.locator("#user-info-edit-form")).toBeVisible();
}

async function expectModalClosed(page: Page) {
    await expect(page.locator("#user-info-edit-form")).toBeHidden({ timeout: 10_000 });
}

async function expectUserDetails(page: Page, expected: { name?: string; email?: string }) {
    if (expected.name) {
        await expect(page.locator(".jumbotron h1, .jumbotron h2").first()).toContainText(expected.name, {
            timeout: 10_000,
        });
    }

    if (expected.email) {
        await expect(page.locator("#team-email")).toContainText(expected.email, { timeout: 10_000 });
    }
}

async function expectUsernameUnchanged(page: Page, originalName: string) {
    await expect(page.locator(".jumbotron h1, .jumbotron h2").first()).toContainText(originalName);
}

async function setCheckbox(page: Page, fieldName: "verified" | "hidden" | "banned", checked: boolean) {
    const checkbox = page.locator(`#user-info-edit-form [name="${fieldName}"]`);
    if (await checkbox.count() === 0) {
        throw new Error(`Checkbox '${fieldName}' is not available in the edit form`);
    }

    if ((await checkbox.isChecked()) !== checked) {
        await checkbox.click();
    }
}

async function setRole(page: Page, role: StaffRole | "user") {
    await page.selectOption('#user-info-edit-form select[name="type"]', role);
}

async function updateExistingUser(
    page: Page,
    baseline: UserInfo,
    changes: {
        name?: string;
        email?: string;
        password?: string;
        type?: StaffRole | "user";
        verified?: boolean;
        hidden?: boolean;
        banned?: boolean;
    }
) {
    await openUserEditModal(page, baseline.id);
    await page.fill('#user-info-edit-form [name="name"]', changes.name ?? baseline.name);
    await page.fill('#user-info-edit-form [name="email"]', changes.email ?? baseline.email);

    if (changes.password !== undefined) {
        await page.fill('#user-info-edit-form [name="password"]', changes.password);
    }

    if (changes.type !== undefined) {
        await setRole(page, changes.type);
    }

    if (changes.verified !== undefined) {
        await setCheckbox(page, "verified", changes.verified);
    }

    if (changes.hidden !== undefined) {
        await setCheckbox(page, "hidden", changes.hidden);
    }

    if (changes.banned !== undefined) {
        await setCheckbox(page, "banned", changes.banned);
    }

    await ensureRequiredUserFields(page);
    await submitUserEditForm(page);
    await expectModalClosed(page);
    await page.waitForLoadState("domcontentloaded");
}

async function patchUserViaApi(
    page: Page,
    userId: number,
    payload: {
        name?: string;
        email?: string;
        password?: string;
        type?: StaffRole | "user";
        verified?: boolean;
        hidden?: boolean;
        banned?: boolean;
    }
) {
    await page.goto(`${BASE_URL}/admin/users/${userId}`, { waitUntil: "domcontentloaded", timeout: 30_000 });

    const result = await page.evaluate(async ({ userId: targetUserId, nextPayload, baseUrl }) => {
        const csrfToken = (window as any).init?.csrfNonce || "";
        const response = await fetch(`${baseUrl}/api/v1/users/${targetUserId}`, {
            method: "PATCH",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "CSRF-Token": csrfToken,
            },
            body: JSON.stringify(nextPayload),
        });

        let body: any = null;
        try {
            body = await response.json();
        } catch {
            body = null;
        }

        return {
            status: response.status,
            body,
        };
    }, {
        userId: userId,
        nextPayload: payload,
        baseUrl: BASE_URL,
    });

    if (result.status !== 200 || !result.body?.success) {
        throw new Error(`Unable to patch user ${userId}: ${JSON.stringify(result.body)}`);
    }

    await page.goto(`${BASE_URL}/admin/users/${userId}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    return result.body.data;
}

async function restoreKnownExistingUser(page: Page, baseline: UserInfo, password?: string) {
    await openUserEditModal(page, baseline.id);
    await page.fill('#user-info-edit-form [name="name"]', baseline.name);
    await page.fill('#user-info-edit-form [name="email"]', baseline.email);

    if (password) {
        await page.fill('#user-info-edit-form [name="password"]', password);
    }

    await setRole(page, baseline.type as StaffRole | "user");
    await setCheckbox(page, "verified", baseline.verified);
    await setCheckbox(page, "hidden", baseline.hidden);
    await setCheckbox(page, "banned", baseline.banned);
    await ensureRequiredUserFields(page);
    await submitUserEditForm(page);
    await page.waitForTimeout(SUBMIT_WAIT_MS);
    await page.goto(`${BASE_URL}/admin/users/${baseline.id}`, { waitUntil: "domcontentloaded", timeout: 30_000 });

    await expectUserDetails(page, {
        name: baseline.name,
        email: baseline.email,
    });

    const restored = await getUserDetails(page, baseline.id);
    expect(restored.type).toBe(baseline.type);
    expect(restored.verified).toBe(baseline.verified);
    expect(restored.hidden).toBe(baseline.hidden);
    expect(restored.banned).toBe(baseline.banned);

    if (password) {
        knownPasswordsByUserId.set(baseline.id, password);
    }
}

function getKnownPassword(userId: number) {
    return knownPasswordsByUserId.get(userId) ?? KNOWN_EXISTING_USER_PASSWORD;
}

async function loginToAdminPortal(page: Page, username: string, password: string) {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.fill('input[name="name"]', username);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"], input[type="submit"]');
}

async function loginToContestantPortal(page: Page, username: string, password: string) {
    await page.goto(`${CONTESTANT_URL}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByPlaceholder("input username...").fill(username);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: /\[LOGIN\]/i }).click();
}

async function expectContestantLoginSuccess(browser: Browser, username: string, password: string) {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        await loginToContestantPortal(page, username, password);
        await expect(page).toHaveURL(/\/challenges/, { timeout: 15_000 });
    } finally {
        await context.close();
    }
}

async function expectContestantLoginBlocked(browser: Browser, username: string, password: string) {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        await loginToContestantPortal(page, username, password);
        await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
        await expect(page.locator('[role="alert"]').first()).toContainText(/not allowed|invalid|incorrect/i, {
            timeout: 10_000,
        });
    } finally {
        await context.close();
    }
}

async function verifyStaffPortalForRole(browser: Browser, username: string, password: string, role: StaffRole) {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        await loginToAdminPortal(page, username, password);
        await expect(page).toHaveURL(/\/admin\//, { timeout: 15_000 });
        await expect(page.locator("a.nav-link", { hasText: "Challenges" })).toBeVisible();

        if (role === "admin") {
            await expect(page.locator("a.nav-link", { hasText: "Users" })).toBeVisible();
            await expect(page.locator("a.nav-link", { hasText: "Config" })).toBeVisible();
            await expect(page.locator("a.clean-btn", { hasText: "Create Challenge" })).toBeVisible();
        }

        if (role === "jury") {
            await expect(page.locator("a.nav-link", { hasText: "Users" })).toBeVisible();
            await expect(page.locator("a.nav-link", { hasText: "Config" })).toHaveCount(0);
            await expect(page.locator("a.clean-btn", { hasText: "Create Challenge" })).toHaveCount(0);
            await page.goto(`${BASE_URL}/admin/users`, { waitUntil: "domcontentloaded" });
            await expect(page.locator("a.clean-btn", { hasText: "Create User" })).toHaveCount(0);
        }

        if (role === "challenge_writer") {
            await expect(page.locator("a.nav-link", { hasText: "Users" })).toHaveCount(0);
            await expect(page.locator("a.nav-link", { hasText: "Config" })).toHaveCount(0);
            await expect(page.locator("a.clean-btn", { hasText: "Create Challenge" })).toBeVisible();
        }
    } finally {
        await context.close();
    }
}

async function expectUserVisibleInFilteredList(page: Page, filter: "hidden" | "banned", userName: string) {
    const encoded = encodeURIComponent(userName);
    await page.goto(`${BASE_URL}/admin/users?field=name&q=${encoded}&${filter}=true`, {
        waitUntil: "domcontentloaded",
    });
    await expect(page.locator("#teamsboard tbody tr", { hasText: userName }).first()).toBeVisible();
}

test.describe.serial("Edit User - System Tests", () => {
    test.describe.configure({ timeout: 90_000 });

    let editableUser: UserInfo;
    let duplicateUserName: string | null;
    let contestantUser: UserInfo;
    let roleMutationUser: UserInfo;

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        await loginAsAdmin(page);

        const users = await getUsers(page, 100);
        const nonAdminUsers = users.filter((user) => user.name !== ADMIN_USER);
        editableUser = await getUserDetails(page, nonAdminUsers[0].id);

        duplicateUserName = nonAdminUsers.find((user) => user.id !== editableUser.id)?.name ?? null;
        contestantUser = await findKnownExistingUser(page, [editableUser.id]);
        roleMutationUser = await findKnownExistingUser(page, [editableUser.id, contestantUser.id]);
        knownPasswordsByUserId.set(contestantUser.id, KNOWN_EXISTING_USER_PASSWORD);
        knownPasswordsByUserId.set(roleMutationUser.id, KNOWN_EXISTING_USER_PASSWORD);

        await page.close();
    });

    test.beforeEach(async ({ page }, testInfo) => {
        await loginAsAdmin(page);

        if (!/^TC(0[1-9]|10|11)\b/.test(testInfo.title)) {
            return;
        }

        editableUser = await getUserDetails(page, editableUser.id);
        await openUserEditModal(page, editableUser.id);
    });

    test("TC01 - [Invalid] Empty user name keeps the modal open", async ({ page }) => {
        await page.fill('#user-info-edit-form [name="name"]', "");
        await ensureRequiredUserFields(page);
        await submitUserEditForm(page);
        await page.waitForTimeout(SUBMIT_WAIT_MS);

        await expectModalStillOpen(page);
        await expectUsernameUnchanged(page, editableUser.name);
    });

    test("TC02 - [Invalid] User name longer than 128 characters is rejected", async ({ page }) => {
        await fillAndSubmit(page, "name", "U".repeat(129));
        await expectModalStillOpen(page);
        await expectUsernameUnchanged(page, editableUser.name);
    });

    test("TC03 - [Invalid] Duplicate user name is rejected", async ({ page }) => {
        test.skip(duplicateUserName === null, "Requires at least two existing users");
        await fillAndSubmit(page, "name", duplicateUserName!);
        await expectModalStillOpen(page);
        await expectUsernameUnchanged(page, editableUser.name);
    });

    test("TC04 - [Invalid] Empty email keeps the modal open", async ({ page }) => {
        await page.fill('#user-info-edit-form [name="name"]', editableUser.name);
        await fillAndSubmit(page, "email", "");
        await expectModalStillOpen(page);
        await expectUsernameUnchanged(page, editableUser.name);
    });

    test("TC05 - [Invalid] Email without @ is rejected", async ({ page }) => {
        await page.fill('#user-info-edit-form [name="name"]', editableUser.name);
        await fillAndSubmit(page, "email", "invalidemail.com");
        await expectModalStillOpen(page);
        await expectUsernameUnchanged(page, editableUser.name);
    });

    test("TC06 - [Invalid] Email with double @ is rejected", async ({ page }) => {
        await page.fill('#user-info-edit-form [name="name"]', editableUser.name);
        await fillAndSubmit(page, "email", "bad@@format.com");
        await expectModalStillOpen(page);
        await expectUsernameUnchanged(page, editableUser.name);
    });

    test("TC07 - [Invalid] Email without domain is rejected", async ({ page }) => {
        await page.fill('#user-info-edit-form [name="name"]', editableUser.name);
        await fillAndSubmit(page, "email", "user@");
        await expectModalStillOpen(page);
        await expectUsernameUnchanged(page, editableUser.name);
    });

    test("TC08 - [Invalid] Email longer than 128 characters is rejected", async ({ page }) => {
        await page.fill('#user-info-edit-form [name="name"]', editableUser.name);
        await fillAndSubmit(page, "email", `${"a".repeat(120)}@example.com`);
        await expectModalStillOpen(page);
        await expectUsernameUnchanged(page, editableUser.name);
    });

    test("TC09 - [Valid] Update user name successfully", async ({ page }) => {
        const original = await getUserDetails(page, editableUser.id);
        const newName = `AutoUser_${Date.now()}`;

        await updateExistingUser(page, original, { name: newName });
        await expectUserDetails(page, { name: newName });

        await updateExistingUser(page, original, { name: original.name });
        await expectUserDetails(page, { name: original.name });
    });

    test("TC10 - [Valid] Update email successfully", async ({ page }) => {
        const original = await getUserDetails(page, editableUser.id);
        const newEmail = `autotest_${Date.now()}@example.com`;

        await updateExistingUser(page, original, { email: newEmail });
        await expectUserDetails(page, { email: newEmail });

        await updateExistingUser(page, original, { email: original.email });
        await expectUserDetails(page, { email: original.email });
    });

    test("TC11 - [Valid] Update user name and email successfully", async ({ page }) => {
        const original = await getUserDetails(page, editableUser.id);
        const newName = `FullUser_${Date.now()}`;
        const newEmail = `fulluser_${Date.now()}@example.com`;

        await updateExistingUser(page, original, { name: newName, email: newEmail });
        await expectUserDetails(page, { name: newName, email: newEmail });

        await updateExistingUser(page, original, { name: original.name, email: original.email });
        await expectUserDetails(page, { name: original.name, email: original.email });
    });

    test("TC12 - [Valid] Update password for an existing user and login to contestant portal", async ({ page, browser }) => {
        const original = await getUserDetails(page, contestantUser.id);
        const newPassword = `UserPass_${Date.now()}!`;

        try {
            await updateExistingUser(page, original, {
                password: newPassword,
                type: "user",
                hidden: false,
                banned: false,
            });
            await expectUserDetails(page, { name: original.name, email: original.email });
            await expectContestantLoginSuccess(browser, original.name, newPassword);
        } finally {
            await restoreKnownExistingUser(page, original, STABLE_RESTORED_PASSWORD);
        }
    });

    test("TC13 - [Valid] Change role to admin and login to admin portal", async ({ page, browser }) => {
        const original = await getUserDetails(page, roleMutationUser.id);
        const newPassword = `AdminPass_${Date.now()}!`;

        try {
            await updateExistingUser(page, original, {
                password: newPassword,
                type: "admin",
                verified: true,
                hidden: false,
                banned: false,
            });
            await verifyStaffPortalForRole(browser, original.name, newPassword, "admin");
        } finally {
            await restoreKnownExistingUser(page, original, STABLE_RESTORED_PASSWORD);
        }
    });

    test("TC14 - [Valid] Change role to jury and login to admin portal", async ({ page, browser }) => {
        const original = await getUserDetails(page, roleMutationUser.id);
        const newPassword = `JuryPass_${Date.now()}!`;

        try {
            await updateExistingUser(page, original, {
                password: newPassword,
                type: "jury",
                verified: true,
                hidden: false,
                banned: false,
            });
            await verifyStaffPortalForRole(browser, original.name, newPassword, "jury");
        } finally {
            await restoreKnownExistingUser(page, original, STABLE_RESTORED_PASSWORD);
        }
    });

    test("TC15 - [Valid] Change role to challenge writer and login to admin portal", async ({ page, browser }) => {
        const original = await getUserDetails(page, roleMutationUser.id);
        const newPassword = `WriterPass_${Date.now()}!`;

        try {
            await updateExistingUser(page, original, {
                password: newPassword,
                type: "challenge_writer",
                verified: true,
                hidden: false,
                banned: false,
            });
            await verifyStaffPortalForRole(browser, original.name, newPassword, "challenge_writer");
        } finally {
            await restoreKnownExistingUser(page, original, STABLE_RESTORED_PASSWORD);
        }
    });

    test("TC16 - [Valid] Enable Hidden and block contestant login", async ({ page, browser }) => {
        const original = await getUserDetails(page, contestantUser.id);

        try {
            await updateExistingUser(page, original, {
                type: "user",
                hidden: true,
                banned: false,
            });
            await expectUserVisibleInFilteredList(page, "hidden", original.name);
            await expectContestantLoginBlocked(browser, original.name, getKnownPassword(original.id));
        } finally {
            await restoreKnownExistingUser(page, original);
        }
    });

    test("TC17 - [Valid] Enable Banned and block contestant login", async ({ page, browser }) => {
        const original = await getUserDetails(page, contestantUser.id);

        try {
            await updateExistingUser(page, original, {
                type: "user",
                hidden: false,
                banned: true,
            });
            await expectUserVisibleInFilteredList(page, "banned", original.name);
            await expectContestantLoginBlocked(browser, original.name, getKnownPassword(original.id));
        } finally {
            await restoreKnownExistingUser(page, original);
        }
    });
});
