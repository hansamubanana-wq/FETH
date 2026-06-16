// canvas 上でレースを描画・進行させるクラス。
export class Race {
    constructor(canvas, horses) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.horses = horses;
        this.W = canvas.width;
        this.H = canvas.height;

        this.finishX = this.W - 80; // ゴールライン
        this.startX = 60;
        this.laneTop = 70;
        this.laneGap = (this.H - this.laneTop - 30) / horses.length;

        // 各馬の走行状態
        this.runners = horses.map((h, i) => ({
            horse: h,
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
        if (this.order.length < this.runners.length) {
            this._raf = requestAnimationFrame((t) => this._loop(t));
        } else if (this.onFinish) {
            this.running = false;
            this.onFinish(this.order.map((r) => r.horse));
        }
    }

    _update(dt) {
        const distance = this.finishX - this.startX;
        for (const r of this.runners) {
            if (r.finished) continue;
            // 基礎速度 + 毎フレームのランダムな緩急で接戦を演出
            const base = 150 * r.horse.power;
            const noise = (Math.random() - 0.45) * 220;
            r.speed = Math.max(40, base + noise);
            r.x += r.speed * dt;
            r.bob += dt * 14;

            if (r.x >= this.finishX) {
                r.x = this.finishX;
                r.finished = true;
                r.finishOrder = this.order.length + 1;
                this.order.push(r);
            }
        }
        this._distance = distance;
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
            // 体
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
