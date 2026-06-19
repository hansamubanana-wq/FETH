// レースの基礎パラメータ。事前計算シミュレーションと再生で共有する。
const SPEED_BASE = 190;   // perf=1 のときの基準速度(px/s)
const SPEED_NOISE = 100;  // 毎フレームの緩急の振れ幅(±)。大きいほど競り合いが激しい
const TRACK_LEN = 820;    // 1周の距離（内部単位）
const COND_SPREAD = 0.12; // 調子(コンディション)が実力に与える幅(±12%)。控えめ。出馬表に表示される
const RACE_JITTER = 0.21; // 同じ調子でもレース毎にブレる幅(±21%)。弱い馬にも一発がある
const SIM_DT = 1 / 60;    // 事前計算の固定タイムステップ(s)
const RACE_DURATION = 40; // 1着馬がゴールするまでの秒数（演出尺）
const TAIL_DURATION = 7;  // 1着後、残りの馬が全員ゴールするまでの秒数（早送り）

// レース開始時に1頭ぶんの状態を作る。
// 実力 = 基礎能力 × 調子 × 毎レースの微ブレ。
// ignoreCondition=true のときは調子を無視（オッズ算出用。調子はオッズに織り込まない）。
function initRunner(h, rng, ignoreCondition = false) {
    const ab = h.ability;
    const condMult = ignoreCondition ? 1 : 1 + (h.condition - 0.5) * 2 * COND_SPREAD;
    const perf = h.power * condMult * (1 + (rng() - 0.5) * 2 * RACE_JITTER);
    const active = rng() < ab.proc;                 // 今回そのレースで発動するか
    const trigger = ab.lo + rng() * (ab.hi - ab.lo); // 発動位置
    return { id: h.id, perf, style: h.style, ability: ab, active, trigger, x: 0, done: false };
}

// 1ステップの瞬間速度。perf を基準に、脚質(pace)・特殊能力・緩急(noise)を掛ける。
function computeSpeed(r, t, rng) {
    let pace = r.style.profile(Math.min(1, Math.max(0, t)));
    pace *= (r.ability.penalty || 1); // 常時デメリット
    if (r.active) {
        if (t >= r.trigger && t <= r.trigger + r.ability.dur) pace *= (1 + r.ability.boost); // 発動中ブースト
    } else {
        pace *= (r.ability.fizzle || 1); // 不発の日のデメリット
    }
    return Math.max(30, SPEED_BASE * r.perf * pace + (rng() - 0.5) * 2 * SPEED_NOISE);
}

// 着順(horse.id配列)だけを返す軽量シミュレーション。オッズ算出用。
// ignoreCondition=true で調子を無視（オッズに調子を入れない）。
export function simulateOrder(horses, rng, ignoreCondition = false) {
    const runners = horses.map((h) => initRunner(h, rng, ignoreCondition));
    const order = [];
    while (order.length < runners.length) {
        for (const r of runners) {
            if (r.done) continue;
            r.x += computeSpeed(r, r.x / TRACK_LEN, rng) * SIM_DT;
            if (r.x >= TRACK_LEN) {
                r.done = true;
                order.push(r.id);
            }
        }
    }
    return order;
}

// レース全体を固定タイムステップで事前計算する。
// 返り値: 全フレームの各馬位置・着順・着差・特殊能力の発動区間。
export function simulateRaceData(horses, rng) {
    const n = horses.length;
    const runners = horses.map((h) => initRunner(h, rng));
    const frames = [];      // frames[f][i] = 馬iのx
    const finishTime = new Array(n).fill(null);
    const order = [];       // ゴール順の馬index
    let time = 0;

    while (order.length < n) {
        frames.push(runners.map((r) => r.x));
        time += SIM_DT;
        for (let i = 0; i < n; i++) {
            const r = runners[i];
            if (r.done) continue;
            const sp = computeSpeed(r, r.x / TRACK_LEN, rng);
            r.x += sp * SIM_DT;
            if (r.x >= TRACK_LEN) {
                const over = r.x - TRACK_LEN;
                finishTime[i] = time - over / Math.max(1, sp); // ライン到達を補間
                r.x = TRACK_LEN;  // ゴール線で停止
                r.done = true;
                order.push(i);
            }
        }
    }
    frames.push(runners.map((r) => r.x)); // 最終フレーム

    // 着順は着差（到達時間）で厳密に並べる（同一ステップ内の取りこぼし防止）
    order.sort((a, b) => finishTime[a] - finishTime[b]);
    const gap = order.length >= 2 ? Math.abs(finishTime[order[1]] - finishTime[order[0]]) : 999;

    // 発動した能力の区間（進行度 t）を表示用に保持（不発の馬は -1/null）
    const abFrom = runners.map((r) => (r.active ? r.trigger : -1));
    const abTo = runners.map((r) => (r.active ? r.trigger + r.ability.dur : -1));
    const abLabel = runners.map((r) => (r.active ? r.ability.label : null));

    return { dt: SIM_DT, frames, order, finishTime, gap, trackLen: TRACK_LEN, abFrom, abTo, abLabel };
}

