// オンライン対戦のラウンド進行を、Firestore を差し替えたブラウザ上で検証する。
// 実 Firestore を使わないので、ネットワークのない環境でも実際の src/online.js を通しで動かせる。
//
// 見ている不具合（v0.19.0 で発生）:
//   ホストがベット開始を書き込むと、部屋ドキュメント(phase=betting, round+1)と
//   各プレイヤーの betDone=false が同じバッチで書かれる。しかし両者は別のリスナーで届き、
//   部屋ドキュメントの方が先に来ると、players はまだ前ラウンドの betDone=true のまま。
//   その状態で allBet() を信じると「誰も賭けていないレース」が即座に始まってしまう。
//
// 使い方: python3 -m http.server 8000 を起動した状態で
//   node scripts/verify-online-sync.mjs [ラウンド数] [players の遅延ms]
// 遅延を大きくするほど「部屋だけ先に進んだ」状態が長く続き、条件が厳しくなる。
import { chromium } from "playwright";
import { FAKE_FIRESTORE_SOURCE } from "./fake-firestore.mjs";

const URL = "http://localhost:8000/";
const ROUNDS = Number(process.argv[2] || 2);
const COLLECTION_DELAY_MS = Number(process.argv[3] || 60);
// 第4引数に stale を渡すと、バッチ適用後に古い players が一度配信される状況も再現する
const STALE_ECHO = process.argv[4] === "stale";
const OTHERS = ["sim-a", "sim-b"];
const TIMEOUT = 150000;

const browser = await chromium.launch();
// Service Worker は vendor/firebase を先読みキャッシュしており、
// SW 経由の取得は page.route() で差し替えられない。無効にして必ずスタブを使わせる。
const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 }, serviceWorkers: "block" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });

// Firebase SDK をインメモリ実装に差し替える
for (const name of ["firebase-app.js", "firebase-firestore.js"]) {
    await page.route(`**/vendor/firebase/${name}`, (route) =>
        route.fulfill({ contentType: "application/javascript; charset=utf-8", body: FAKE_FIRESTORE_SOURCE }));
}

// 画面に入った回数を数える
await page.addInitScript(() => {
    window.__enters = { "screen-pick": 0, "screen-race": 0, "screen-result": 0 };
    addEventListener("DOMContentLoaded", () => {
        for (const id of Object.keys(window.__enters)) {
            const el = document.getElementById(id);
            if (!el) continue;
            let was = el.classList.contains("active");
            new MutationObserver(() => {
                const now = el.classList.contains("active");
                if (now && !was) window.__enters[id]++;
                was = now;
            }).observe(el, { attributes: true, attributeFilter: ["class"] });
        }
    });
});

await page.addInitScript(([ms, stale]) => {
    const apply = setInterval(() => {
        if (!window.__fakeDb) return;
        window.__fakeDb.collectionDelayMs = ms;
        window.__fakeDb.staleEcho = stale;
        clearInterval(apply);
    }, 20);
}, [COLLECTION_DELAY_MS, STALE_ECHO]);

await page.goto(URL, { waitUntil: "load" });
await page.evaluate(() => {
    localStorage.setItem("keiba_uid", "sim-host");
    localStorage.setItem("keiba_name", "ホスト");
});
await page.reload({ waitUntil: "load" });
await page.evaluate(() => { window.confirm = () => true; });

await page.getByRole("button", { name: /オンライン/ }).click();
await page.getByRole("button", { name: /部屋を作る/ }).click();
await page.getByRole("button", { name: /部屋を作成/ }).click();
await page.waitForSelector("#screen-lobby.active", { timeout: 30000 });
const code = (await page.locator("#lobby-code").textContent()).trim();
// スタブが使われていることを確認（本物の Firestore を叩いていたら検証にならない）
const usingStub = await page.evaluate(() => !!window.__fakeDb);
if (!usingStub) throw new Error("Firestore スタブが読み込まれていません");

// 他の参加者をストアへ直接追加する（別端末が参加した状態を作る）
await page.evaluate(([roomCode, others]) => {
    const room = window.__fakeDb.store.get(`rooms/${roomCode}`);
    others.forEach((id, i) => {
        window.__fakeDb.write(`rooms/${roomCode}/players/${id}`, {
            name: `参加${i + 1}`, balance: room.funds, betDone: false,
            tickets: [], bankrupt: false, readyNext: false, round: 0,
        });
    });
}, [code, OTHERS]);
await page.waitForSelector("#lobby-players li:nth-child(3)", { timeout: 20000 });

// 他の参加者が「賭け終わった」状態にする（別端末からの書き込み相当）
async function othersBet(round) {
    await page.evaluate(([roomCode, others, r]) => {
        others.forEach((id, i) => {
            window.__fakeDb.write(`rooms/${roomCode}/players/${id}`, {
                betDone: true, round: r, tickets: [{ typeKey: "win", sel: [i], amount: 100 }],
            });
        });
    }, [code, OTHERS, round]);
}

await page.getByRole("button", { name: /ゲーム開始/ }).click();

const observed = [];
for (let round = 1; round <= ROUNDS; round += 1) {
    await page.waitForSelector("#screen-pick.active", { timeout: TIMEOUT });
    // ★ ここが肝：ベット画面が出た時点で、レース画面へ入った回数は
    //    「終わったレースの数」と一致していなければならない。
    //    賭けられないレースが挟まると、この時点で1多くなる。
    const before = await page.evaluate(() => ({ ...window.__enters }));
    observed.push({ round, racesBeforeThisBet: before["screen-race"] });

    await page.locator(".horse-pick").first().click();
    await page.getByRole("button", { name: /単勝/ }).click();
    await page.getByRole("button", { name: /この内容で賭ける/ }).click();
    const end = page.getByRole("button", { name: /ベットを終了/ });
    if (await end.count()) await end.click();
    await othersBet(round);

    await page.waitForSelector("#screen-race.active", { timeout: TIMEOUT });
    await page.waitForSelector("#screen-result.active", { timeout: TIMEOUT });
}

const enters = await page.evaluate(() => window.__enters);
await browser.close();

// 各ラウンドのベット画面に入る前のレース数は 0,1,2,... でなければならない
const phantomRace = observed.some((o, i) => o.racesBeforeThisBet !== i);
const countsOk = enters["screen-pick"] === ROUNDS
    && enters["screen-race"] === ROUNDS
    && enters["screen-result"] === ROUNDS;
const ok = !phantomRace && countsOk && errors.length === 0;

console.log(JSON.stringify({
    rounds: ROUNDS,
    collectionDelayMs: COLLECTION_DELAY_MS,
    staleEcho: STALE_ECHO,
    observed,
    screenEnters: enters,
    phantomRace,
    countsOk,
    errors,
    result: ok ? "OK" : "NG",
}, null, 2));
process.exit(ok ? 0 : 1);
