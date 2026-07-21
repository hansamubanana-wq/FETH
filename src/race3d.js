import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

const HORSE_MODEL_URL = "https://threejs.org/examples/models/gltf/Horse.glb";
const TRACK_LEN = 820;
const VENUE_SCALE = 1.22;
const CENTER_RX_SCALE = 0.13 * VENUE_SCALE;
const CENTER_RZ_SCALE = 0.16 * VENUE_SCALE;
const LANE_SPREAD = 0.13;
const PLAYBACK_SPEED = 1.25;
const COAT_COLORS = [0x8b3f24, 0x5a321f, 0x3b2a24, 0xb9783f, 0x6d5141, 0xd8c8aa, 0x9b4f2e, 0x24211f];
const HIGH_PIXEL_RATIO = 2;
const FALLBACK_PIXEL_RATIO = 1.5;
const FPS_SAMPLE_MS = 3000;
const MIN_ACCEPTABLE_FPS = 30;

// 動的カメラの設定
const FULL_VIEW_HEIGHT = 78;   // 拡大した会場全体が収まる最大ズームアウト
const MIN_VIEW_HEIGHT = 36;    // 馬群と頭上表示を保ったまま背景の流れを見せる
const VIEW_MARGIN_X = 9;       // 画面左右の余白(ワールド単位)。アビリティ表示の横幅も考慮
const VIEW_MARGIN_Y = 4;       // 画面上下の余白(ワールド単位)
const LABEL_HEADROOM = 15;     // 馬番プレート・アビリティ表示ぶんの頭上余白
const CAM_POS_SMOOTH = 3.2;    // カメラ位置の追従速度(大きいほど機敏)
const CAM_ZOOM_SMOOTH = 2.2;   // ズームの追従速度

export class Race3DRenderer {
    constructor(canvas, horses, data, layout, onProgress = null) {
        this.canvas = canvas;
        this.horses = horses;
        this.data = data;
        this.layout = layout;
        this.onProgress = onProgress;
        this.clock = new THREE.Clock();
        this.ready = false;
        this.mixers = [];
        this.horseGroups = [];
        this.numberPlates = [];
        this.boostLabels = [];
        this.boostRings = [];
        this.sprayCursor = 0;
        this.sprayAccumulator = 0;
        this.flashClock = 0;
        this.visionLastUpdate = -1;
        this.startDoors = [];
        // 事前計算済みレースデータから決めるため、同じレースは全端末で同じ空になる。
        this.skyTheme = Math.floor(data.finishTime.reduce((sum, value) => sum + value, 0) * 1000) % 3;
        this.timeOfDay = ["day", "sunset", "night"][this.skyTheme];

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x8cc3e3);
        const fogColors = [0xa9d4ea, 0x8a6674, 0x10182d];
        this.scene.fog = new THREE.Fog(fogColors[this.skyTheme], 110, 260);
        this.clouds = [];
        this.flags = [];
        this.confetti = null;
        this.confettiLaunched = false;
        this.finishedAt = new Array(horses.length).fill(null); // ゴール後の流し走行用
        this.finishRank = new Array(horses.length).fill(0);

