export class FX {
    constructor() {
        this.particles = [];
    }

    // Spawn a floating text (e.g. Damage)
    showDamage(x, y, amount, isCrit) {
        this.particles.push({
            x: x,
            y: y,
            text: amount,
            life: 1.0, // seconds
            vy: -20, // move up speed
            color: isCrit ? "#ff0000" : "#ffffff",
            scale: isCrit ? 1.5 : 1.0,
            isCrit: isCrit
        });
    }

    showText(x, y, text, color) {
        this.particles.push({
            x: x,
            y: y,
            text: text,
            life: 1.0,
            vy: -15,
            color: color || "#fff",
            scale: 0.8,
            isCrit: false
        });
    }

    update(deltaTime) {
        const dt = deltaTime / 1000;
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.life -= dt;
            p.y += p.vy * dt;

            if (p.life <= 0) {
                this.particles.splice(i, 1);
            }
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.textAlign = "center";

        for (const p of this.particles) {
            ctx.globalAlpha = Math.min(1, p.life * 2); // Fade out at end

            // Draw text shadow/outline
            ctx.font = `bold ${20 * p.scale}px 'Segoe UI', sans-serif`;
            ctx.strokeStyle = "black";
            ctx.lineWidth = 3;
            ctx.strokeText(p.text, p.x, p.y);

            // Draw text
            ctx.fillStyle = p.color;
            ctx.fillText(p.text, p.x, p.y);
        }

        ctx.restore();
    }
}
