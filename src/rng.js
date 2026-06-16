// 決定論的な擬似乱数（mulberry32）。同じseedなら全端末で完全に同じ乱数列になる。
// → 馬の生成・オッズ・レース展開を全端末で一致させ、オンラインでも同じ映像にする。
export function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// 文字列から整数シードを作る（ルームの合言葉などから安定したseedを得る用）。
export function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
