// レースの基礎パラメータ。事前計算シミュレーションと再生で共有する。
const SPEED_BASE = 190;   // perf=1 のときの基準速度(px/s)
const SPEED_NOISE = 95;   // 毎フレームの緩急の振れ幅(±)
const TRACK_LEN = 820;    // スタート〜ゴールの距離(px)
const FORM_SPREAD = 0.55; // レースごとの「調子」のばらつき(±55%)
const SIM_DT = 1 / 60;    // 事前計算の固定タイムステップ(s)
const RACE_DURATION = 20; // 再生にかける秒数（演出尺。結果・オッズには影響しない）

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

// 事前計算した raceData を canvas に実時間で再生するプレイヤー。
export class Race {
    constructor(canvas, horses, raceData) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.horses = horses;
        this.data = raceData;
        this.W = canvas.width;
        this.H = canvas.height;

        this.startX = 60;
        this.finishX = this.startX + TRACK_LEN;
        this.laneTop = 70;
        this.laneGap = (this.H - this.laneTop - 30) / horses.length;
        this.laneY = horses.map((h, i) => this.laneTop + this.laneGap * (i + 0.5));
        this.bobPhase = horses.map(() => Math.random() * Math.PI * 2);

        this.onFinish = null;
        this.onTick = null;
        this._raf = null;
        this._startWall = 0;
        this._xs = horses.map(() => this.startX);
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
        // 事前計算したレースを RACE_DURATION 秒に引き伸ばして再生する
        const progress = Math.min(1, elapsed / RACE_DURATION);
        const fpos = progress * total;
        const f0 = Math.floor(fpos);
        const done = progress >= 1;

        if (done) {
            // 最終位置に固定して描画
            const last = frames[frames.length - 1];
            this._xs = last.map((x) => this.startX + x);
            this._draw(elapsed);
            if (this.onFinish) {
                this.onFinish(this.data.order.map((i) => this.horses[i]));
                this.onFinish = null;
            }
            return;
        }

        const f1 = f0 + 1;
        const alpha = fpos - f0;
        for (let i = 0; i < this.horses.length; i++) {
            const x = frames[f0][i] + (frames[f1][i] - frames[f0][i]) * alpha;
            this._xs[i] = this.startX + x;
        }
        this._draw(elapsed);
        if (this.onTick) this.onTick(this._leader());
        this._raf = requestAnimationFrame((t) => this._loop(t));
    }

    _leader() {
        let best = 0;
        for (let i = 1; i < this._xs.length; i++) if (this._xs[i] > this._xs[best]) best = i;
        return this.horses[best];
    }

    _draw(elapsed = 0) {
        const ctx = this.ctx;
        ctx.fillStyle = "#2e7d32";
        ctx.fillRect(0, 0, this.W, this.H);

        for (let i = 0; i < this.horses.length; i++) {
            const y = this.laneTop + this.laneGap * i;
            ctx.fillStyle = i % 2 === 0 ? "#388e3c" : "#2e7d32";
            ctx.fillRect(0, y, this.W, this.laneGap);
        }

        this._drawPostLine(this.startX, "#ffffff");
        this._drawCheckered(this.finishX);

        for (let i = 0; i < this.horses.length; i++) {
            const h = this.horses[i];
            const x = this._xs[i];
            const bobY = Math.sin(elapsed * 14 + this.bobPhase[i]) * 4;
            ctx.font = "30px serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.beginPath();
            ctx.fillStyle = h.color;
            ctx.arc(x, this.laneY[i] + bobY, 17, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#000";
            ctx.fillText(h.emoji, x, this.laneY[i] + bobY + 1);

            ctx.font = "bold 12px sans-serif";
            ctx.fillStyle = "#0d1b2a";
            ctx.fillText(String(h.id + 1), x - 20, this.laneY[i] + bobY);

            ctx.font = "12px sans-serif";
            ctx.fillStyle = "#ffffff";
            ctx.textAlign = "left";
            ctx.fillText(h.name, 8, this.laneY[i] - this.laneGap / 2 + 12);
        }
    }

    _drawPostLine(x, color) {
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.moveTo(x, this.laneTop);
        this.ctx.lineTo(x, this.H - 30);
        this.ctx.stroke();
    }

    _drawCheckered(x) {
        const ctx = this.ctx;
        const sq = 10;
        for (let y = this.laneTop; y < this.H - 30; y += sq) {
            for (let k = 0; k < 2; k++) {
                const isBlack = ((Math.floor((y - this.laneTop) / sq) + k) % 2) === 0;
                ctx.fillStyle = isBlack ? "#111" : "#fff";
                ctx.fillRect(x + k * sq, y, sq, sq);
            }
        }
    }
}
