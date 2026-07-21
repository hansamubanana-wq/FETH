// レースの基礎パラメータ。事前計算シミュレーションと再生で共有する。
import { Race3DRenderer } from "./race3d.js";
import { RACE_SIM_CONSTANTS, simulateOrder, simulateRaceData } from "./race-sim.js";
export { simulateOrder, simulateRaceData } from "./race-sim.js";

const { TRACK_LEN } = RACE_SIM_CONSTANTS;
export const RACE_DURATION = 32; // 現行比1.25倍速。着順計算は変えず再生尺だけを8割にする
const TAIL_DURATION = 5.6;       // 1着後も同じ倍率で再生する


// 事前計算した raceData を canvas に実時間で再生するプレイヤー（オーバルコース1周）。
export class Race {
    constructor(canvas, horses, raceData, onProgress = null) {
        this.canvas = canvas;
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
        this.renderer3d = null;
        try {
            this.renderer3d = new Race3DRenderer(canvas, horses, raceData, {
                rx: this.rx,
                ry: this.ry,
                off: this.off,
            }, onProgress);
        } catch (error) {
            console.warn("3D renderer unavailable, falling back to 2D canvas.", error);
        }
        if (!this.renderer3d) {
            this.ctx = canvas.getContext("2d");
            this.portraits = horses.map((h) => {
                const image = new Image();
                image.src = `assets/art/horses/horse${h.id + 1}.png`;
                return image;
            });
        }
    }

    whenReady() {
        return this.renderer3d?.readyPromise || Promise.resolve();
    }

    start() {
        this._startWall = performance.now();
        this._raf = requestAnimationFrame((t) => this._loop(t));
    }

    stop() {
        if (this._raf) cancelAnimationFrame(this._raf);
        if (this.renderer3d) this.renderer3d.dispose();
    }

