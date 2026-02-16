import { Map } from "./Map.js";
import { Cursor } from "./Cursor.js";
import { Unit } from "./Unit.js";
import { Menu } from "./Menu.js";
import { FX } from "./FX.js";

export class Game {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.width = canvas.width;
        this.height = canvas.height;

        this.tileSize = 32; // 32x32 pixel tiles

        // Dynamic Map Size
        this.cols = Math.ceil(this.width / this.tileSize);
        this.rows = Math.ceil(this.height / this.tileSize);

        this.map = new Map(this.cols, this.rows, this.tileSize);
        this.cursor = new Cursor(this);
        this.menu = new Menu();
        this.fx = new FX();
        this.units = [];

        // Debug unit
        this.units.push(new Unit("Byleth", 5, 5, "player"));
        this.units.push(new Unit("Edelgard", 8, 5, "player"));
        this.units.push(new Unit("Bandit", 12, 8, "enemy"));

        this.lastTime = 0;

        // Game State
        this.gameState = "TUTORIAL"; // TUTORIAL, MAP, UNIT_MOVE, MENU, FORECAST
        this.selectedUnit = null;
        this.targetUnit = null; // For forecast
        this.validMoves = [];
        this.originalPos = { x: 0, y: 0 }; // Store original pos if cancel
        this.turn = "player"; // 'player' or 'enemy'

