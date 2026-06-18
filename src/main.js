// エントリポイント。ズーム禁止・ホーム画面・各モードの起動をまとめる。
import { showScreen } from "./ui.js";
import { initBetUI } from "./betui.js";
import { initLocal, enterLocalSetup } from "./local.js";
import { initOnline, enterOnlineHome, reconnectIfPossible, inRoom, requestLeave, preloadNames } from "./online.js";

// ---- ズーム禁止 ----
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("gesturechange", (e) => e.preventDefault());
document.addEventListener("wheel", (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && ["+", "-", "=", "_"].includes(e.key)) e.preventDefault();
});
let lastTouchEnd = 0;
document.addEventListener("touchend", (e) => {
    const now = Date.now();
    if (now - lastTouchEnd < 300) e.preventDefault();
    lastTouchEnd = now;
}, { passive: false });

// ---- 初期化 ----
initBetUI();
initLocal();
initOnline();

// ---- ホーム画面の遷移 ----
document.getElementById("go-local").addEventListener("click", enterLocalSetup);
document.getElementById("go-online").addEventListener("click", enterOnlineHome);

document.querySelectorAll("[data-home]").forEach((b) =>
    b.addEventListener("click", () => showScreen("screen-home")));

// ベット中・レース中などの共有画面からの退出（モードに応じて処理）
document.querySelectorAll("[data-exit]").forEach((b) =>
    b.addEventListener("click", () => {
        if (inRoom()) { requestLeave(); }
        else if (confirm("ゲームを中断してホームに戻りますか？")) { showScreen("screen-home"); }
    }));
document.getElementById("online-create-open").addEventListener("click", () => showScreen("screen-create"));
document.getElementById("online-join-open").addEventListener("click", () => showScreen("screen-join"));

// 馬名の共有プールをバックグラウンドで取得（ローカルでも使えるように）
preloadNames();

// 招待リンク or 前回の在室ルームがあれば自動で復帰、なければホーム
reconnectIfPossible()
    .then((handled) => { if (!handled) showScreen("screen-home"); })
    .catch(() => showScreen("screen-home"));
