import { test, expect } from "playwright/test";
import { BASE_URL, createSubmission, deleteSubmissionByApi, getSubmissionSeed, loginAsAdmin } from "./helpers";

async function createAuditSeed(page: Parameters<typeof test>[0]["page"]) {
    const seed = await getSubmissionSeed(page);
    const token = `AUDIT_DELETE_${Date.now()}`;
    const created = await createSubmission(page, {
        userId: seed.userId,
        teamId: seed.teamId,
        challengeId: seed.challengeId,
        provided: token,
        type: "incorrect",
    });
    await deleteSubmissionByApi(page, created.id);
    return created.id;
}

test.describe("UC-26 View Audit Logs", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC26.01 - Trang Audit Logs hiển thị filter inputs và bảng log", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/admin_audit`, { waitUntil: "domcontentloaded" });

        await expect(page.locator("h1")).toContainText("Audit Logs");
        await expect(page.getByPlaceholder("e.g. 5 or alice")).toBeVisible();
        await expect(page.locator('label[for="role"]')).toBeVisible();
        await expect(page.getByRole("textbox", { name: "All roles" })).toBeVisible();
        await expect(page.locator('label[for="action"]')).toBeVisible();
        await expect(page.getByRole("textbox", { name: "All actions" })).toBeVisible();
        await expect(page.locator('label[for="target_type"]')).toBeVisible();
        await expect(page.getByRole("textbox", { name: "All", exact: true })).toBeVisible();
        await expect(page.locator('label[for="target_id"]')).toBeVisible();
        await expect(page.getByPlaceholder("e.g. 42")).toBeVisible();
        await expect(page.locator("table").first()).toBeVisible();
    });

    test("TC26.02 - Filter theo action submission_delete và target_id mở được diff modal", async ({ page }) => {
        const targetId = await createAuditSeed(page);

        await page.goto(
            `${BASE_URL}/admin/admin_audit?action=submission_delete&target_type=submission&target_id=${targetId}`,
            { waitUntil: "domcontentloaded" }
        );

        await expect(page.locator("table.clean-table tbody")).toContainText("Delete Submission");
        await expect(page.locator("table.clean-table tbody")).toContainText(String(targetId));

        const viewButton = page.locator(".view-diff-btn").first();
        await expect(viewButton).toBeVisible();
        await viewButton.click();
        await expect(page.locator("#diffModal")).toBeVisible();
    });

    test("TC26.03 - Nút Clear xóa bộ lọc audit logs", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/admin_audit?action=submission_delete&target_type=submission`, { waitUntil: "domcontentloaded" });
        await page.click('a[title="Clear"]');
        await expect(page).toHaveURL(`${BASE_URL}/admin/admin_audit`);
    });
});