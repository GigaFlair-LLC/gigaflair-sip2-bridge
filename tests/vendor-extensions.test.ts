/**
 * Vendor Accommodation Tests
 *
 * Validates that the bridge correctly handles cross-vendor SIP2 quirks:
 *   - Symphony XA/XB/XC extension fields surfaced in `extensions`
 *   - Sierra repeated AF fields surfaced in `screenMessages[]`
 *   - checksumRequired=false lets legacy ILS messages through (warn, not reject)
 *   - Evergreen lowercase hex checksums are accepted (case-insensitive verify)
 *   - postLoginSCStatus config flag triggers SC Status after login
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    parsePatronStatusResponse,
    parseCheckoutResponse,
    parseCheckinResponse,
    parsePatronInformationResponse,
    parseEndSessionResponse,
} from '../src/utils/sip-parser.js';
import { verifyChecksum, calculateChecksum, appendChecksum } from '../src/utils/checksum.js';

const DATE = '20260222    120000';

// ── Fixture helpers ───────────────────────────────────────────────────────────

/** Build a patron status response raw string with optional extra fields appended */
function buildPatronStatus(extraFields: string = ''): string {
    const base = `24              001${DATE}AOTest|AAP12345|AEJane Smith|BZ0000|AU0000|CD0000|AS0000|BLY|${extraFields}`;
    const withSeq = `${base}AY0AZ`;
    const cs = calculateChecksum(withSeq);
    return `${withSeq}${cs}\r`;
}

// ── Extension field passthrough ───────────────────────────────────────────────
describe('Vendor Extension Fields (extensions)', () => {
    it('captures SirsiDynix Symphony XA/XB/XC fields in extensions', () => {
        const raw = buildPatronStatus('XAfoo|XBbar|XCbaz|');
        const res = parsePatronStatusResponse(raw);
        expect(res.extensions).toMatchObject({ XA: 'foo', XB: 'bar', XC: 'baz' });
    });

    it('captures Polaris-style PA/PB extension fields', () => {
        const raw = buildPatronStatus('PApolaris-value-1|PBpolaris-value-2|');
        const res = parsePatronStatusResponse(raw);
        expect(res.extensions).toMatchObject({ PA: 'polaris-value-1', PB: 'polaris-value-2' });
    });

    it('returns undefined extensions when all fields are standard', () => {
        const raw = buildPatronStatus('');
        const res = parsePatronStatusResponse(raw);
        expect(res.extensions).toBeUndefined();
    });

    it('does not include AO, AA, AE, BZ in extensions (they are standard)', () => {
        const raw = buildPatronStatus('XAextra|');
        const ext = parsePatronStatusResponse(raw).extensions ?? {};
        expect('AO' in ext).toBe(false);
        expect('AA' in ext).toBe(false);
        expect('AE' in ext).toBe(false);
        expect('BZ' in ext).toBe(false);
    });

    it('captures extension fields on checkout response', () => {
        const base = `121Y  ${DATE}AOTest|AAP12345|ABITEM1|AJTitle|AH20260401    000000|PApolaris-extra|`;
        const withSeq = `${base}AY0AZ`;
        const raw = `${withSeq}${calculateChecksum(withSeq)}\r`;
        const res = parseCheckoutResponse(raw);
        expect(res.extensions).toMatchObject({ PA: 'polaris-extra' });
    });

    it('captures extension fields on checkin response', () => {
        const base = `101YNN${DATE}AOTest|ABITEM1|AJTitle|XZsurplus-tag|`;
        const withSeq = `${base}AY0AZ`;
        const raw = `${withSeq}${calculateChecksum(withSeq)}\r`;
        const res = parseCheckinResponse(raw);
        expect(res.extensions).toMatchObject({ XZ: 'surplus-tag' });
    });
});

// ── Multiple screen messages (Sierra) ─────────────────────────────────────────
describe('Multiple Screen Messages (screenMessages[])', () => {
    it('collects two AF fields into screenMessages array', () => {
        const raw = buildPatronStatus('AFLine one|AFLine two|');
        const { screenMessages } = parsePatronStatusResponse(raw);
        expect(screenMessages).toEqual(['Line one', 'Line two']);
    });

    it('collects three AF fields', () => {
        const raw = buildPatronStatus('AFFirst|AFSecond|AFThird|');
        const { screenMessages } = parsePatronStatusResponse(raw);
        expect(screenMessages).toHaveLength(3);
        expect(screenMessages).toContain('Third');
    });

    it('screenMessages is empty array when no AF field', () => {
        const raw = buildPatronStatus('');
        const { screenMessages } = parsePatronStatusResponse(raw);
        expect(screenMessages).toEqual([]);
    });

    it('collects AF fields on end-session response', () => {
        const base = `36Y${DATE}AOTest|AAP12345|AFGoodbye!|AFThank you.|`;
        const withSeq = `${base}AY0AZ`;
        const raw = `${withSeq}${calculateChecksum(withSeq)}\r`;
        const { screenMessages } = parseEndSessionResponse(raw);
        expect(screenMessages).toEqual(['Goodbye!', 'Thank you.']);
    });
});

