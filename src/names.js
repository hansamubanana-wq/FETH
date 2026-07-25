// その回に出走する馬名の選出。
// 以前はプレイヤーが馬名を登録・共有できたが、機能を廃止したため
// 既定の馬名プール(horses.js)からランダムに選ぶだけになっている。
import { HORSE_POOL } from "./horses.js";

const DEFAULTS = HORSE_POOL.map((h) => h.name);

// その回に出走する n 頭の名前をランダムに選ぶ
export function pickNames(n) {
    const pool = [...new Set(DEFAULTS)];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    while (pool.length < n) pool.push(DEFAULTS[pool.length % DEFAULTS.length]);
    return pool.slice(0, n);
}
