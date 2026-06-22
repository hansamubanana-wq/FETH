import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

const HORSE_MODEL_URL = "https://threejs.org/examples/models/gltf/Horse.glb";
const GRASS_TEXTURE_URL = "https://threejs.org/examples/textures/terrain/grasslight-big.jpg";
const TRACK_LEN = 820;
const CENTER_RX_SCALE = 0.13;
const CENTER_RZ_SCALE = 0.16;
const LANE_SPREAD = 0.13;

export class Race3DRenderer {
    constructor(canvas, horses, data, layout) {
        this.canvas = canvas;
        this.horses = horses;
        this.data = data;
        this.layout = layout;
        this.clock = new THREE.Clock();
        this.ready = false;
        this.mixers = [];
        this.horseGroups = [];
        this.numberPlates = [];
        this.boostLabels = [];
        this.boostRings = [];

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x8cc3e3);
        this.scene.fog = new THREE.Fog(0x8cc3e3, 90, 230);

        this.camera = new THREE.OrthographicCamera(-62, 62, 35, -35, 0.1, 300);
        this.camera.position.set(0, 52, 72);
        this.camera.up.set(0, 0, -1);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: false,
            powerPreference: "high-performance",
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        this.root = new THREE.Group();
        this.scene.add(this.root);
        this._buildWorld();
        this._loadHorseModel();
        this.resize();
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const width = Math.max(320, Math.floor(rect.width || this.canvas.clientWidth || 960));
        const height = Math.max(240, Math.floor(width * 0.5625));
        this.renderer.setSize(width, height, false);
        const frustumHeight = 64; // 外レーンの馬がギリギリ収まるまでズーム
        const frustumWidth = frustumHeight * (width / height);
        this.camera.left = -frustumWidth / 2;
        this.camera.right = frustumWidth / 2;
        this.camera.top = frustumHeight / 2;
        this.camera.bottom = -frustumHeight / 2;
        this.camera.updateProjectionMatrix();
    }

    render(distances, elapsed = 0) {
        this.resize();
        const dt = Math.min(0.05, this.clock.getDelta());
        for (const mixer of this.mixers) mixer.update(dt * 1.9);

        const leader = distances
            .map((d, i) => ({ d, i }))
            .sort((a, b) => b.d - a.d)[0]?.i ?? 0;

        this.horseGroups.forEach((group, i) => {
            const pose = this._pose(distances[i], this.layout.off[i]);
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
    }

    dispose() {
        this.renderer.dispose();
    }

    _buildWorld() {
        const hemi = new THREE.HemisphereLight(0xeaf6ff, 0x33552d, 2.4);
        this.scene.add(hemi);

        const sun = new THREE.DirectionalLight(0xffffff, 2.6);
        sun.position.set(-46, 88, 42);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.camera.left = -90;
        sun.shadow.camera.right = 90;
        sun.shadow.camera.top = 90;
        sun.shadow.camera.bottom = -90;
        this.scene.add(sun);

        const turf = new THREE.Mesh(
            new THREE.PlaneGeometry(220, 150, 1, 1),
            new THREE.MeshStandardMaterial({
                color: 0x2d8a3b,
                map: this._createFallbackGrassTexture(),
                roughness: 0.94,
            })
        );
        turf.rotation.x = -Math.PI / 2;
        turf.receiveShadow = true;
        this.root.add(turf);
        this._loadGrassTexture(turf.material);

        this._addTrack();
        this._addRails();
        this._addGrandstand();
        this._addFinishGate();
    }

    _addTrack() {
        const mat = new THREE.MeshStandardMaterial({ color: 0xb98042, roughness: 0.86 });
        const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32 });
        for (let lane = 0; lane < this.horses.length + 2; lane++) {
            const offset = (lane - (this.horses.length + 1) / 2) * 1.7;
            const points = this._ovalPoints(offset, 220);
            const curve = new THREE.CatmullRomCurve3(points, true);
            const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 360, lane === 0 ? 0.95 : 0.78, 10, true), mat);
            tube.receiveShadow = true;
            tube.castShadow = false;
            this.root.add(tube);

            if (lane > 1 && lane < this.horses.length + 1) {
                const line = new THREE.LineLoop(
                    new THREE.BufferGeometry().setFromPoints(this._ovalPoints(offset - 0.85, 260)),
                    lineMat
                );
                line.position.y = 0.08;
                this.root.add(line);
            }
        }
    }

    _loadGrassTexture(material) {
        new THREE.TextureLoader().load(
            GRASS_TEXTURE_URL,
            (texture) => {
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                texture.repeat.set(4, 3);
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
                material.map = texture;
                material.color.set(0x2f8f3d);
                material.needsUpdate = true;
            },
            undefined,
            () => {
                material.map = this._createFallbackGrassTexture();
                material.needsUpdate = true;
            }
        );
    }

    _createFallbackGrassTexture() {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#287d35";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
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
        texture.repeat.set(4, 3);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        return texture;
    }

    _addRails() {
        const railMat = new THREE.MeshStandardMaterial({ color: 0xf4f4ef, roughness: 0.4 });
        [-9.5, 9.5].forEach((offset) => {
            const curve = new THREE.CatmullRomCurve3(this._ovalPoints(offset, 260), true);
            const rail = new THREE.Mesh(new THREE.TubeGeometry(curve, 260, 0.12, 8, true), railMat);
            rail.position.y = 0.9;
            rail.castShadow = true;
            this.root.add(rail);

            for (let i = 0; i < 44; i++) {
                const p = this._pose((i / 44) * TRACK_LEN, offset);
                const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.9, 8), railMat);
                post.position.copy(p.position);
                post.position.y = 0.45;
                post.castShadow = true;
                this.root.add(post);
            }
        });
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

        for (let i = 0; i < 13; i++) {
            const pane = new THREE.Mesh(new THREE.BoxGeometry(2.4, 4.4, 0.16), glassMat);
            pane.position.set(-34 + i * 4.4, 5.5, -50.9);
            this.root.add(pane);
        }
    }

    _addFinishGate() {
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.38 });
        const red = new THREE.MeshStandardMaterial({ color: 0xd8392b, roughness: 0.5 });
        const x = 0;
        const z = this.layout.ry * 0.22;

        [-10, 10].forEach((px) => {
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 8.5, 12), mat);
            post.position.set(px, 4.25, z + 24);
            post.castShadow = true;
            this.root.add(post);
        });
        const bar = new THREE.Mesh(new THREE.BoxGeometry(22, 1.2, 1.4), red);
        bar.position.set(x, 8.8, z + 24);
        bar.castShadow = true;
        this.root.add(bar);

        const finishZ = this.layout.ry * 0.13;
        const tileCount = 14;
        const tileHeight = 1.55;
        for (let i = 0; i < tileCount; i++) {
            const tile = new THREE.Mesh(
                new THREE.PlaneGeometry(2.2, tileHeight),
                new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0xffffff : 0x111111, side: THREE.DoubleSide })
            );
            tile.rotation.x = -Math.PI / 2;
            tile.position.set(0, 0.18, finishZ + (i - tileCount / 2 + 0.5) * tileHeight);
            tile.renderOrder = 5;
            this.root.add(tile);
        }
    }

    async _loadHorseModel() {
        try {
            const gltf = await new GLTFLoader().loadAsync(HORSE_MODEL_URL);
            this._createHorses(gltf.scene, gltf.animations);
        } catch (error) {
            console.warn("Horse GLB failed to load, using local fallback.", error);
            this._createHorses(this._fallbackHorse(), []);
        }
        this.ready = true;
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
                    obj.material.color.copy(new THREE.Color(horse.color));
                    obj.material.roughness = 0.72;
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
        const body = new THREE.Mesh(new THREE.BoxGeometry(3, 1.1, 0.9), new THREE.MeshStandardMaterial({ color: 0x6f4528 }));
        body.position.y = 1.3;
        group.add(body);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.75, 0.7), new THREE.MeshStandardMaterial({ color: 0x5f371f }));
        head.position.set(1.75, 1.55, 0);
        group.add(head);
        for (const x of [-1, -0.2, 0.7, 1.35]) {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.12, 1.15, 8), new THREE.MeshStandardMaterial({ color: 0x3a2316 }));
            leg.position.set(x, 0.55, x % 0.4 ? -0.32 : 0.32);
            group.add(leg);
        }
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
