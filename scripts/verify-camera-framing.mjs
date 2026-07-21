// 動的カメラの「全馬が常に画面内」検証。
// レースを実ブラウザで走らせ、毎フレーム全馬を正規化デバイス座標へ投影して
// 画面外(|x|>1 または |y|>1)に出た回数を数える。
// 使い方: node scripts/verify-camera-framing.mjs [レース数]
import { chromium } from "playwright";

const RACES = Number(process.argv[2] || 2);
const URL = "http://localhost:8000/";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const results = [];
for (let r = 0; r < RACES; r++) {
    await page.goto(URL, { waitUntil: "load" });
    await page.evaluate(() => { window.__raceLog = []; window.confirm = () => true; });

    // ホーム → ローカル → ベット画面
    await page.getByRole("button", { name: /ローカル/ }).click();
    await page.getByRole("button", { name: /馬に賭ける/ }).click();
    // 馬を1頭選ぶ → 単勝 → 確定
    await page.locator(".horse-pick").first().click();
    await page.getByRole("button", { name: /単勝/ }).click();
    await page.getByRole("button", { name: /この内容で賭ける/ }).click();
    // 全プレイヤー分ベットを終了してレースへ
    for (let i = 0; i < 4; i++) {
        const btn = page.getByRole("button", { name: /ベットを終了/ });
        if (await btn.count()) { await btn.click(); await page.waitForTimeout(400); }
        if (await page.locator("#screen-race.active").count()) break;
    }
    await page.waitForSelector("#screen-race.active", { timeout: 15000 });

    // レース終了(結果画面)まで待つ
    await page.waitForSelector("#screen-result.active", { timeout: 120000 });

    const stat = await page.evaluate(() => {
        const L = window.__raceLog || [];
        const fin = L.filter((x) => x.p >= 0.72 && x.p <= 1.0);
        const sum = (a, x) => a + x.o;
        return {
            frames: L.length,
            maxProgress: L.length ? Math.max(...L.map((x) => x.p)) : 0,
            frameOutTotal: L.reduce(sum, 0),
            worstNdc: L.length ? Math.max(...L.map((x) => x.w)) : 0,
            finalFrames: fin.length,
            finalFrameOut: fin.reduce(sum, 0),
            finalWorstNdc: fin.length ? Math.max(...fin.map((x) => x.w)) : 0,
            cameraOffsetYRange: L.length ? [Math.min(...L.map((x) => x.oy)), Math.max(...L.map((x) => x.oy))] : [],
            viewHeightRange: L.length ? [Math.min(...L.map((x) => x.vh)), Math.max(...L.map((x) => x.vh))] : [],
        };
    });
    results.push(stat);
    console.log(`race ${r + 1}:`, JSON.stringify(stat));
}

await browser.close();

const totalOut = results.reduce((a, x) => a + x.frameOutTotal, 0);
const worst = Math.max(...results.map((x) => x.worstNdc));
console.log("\n=== 判定 ===");
console.log(`フレームアウト合計: ${totalOut}`);
console.log(`画面端からの最悪値(1.0で画面端): ${worst.toFixed(3)}`);
console.log(`ページエラー: ${errors.length ? errors.join(" / ") : "なし"}`);
if (totalOut > 0 || errors.length) {
    console.log("結果: NG");
    process.exit(1);
}
console.log("結果: OK");
