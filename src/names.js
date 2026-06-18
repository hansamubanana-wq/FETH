// 馬名の共有プール管理。
// プレイヤーが登録した名前はサーバー(Firestore)に保存され、以降のレースに
// ランダムで出てくる。ローカルにもキャッシュして、両モードで使う。
import { HORSE_POOL } from "./horses.js";

const LS = "keiba_horse_names";
const DEFAULTS = HORSE_POOL.map((h) => h.name);
let custom = load();
let remoteAdder = null; // (name) => void  オンライン時にサーバーへ保存するフック

function load() { try { return JSON.parse(localStorage.getItem(LS) || "[]"); } catch { return []; } }
function save() { localStorage.setItem(LS, JSON.stringify(custom.slice(-300))); }
function clean(s) { return (s || "").toString().trim().replace(/\s+/g, " ").slice(0, 12); }

export function setRemoteAdder(fn) { remoteAdder = fn; }

// サーバーから取得した名前一覧をローカルキャッシュに統合
export function mergeNames(arr) {
    if (!Array.isArray(arr)) return;
    for (const nm of arr) { const s = clean(nm); if (s && !custom.includes(s)) custom.push(s); }
    save();
}

export function customCount() { return custom.length; }

// 名前を登録（ローカル保存＋サーバー保存）
export function addName(name) {
    const s = clean(name);
    if (!s) return false;
    if (!custom.includes(s)) { custom.push(s); save(); }
    if (remoteAdder) { try { remoteAdder(s); } catch (e) { /* オフラインでもローカルには残る */ } }
    return true;
}

// その回に出走する n 頭の名前をランダムに選ぶ（デフォルト名＋登録名から）
export function pickNames(n) {
    const pool = [...new Set([...DEFAULTS, ...custom])];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    while (pool.length < n) pool.push(DEFAULTS[pool.length % DEFAULTS.length]);
    return pool.slice(0, n);
}
