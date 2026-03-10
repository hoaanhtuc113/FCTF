import { test, expect, Page } from "@playwright/test";
import { BASE_URL, getSubmissions, loginAsAdmin } from "./support";

async function selectSubmissionFilterOption(
    page: Page,
    target: "team_id" | "user_id" | "challenge_id",
    value: number,
    label: string
) {
    const wrapper = page.locator(`.searchable-select-wrapper[data-ss-target="${target}"]`).first();
    await expect(wrapper).toBeVisible();
    await page.evaluate(({ nextTarget, nextValue, nextLabel }) => {
        const hiddenInput = document.querySelector(`input[type="hidden"][name="${nextTarget}"]`);
        const visibleInput = document.querySelector(`.searchable-select-wrapper[data-ss-target="${nextTarget}"] .ss-input`);

        if (!(hiddenInput instanceof HTMLInputElement) || !(visibleInput instanceof HTMLInputElement)) {
            throw new Error(`Submission filter ${nextTarget} is not available`);
        }

        hiddenInput.value = String(nextValue);
        hiddenInput.dispatchEvent(new Event("input", { bubbles: true }));
        hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));

        visibleInput.value = nextLabel;
        visibleInput.dispatchEvent(new Event("input", { bubbles: true }));
        visibleInput.dispatchEvent(new Event("change", { bubbles: true }));
        visibleInput.blur();
    }, { nextTarget: target, nextValue: value, nextLabel: label });
    await expect(wrapper.locator(`input[type="hidden"][name="${target}"]`)).toHaveValue(String(value));
}

async function openSubmissions(page: Page) {
    await page.goto(`${BASE_URL}/admin/submissions`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#filterForm")).toBeVisible();
}

async function submitSubmissionFilters(page: Page, expectedParams: Record<string, string>) {
    await Promise.all([
        page.waitForURL((url) => {
            if (url.pathname !== "/admin/submissions") {
                return false;
            }

            return Object.entries(expectedParams).every(([key, value]) => url.searchParams.get(key) === value);
        }),
        page.evaluate(() => {
            const form = document.querySelector("#filterForm");
            if (!(form instanceof HTMLFormElement)) {
                throw new Error("Submission filter form is not available");
            }
            form.requestSubmit();
        }),
    ]);
}

test.describe("UC-45 Search Submission", () => {
    let sampleId: number;
    let sampleChallengeName: string;
    let sampleChallengeId: number;
    let sampleTeamId: number;
    let sampleUserId: number;
    let sampleTeamName: string;
    let sampleUserName: string;
    let sampleDate: string;

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        await loginAsAdmin(page);
        const submissions = await getSubmissions(page, { page: 1, per_page: 10 });
        const sample = submissions[0];
        sampleId = sample.id;
        sampleChallengeName = sample.challengeName;
        sampleChallengeId = sample.challengeId;
        sampleTeamId = sample.teamId;
        sampleUserId = sample.userId;
        sampleTeamName = sample.teamName;
        sampleUserName = sample.userName;
        sampleDate = sample.date.slice(0, 10);
        await page.close();
    });

    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC45.01 - Search submission theo ID", async ({ page }) => {
        const params = new URLSearchParams({ field: "id", q: String(sampleId) });
        await page.goto(`${BASE_URL}/admin/submissions?${params.toString()}`, { waitUntil: "domcontentloaded" });
        await expect(page.locator("#teamsboard tbody")).toContainText(String(sampleId));
    });

    test("TC45.02 - Search submission theo challenge name", async ({ page }) => {
        const params = new URLSearchParams({ field: "challenge_name", q: sampleChallengeName });
        await page.goto(`${BASE_URL}/admin/submissions?${params.toString()}`, { waitUntil: "domcontentloaded" });
        await expect(page.locator("#teamsboard tbody")).toContainText(sampleChallengeName);
    });

    test("TC45.03 - Filter theo team_id và user_id", async ({ page }) => {
        await openSubmissions(page);
        await selectSubmissionFilterOption(page, "team_id", sampleTeamId, sampleTeamName);
        await selectSubmissionFilterOption(page, "user_id", sampleUserId, sampleUserName);
        await submitSubmissionFilters(page, { team_id: String(sampleTeamId), user_id: String(sampleUserId) });
        await expect(page).toHaveURL(/team_id=/);
        await expect(page).toHaveURL(/user_id=/);
        await expect(page.locator("#teamsboard tbody")).toContainText(sampleTeamName);
        await expect(page.locator("#teamsboard tbody")).toContainText(sampleUserName);
    });

    test("TC45.04 - Filter theo challenge_id và date range", async ({ page }) => {
        await openSubmissions(page);
        await selectSubmissionFilterOption(page, "challenge_id", sampleChallengeId, sampleChallengeName);
        await page.locator('#date_from').fill(sampleDate);
        await page.locator('#date_to').fill(sampleDate);
        await submitSubmissionFilters(page, {
            challenge_id: String(sampleChallengeId),
            date_from: sampleDate,
            date_to: sampleDate,
        });
        await expect(page).toHaveURL(/challenge_id=/);
        await expect(page).toHaveURL(/date_from=/);
        await expect(page).toHaveURL(/date_to=/);
        await expect(page.locator("#teamsboard tbody")).toContainText(sampleChallengeName);
    });

    test("TC45.05 - Nút Reset xóa toàn bộ search/filter submissions", async ({ page }) => {
        const params = new URLSearchParams({ field: "id", q: String(sampleId), team_id: String(sampleTeamId) });
        await page.goto(`${BASE_URL}/admin/submissions?${params.toString()}`, { waitUntil: "domcontentloaded" });
        await page.click('button[title="Reset"]');
        await expect(page).toHaveURL(`${BASE_URL}/admin/submissions`);
    });
});