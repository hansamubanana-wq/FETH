// 独立検証: (1)外部ドメインへの通信が本当に0件か (2)オフラインでレース完走できるか。
// Codexの verify-offline.mjs とは別に、Claude 側で観測ベースに測り直すためのもの。
import { chromium } from "playwright";

const URL = "http://localhost:8000/";
const EXTERNAL = /unpkg\.com|threejs\.org|gstatic\.com|jsdelivr|cdnjs/;

async function playLocalRace(page) {
    await page.getByRole("button", { name: /ローカル/ }).click();
    await page.getByRole("button", { name: /馬に賭ける/ }).click();
    await page.locator(".horse-pick").first().click();
    await page.getByRole("button", { name: /単勝/ }).click();
    await page.getByRole("button", { name: /この内容で賭ける/ }).click();
    for (let i = 0; i < 4; i++) {
        const btn = page.getByRole("button", { name: /ベットを終了/ });
        if (await btn.count()) { await btn.click(); await page.waitForTimeout(400); }
        if (await page.locator("#screen-race.active").count()) break;
    }
    await page.waitForSelector("#screen-race.active", { timeout: 20000 });
    await page.waitForSelector("#screen-result.active", { timeout: 120000 });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const external = [];
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("request", (r) => { if (EXTERNAL.test(r.url())) external.push(r.url()); });

// --- 1回目: オンライン状態で起動しレース完走（SWをインストールさせる） ---
await page.goto(URL, { waitUntil: "load" });
await page.evaluate(() => { window.confirm = () => true; });
await playLocalRace(page);
const swReady = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return { registered: !!reg, active: !!(reg && reg.active) };
});
// version.js がキャッシュされていないこと（更新バナーが死ぬのを防げているか）
const cacheState = await page.evaluate(async () => {
    const names = await caches.keys();
    let versionCached = false;
    for (const n of names) {
        const c = await caches.open(n);
        if (await c.match(new URL("src/version.js", location.href).href)) versionCached = true;
    }
    return { cacheNames: names, versionCached };
});

// --- 2回目: オフラインにしてリロードし、レースを完走できるか ---
await ctx.setOffline(true);
await page.goto(URL, { waitUntil: "load" });
await page.evaluate(() => { window.confirm = () => true; });
let offlineFinished = false;
let resultRows = 0;
try {
    await playLocalRace(page);
    resultRows = await page.locator("#result-list li").count();
    offlineFinished = true;
} catch (e) {
    errors.push("offline race failed: " + e.message);
}
await ctx.setOffline(false);
await browser.close();

const out = {
    externalRequests: external.length,
    externalSamples: [...new Set(external)].slice(0, 5),
    serviceWorker: swReady,
    cacheNames: cacheState.cacheNames,
    versionJsCached: cacheState.versionCached,
    offlineRaceFinished: offlineFinished,
    offlineResultRows: resultRows,
    errors,
};
console.log(JSON.stringify(out, null, 2));
const ok = external.length === 0 && swReady.active && !cacheState.versionCached
    && offlineFinished && resultRows === 8 && errors.length === 0;
console.log(ok ? "結果: OK" : "結果: NG");
process.exit(ok ? 0 : 1);
