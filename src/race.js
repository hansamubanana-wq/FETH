// レースの基礎パラメータ。事前計算シミュレーションと再生で共有する。
const SPEED_BASE = 190;   // perf=1 のときの基準速度(px/s)
const SPEED_NOISE = 135;  // 毎フレームの緩急の振れ幅(±)。大きいほど競り合いが激しい
const TRACK_LEN = 820;    // 1周の距離（内部単位）
const FORM_SPREAD = 0.55; // レースごとの「調子」のばらつき(±55%)
const SIM_DT = 1 / 60;    // 事前計算の固定タイムステップ(s)
const RACE_DURATION = 40; // 再生にかける秒数（演出尺。結果・オッズには影響しない）

// レースごとの実力値。能力(power)にそのレース限定の「調子」を掛ける。
export function rollPerf(power, rng) {
    return power * (1 + (rng() - 0.5) * 2 * FORM_SPREAD);
}

// 1ステップの瞬間速度。perf を基準に、脚質(pace)と緩急(noise)を掛ける。
function computeSpeed(perf, style, t, rng) {
    const pace = style.profile(Math.min(1, Math.max(0, t)));
    return Math.max(30, SPEED_BASE * perf * pace + (rng() - 0.5) * 2 * SPEED_NOISE);
}

// 着順(horse.id配列)だけを返す軽量シミュレーション。オッズ算出用。
export function simulateOrder(horses, rng) {
    const runners = horses.map((h) => ({ id: h.id, perf: rollPerf(h.power, rng), style: h.style, x: 0, done: false }));
    const order = [];
    while (order.length < runners.length) {
        for (const r of runners) {
            if (r.done) continue;
            r.x += computeSpeed(r.perf, r.style, r.x / TRACK_LEN, rng) * SIM_DT;
            if (r.x >= TRACK_LEN) {
                r.done = true;
                order.push(r.id);
            }
        }
    }
    return order;
}

// レース全体を固定タイムステップで事前計算する。
// 返り値: 全フレームの各馬位置・着順・着差。これを実時間で再生するので
// 端末のフレームレートに依存せず、同じseedなら全端末で同一の映像になる。
export function simulateRaceData(horses, rng) {
    const n = horses.length;
    const runners = horses.map((h) => ({ perf: rollPerf(h.power, rng), style: h.style, x: 0, done: false }));
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
            const sp = computeSpeed(r.perf, r.style, r.x / TRACK_LEN, rng);
            r.x += sp * SIM_DT;
            if (r.x >= TRACK_LEN) {
                const over = r.x - TRACK_LEN;
                finishTime[i] = time - over / Math.max(1, sp); // ライン到達を補間
                r.x = TRACK_LEN;
                r.done = true;
                order.push(i);
            }
        }
    }
    frames.push(runners.map((r) => r.x)); // 最終フレーム

    // 着差（1着と2着の時間差）
    const sorted = [...order].sort((a, b) => finishTime[a] - finishTime[b]);
    const gap = sorted.length >= 2 ? Math.abs(finishTime[sorted[1]] - finishTime[sorted[0]]) : 999;

    return { dt: SIM_DT, frames, order, finishTime, gap, trackLen: TRACK_LEN };
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
        const { frames } = this.data;
        const total = frames.length - 1;
        const progress = Math.min(1, elapsed / RACE_DURATION);
        const fpos = progress * total;
        const f0 = Math.floor(fpos);
        const done = progress >= 1;

        if (done) {
            const last = frames[frames.length - 1];
            for (let i = 0; i < this.horses.length; i++) this._dist[i] = last[i];
            this._draw(elapsed);
            if (this.onTick) this.onTick(this._currentOrder());
            if (this.onFinish) {
                const cb = this.onFinish;
                this.onFinish = null;
                cb(this.data.order.map((i) => this.horses[i]));
            }
            return;
        }

        const f1 = f0 + 1;
        const alpha = fpos - f0;
        for (let i = 0; i < this.horses.length; i++) {
            this._dist[i] = frames[f0][i] + (frames[f1][i] - frames[f0][i]) * alpha;
        }
        this._draw(elapsed);
        if (this.onTick) this.onTick(this._currentOrder());
        this._raf = requestAnimationFrame((t) => this._loop(t));
    }

    // 現在の走行距離順（先頭→最後）の馬配列
    _currentOrder() {
        return this.horses
            .map((h, i) => i)
            .sort((a, b) => this._dist[b] - this._dist[a])
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

    _draw(elapsed = 0) {
        const ctx = this.ctx;
        // 芝（背景）
        ctx.fillStyle = "#1f6b2a";
        ctx.fillRect(0, 0, this.W, this.H);

        // トラック（ダート風のリング）
        ctx.fillStyle = "#c79a5b";
        ctx.beginPath();
        ctx.ellipse(this.cx, this.cy, this.trackOX, this.trackOY, 0, 0, Math.PI * 2);
        ctx.fill();
        // 内側の芝でリングをくり抜く
        ctx.fillStyle = "#2e8b3d";
        ctx.beginPath();
        ctx.ellipse(this.cx, this.cy, this.trackIX, this.trackIY, 0, 0, Math.PI * 2);
        ctx.fill();
        // ラチ（白線）
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(this.cx, this.cy, this.trackOX, this.trackOY, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(this.cx, this.cy, this.trackIX, this.trackIY, 0, 0, Math.PI * 2);
        ctx.stroke();

        // スタート/ゴールライン（市松）
        this._drawFinishLine();

        // 各馬を距離順に描く（後ろの馬を先に→先頭が上に重なる）
        const order = this.horses.map((h, i) => i).sort((a, b) => this._dist[a] - this._dist[b]);
        for (const i of order) {
            const h = this.horses[i];
            const p = this._pos(this._dist[i], this.off[i]);
            ctx.beginPath();
            ctx.fillStyle = h.color;
            ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = "rgba(0,0,0,0.5)";
            ctx.stroke();
            ctx.fillStyle = "#0d1b2a";
            ctx.font = "bold 13px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(String(h.id + 1), p.x, p.y + 1);
        }
    }

    _drawFinishLine() {
        const ctx = this.ctx;
        const c = Math.cos(this.theta0), s = Math.sin(this.theta0);
        const inner = { x: this.cx + this.trackIX * c, y: this.cy + this.trackIY * s };
        const outer = { x: this.cx + this.trackOX * c, y: this.cy + this.trackOY * s };
        const steps = 8;
        for (let k = 0; k < steps; k++) {
            const t0 = k / steps, t1 = (k + 1) / steps;
            ctx.strokeStyle = k % 2 === 0 ? "#fff" : "#111";
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.moveTo(inner.x + (outer.x - inner.x) * t0, inner.y + (outer.y - inner.y) * t0);
            ctx.lineTo(inner.x + (outer.x - inner.x) * t1, inner.y + (outer.y - inner.y) * t1);
            ctx.stroke();
        }
    }
}
