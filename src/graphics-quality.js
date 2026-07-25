export const QUALITY_STORAGE_KEY = "feth.graphicsQuality";
export const QUALITY_CHOICES = ["auto", "low", "mid", "high"];
export const QUALITY_TIERS = ["low", "mid", "high"];
export const QUALITY_SETTINGS = Object.freeze({
    low: Object.freeze({ pixelRatio: 1, shadows: false, shadowMapSize: 0, particleScale: 0.5, crowdScale: 0.5 }),
    mid: Object.freeze({ pixelRatio: 1.5, shadows: true, shadowMapSize: 1024, particleScale: 1, crowdScale: 1 }),
    high: Object.freeze({ pixelRatio: 2, shadows: true, shadowMapSize: 2048, particleScale: 1, crowdScale: 1 }),
});

export function getQualityPreference(storage = globalThis.localStorage) {
    try {
        const value = storage?.getItem(QUALITY_STORAGE_KEY);
        return QUALITY_CHOICES.includes(value) ? value : "auto";
    } catch {
        return "auto";
    }
}

export function setQualityPreference(value, storage = globalThis.localStorage) {
    const safeValue = QUALITY_CHOICES.includes(value) ? value : "auto";
    try { storage?.setItem(QUALITY_STORAGE_KEY, safeValue); } catch { /* 保存不可でも現在の選択は使う */ }
    return safeValue;
}

export function profileGraphicsCapability({ renderer, width, height, dpr, memory, cores, gpu } = {}) {
    if (!renderer) return { tier: "mid", score: 0, signals: {} };
    const gl = renderer.getContext();
    const maxTextureSize = gl?.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
    const pixels = Math.max(1, width || innerWidth || 1) * Math.max(1, height || innerHeight || 1) * Math.pow(dpr || devicePixelRatio || 1, 2);
    const deviceMemory = Number(memory ?? navigator.deviceMemory) || 0;
    const hardwareConcurrency = Number(cores ?? navigator.hardwareConcurrency) || 0;
    const gpuName = String(gpu || getGpuName(gl)).toLowerCase();
    let score = 0;
    if (deviceMemory) score += deviceMemory <= 2 ? -2 : deviceMemory >= 8 ? 2 : deviceMemory >= 4 ? 1 : 0;
    if (hardwareConcurrency) score += hardwareConcurrency <= 2 ? -2 : hardwareConcurrency >= 8 ? 2 : hardwareConcurrency >= 4 ? 1 : 0;
    if (maxTextureSize) score += maxTextureSize < 4096 ? -2 : maxTextureSize >= 16384 ? 2 : maxTextureSize >= 8192 ? 1 : 0;
    score += pixels > 8_000_000 ? -2 : pixels > 4_000_000 ? -1 : pixels < 1_500_000 ? 1 : 0;
    // GPU名は補助信号に限定し、他の能力値を覆さない。
    if (/(swiftshader|llvmpipe|software)/.test(gpuName)) score -= 1;
    const tier = score <= -2 ? "low" : score >= 4 ? "high" : "mid";
    return { tier, score, signals: { dpr: dpr || devicePixelRatio || 1, deviceMemory, hardwareConcurrency, maxTextureSize, pixels, gpuName } };
}

function getGpuName(gl) {
    try {
        const ext = gl?.getExtension("WEBGL_debug_renderer_info");
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "";
    } catch {
        return "";
    }
}

export class QualityAutoAdjuster {
    constructor(initialTier, onChange) {
        this.tier = QUALITY_TIERS.includes(initialTier) ? initialTier : "mid";
        this.onChange = onChange;
        this.highWindows = 0;
        this.latches = new Set();
    }

    observe(fps) {
        const index = QUALITY_TIERS.indexOf(this.tier);
        if (fps < 30 && index > 0) {
            const next = QUALITY_TIERS[index - 1];
            this.latches.add(`${next}>${this.tier}`);
            this.highWindows = 0;
            return this._change(next, fps, "down");
        }
        if (fps > 45 && index < QUALITY_TIERS.length - 1) {
            this.highWindows++;
            const next = QUALITY_TIERS[index + 1];
            if (this.highWindows >= 2 && !this.latches.has(`${this.tier}>${next}`)) {
                this.highWindows = 0;
                return this._change(next, fps, "up");
            }
        } else {
            this.highWindows = 0;
        }
        return false;
    }

    _change(tier, fps, direction) {
        this.tier = tier;
        this.onChange?.(tier, { fps, direction, latches: [...this.latches] });
        return true;
    }
}

export function initGraphicsQualityUI(select = document.getElementById("graphics-quality")) {
    if (!select) return;
    select.value = getQualityPreference();
    select.addEventListener("change", () => setQualityPreference(select.value));
}
