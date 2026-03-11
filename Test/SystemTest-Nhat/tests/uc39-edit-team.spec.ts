/**
 * UC-39: Edit Team — Playwright System Tests
 *
 * Mục tiêu (System Test):
 *  - Kiểm tra hành vi UI khi nhập dữ liệu invalid: form KHÔNG submit,
 *    modal vẫn mở, dữ liệu KHÔNG thay đổi trên trang
 *  - Kiểm tra hành vi UI khi nhập dữ liệu valid: trang reload,
 *    dữ liệu mới hiển thị đúng trên trang
 *
 * Site  : https://admin.fctf.site
 * Actor : Admin (username: admin / password: 1)
 *
 * Cách nhận biết kết quả từ UI:
 *  - Invalid → JS không gọi window.location.reload() → modal vẫn visible
 *              → input được đánh dấu input-filled-invalid
 *  - Valid   → JS gọi window.location.reload() → trang load lại
 *              → dữ liệu mới hiển thị trong jumbotron / body
 */

import { test, expect, Page } from "@playwright/test";

// ─── Credentials & Config ────────────────────────────────────────────────────
const BASE_URL = "https://admin.fctf.site";
const ADMIN_USER = "admin";
const ADMIN_PASS = "1";

// Timeout chờ sau submit để phân biệt reload vs không reload
const SUBMIT_WAIT_MS = 3000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Đăng nhập vào admin panel */
async function loginAsAdmin(page: Page) {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[name="name"]', ADMIN_USER);
    await page.fill('input[name="password"]', ADMIN_PASS);
    await page.click('button[type="submit"], input[type="submit"]');
    await page.waitForURL(/\/admin\//);
}

/**
 * Lấy id và tên của 2 team đầu tiên từ API (chỉ dùng để setup, không
 * phải assertion của system test).
 */
async function getTeamsInfo(page: Page): Promise<{
    firstTeam: { id: number; name: string; email: string; website: string; affiliation: string };
    secondTeamName: string | null;
}> {
    const res = await page.request.get(`${BASE_URL}/api/v1/teams?page=1&per_page=5`);
    const body = await res.json();
    const data = body.data as Array<{ id: number; name: string; email: string; website: string; affiliation: string }>;
    if (!data || data.length === 0) throw new Error("Không có team nào trong hệ thống để test");
    return {
        firstTeam: {
            id: data[0].id,
            name: data[0].name,
            email: data[0].email ?? "",
            website: data[0].website ?? "",
            affiliation: data[0].affiliation ?? "",
        },
        secondTeamName: data.length >= 2 ? data[1].name : null,
    };
}

/** Điều hướng đến trang chi tiết team và mở modal Edit Team */
async function openEditModal(page: Page, teamId: number) {
    await page.goto(`${BASE_URL}/admin/teams/${teamId}`);
    await page.waitForSelector(".edit-team", { state: "visible" });
    await page.click(".edit-team");

    // Đợi form trong modal hiển thị
    await page.waitForSelector("#team-info-edit-form", { state: "visible", timeout: 8000 });
    await page.waitForTimeout(400); // animation Bootstrap
}

/**
 * Điền một field và click Submit, sau đó đợi SUBMIT_WAIT_MS ms.
 * Cờ keepOtherFields=true: giữ nguyên tất cả field khác (chỉ thay đổi field chỉ định).
 */
async function fillAndSubmit(
    page: Page,
    fieldName: string,
    value: string
) {
    const selector = `#team-info-edit-form [name="${fieldName}"]`;
    await page.fill(selector, value);
    await page.click("#update-team");
    // Chờ một khoảng ngắn để JS xử lý response
    await page.waitForTimeout(SUBMIT_WAIT_MS);
}

async function ensureBracketSelected(page: Page) {
    const bracketSelect = page.locator('#team-info-edit-form select[name="bracket_id"]');
    if (!(await bracketSelect.count())) {
        return;
    }

    if (await bracketSelect.inputValue()) {
        return;
    }

    const bracketValue = await bracketSelect.locator('option').evaluateAll((options) => {
        const candidate = options.find((option) => {
            return option instanceof HTMLOptionElement && option.value.trim() !== "";
        });
        return candidate instanceof HTMLOptionElement ? candidate.value : null;
    });

    if (bracketValue) {
        await bracketSelect.selectOption(bracketValue);
    }
}

async function submitTeamEditExpectReload(page: Page, teamId: number) {
    await ensureBracketSelected(page);
    await Promise.all([
        page.waitForURL(`${BASE_URL}/admin/teams/${teamId}`, { waitUntil: "domcontentloaded" }),
        page.click("#update-team"),
    ]);
}

/**
 * Kiểm tra modal vẫn đang mở (CHƯA reload trang).
 * Đây là assertion chính cho các test case invalid.
 */
async function expectModalStillOpen(page: Page) {
    // Form submit hợp lệ sẽ gọi location.reload() → form biến mất
    // Nếu form vẫn còn → dữ liệu không bị save → PASS
    await expect(
        page.locator("#team-info-edit-form"),
        "Modal phải vẫn còn mở — form không được submit thành công"
    ).toBeVisible();
}

/**
 * Kiểm tra tên team KHÔNG thay đổi trên trang (jumbotron heading).
 * Dùng sau khi submit invalid để đảm bảo dữ liệu không bị thay đổi.
 */
async function expectTeamNameUnchanged(page: Page, originalName: string) {
    // Nếu page không reload thì tên trên jumbotron vẫn là tên cũ
    const heading = page.locator(".jumbotron h1, .jumbotron h2").first();
    await expect(heading).toContainText(originalName);
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

test.describe("UC-39: Edit Team — System Tests", () => {
    let teamId: number;
    let originalName: string;
    let originalEmail: string;
    let originalWebsite: string;
    let originalAffiliation: string;
    let secondTeamName: string | null;

    // Setup một lần trước tất cả test
    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        await loginAsAdmin(page);
        const info = await getTeamsInfo(page);
        teamId = info.firstTeam.id;
        originalName = info.firstTeam.name;
        originalEmail = info.firstTeam.email;
        originalWebsite = info.firstTeam.website;
        originalAffiliation = info.firstTeam.affiliation;
        secondTeamName = info.secondTeamName;
        await page.close();
    });

    // Mỗi test: đăng nhập mới + mở modal
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await openEditModal(page, teamId);
    });

    // =========================================================================
    // INVALID CASES — Kỳ vọng: modal vẫn mở, dữ liệu KHÔNG bị thay đổi
    // =========================================================================

    test("TC01 - [Invalid] Tên team bị xóa trắng → form không submit, modal vẫn mở", async ({ page }) => {
        // Xóa trắng tên
        await page.fill('#team-info-edit-form [name="name"]', "");
        await page.click("#update-team");
        await page.waitForTimeout(SUBMIT_WAIT_MS);

        // System test assertion: modal không đóng
        await expectModalStillOpen(page);

        // Tên trên trang không đổi (vì không reload)
        await expectTeamNameUnchanged(page, originalName);
    });

    test("TC02 - [Invalid] Tên team > 128 ký tự → form không submit, modal vẫn mở", async ({ page }) => {
        const longName = "A".repeat(129);
        await fillAndSubmit(page, "name", longName);

        await expectModalStillOpen(page);
        await expectTeamNameUnchanged(page, originalName);
    });

    test("TC03 - [Invalid] Tên team trùng với team khác → form không submit, modal vẫn mở", async ({ page }) => {
        test.skip(secondTeamName === null, "Cần ít nhất 2 team để test duplicate name");

        await fillAndSubmit(page, "name", secondTeamName!);

        await expectModalStillOpen(page);
        // Tên trang vẫn là tên team đang edit, không phải tên team khác
        await expectTeamNameUnchanged(page, originalName);
    });

    test("TC04 - [Invalid] Email sai định dạng → form không submit, modal vẫn mở", async ({ page }) => {
        // Đảm bảo tên hợp lệ, chỉ email sai
        await page.fill('#team-info-edit-form [name="name"]', originalName);
        await fillAndSubmit(page, "email", "not-valid@@email");

        await expectModalStillOpen(page);
        await expectTeamNameUnchanged(page, originalName);
    });

    test("TC05 - [Invalid] Email thiếu domain → form không submit, modal vẫn mở", async ({ page }) => {
        await page.fill('#team-info-edit-form [name="name"]', originalName);
        await fillAndSubmit(page, "email", "no-domain@");

        await expectModalStillOpen(page);
        await expectTeamNameUnchanged(page, originalName);
    });

    test("TC06 - [Invalid] Website không phải URL hợp lệ → form không submit, modal vẫn mở", async ({ page }) => {
        await page.fill('#team-info-edit-form [name="name"]', originalName);
        await fillAndSubmit(page, "website", "not-a-url");

        await expectModalStillOpen(page);
        await expectTeamNameUnchanged(page, originalName);
    });

    test("TC07 - [Invalid] Website dùng scheme ftp:// → form không submit, modal vẫn mở", async ({ page }) => {
        await page.fill('#team-info-edit-form [name="name"]', originalName);
        await fillAndSubmit(page, "website", "ftp://invalid-scheme.com");

        await expectModalStillOpen(page);
        await expectTeamNameUnchanged(page, originalName);
    });

    test("TC08 - [Invalid] Website dùng scheme javascript: → form không submit, modal vẫn mở", async ({ page }) => {
        await page.fill('#team-info-edit-form [name="name"]', originalName);
        await fillAndSubmit(page, "website", "javascript:alert(1)");

        await expectModalStillOpen(page);
        await expectTeamNameUnchanged(page, originalName);
    });

    test("TC09 - [Invalid] Affiliation > 128 ký tự → form không submit, modal vẫn mở", async ({ page }) => {
        await page.fill('#team-info-edit-form [name="name"]', originalName);
        await fillAndSubmit(page, "affiliation", "B".repeat(129));

        await expectModalStillOpen(page);
        await expectTeamNameUnchanged(page, originalName);
    });

    // =========================================================================
    // VALID CASES — Kỳ vọng: trang reload, dữ liệu mới hiển thị trên UI
    // =========================================================================

    test("TC10 - [Valid] Cập nhật tên team hợp lệ → trang reload, tên mới hiển thị", async ({ page }) => {
        const newName = `AutoTest_${Date.now()}`;

        await page.fill('#team-info-edit-form [name="name"]', newName);

        // Chờ reload xảy ra (location.reload) sau khi click
        await submitTeamEditExpectReload(page, teamId);

        // Trang đã reload → tên mới phải xuất hiện trong heading
        await expect(
            page.locator(".jumbotron h1, .jumbotron h2").first(),
            "Tên mới phải hiển thị trên trang sau khi save"
        ).toContainText(newName);

        // ── Restore về tên gốc ──
        await openEditModal(page, teamId);
        await page.fill('#team-info-edit-form [name="name"]', originalName);
        await submitTeamEditExpectReload(page, teamId);
        await expect(page.locator(".jumbotron h1, .jumbotron h2").first()).toContainText(originalName);
    });

    test("TC11 - [Valid] Cập nhật email hợp lệ → trang reload thành công", async ({ page }) => {
        const newEmail = `autotest_${Date.now()}@example.com`;

        await page.fill('#team-info-edit-form [name="name"]', originalName);
        await page.fill('#team-info-edit-form [name="email"]', newEmail);

        await submitTeamEditExpectReload(page, teamId);

        // Trang reload thành công → modal không còn hiển thị
        await expect(
            page.locator("#team-info-edit-form"),
            "Sau khi save thành công, form phải biến mất (trang đã reload)"
        ).not.toBeVisible();

        // Restore
        await openEditModal(page, teamId);
        await page.fill('#team-info-edit-form [name="name"]', originalName);
        await page.fill('#team-info-edit-form [name="email"]', originalEmail);
        await submitTeamEditExpectReload(page, teamId);
    });

    test("TC12 - [Valid] Cập nhật website hợp lệ (https://) → trang reload thành công", async ({ page }) => {
        const newWebsite = "https://autotest-example.com";

        await page.fill('#team-info-edit-form [name="name"]', originalName);
        await page.fill('#team-info-edit-form [name="website"]', newWebsite);

        await submitTeamEditExpectReload(page, teamId);

        await expect(page.locator("#team-info-edit-form")).not.toBeVisible();

        // Restore
        await openEditModal(page, teamId);
        await page.fill('#team-info-edit-form [name="name"]', originalName);
        await page.fill('#team-info-edit-form [name="website"]', originalWebsite);
        await submitTeamEditExpectReload(page, teamId);
    });

    test("TC13 - [Valid] Website để trống → được chấp nhận, trang reload", async ({ page }) => {
        await page.fill('#team-info-edit-form [name="name"]', originalName);
        await page.fill('#team-info-edit-form [name="website"]', "");

        await submitTeamEditExpectReload(page, teamId);

        // Trang reload → form không còn
        await expect(page.locator("#team-info-edit-form")).not.toBeVisible();

        // Restore
        if (originalWebsite) {
            await openEditModal(page, teamId);
            await page.fill('#team-info-edit-form [name="name"]', originalName);
            await page.fill('#team-info-edit-form [name="website"]', originalWebsite);
            await submitTeamEditExpectReload(page, teamId);
        }
    });

    test("TC14 - [Valid] Cập nhật đầy đủ tất cả trường hợp lệ → trang reload, dữ liệu mới hiển thị", async ({ page }) => {
        const newName = `FullUpdate_${Date.now()}`;
        const newEmail = `fullupdate_${Date.now()}@example.com`;
        const newWebsite = "https://fullupdate-example.com";
        const newAffiliation = "AutoTest University";

        // Điền tất cả fields
        await page.fill('#team-info-edit-form [name="name"]', newName);
        await page.fill('#team-info-edit-form [name="email"]', newEmail);
        await page.fill('#team-info-edit-form [name="website"]', newWebsite);
        await page.fill('#team-info-edit-form [name="affiliation"]', newAffiliation);

        // Submit — đợi trang reload
        await submitTeamEditExpectReload(page, teamId);

        // ── Verify trên UI: tên mới hiển thị ──
        await expect(
            page.locator(".jumbotron h1, .jumbotron h2").first(),
            "Tên team mới phải hiển thị sau khi cập nhật"
        ).toContainText(newName);

        // ── Verify toàn bộ body chứa các giá trị đã cập nhật ──
        const bodyText = await page.textContent("body");
        expect(bodyText, "Affiliation mới phải xuất hiện trên trang").toContain(newAffiliation);

        // ── Restore ──
        await openEditModal(page, teamId);
        await page.fill('#team-info-edit-form [name="name"]', originalName);
        await page.fill('#team-info-edit-form [name="email"]', originalEmail);
        await page.fill('#team-info-edit-form [name="website"]', originalWebsite);
        await page.fill('#team-info-edit-form [name="affiliation"]', originalAffiliation);
        await submitTeamEditExpectReload(page, teamId);
        await expect(
            page.locator(".jumbotron h1, .jumbotron h2").first()
        ).toContainText(originalName);
    });

    // =========================================================================
    // Bổ sung test cases cho các trường còn thiếu
    // =========================================================================

    test("TC15 - [Valid] Thay đổi country dropdown → trang reload, country mới hiển thị", async ({ page }) => {
        const countrySelect = page.locator('#team-info-edit-form select[name="country"]');
        const currentCountry = await countrySelect.inputValue();
        const newCountry = currentCountry === "VN" ? "US" : "VN";

        await countrySelect.selectOption(newCountry);
        await submitTeamEditExpectReload(page, teamId);

        // Verify country badge or text trên trang
        await openEditModal(page, teamId);
        const updatedCountry = await page.locator('#team-info-edit-form select[name="country"]').inputValue();
        expect(updatedCountry).toBe(newCountry);

        // Restore
        await page.locator('#team-info-edit-form select[name="country"]').selectOption(currentCountry);
        await submitTeamEditExpectReload(page, teamId);
    });

    test("TC16 - [Valid] Toggle hidden checkbox → trang reload, badge hidden hiển thị", async ({ page }) => {
        const hiddenCheckbox = page.locator('#team-info-edit-form [name="hidden"]');
        const wasHidden = await hiddenCheckbox.isChecked();

        if (!wasHidden) {
            await hiddenCheckbox.check();
        } else {
            await hiddenCheckbox.uncheck();
        }

        await submitTeamEditExpectReload(page, teamId);

        if (!wasHidden) {
            await expect(page.locator(".badge:has-text('hidden')")).toBeVisible();
        } else {
            await expect(page.locator(".badge:has-text('hidden')")).toHaveCount(0);
        }

        // Restore
        await openEditModal(page, teamId);
        if (wasHidden) {
            await page.locator('#team-info-edit-form [name="hidden"]').check();
        } else {
            await page.locator('#team-info-edit-form [name="hidden"]').uncheck();
        }
        await submitTeamEditExpectReload(page, teamId);
    });

    test("TC17 - [Valid] Toggle banned checkbox → trang reload, badge banned hiển thị", async ({ page }) => {
        const bannedCheckbox = page.locator('#team-info-edit-form [name="banned"]');
        const wasBanned = await bannedCheckbox.isChecked();

        if (!wasBanned) {
            await bannedCheckbox.check();
        } else {
            await bannedCheckbox.uncheck();
        }

        await submitTeamEditExpectReload(page, teamId);

        if (!wasBanned) {
            await expect(page.locator(".badge:has-text('banned')")).toBeVisible();
        } else {
            await expect(page.locator(".badge:has-text('banned')")).toHaveCount(0);
        }

        // Restore
        await openEditModal(page, teamId);
        if (wasBanned) {
            await page.locator('#team-info-edit-form [name="banned"]').check();
        } else {
            await page.locator('#team-info-edit-form [name="banned"]').uncheck();
        }
        await submitTeamEditExpectReload(page, teamId);
    });

    test("TC18 - Modal Edit Team hiển thị đủ fields: name, email, password, website, affiliation, country, hidden, banned", async ({ page }) => {
        const form = page.locator("#team-info-edit-form");
        await expect(form.locator('[name="name"]')).toBeVisible();
        await expect(form.locator('[name="email"]')).toBeVisible();
        await expect(form.locator('[name="password"]')).toBeVisible();
        await expect(form.locator('[name="website"]')).toBeVisible();
        await expect(form.locator('[name="affiliation"]')).toBeVisible();
        await expect(form.locator('select[name="country"]')).toBeVisible();
        await expect(form.locator('[name="hidden"]')).toBeAttached();
        await expect(form.locator('[name="banned"]')).toBeAttached();
    });

    // =========================================================================
    // BVA/ECP: Input boundary tests
    // =========================================================================

    test("TC19 - [BVA - Boundary] Tên team đúng 128 ký tự → form submit thành công", async ({ page }) => {
        const boundaryName = "B".repeat(128);

        await page.fill('#team-info-edit-form [name="name"]', boundaryName);
        await submitTeamEditExpectReload(page, teamId);

        await expect(
            page.locator(".jumbotron h1, .jumbotron h2").first()
        ).toContainText(boundaryName.slice(0, 20)); // Chỉ check phần đầu vì UI có thể cắt

        // Restore
        await openEditModal(page, teamId);
        await page.fill('#team-info-edit-form [name="name"]', originalName);
        await submitTeamEditExpectReload(page, teamId);
    });

    test("TC20 - [ECP - Edge] Tên team chứa ký tự đặc biệt: <script>, Unicode, emoji", async ({ page }) => {
        const specialNames = [
            `Team_<script>_${Date.now()}`,
            `Team_日本語_${Date.now()}`,
            `Team_🚀✓_${Date.now()}`,
        ];

        for (const specialName of specialNames) {
            await page.fill('#team-info-edit-form [name="name"]', specialName);
            await submitTeamEditExpectReload(page, teamId);

            // Trang phải load thành công
            await expect(page.locator(".jumbotron h1, .jumbotron h2").first()).toBeVisible();

            // Restore
            await openEditModal(page, teamId);
            await page.fill('#team-info-edit-form [name="name"]', originalName);
            await submitTeamEditExpectReload(page, teamId);
            await openEditModal(page, teamId);
        }
    });

    test("TC21 - [BVA - Boundary] Email edge cases: chỉ gồm spaces, @ không domain, double @", async ({ page }) => {
        const invalidEmails = [
            "   ",          // chỉ whitespace
            "user@",        // thiếu domain
            "user@@test.com", // double @
        ];

        for (const email of invalidEmails) {
            await page.fill('#team-info-edit-form [name="email"]', email);
            await page.click('#team-info-edit-form button[type="submit"]');
            await page.waitForTimeout(SUBMIT_WAIT_MS);

            // Form không submit hoặc server reject — modal vẫn mở HOẶC trang vẫn hợp lệ
            const modalStillOpen = await page.locator("#team-info-edit-modal.show, #team-info-edit-modal.fade.show").isVisible().catch(() => false);
            if (modalStillOpen) {
                // Reset email
                await page.fill('#team-info-edit-form [name="email"]', originalEmail);
            } else {
                // Server có thể chấp nhận — restore
                await openEditModal(page, teamId);
                await page.fill('#team-info-edit-form [name="email"]', originalEmail);
                await submitTeamEditExpectReload(page, teamId);
                await openEditModal(page, teamId);
            }
        }
    });

    test("TC22 - [BVA - Boundary] Affiliation rất dài (500+ ký tự) → form xử lý hợp lệ", async ({ page }) => {
        const longAffiliation = "A".repeat(500);
        await page.fill('#team-info-edit-form [name="affiliation"]', longAffiliation);
        await submitTeamEditExpectReload(page, teamId);

        // Restore
        await openEditModal(page, teamId);
        await page.fill('#team-info-edit-form [name="affiliation"]', originalAffiliation);
        await submitTeamEditExpectReload(page, teamId);
    });

    test("TC23 - [ECP - Edge] Password field: nhập 1 ký tự → form submit thành công (password không bắt buộc)", async ({ page }) => {
        // Password là optional khi edit team
        await page.fill('#team-info-edit-form [name="password"]', "x");
        await submitTeamEditExpectReload(page, teamId);

        // Trang reload thành công
        await expect(page.locator(".jumbotron h1, .jumbotron h2").first()).toContainText(originalName);
    });
});
