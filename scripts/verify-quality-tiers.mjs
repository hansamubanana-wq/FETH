import { chromium } from "playwright";

const URL = "http://localhost:8000/";
const browser = await chromium.launch();
const results = {};

async function enterRace(page) {
    await page.goto(URL, { waitUntil: "load" });
    await page.evaluate(() => { window.confirm = () => true; });
    await page.getByRole("button", { name: /ローカル/ }).click();
    await page.getByRole("button", { name: /馬に賭ける/ }).click();
    await page.locator(".horse-pick").first().click();
    await page.getByRole("button", { name: /単勝/ }).click();
    await page.getByRole("button", { name: /この内容で賭ける/ }).click();
    for (let i = 0; i < 4; i++) {
        const button = page.getByRole("button", { name: /ベットを終了/ });
        if (await button.count()) await button.click();
        if (await page.locator("#screen-race.active").count()) break;
        await page.waitForTimeout(250);
    }
    await page.waitForSelector("#screen-race.active");
    await page.waitForFunction(() => window.__lastRace3D?.ready);
}

for (const tier of ["low", "mid", "high"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(URL);
    await page.evaluate((value) => localStorage.setItem("feth.graphicsQuality", value), tier);
    await enterRace(page);
    await page.waitForFunction(() => window.__lastRace3D?.performanceHistory.length > 0, null, { timeout: 15000 });
    results[tier] = await page.evaluate(() => window.__lastRace3D.getQualityReport());
    await page.close();
}

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL);
await page.evaluate(() => localStorage.setItem("feth.graphicsQuality", "auto"));
await enterRace(page);
const adjustment = await page.evaluate(() => {
    const renderer = window.__lastRace3D;
    renderer._applyQualityTier("high", { reason: "verification-start" });
    renderer.autoAdjuster.tier = "high";
    const states = [{ input: "start", tier: renderer.qualityTier }];
    renderer.autoAdjuster.observe(20);
    states.push({ input: "20fps", tier: renderer.qualityTier });
    renderer.autoAdjuster.observe(55);
    states.push({ input: "55fps x1", tier: renderer.qualityTier });
    renderer.autoAdjuster.observe(55);
    states.push({ input: "55fps x2", tier: renderer.qualityTier });
    renderer.autoAdjuster.observe(55);
    renderer.autoAdjuster.observe(55);
    states.push({ input: "55fps x4", tier: renderer.qualityTier });
    return { states, report: renderer.getQualityReport() };
});
await browser.close();

console.log(JSON.stringify({ tiers: results, adjustment }, null, 2));