        this.camera = new THREE.OrthographicCamera(-62, 62, 35, -35, 0.1, 300);
        this.cameraOffset = new THREE.Vector3(0, 52, 72);
        this.cameraOffsetCurrent = this.cameraOffset.clone();
        this.viewTarget = new THREE.Vector3(0, 0, 0);
        this.viewHeight = FULL_VIEW_HEIGHT;
        this.aspect = 16 / 9;
        this.camera.position.copy(this.cameraOffset);
        this.camera.up.set(0, 0, -1);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: false,
            powerPreference: "high-performance",
        });
        this.qualityLevel = 0;
        this.performanceSample = { startedAt: performance.now(), frames: 0 };
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, HIGH_PIXEL_RATIO));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        this.root = new THREE.Group();
        this.scene.add(this.root);
        this._buildWorld();
        this._buildRaceEffects();
        this.readyPromise = this._loadHorseModel();
        this.resize();
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const width = Math.max(320, Math.floor(rect.width || this.canvas.clientWidth || 960));
        const height = Math.max(240, Math.floor(width * 0.5625));
        this.renderer.setSize(width, height, false);
        this.aspect = width / height;
        this._applyFrustum();
    }

    _applyFrustum() {
        const frustumWidth = this.viewHeight * this.aspect;
        this.camera.left = -frustumWidth / 2;
        this.camera.right = frustumWidth / 2;
        this.camera.top = this.viewHeight / 2;
        this.camera.bottom = -this.viewHeight / 2;
        this.camera.updateProjectionMatrix();
    }

    // 全馬(=1位から最下位まで)が必ず画面に収まるようにカメラの注視点とズームを更新する
    _updateCamera(distances, dt) {
        if (!distances || !distances.length) return;

        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);

        let minR = Infinity, maxR = -Infinity, minU = Infinity, maxU = -Infinity;
        const point = new THREE.Vector3();
        for (let i = 0; i < distances.length; i++) {
            const pose = this._pose(distances[i], this.layout.off[i]);
            // 足元と、頭上のプレート表示ぶんの2点をスクリーン軸に投影して範囲を取る
            for (const headY of [0, LABEL_HEADROOM]) {
                point.copy(pose.position);
                point.y += headY;
                const r = point.dot(right);
                const u = point.dot(up);
                if (r < minR) minR = r;
                if (r > maxR) maxR = r;
                if (u < minU) minU = u;
                if (u > maxU) maxU = u;
            }
        }
        if (!Number.isFinite(minR)) return;

        const needWidth = (maxR - minR) + VIEW_MARGIN_X * 2;
        const needHeight = (maxU - minU) + VIEW_MARGIN_Y * 2;
        const progress = Math.max(...distances) / TRACK_LEN;
        const finalStraight = THREE.MathUtils.smoothstep(progress, 0.72, 0.9) * (1 - THREE.MathUtils.smoothstep(progress, 0.99, 1.04));
        const desiredHeight = Math.min(
            FULL_VIEW_HEIGHT,
            Math.max(MIN_VIEW_HEIGHT - finalStraight * 3, needHeight, needWidth / this.aspect)
        );

        // 馬群の中心をスクリーン軸上の中点から復元(視線方向の成分は写りに影響しない)
        const desiredTarget = new THREE.Vector3()
            .addScaledVector(right, (minR + maxR) / 2)
            .addScaledVector(up, (minU + maxU) / 2);

        const posK = 1 - Math.exp(-CAM_POS_SMOOTH * dt);
        const zoomK = 1 - Math.exp(-CAM_ZOOM_SMOOTH * dt);
        this.viewTarget.lerp(desiredTarget, posK);
        this.viewHeight += (desiredHeight - this.viewHeight) * zoomK;

        // 最終直線だけ視点を低く近づける。フラスタム寸法は全馬の投影範囲から先に算出するため、
        // 迫力を増しても先頭・最後尾と頭上表示は必ず画面内に残る。
        const cinematicOffset = new THREE.Vector3(0, 43, 62);
        const wantedOffset = this.cameraOffset.clone().lerp(cinematicOffset, finalStraight);
        this.cameraOffsetCurrent.lerp(wantedOffset, 1 - Math.exp(-2.8 * dt));

        this.camera.position.copy(this.viewTarget).add(this.cameraOffsetCurrent);
        this.camera.up.set(0, 0, -1);
        this.camera.lookAt(this.viewTarget);
        this._applyFrustum();
    }

    render(distances, elapsed = 0) {
        this.resize();
        const dt = Math.min(0.05, this.clock.getDelta());
        // 再生尺の短縮率と同期させ、脚だけがゆっくり見えたり早送りに見えたりするのを防ぐ。
        for (const mixer of this.mixers) mixer.update(dt * 1.9 * PLAYBACK_SPEED);

        // 雲をゆっくり流す
        for (const cloud of this.clouds) {
            cloud.position.x += cloud.userData.speed * dt;
            if (cloud.position.x > 130) cloud.position.x = -130;
        }
        for (const flag of this.flags) {
            const wave = Math.sin(elapsed * 4.2 + flag.userData.phase);
            flag.rotation.y = flag.userData.baseYaw + wave * 0.18;
            flag.scale.x = 0.92 + wave * 0.08;
        }

        // 1着馬のゴールで紙吹雪
        if (!this.confettiLaunched && distances.some((d) => d >= TRACK_LEN - 0.5)) {
            this.confettiLaunched = true;
            this._spawnConfetti();
        }
        this._updateConfetti(dt);

        const leader = distances
            .map((d, i) => ({ d, i }))
            .sort((a, b) => b.d - a.d)[0]?.i ?? 0;
        this._updateVision(distances, elapsed);
        this._updateStartGate(elapsed);
        this._updateRaceEffects(distances, leader, elapsed, dt);
        this._updateSpeedLines(distances, leader, elapsed);

        // ゴールした馬はラインで急停止せず、先着ほど遠くまで流して走り抜ける
        const effDist = distances.map((d, i) => {
            if (d < TRACK_LEN - 0.5) return d;
            if (this.finishedAt[i] === null) {
                this.finishedAt[i] = elapsed;
                this.finishRank[i] = this.finishedAt.filter((t) => t !== null).length - 1;
            }
            const target = 8 + (this.horses.length - 1 - this.finishRank[i]) * 8;
            const runout = target * (1 - Math.exp(-(elapsed - this.finishedAt[i]) * 1.1));
            return d + Math.max(0, runout);
        });
        this._updateCamera(effDist, dt);

        this.horseGroups.forEach((group, i) => {
            const pose = this._pose(effDist[i], this.layout.off[i]);
            group.position.copy(pose.position);
            group.rotation.y = pose.yaw + Math.PI * 1.5;
            group.visible = true;

            const t = distances[i] / TRACK_LEN;
            const boosting = distances[i] < TRACK_LEN - 0.5 &&
                this.data.abLabel[i] &&
                t >= this.data.abFrom[i] &&
                t <= this.data.abTo[i];

            const plate = this.numberPlates[i];
            if (plate) {
                // 馬の真上に高めに浮かせて、馬体と被らないようにする
                plate.position.copy(pose.position).add(new THREE.Vector3(0, 8.4, 0));
                plate.quaternion.copy(this.camera.quaternion);
                plate.scale.setScalar(boosting ? 1.2 + Math.sin(elapsed * 22) * 0.08 : 1);
                plate.visible = true;
            }

            const ring = this.boostRings[i];
            ring.visible = boosting || i === leader;
            ring.material.color.set(boosting ? 0xff8a00 : 0xffd34d);
            ring.material.opacity = boosting ? 0.95 : 0.36;
            ring.scale.setScalar(boosting ? 1.6 + Math.sin(elapsed * 24) * 0.22 : 1);
            ring.position.copy(pose.position).add(new THREE.Vector3(0, 0.08, 0));

            const boostLabel = this.boostLabels[i];
            if (boostLabel) {
                boostLabel.visible = Boolean(boosting);
                boostLabel.position.copy(pose.position).add(new THREE.Vector3(0, 12.2 + Math.sin(elapsed * 12) * 0.4, 0));
                boostLabel.quaternion.copy(this.camera.quaternion);
                boostLabel.scale.setScalar(1.1 + Math.sin(elapsed * 18) * 0.12); // 鼓動するように拡縮
            }
        });

        this.renderer.render(this.scene, this.camera);
        // 検証用フック。window.__raceLog を配列にした時だけ記録する(通常時は何もしない)。
        // scripts/verify-camera-framing.mjs が全馬のフレームインを判定するのに使う。
        if (window.__raceLog) {
            const prog = Math.max(...distances) / TRACK_LEN;
            let worst = 0, outN = 0;
            for (const g of this.horseGroups) {
                const p = g.position.clone(); p.y += LABEL_HEADROOM; p.project(this.camera);
                const ax = Math.abs(p.x), ay = Math.abs(p.y);
                if (Math.max(ax, ay) > worst) worst = Math.max(ax, ay);
                if (ax > 1 || ay > 1) outN++;
            }
            window.__raceLog.push({ p: +prog.toFixed(3), oy: +this.cameraOffsetCurrent.y.toFixed(1), vh: +this.viewHeight.toFixed(1), w: +worst.toFixed(3), o: outN });
        }
        this._monitorPerformance();
    }

    dispose() {
        if (this.spray?.mesh) {
            this.spray.mesh.geometry.dispose();
            this.spray.mesh.material.dispose();
        }
        this.renderer.dispose();
    }

    _monitorPerformance() {
        const now = performance.now();
        const sample = this.performanceSample;
        const duration = now - sample.startedAt;
        // バックグラウンド復帰直後の長い停止は端末性能として扱わない。
        if (duration > FPS_SAMPLE_MS * 2) {
            sample.startedAt = now;
            sample.frames = 0;
            return;
        }
        sample.frames++;
        if (duration < FPS_SAMPLE_MS) return;

        const fps = sample.frames * 1000 / duration;
        sample.startedAt = now;
        sample.frames = 0;
        if (fps < MIN_ACCEPTABLE_FPS && this.qualityLevel < 3) {
            this._applyQualityFallback(this.qualityLevel + 1);
        }
    }

    _applyQualityFallback(level) {
        this.qualityLevel = level;
        if (level === 1) {
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, FALLBACK_PIXEL_RATIO));
            this.resize();
        } else if (level === 2) {
            this.renderer.shadowMap.enabled = false;
        }
        // level 3 は生成・更新時に砂埃、フラッシュ、紙吹雪を半数に抑える。
        console.info(`3D quality fallback: level ${level}`);
    }

    _buildRaceEffects() {
        const count = 144;
        const geometry = new THREE.IcosahedronGeometry(0.18, 0);
        const material = new THREE.MeshBasicMaterial({ color: 0xc8ad78, transparent: true, opacity: 0.72 });
        const mesh = new THREE.InstancedMesh(geometry, material, count);
        mesh.frustumCulled = false;
        const particles = Array.from({ length: count }, () => ({
            active: false, life: 0, maxLife: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), scale: 0,
        }));
        const hidden = new THREE.Object3D();
        hidden.scale.setScalar(0);
        hidden.updateMatrix();
        for (let i = 0; i < count; i++) mesh.setMatrixAt(i, hidden.matrix);
        this.spray = { mesh, particles };
        this.root.add(mesh);

        // 馬の進行方向と逆へ流れる短い線。ポストエフェクトを使わない軽量な疑似モーションブラー。
        const lineCount = 54;
        const linePositions = new Float32Array(lineCount * 2 * 3);
        const lineGeometry = new THREE.BufferGeometry();
        lineGeometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
        const lineMaterial = new THREE.LineBasicMaterial({
            color: 0xf7e4bb, transparent: true, opacity: 0.22, depthWrite: false,
        });
        this.speedLines = new THREE.LineSegments(lineGeometry, lineMaterial);
        this.speedLines.frustumCulled = false;
        this.root.add(this.speedLines);

        this.flashLights = Array.from({ length: 10 }, (_, i) => {
            const light = new THREE.PointLight(0xeaf6ff, 0, 38, 2);
            const a = Math.PI * (0.08 + (i / 10) * 0.84);
            light.position.set(Math.cos(a) * 54, 12 + (i % 3) * 4, Math.sin(a) * 31);
            light.userData.phase = i * 0.73;
            this.scene.add(light);
            return light;
        });

        this.winnerSpot = new THREE.SpotLight(0xffe7a0, 0, 52, Math.PI / 8, 0.55, 1.4);
        this.winnerSpot.castShadow = false;
        this.winnerSpot.target = new THREE.Object3D();
        this.scene.add(this.winnerSpot, this.winnerSpot.target);
    }

    _updateRaceEffects(distances, leader, elapsed, dt) {
        const progress = Math.max(...distances) / TRACK_LEN;
        const leaders = distances.map((d, i) => ({ d, i })).sort((a, b) => b.d - a.d).slice(0, 3);
        const particleScale = this.qualityLevel >= 3 ? 0.5 : 1;
        const sprayCount = Math.max(1, Math.floor(this.spray.particles.length * particleScale));
        const speedFactor = PLAYBACK_SPEED * (0.82 + Math.min(1, progress) * 0.3);
        this.sprayAccumulator += dt * 48 * speedFactor * particleScale;
        while (this.sprayAccumulator >= 1 && progress < 1.02) {
            this.sprayAccumulator -= 1;
            const runner = leaders[this.sprayCursor % leaders.length];
            const pose = this._pose(runner.d, this.layout.off[runner.i]);
            const p = this.spray.particles[this.sprayCursor++ % sprayCount];
            const back = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), pose.yaw);
            p.active = true;
            p.life = p.maxLife = 0.42 + Math.random() * 0.28;
            p.pos.copy(pose.position).addScaledVector(back, -1.35).add(new THREE.Vector3((Math.random() - 0.5) * 0.9, 0.18, (Math.random() - 0.5) * 0.9));
            p.vel.copy(back).multiplyScalar((-2.5 - Math.random() * 2) * speedFactor).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 1.2 + Math.random() * 1.6, (Math.random() - 0.5) * 1.5));
            p.scale = 0.65 + Math.random() * 1.2;
        }
        const dummy = new THREE.Object3D();
        this.spray.particles.forEach((p, i) => {
            if (p.active) {
                p.life -= dt;
                p.active = p.life > 0;
                p.vel.y -= 4.5 * dt;
                p.pos.addScaledVector(p.vel, dt);
            }
            dummy.position.copy(p.pos);
            dummy.scale.setScalar(p.active ? p.scale * Math.max(0.08, p.life / p.maxLife) : 0);
            dummy.updateMatrix();
            this.spray.mesh.setMatrixAt(i, dummy.matrix);
        });
        this.spray.mesh.instanceMatrix.needsUpdate = true;

        const inFinalStraight = progress > 0.72 && progress < 1;
        this.flashClock += dt;
        this.flashLights.forEach((light, i) => {
            const pulse = Math.sin(elapsed * 18 + light.userData.phase * 9) > 0.965;
            const enabled = this.qualityLevel < 3 || i % 2 === 0;
            light.intensity = enabled && inFinalStraight && pulse ? 8 : 0;
        });

        const winner = this.data.order?.[0] ?? leader;
        const finished = distances[winner] >= TRACK_LEN - 0.5;
        if (finished && this.horseGroups[winner]) {
            const pos = this.horseGroups[winner].position;
            this.winnerSpot.intensity = 7 + Math.sin(elapsed * 3) * 0.7;
            this.winnerSpot.position.copy(pos).add(new THREE.Vector3(-5, 24, 8));
            this.winnerSpot.target.position.copy(pos);
            this.winnerSpot.target.updateMatrixWorld();
        } else {
            this.winnerSpot.intensity = 0;
        }
    }

    _updateSpeedLines(distances, leader, elapsed) {
        if (!this.speedLines) return;
        const progress = Math.max(...distances) / TRACK_LEN;
        const pose = this._pose(distances[leader], this.layout.off[leader]);
        const tangent = new THREE.Vector3(Math.sin(pose.yaw), 0, Math.cos(pose.yaw));
        const side = new THREE.Vector3(tangent.z, 0, -tangent.x);
        const positions = this.speedLines.geometry.attributes.position.array;
        const count = positions.length / 6;
        for (let i = 0; i < count; i++) {
            const phase = (i * 0.61803398875 + elapsed * (0.72 + (i % 5) * 0.08)) % 1;
            const along = (phase - 0.5) * 56;
            const lateral = (((i * 37) % count) / count - 0.5) * 48;
            const height = 0.15 + ((i * 17) % 13) * 0.08;
            const start = pose.position.clone().addScaledVector(tangent, along).addScaledVector(side, lateral);
            start.y = height;
            const end = start.clone().addScaledVector(tangent, -(1.2 + (i % 4) * 0.65) * PLAYBACK_SPEED);
            positions.set([start.x, start.y, start.z, end.x, end.y, end.z], i * 6);
        }
        this.speedLines.geometry.attributes.position.needsUpdate = true;
        this.speedLines.visible = progress > 0.04 && progress < 1.02;
        this.speedLines.material.opacity = 0.12 + Math.min(1, progress) * 0.16;
    }

    _buildWorld() {
        const evening = this.timeOfDay === "sunset";
        const night = this.timeOfDay === "night";
        const hemi = new THREE.HemisphereLight(
            night ? 0x8ea8dd : (evening ? 0xffd0a6 : 0xfff3d6),
            night ? 0x071016 : (evening ? 0x172d32 : 0x27452b),
            night ? 0.72 : (evening ? 1.75 : 2.1)
        );
        this.scene.add(hemi);

        const sun = new THREE.DirectionalLight(
            night ? 0x9bbcff : (evening ? 0xffb06a : 0xffffff),
            night ? 0.55 : (evening ? 2.25 : 2.6)
        );
        sun.position.set(-46, 88, 42);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.bias = -0.0003;
        sun.shadow.camera.left = -90;
        sun.shadow.camera.right = 90;
        sun.shadow.camera.top = 90;
        sun.shadow.camera.bottom = -90;
        this.scene.add(sun);

        const turf = new THREE.Mesh(
            new THREE.PlaneGeometry(280, 190, 1, 1),
            new THREE.MeshStandardMaterial({
                color: 0x2d8a3b,
                map: this._createGrassTexture(),
                roughness: 0.94,
            })
        );
        turf.rotation.x = -Math.PI / 2;
        turf.receiveShadow = true;
        this.root.add(turf);

        this._addSky();
        this._addTrack();
        this._addRails();
        this._addDistanceMarkers();
        this._addGrandstand();
        this._addFinishGate();
        this._addInfield();
        this._addTrees();
        this._addFlags();
        if (this.timeOfDay === "night") this._addNightLighting();
    }

    // レーン幅の実寸(ワールド単位換算前のオフセット)。馬の走行ラインと路面を一致させる
    _laneMetrics() {
        const off = this.layout.off;
        const gap = off.length > 1 ? Math.abs(off[1] - off[0]) : 13;
        const half = ((this.horses.length - 1) / 2) * gap; // 最外レーン中心
        return { gap, half, edge: half + gap };            // edge = 路面の端
    }

    _addSky() {
        // 空: 上が濃く地平線が明るいグラデーション
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 512;
        const ctx = canvas.getContext("2d");
        const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
        const palettes = [
            ["#3d8ed3", "#8cc3e3", "#e3f2f9"],
            ["#182d55", "#8a5a74", "#f5b06a"],
            ["#020617", "#07152f", "#18294a"],
        ];
        const palette = palettes[this.skyTheme];
        g.addColorStop(0, palette[0]);
        g.addColorStop(0.52, palette[1]);
        g.addColorStop(1, palette[2]);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        this.scene.background = tex;

        if (this.timeOfDay === "night") {
            const starCount = 220;
            const positions = new Float32Array(starCount * 3);
            for (let i = 0; i < starCount; i++) {
                const angle = (i * 2.399963 + this.skyTheme) % (Math.PI * 2);
                const radius = 92 + ((i * 37) % 75);
                positions[i * 3] = Math.cos(angle) * radius;
                positions[i * 3 + 1] = 36 + ((i * 29) % 62);
                positions[i * 3 + 2] = Math.sin(angle) * radius - 28;
            }
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
            const stars = new THREE.Points(
                geometry,
                new THREE.PointsMaterial({ color: 0xeaf3ff, size: 0.7, transparent: true, opacity: 0.92, fog: false })
            );
            this.scene.add(stars);
        }

        // ゆっくり流れる雲
        const cloudTex = this._makeCloudTexture();
        for (let i = 0; i < 7; i++) {
            const mat = new THREE.SpriteMaterial({
                map: cloudTex,
                transparent: true,
                opacity: (this.skyTheme ? 0.42 : 0.7) + Math.random() * 0.2,
                depthWrite: false,
                fog: false,
            });
            const cloud = new THREE.Sprite(mat);
            const scale = 26 + Math.random() * 24;
            cloud.scale.set(scale, scale * 0.42, 1);
            cloud.position.set(-120 + Math.random() * 240, 36 + Math.random() * 22, -70 - Math.random() * 45);
            cloud.userData.speed = 1 + Math.random() * 1.6;
            this.clouds.push(cloud);
            this.scene.add(cloud);
        }
    }

    _makeCloudTexture() {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 128;
        const ctx = canvas.getContext("2d");
        for (let i = 0; i < 18; i++) {
            const x = 40 + Math.random() * 176;
            const y = 45 + Math.random() * 45;
            const r = 18 + Math.random() * 26;
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, "rgba(255,255,255,0.85)");
            grad.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    _addTrack() {
        const { gap, edge } = this._laneMetrics();
        // 路面: 内外の楕円で囲んだ一枚のリング。馬の全レーンがちょうど収まる幅にする
        const rxO = this.layout.rx * CENTER_RX_SCALE + edge * LANE_SPREAD;
        const rzO = this.layout.ry * CENTER_RZ_SCALE + edge * LANE_SPREAD;
        const rxI = this.layout.rx * CENTER_RX_SCALE - edge * LANE_SPREAD;
        const rzI = this.layout.ry * CENTER_RZ_SCALE - edge * LANE_SPREAD;
        const shape = new THREE.Shape();
        shape.absellipse(0, 0, rxO, rzO, 0, Math.PI * 2, false, 0);
        const hole = new THREE.Path();
        hole.absellipse(0, 0, rxI, rzI, 0, Math.PI * 2, true, 0);
        shape.holes.push(hole);
        const dirt = new THREE.Mesh(
            new THREE.ShapeGeometry(shape, 96),
            new THREE.MeshStandardMaterial({ map: this._createDirtTexture(), roughness: 0.92 })
        );
        dirt.rotation.x = -Math.PI / 2;
        dirt.position.y = 0.02;
        dirt.receiveShadow = true;
        this.root.add(dirt);

        // レーン区切りの白線
        const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 });
        for (let k = 1; k < this.horses.length; k++) {
            const boundary = (k - this.horses.length / 2) * gap;
            const line = new THREE.LineLoop(
                new THREE.BufferGeometry().setFromPoints(this._ovalPoints(boundary, 260)),
                lineMat
            );
            line.position.y = 0.07;
            this.root.add(line);
        }
    }

    _createDirtTexture() {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#b07a40";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < 2600; i++) {
            const x = Math.random() * canvas.width;
            const y = Math.random() * canvas.height;
            const light = 30 + Math.random() * 26;
            ctx.fillStyle = `hsla(${26 + Math.random() * 10}, ${38 + Math.random() * 18}%, ${light}%, ${0.25 + Math.random() * 0.35})`;
            ctx.fillRect(x, y, 1 + Math.random() * 3, 1 + Math.random() * 2);
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1 / 10, 1 / 10); // ShapeGeometryのUVはワールド座標なので縮めて敷き詰める
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        return texture;
    }

    _createGrassTexture() {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext("2d");
        for (let x = 0; x < canvas.width; x += 16) {
            ctx.fillStyle = (x / 16) % 2 ? "#236d30" : "#2d8138";
            ctx.fillRect(x, 0, 16, canvas.height);
        }
        for (let i = 0; i < 3600; i++) {
            const x = Math.random() * canvas.width;
            const y = Math.random() * canvas.height;
            const len = 4 + Math.random() * 9;
            const hue = 105 + Math.random() * 28;
            const light = 24 + Math.random() * 24;
            ctx.strokeStyle = `hsla(${hue}, 55%, ${light}%, ${0.28 + Math.random() * 0.38})`;
            ctx.lineWidth = Math.random() < 0.85 ? 1 : 2;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.random() * 3 - 1.5, y - len);
            ctx.stroke();
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(8, 6);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        return texture;
    }

    _addRails() {
        const { edge } = this._laneMetrics();
        const railMat = new THREE.MeshStandardMaterial({ color: 0xf7f5ea, roughness: 0.28, metalness: 0.08 });
        [-edge, edge].forEach((offset) => {
            const curve = new THREE.CatmullRomCurve3(this._ovalPoints(offset, 260), true);
            const rail = new THREE.Mesh(new THREE.TubeGeometry(curve, 260, 0.12, 8, true), railMat);
            rail.position.y = 0.9;
            rail.castShadow = true;
            this.root.add(rail);

            for (let i = 0; i < 96; i++) {
                const p = this._pose((i / 96) * TRACK_LEN, offset);
                const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.9, 8), railMat);
                post.position.copy(p.position);
                post.position.y = 0.45;
                post.castShadow = true;
                this.root.add(post);
            }
        });
    }

    _addDistanceMarkers() {
        const { edge } = this._laneMetrics();
        const poleMat = new THREE.MeshStandardMaterial({ color: 0xf7f5ea, roughness: 0.5 });
        const redMat = new THREE.MeshStandardMaterial({ color: 0xd32f2f, roughness: 0.55 });
        for (let i = 1; i <= 16; i++) {
            const p = this._pose((i / 16) * TRACK_LEN, edge + 3.4);
            const group = new THREE.Group();
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 3.7, 8), poleMat);
            pole.position.y = 1.85;
            const cap = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.15, 0.34), i % 2 ? redMat : poleMat);
            cap.position.y = 3.35;
            group.add(pole, cap);
            group.position.copy(p.position);
            group.rotation.y = p.yaw;
            group.traverse((obj) => { if (obj.isMesh) obj.castShadow = true; });
            this.root.add(group);
        }
    }

    _addGrandstand() {
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x263a4d, roughness: 0.65 });
        const glassMat = new THREE.MeshStandardMaterial({ color: 0x9bd5ff, roughness: 0.18, metalness: 0.1 });
        const stand = new THREE.Mesh(new THREE.BoxGeometry(54, 8, 8), baseMat);
        stand.position.set(-8, 4, -55);
        stand.castShadow = true;
        stand.receiveShadow = true;
        this.root.add(stand);

        const roof = new THREE.Mesh(new THREE.BoxGeometry(62, 1.2, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }));
        roof.position.set(-8, 9.1, -55);
        roof.castShadow = true;
        this.root.add(roof);

        // 屋根のトラック側に赤いファサード(競馬場らしいアクセント)
        const fascia = new THREE.Mesh(
            new THREE.BoxGeometry(62, 0.9, 0.3),
            new THREE.MeshStandardMaterial({ color: 0xc62828, roughness: 0.5 })
        );
        fascia.position.set(-8, 8.6, -48.9);
        this.root.add(fascia);

        for (let i = 0; i < 13; i++) {
            const pane = new THREE.Mesh(new THREE.BoxGeometry(2.4, 4.4, 0.16), glassMat);
            pane.position.set(-34 + i * 4.4, 5.5, -50.9);
            this.root.add(pane);
        }

        // トラック側へ下る段々のひな壇と、そこを埋めるカラフルな観客
        const rows = 6;
        const stepMat = new THREE.MeshStandardMaterial({ color: 0x3a5069, roughness: 0.8 });
        const crowdGeo = new THREE.BoxGeometry(0.55, 0.85, 0.42);
        const perRow = 56;
        const crowd = new THREE.InstancedMesh(
            crowdGeo,
            new THREE.MeshStandardMaterial({ roughness: 0.85 }),
            rows * perRow
        );
        crowd.castShadow = true;
        const dummy = new THREE.Object3D();
        const color = new THREE.Color();
        let idx = 0;
        for (let r = 0; r < rows; r++) {
            // 手前(トラック側)の列ほど低く、奥へ行くほど高いひな壇
            const stepZ = -44.6 - r * 1.35;
            const stepY = 0.45 + r * 0.8;
            const step = new THREE.Mesh(new THREE.BoxGeometry(54, 0.8, 1.35), stepMat);
            step.position.set(-8, stepY - 0.4, stepZ);
            step.receiveShadow = true;
            step.castShadow = true;
            this.root.add(step);
            for (let c = 0; c < perRow; c++) {
                if (Math.random() < 0.06) continue; // 少量だけ空席をつくる
                dummy.position.set(
                    -34 + (c / (perRow - 1)) * 52 + (Math.random() - 0.5) * 0.5,
                    stepY + 0.42,
                    stepZ + (Math.random() - 0.5) * 0.4
                );
                dummy.rotation.y = (Math.random() - 0.5) * 0.5;
                dummy.updateMatrix();
                crowd.setMatrixAt(idx, dummy.matrix);
                color.setHSL(Math.random(), 0.55 + Math.random() * 0.3, 0.5 + Math.random() * 0.25);
                crowd.setColorAt(idx, color);
                idx++;
            }
        }
        crowd.count = idx;
        crowd.instanceMatrix.needsUpdate = true;
        if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
        this.root.add(crowd);
    }

    _addFinishGate() {
        // スタート/ゴール地点は dist=0 の位置 (x=0, z=+rz)。路面の幅いっぱいに市松ラインとゲートを架ける
        const { edge } = this._laneMetrics();
        const rzC = this.layout.ry * CENTER_RZ_SCALE;
        const zI = rzC - edge * LANE_SPREAD;
        const zO = rzC + edge * LANE_SPREAD;
        const mat = new THREE.MeshStandardMaterial({ color: 0xf4ead0, roughness: 0.2, metalness: 0.48 });
        const red = new THREE.MeshStandardMaterial({ color: 0xa71616, roughness: 0.25, metalness: 0.35, emissive: 0x2c0303 });

        [zI - 1.3, zO + 1.3].forEach((pz) => {
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 8.5, 12), mat);
            post.position.set(0, 4.25, pz);
            post.castShadow = true;
            this.root.add(post);
        });
        const barLen = zO - zI + 2.6;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, barLen), red);
        bar.position.set(0, 8.8, (zI + zO) / 2);
        bar.castShadow = true;
        this.root.add(bar);

        // ゴール上の電光掲示板。CanvasTextureで発光文字と金属フレームを作る。
        const boardCanvas = document.createElement("canvas");
        boardCanvas.width = 512;
        boardCanvas.height = 128;
        const bctx = boardCanvas.getContext("2d");
        bctx.fillStyle = "#080b10";
        bctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
        bctx.strokeStyle = "#d8aa3f";
        bctx.lineWidth = 12;
        bctx.strokeRect(6, 6, 500, 116);
        bctx.fillStyle = "#ffd85a";
        bctx.shadowColor = "#ff9d00";
        bctx.shadowBlur = 22;
        bctx.font = "900 62px Arial";
        bctx.textAlign = "center";
        bctx.textBaseline = "middle";
        bctx.fillText("FINISH", 256, 66);
        const boardTex = new THREE.CanvasTexture(boardCanvas);
        boardTex.colorSpace = THREE.SRGBColorSpace;
        const board = new THREE.Mesh(
            new THREE.PlaneGeometry(13, 3.25),
            new THREE.MeshStandardMaterial({ map: boardTex, emissiveMap: boardTex, emissive: 0x5a3100, roughness: 0.28, metalness: 0.32, side: THREE.DoubleSide })
        );
        board.rotation.y = Math.PI / 2;
        board.position.set(0, 11.1, (zI + zO) / 2);
        this.root.add(board);

        // ゲートの下に連なる三角フラッグ(カメラ側を向ける)
        const flagColors = [0xffd34d, 0xff7043, 0x4fc3f7, 0x81c784, 0xf06292];
        const flagCount = 9;
        for (let i = 0; i < flagCount; i++) {
            const flag = new THREE.Mesh(
                new THREE.CircleGeometry(0.62, 3),
                new THREE.MeshBasicMaterial({ color: flagColors[i % flagColors.length], side: THREE.DoubleSide })
            );
            flag.rotation.z = Math.PI; // 逆三角形
            flag.position.set(0, 7.7, zI + ((i + 0.5) / flagCount) * (zO - zI));
            this.root.add(flag);
        }

        // 市松模様のフィニッシュライン(テクスチャ1枚)
        const checker = document.createElement("canvas");
        checker.width = 64;
        checker.height = 256;
        const cctx = checker.getContext("2d");
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 2; c++) {
                cctx.fillStyle = (r + c) % 2 === 0 ? "#ffffff" : "#111111";
                cctx.fillRect(c * 32, r * 32, 32, 32);
            }
        }
        const checkerTex = new THREE.CanvasTexture(checker);
        checkerTex.colorSpace = THREE.SRGBColorSpace;
        const strip = new THREE.Mesh(
            new THREE.PlaneGeometry(2.4, zO - zI),
            new THREE.MeshBasicMaterial({ map: checkerTex, side: THREE.DoubleSide })
        );
        strip.rotation.x = -Math.PI / 2;
        strip.position.set(0, 0.15, (zI + zO) / 2);
        strip.renderOrder = 5;
        this.root.add(strip);

        // 発馬機の各枠。レース開始直後に前扉が左右へ開く。
        const stallDepth = (zO - zI) / this.horses.length;
        const gateMat = new THREE.MeshStandardMaterial({ color: 0xd9e2e8, roughness: 0.42, metalness: 0.62 });
        const doorMat = new THREE.MeshStandardMaterial({ color: 0x1f6d42, roughness: 0.38, metalness: 0.38 });
        for (let i = 0; i <= this.horses.length; i++) {
            const z = zI + i * stallDepth;
            const rail = new THREE.Mesh(new THREE.BoxGeometry(2.8, 2.7, 0.09), gateMat);
            rail.position.set(-1.15, 1.45, z);
            this.root.add(rail);
        }
        for (let i = 0; i < this.horses.length; i++) {
            const z = zI + (i + 0.5) * stallDepth;
            [-1, 1].forEach((side) => {
                const pivot = new THREE.Group();
                pivot.position.set(0.22, 1.45, z + side * stallDepth * 0.24);
                const door = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.65, stallDepth * 0.46), doorMat);
                door.position.z = -side * stallDepth * 0.23;
                pivot.add(door);
                pivot.userData.side = side;
                this.startDoors.push(pivot);
                this.root.add(pivot);
            });
        }
    }

    _addInfield() {
        // 内馬場: 池と花壇でリゾート感を出す
        const pond = new THREE.Mesh(
            new THREE.CircleGeometry(1, 48),
            new THREE.MeshStandardMaterial({ color: 0x3f9fd8, roughness: 0.15, metalness: 0.25 })
        );
        pond.rotation.x = -Math.PI / 2;
        pond.scale.set(16, 8.5, 1);
        pond.position.set(-6, 0.06, 2);
        pond.receiveShadow = true;
        this.root.add(pond);

        const rim = new THREE.Mesh(
            new THREE.RingGeometry(0.97, 1.05, 48),
            new THREE.MeshStandardMaterial({ color: 0xd9cfa8, roughness: 0.9, side: THREE.DoubleSide })
        );
        rim.rotation.x = -Math.PI / 2;
        rim.scale.set(16.4, 8.8, 1);
        rim.position.set(-6, 0.065, 2);
        this.root.add(rim);

        // 内馬場の大型ビジョン。テクスチャ更新は最大1秒に1回。
        this.visionCanvas = document.createElement("canvas");
        this.visionCanvas.width = 512;
        this.visionCanvas.height = 288;
        this.visionCtx = this.visionCanvas.getContext("2d");
        this.visionTexture = new THREE.CanvasTexture(this.visionCanvas);
        this.visionTexture.colorSpace = THREE.SRGBColorSpace;
        const visionFrame = new THREE.Mesh(
            new THREE.BoxGeometry(14.8, 8.8, 0.65),
            new THREE.MeshStandardMaterial({ color: 0x161b22, roughness: 0.36, metalness: 0.72 })
        );
        // スタート／ゴール（手前側）の反対にある内馬場奥へ置き、走行レーンとの重なりを避ける。
        visionFrame.position.set(0, 5.4, -25);
        this.root.add(visionFrame);
        const vision = new THREE.Mesh(
            new THREE.PlaneGeometry(13.6, 7.6),
            new THREE.MeshBasicMaterial({ map: this.visionTexture })
        );
        vision.position.set(0, 5.4, -24.64);
        this.root.add(vision);
        for (const x of [-4.6, 4.6]) {
            const support = new THREE.Mesh(new THREE.BoxGeometry(0.55, 5.4, 0.55), new THREE.MeshStandardMaterial({ color: 0x30343b, metalness: 0.65 }));
            support.position.set(x, 2.7, -25);
            this.root.add(support);
        }
        this._paintVision(this.horses.map((_, i) => i).slice(0, 3));

        // 花壇: 色とりどりの小さなドットを帯状に散らす
        const flowerGeo = new THREE.SphereGeometry(0.22, 6, 5);
        const flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshStandardMaterial({ roughness: 0.7 }), 120);
        const dummy = new THREE.Object3D();
        const color = new THREE.Color();
        for (let i = 0; i < 120; i++) {
            const a = Math.random() * Math.PI * 2;
            const rr = 0.55 + Math.random() * 0.3;
            dummy.position.set(
                Math.cos(a) * (this.layout.rx * CENTER_RX_SCALE - 14) * rr - 2,
                0.14,
                Math.sin(a) * (this.layout.ry * CENTER_RZ_SCALE - 9) * rr + 1
            );
            const s = 0.7 + Math.random() * 0.7;
            dummy.scale.setScalar(s);
            dummy.updateMatrix();
            flowers.setMatrixAt(i, dummy.matrix);
            color.setHSL([0.0, 0.09, 0.13, 0.75, 0.93][Math.floor(Math.random() * 5)], 0.8, 0.6);
            flowers.setColorAt(i, color);
        }
        if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
        this.root.add(flowers);
    }

    _addTrees() {
        const { edge } = this._laneMetrics();
        const rxOut = this.layout.rx * CENTER_RX_SCALE + edge * LANE_SPREAD;
        const rzOut = this.layout.ry * CENTER_RZ_SCALE + edge * LANE_SPREAD;
        const count = 64;
        const trunkGeo = new THREE.CylinderGeometry(0.26, 0.4, 2.4, 6);
        const leafGeo = new THREE.IcosahedronGeometry(2.0, 0);
        const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 }), count);
        const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ roughness: 0.85 }), count);
        trunks.castShadow = true;
        leaves.castShadow = true;
        const dummy = new THREE.Object3D();
        const color = new THREE.Color();
        let placed = 0;
        let guard = 0;
        while (placed < count && guard++ < 1200) {
            const x = -104 + Math.random() * 208;
            const z = -66 + Math.random() * 134;
            // トラック上(周囲マージン込み)と観客席まわりは避ける
            const e = (x / (rxOut + 7)) ** 2 + (z / (rzOut + 7)) ** 2;
            const nearStand = x > -46 && x < 30 && z < -40;
            if (e < 1.15 || nearStand) continue;
            const s = 0.75 + Math.random() * 0.75;
            dummy.position.set(x, 1.2 * s, z);
            dummy.scale.setScalar(s);
            dummy.rotation.y = Math.random() * Math.PI;
            dummy.updateMatrix();
            trunks.setMatrixAt(placed, dummy.matrix);
            dummy.position.y = (2.4 + 1.1) * s;
            dummy.updateMatrix();
            leaves.setMatrixAt(placed, dummy.matrix);
            color.setHSL(0.29 + Math.random() * 0.08, 0.5 + Math.random() * 0.25, 0.26 + Math.random() * 0.14);
            leaves.setColorAt(placed, color);
            placed++;
        }
        trunks.count = placed;
        leaves.count = placed;
        if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
        this.root.add(trunks);
        this.root.add(leaves);
    }

    _addFlags() {
        // 外ラチ沿いに等間隔で立つカラフルなペナントフラッグ
        const { edge } = this._laneMetrics();
        const colors = [0xffd34d, 0xff7043, 0x4fc3f7, 0x81c784, 0xf06292, 0xba68c8];
        const poleMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.5 });
        const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 3.4, 6);
        const flagGeo = new THREE.PlaneGeometry(1.7, 0.75);
        for (let i = 0; i < 16; i++) {
            const p = this._pose(((i + 0.5) / 16) * TRACK_LEN, edge + 6);
            const pole = new THREE.Mesh(poleGeo, poleMat);
            pole.position.copy(p.position);
            pole.position.y = 1.7;
            pole.castShadow = true;
            this.root.add(pole);
            const flag = new THREE.Mesh(
                flagGeo,
                new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide })
            );
            flag.position.copy(p.position);
            flag.position.x += 0.85;
            flag.position.y = 3.05;
            flag.userData.phase = i * 0.83;
            flag.userData.baseYaw = p.yaw;
            flag.rotation.y = p.yaw;
            this.flags.push(flag);
            this.root.add(flag);
        }
    }

    // 1着馬がゴールした瞬間に紙吹雪を舞わせる
    _spawnConfetti() {
        const count = this.qualityLevel >= 3 ? 210 : 420;
        const rzC = this.layout.ry * CENTER_RZ_SCALE;
        const geo = new THREE.PlaneGeometry(0.6, 0.85);
        const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), count);
        const color = new THREE.Color();
        const parts = [];
        for (let i = 0; i < count; i++) {
            parts.push({
                pos: new THREE.Vector3((Math.random() - 0.5) * 10, 9 + Math.random() * 6, rzC + (Math.random() - 0.5) * 16),
                vel: new THREE.Vector3((Math.random() - 0.5) * 7, 2.5 + Math.random() * 5, (Math.random() - 0.5) * 7),
                rot: new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI),
                spin: 4 + Math.random() * 8,
            });
            const palette = [0xffd54f, 0xffffff, 0xe53935, 0x29b6f6, 0x66bb6a, 0xab47bc];
            color.setHex(palette[i % palette.length]);
            mesh.setColorAt(i, color);
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        this.scene.add(mesh);
        this.confetti = { mesh, parts, life: 0 };
    }

    _updateConfetti(dt) {
        if (!this.confetti) return;
        const c = this.confetti;
        c.life += dt;
        const dummy = new THREE.Object3D();
        for (let i = 0; i < c.parts.length; i++) {
            const p = c.parts[i];
            p.vel.y -= 6.5 * dt;          // 重力
            p.vel.multiplyScalar(1 - 0.9 * dt); // 空気抵抗でひらひら落ちる
            p.pos.addScaledVector(p.vel, dt);
            p.rot.x += p.spin * dt;
            p.rot.z += p.spin * 0.7 * dt;
            dummy.position.copy(p.pos);
            dummy.rotation.copy(p.rot);
            dummy.updateMatrix();
            c.mesh.setMatrixAt(i, dummy.matrix);
        }
        c.mesh.instanceMatrix.needsUpdate = true;
        if (c.life > 7) {
            this.scene.remove(c.mesh);
            c.mesh.dispose();
            this.confetti = null;
        }
    }

    async _loadHorseModel() {
        this.onProgress?.(0.08);
        try {
            const gltf = await new Promise((resolve, reject) => {
                new GLTFLoader().load(HORSE_MODEL_URL, resolve, (event) => {
                    if (event.total) this.onProgress?.(Math.min(0.92, 0.08 + (event.loaded / event.total) * 0.84));
                }, reject);
            });
            this._createHorses(gltf.scene, gltf.animations);
        } catch (error) {
            console.warn("Horse GLB failed to load, using local fallback.", error);
            this._createHorses(this._fallbackHorse(), []);
        }
        this.ready = true;
        this.onProgress?.(1);
    }

    _updateStartGate(elapsed) {
        const open = Math.min(1, Math.max(0, elapsed / 0.7));
        const eased = 1 - (1 - open) ** 3;
        this.startDoors.forEach((pivot) => {
            pivot.rotation.y = pivot.userData.side * eased * Math.PI * 0.48;
        });
    }

    _updateVision(distances, elapsed) {
        const second = Math.floor(elapsed);
        if (second === this.visionLastUpdate || !this.visionTexture) return;
        this.visionLastUpdate = second;
        const top = distances.map((distance, i) => ({ distance, i }))
            .sort((a, b) => b.distance - a.distance)
            .slice(0, 3)
            .map((entry) => entry.i);
        this._paintVision(top);
    }

    _paintVision(top) {
        const ctx = this.visionCtx;
        if (!ctx) return;
        ctx.fillStyle = "#05080b";
        ctx.fillRect(0, 0, 512, 288);
        ctx.fillStyle = "#d7a72c";
        ctx.fillRect(0, 0, 512, 48);
        ctx.fillStyle = "#100d06";
        ctx.font = "900 27px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("LIVE  TOP 3", 256, 33);
        top.forEach((horseIndex, rank) => {
            const horse = this.horses[horseIndex];
            const y = 92 + rank * 62;
            ctx.fillStyle = rank === 0 ? "#fff0a8" : "#e6edf3";
            ctx.font = rank === 0 ? "900 30px sans-serif" : "700 27px sans-serif";
            ctx.textAlign = "left";
            ctx.fillText(`${rank + 1}  ${horse.id + 1}  ${horse.name}`, 34, y);
            ctx.fillStyle = horse.color;
            ctx.fillRect(444, y - 25, 34, 34);
        });
        this.visionTexture.needsUpdate = true;
    }

    _addNightLighting() {
        const poleMat = new THREE.MeshStandardMaterial({ color: 0x303b4a, roughness: 0.45, metalness: 0.72 });
        const lampMat = new THREE.MeshStandardMaterial({ color: 0xf3f5e8, emissive: 0xfff1bd, emissiveIntensity: 2.4 });
        const positions = [[-67, -37], [67, -37], [-72, 36], [72, 36]];
        positions.forEach(([x, z]) => {
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 24, 8), poleMat);
            pole.position.set(x, 12, z);
            this.root.add(pole);
            const rack = new THREE.Mesh(new THREE.BoxGeometry(7.5, 1.1, 0.8), poleMat);
            rack.position.set(x, 24, z);
            this.root.add(rack);
            for (let i = -2; i <= 2; i++) {
                const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.72, 0.42), lampMat);
                lamp.position.set(x + i * 1.35, 24, z + (z < 0 ? 0.46 : -0.46));
                this.root.add(lamp);
            }
            const light = new THREE.SpotLight(0xfff0c7, 13, 130, Math.PI / 4.2, 0.7, 1.1);
            light.position.set(x, 23.5, z);
            light.target.position.set(x * 0.28, 0, z * 0.22);
            light.castShadow = false;
            this.scene.add(light, light.target);
        });
    }

    _createHorses(source, animations) {
        this.horses.forEach((horse, i) => {
            const group = new THREE.Group();
            const model = SkeletonUtils.clone(source);
            model.scale.setScalar(0.032);
            model.rotation.y = Math.PI / 2;
            model.traverse((obj) => {
                if (!obj.isMesh) return;
                obj.castShadow = true;
                obj.receiveShadow = true;
                if (obj.material) {
                    obj.material = obj.material.clone();
                    obj.material.color.setHex(COAT_COLORS[horse.id % COAT_COLORS.length]);
                    obj.material.roughness = 0.48;
                    obj.material.metalness = 0.04;
                    obj.material.envMapIntensity = 0.7;
                }
            });
            group.add(model);

            const saddle = new THREE.Mesh(
                new THREE.BoxGeometry(1.2, 0.16, 0.72),
                new THREE.MeshStandardMaterial({ color: horse.color, roughness: 0.45 })
            );
            saddle.position.set(0, 1.34, 0);
            saddle.castShadow = true;
            group.add(saddle);

            const numberPlate = new THREE.Mesh(
                new THREE.PlaneGeometry(4.7, 3.0),
                new THREE.MeshBasicMaterial({
                    map: this._makeNumberTexture(horse.id + 1, horse.color),
                    transparent: true,
                    side: THREE.DoubleSide,
                    depthTest: false,
                })
            );
            numberPlate.visible = false;
            numberPlate.renderOrder = 10;
            this.numberPlates.push(numberPlate);
            this.root.add(numberPlate);

            const boostLabel = new THREE.Mesh(
                new THREE.PlaneGeometry(9.4, 2.85),
                new THREE.MeshBasicMaterial({
                    map: this._makeAbilityTexture(this.data.abLabel[i] || "SPECIAL", horse.id + 1, horse.color),
                    transparent: true,
                    side: THREE.DoubleSide,
                    depthTest: false,
                })
            );
            boostLabel.visible = false;
            boostLabel.renderOrder = 12;
            this.boostLabels.push(boostLabel);
            this.root.add(boostLabel);

            const ring = new THREE.Mesh(
                new THREE.RingGeometry(1.9, 2.7, 64),
                new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
            );
            ring.rotation.x = -Math.PI / 2;
            ring.visible = false;
            this.root.add(ring);
            this.boostRings.push(ring);

            const mixer = new THREE.AnimationMixer(model);
            if (animations[0]) {
                const action = mixer.clipAction(animations[0]);
                action.timeScale = 1.6 + i * 0.04;
                action.play();
            }
            this.mixers.push(mixer);
            group.visible = false;
            this.horseGroups.push(group);
            this.root.add(group);
        });
    }

    _fallbackHorse() {
        const group = new THREE.Group();
        const coat = new THREE.MeshStandardMaterial({ color: 0x6f4528, roughness: 0.58 });
        const dark = new THREE.MeshStandardMaterial({ color: 0x2b1911, roughness: 0.72 });
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.72, 1.8, 6, 12), coat);
        body.position.y = 1.3;
        body.rotation.z = Math.PI / 2;
        group.add(body);
        const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.05, 5, 10), coat);
        neck.position.set(1.18, 1.75, 0);
        neck.rotation.z = -0.55;
        group.add(neck);
        const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.72, 5, 10), coat);
        head.position.set(1.78, 2.15, 0);
        head.rotation.z = Math.PI / 2;
        group.add(head);
        for (const [x, z, tilt] of [[-0.9, -0.38, 0.2], [-0.55, 0.38, -0.25], [0.72, -0.38, -0.22], [0.98, 0.38, 0.3]]) {
            const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.86, 4, 7), dark);
            leg.position.set(x, 0.5, z);
            leg.rotation.z = tilt;
            group.add(leg);
        }
        const tail = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.5, 8), dark);
        tail.position.set(-1.75, 1.25, 0);
        tail.rotation.z = Math.PI / 2 + 0.4;
        group.add(tail);
        group.traverse((obj) => { if (obj.isMesh) obj.castShadow = obj.receiveShadow = true; });
        return group;
    }

    _pose(dist, off) {
        const angle = Math.PI / 2 + Math.PI * 2 * (dist / TRACK_LEN);
        const rx = this.layout.rx * CENTER_RX_SCALE + off * LANE_SPREAD;
        const rz = this.layout.ry * CENTER_RZ_SCALE + off * LANE_SPREAD;
        const x = Math.cos(angle) * rx;
        const z = Math.sin(angle) * rz;
        const tangent = new THREE.Vector3(-Math.sin(angle) * rx, 0, Math.cos(angle) * rz).normalize();
        return {
            position: new THREE.Vector3(x, 0.05, z),
            yaw: Math.atan2(tangent.x, tangent.z),
        };
    }

    _makeNumberTexture(number, color) {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 160;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = color;
        ctx.lineWidth = 16;
        ctx.roundRect(12, 12, 232, 136, 28);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#101820";
        ctx.font = "900 112px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(number), 128, 86);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        return texture;
    }

    _makeAbilityTexture(label, number, color) {
        const canvas = document.createElement("canvas");
        canvas.width = 960;
        canvas.height = 280;
        const ctx = canvas.getContext("2d");
        const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        gradient.addColorStop(0, "rgba(255, 112, 24, 0.98)");
        gradient.addColorStop(1, "rgba(255, 214, 64, 0.98)");
        ctx.fillStyle = gradient;
        ctx.strokeStyle = "rgba(64, 24, 0, 0.88)";
        ctx.lineWidth = 16;
        ctx.roundRect(24, 32, 912, 178, 46);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(118, 121, 62, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "rgba(64, 24, 0, 0.9)";
        ctx.lineWidth = 10;
        ctx.font = "900 88px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.strokeText(String(number), 118, 123);
        ctx.fillText(String(number), 118, 123);
        ctx.textAlign = "left";
        ctx.font = "900 76px system-ui, sans-serif";
        ctx.strokeText(label, 210, 121);
        ctx.fillText(label, 210, 121);
        ctx.font = "800 34px system-ui, sans-serif";
        ctx.fillStyle = "rgba(64, 24, 0, 0.82)";
        ctx.fillText("SPECIAL ABILITY", 214, 172);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        return texture;
    }

    _ovalPoints(off, count) {
        const points = [];
        const rx = this.layout.rx * CENTER_RX_SCALE + off * LANE_SPREAD;
        const rz = this.layout.ry * CENTER_RZ_SCALE + off * LANE_SPREAD;
        for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2;
            points.push(new THREE.Vector3(Math.cos(a) * rx, 0.03, Math.sin(a) * rz));
        }
        return points;
    }
}
