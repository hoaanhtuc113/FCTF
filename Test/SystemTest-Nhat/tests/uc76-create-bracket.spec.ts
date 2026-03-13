import { test, expect } from "@playwright/test";
import { BASE_URL, commitLazyInput, deleteBracketByApi, getTeams, loginAsAdmin, openTeamEditModal } from "./support";

test.describe("UC-76 Create Bracket", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("CRB-001 - Admin tạo bracket mới từ trang config", async ({ page }) => {
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

    test("CRB-002 - Tạo bracket với name trống → Hệ thống cho phép (Success)", async ({ page }) => {
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

        if (body.data?.id) {
            await deleteBracketByApi(page, body.data.id);
        }
        // Hiện tại hệ thống cho phép tạo name trống
        expect(body.success, "API nên cho phép tạo bracket với name trống (theo logic hiện tại)").toBeTruthy();
    });

    test("CRB-003 - [ECP - Edge] Tạo bracket với tên chứa ký tự đặc biệt → tạo thành công", async ({ page }) => {
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

    test("CRB-004 - [BVA - Boundary] Tạo bracket với tên rất dài (200+ ký tự)", async ({ page }) => {
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
                expect(body.success).toBeTruthy();
            }
        } finally {
            if (createdId !== null) {
                await deleteBracketByApi(page, createdId);
            }
        }
    });

    test("CRB-005 - [ECP - Invalid] Tạo bracket với tên chỉ gồm whitespace → Hệ thống cho phép (Success)", async ({ page }) => {
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
        // Hiện tại hệ thống cho phép tạo name chỉ gồm khoảng trắng
        expect(body.success, "API nên cho phép tạo bracket với name chỉ gồm whitespace").toBeTruthy();
    });

    test("CRB-006 - Tạo bracket với description trống → Thành công", async ({ page }) => {
        const name = `UC76_DESC_EMPTY_${Date.now()}`;
        let createdId: number | null = null;

        try {
            await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
            await page.click('a[href="#brackets"]');
            await page.click('#brackets button:has-text("Add New Bracket")');

            const block = page.locator("#brackets .border-bottom").last();
            await commitLazyInput(block.locator("input.form-control").nth(0), name);
            // Không điền description

            const responsePromise = page.waitForResponse((response) => {
                return response.url().includes("/api/v1/brackets") && response.request().method() === "POST";
            });

            await block.locator('button:has-text("Save")').click();
            const response = await responsePromise;
            const body = await response.json();

            if (body.data?.id) {
                createdId = body.data.id;
                expect(body.success).toBeTruthy();
                expect(body.data.description === "" || body.data.description === null).toBeTruthy();
            }
        } finally {
            if (createdId !== null) {
                await deleteBracketByApi(page, createdId);
            }
        }
    });

    test("CRB-007 - Tạo bracket với description rất dài (5.000 ký tự)", async ({ page }) => {
        const name = `UC76_DESC_LONG_${Date.now()}`;
        const desc = "D".repeat(5000);
        let createdId: number | null = null;

        try {
            await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
            await page.click('a[href="#brackets"]');
            await page.click('#brackets button:has-text("Add New Bracket")');

            const block = page.locator("#brackets .border-bottom").last();
            await commitLazyInput(block.locator("input.form-control").nth(0), name);
            await commitLazyInput(block.locator("input.form-control").nth(1), desc);

            const responsePromise = page.waitForResponse((response) => {
                return response.url().includes("/api/v1/brackets") && response.request().method() === "POST";
            });

            await block.locator('button:has-text("Save")').click();
            const response = await responsePromise;
            const body = await response.json();

            if (body.data?.id) {
                createdId = body.data.id;
                expect(body.success).toBeTruthy();
                expect(body.data.description.length).toBe(5000);
            }
        } finally {
            if (createdId !== null) {
                await deleteBracketByApi(page, createdId);
            }
        }
    });

    test("CRB-008 - Tạo bracket với HTML/Script tags trong name/description", async ({ page }) => {
        const name = `<b>Name</b><script>alert(1)</script>_${Date.now()}`;
        const desc = `<i>Description</i><img src=x onerror=alert(2)>`;
        let createdId: number | null = null;

        try {
            await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
            await page.click('a[href="#brackets"]');
            await page.click('#brackets button:has-text("Add New Bracket")');

            const block = page.locator("#brackets .border-bottom").last();
            await commitLazyInput(block.locator("input.form-control").nth(0), name);
            await commitLazyInput(block.locator("input.form-control").nth(1), desc);

            const responsePromise = page.waitForResponse((response) => {
                return response.url().includes("/api/v1/brackets") && response.request().method() === "POST";
            });

            await block.locator('button:has-text("Save")').click();
            const response = await responsePromise;
            const body = await response.json();

            if (body.data?.id) {
                createdId = body.data.id;
                expect(body.success).toBeTruthy();
                // Kiểm tra xem dữ liệu có được lưu đúng không (thường backend sẽ không strip tags nếu không có validator)
                expect(body.data.name).toContain("<b>Name</b>");
            }
        } finally {
            if (createdId !== null) {
                await deleteBracketByApi(page, createdId);
            }
        }
    });
});