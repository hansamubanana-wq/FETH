// オンライン対戦を「複数人 × 複数ラウンド」通しで回す回帰テスト。
// 報告された症状（レースがもう一度行われる／画面が固まる／重い）を直接見張る。
//
// 見ているもの:
//   1. 各クライアントがベット画面・レース画面・結果画面に入った回数が
//      ラウンド数とぴったり一致すること
//      （多ければ「同じラウンドをやり直した」、少なければ「途中で固まった」）
//   2. 全員が毎ラウンド結果画面まで到達すること
//   3. WebGL資源がラウンドごとに増え続けないこと（＝重くならない）
//   4. ページエラー・consoleエラーが出ないこと
//
// 使い方: python3 -m http.server 8000 を起動した状態で
//   node scripts/verify-online-rounds.mjs [人数] [ラウンド数]
import { chromium } from "playwright";

const URL = "http://localhost:8000/";
const PLAYERS = Number(process.argv[2] || 3);
const ROUNDS = Number(process.argv[3] || 2);
const ROUND_TIMEOUT_MS = 150000;

const browser = await chromium.launch();
const errors = [];

async function mkClient(uid, name) {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${name} console: ${m.text()}`); });

    // 画面遷移の回数と、GLオブジェクトの生存数を数える
    await page.addInitScript(() => {
        window.__gl = { tex: 0, buf: 0 };
        for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
            if (!P) continue;
            const p = P.prototype;
            const wrap = (create, del, key) => {
                const c = p[create], d = p[del];
                p[create] = function (...a) { window.__gl[key]++; return c.apply(this, a); };
                p[del] = function (...a) { if (a[0]) window.__gl[key]--; return d.apply(this, a); };
            };
            wrap("createTexture", "deleteTexture", "tex");
            wrap("createBuffer", "deleteBuffer", "buf");
        }
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

    await page.goto(URL, { waitUntil: "load" });
    await page.evaluate(([u, n]) => {
        localStorage.setItem("keiba_uid", u);
        localStorage.setItem("keiba_name", n);
    }, [uid, name]);
    await page.reload({ waitUntil: "load" });
    await page.evaluate(() => { window.confirm = () => true; });
    return page;
}

async function placeBet(page) {
    await page.waitForSelector("#screen-pick.active", { timeout: ROUND_TIMEOUT_MS });
    await page.locator(".horse-pick").first().click();
    await page.getByRole("button", { name: /単勝/ }).click();
    await page.getByRole("button", { name: /この内容で賭ける/ }).click();
    const end = page.getByRole("button", { name: /ベットを終了/ });
    if (await end.count()) await end.click();
}

const stamp = Date.now().toString(36).slice(-4);
const pages = [];
for (let i = 0; i < PLAYERS; i += 1) {
    pages.push(await mkClient(`rt${stamp}${i}`, i === 0 ? "ホスト" : `参加${i}`));
}
const [host, ...guests] = pages;

await host.getByRole("button", { name: /オンライン/ }).click();
await host.getByRole("button", { name: /部屋を作る/ }).click();
await host.getByRole("button", { name: /部屋を作成/ }).click();
await host.waitForSelector("#screen-lobby.active", { timeout: 30000 });
const code = (await host.locator("#lobby-code").textContent()).trim();

for (const guest of guests) {
    await guest.getByRole("button", { name: /オンライン/ }).click();
    await guest.getByRole("button", { name: /合言葉で参加/ }).click();
    await guest.locator("#join-code").fill(code);
    await guest.getByRole("button", { name: /参加する/ }).last().click();
    await guest.waitForSelector("#screen-lobby.active", { timeout: 30000 });
}
// 全員がロビーで全員を見えているか（＝players サブコレクションの直接購読が効いているか）
await host.waitForSelector(`#lobby-players li:nth-child(${PLAYERS})`, { timeout: 30000 });
const lobbyCounts = [];
for (const page of pages) lobbyCounts.push(await page.locator("#lobby-players li").count());

const glPerRound = [];
await host.getByRole("button", { name: /ゲーム開始/ }).click();

for (let round = 1; round <= ROUNDS; round += 1) {
    await Promise.all(pages.map(placeBet));
    await Promise.all(pages.map((p) => p.waitForSelector("#screen-result.active", { timeout: ROUND_TIMEOUT_MS })));
    glPerRound.push(await Promise.all(pages.map((p) => p.evaluate(() => ({ ...window.__gl })))));
    if (round < ROUNDS) {
        // 結果は10秒で自動的に次ラウンドのベットへ進む
        await Promise.all(pages.map((p) => p.waitForSelector("#screen-pick.active", { timeout: ROUND_TIMEOUT_MS })));
    }
}

const enters = await Promise.all(pages.map((p) => p.evaluate(() => window.__enters)));

// 後片付け（全員退出 → 最後の1人が部屋ごと削除）
for (const page of [...guests, host]) {
    await page.getByRole("button", { name: /退出/ }).first().click().catch(() => {});
    await page.waitForTimeout(500);
}
await host.waitForTimeout(1500);
await browser.close();

const lobbyOk = lobbyCounts.every((n) => n === PLAYERS);
// ラウンド数ぴったりであること。多い=やり直し、少ない=固まった。
const entersOk = enters.every((e) => (
    e["screen-pick"] === ROUNDS && e["screen-race"] === ROUNDS && e["screen-result"] === ROUNDS
));
const first = glPerRound[0];
const last = glPerRound[glPerRound.length - 1];
const glGrowth = last.map((v, i) => ({ tex: v.tex - first[i].tex, buf: v.buf - first[i].buf }));
const glOk = glGrowth.every((g) => g.tex <= 2 && g.buf <= 8);

const ok = lobbyOk && entersOk && glOk && errors.length === 0;
console.log(JSON.stringify({
    code, players: PLAYERS, rounds: ROUNDS,
    lobbyCounts, lobbyOk,
    screenEnters: enters, entersOk,
    glAfterFirstRound: first, glAfterLastRound: last, glGrowth, glOk,
    errors,
}, null, 2));
process.exit(ok ? 0 : 1);
