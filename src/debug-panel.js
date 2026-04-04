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
        this.gestures = null;
        this.lastAccelData = null;
        this.lastWindEvent = null;      // { delta, timestamp }
        this.windEventTimeout = null;

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

        document.querySelector('.overwind-btn').addEventListener('click', () => {
            clock.debug.overwind();
        });

        document.querySelector('.dst-btn').addEventListener('click', () => {
            clock.simulateDST();
        });

        document.querySelector('.beans-btn').addEventListener('click', () => {
            clock.debug.beans();
        });

        document.getElementById('detach-on-drag-checkbox').addEventListener('change', (e) => {
            clock.debug.setForceDetachOnDrag(e.target.checked);
        });

        const orientSlider = document.getElementById('orientation-slider');
        const orientValue = document.getElementById('orientation-slider-value');
        orientSlider.addEventListener('input', () => {
            const deg = parseInt(orientSlider.value);
            orientValue.textContent = `${deg}°`;
            clock.setManualOrientation(deg);
        });

        // Clock events → debug UI
        clock.onShakeModeChanged = () => this.updateHorizonLine();
        clock.onManualModeChanged = (active) => {

        };
        clock.onDSTTriggered = (behavior, offsetMin) => {
            this._lastDstMsg = `DST ${offsetMin > 0 ? 'back' : 'fwd'}: ${behavior}`;
            // Clear after 5 seconds
            setTimeout(() => { this._lastDstMsg = null; }, 5000);
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

        const energy = clock.crownEnergy;
        const energyPct = Math.round(energy * 100);

        const dstLine = this._lastDstMsg ? `<br><span style="color: #f39c12;">${this._lastDstMsg}</span>` : '';

        // Wind event display
        let windLine = '';
        if (this.lastWindEvent) {
            const direction = this.lastWindEvent.delta > 0 ? '↻ CW' : '↺ CCW';
            windLine = `<br><span style="color: #3498db;">${direction}</span>`;
        }

        const accel = this.lastAccelData;
        if (accel) {
            this.orientationInfo.innerHTML = `
                Orientation: ${clock.displayRotation}°${modeIndicator}<br>
                Accel: x:${accel.x.toFixed(2)} y:${accel.y.toFixed(2)} z:${accel.z.toFixed(2)}<br>
                Time offset: ${offsetSign}${offsetMinutes}m<br>
                Energy: ${energyPct}%${windLine}${dstLine}
            `;
        } else {
            this.orientationInfo.innerHTML = `
                Orientation: ${Math.round(clock.displayRotation)}°${modeIndicator}<br>
                Accel: –<br>
                Time offset: ${offsetSign}${offsetMinutes}m<br>
                Energy: ${energyPct}%${windLine}${dstLine}
            `;
        }
    }

    /** Call when new accel data arrives (so the debug display can show x/y/z). */
    updateAccelData(data) {
        this.lastAccelData = data;
    }

    /** Call when winding event occurs (rotary encoder). */
    updateWindEvent(data) {
        this.lastWindEvent = {
            delta: data.delta,
            timestamp: Date.now()
        };

        // Clear event indicator after 500ms
        if (this.windEventTimeout) clearTimeout(this.windEventTimeout);
        this.windEventTimeout = setTimeout(() => {
            this.lastWindEvent = null;
        }, 500);
    }

    /* ---- Toggle & visibility ---- */

    setupDebugToggle() {
        this.debugCheckbox.addEventListener('change', () => {
            this.enabled = this.debugCheckbox.checked;
            document.body.classList.toggle('debug-mode', this.enabled);
            this.debugElement.classList.toggle('visible', this.enabled);
            this.manualControls.classList.toggle('visible', this.enabled);
            this.updateHorizonLine();
            if (this.gestures) this.gestures.showDebugZones(this.enabled);
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
