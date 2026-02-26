import { EventEmitter } from 'events';
import { bridgeEvents, BridgeEvent } from '../utils/events.js';

class InternalEventHub extends EventEmitter {
    constructor() {
        super();

        // Bridge structured transaction logs to the dashboard SSE stream
        // so that the Admin Dashboard receives enriched SIP2 transaction data
        // (action name, branchId, masked request/response) — not just raw strings.
        this.on('SIP2_TRANSACTION_LOGGED', (payload: unknown) => {
            try {
                bridgeEvents.emit(BridgeEvent.LOG, {
                    timestamp: new Date().toISOString(),
                    level: 'info',
                    message: 'SIP2 Transaction',
                    details: payload
                });
            } catch (err) {
                console.error('[EventHub] Error forwarding transaction log to dashboard:', err);
            }
        });
    }

    emitLog(payload: unknown) {
        // We ensure emission is decoupled from the main thread execution
        setImmediate(() => {
            try {
                this.emit('SIP2_TRANSACTION_LOGGED', payload);
            } catch (err) {
                // Prevent listener exceptions from crashing the process
                console.error('[EventHub] Error in transaction log listener:', err);
            }
        });
    }
}

export const EventHub = new InternalEventHub();
