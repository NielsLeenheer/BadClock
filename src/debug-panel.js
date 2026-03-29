import './debug-panel.css';

/**
 * Debug panel: toggle, horizon line, manual orientation controls,
 * orientation info display, sensor error messages, fullscreen toggle.
 *
 * Call attach(clock) to wire everything up — reads state from clock each frame.
 */
export class DebugPanel {
    constructor() {
        this.debugElement = document.getElementById('debug-info');
        this.horizonLine = document.getElementById('horizon-line');
        this.manualControls = document.getElementById('manual-controls');
        this.debugCheckbox = document.getElementById('debug-checkbox');
        this.fullscreenToggle = document.getElementById('fullscreen-toggle');
        this.orientationInfo = document.getElementById('orientation-info');
        this.timeDisplay = document.getElementById('time-display');

        this.enabled = false;
        this.clock = null;
        this.lastAccelData = null;

        this.setupDebugToggle();
        this.setupFullscreenToggle();
    }

    /** Wire the debug panel to a clock instance. */
    attach(clock) {
        this.clock = clock;

        // Button actions → clock
        document.querySelectorAll('.angle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                clock.setManualOrientation(parseInt(btn.dataset.angle));
            });
        });

        document.querySelector('.auto-btn').addEventListener('click', () => {
            clock.disableManualMode();
        });

        document.querySelector('.random-btn').addEventListener('click', () => {
            clock.setManualOrientation(Math.floor(Math.random() * 24) * 15);
        });

        document.querySelector('.shake-btn').addEventListener('click', () => {
            clock.toggleShakeMode();
            this.updateHorizonLine();
        });

        // Clock events → debug UI
        clock.onShakeModeChanged = () => this.updateHorizonLine();
        clock.onManualModeChanged = (active) => {
            this.manualControls.classList.toggle('active', active);
        };

        // Start render loop
        this.update();
    }

    /* ---- Per-frame update ---- */

    update() {
        if (this.clock) {
            this.renderTimeDisplay();
            this.renderOrientationInfo();
        }
        requestAnimationFrame(() => this.update());
    }

    renderTimeDisplay() {
        const displayTime = new Date(Date.now() + this.clock.timeOffset);
        const h = displayTime.getHours();
        const m = displayTime.getMinutes();
        const s = displayTime.getSeconds();

        if (this.timeDisplay) {
            this.timeDisplay.textContent =
                `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
    }

    renderOrientationInfo() {
        if (!this.orientationInfo) return;

        const clock = this.clock;
        const offsetMinutes = Math.round(clock.timeOffset / 60000);
        const offsetSign = offsetMinutes >= 0 ? '+' : '';

        let modeIndicator = '';
        if (clock.isShaking) {
            modeIndicator = ' <span style="color: #e74c3c;">[SHAKE]</span>';
        } else if (clock.manualMode) {
            modeIndicator = ' (manual)';
        }

        const accel = this.lastAccelData;
        if (accel) {
            this.orientationInfo.innerHTML = `
                Orientation: ${clock.displayRotation}°${modeIndicator}<br>
                Accel: x:${accel.x.toFixed(2)} y:${accel.y.toFixed(2)} z:${accel.z.toFixed(2)}<br>
                Time offset: ${offsetSign}${offsetMinutes}m
            `;
        } else {
            const lines = this.orientationInfo.innerHTML.split('<br>');
            if (lines.length >= 3) {
                lines[0] = `Orientation: ${Math.round(clock.displayRotation)}°${modeIndicator}`;
                lines[2] = `Time offset: ${offsetSign}${offsetMinutes}m`;
                this.orientationInfo.innerHTML = lines.join('<br>');
            }
        }
    }

    /** Call when new accel data arrives (so the debug display can show x/y/z). */
    updateAccelData(data) {
        this.lastAccelData = data;
    }

    /* ---- Toggle & visibility ---- */

    setupDebugToggle() {
        this.debugCheckbox.addEventListener('change', () => {
            this.enabled = this.debugCheckbox.checked;
            this.debugElement.classList.toggle('visible', this.enabled);
            this.manualControls.classList.toggle('visible', this.enabled);
            this.updateHorizonLine();
        });
    }

    updateHorizonLine() {
        this.horizonLine.classList.toggle('visible', this.enabled);
    }

    setupFullscreenToggle() {
        this.fullscreenToggle.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                const elem = document.documentElement;
                if (elem.requestFullscreen) {
                    elem.requestFullscreen().then(() => {
                        if (screen.orientation && typeof screen.orientation.lock === 'function') {
                            screen.orientation.lock(screen.orientation.type).catch(() => {});
                        }
                    }).catch(() => {});
                }
            } else if (document.exitFullscreen) {
                document.exitFullscreen().catch(() => {});
            }
        });
    }

    showSensorError(message) {
        if (!this.orientationInfo) return;

        let suggestions = '';
        if (message.includes('permission') || message.includes('Permission')) {
            suggestions = '<br><small>• Check browser permissions for motion sensors</small>';
        } else if (message.includes('HTTPS') || message.includes('readable')) {
            suggestions = '<br><small>• Requires HTTPS or localhost</small><br><small>• Current: ' + window.location.protocol + '//' + window.location.host + '</small>';
        } else if (message.includes('not found') || message.includes('No orientation')) {
            suggestions = '<br><small>• Device has no orientation sensor</small><br><small>• Use manual controls (top-right)</small>';
        }

        this.orientationInfo.innerHTML = `
            <span style="color: #e74c3c;">${message}</span>${suggestions}<br>
            <br>
            Orientation: disabled<br>
            Use manual controls →
        `;
    }
}
