import './base.css';
import { Clock } from './clock.js';
import { OrientationSource } from './orientation.js';
import { SwipeSwitch } from './clock/swipe-switch.js';
import { DebugPanel } from './debug-panel.js';

window.addEventListener('load', () => {
    const isLocalhost = window.location.hostname === 'localhost' ||
                        window.location.hostname === '127.0.0.1' ||
                        window.location.hostname === '::1';

    if (isLocalhost) {
        document.body.classList.add('localhost');
    }

    // Clock — owns faces, modes, rotation, shake detection
    const clock = new Clock(document.getElementById('clock'), {
        perfMultiplier: isLocalhost ? 3.0 : 1.0,
    });

    // Debug panel — reads clock state, wires controls
    const debug = new DebugPanel();
    debug.attach(clock);

    // Swipe to switch modes
    const swipe = new SwipeSwitch({
        getRotation: () => clock.displayRotation,
    });
    swipe.onSwipeLeft = () => clock.nextMode();
    swipe.onSwipeRight = () => clock.prevMode();

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
});
