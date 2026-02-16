export class Unit {
    constructor(name, x, y, faction) {
        this.name = name;
        this.x = x;
        this.y = y;
        this.faction = faction; // 'player', 'enemy', 'ally'

        this.hp = 20;
        this.maxHp = 20;
        this.str = 5;
        this.mag = 0;
        this.dex = 5; // Hit
        this.spd = 4; // Avoid / Double
        this.luk = 4; // Crit Avoid
        this.def = 2; // Phys Def
        this.res = 2; // Mag Def
        this.move = 5; // Default movement ranage
    }

    update(deltaTime) {
        // Simple interpolation for smooth movement could go here
    }

    draw(ctx, tileSize) {
        const xPos = this.x * tileSize;
        const yPos = this.y * tileSize;
        const center = tileSize / 2;

        // Draw shadow
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath();
        ctx.ellipse(xPos + center, yPos + tileSize - 4, center - 6, 3, 0, 0, Math.PI * 2);
        ctx.fill();

        // Save context for filters/effects
        ctx.save();

        if (this.isGrayedOut) {
            ctx.filter = "grayscale(100%) brightness(80%)";
        }

        // Unit Token Base
        ctx.fillStyle = this.faction === "player" ? "#4ea5f9" : "#ef476f";
        if (this.name === "Edelgard") ctx.fillStyle = "#d90429";

        ctx.beginPath();
        ctx.arc(xPos + center, yPos + center - 2, tileSize * 0.4, 0, Math.PI * 2);
        ctx.fill();

        // Token Border
        ctx.lineWidth = 2;
        ctx.strokeStyle = "white";
        ctx.stroke();

        // Inner Letter
        ctx.fillStyle = "white";
        ctx.font = "bold 16px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.name.charAt(0).toUpperCase(), xPos + center, yPos + center - 1);

        ctx.restore();

        // HP Bar Background
        const hpBarWidth = tileSize - 6;
        const hpBarHeight = 4;
        const hpBarX = xPos + 3;
        const hpBarY = yPos + tileSize - 6;

        ctx.fillStyle = "#222";
        ctx.fillRect(hpBarX, hpBarY, hpBarWidth, hpBarHeight);

        // HP Bar Foreground
        const hpPct = Math.max(0, this.hp / this.maxHp);
        ctx.fillStyle = hpPct > 0.5 ? "#2ecc71" : hpPct > 0.25 ? "#f1c40f" : "#e74c3c";
        ctx.fillRect(hpBarX, hpBarY, hpBarWidth * hpPct, hpBarHeight);

        // HP Bar Border
        ctx.lineWidth = 1;
        ctx.strokeStyle = "#000";
        ctx.strokeRect(hpBarX, hpBarY, hpBarWidth, hpBarHeight);
    }
}
