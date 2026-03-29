/**
 * Manages switching between clock face modes with slide animations.
 * Modes are laid out left-to-right in the order they are registered.
 */
export class ModeSwitcher {
    constructor() {
        this.modes = [];      // [{ name, element }]
        this.currentIndex = 0;
    }

    /** Register a mode. First registered mode is visible by default. */
    add(name, element) {
        const index = this.modes.length;
        this.modes.push({ name, element });

        if (index === 0) {
            element.style.transform = 'translateX(0)';
        } else {
            element.style.transform = 'translateX(100%)';
        }
    }

    get current() {
        return this.modes[this.currentIndex]?.name;
    }

    /** Switch to a mode by name. Slides left/right based on relative position. */
    switchTo(name) {
        const targetIndex = this.modes.findIndex(m => m.name === name);
        if (targetIndex === -1 || targetIndex === this.currentIndex) return;

        const incoming = this.modes[targetIndex].element;
        const outgoing = this.modes[this.currentIndex].element;

        // Slide direction based on position in the list
        const goingRight = targetIndex > this.currentIndex;
        const inFrom = goingRight ? '100%' : '-100%';
        const outTo  = goingRight ? '-100%' : '100%';

        // Place incoming off-screen instantly
        incoming.style.transition = 'none';
        incoming.style.transform = `translateX(${inFrom})`;
        incoming.offsetHeight; // force reflow

        // Animate both
        incoming.style.transition = 'transform 0.35s ease-in-out';
        outgoing.style.transition = 'transform 0.35s ease-in-out';
        incoming.style.transform = 'translateX(0)';
        outgoing.style.transform = `translateX(${outTo})`;

        this.currentIndex = targetIndex;
    }

    /** Switch to the next mode (wraps around). */
    next() {
        const nextIndex = (this.currentIndex + 1) % this.modes.length;
        this.switchTo(this.modes[nextIndex].name);
    }

    /** Switch to the previous mode (wraps around). */
    prev() {
        const prevIndex = (this.currentIndex - 1 + this.modes.length) % this.modes.length;
        this.switchTo(this.modes[prevIndex].name);
    }
}
