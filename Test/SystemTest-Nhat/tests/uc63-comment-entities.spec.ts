import { test, expect } from "@playwright/test";
import {
    BASE_URL,
    deleteCommentsByContent,
    getTeams,
    getUsers,
    getChallenges,
    loginAsAdmin,
} from "./support";

test.describe("UC-63 Comment for Challenges, Teams, and Users - Refined", () => {
    let teamId: number;
    let userId: number;
    let challengeId: number;

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        await loginAsAdmin(page);
        teamId = (await getTeams(page, 1))[0].id;
        userId = (await getUsers(page, 1))[0].id;
        challengeId = (await getChallenges(page, 1))[0].id;
        await page.close();
    });

    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    // --- Challenge Comments ---
    test("CMT-001 - Admin thêm comment trên Challenge", async ({ page }) => {
        const token = `CHALLENGE_ADD_${Date.now()}`;
        try {
            await page.goto(`${BASE_URL}/admin/challenges/${challengeId}`, { waitUntil: "domcontentloaded" });
            await page.click(".comments-challenge");
            await expect(page.locator("#challenge-comments-window")).toBeVisible();

            const commentBox = page.locator("#challenge-comments-window #comment-box");
            await commentBox.locator("#comment-input").fill(token);
            
            const responsePromise = page.waitForResponse(r => 
                r.url().includes("/api/v1/comments") && r.request().method() === "POST"
            );
            await commentBox.locator('button:has-text("Comment")').click();
            await responsePromise;
            
            await expect(commentBox).toContainText(token);
        } finally {
            await deleteCommentsByContent(page, token);
        }
    });

    test("CMT-002 - Admin xóa comment trên Challenge", async ({ page }) => {
        const token = `CHALLENGE_DEL_${Date.now()}`;
        try {
            await page.goto(`${BASE_URL}/admin/challenges/${challengeId}`, { waitUntil: "domcontentloaded" });
            await page.click(".comments-challenge");
            
            const commentBox = page.locator("#challenge-comments-window #comment-box");
            await commentBox.locator("#comment-input").fill(token);
            await commentBox.locator('button:has-text("Comment")').click();
            await expect(commentBox).toContainText(token);
            
            page.on("dialog", d => d.accept());
            const deleteBtn = commentBox.locator(".clean-comment-card", { hasText: token }).locator(".clean-close-btn");
            await deleteBtn.evaluate(el => (el as HTMLElement).style.opacity = '1');
            await deleteBtn.click();
            
            await expect(commentBox).not.toContainText(token);
        } finally {
            await deleteCommentsByContent(page, token);
        }
    });

    // --- Team Comments ---
    test("CMT-003 - Admin thêm comment trên Team", async ({ page }) => {
        const token = `TEAM_ADD_${Date.now()}`;
        try {
            await page.goto(`${BASE_URL}/admin/teams/${teamId}`, { waitUntil: "domcontentloaded" });
            const commentBox = page.locator("#comment-box");
            await commentBox.locator("#comment-input").fill(token);
            
            const responsePromise = page.waitForResponse(r => 
                r.url().includes("/api/v1/comments") && r.request().method() === "POST"
            );
            await commentBox.locator('button:has-text("Comment")').click();
            await responsePromise;
            
            await expect(commentBox).toContainText(token);
        } finally {
            await deleteCommentsByContent(page, token);
        }
    });

    test("CMT-004 - Admin xóa comment trên Team", async ({ page }) => {
        const token = `TEAM_DEL_${Date.now()}`;
        try {
            await page.goto(`${BASE_URL}/admin/teams/${teamId}`, { waitUntil: "domcontentloaded" });
            const commentBox = page.locator("#comment-box");
            await commentBox.locator("#comment-input").fill(token);
            await commentBox.locator('button:has-text("Comment")').click();
            await expect(commentBox).toContainText(token);
            
            page.on("dialog", d => d.accept());
            const deleteBtn = commentBox.locator(".clean-comment-card", { hasText: token }).locator(".clean-close-btn");
            await deleteBtn.evaluate(el => (el as HTMLElement).style.opacity = '1');
            await deleteBtn.click();
            
            await expect(commentBox).not.toContainText(token);
        } finally {
            await deleteCommentsByContent(page, token);
        }
    });

    // --- User Comments ---
    test("CMT-005 - Admin thêm comment trên User", async ({ page }) => {
        const token = `USER_ADD_${Date.now()}`;
        try {
            await page.goto(`${BASE_URL}/admin/users/${userId}`, { waitUntil: "domcontentloaded" });
            const commentBox = page.locator("#comment-box");
            await commentBox.locator("#comment-input").fill(token);
            
            const responsePromise = page.waitForResponse(r => 
                r.url().includes("/api/v1/comments") && r.request().method() === "POST"
            );
            await commentBox.locator('button:has-text("Comment")').click();
            await responsePromise;
            
            await expect(commentBox).toContainText(token);
        } finally {
            await deleteCommentsByContent(page, token);
        }
    });

    test("CMT-006 - Admin xóa comment trên User", async ({ page }) => {
        const token = `USER_DEL_${Date.now()}`;
        try {
            await page.goto(`${BASE_URL}/admin/users/${userId}`, { waitUntil: "domcontentloaded" });
            const commentBox = page.locator("#comment-box");
            await commentBox.locator("#comment-input").fill(token);
            await commentBox.locator('button:has-text("Comment")').click();
            await expect(commentBox).toContainText(token);
            
            page.on("dialog", d => d.accept());
            const deleteBtn = commentBox.locator(".clean-comment-card", { hasText: token }).locator(".clean-close-btn");
            await deleteBtn.evaluate(el => (el as HTMLElement).style.opacity = '1');
            await deleteBtn.click();
            
            await expect(commentBox).not.toContainText(token);
        } finally {
            await deleteCommentsByContent(page, token);
        }
    });

    // --- Empty Comment Validation ---
    test("CMT-007 - Challenge: Comment trống không được gửi đi", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/challenges/${challengeId}`, { waitUntil: "domcontentloaded" });
        await page.click(".comments-challenge");
        
        const commentBox = page.locator("#challenge-comments-window #comment-box");
        await commentBox.locator("#comment-input").fill("");
        
        let requestSent = false;
        page.on("request", (req) => {
            if (req.url().includes("/api/v1/comments") && req.method() === "POST") {
                requestSent = true;
            }
        });

        await commentBox.locator('button:has-text("Comment")').click();
        await page.waitForTimeout(1000);
        expect(requestSent, "Không nên gửi request khi comment trống").toBe(false);
    });

    test("CMT-008 - Team: Comment trống không được gửi đi", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/teams/${teamId}`, { waitUntil: "domcontentloaded" });
        
        const commentBox = page.locator("#comment-box");
        await commentBox.locator("#comment-input").fill("");
        
        let requestSent = false;
        page.on("request", (req) => {
            if (req.url().includes("/api/v1/comments") && req.method() === "POST") {
                requestSent = true;
            }
        });

        await commentBox.locator('button:has-text("Comment")').click();
        await page.waitForTimeout(1000);
        expect(requestSent, "Không nên gửi request khi comment trống").toBe(false);
    });

    test("CMT-009 - User: Comment trống không được gửi đi", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/users/${userId}`, { waitUntil: "domcontentloaded" });
        
        const commentBox = page.locator("#comment-box");
        await commentBox.locator("#comment-input").fill("");
        
        let requestSent = false;
        page.on("request", (req) => {
            if (req.url().includes("/api/v1/comments") && req.method() === "POST") {
                requestSent = true;
            }
        });

        await commentBox.locator('button:has-text("Comment")').click();
        await page.waitForTimeout(1000);
        expect(requestSent, "Không nên gửi request khi comment trống").toBe(false);
    });
});
