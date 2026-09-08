// Service Worker の更新が「1回のリロードで実際に反映されるか」を検証する。
//
// ここが壊れていると、いくら修正をデプロイしても利用者の端末では
// 古いキャッシュが配信され続け、「直っていない」ことになる。
// 実際 v0.19.2 以前は controllerchange でのリロードが無く、
// 更新バナーを押しても最初のリロードでは前のビルドが動いたままだった。
//
// 使い方: node scripts/verify-sw-update.mjs
// （このスクリプトはリポジトリを一時ディレクトリへ複製し、自前でサーバーを立てる）
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { cpSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 8123;
const root = mkdtempSync(join(tmpdir(), "feth-sw-"));
cpSync(process.cwd(), root, {
    recursive: true,
    filter: (src) => !/(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(src),
});

const server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: root, stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1200);

const readBuild = (page) => page.evaluate(async () => {
    const mod = await import("./src/version.js?probe=" + Date.now());
    return mod.APP_BUILD;
});

let outcome;
const browser = await chromium.launch();
try {
    const context = await browser.newContext();
    const page = await context.newPage();
    let navigations = 0;
    page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations += 1; });

    // 1回目: Service Worker を登録させる
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: "load" });
    await page.evaluate(() => navigator.serviceWorker.ready);
    const before = (readFileSync(join(root, "src/version.js"), "utf8").match(/APP_BUILD = (\d+)/) || [])[1];
    const navsAfterInstall = navigations;

    // 新しいビルドをデプロイしたことにする
    const next = Number(before) + 1;
    for (const file of ["src/version.js", "sw.js"]) {
        const p = join(root, file);
        writeFileSync(p, readFileSync(p, "utf8").replace(`APP_BUILD = ${before}`, `APP_BUILD = ${next}`));
    }

    // 利用者が1回リロードする
    await page.reload({ waitUntil: "load" });
    await sleep(4000);   // 新SWの install → activate → controllerchange → 自動リロード
    await page.waitForLoadState("load");

    const servedBuild = await readBuild(page);
    const cacheNames = await page.evaluate(() => caches.keys());
    // APP_BUILD だけを見てはいけない。旧実装は version.js をネットワークから
    // 返していたため、古いコードが動いていても APP_BUILD は最新を名乗る。
    // 実際に配信元となっているキャッシュが新ビルドのものかで判定する。
    const activeCache = cacheNames.length === 1 ? cacheNames[0] : null;
    outcome = {
        buildBefore: Number(before),
        buildDeployed: next,
        buildServedAfterOneReload: servedBuild,
        activeCache,
        // 動いているコードが新ビルドであること（キャッシュとAPP_BUILDの両方で確認）
        updateApplied: servedBuild === next && activeCache === `feth-build-${next}`,
        navigationsDuringUpdate: navigations - navsAfterInstall,
        noReloadLoop: navigations - navsAfterInstall <= 3,
        cacheNames,
        staleCachesRemoved: cacheNames.length === 1,
    };
} finally {
    await browser.close();
    server.kill();
    rmSync(root, { recursive: true, force: true });
}

const ok = outcome.updateApplied && outcome.noReloadLoop && outcome.staleCachesRemoved;
console.log(JSON.stringify({ ...outcome, result: ok ? "OK" : "NG" }, null, 2));
process.exit(ok ? 0 : 1);
