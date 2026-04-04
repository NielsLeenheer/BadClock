/**
 * Handles winding events from the rotary encoder.
 * Reads from the server's /winding/stream endpoint (SSE).
 *
 * Calls back with { delta } events where delta is +1 (clockwise) or -1 (counter-clockwise).
 */
export class WindingSource {
    constructor() {
        this.onWind = null;           // ({ delta }) => void
        this.onError = null;          // (message: string) => void
        this.onConnected = null;      // () => void — called once when encoder starts delivering data
        this._connected = false;
    }

    start() {
        this.connectSSE();
    }

    connectSSE() {
        const eventSource = new EventSource('/winding/stream');

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (!this._connected) {
                    this._connected = true;
                    console.log('✓ Rotary encoder connected');
                    this.onConnected?.();
                }
                if (this.onWind) this.onWind(data);
            } catch (err) {
                console.error('Error parsing winding data:', err);
            }
        };

        eventSource.onerror = () => {
            if (eventSource.readyState === EventSource.CLOSED) {
                eventSource.close();
                if (this.onError) {
                    this.onError('Winding stream closed - encoder may not be available');
                }
                // Don't reconnect, just fail gracefully
            }
        };
    }

    stop() {
        this._connected = false;
    }
}
