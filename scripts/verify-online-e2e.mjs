// オンライン対戦のE2E機能テスト（実ブラウザ2人・実Firestore）。
// ホスト集約+summary配信に作り替えた後、実際のUIを通して
// ロビー相互表示→ベット→レース→結果まで同期が成立するかを確認する。
// 負荷スクリプトはFirestore直書きなので、UI経由の描画はこちらで担保する。
import { chromium } from "playwright";

const URL = "http://localhost:8000/";
const browser = await chromium.launch();
const errors = [];

async function mkClient(uid, name) {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${name} console: ${m.text()}`); });
    await page.goto(URL, { waitUntil: "load" });
    await page.evaluate(([u, n]) => {
        localStorage.setItem("keiba_uid", u);
        localStorage.setItem("keiba_name", n);
        window.confirm = () => true;
    }, [uid, name]);
    await page.reload({ waitUntil: "load" });
    await page.evaluate(() => { window.confirm = () => true; });
    return page;
}

const host = await mkClient("e2ehost01", "ホスト太郎");
const guest = await mkClient("e2eguest02", "ゲスト花子");

// ホストが部屋作成
await host.getByRole("button", { name: /オンライン/ }).click();
await host.getByRole("button", { name: /部屋を作る/ }).click();
await host.getByRole("button", { name: /部屋を作成/ }).click();
await host.waitForSelector("#screen-lobby.active", { timeout: 20000 });
const code = (await host.locator("#lobby-code").textContent()).trim();

// ゲストが合言葉で参加
await guest.getByRole("button", { name: /オンライン/ }).click();
await guest.getByRole("button", { name: /合言葉で参加/ }).click();
await guest.locator("#join-code").fill(code);
await guest.getByRole("button", { name: /^参加する$|参加する/ }).last().click();
await guest.waitForSelector("#screen-lobby.active", { timeout: 20000 });

// 相互にロビーで2人見えるか（=summary/購読が両方向で機能）
await host.waitforSelector?.("#lobby-players li:nth-child(2)", { timeout: 15000 }).catch(() => {});
const hostSeesTwo = await host.locator("#lobby-players li").count();
const guestSeesTwo = await guest.locator("#lobby-players li").count();

// ホストがゲーム開始→両者ベット→両者レース→結果まで到達するか
await host.getByRole("button", { name: /ゲーム開始/ }).click();
for (const [p, nm] of [[host, "host"], [guest, "guest"]]) {
    await p.waitForSelector("#screen-pick.active", { timeout: 20000 });
    await p.locator(".horse-pick").first().click();
    await p.getByRole("button", { name: /単勝/ }).click();
    await p.getByRole("button", { name: /この内容で賭ける/ }).click();
    const end = p.getByRole("button", { name: /ベットを終了/ });
    if (await end.count()) await end.click();
}
let hostResult = false, guestResult = false;
try { await host.waitForSelector("#screen-result.active", { timeout: 60000 }); hostResult = true; } catch {}
try { await guest.waitForSelector("#screen-result.active", { timeout: 60000 }); guestResult = true; } catch {}

// 後片付け（両者退出→部屋削除）
await guest.getByRole("button", { name: /退出/ }).first().click().catch(() => {});
await host.getByRole("button", { name: /退出/ }).first().click().catch(() => {});
await host.waitForTimeout(1500);

await browser.close();
const ok = hostSeesTwo >= 2 && guestSeesTwo >= 2 && hostResult && guestResult && errors.length === 0;
console.log(JSON.stringify({ code, hostSeesTwo, guestSeesTwo, hostResult, guestResult, errors }, null, 2));
process.exit(ok ? 0 : 1);
