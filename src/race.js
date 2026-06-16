// レースの基礎パラメータ。アニメ描画とオッズ算出用シミュレーションで共有する。
const SPEED_BASE = 190;   // perf=1 のときの基準速度(px/s)
const SPEED_NOISE = 95;   // 毎フレームの緩急の振れ幅(±)
const TRACK_LEN = 820;    // スタート〜ゴールの距離(px)
const FORM_SPREAD = 0.55; // レースごとの「調子」のばらつき(±55%)

// レースごとの実力値。能力(power)に、そのレース限定の「調子」を掛ける。
// 調子で番狂わせが起きるので、強い馬が有利だが弱い馬にもチャンスが残る。
export function rollPerf(power) {
    return power * (1 + (Math.random() - 0.5) * 2 * FORM_SPREAD);
}

// 1ステップの瞬間速度。perf を基準に、脚質(pace)と毎フレームの緩急(noise)を掛ける。
// t は進行度(0..1)。脚質によって速いタイミングが変わる。
function computeSpeed(perf, style, t) {
    const pace = style.profile(Math.min(1, Math.max(0, t)));
    return Math.max(30, SPEED_BASE * perf * pace + (Math.random() - 0.5) * 2 * SPEED_NOISE);
}

// 描画なしでレースを1回走らせ、ゴール順（horse.id の配列）を返す。
// オッズ算出のためのモンテカルロに使う。アニメ本番と同じモデル（脚質込み）で走らせる。
export function simulateOrder(horses) {
    const dt = 1 / 30;
    const runners = horses.map((h) => ({ id: h.id, perf: rollPerf(h.power), style: h.style, x: 0, done: false }));
    const order = [];
    while (order.length < runners.length) {
        for (const r of runners) {
            if (r.done) continue;
            r.x += computeSpeed(r.perf, r.style, r.x / TRACK_LEN) * dt;
            if (r.x >= TRACK_LEN) {
                r.done = true;
                order.push(r.id);
            }
        }
    }
    return order;
}

// canvas 上でレースを描画・進行させるクラス。
export class Race {
    constructor(canvas, horses) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.horses = horses;
        this.W = canvas.width;
        this.H = canvas.height;

        this.startX = 60;
        this.finishX = this.startX + TRACK_LEN; // ゴールライン
        this.laneTop = 70;
        this.laneGap = (this.H - this.laneTop - 30) / horses.length;

        // 各馬の走行状態（perf はこのレース限定の実力値）
        this.runners = horses.map((h, i) => ({
            horse: h,
            perf: rollPerf(h.power),
            x: this.startX,
            speed: 0,
            laneY: this.laneTop + this.laneGap * (i + 0.5),
            finished: false,
            finishOrder: null,
            bob: Math.random() * Math.PI * 2, // 上下の揺れ位相
        }));

        this.order = [];      // ゴール順
        this.running = false;
        this.onFinish = null; // 全馬ゴール時のコールバック
        this.onTick = null;   // 毎フレームの通知（先頭表示用）
        this.raceTime = 0;    // レース経過時間(s)。写真判定の着差判定に使う
        this._raf = null;
        this._last = 0;
    }

    start() {
        this.running = true;
        this._last = performance.now();
        this._raf = requestAnimationFrame((t) => this._loop(t));
    }

    stop() {
        this.running = false;
        if (this._raf) cancelAnimationFrame(this._raf);
    }

    _loop(now) {
        const dt = Math.min((now - this._last) / 1000, 0.05);
        this._last = now;
        this._update(dt);
        this._draw();
        if (this.onTick) this.onTick(this._leader());
        if (this.order.length < this.runners.length) {
            this._raf = requestAnimationFrame((t) => this._loop(t));
        } else if (this.onFinish) {
            this.running = false;
            this.onFinish(this.order.map((r) => r.horse));
        }
    }

    _update(dt) {
        this.raceTime += dt;
        for (const r of this.runners) {
            if (r.finished) continue;
            const t = (r.x - this.startX) / (this.finishX - this.startX);
            r.speed = computeSpeed(r.perf, r.horse.style, t);
            r.x += r.speed * dt;
            r.bob += dt * 14;

            if (r.x >= this.finishX) {
                // ゴールを越えた分から、ライン到達時刻を補間して着差を精密化
                const over = r.x - this.finishX;
                r.finishTime = this.raceTime - (over / Math.max(1, r.speed));
                r.x = this.finishX;
                r.finished = true;
                r.finishOrder = this.order.length + 1;
                this.order.push(r);
            }
        }
    }

    // 先頭を走っている馬（未ゴール優先、いなければ最後の1頭）
    _leader() {
        let lead = null;
        for (const r of this.runners) {
            if (r.finished) continue;
            if (!lead || r.x > lead.x) lead = r;
        }
        return lead ? lead.horse : (this.order.length ? this.order[0].horse : null);
    }

    // 1着と2着の着差（秒）。写真判定の判断に使う。
    finishGap() {
        if (this.order.length < 2) return 999;
        return Math.abs(this.order[1].finishTime - this.order[0].finishTime);
    }

    _draw() {
        const ctx = this.ctx;
        // 芝
        ctx.fillStyle = "#2e7d32";
        ctx.fillRect(0, 0, this.W, this.H);

        // レーン
        for (let i = 0; i < this.runners.length; i++) {
            const y = this.laneTop + this.laneGap * i;
            ctx.fillStyle = i % 2 === 0 ? "#388e3c" : "#2e7d32";
            ctx.fillRect(0, y, this.W, this.laneGap);
        }

        // スタート/ゴールライン
        this._drawPostLine(this.startX, "#ffffff");
        this._drawCheckered(this.finishX);

        // 各馬
        for (const r of this.runners) {
            const bobY = Math.sin(r.bob) * 4;
            ctx.font = "30px serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            // 色付きの背景丸（識別用）
            ctx.beginPath();
            ctx.fillStyle = r.horse.color;
            ctx.arc(r.x, r.laneY + bobY, 17, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#000";
            ctx.fillText(r.horse.emoji, r.x, r.laneY + bobY + 1);

            // ゼッケン番号
            ctx.font = "bold 12px sans-serif";
            ctx.fillStyle = "#0d1b2a";
            ctx.fillText(String(r.horse.id + 1), r.x - 20, r.laneY + bobY);

            // 馬名
            ctx.font = "12px sans-serif";
            ctx.fillStyle = "#ffffff";
            ctx.textAlign = "left";
            ctx.fillText(r.horse.name, 8, r.laneY - this.laneGap / 2 + 12);

            // ゴール済みは順位を表示
            if (r.finished) {
                ctx.fillStyle = "#ffeb3b";
                ctx.font = "bold 14px sans-serif";
                ctx.textAlign = "center";
                ctx.fillText(`${r.finishOrder}着`, r.x + 28, r.laneY + bobY);
            }
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
