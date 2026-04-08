const { chromium } = require('@playwright/test');
const process = require('node:process');

const ADMIN_URL = process.env.ADMIN_URL ?? 'https://admin0.fctf.site';
const ADMIN_USER = process.env.ADMIN_USER ?? 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS ?? '1';
const TARGET_PASSWORD = process.env.TARGET_PASSWORD ?? '1';
const INCLUDE_NON_USER_TYPES = process.env.INCLUDE_NON_USER_TYPES === '1';
const INCLUDE_SELF = process.env.INCLUDE_SELF === '1';
const DRY_RUN = process.env.DRY_RUN === '1';
const RATE_LIMIT_DELAY_MS = Number(process.env.RATE_LIMIT_DELAY_MS ?? 600);
const MAX_RETRIES = Number(process.env.MAX_RETRIES ?? 5);
const PER_PAGE = Number(process.env.PER_PAGE ?? 100);

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestWithRetry(action, label) {
    let lastStatus = 0;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const response = await action();
        lastStatus = response.status();

        if (lastStatus === 429 || lastStatus >= 500) {
            const waitMs = Math.min(1000 * attempt, 6000);
            console.log(`[retry] ${label} status=${lastStatus}, attempt=${attempt}/${MAX_RETRIES}, wait=${waitMs}ms`);
            await sleep(waitMs);
            continue;
        }

        return response;
    }

    throw new Error(`${label} failed after ${MAX_RETRIES} retries, last status=${lastStatus}`);
}

async function loginAdmin(page) {
    await page.goto(`${ADMIN_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    if (!new URL(page.url()).pathname.startsWith('/login')) {
        return;
    }

    const userInput = page.locator('#name, input[name="name"], input[placeholder*="user" i], input[placeholder*="email" i]').first();
    const passInput = page.locator('#password, input[name="password"], input[type="password"]').first();
    const submitButton = page.locator('#_submit, button[type="submit"]').first();

    await userInput.waitFor({ state: 'visible', timeout: 15000 });
    await userInput.fill(ADMIN_USER);
    await passInput.fill(ADMIN_PASS);

    await Promise.all([
        page.waitForURL(/\/admin(\/|$)/, { timeout: 30000 }),
        submitButton.click(),
    ]);
}

async function getCsrfToken(page) {
    await page.goto(`${ADMIN_URL}/admin`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const csrfToken = await page.evaluate(() => {
        const nonce = window.init?.csrfNonce;
        const meta = document.querySelector('meta[name="csrf-token"]');
        return nonce || meta?.getAttribute('content') || '';
    });

    if (!csrfToken) {
        throw new Error('Cannot find CSRF token from admin page.');
    }

    return csrfToken;
}

async function fetchAllUsers(page) {
    const users = [];
    let currentPage = 1;

    while (true) {
        const url = `${ADMIN_URL}/api/v1/users?page=${currentPage}&per_page=${PER_PAGE}`;
        const response = await requestWithRetry(
            () => page.request.get(url),
            `GET users page=${currentPage}`,
        );

        if (!response.ok()) {
            throw new Error(`GET ${url} failed with status=${response.status()}`);
        }

        const body = await response.json().catch(() => ({}));
        const pageUsers = Array.isArray(body?.data) ? body.data : [];
        users.push(...pageUsers);

        const pages = Number(body?.meta?.pagination?.pages ?? 0);
        if (pages > 0) {
            if (currentPage >= pages) {
                break;
            }
        } else if (pageUsers.length < PER_PAGE) {
            break;
        }

        currentPage += 1;
        await sleep(RATE_LIMIT_DELAY_MS);
    }

    return users;
}

function filterTargetUsers(users) {
    const adminUserLower = ADMIN_USER.trim().toLowerCase();

    return users.filter((user) => {
        if (typeof user?.id !== 'number') {
            return false;
        }

        const name = String(user?.name ?? '').trim().toLowerCase();
        const email = String(user?.email ?? '').trim().toLowerCase();
        const type = String(user?.type ?? '').trim().toLowerCase();

        if (!INCLUDE_SELF && (name === adminUserLower || email === adminUserLower)) {
            return false;
        }

        if (!INCLUDE_NON_USER_TYPES && type && type !== 'user') {
            return false;
        }

        return true;
    });
}

async function resetUserPassword(page, csrfToken, userId) {
    const url = `${ADMIN_URL}/api/v1/users/${userId}`;
    const response = await requestWithRetry(
        () => page.request.patch(url, {
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'CSRF-Token': csrfToken,
            },
            data: {
                password: TARGET_PASSWORD,
            },
        }),
        `PATCH user=${userId}`,
    );

    const rawText = await response.text();
    let body = null;
    try {
        body = JSON.parse(rawText);
    } catch {
        body = null;
    }

    const success = response.status() === 200 && !!body?.success;
    return {
        success,
        status: response.status(),
        body,
        rawText: rawText.slice(0, 300),
    };
}

async function main() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        console.log(`[start] ADMIN_URL=${ADMIN_URL}`);
        console.log(`[start] target_password_length=${TARGET_PASSWORD.length}`);

        await loginAdmin(page);
        console.log('[ok] admin login success');

        const csrfToken = await getCsrfToken(page);
        console.log('[ok] csrf token loaded');

        const allUsers = await fetchAllUsers(page);
        const targetUsers = filterTargetUsers(allUsers);

        console.log(`[info] total_users=${allUsers.length}`);
        console.log(`[info] target_users=${targetUsers.length}`);

        if (targetUsers.length === 0) {
            console.log('[done] no target users to reset');
            return;
        }

        if (DRY_RUN) {
            console.log('[dry-run] no password changes were sent');
            for (const user of targetUsers) {
                console.log(`[dry-run] would reset user_id=${user.id} name=${user.name}`);
            }
            return;
        }

        let successCount = 0;
        const failures = [];

        for (const user of targetUsers) {
            const result = await resetUserPassword(page, csrfToken, user.id);

            if (result.success) {
                successCount += 1;
                console.log(`[ok] user_id=${user.id} name=${user.name}`);
            } else {
                failures.push({
                    id: user.id,
                    name: user.name,
                    status: result.status,
                    message: result.body?.message || result.rawText,
                });
                console.log(`[fail] user_id=${user.id} name=${user.name} status=${result.status}`);
            }

            await sleep(RATE_LIMIT_DELAY_MS);
        }

        console.log(`[summary] success=${successCount} failed=${failures.length}`);

        if (failures.length > 0) {
            for (const f of failures) {
                console.log(`[failed-user] id=${f.id} name=${f.name} status=${f.status} message=${f.message}`);
            }
            process.exitCode = 1;
        }
    } finally {
        await context.close();
        await browser.close();
    }
}

main().catch((error) => {
    console.error('[fatal]', error.message);
    process.exit(1);
});
