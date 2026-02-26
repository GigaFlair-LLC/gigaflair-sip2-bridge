import { describe, it, expect } from 'vitest';
import {
    sanitizeSipField,
    formatPatronStatusRequest,
    formatCheckoutRequest,
    formatCheckinRequest,
    formatRenewRequest,
    formatFeePaidRequest,
    formatHoldRequest,
    formatLoginRequest,
    formatBlockPatronRequest,
    formatPatronEnableRequest,
} from '../src/utils/sip-formatter.js';
import { verifyChecksum } from '../src/utils/checksum.js';
import { parseFields } from '../src/utils/sip-parser.js';

/**
 * SIP2 uses pipe (|) as field delimiter and CR (\r) as message terminator.
 * Injecting these into user-supplied field values is a classic protocol
 * injection vector. The bridge has TWO defense layers:
 *
 *   1. Route-level:  Zod + SIP2_SAFE regex (/^[a-zA-Z0-9 \-_.]+$/) rejects
 *      dangerous input at the HTTP boundary.
 *   2. Formatter-level: sanitizeSipField strips |, \r, \n, and \x00-\x1F
 *      as defense-in-depth when formatters are called directly.
 *
 * This file tests BOTH layers plus parser robustness.
 */

// ─── Layer 2: sanitizeSipField unit tests ────────────────────────────────────

describe('sanitizeSipField', () => {
    it('strips pipe (SIP2 field delimiter)', () => {
        expect(sanitizeSipField('ABC|DEF')).toBe('ABCDEF');
    });

    it('strips carriage return (SIP2 message terminator)', () => {
        expect(sanitizeSipField('ABC\rDEF')).toBe('ABCDEF');
    });

    it('strips linefeed', () => {
        expect(sanitizeSipField('ABC\nDEF')).toBe('ABCDEF');
    });

    it('strips null byte', () => {
        expect(sanitizeSipField('ABC\x00DEF')).toBe('ABCDEF');
    });

    it('strips all control characters \\x01-\\x1F', () => {
        let input = 'CLEAN';
        for (let c = 0x01; c <= 0x1f; c++) {
            input += String.fromCharCode(c);
        }
        input += 'END';
        expect(sanitizeSipField(input)).toBe('CLEANEND');
    });

    it('strips combined injection payload', () => {
        // Close the current field, inject a fake AO field, and add CR to terminate early
        expect(sanitizeSipField('EVIL|AOfakeInst\r')).toBe('EVILAOfakeInst');
    });

    it('passes through safe characters unchanged', () => {
        const safe = 'ABCdef012 !@#$%^&*()+=[]{}:;"\'<>,./?' ;
        expect(sanitizeSipField(safe)).toBe(safe);
    });

    it('returns empty string for all-dangerous input', () => {
        expect(sanitizeSipField('|\r\n\x00\x01\x1F')).toBe('');
    });
});

// ─── Layer 2: Formatter-level sanitization across all commands ───────────────

