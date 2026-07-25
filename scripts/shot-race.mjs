// レース中の見た目を実ブラウザでキャプチャする（グラフィック確認用）。
// 使い方: node scripts/shot-race.mjs [出力先] [待機秒]
import { chromium } from "playwright";

const out = process.argv[2] || "race-shot.png";
const waitSec = Number(process.argv[3] || 8);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto("http://localhost:8000/", { waitUntil: "load" });
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
await page.waitForTimeout(waitSec * 1000);
await page.screenshot({ path: out });
await browser.close();
console.log("saved:", out);
