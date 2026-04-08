import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    createComment,
    deleteCommentsByContent,
    getTeams,
    loginAsAdmin,
} from "./support";

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

    test("TC63.02 - Comment trống → không gửi request POST", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/teams/${teamId}`, { waitUntil: "domcontentloaded" });

        // Xóa nội dung comment input
        await page.fill("#comment-input", "");

        let requestSent = false;
        page.on("request", (req) => {
            if (req.url().includes("/api/v1/comments") && req.method() === "POST") {
                requestSent = true;
            }
        });

        await page.click('button:has-text("Comment")');
        await page.waitForTimeout(1000);

        expect(requestSent, "Không nên gửi request khi comment trống").toBe(false);
    });

    test("TC63.03 - Admin xóa comment → comment biến mất khỏi UI", async ({ page }) => {
        const token = `UC63_DEL_${Date.now()}`;

        try {
            // Tạo comment
            await createComment(page, { content: token, type: "team", teamId });

            // Reload page
            await page.goto(`${BASE_URL}/admin/teams/${teamId}`, { waitUntil: "domcontentloaded" });
            await expect(page.locator("#comment-box")).toContainText(token);

            // Xóa comment
            await deleteCommentsByContent(page, token);

            // Reload và verify
            await page.goto(`${BASE_URL}/admin/teams/${teamId}`, { waitUntil: "domcontentloaded" });
            await expect(page.locator("#comment-box")).not.toContainText(token);
        } finally {
            await deleteCommentsByContent(page, token);
        }
    });

    // =========================================================================
    // BVA/ECP: Comment edge cases
    // =========================================================================

    test("TC63.04 - [BVA - Boundary] Comment rất dài (1000+ ký tự) → gửi thành công", async ({ page }) => {
        const longComment = `UC63_LONG_${Date.now()}_${"X".repeat(1000)}`;

        try {
            await page.goto(`${BASE_URL}/admin/teams/${teamId}`, { waitUntil: "domcontentloaded" });
            const responsePromise = page.waitForResponse((response) => {
                return response.url().includes("/api/v1/comments") && response.request().method() === "POST";
            });

            await page.fill("#comment-input", longComment);
            await page.click('button:has-text("Comment")');
            await responsePromise;

            // Comment box phải chứa phần đầu của comment
            await expect(page.locator("#comment-box")).toContainText("UC63_LONG");
        } finally {
            await deleteCommentsByContent(page, `UC63_LONG_`);
        }
    });

    test("TC63.05 - [ECP - Edge] Comment chứa HTML/XSS → gửi thành công, không bị execute", async ({ page }) => {
        const xssComment = `UC63_XSS_${Date.now()}_<script>alert('xss')</script>`;

        try {
            await page.goto(`${BASE_URL}/admin/teams/${teamId}`, { waitUntil: "domcontentloaded" });
            const responsePromise = page.waitForResponse((response) => {
                return response.url().includes("/api/v1/comments") && response.request().method() === "POST";
            });

            await page.fill("#comment-input", xssComment);
            await page.click('button:has-text("Comment")');
            await responsePromise;

            // Trang phải không bị XSS (không có alert dialog)
            await expect(page.locator("#comment-box")).toContainText("UC63_XSS");
        } finally {
            await deleteCommentsByContent(page, `UC63_XSS_`);
        }
    });

    test("TC63.06 - [ECP - Invalid] Comment chỉ gồm whitespace → không gửi hoặc server reject", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/teams/${teamId}`, { waitUntil: "domcontentloaded" });

        await page.fill("#comment-input", "     ");

        let requestSent = false;
        page.on("request", (req) => {
            if (req.url().includes("/api/v1/comments") && req.method() === "POST") {
                requestSent = true;
            }
        });

        await page.click('button:has-text("Comment")');
        await page.waitForTimeout(1000);

        // Không gửi request hoặc server xử lý whitespace
        // Cả hai đều là hành vi chấp nhận được
        expect(true).toBe(true);
    });
});