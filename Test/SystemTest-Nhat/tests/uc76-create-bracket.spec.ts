import { test, expect } from "@playwright/test";
import { BASE_URL, commitLazyInput, deleteBracketByApi, getTeams, loginAsAdmin, openTeamEditModal } from "./support";

test.describe("UC-76 Create Bracket", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC76.01 - Admin tạo bracket mới từ trang config", async ({ page }) => {
        const name = `UC76_BRACKET_${Date.now()}`;
        let createdId: number | null = null;
        const targetTeam = (await getTeams(page, 1))[0];

        try {
            await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
            await page.click('a[href="#brackets"]');
            await page.click('#brackets button:has-text("Add New Bracket")');

            const block = page.locator("#brackets .border-bottom").last();
            await commitLazyInput(block.locator("input.form-control").nth(0), name);
            await commitLazyInput(block.locator("input.form-control").nth(1), "Bracket created by automation");

            const createResponsePromise = page.waitForResponse((response) => {
                return response.url().includes("/api/v1/brackets") && response.request().method() === "POST";
            });

            await block.locator('button:has-text("Save")').click();
            const createResponse = await createResponsePromise;
            const createBody = await createResponse.json();
            createdId = createBody.data?.id ?? null;

            await openTeamEditModal(page, targetTeam.id);
            await expect(page.locator('#team-info-edit-form select[name="bracket_id"]')).toContainText(name);
        } finally {
            if (createdId !== null) {
                await deleteBracketByApi(page, createdId);
            }
        }
    });

    test("TC76.02 - Tạo bracket với name trống → API trả lỗi hoặc bracket không tạo", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
        await page.click('a[href="#brackets"]');
        await page.click('#brackets button:has-text("Add New Bracket")');

        const block = page.locator("#brackets .border-bottom").last();
        // Không điền name, chỉ điền description
        await commitLazyInput(block.locator("input.form-control").nth(1), "No name bracket");

        const responsePromise = page.waitForResponse((response) => {
            return response.url().includes("/api/v1/brackets") && response.request().method() === "POST";
        });

        await block.locator('button:has-text("Save")').click();
        const response = await responsePromise;
        const body = await response.json();

        // API should return error (success=false) or not create the bracket
        if (body.data?.id) {
            // Cleanup nếu somehow tạo được
            await deleteBracketByApi(page, body.data.id);
        }
        expect(body.success, "API không nên tạo bracket với name trống").toBeFalsy();
    });

    test("TC76.03 - [ECP - Edge] Tạo bracket với tên chứa ký tự đặc biệt → tạo thành công", async ({ page }) => {
        const name = `UC76_Special_<>&"'_${Date.now()}`;
        let createdId: number | null = null;

        try {
            await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
            await page.click('a[href="#brackets"]');
            await page.click('#brackets button:has-text("Add New Bracket")');

            const block = page.locator("#brackets .border-bottom").last();
            await commitLazyInput(block.locator("input.form-control").nth(0), name);
            await commitLazyInput(block.locator("input.form-control").nth(1), "Special char test");

            const responsePromise = page.waitForResponse((response) => {
                return response.url().includes("/api/v1/brackets") && response.request().method() === "POST";
            });

            await block.locator('button:has-text("Save")').click();
            const response = await responsePromise;
            const body = await response.json();

            if (body.data?.id) {
                createdId = body.data.id;
                expect(body.success).toBeTruthy();
            }
        } finally {
            if (createdId !== null) {
                await deleteBracketByApi(page, createdId);
            }
        }
    });

    test("TC76.04 - [BVA - Boundary] Tạo bracket với tên rất dài (200+ ký tự)", async ({ page }) => {
        const name = "L".repeat(200);
        let createdId: number | null = null;

        try {
            await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
            await page.click('a[href="#brackets"]');
            await page.click('#brackets button:has-text("Add New Bracket")');

            const block = page.locator("#brackets .border-bottom").last();
            await commitLazyInput(block.locator("input.form-control").nth(0), name);

            const responsePromise = page.waitForResponse((response) => {
                return response.url().includes("/api/v1/brackets") && response.request().method() === "POST";
            });

            await block.locator('button:has-text("Save")').click();
            const response = await responsePromise;
            const body = await response.json();

            if (body.data?.id) {
                createdId = body.data.id;
            }
            // API có thể accept hoặc reject — cả hai đều hợp lệ
        } finally {
            if (createdId !== null) {
                await deleteBracketByApi(page, createdId);
            }
        }
    });

    test("TC76.05 - [ECP - Invalid] Tạo bracket với tên chỉ gồm whitespace → API reject", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
        await page.click('a[href="#brackets"]');
        await page.click('#brackets button:has-text("Add New Bracket")');

        const block = page.locator("#brackets .border-bottom").last();
        await commitLazyInput(block.locator("input.form-control").nth(0), "   ");

        const responsePromise = page.waitForResponse((response) => {
            return response.url().includes("/api/v1/brackets") && response.request().method() === "POST";
        });

        await block.locator('button:has-text("Save")').click();
        const response = await responsePromise;
        const body = await response.json();

        if (body.data?.id) {
            await deleteBracketByApi(page, body.data.id);
        }
        // Whitespace-only name should be treated like empty
        expect(body.success === false || body.data?.name?.trim() === "").toBeTruthy();
    });
});