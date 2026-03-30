import './base.css';
import { Clock } from './clock.js';
import { OrientationSource } from './orientation.js';
import { GestureDetector } from './gesture-detector.js';
import { DebugPanel } from './debug-panel.js';

window.addEventListener('load', () => {
    const isLocalhost = window.location.hostname === 'localhost' ||
                        window.location.hostname === '127.0.0.1' ||
                        window.location.hostname === '::1';

    if (isLocalhost) {
        document.body.classList.add('localhost');
    }

    if (import.meta.env.DEV) {
        document.body.classList.add('devmode');
    }

    const clockEl = document.getElementById('clock');

    // Clock — owns faces, modes, rotation, shake detection
    const clock = new Clock(clockEl, {
        perfMultiplier: isLocalhost ? 3.0 : 1.0,
    });

    // Debug panel
    const debug = new DebugPanel();
    debug.attach(clock);

    // Gestures — single handler, state machine in main.js
    //
    // States: 'digital' | 'analog' | 'crown'
    //
    let view = 'digital';

    const gestures = new GestureDetector(clockEl, () => clock.displayRotation);
    gestures.on('*', (zone, direction) => {
        switch (view) {
            case 'digital':
                if (zone === 'right' && direction === 'left') {
                    clock.nextMode();
                    view = 'analog';
                }
                break;

            case 'analog':
                if (zone === 'left' && direction === 'right') {
                    clock.prevMode();
                    view = 'digital';
                } else if (zone === 'right' && direction === 'left') {
                    clock.showCrown();
                    view = 'crown';
                }
                break;

            case 'crown':
                if (direction === 'right' || (zone === 'left' && direction === 'right')) {
                    clock.hideCrown();
                    view = 'analog';
                } else if (zone === 'right' && direction === 'down') {
                    clock.windCrown(0.05);
                } else if (zone === 'right' && direction === 'up') {
                    clock.windCrown(-0.05);
                }
                break;
        }
    });

    // Orientation source
    const orientation = new OrientationSource();
    orientation.onOrientation = (data) => {
        if (!clock.manualMode) {
            clock.handleOrientation(data);
            debug.updateAccelData(data);
        }
    };
    orientation.onRawAccel = (data) => {
        if (!clock.manualMode) clock.handleRawAccel(data);
    };
    orientation.onError = (msg) => debug.showSensorError(msg);
    orientation.start();

    // Lock screen orientation
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
        screen.orientation.lock(screen.orientation.type).catch(() => {});
    }

    // Expose for debug console
    window.clock = clock;
});
