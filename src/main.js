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
    const clock = new Clock(clockEl);

    // Debug panel
    const debug = new DebugPanel();
    debug.attach(clock);

    // Gestures — single handler, state machine in main.js
    //
    // States: 'digital' | 'analog' | 'crown'
    //
    let view = 'digital';

    const gestures = new GestureDetector(() => clock.displayRotation);
    debug.gestures = gestures;
    gestures.on('*', (zone, direction) => {
        // Top-down swipe opens menu from any view
        if (zone === 'top' && direction === 'down') {
            clock.toggleMenu();
            return;
        }

        // Don't process other gestures while menu is open
        if (clock.menu.active) return;

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

    // Orientation source (also carries winding and shake events)
    const orientation = new OrientationSource();
    orientation.onOrientation = (data) => {
        if (!clock.manualMode) {
            clock.handleOrientation(data);
            debug.updateAccelData(data);
        }

        // Winding events from rotary encoder
        if (data.wind) {
            const windAmount = data.wind * 0.01;  // 0.01 per detent step (1%)
            clock.windCrown(windAmount);
        }
    };
    orientation.onRawAccel = (data) => {
        if (!clock.manualMode) clock.handleRawAccel(data);
    };
    orientation.onError = (msg) => debug.showSensorError(msg);

    // Viewport-based orientation drag (fallback when no hardware sensors)
    // Touch X position maps across viewport width to -180..+180 offset.
    // On release, commits offset into autoOrientation and resets to 0.
    let orientationDragActive = false;
    let orientationDragStartX = 0;
    let hasHardwareOrientation = false;

    orientation.onConnected = () => {
        hasHardwareOrientation = true;
    };

    const onDragStart = (e) => {
        if (hasHardwareOrientation) return;
        const t = e.touches ? e.touches[0] : e;
        if (t.clientY < window.innerHeight * 0.96) return;
        orientationDragActive = true;
        orientationDragStartX = t.clientX;
        gestures.suppressed = true;
        clock.orientationOffset = 0;
    };

    const onDragMove = (e) => {
        if (!orientationDragActive) return;
        const t = e.touches ? e.touches[0] : e;
        const dx = orientationDragStartX - t.clientX;
        clock.orientationOffset = (dx / window.innerWidth) * 360;
    };

    const onDragEnd = () => {
        if (!orientationDragActive) return;
        orientationDragActive = false;
        gestures.suppressed = false;
        clock.commitOrientationOffset();
    };

    document.addEventListener('touchstart', onDragStart, { passive: true, capture: true });
    document.addEventListener('touchmove', onDragMove, { passive: true });
    document.addEventListener('touchend', onDragEnd);
    document.addEventListener('mousedown', onDragStart, { capture: true });
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);

    orientation.start();

    // Lock screen orientation
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
        screen.orientation.lock(screen.orientation.type).catch(() => {});
    }

    // Expose for debug console
    window.clock = clock;

    // Dev-only recorder (dynamic import — excluded from production build)
    if (import.meta.env.DEV) {
        import('./recorder.js').then(({ initRecorder }) => {
            initRecorder(clockEl, clock);
        });
    }
});
