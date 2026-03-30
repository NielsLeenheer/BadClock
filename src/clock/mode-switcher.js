/**
 * Manages switching between clock face modes with slide animations.
 * Modes are laid out left-to-right in the order they are registered.
 *
 * Uses the `translate` CSS property (not `transform`) so it doesn't
 * conflict with other transforms like `rotate`.
 */
export class ModeSwitcher {
    constructor() {
        this.modes = [];
        this.currentIndex = 0;
    }

    add(name, element) {
        const index = this.modes.length;
        this.modes.push({ name, element });

        element.style.translate = index === 0 ? '0' : '100%';
    }

    get current() {
        return this.modes[this.currentIndex]?.name;
    }

    switchTo(name) {
        const targetIndex = this.modes.findIndex(m => m.name === name);
        if (targetIndex === -1 || targetIndex === this.currentIndex) return;

        const incoming = this.modes[targetIndex].element;
        const outgoing = this.modes[this.currentIndex].element;

        const goingRight = targetIndex > this.currentIndex;
        const inFrom = goingRight ? '100%' : '-100%';
        const outTo  = goingRight ? '-100%' : '100%';

        incoming.style.transition = 'none';
        incoming.style.translate = inFrom;
        incoming.offsetHeight;

        incoming.style.transition = 'translate 0.35s ease-in-out';
        outgoing.style.transition = 'translate 0.35s ease-in-out';
        incoming.style.translate = '0';
        outgoing.style.translate = outTo;

        this.currentIndex = targetIndex;
    }

    next() {
        const nextIndex = (this.currentIndex + 1) % this.modes.length;
        this.switchTo(this.modes[nextIndex].name);
    }

    prev() {
        const prevIndex = (this.currentIndex - 1 + this.modes.length) % this.modes.length;
        this.switchTo(this.modes[prevIndex].name);
    }
}
