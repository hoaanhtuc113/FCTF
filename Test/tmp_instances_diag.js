const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto('https://contestant0.fctf.site/login', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
    });
    await page.locator("input[placeholder='input username...']").fill('user22');
    await page.locator("input[placeholder='enter_password']").fill('1');
    await page.locator("button[type='submit']").click();
    await page.waitForTimeout(3000);

    await page.goto('https://contestant0.fctf.site/instances', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
    });
    await page.waitForTimeout(3000);

    const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
    const headings = await page.locator('h1, h2, h3').allInnerTexts();
    const buttons = await page.locator('button').allInnerTexts();

    console.log('URL=', page.url());
    console.log('HEADINGS=', JSON.stringify(headings));
    console.log('HAS_REFRESH=', buttons.some((b) => /refresh/i.test(b)));
    console.log('HAS_STOP=', buttons.some((b) => /stop/i.test(b)));
    console.log('BODY_SNIPPET=', bodyText.slice(0, 500));

    await browser.close();
})();
