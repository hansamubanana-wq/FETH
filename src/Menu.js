export class Menu {
    constructor() {
        this.el = document.getElementById("action-menu");
        this.list = this.el.querySelector("ul");
        this.options = [];
        this.selectedIndex = 0;
        this.isVisible = false;
    }

    show(x, y, options) {
        this.options = options;
        this.render();
        this.el.classList.remove("hidden");
        this.el.style.left = `${x}px`;
        this.el.style.top = `${y}px`;
        this.selectedIndex = 0;
        this.isVisible = true;
        this.updateSelection();
    }

    hide() {
        this.el.classList.add("hidden");
        this.isVisible = false;
    }

    render() {
        this.list.innerHTML = "";
        this.options.forEach((opt, index) => {
            const li = document.createElement("li");
            li.textContent = opt.label;
            li.dataset.index = index;
            this.list.appendChild(li);
        });
    }

    navigate(direction) {
        this.selectedIndex += direction;
        if (this.selectedIndex < 0) this.selectedIndex = this.options.length - 1;
        if (this.selectedIndex >= this.options.length) this.selectedIndex = 0;
        this.updateSelection();
    }

    updateSelection() {
        const items = this.list.querySelectorAll("li");
        items.forEach((item, index) => {
            if (index === this.selectedIndex) {
                item.classList.add("selected");
            } else {
                item.classList.remove("selected");
            }
        });
    }

    select() {
        return this.options[this.selectedIndex].value;
    }
}
