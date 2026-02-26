import crypto from 'crypto';

export class MaskingService {
    /**
     * Deterministic Hashing: Ensure the same input always results in the same Masked output.
     * This allows for counting "Unique Patrons" without knowing their real identities.
     */
    static mask(data: string): string {
        if (!data) return data;

        const masterKey = process.env.GIGAFLAIR_MASTER_KEY;
        if (!masterKey) {
            throw new Error('GIGAFLAIR_MASTER_KEY is not set. Cannot mask data securely.');
        }

        // HMAC with SHA256 ensures deterministic output for the same input and key
        const hmac = crypto.createHmac('sha256', masterKey);
        hmac.update(data);
        return `MASKED_${hmac.digest('hex').substring(0, 16)}`;
    }

    /**
     * Recursively masks sensitive fields in a payload
     */
    static maskPayload(payload: unknown): unknown {
        if (!payload) return payload;

        if (Array.isArray(payload)) {
            return payload.map(item => this.maskPayload(item));
        }

        if (typeof payload === 'object') {
            const masked: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
                // Mask Password / PIN fields with a standard indicator
                if (key.toLowerCase().includes('password') || key.toLowerCase().includes('pin') || key === 'CQ' || key === 'CO') {
                    masked[key] = typeof value === 'string' ? '********' : value;
                    continue;
                }

                // Mask sensitive PII fields
                if (key.toLowerCase().includes('patronidentifier') ||
                    key.toLowerCase().includes('patronbarcode') ||
                    key.toLowerCase().includes('itemidentifier') ||
                    key.toLowerCase().includes('itembarcode') ||
                    key.toLowerCase().includes('personalname') ||
                    key === 'AA' || // Patron Identifier
                    key === 'AB' || // Item Identifier
                    key === 'AE') { // Personal Name

                    masked[key] = typeof value === 'string' ? this.mask(value) : value;
                } else {
                    masked[key] = this.maskPayload(value);
                }
            }
            return masked;
        }

        return payload;
    }
}