// 事前計算した raceData を canvas に実時間で再生するプレイヤー（オーバルコース1周）。
export class Race {
    constructor(canvas, horses, raceData) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.horses = horses;
        this.data = raceData;
        this.W = canvas.width;
        this.H = canvas.height;
        const n = horses.length;

        // 楕円トラックの形
        this.cx = this.W / 2;
        this.cy = this.H / 2;
        this.rx = 360;          // 中心線の横半径
        this.ry = 175;          // 中心線の縦半径
        this.laneGap = 13;
        this.theta0 = Math.PI / 2; // スタート/ゴールは下（手前の直線）
        // 各馬のレーン半径オフセット（内・外に振り分け）
        this.off = horses.map((h, i) => (i - (n - 1) / 2) * this.laneGap);
        const half = ((n - 1) / 2) * this.laneGap;
        this.trackOX = this.rx + half + 26;  // トラック外周
        this.trackOY = this.ry + half + 26;
        this.trackIX = this.rx - half - 26;  // トラック内周
        this.trackIY = this.ry - half - 26;

        this.onFinish = null;
        this.onTick = null;
        this._raf = null;
        this._startWall = 0;
        this._dist = horses.map(() => 0); // 各馬の走行距離(0..TRACK_LEN)
        // 1着馬がゴールするまでのシミュ時間。これを RACE_DURATION 秒で再生する
        this.winnerTime = raceData.finishTime[raceData.order[0]];
        // 最後の馬がゴールするまでのシミュ時間（全員完走の判定用）
        this.lastTime = raceData.finishTime[raceData.order[raceData.order.length - 1]];
    }

    start() {
        this._startWall = performance.now();
        this._raf = requestAnimationFrame((t) => this._loop(t));
    }

    stop() {
        if (this._raf) cancelAnimationFrame(this._raf);
    }

    _loop(now) {
        const elapsed = (now - this._startWall) / 1000;
        const { frames, dt } = this.data;
        const last = frames.length - 1;

        // 区間1: 1着馬が RACE_DURATION 秒でゴール
        // 区間2: その後、残りの馬が TAIL_DURATION 秒で全員ゴール（早送り）
        let simT;
        if (elapsed <= RACE_DURATION) {
            simT = (elapsed / RACE_DURATION) * this.winnerTime;
        } else {
            const span = Math.max(0.001, this.lastTime - this.winnerTime);
            simT = this.winnerTime + ((elapsed - RACE_DURATION) / TAIL_DURATION) * span;
        }
        const allDone = simT >= this.lastTime;
        const fpos = Math.min(last, Math.min(simT, this.lastTime) / dt);
        const f0 = Math.floor(fpos);
        const f1 = Math.min(last, f0 + 1);
        const alpha = fpos - f0;
        for (let i = 0; i < this.horses.length; i++) {
            this._dist[i] = frames[f0][i] + (frames[f1][i] - frames[f0][i]) * alpha;
        }
        this._draw(elapsed);
        if (this.onTick) this.onTick(this._currentOrder());

        if (allDone) {
            // 全馬ゴール → 結果へ
            if (this.onFinish) {
                const cb = this.onFinish;
                this.onFinish = null;
                cb(this.data.order.map((i) => this.horses[i]));
            }
            return;
        }
        this._raf = requestAnimationFrame((t) => this._loop(t));
    }

    // 現在の順位（先頭→最後）の馬配列。
    // ゴール済みの馬は着差(finishTime)順で前に、走行中の馬は距離順で後ろに並べる。
    // これで画面の順位と最終着順が一致する。
    _currentOrder() {
        const ft = this.data.finishTime;
        const fin = (i) => this._dist[i] >= TRACK_LEN - 0.5;
        return this.horses
            .map((h, i) => i)
            .sort((a, b) => {
                const af = fin(a), bf = fin(b);
                if (af && bf) return ft[a] - ft[b];
                if (af) return -1;
                if (bf) return 1;
                return this._dist[b] - this._dist[a];
            })
            .map((i) => this.horses[i]);
    }

    // 距離→画面座標（レーンオフセット込み）
    _pos(dist, off) {
        const ang = this.theta0 + 2 * Math.PI * (dist / TRACK_LEN);
        return {
            x: this.cx + (this.rx + off) * Math.cos(ang),
            y: this.cy + (this.ry + off) * Math.sin(ang),
        };
    }

    _ellipse(rx, ry) {
        this.ctx.beginPath();
        this.ctx.ellipse(this.cx, this.cy, rx, ry, 0, 0, Math.PI * 2);
    }

    _draw(elapsed = 0) {
        const ctx = this.ctx;
        const leadIdx = this._dist.map((d, i) => i).sort((a, b) => this._dist[b] - this._dist[a])[0];

        // 芝の下地
        const g = ctx.createLinearGradient(0, 0, 0, this.H);
        g.addColorStop(0, "#2f7d39");
        g.addColorStop(1, "#1c5e28");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, this.W, this.H);

        // ダートのトラック（リング）＋陰影
        const tg = ctx.createLinearGradient(0, this.cy - this.trackOY, 0, this.cy + this.trackOY);
        tg.addColorStop(0, "#d9b483");
        tg.addColorStop(0.5, "#c79a5b");
        tg.addColorStop(1, "#b07f45");
        ctx.fillStyle = tg;
        this._ellipse(this.trackOX, this.trackOY); ctx.fill();
        // 内側の芝でくり抜き＋刈り込みストライプ
        ctx.save();
        this._ellipse(this.trackIX, this.trackIY); ctx.clip();
        for (let k = 0; k < 14; k++) {
            ctx.fillStyle = k % 2 === 0 ? "#2e8b3d" : "#277e35";
            const rxk = this.trackIX * (1 - k / 14), ryk = this.trackIY * (1 - k / 14);
            this._ellipse(rxk, ryk); ctx.fill();
        }
        ctx.restore();

        // レーンの仕切り（薄い点線の楕円）
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 10]);
        for (let k = 1; k < this.horses.length; k++) {
            const off = (k - this.horses.length / 2) * this.laneGap;
            this._ellipse(this.rx + off, this.ry + off); ctx.stroke();
        }
        ctx.setLineDash([]);

        // ラチ（内外の白い柵＋支柱）
        this._drawRail(this.trackOX, this.trackOY);
        this._drawRail(this.trackIX, this.trackIY);

        // ゴールゲート＆ライン
        this._drawFinishLine();

        // 砂煙→馬の順で、後方の馬から描画
        const order = this.horses.map((h, i) => i).sort((a, b) => this._dist[a] - this._dist[b]);
        for (const i of order) this._drawHorse(i, elapsed, i === leadIdx);

        // ビネット（四隅を少し暗く）
        const vg = ctx.createRadialGradient(this.cx, this.cy, this.H * 0.3, this.cx, this.cy, this.H * 0.75);
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(1, "rgba(0,0,0,0.35)");
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, this.W, this.H);
    }

    _drawRail(rx, ry) {
        const ctx = this.ctx;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        this._ellipse(rx, ry); ctx.stroke();
        // 支柱（ティック）
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 2;
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 18) {
            const c = Math.cos(a), s = Math.sin(a);
            ctx.beginPath();
            ctx.moveTo(this.cx + rx * c, this.cy + ry * s);
            ctx.lineTo(this.cx + (rx + 4) * c, this.cy + (ry + 4) * s);
            ctx.stroke();
        }
    }

    _drawHorse(i, elapsed, isLeader) {
        const ctx = this.ctx;
        const h = this.horses[i];
        const dist = this._dist[i];
        const off = this.off[i];
        const ang = this.theta0 + 2 * Math.PI * (dist / TRACK_LEN);
        const p = { x: this.cx + (this.rx + off) * Math.cos(ang), y: this.cy + (this.ry + off) * Math.sin(ang) };
        const facing = Math.atan2((this.ry + off) * Math.cos(ang), -(this.rx + off) * Math.sin(ang));
        const moving = dist < TRACK_LEN - 0.5;
        const gallop = elapsed * 16 + i;
        const t = dist / TRACK_LEN;
        const boosting = moving && this.data.abLabel[i] && t >= this.data.abFrom[i] && t <= this.data.abTo[i];

        // 影
        ctx.fillStyle = "rgba(0,0,0,0.28)";
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + 6, 15, 7, 0, 0, Math.PI * 2);
        ctx.fill();

        // 砂煙（走行中のみ、後方へ）
        if (moving) {
            for (let d = 1; d <= 3; d++) {
                const bx = p.x - Math.cos(facing) * (10 + d * 6);
                const by = p.y - Math.sin(facing) * (10 + d * 6);
                const puff = 4 + ((gallop + d) % 3);
                ctx.fillStyle = `rgba(220,200,170,${0.18 / d})`;
                ctx.beginPath();
                ctx.arc(bx, by, puff, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // ブースト発動中のオーラ＋炎
        if (boosting) {
            const pulse = 1 + Math.sin(elapsed * 30) * 0.15;
            ctx.fillStyle = "rgba(255,140,0,0.30)";
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, 22 * pulse, 16 * pulse, 0, 0, Math.PI * 2);
            ctx.fill();
            for (let d = 1; d <= 4; d++) {
                const fx = p.x - Math.cos(facing) * (12 + d * 5);
                const fy = p.y - Math.sin(facing) * (12 + d * 5);
                ctx.fillStyle = `rgba(255,${120 + d * 20},0,${0.5 / d})`;
                ctx.beginPath();
                ctx.arc(fx, fy, 6 - d, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(facing);

        if (isLeader) {
            ctx.strokeStyle = "rgba(255,215,60,0.9)";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.ellipse(0, 0, 20, 14, 0, 0, Math.PI * 2);
            ctx.stroke();
        }

        // 脚（疾走アニメ）
        const sw = moving ? Math.sin(gallop) * 5 : 0;
        ctx.strokeStyle = "#3a2a1d";
        ctx.lineWidth = 2.5;
        for (const [lx, base] of [[-8, 1], [8, -1]]) {
            ctx.beginPath();
            ctx.moveTo(lx, -5);
            ctx.lineTo(lx + base * sw, -11);
            ctx.moveTo(lx, 5);
            ctx.lineTo(lx - base * sw, 11);
            ctx.stroke();
        }

        // 胴体（馬体）
        ctx.fillStyle = "#6b4a31";
        ctx.beginPath();
        ctx.ellipse(0, 0, 14, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        // しっぽ
        ctx.strokeStyle = "#3a2a1d";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-13, 0);
        ctx.lineTo(-20, Math.sin(gallop) * 3);
        ctx.stroke();
        // 首・頭
        ctx.fillStyle = "#5b3d28";
        ctx.beginPath();
        ctx.ellipse(13, 0, 7, 4.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // 騎手の勝負服（馬の色）＋ヘルメット
        ctx.fillStyle = h.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, 7, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#111";
        ctx.beginPath();
        ctx.arc(2, 0, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // ゼッケン番号（常に正立）
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y - 16, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = h.color;
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(h.id + 1), p.x, p.y - 15);

        // ブースト名のポップ
        if (boosting) {
            ctx.fillStyle = "#ff8c00";
            ctx.font = "bold 12px sans-serif";
            ctx.strokeStyle = "rgba(0,0,0,0.7)";
            ctx.lineWidth = 3;
            ctx.strokeText("⚡" + this.data.abLabel[i], p.x, p.y - 28);
            ctx.fillText("⚡" + this.data.abLabel[i], p.x, p.y - 28);
        }
    }

    _drawFinishLine() {
        const ctx = this.ctx;
        const c = Math.cos(this.theta0), s = Math.sin(this.theta0);
        const inner = { x: this.cx + this.trackIX * c, y: this.cy + this.trackIY * s };
        const outer = { x: this.cx + this.trackOX * c, y: this.cy + this.trackOY * s };
        // 市松のライン
        const steps = 8;
        for (let k = 0; k < steps; k++) {
            const t0 = k / steps, t1 = (k + 1) / steps;
            ctx.strokeStyle = k % 2 === 0 ? "#fff" : "#111";
            ctx.lineWidth = 7;
            ctx.beginPath();
            ctx.moveTo(inner.x + (outer.x - inner.x) * t0, inner.y + (outer.y - inner.y) * t0);
            ctx.lineTo(inner.x + (outer.x - inner.x) * t1, inner.y + (outer.y - inner.y) * t1);
            ctx.stroke();
        }
        // ゴールゲート（支柱＋バナー）
        ctx.fillStyle = "#c0392b";
        ctx.fillRect(inner.x - 5, inner.y - 4, 10, 8);
        ctx.fillRect(outer.x - 5, outer.y - 4, 10, 8);
        const bx = (inner.x + outer.x) / 2, by = (inner.y + outer.y) / 2;
        ctx.fillStyle = "#c0392b";
        ctx.fillRect(bx - 26, by - 6, 52, 13);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("FINISH", bx, by + 1);
    }
}
