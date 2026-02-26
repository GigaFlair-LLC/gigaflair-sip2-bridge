import { EventEmitter } from 'node:events';
import { MaskingService } from '../services/MaskingService.js';

export const bridgeEvents = new EventEmitter();
bridgeEvents.setMaxListeners(100); // Prevent memory leak warnings

export enum BridgeEvent {
    LOG = 'log',
    CONFIG_UPDATE = 'config_update'
}

/**
 * Redacts sensitive fields from raw SIP2 messages logged to the dashboard.
 *
 * Uses MaskingService (deterministic HMAC-SHA256) when the master key is available,
 * falling back to asterisk redaction if not. This ensures a single consistent
 * masking strategy across the entire application.
 *
 * SIP2 two-character field codes that carry credentials or personal identity:
 *   CN  — Login User ID (service account username in 93 Login command)
 *   CO  — Login Password (service account password in 93 Login command)
 *   AD  — Patron Password / PIN (sent in checkout, renew, patron-enable commands)
 *   AA  — Patron Identifier (barcode — PII)
 *   AE  — Personal Name (PII)
 *   AB  — Item Identifier (may be PII-adjacent in some contexts)
 */
function maskPii(data: unknown): unknown {
    if (!data || typeof data !== 'object') return data;
    // SECURITY: Clone the object to avoid mutating the original response data
    const obj = { ...(data as Record<string, unknown>) };
    // Password/credential fields — always fully redacted (no analytical value)
    const credentialFields = ['CN', 'CO', 'AD'];
    // PII fields — deterministically masked when possible for analytical utility
    const piiFields = ['AA', 'AE', 'AB'];
    const allSensitiveFields = [...credentialFields, ...piiFields];

    for (const key of ['raw', 'message'] as const) {
        if (typeof obj[key] === 'string') {
            let masked = obj[key] as string;
            for (const field of allSensitiveFields) {
                masked = masked.replace(new RegExp(`${field}([^|]*)`, 'g'), (_match, value: string) => {
                    if (credentialFields.includes(field)) {
                        return `${field}********`;
                    }
                    // PII: use deterministic masking if master key is available
                    try {
                        return `${field}${MaskingService.mask(value)}`;
                    } catch {
                        // GIGAFLAIR_MASTER_KEY not set — fall back to redaction
                        return `${field}********`;
                    }
                });
            }
            obj[key] = masked;
        }
    }
    return obj;
}

export function logToDashboard(level: 'info' | 'warn' | 'error', message: string, details?: unknown) {
    bridgeEvents.emit(BridgeEvent.LOG, {
        timestamp: new Date().toISOString(),
        level,
        message,
        details: maskPii(details)
    });
}