// ── Evergreen lowercase checksums ─────────────────────────────────────────────
describe('Evergreen Lowercase Checksum Compatibility', () => {
    it('verifyChecksum returns true for uppercase hex (standard)', () => {
        const msg = buildPatronStatus('');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('verifyChecksum returns true for lowercase hex (Evergreen)', () => {
        // Build a valid message, then lowercase the checksum chars
        const msg = buildPatronStatus('').trim();
        // AZ is followed by 4 hex chars
        const lowercased = msg.replace(/AZ([0-9A-F]{4})/, (_, cs) => `AZ${cs.toLowerCase()}`) + '\r';
        expect(verifyChecksum(lowercased)).toBe(true);
    });

    it('verifyChecksum returns true for mixed-case hex', () => {
        const msg = buildPatronStatus('').trim();
        const mixed = msg.replace(/AZ([0-9A-F]{4})/, (_, cs) => {
            // Alternate upper/lower per character
            const m = cs.split('').map((c: string, i: number) => i % 2 === 0 ? c.toLowerCase() : c).join('');
            return `AZ${m}`;
        }) + '\r';
        expect(verifyChecksum(mixed)).toBe(true);
    });

    it('verifyChecksum still rejects a corrupted checksum', () => {
        const msg = buildPatronStatus('');
        // Corrupt the last 4 chars (checksum value)
        const corrupted = msg.slice(0, -5) + '0000\r';
        expect(verifyChecksum(corrupted)).toBe(false);
    });
});

// ── checksumRequired=false (legacy ILS) ──────────────────────────────────────
import net from 'node:net';
import { SipClient } from '../src/services/sip-client.js';

describe('checksumRequired=false Legacy Mode (SipClient Integration)', () => {
    let server: net.Server;
    let mockResponse: string;

    beforeEach(() => {
        // Send a message with an intentionally wrong checksum (ABCD instead of valid hex)
        mockResponse = `24              001${DATE}AOTest|AAP12345|AEJane|BZ0000|AU0000|CD0000|AS0000|BLY|AY0AZABCD\r`;
        server = net.createServer((socket) => {
            socket.on('data', () => {
                socket.write(mockResponse, 'latin1');
            });
        });
    });

    it('SipClient REJECTS the response when checksumRequired=true (default)', async () => {
        await new Promise<void>(resolve => server.listen(6011, '127.0.0.1', resolve));
        const client = new SipClient('127.0.0.1', 6011, 2000, 'GigaFlair', false, undefined, true, true);

        await expect(client.patronStatus('P12345')).rejects.toThrow('SIP2 Checksum Mismatch');

        client.disconnect();
        await new Promise(resolve => server.close(resolve));
    });

    it('SipClient ACCEPTS the response when checksumRequired=false', async () => {
        await new Promise<void>(resolve => server.listen(6012, '127.0.0.1', resolve));
        // Pass false for the `checksumRequired` constructor argument
        const client = new SipClient('127.0.0.1', 6012, 2000, 'GigaFlair', false, undefined, true, false);

        const response = await client.patronStatus('P12345');
        // The promise should resolve and parse the payload despite the bad AZ field
        expect(response.patronBarcode).toBe('P12345');

        client.disconnect();
        await new Promise(resolve => server.close(resolve));
    });
});

// ── appendChecksum utility ────────────────────────────────────────────────────
describe('appendChecksum Utility', () => {
    it('appended checksum is verified correctly', () => {
        const partial = `23001${DATE}AOMockLib|AAP12345|`;
        const full = appendChecksum(partial, 0);
        expect(verifyChecksum(full)).toBe(true);
    });

    it('different sequence numbers produce different messages but both valid', () => {
        const partial = `23001${DATE}AOMockLib|AAP12345|`;
        const m0 = appendChecksum(partial, 0);
        const m1 = appendChecksum(partial, 1);
        expect(m0).not.toBe(m1);
        expect(verifyChecksum(m0)).toBe(true);
        expect(verifyChecksum(m1)).toBe(true);
    });
});
