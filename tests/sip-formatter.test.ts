import { describe, it, expect } from 'vitest';
import {
    formatPatronStatusRequest,
    formatLoginRequest,
    formatCheckoutRequest,
    formatCheckinRequest,
    formatRenewRequest,
    formatFeePaidRequest,
    formatItemInformationRequest,
    formatPatronInformationRequest,
    formatHoldRequest,
    formatRenewAllRequest,
    formatEndSessionRequest,
    formatSCStatusRequest,
    formatBlockPatronRequest,
    formatItemStatusUpdateRequest,
    formatPatronEnableRequest,
} from '../src/utils/sip-formatter.js';
import { verifyChecksum } from '../src/utils/checksum.js';

describe('SIP2 Formatter Byte-Position Tests', () => {
    it('formatPatronStatusRequest produces correct layout', () => {
        const msg = formatPatronStatusRequest('P12345');
        expect(msg.substring(0, 2)).toBe('23');
        expect(msg.substring(2, 5)).toBe('001'); // language
        expect(msg.substring(5, 23)).toMatch(/^\d{8}    \d{6}$/); // timestamp
        expect(msg).toContain('|AAP12345|');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatLoginRequest produces correct layout', () => {
        const msg = formatLoginRequest('user', 'pass');
        expect(msg.substring(0, 2)).toBe('93');
        expect(msg.substring(2, 3)).toBe('0'); // UID algo
        expect(msg.substring(3, 4)).toBe('0'); // PWD algo
        expect(msg).toContain('CNuser|');
        expect(msg).toContain('COpass|');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatCheckoutRequest produces correct layout', () => {
        const msg = formatCheckoutRequest('P123', 'I456');
        expect(msg.substring(0, 2)).toBe('11');
        expect(msg[2]).toBe('Y'); // scRenewalPolicy
        expect(msg[3]).toBe('N'); // noBlock
        expect(msg.substring(4, 22)).toMatch(/^\d{8}    \d{6}$/); // timestamp
        expect(msg).toContain('|AAP123|');
        expect(msg).toContain('|ABI456|');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatCheckinRequest produces correct layout', () => {
        const msg = formatCheckinRequest('I456');
        expect(msg.substring(0, 2)).toBe('09');
        expect(msg[2]).toBe('N'); // noBlock
        expect(msg.substring(3, 21)).toMatch(/^\d{8}    \d{6}$/); // timestamp
        expect(msg).toContain('|ABI456|');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatRenewRequest produces correct layout', () => {
        const msg = formatRenewRequest('P123', 'I456');
        expect(msg.substring(0, 2)).toBe('29');
        expect(msg[2]).toBe('Y'); // thirdPartyAllowed
        expect(msg[3]).toBe('N'); // noBlock
        expect(msg.substring(4, 22)).toMatch(/^\d{8}    \d{6}$/); // timestamp
        expect(msg).toContain('|AAP123|');
        expect(msg).toContain('|ABI456|');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatFeePaidRequest produces correct layout', () => {
        const msg = formatFeePaidRequest('P123', 'TX789', '25.50');
        expect(msg.substring(0, 2)).toBe('37');
        expect(msg.substring(2, 20)).toMatch(/^\d{8}    \d{6}$/); // timestamp
        // Fixed header: feeType(2) + paymentType(2) + currencyType(3) = 7 bytes after timestamp
        expect(msg.substring(20, 22)).toBe('01'); // feeType default = '01' (other)
        expect(msg.substring(22, 24)).toBe('00'); // paymentType default = '00' (cash)
        expect(msg.substring(24, 27)).toBe('USD'); // currencyType default = 'USD'
        expect(msg.substring(27, 29)).toBe('AO'); // institution id tag starts here
        expect(msg).toContain('|AAP123|');
        expect(msg).toContain('|BKTX789|');
        expect(msg).toContain('|BV25.50|');
        expect(msg).toContain('|BHUSD|'); // BH variable field mirrors currencyType
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('strips injection characters from barcodes only', () => {
        const msg = formatPatronStatusRequest('P123|45\r');
        expect(msg).not.toContain('P123|45');
        // The message ends with \r, so we check that the RAW input isn't present
        expect(msg).not.toContain('45\r');
        expect(msg).toContain('AAP12345'); // Barcode was sanitized
    });

    it('formatItemInformationRequest produces correct layout', () => {
        const msg = formatItemInformationRequest('I12345');
        expect(msg.substring(0, 2)).toBe('17');
        expect(msg.substring(2, 20)).toMatch(/^\d{8}    \d{6}$/); // timestamp
        expect(msg).toContain('|ABI12345|');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatRenewRequest includes optional patronPin (AD field)', () => {
        const msg = formatRenewRequest('P123', 'I456', 'GigaFlair', 0, 'my-pin');
        expect(msg.substring(0, 2)).toBe('29');
        expect(msg).toContain('|ADmy-pin|');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatRenewRequest without patronPin omits AD field', () => {
        const msg = formatRenewRequest('P123', 'I456');
        expect(msg).not.toContain('|AD');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatPatronInformationRequest produces correct layout', () => {
        const msg = formatPatronInformationRequest('P12345', { holds: true, charged: true });
        expect(msg.substring(0, 2)).toBe('63');
        expect(msg.substring(2, 5)).toBe('001'); // language
        expect(msg.substring(5, 23)).toMatch(/^\d{8}    \d{6}$/); // timestamp
        // summary flags at [23:33]: holds=Y overdue=' ' charged=Y fines=' ' recall=' ' + 5 reserved
        const summaryFlags = msg.substring(23, 33);
        expect(summaryFlags[0]).toBe('Y');  // holds requested
        expect(summaryFlags[1]).toBe(' ');  // overdue NOT requested (not set)
        expect(summaryFlags[2]).toBe('Y');  // charged requested
        expect(summaryFlags[3]).toBe(' ');  // fines NOT requested (not set)
        expect(summaryFlags[4]).toBe(' ');  // recall NOT requested (not set)
        expect(msg).toContain('|AAP12345|');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatPatronInformationRequest respects custom language code', () => {
        const msg = formatPatronInformationRequest('P12345', {}, 1, 5, 'GigaFlair', 0, '011');
        expect(msg.substring(2, 5)).toBe('011'); // French
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatHoldRequest produces correct layout for add (+)', () => {
        const msg = formatHoldRequest('+', 'P12345', 'I6789', '20261231', 'MAIN');
        expect(msg.substring(0, 2)).toBe('15');
        expect(msg[2]).toBe('+');
        expect(msg.substring(3, 21)).toMatch(/^\d{8}    \d{6}$/); // timestamp
        expect(msg).toContain('BW20261231|');
        expect(msg).toContain('|AAP12345|');
        expect(msg).toContain('|ABI6789|');
        expect(msg).toContain('|BSMAIN|');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatHoldRequest supports title-based holds via BT field', () => {
        const msg = formatHoldRequest('+', 'P12345', undefined, undefined, 'MAIN', 'GigaFlair', 0, 'Great Expectations');
        expect(msg).not.toContain('|AB');   // no item barcode
        expect(msg).toContain('BTGreat Expectations|');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatRenewAllRequest produces correct layout', () => {
        const msg = formatRenewAllRequest('P12345');
        expect(msg.substring(0, 2)).toBe('65');
        expect(msg).toContain('|AAP12345|');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatEndSessionRequest produces correct layout', () => {
        const msg = formatEndSessionRequest('P12345');
        expect(msg.substring(0, 2)).toBe('35');
        expect(msg.substring(2, 20)).toMatch(/^\d{8}    \d{6}$/); // timestamp
        expect(msg).toContain('|AAP12345|');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatSCStatusRequest produces correct layout', () => {
        const msg = formatSCStatusRequest(0);
        expect(msg.substring(0, 2)).toBe('99');
        expect(msg[2]).toBe('0');       // statusCode OK
        expect(msg.substring(3, 6)).toBe('080'); // maxPrintWidth
        expect(msg.substring(6, 10)).toBe('2.00'); // protocolVersion
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatBlockPatronRequest produces correct layout (cardRetained=false)', () => {
        const msg = formatBlockPatronRequest('P12345', false, 'Suspicious behaviour');
        expect(msg.substring(0, 2)).toBe('01');
        expect(msg[2]).toBe('N'); // cardRetained = false
        expect(msg.substring(3, 21)).toMatch(/^\d{8}    \d{6}$/); // timestamp
        expect(msg).toContain('|AAP12345|');
        expect(msg).toContain('ALSuspicious behaviour|');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatBlockPatronRequest sets cardRetained=Y when true', () => {
        const msg = formatBlockPatronRequest('P12345', true);
        expect(msg[2]).toBe('Y');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatItemStatusUpdateRequest produces correct layout', () => {
        const msg = formatItemStatusUpdateRequest('I12345', '2');
        expect(msg.substring(0, 2)).toBe('19');
        expect(msg[2]).toBe('2'); // securityMarker default (tattle-tape)
        expect(msg.substring(3, 21)).toMatch(/^\d{8}    \d{6}$/); // timestamp
        expect(msg).toContain('|ABI12345|');
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatPatronEnableRequest produces correct layout', () => {
        const msg = formatPatronEnableRequest('P12345');
        expect(msg.substring(0, 2)).toBe('25');
        expect(msg.substring(2, 20)).toMatch(/^\d{8}    \d{6}$/); // timestamp
        expect(msg).toContain('|AAP12345|');
        expect(msg).not.toContain('|AD'); // no pin
        expect(verifyChecksum(msg)).toBe(true);
    });

    it('formatPatronEnableRequest includes patronPin (AD field) when provided', () => {
        const msg = formatPatronEnableRequest('P12345', 'secret99');
        expect(msg).toContain('|ADsecret99|');
        expect(verifyChecksum(msg)).toBe(true);
    });
});
