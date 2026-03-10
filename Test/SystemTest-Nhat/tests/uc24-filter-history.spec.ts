import { test, expect } from "@playwright/test";
import { BASE_URL, loginAsAdmin } from "./support";

async function getHistorySeed(page: Parameters<typeof test>[0]["page"]) {
    await page.goto(`${BASE_URL}/admin/instances_history`, { waitUntil: "domcontentloaded" });
    const firstRow = page.locator("table.clean-table tbody tr").first();
    await expect(firstRow).toBeVisible();

    const text = (await firstRow.textContent()) ?? "";
    if (/No entries found/i.test(text)) {
        return null;
    }

    const startedAt = ((await firstRow.locator("td").nth(0).textContent()) ?? "").trim();
    const challengeName = await firstRow.locator("td").nth(3).getAttribute("title");
    const teamName = await firstRow.locator("td").nth(5).getAttribute("title");
    return {
        startedAt,
        challengeName: challengeName?.trim() ?? "",
        teamName: teamName?.trim() ?? "",
        dateOnly: startedAt.slice(0, 10),
    };
}

test.describe("UC-24 Filter History", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC24.01 - Filter theo challenge từ dữ liệu history hiện có", async ({ page }) => {
        const seed = await getHistorySeed(page);
        test.skip(!seed, "Không có instance history để test filter theo challenge");

        await page.goto(
            `${BASE_URL}/admin/instances_history?challenge=${encodeURIComponent(seed!.challengeName)}`,
            { waitUntil: "domcontentloaded" }
        );

        await expect(page).toHaveURL(/challenge=/);
        await expect(page.locator("table.clean-table tbody")).toContainText(seed!.challengeName);
    });

    test("TC24.02 - Filter theo team từ dữ liệu history hiện có", async ({ page }) => {
        const seed = await getHistorySeed(page);
        test.skip(!seed, "Không có instance history để test filter theo team");

        await page.goto(
            `${BASE_URL}/admin/instances_history?team=${encodeURIComponent(seed!.teamName)}`,
            { waitUntil: "domcontentloaded" }
        );

        await expect(page).toHaveURL(/team=/);
        await expect(page.locator("table.clean-table tbody")).toContainText(seed!.teamName);
    });

    test("TC24.03 - Filter theo khoảng ngày bằng start và end", async ({ page }) => {
        const seed = await getHistorySeed(page);
        test.skip(!seed, "Không có instance history để test date range");

        const start = `${seed!.dateOnly}T00:00`;
        const end = `${seed!.dateOnly}T23:59`;

        await page.goto(
            `${BASE_URL}/admin/instances_history?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
            { waitUntil: "domcontentloaded" }
        );

        await expect(page).toHaveURL(/start=/);
        await expect(page).toHaveURL(/end=/);
        await expect(page.locator("table.clean-table tbody")).toContainText(seed!.dateOnly);
    });

    test("TC24.04 - Filter với quick range và per_page được áp dụng lên URL", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/instances_history?quick=24h&per_page=25`, { waitUntil: "domcontentloaded" });

        await expect(page).toHaveURL(/quick=24h/);
        await expect(page).toHaveURL(/per_page=25/);
        await expect(page.locator("table.clean-table")).toBeVisible();
    });

    test("TC24.05 - Nút Reset xóa toàn bộ điều kiện filter", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/instances_history?challenge=XSS&quick=24h&per_page=25`, { waitUntil: "domcontentloaded" });
        await page.click('a[title="Reset"]');
        await expect(page).toHaveURL(`${BASE_URL}/admin/instances_history`);
    });
});