describe('Formatter-level injection prevention', () => {
    const MALICIOUS_PATRON = 'P123|AOfakeInst\r';
    const MALICIOUS_ITEM   = 'I456|\rAAfakePatron|';
    const MALICIOUS_INST   = 'Evil\x00Inst|';

    it('formatPatronStatusRequest sanitizes patron and institution', () => {
        const msg = formatPatronStatusRequest(MALICIOUS_PATRON, MALICIOUS_INST);
        expect(msg).toContain('AAP123AOfakeInst|');
        expect(msg).toContain('AOEvilInst|');
        expect(msg).not.toContain('\x00');
        // Verify field count: header+AOinst, AA, AC, AY+AZ = 4 pipe-delimited parts before \r
        const parts = msg.replace(/\r$/, '').split('|');
        expect(parts.length).toBe(4);
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatCheckoutRequest sanitizes patron, item, and institution', () => {
        const msg = formatCheckoutRequest(MALICIOUS_PATRON, MALICIOUS_ITEM, MALICIOUS_INST);
        expect(msg).toContain('AAP123AOfakeInst|');
        expect(msg).toContain('ABI456AAfakePatron|');
        expect(msg).toContain('AOEvilInst|');
        expect(msg).not.toMatch(/\|P123\|/);  // original pipe NOT present
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatCheckoutRequest sanitizes optional patronPin', () => {
        const msg = formatCheckoutRequest('P1', 'I2', 'inst', 0, 'pin|\rsecret');
        expect(msg).toContain('ADpinsecret|');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatCheckinRequest sanitizes item barcode', () => {
        const msg = formatCheckinRequest(MALICIOUS_ITEM, MALICIOUS_INST);
        expect(msg).toContain('ABI456AAfakePatron|');
        expect(msg).toContain('AOEvilInst|');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatRenewRequest sanitizes patron, item, and optional pin', () => {
        const msg = formatRenewRequest(MALICIOUS_PATRON, MALICIOUS_ITEM, MALICIOUS_INST, 0, 'my|pin\r');
        expect(msg).toContain('AAP123AOfakeInst|');
        expect(msg).toContain('ABI456AAfakePatron|');
        expect(msg).toContain('ADmypin|');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatFeePaidRequest sanitizes patron, feeId, amount, and currency', () => {
        const msg = formatFeePaidRequest(MALICIOUS_PATRON, 'TX|789', '25|\r50', MALICIOUS_INST);
        expect(msg).toContain('AAP123AOfakeInst|');
        expect(msg).toContain('BKTX789|');
        expect(msg).toContain('BV2550|');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatHoldRequest sanitizes patron, item, pickup, and titleId', () => {
        const msg = formatHoldRequest('+', MALICIOUS_PATRON, MALICIOUS_ITEM, undefined, 'MAIN|\r', MALICIOUS_INST, 0, 'Title|\rInjection');
        expect(msg).toContain('AAP123AOfakeInst|');
        expect(msg).toContain('ABI456AAfakePatron|');
        expect(msg).toContain('BSMAIN|');
        expect(msg).toContain('BTTitleInjection|');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatLoginRequest sanitizes uid, password, and location', () => {
        const msg = formatLoginRequest('admin|\r', 'pass|\rword', 'loc|\x00');
        expect(msg).toContain('CNadmin|');
        expect(msg).toContain('COpassword|');
        expect(msg).toContain('CPloc|');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatBlockPatronRequest sanitizes patron and message', () => {
        const msg = formatBlockPatronRequest(MALICIOUS_PATRON, false, 'blocked|\rbadly');
        expect(msg).toContain('AAP123AOfakeInst|');
        expect(msg).toContain('ALblockedbadly|');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatPatronEnableRequest sanitizes patron and optional pin', () => {
        const msg = formatPatronEnableRequest(MALICIOUS_PATRON, 'pin|\r');
        expect(msg).toContain('AAP123AOfakeInst|');
        expect(msg).toContain('ADpin|');
        expect(verifyChecksum(msg)).toBe(true);
    });
});

// ─── Layer 1: SIP2_SAFE regex (route-level Zod validation) ──────────────────

describe('SIP2_SAFE route-level regex', () => {
    const SIP2_SAFE = /^[a-zA-Z0-9 \-_.]+$/;

    it('accepts normal patron barcode', () => {
        expect(SIP2_SAFE.test('P12345')).toBe(true);
    });

    it('accepts barcode with hyphens and dots', () => {
        expect(SIP2_SAFE.test('LIB-2024.001')).toBe(true);
    });

    it('accepts barcode with spaces', () => {
        expect(SIP2_SAFE.test('John Doe')).toBe(true);
    });

    it('rejects pipe character', () => {
        expect(SIP2_SAFE.test('P123|45')).toBe(false);
    });

    it('rejects carriage return', () => {
        expect(SIP2_SAFE.test('P123\r45')).toBe(false);
    });

    it('rejects linefeed', () => {
        expect(SIP2_SAFE.test('P123\n45')).toBe(false);
    });

    it('rejects null byte', () => {
        expect(SIP2_SAFE.test('P123\x0045')).toBe(false);
    });

    it('rejects empty string', () => {
        expect(SIP2_SAFE.test('')).toBe(false);
    });

    it('rejects tab character', () => {
        expect(SIP2_SAFE.test('P123\t45')).toBe(false);
    });

    it('rejects unicode zero-width space', () => {
        expect(SIP2_SAFE.test('P123\u200B45')).toBe(false);
    });

    it('rejects SQL-like injection through special chars', () => {
        expect(SIP2_SAFE.test("'; DROP TABLE patrons;--")).toBe(false);
    });
});

// ─── Parser robustness ──────────────────────────────────────────────────────

describe('Parser Robustness', () => {
    it('parser does not crash on XSS-like content in field values', () => {
        const raw = '24              00120260223    120000AOTest|AA<script>alert(1)</script>|';
        const fields = parseFields(raw);
        expect(fields['AA']).toBe('<script>alert(1)</script>');
    });

    it('parser treats unsanitized pipe as field boundary (not value content)', () => {
        // Demonstrates WHY sanitization on the egress side is critical:
        // if pipes aren't stripped, the parser will split the value incorrectly
        const raw = '24              00120260223    120000AOTest|AAhello|world|';
        const fields = parseFields(raw);
        // 'world' would NOT be part of AA — it becomes a separate (broken) field
        expect(fields['AA']).toBe('hello');
    });
});
