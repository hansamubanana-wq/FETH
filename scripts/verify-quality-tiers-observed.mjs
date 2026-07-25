// 品質ティアの独立検証。内部状態(window.__lastRace3D)ではなく
// 「外から観測できる挙動」＝実際に読み込んだテクスチャURLで判定する。
// FPSの絶対値はヘッドレス(ソフトウェア描画)では意味がないため見ない。
import { chromium } from "playwright";

const browser = await chromium.launch();
const results = [];

for (const tier of ["low", "mid", "high"]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const tex = [];
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("request", (r) => {
        const u = r.url();
        if (u.includes("/assets/art/tex/")) tex.push(u.split("/assets/art/")[1]);
    });

    await page.goto("http://localhost:8000/", { waitUntil: "load" });
    // 設定UIから選択 → リロードして永続化を確認
    await page.selectOption("#graphics-quality", tier);
    await page.reload({ waitUntil: "load" });
    const persisted = await page.$eval("#graphics-quality", (el) => el.value);
    await page.evaluate(() => { window.confirm = () => true; });

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
    await page.waitForTimeout(4000);

    const uniq = [...new Set(tex)].sort();
    results.push({
        tier,
        persistedSelection: persisted,
        half: uniq.filter((u) => u.includes("half/")).length,
        full: uniq.filter((u) => !u.includes("half/")).length,
        skyPanorama: uniq.filter((u) => u.includes("sky-")).length,
        requests: uniq,
        errors,
    });
    await ctx.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));

const low = results.find((r) => r.tier === "low");
const high = results.find((r) => r.tier === "high");
const checks = {
    設定が永続化される: results.every((r) => r.persistedSelection === r.tier),
    エラーなし: results.every((r) => r.errors.length === 0),
    低は半解像度を使う: low.half > 0 && low.full === 0,
    低は空パノラマを読まない: low.skyPanorama === 0,
    高は原寸を使う: high.full > 0 && high.half === 0,
};
console.log(checks);
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
