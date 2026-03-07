import { test, expect } from "playwright/test";
import { BASE_URL, getRewardTemplates, loginAsAdmin } from "./helpers";

test.describe("UC-23 Query Reward", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC23.01 - Trang Dynamic Reward Query hiển thị danh sách template", async ({ page }) => {
        const templates = await getRewardTemplates(page);

        await page.goto(`${BASE_URL}/admin/rewards`, { waitUntil: "domcontentloaded" });

        await expect(page.locator("h1")).toContainText("Reward Query");
        await expect(page.locator("#template-cards .template-card").first()).toBeVisible();
        expect(templates.length, "Phải có ít nhất 1 template reward").toBeGreaterThan(0);
    });

    test("TC23.02 - Chọn template Top Teams by Score và preview kết quả", async ({ page }) => {
        const templates = await getRewardTemplates(page);
        const template = templates.find((item) => item.id === "top_teams_by_score") ?? templates[0];

        await page.goto(`${BASE_URL}/admin/rewards`, { waitUntil: "domcontentloaded" });
        await page.click(`#template-cards .template-card[data-template-id="${template.id}"]`);

        await expect(page.locator("#params-card")).toBeVisible();
        await expect(page.locator("#selected-template-name")).toContainText(template.name);

        if (template.customizable_params.includes("limit")) {
            await page.fill("#param-limit", "3");
        }

        await page.click("#preview-btn");

        await expect(page.locator("#results-card")).toBeVisible();
        await expect(page.locator("#result-count")).toContainText("results");
        await expect(page.locator("#results-body tr").first()).toBeVisible();
    });

    test("TC23.03 - Reset xóa template đang chọn và ẩn kết quả preview", async ({ page }) => {
        const templates = await getRewardTemplates(page);
        const template = templates.find((item) => item.id === "top_teams_by_score") ?? templates[0];

        await page.goto(`${BASE_URL}/admin/rewards`, { waitUntil: "domcontentloaded" });
        await page.click(`#template-cards .template-card[data-template-id="${template.id}"]`);

        if (template.customizable_params.includes("limit")) {
            await page.fill("#param-limit", "3");
        }
        await page.click("#preview-btn");
        await expect(page.locator("#results-card")).toBeVisible();

        await page.click("#reset-btn");

        await expect(page.locator("#params-card")).not.toBeVisible();
        await expect(page.locator("#results-card")).not.toBeVisible();
    });
});