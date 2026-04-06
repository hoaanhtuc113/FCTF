import { test, expect, Page } from "@playwright/test";
import { BASE_URL, createBracket, findConfigBlockByInputValue, getBrackets, getTeams, loginAsAdmin, openTeamEditModal } from "./support";

type TeamBracketTarget = {
    id: number;
    name: string;
    description: string;
    type: "teams";
    createdForTest: boolean;
};

async function hasBracketOptionForTeam(page: Page, bracketId: number) {
    return await page.locator('#team-info-edit-form select[name="bracket_id"] option').evaluateAll((options, id) => {
        return options.some((option) => Number(option.getAttribute("value")) === id);
    }, bracketId);
}

async function ensureExistingTeamBracket(page: Page): Promise<TeamBracketTarget> {
    const existing = (await getBrackets(page)).find((bracket) => bracket.type === "teams" && bracket.name.trim().length > 0);
    if (existing) {
        return {
            id: existing.id,
            name: existing.name,
            description: existing.description,
            type: "teams",
            createdForTest: false,
        };
    }

    const created = await createBracket(page, {
        name: `UC78_TEMP_${Date.now()}`,
        description: "Temporary team bracket for UC78",
        type: "teams",
    });

    return {
        id: created.id,
        name: created.name,
        description: created.description,
        type: "teams",
        createdForTest: true,
    };
}

async function cleanupTempBracketIfExists(page: Page, bracket: TeamBracketTarget) {
    if (!bracket.createdForTest) {
        return;
    }

    const stillExists = (await getBrackets(page)).some((item) => item.id === bracket.id);
    if (!stillExists) {
        return;
    }

    try {
        await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
        await page.click('a[href="#brackets"]');
        await expect(page.locator("#brackets")).toBeVisible();

        const persistedBlock = await findConfigBlockByInputValue(page, "#brackets", bracket.name);
        page.once("dialog", (dialog) => dialog.accept());

        const responsePromise = page.waitForResponse((response) => {
            return response.url().includes(`/api/v1/brackets/${bracket.id}`) && response.request().method() === "DELETE";
        });

        const deleteButton = persistedBlock.locator("button.close");
        await deleteButton.scrollIntoViewIfNeeded();
        await deleteButton.click({ force: true });
        await responsePromise;
    } catch {
        // Best-effort cleanup for temporary data only.
    }
}

test.describe("UC-78 Delete Bracket", () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC78.01 - Admin xóa bracket từ trang config", async ({ page }) => {
        const targetBracket = await ensureExistingTeamBracket(page);
        let deletedTarget = false;
        const targetTeam = (await getTeams(page, 1))[0];

        try {
            await openTeamEditModal(page, targetTeam.id);
            await expect.poll(async () => {
                return await hasBracketOptionForTeam(page, targetBracket.id);
            }, { timeout: 10_000 }).toBeTruthy();

            await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
            await page.click('a[href="#brackets"]');
            await expect(page.locator("#brackets")).toBeVisible();
            const persistedBlock = await findConfigBlockByInputValue(page, "#brackets", targetBracket.name);
            await expect(persistedBlock).toBeVisible();

            page.once("dialog", (dialog) => dialog.accept());
            const responsePromise = page.waitForResponse((response) => {
                return response.url().includes(`/api/v1/brackets/${targetBracket.id}`) && response.request().method() === "DELETE";
            });

            const deleteButton = persistedBlock.locator("button.close");
            await deleteButton.scrollIntoViewIfNeeded();
            await deleteButton.click({ force: true });
            const deleteResponse = await responsePromise;
            expect(deleteResponse.ok(), "DELETE /api/v1/brackets phải trả về HTTP thành công").toBe(true);

            await expect.poll(async () => {
                const brackets = await getBrackets(page);
                return brackets.some((bracket) => bracket.id === targetBracket.id);
            }, { timeout: 10_000 }).toBeFalsy();
            deletedTarget = true;

            await openTeamEditModal(page, targetTeam.id);
            await expect.poll(async () => {
                return await hasBracketOptionForTeam(page, targetBracket.id);
            }, { timeout: 10_000 }).toBeFalsy();
        } finally {
            if (deletedTarget && !targetBracket.createdForTest) {
                await createBracket(page, {
                    name: targetBracket.name,
                    description: targetBracket.description,
                    type: targetBracket.type,
                });
            }

            await cleanupTempBracketIfExists(page, targetBracket);
        }
    });

    test("TC78.02 - Cancel dialog xóa bracket → bracket vẫn tồn tại", async ({ page }) => {
        const targetBracket = await ensureExistingTeamBracket(page);

        try {
            await page.goto(`${BASE_URL}/admin/config`, { waitUntil: "domcontentloaded" });
            await page.click('a[href="#brackets"]');
            await expect(page.locator("#brackets")).toBeVisible();

            const persistedBlock = await findConfigBlockByInputValue(page, "#brackets", targetBracket.name);
            await expect(persistedBlock).toBeVisible();

            page.once("dialog", (dialog) => dialog.dismiss());
            const deleteButton = persistedBlock.locator("button.close");
            await deleteButton.scrollIntoViewIfNeeded();
            await deleteButton.click({ force: true });

            await expect.poll(async () => {
                const brackets = await getBrackets(page);
                return brackets.some((bracket) => bracket.id === targetBracket.id);
            }, { timeout: 10_000 }).toBeTruthy();

            const brackets = await getBrackets(page);
            const found = brackets.find((bracket) => bracket.id === targetBracket.id);
            expect(found, "Bracket phải vẫn tồn tại sau khi cancel dialog").toBeTruthy();
        } finally {
            await cleanupTempBracketIfExists(page, targetBracket);
        }
    });
});