    _loop(now) {
        // rAFのタイムスタンプは start() 時点の performance.now() より僅かに過去のことがある
        const elapsed = Math.max(0, (now - this._startWall) / 1000);
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
        if (this.onTick) this.onTick(this._currentOrder(), this._dist.slice(), elapsed);

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
        if (this.renderer3d) {
            this.renderer3d.render(this._dist, elapsed);
            return;
        }
        this._drawRetroRace(elapsed);
        return;
        /* istanbul ignore next -- 旧オーバル描画はレトロ表示の保守用リファレンス */
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

    _drawRetroRace(elapsed) {
        const ctx = this.ctx;
        const W = this.W;
        const H = this.H;
        const leaderDistance = Math.max(...this._dist);
        const worldScale = 1.72;
        const scroll = Math.max(0, leaderDistance * worldScale - W * 0.62);

        // 空: 時間とともにわずかに色味が変わるドット絵風グラデーション。
        const sky = ctx.createLinearGradient(0, 0, 0, H * 0.46);
        sky.addColorStop(0, "#5d94c7");
        sky.addColorStop(1, "#c8e6ef");
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, H * 0.46);

        // 遠景の雲（最も遅いパララックス）。
        ctx.fillStyle = "rgba(255,255,255,.72)";
        for (let i = -1; i < 7; i++) {
            const x = ((i * 190 - scroll * 0.08) % (W + 260)) - 80;
            const y = 62 + (i % 3) * 29;
            ctx.beginPath();
            ctx.arc(x, y, 28, 0, Math.PI * 2);
            ctx.arc(x + 31, y - 10, 35, 0, Math.PI * 2);
            ctx.arc(x + 68, y, 25, 0, Math.PI * 2);
            ctx.fill();
        }

        // 観客席と屋根（中速パララックス）。
        const standY = H * 0.25;
        ctx.fillStyle = "#263a51";
        ctx.fillRect(0, standY, W, 102);
        ctx.fillStyle = "#e9edf0";
        ctx.fillRect(0, standY - 10, W, 13);
        const crowdColors = ["#f2c14e", "#e85d75", "#57b8d9", "#89c56b", "#f0f0df"];
        for (let row = 0; row < 4; row++) {
            for (let i = -2; i < 52; i++) {
                const x = ((i * 25 - scroll * 0.24 + row * 9) % (W + 50)) - 25;
                ctx.fillStyle = crowdColors[(i + row * 2 + 10) % crowdColors.length];
                ctx.fillRect(Math.round(x), Math.round(standY + 15 + row * 19), 8, 11);
            }
        }

        // 芝とダート。ストライプが速く流れて疾走感を出す。
        const turfY = standY + 102;
        ctx.fillStyle = "#28743a";
        ctx.fillRect(0, turfY, W, H - turfY);
        for (let x = -(scroll * 0.55 % 96); x < W; x += 96) {
            ctx.fillStyle = "rgba(122,194,100,.13)";
            ctx.fillRect(x, turfY, 48, H - turfY);
        }
        ctx.fillStyle = "#b9854d";
        ctx.fillRect(0, turfY + 30, W, H - turfY - 58);
        for (let y = turfY + 49; y < H - 22; y += 30) {
            ctx.strokeStyle = "rgba(255,255,255,.16)";
            ctx.setLineDash([14, 18]);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();
        }
        ctx.setLineDash([]);

        // スタート・ゴール標識は同じワールド座標系を移動する。
        const startX = 80 - scroll;
        const finishX = 80 + TRACK_LEN * worldScale - scroll;
        this._drawRetroMarker(startX, turfY + 24, H - 18, "START", false);
        this._drawRetroMarker(finishX, turfY + 24, H - 18, "GOAL", true);

        const order = this.horses.map((_, i) => i).sort((a, b) => this._dist[a] - this._dist[b]);
        order.forEach((i) => this._drawRetroHorse(i, 80 + this._dist[i] * worldScale - scroll, turfY + 49 + i * 30, elapsed));

        // 放送画面風のフレーム。
        const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.78);
        vignette.addColorStop(0, "rgba(0,0,0,0)");
        vignette.addColorStop(1, "rgba(3,9,14,.38)");
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "rgba(4,10,16,.82)";
        ctx.fillRect(14, 14, 184, 34);
        ctx.fillStyle = "#ffd75b";
        ctx.font = "900 19px monospace";
        ctx.textAlign = "left";
        ctx.fillText("RETRO RACE LIVE", 28, 37);
    }

    _drawRetroMarker(x, top, bottom, label, checker) {
        if (x < -70 || x > this.W + 70) return;
        const ctx = this.ctx;
        ctx.fillStyle = checker ? "#f4f4ed" : "#d73d36";
        ctx.fillRect(x - 3, top, 6, bottom - top);
        ctx.fillStyle = "#111820";
        ctx.fillRect(x - 42, top - 24, 84, 25);
        ctx.fillStyle = "#ffe27a";
        ctx.font = "900 16px monospace";
        ctx.textAlign = "center";
        ctx.fillText(label, x, top - 6);
        if (checker) {
            for (let y = top; y < bottom; y += 12) {
                ctx.fillStyle = ((y - top) / 12) % 2 ? "#111" : "#fff";
                ctx.fillRect(x - 3, y, 6, 12);
            }
        }
    }

    _drawRetroHorse(i, x, y, elapsed) {
        const ctx = this.ctx;
        const horse = this.horses[i];
        const moving = this._dist[i] < TRACK_LEN - 0.5;
        const phase = elapsed * 18 + i * 0.8;
        const bob = moving ? Math.sin(phase) * 2.2 : 0;
        const image = this.portraits?.[i];

        ctx.fillStyle = "rgba(23,16,10,.28)";
        ctx.beginPath();
        ctx.ellipse(x, y + 13, 25, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        if (moving) {
            for (let p = 1; p <= 3; p++) {
                ctx.fillStyle = `rgba(238,214,174,${0.22 / p})`;
                ctx.beginPath();
                ctx.arc(x - 27 - p * 10, y + 9 + Math.sin(phase + p) * 3, 7 - p, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.save();
        ctx.translate(Math.round(x), Math.round(y + bob));
        if (image?.complete && image.naturalWidth) {
            ctx.drawImage(image, -26, -26, 52, 52);
        } else {
            ctx.fillStyle = horse.color;
            ctx.beginPath();
            ctx.ellipse(0, 0, 23, 12, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.strokeStyle = "#352217";
        ctx.lineWidth = 3;
        const kick = moving ? Math.sin(phase) * 9 : 0;
        ctx.beginPath();
        ctx.moveTo(-12, 13); ctx.lineTo(-17 - kick, 24);
        ctx.moveTo(10, 13); ctx.lineTo(16 + kick, 24);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = horse.color;
        ctx.beginPath();
        ctx.arc(x, y - 25 + bob, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "900 12px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(horse.id + 1), x, y - 24 + bob);
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