        this.initTutorial();
    }

    start() {
        this.cursor.initInput();
        requestAnimationFrame(this.loop.bind(this));
    }

    loop(timestamp) {
        const deltaTime = timestamp - this.lastTime;
        this.lastTime = timestamp;

        this.update(deltaTime);
        this.draw();

        // Draw FX on top of everything
        this.fx.update(deltaTime);
        this.fx.draw(this.ctx);

        requestAnimationFrame(this.loop.bind(this));
    }

    initTutorial() {
        const modal = document.getElementById("tutorial-modal");
        modal.style.display = "flex";

        // Mobile tap to close tutorial
        modal.addEventListener("click", () => {
            if (this.gameState === "TUTORIAL") {
                this.closeTutorial();
            }
        });
    }

    closeTutorial() {
        document.getElementById("tutorial-modal").style.display = "none";
        this.gameState = "MAP";
    }

    update(deltaTime) {
        const prevKeys = this.cursor.prevKeys;
        const keys = this.cursor.keys;

        // Global Confirm for Tutorial
        if (this.gameState === "TUTORIAL") {
            if (keys.z && !prevKeys.z) {
                this.closeTutorial();
            }
            this.cursor.prevKeys = { ...this.cursor.keys };
            return;
        }

        // Freeze cursor/units if in MENU, FORECAST or ENEMY_TURN
        if (this.gameState === "MAP" || this.gameState === "UNIT_MOVE") {
            if (this.turn === "player") {
                this.cursor.update(deltaTime);
            }
        }

        this.units.forEach(unit => unit.update(deltaTime));

        // Input Handling only during Player Turn
        if (this.turn === "player") {
            if (keys.z && !prevKeys.z) {
                this.handleConfirm();
            }
            if (keys.x && !prevKeys.x) {
                this.handleCancel();
            }

            // Menu Navigation
            if (this.gameState === "MENU") {
                if (keys.ArrowUp && !prevKeys.ArrowUp) this.menu.navigate(-1);
                if (keys.ArrowDown && !prevKeys.ArrowDown) this.menu.navigate(1);
            }
        }

        // Store previous key state to detect distinct presses
        this.cursor.prevKeys = { ...this.cursor.keys };
    }

    handleConfirm() {
        const cx = this.cursor.x;
        const cy = this.cursor.y;

        if (this.gameState === "MAP") {
            // Try to select a unit
            const unit = this.units.find(u => u.x === cx && u.y === cy);
            if (unit && unit.faction === "player" && !unit.hasMoved) {
                this.selectedUnit = unit;
                this.originalPos = { x: unit.x, y: unit.y };
                this.validMoves = this.map.getValidMoves(unit, this.units);
                this.gameState = "UNIT_MOVE";
                console.log("Unit selected:", unit.name);
            }
        } else if (this.gameState === "UNIT_MOVE") {
            // Try to move unit
            const move = this.validMoves.find(m => m.x === cx && m.y === cy);
            if (move) {
                const occupant = this.units.find(u => u.x === cx && u.y === cy && u !== this.selectedUnit);
                if (!occupant) {
                    this.selectedUnit.x = cx;
                    this.selectedUnit.y = cy;

                    // Check for enemies in range (fixed range 1 for now)
                    const enemiesInRange = this.units.filter(u =>
                        u.faction !== this.selectedUnit.faction &&
                        Math.abs(u.x - cx) + Math.abs(u.y - cy) === 1
                    );

                    const menuOptions = [];
                    if (enemiesInRange.length > 0) {
                        menuOptions.push({ label: "Attack", value: "attack" });
                    }
                    menuOptions.push({ label: "Wait", value: "wait" });

                    // Show Menu
                    const screenX = cx * this.tileSize + 40;
                    const screenY = cy * this.tileSize;

                    this.gameState = "MENU";
                    this.menu.show(screenX, screenY, menuOptions);
                }
            }
        } else if (this.gameState === "MENU") {
            const action = this.menu.select();
            if (action === "wait") {
                this.finishAction();
            } else if (action === "attack") {
                this.menu.hide();
                this.gameState = "UNIT_ATTACK";
                // UNIT_ATTACK allows selecting a target
            }
        } else if (this.gameState === "UNIT_ATTACK") {
            // Check if cursor is on an enemy in range
            const enemy = this.units.find(u =>
                u.x === cx && u.y === cy &&
                u.faction !== this.selectedUnit.faction &&
                Math.abs(u.x - this.selectedUnit.x) + Math.abs(this.selectedUnit.y - u.y) === 1
            );

            if (enemy) {
                this.targetUnit = enemy;
                this.showCombatForecast(this.selectedUnit, enemy);
            }
        } else if (this.gameState === "FORECAST") {
            // Confirm Attack
            document.getElementById("combat-forecast").classList.add("hidden");
            this.executeCombat(this.selectedUnit, this.targetUnit);
            this.finishAction();
        }
    }

    handleCancel() {
        if (this.gameState === "UNIT_MOVE") {
            this.gameState = "MAP";
            this.selectedUnit = null;
            this.validMoves = [];
            console.log("Selection cancelled");
        } else if (this.gameState === "MENU") {
            // Cancel movement, go back to UNIT_MOVE
            this.selectedUnit.x = this.originalPos.x;
            this.selectedUnit.y = this.originalPos.y;
            this.menu.hide();
            this.gameState = "UNIT_MOVE";
            // Reposition cursor to unit?
            this.cursor.x = this.selectedUnit.x;
            this.cursor.y = this.selectedUnit.y;
        } else if (this.gameState === "UNIT_ATTACK") {
            // Go back to menu
            const screenX = this.selectedUnit.x * this.tileSize + 40;
            const screenY = this.selectedUnit.y * this.tileSize;
            this.gameState = "MENU";
            this.menu.show(screenX, screenY, [
                { label: "Attack", value: "attack" },
                { label: "Wait", value: "wait" }
            ]);
        } else if (this.gameState === "FORECAST") {
            // Close forecast, go back to UNIT_ATTACK (selecting target)
            document.getElementById("combat-forecast").classList.add("hidden");
            this.gameState = "UNIT_ATTACK";
            this.targetUnit = null;
        }
    }

    calculateCombatStats(attacker, defender) {
        // FETH/FE formulas (Approx)
        // Dmg = Str - Def
        // Hit = Dex * 2 + Luck
        // Avo = Spd * 2 + Luck + TerrainBonus (simplified to 20 for forest)
        // Crit = (Dex + Luk) / 2

        const terrain = this.map.getTerrain(defender.x, defender.y);
        const terrainAvo = (terrain === 1) ? 20 : 0;
        const terrainDef = (terrain === 1) ? 1 : 0;

        const dmg = Math.max(0, attacker.str - (defender.def + terrainDef));
        const hit = Math.min(100, Math.max(0, (attacker.dex * 3 + attacker.luk) - (defender.spd * 2 + defender.luk + terrainAvo)));
        const crit = Math.max(0, Math.floor((attacker.dex + attacker.luk) / 2) - defender.luk);

        const double = (attacker.spd - defender.spd) >= 4;

        return { dmg, hit, crit, double };
    }

    showCombatForecast(attacker, defender) {
        this.gameState = "FORECAST";
        const ui = document.getElementById("combat-forecast");
        ui.classList.remove("hidden");

        const pStats = this.calculateCombatStats(attacker, defender);
        const eStats = this.calculateCombatStats(defender, attacker); // Counter

        document.getElementById("forecast-attacker-name").innerText = attacker.name;
        document.getElementById("forecast-defender-name").innerText = defender.name;

        // Player Stats
        document.getElementById("f-atk-hp").innerText = attacker.hp;
        let resHp = Math.max(0, defender.hp - (pStats.double ? pStats.dmg * 2 : pStats.dmg)); // Simple forecast logic
        // Actually forecast should show result of just this combat round
        // Let's keep it simple: Attacker Dmg -> Defender HP

        document.getElementById("f-atk-mt").innerText = pStats.dmg + (pStats.double ? " x2" : "");
        document.getElementById("f-atk-hit").innerText = pStats.hit;
        document.getElementById("f-atk-crit").innerText = pStats.crit;

        // Resulting HP (Estimated)
        // If Player hits (assume hit for forecast visual), Defender HP drops
        const estDmg = pStats.dmg * (pStats.double ? 2 : 1);
        document.getElementById("f-def-res-hp").innerText = Math.max(0, defender.hp - estDmg);

        // Enemy Stats (Counter)
        const canCounter = true; // Range check usually here but 1 range always true
        if (canCounter) {
            document.getElementById("f-def-hp").innerText = defender.hp;
            document.getElementById("f-def-mt").innerText = eStats.dmg + (eStats.double ? " x2" : "");
            document.getElementById("f-def-hit").innerText = eStats.hit;
            document.getElementById("f-def-crit").innerText = eStats.crit;

        }
    }

    async executeCombat(attacker, defender) {
        console.log(`${attacker.name} attacks ${defender.name}!`);

        // Hide cursor/UI during animation
        this.gameState = "ANIMATION";

        const pStats = this.calculateCombatStats(attacker, defender);
        const eStats = this.calculateCombatStats(defender, attacker);

        // Helper for one attack action
        const performAction = async (atk, def, stats) => {
            // Bump Animation
            await this.animateBump(atk, def);

            // Hit Check
            if (Math.random() * 100 < stats.hit) {
                // Crit Check
                let finalDmg = stats.dmg;
                let isCrit = false;
                if (Math.random() * 100 < stats.crit) {
                    finalDmg *= 3;
                    isCrit = true;
                    console.log("CRITICAL HIT!");
                }

                def.hp -= finalDmg;
                if (def.hp < 0) def.hp = 0;

                // FX
                this.fx.showDamage(def.x * this.tileSize + 16, def.y * this.tileSize, finalDmg, isCrit);

                // Shake screen or unit if crit?
                if (isCrit) {
                    // simplified shake
                }

            } else {
                console.log(`${atk.name} Missed!`);
                this.fx.showText(def.x * this.tileSize + 16, def.y * this.tileSize, "Miss", "#aaa");
            }

            // Short pause
            await new Promise(r => setTimeout(r, 600));
        };

        // 1. Attacker attacks
        await performAction(attacker, defender, pStats);
        if (defender.hp <= 0) {
            this.handleDeath(defender);
            this.finishAction();
            return;
        }

        // 2. Defender counters
        // (Only if range matches, simplified to always true for 1-range)
        await performAction(defender, attacker, eStats);
        if (attacker.hp <= 0) {
            this.handleDeath(attacker);
            this.finishAction();
            return;
        }

        // 3. Attacker Double
        if (pStats.double) {
            await performAction(attacker, defender, pStats);
            if (defender.hp <= 0) {
                this.handleDeath(defender);
                this.finishAction();
                return;
            }
        }

        // 4. Defender Double
        if (eStats.double) {
            await performAction(defender, attacker, eStats);
            if (attacker.hp <= 0) {
                this.handleDeath(attacker);
                this.finishAction();
                return;
            }
        }

        this.finishAction();
    }

    animateBump(unit, target) {
        return new Promise(resolve => {
            const dx = (target.x - unit.x) * 16; // 16px bump
            const dy = (target.y - unit.y) * 16;

            let progress = 0;
            const duration = 200; // ms
            const startTime = Date.now();

            const animate = () => {
                const now = Date.now();
                const elapsed = now - startTime;
                let t = Math.min(1, elapsed / duration);

                // T: 0 -> 0.5 (Forward) -> 1.0 (Back)
                let val;
                if (t < 0.5) {
                    val = t * 2; // 0 to 1
                } else {
                    val = 1 - (t - 0.5) * 2; // 1 to 0
                }

                unit.renderX = dx * val;
                unit.renderY = dy * val;

                if (t < 1) {
                    requestAnimationFrame(animate);
                } else {
                    unit.renderX = 0;
                    unit.renderY = 0;
                    resolve();
                }
            };
            animate();
        });
    }

    handleDeath(unit) {
        console.log(`${unit.name} defeated!`);
        this.units = this.units.filter(u => u !== unit);
    }

    finishAction() {
        if (this.selectedUnit) {
            this.selectedUnit.hasMoved = true;
            this.selectedUnit.isGrayedOut = true;
            this.selectedUnit = null;
        }
        this.menu.hide(); // safety
        this.gameState = "MAP";
        this.validMoves = [];
        this.checkTurnEnd();
    }

    checkTurnEnd() {
        const playerUnits = this.units.filter(u => u.faction === "player");
        const enemyUnits = this.units.filter(u => u.faction === "enemy");

        if (playerUnits.length === 0) {
            alert("Game Over!");
            // location.reload();
            return;
        }
        if (enemyUnits.length === 0) {
            alert("Victory!");
            // location.reload();
            return;
        }

        const activeUnits = this.units.filter(u => u.faction === this.turn && !u.hasMoved);
        if (activeUnits.length === 0) {
            this.endTurn();
        }
    }

    endTurn() {
        this.turn = this.turn === "player" ? "enemy" : "player";
        console.log(`Starting ${this.turn} turn`);

        // Reset movement flags for the new turn's units
        this.units.forEach(u => {
            if (u.faction === this.turn) {
                u.hasMoved = false;
                u.isGrayedOut = false;
            }
        });

        if (this.turn === "enemy") {
            setTimeout(() => this.runEnemyAI(), 500);
        }
    }

    async runEnemyAI() {
        const enemies = this.units.filter(u => u.faction === "enemy");

        for (const enemy of enemies) {
            // Find closest player unit
            let target = null;
            let minDist = Infinity;

            const players = this.units.filter(u => u.faction === "player");
            for (const p of players) {
                const dist = Math.abs(p.x - enemy.x) + Math.abs(p.y - enemy.y);
                if (dist < minDist) {
                    minDist = dist;
                    target = p;
                }
            }

            if (target) {
                // Move towards target
                // Simple AI: Calculate valid moves, pick one closest to target
                const validMoves = this.map.getValidMoves(enemy, this.units);
                let bestMove = { x: enemy.x, y: enemy.y };
                let bestDist = minDist;

                for (const move of validMoves) {
                    // Don't move onto an occupied square (except self)
                    const occupant = this.units.find(u => u.x === move.x && u.y === move.y && u !== enemy);
                    if (!occupant) {
                        const dist = Math.abs(target.x - move.x) + Math.abs(target.y - move.y);
                        if (dist < bestDist) {
                            bestDist = dist;
                            bestMove = move;
                        }
                    }
                }

                enemy.x = bestMove.x;
                enemy.y = bestMove.y;

                // Attack if adjacent
                const adjacentPlayer = players.find(p => Math.abs(p.x - enemy.x) + Math.abs(p.y - enemy.y) === 1);
                if (adjacentPlayer) {
                    this.executeCombat(enemy, adjacentPlayer);
                }

                enemy.hasMoved = true;
                enemy.isGrayedOut = true;

                // Wait a bit to visualize
                await new Promise(r => setTimeout(r, 500));
            }
        }

        this.endTurn(); // Switch back to player
    }

    draw() {
        this.ctx.clearRect(0, 0, this.width, this.height);

        this.map.draw(this.ctx);

        // Draw move overlay if selecting
        if (this.gameState === "UNIT_MOVE") {
            this.map.drawOverlay(this.ctx, this.validMoves);
        }

        // Highlight attackable targets in UNIT_ATTACK
        if (this.gameState === "UNIT_ATTACK") {
            const enemiesInRange = this.units.filter(u =>
                u.faction !== this.selectedUnit.faction &&
                Math.abs(u.x - this.selectedUnit.x) + Math.abs(u.y - this.selectedUnit.y) === 1
            );

            this.ctx.strokeStyle = "red";
            this.ctx.lineWidth = 3;
            enemiesInRange.forEach(e => {
                this.ctx.strokeRect(e.x * this.tileSize, e.y * this.tileSize, this.tileSize, this.tileSize);
            });
        }

        this.units.forEach(unit => unit.draw(this.ctx, this.tileSize));
        if (this.turn === "player" && this.gameState !== "MENU") {
            this.cursor.draw(this.ctx, this.tileSize);
        }

        // Draw Turn Banner
        const bannerY = 30;
        const bannerHeight = 40;
        const text = this.turn === "player" ? "PLAYER PHASE" : "ENEMY PHASE";
        const color = this.turn === "player" ? "#1e88e5" : "#e53935";

        // Banner Background (Gradient)
        const grad = this.ctx.createLinearGradient(0, bannerY - 20, this.width, bannerY - 20);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(0.2, color);
        grad.addColorStop(0.8, color);
        grad.addColorStop(1, "rgba(0,0,0,0)");

        this.ctx.fillStyle = grad;
        this.ctx.fillRect(0, bannerY - 25, this.width, bannerHeight);

        // Banner Text
        this.ctx.font = "bold 24px 'Segoe UI', serif";
        this.ctx.fillStyle = "white";
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";

        // Text Shadow
        this.ctx.shadowColor = "black";
        this.ctx.shadowBlur = 4;
        this.ctx.fillText(text, this.width / 2, bannerY - 5);

        this.ctx.shadowBlur = 0; // Reset
    }
}
