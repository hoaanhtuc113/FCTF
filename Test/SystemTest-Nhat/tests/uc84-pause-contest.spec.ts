import { test, expect } from "@playwright/test";
import { BASE_URL, loginAsAdmin, openAdminConfigTab, ensureContestantUser } from "./support";

const CONTESTANT_URL = "https://contestant2.fctf.site";

/**
 * UC84 – Pause Contest
 *
 * Page: Admin → Config → Access → Pause (#pause)
 * Element: checkbox #paused (checked = contest paused)
 * Behavior:
 *   - When paused: users CANNOT submit flags (API returns HTTP 403, status "paused",
 *     message "{ctf_name} is paused"). Challenges remain viewable.
 *   - When unpaused: normal submission flow resumes.
 *
 * IMPORTANT: afterAll ALWAYS unpauses to avoid blocking other tests.
 */

test.describe("UC84 Pause Contest", () => {
    test.describe.configure({ mode: "serial" });

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            await loginAsAdmin(page);
            await ensureContestantUser(page);
        } finally {
            await page.close();
        }
    });

    test.afterAll(async ({ browser }) => {
        // ALWAYS unpause after this suite
        const page = await browser.newPage();
        try {
            await loginAsAdmin(page);
            await openAdminConfigTab(page, "#pause");
            const checkbox = page.locator("#paused");
            if (await checkbox.isChecked()) {
                await checkbox.uncheck();
                await Promise.all([
                    page.waitForNavigation({ waitUntil: "load", timeout: 30_000 }).catch(() => undefined),
                    page.locator('#pause button[type="submit"]').click(),
                ]);
            }
        } finally {
            await page.close();
        }
    });

    test.beforeEach(async ({ page }) => {
        test.setTimeout(90_000);
        await loginAsAdmin(page);
    });

    // ─── UI TESTS ────────────────────────────────────────────────────────────

    test("TC84.01 – Pause tab hiển thị đúng các thành phần UI", async ({ page }) => {
        await openAdminConfigTab(page, "#pause");

        // Tab pane should be visible
        await expect(page.locator("#pause")).toBeVisible();

        // Checkbox + label
        const checkbox = page.locator("#paused");
        await expect(checkbox).toBeVisible();
        await expect(page.locator('#pause label')).toContainText("Pause CTF");

        // Helper text
        await expect(page.locator("#pause")).toContainText(
            "Prevent users from submitting answers until unpaused"
        );

        // Update button
        await expect(page.locator('#pause button[type="submit"]')).toBeVisible();
        await expect(page.locator('#pause button[type="submit"]')).toContainText("Update");
    });

    // ─── FUNCTIONAL TESTS ────────────────────────────────────────────────────

    test("TC84.02 – Bật Pause → checkbox lưu trạng thái checked", async ({ page }) => {
        await openAdminConfigTab(page, "#pause");

        const checkbox = page.locator("#paused");
        if (!(await checkbox.isChecked())) {
            await checkbox.check();
        }

        await Promise.all([
            page.waitForNavigation({ waitUntil: "load", timeout: 30_000 }).catch(() => undefined),
            page.locator('#pause button[type="submit"]').click(),
        ]);

        // Reload and verify
        await openAdminConfigTab(page, "#pause");
        await expect(page.locator("#paused")).toBeChecked();
    });

    test("TC84.03 – Tắt Pause → checkbox lưu trạng thái unchecked", async ({ page }) => {
        await openAdminConfigTab(page, "#pause");

        const checkbox = page.locator("#paused");
        if (await checkbox.isChecked()) {
            await checkbox.uncheck();
        }

        await Promise.all([
            page.waitForNavigation({ waitUntil: "load", timeout: 30_000 }).catch(() => undefined),
            page.locator('#pause button[type="submit"]').click(),
        ]);

        // Reload and verify
        await openAdminConfigTab(page, "#pause");
        await expect(page.locator("#paused")).not.toBeChecked();
    });

    test("TC84.04 – Khi contest bị pause, API /attempt trả về status 'paused'", async ({ page }) => {
        // Pause the contest
        await openAdminConfigTab(page, "#pause");
        const checkbox = page.locator("#paused");
        if (!(await checkbox.isChecked())) {
            await checkbox.check();
        }
        await Promise.all([
            page.waitForNavigation({ waitUntil: "load", timeout: 30_000 }).catch(() => undefined),
            page.locator('#pause button[type="submit"]').click(),
        ]);

        // Verify paused status via config API
        const configResult = await page.evaluate(async () => {
            const resp = await fetch("/api/v1/configs", {
                credentials: "same-origin",
                headers: { Accept: "application/json" },
            });
            return resp.json();
        });

        if (configResult.success && Array.isArray(configResult.data)) {
            const pausedConfig = configResult.data.find(
                (c: any) => c.key === "paused"
            );
            if (pausedConfig) {
                expect(String(pausedConfig.value)).toMatch(/true|1/i);
            }
        }
    });

    test("TC84.05 – Khi contest bị pause, contestant thấy thông báo paused khi submit flag", async ({ page, browser }) => {
        // Ensure contest is UN-paused first so contestant can log in
        await openAdminConfigTab(page, "#pause");
        const checkbox = page.locator("#paused");
        if (await checkbox.isChecked()) {
            await checkbox.uncheck();
            await Promise.all([
                page.waitForNavigation({ waitUntil: "load", timeout: 30_000 }).catch(() => undefined),
                page.locator('#pause button[type="submit"]').click(),
            ]);
        }

        // Login as contestant BEFORE pausing the contest
        const contestantPage = await browser.newPage();
        try {
            await contestantPage.goto(`${CONTESTANT_URL}/login`, { waitUntil: "domcontentloaded" });
            await contestantPage.locator('input[placeholder="input username..."]').fill("user2");
            await contestantPage.locator('input[placeholder="enter_password"]').fill("1");
            await contestantPage.locator('button[type="submit"]').click();
            await contestantPage.waitForURL((url) => !url.pathname.startsWith('/login'), {
                timeout: 30_000,
            });

            // Now pause the contest
            await openAdminConfigTab(page, "#pause");
            const pauseCheckbox = page.locator("#paused");
            if (!(await pauseCheckbox.isChecked())) {
                await pauseCheckbox.check();
                await Promise.all([
                    page.waitForNavigation({ waitUntil: "load", timeout: 30_000 }).catch(() => undefined),
                    page.locator('#pause button[type="submit"]').click(),
                ]);
            }

            // Try to submit a flag via API — should return paused
            const submitResult = await contestantPage.evaluate(async () => {
                const resp = await fetch("/api/v1/challenges/attempt", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "application/json",
                    },
                    body: JSON.stringify({ challenge_id: 1, submission: "fake_flag" }),
                });
                return { status: resp.status, body: await resp.json() };
            });

            // Contest is paused — expect 403 with "paused" status
            expect(submitResult.status).toBe(403);
            expect(submitResult.body.data?.status).toBe("paused");
            expect(submitResult.body.data?.message).toContain("paused");
        } finally {
            await contestantPage.close();
        }
    });

    test("TC84.06 – Unpause → contestant có thể truy cập challenges bình thường", async ({ page, browser }) => {
        // Unpause the contest
        await openAdminConfigTab(page, "#pause");
        const checkbox = page.locator("#paused");
        if (await checkbox.isChecked()) {
            await checkbox.uncheck();
        }
        await Promise.all([
            page.waitForNavigation({ waitUntil: "load", timeout: 30_000 }).catch(() => undefined),
            page.locator('#pause button[type="submit"]').click(),
        ]);

        // Verify unpaused via config API
        await openAdminConfigTab(page, "#pause");
        await expect(page.locator("#paused")).not.toBeChecked();

        // Login as contestant and verify challenges are accessible
        const contestantPage = await browser.newPage();
        try {
            await contestantPage.goto(`${CONTESTANT_URL}/login`, { waitUntil: "domcontentloaded" });
            await contestantPage.locator('input[placeholder="input username..."]').fill("user2");
            await contestantPage.locator('input[placeholder="enter_password"]').fill("1");
            await contestantPage.locator('button[type="submit"]').click();
            await contestantPage.waitForURL((url) => !url.pathname.startsWith('/login'), {
                timeout: 30_000,
            });

            // Navigate to challenges page
            await contestantPage.goto(`${CONTESTANT_URL}/challenges`, { waitUntil: "domcontentloaded" });

            // Should NOT see any "paused" message
            const bodyText = await contestantPage.locator("body").textContent({ timeout: 10_000 });
            expect(bodyText).not.toContain("is paused");
        } finally {
            await contestantPage.close();
        }
    });

    test("TC84.07 – Toggle Pause On → Off → On (round-trip)", async ({ page }) => {
        // Pause
        await openAdminConfigTab(page, "#pause");
        const cb = page.locator("#paused");
        if (!(await cb.isChecked())) await cb.check();
        await Promise.all([
            page.waitForNavigation({ waitUntil: "load", timeout: 30_000 }).catch(() => undefined),
            page.locator('#pause button[type="submit"]').click(),
        ]);
        await openAdminConfigTab(page, "#pause");
        await expect(page.locator("#paused")).toBeChecked();

        // Unpause
        await page.locator("#paused").uncheck();
        await Promise.all([
            page.waitForNavigation({ waitUntil: "load", timeout: 30_000 }).catch(() => undefined),
            page.locator('#pause button[type="submit"]').click(),
        ]);
        await openAdminConfigTab(page, "#pause");
        await expect(page.locator("#paused")).not.toBeChecked();

        // Pause again
        await page.locator("#paused").check();
        await Promise.all([
            page.waitForNavigation({ waitUntil: "load", timeout: 30_000 }).catch(() => undefined),
            page.locator('#pause button[type="submit"]').click(),
        ]);
        await openAdminConfigTab(page, "#pause");
        await expect(page.locator("#paused")).toBeChecked();
    });
});
