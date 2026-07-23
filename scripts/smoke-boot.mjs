// 起動スモークテスト: アプリがJSエラーなく起動し、ローカル対戦が
// 馬選択→ベット→レース開始まで進むことを実ブラウザで確認する。
// online.js を作り替えた影響でモジュール読み込みが壊れていないかも兼ねる。
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

await page.goto("http://localhost:8000/", { waitUntil: "load" });
await page.evaluate(() => { window.confirm = () => true; });

// ローカル対戦フロー（Firestore不使用）
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
const raceStarted = await page.locator("#screen-race.active").count() > 0;

// オンラインUIが開けるか（Firestore書き込み手前まで＝権限不要）
await page.goto("http://localhost:8000/", { waitUntil: "load" });
await page.getByRole("button", { name: /オンライン/ }).click();
const onlineHomeOk = await page.locator("#screen-online-home.active").count() > 0;

await browser.close();
console.log(JSON.stringify({ raceStarted, onlineHomeOk, errors }, null, 2));
process.exit(errors.length || !raceStarted || !onlineHomeOk ? 1 : 0);
