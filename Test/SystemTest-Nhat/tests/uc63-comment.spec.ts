import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    createComment,
    deleteCommentsByContent,
    getTeams,
    loginAsAdmin,
} from "./helpers";

test.describe("UC-63 Comment", () => {
    let teamId: number;

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        await loginAsAdmin(page);
        teamId = (await getTeams(page, 1))[0].id;
        await page.close();
    });

    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC63.01 - Admin thêm comment trên trang chi tiết team", async ({ page }) => {
        const token = `UC63_COMMENT_${Date.now()}`;

        try {
            await page.goto(`${BASE_URL}/admin/teams/${teamId}`, { waitUntil: "domcontentloaded" });
            const responsePromise = page.waitForResponse((response) => {
                return response.url().includes("/api/v1/comments") && response.request().method() === "POST";
            });

            await page.fill("#comment-input", token);
            await page.click('button:has-text("Comment")');
            await responsePromise;

            await expect(page.locator("#comment-box")).toContainText(token);
        } finally {
            await deleteCommentsByContent(page, token);
        }
    });
});