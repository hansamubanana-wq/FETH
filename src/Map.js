export class Map {
    constructor(cols, rows, tileSize) {
        this.cols = cols;
        this.rows = rows;
        this.tileSize = tileSize;
        this.grid = [];

        // Initialize grid with basic terrain (0: Plain, 1: Forest)
        for (let y = 0; y < rows; y++) {
            const row = [];
            for (let x = 0; x < cols; x++) {
                // Randomly place some forests
                row.push(Math.random() > 0.8 ? 1 : 0);
            }
            this.grid.push(row);
        }
    }

    getTerrain(x, y) {
        if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return null;
        return this.grid[y][x];
    }

    draw(ctx) {
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const terrain = this.grid[y][x];
                const xPos = x * this.tileSize;
                const yPos = y * this.tileSize;

                // Color based on terrain
                if (terrain === 1) {
                    ctx.fillStyle = "#2d6a4f"; // Forest Green
                } else {
                    ctx.fillStyle = "#8d99ae"; // Plain Greyish
                    // Checkerboard pattern for visibility
                    if ((x + y) % 2 === 0) {
                        ctx.fillStyle = "#9ba8be";
                    }
                }

                ctx.fillRect(xPos, yPos, this.tileSize, this.tileSize);

                // Grid lines (optional, maybe make subtle)
                ctx.strokeStyle = "rgba(0,0,0,0.1)";
                ctx.strokeRect(xPos, yPos, this.tileSize, this.tileSize);
            }
        }
    }

    // BFS to find reachable tiles
    getValidMoves(unit, units) {
        const startNode = { x: unit.x, y: unit.y, dist: 0 };
        const queue = [startNode];
        const visited = new Set();
        const validMoves = [];

        // Helper to check if a tile is occupied by an enemy/obstacle
        const isOccupied = (x, y) => {
            return units.some(u => u.x === x && u.y === y && u !== unit && u.faction !== unit.faction);
        };

        visited.add(`${unit.x},${unit.y}`);
        validMoves.push({ x: unit.x, y: unit.y }); // Can always stay still

        while (queue.length > 0) {
            const current = queue.shift();

            if (current.dist >= unit.move) continue;

            const neighbors = [
                { x: current.x, y: current.y - 1 },
                { x: current.x, y: current.y + 1 },
                { x: current.x - 1, y: current.y },
                { x: current.x + 1, y: current.y }
            ];

            for (const neighbor of neighbors) {
                const key = `${neighbor.x},${neighbor.y}`;
                if (
                    neighbor.x >= 0 && neighbor.x < this.cols &&
                    neighbor.y >= 0 && neighbor.y < this.rows &&
                    !visited.has(key)
                ) {
                    // Check terrain cost (Forest = 2, Plain = 1)
                    const terrain = this.grid[neighbor.y][neighbor.x];
                    const cost = (terrain === 1) ? 2 : 1;

                    if (current.dist + cost <= unit.move && !isOccupied(neighbor.x, neighbor.y)) {
                        visited.add(key);
                        queue.push({ x: neighbor.x, y: neighbor.y, dist: current.dist + cost });
                        validMoves.push({ x: neighbor.x, y: neighbor.y });
                    }
                }
            }
        }
        return validMoves;
    }

    drawOverlay(ctx, validMoves) {
        ctx.fillStyle = "rgba(0, 0, 255, 0.3)"; // Blue overlay for move range
        for (const move of validMoves) {
            ctx.fillRect(move.x * this.tileSize, move.y * this.tileSize, this.tileSize, this.tileSize);
            ctx.strokeStyle = "rgba(0, 0, 255, 0.5)";
            ctx.strokeRect(move.x * this.tileSize, move.y * this.tileSize, this.tileSize, this.tileSize);
        }
    }
}
