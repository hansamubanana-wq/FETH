export class MobileControls {
    constructor() {
        this.touchMap = new Map();
        this.buttons = {
            'dpad-up': 'ArrowUp',
            'dpad-down': 'ArrowDown',
            'dpad-left': 'ArrowLeft',
            'dpad-right': 'ArrowRight',
            'btn-a': 'z',
            'btn-b': 'x'
        };
    }

    init() {
        // Prevent default touch actions (scrolling/zooming) on the controls
        const controlContainer = document.getElementById('virtual-controls');
        if (!controlContainer) return;

        controlContainer.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
        controlContainer.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
        controlContainer.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });

        // Attach listeners to buttons
        Object.keys(this.buttons).forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                this.attachListeners(btn, this.buttons[id]);
            }
        });

        // Show controls only if touch is likely supported or screen is small
        if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
            controlContainer.classList.remove('hidden-force');
        }
    }

    attachListeners(element, key) {
        element.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.simulateKey(key, 'keydown');
            element.classList.add('active');
        });

        element.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.simulateKey(key, 'keyup');
            element.classList.remove('active');
        });

        // Handle touch cancel or sliding off? 
        // For simplicity, just touchend on the element for now.
        // A more robust joystick implementation uses touchmove coordinates.
    }

    simulateKey(key, type) {
        const event = new KeyboardEvent(type, {
            key: key,
            code: key === 'z' ? 'KeyZ' : (key === 'x' ? 'KeyX' : key),
            bubbles: true
        });
        window.dispatchEvent(event);
    }
}
