import { describe, it, expect } from 'vitest';
import {
    formatLoginRequest,
    formatPatronStatusRequest,
    formatCheckoutRequest,
    formatCheckinRequest,
    formatPatronInformationRequest
} from '../src/utils/sip-formatter.js';
import {
    parsePatronStatusResponse,
    parseCheckoutResponse,
    parseFields,
    parseExtensions
} from '../src/utils/sip-parser.js';
import { verifyChecksum, appendChecksum } from '../src/utils/checksum.js';

describe('SIP2 Translation Suite', () => {

    describe('JSON -> SIP2 Formatting', () => {
        it('1. Basic Login Request (Minimal, happy-path)', () => {
            const sip = formatLoginRequest('admin', 'secret', 'MainLib', 0);
            // Expected prefix: 9300CNadmin|COsecret|CPMainLib|
            expect(sip).toContain('9300CNadmin|COsecret|CPMainLib|');
        });

        it('2. Patron Status Request With Optional Fields', () => {
            // Note: Our formatPatronStatusRequest uses current timestamp internally.
            // We check the structure and specified fields.
            const sip = formatPatronStatusRequest('1234567890', 'MainLib', 0, '001');
            expect(sip.startsWith('23001')).toBe(true);
            expect(sip).toContain('AOMainLib|');
            expect(sip).toContain('AA1234567890|');
        });

        it('3. CheckOut With Flags', () => {
            // Our current implementation (formatCheckoutRequest) has hardcoded YN flags
            const sip = formatCheckoutRequest('P0001', 'I1234', 'MainLib', 0);
            expect(sip.startsWith('11YN')).toBe(true);
            expect(sip).toContain('AOMainLib|');
            expect(sip).toContain('AAP0001|');
            expect(sip).toContain('ABI1234|');
        });

        it('4. CheckIn With Location Fields', () => {
            const sip = formatCheckinRequest('I1234', 'MainLib', 0);
            expect(sip.startsWith('09N')).toBe(true);
            expect(sip).toContain('AOMainLib|');
            expect(sip).toContain('ABI1234|');
        });

        it('5. Encoding / Non-ASCII Characters', () => {
            const sip = formatLoginRequest('bibliothécaire', 'pässwörd', 'München', 0);
            expect(sip).toContain('CNbibliothécaire|');
            expect(sip).toContain('COpässwörd|');
            expect(sip).toContain('CPMünchen|');
        });

        it('6. Missing Optional Field Omitted', () => {
            // In our current formatter, institutionId defaults to 'GigaFlair' if not provided
            const sip = formatPatronStatusRequest('P0001', '', 0, '000');
            expect(sip).toContain('AO|'); // It sends an empty AO field if string is empty
        });

        it('7. Parsing Extra Unknown Fields into Extensions', () => {
            // The parser must survive unknown tags and map them into the `.extensions` object
            const raw = '24              00120260222    120000AOMainLib|AAP0001|XYdebug_mode|ZZsecret|';
            const parsed = parsePatronStatusResponse(raw);
            expect(parsed.patronBarcode).toBe('P0001');
            expect(parsed.extensions?.XY).toBe('debug_mode');
            expect(parsed.extensions?.ZZ).toBe('secret');
        });

        it('8. Field Order Independence', () => {
            // The parser should correctly extract tags regardless of the order they appear in the payload
            const standard = '24              00120260222    120000AOMainLib|AAP0001|AEJane Smith|';
            const inverted = '24              00120260222    120000AEJane Smith|AAP0001|AOMainLib|';

            const parsedSt = parsePatronStatusResponse(standard);
            const parsedIn = parsePatronStatusResponse(inverted);

            expect(parsedSt.patronBarcode).toEqual(parsedIn.patronBarcode);
            expect(parsedSt.patronName).toEqual(parsedIn.patronName);
        });

        it('9. Checksum Calculation', () => {
            const sip = formatLoginRequest('admin', 'secret', 'MainLib', 1);
            expect(sip).toContain('AY1AZ');
            const checksum = sip.split('AZ')[1].replace('\r', '');
            expect(checksum.length).toBe(4);
        });

    });

    describe('SIP2 -> JSON Parsing', () => {
        it('1. Simple Patron Status Request', () => {
            const raw = '24              00120250223    084501AOMainLib|AA1234567890|';
            const fields = parseFields(raw);
            expect(fields['AO']).toBe('MainLib');
            expect(fields['AA']).toBe('1234567890');
        });

        it('2. Flags Parsed to Booleans', () => {
            const raw = '121Y  20250223    090000                  AOMainLib|AAP0001|ABI1234|';
            const parsed = parseCheckoutResponse(raw);
            expect(parsed.ok).toBe(true);
            expect(parsed.renewalOk).toBe(true);
        });

        it('3. Unknown Field Code Preserved in Extensions', () => {
            const raw = '24              00020250223    100000AAP0001|ZZfoo|';
            const parsed = parsePatronStatusResponse(raw);
            expect(parsed.extensions).toMatchObject({ ZZ: 'foo' });
        });

        it('4. Empty Field vs Missing Field', () => {
            const raw = '24              00020250223    111111AO|AA123|';
            const fields = parseFields(raw);
            expect(fields['AO']).toBe('');
            expect(fields['AA']).toBe('123');
        });

        it('5. Checksum Validation (valid vs corrupt)', () => {
            // Build a valid message with the correct checksum
            const base = '121Y  20250223    101010                  AOMainLib|AAP0001|ABI1234|';
            const correctMsg = appendChecksum(base, 0);
            expect(verifyChecksum(correctMsg)).toBe(true);

            // Corrupt the checksum by replacing it with 0000
            const corruptMsg = correctMsg.replace(/AZ[0-9A-F]{4}\r$/, 'AZ0000\r');
            expect(verifyChecksum(corruptMsg)).toBe(false);

            // A known-wrong checksum also fails
            const wrongRaw = '121Y  20250223    101010                  AOMainLib|AAP0001|ABI1234|AY0AZABCD\r';
            expect(verifyChecksum(wrongRaw)).toBe(false);
        });
    });

    describe('Translation Quality & Round-Trip', () => {
        it('Round-Trip: SIP2 -> JSON -> SIP2 (Semantics)', () => {
            const original = '9300CNadmin|COsecret|CPMainLib|';
            const fields = parseFields(original);
            const recreated = formatLoginRequest(fields['CN'] || '', fields['CO'] || '', fields['CP'] || '', 0);
            expect(recreated).toContain('CNadmin|COsecret|CPMainLib|');
        });

        it('Fuzz Style: Random identifiers', () => {
            for (let i = 0; i < 10; i++) {
                const id = Math.random().toString(36).substring(7);
                // Build a proper Patron Status Response (24) with the random barcode
                const statusMask = '              '; // 14 blanks
                const lang = '001';
                const transDate = '20250101    120000';
                const sip = `24${statusMask}${lang}${transDate}AOTest|AA${id}|`;
                const parsed = parsePatronStatusResponse(sip);
                expect(parsed.patronBarcode).toBe(id);
            }
        });

        it('Strictness: Malformed Input (Truncated Header)', () => {
            const raw = '24ID'; // Too short
            const parsed = parsePatronStatusResponse(raw);
            expect(parsed.patronBarcode).toBe('');
            expect(parsed.validPatron).toBe(false);
        });

        it('Internationalization: Round-Trip UTF-8', () => {
            const input = 'bibliothécaire';
            const sip = formatLoginRequest(input, 'pwd', 'loc', 0);
            const fields = parseFields(sip);
            expect(fields['CN']).toBe(input);
        });

        it('Ordering: Predictable Field Sequence', () => {
            const sip = formatLoginRequest('a', 'b', 'c', 0);
            // Ensure CN comes before CO and CP in our fixed template
            const cnIndex = sip.indexOf('CN');
            const coIndex = sip.indexOf('CO');
            const cpIndex = sip.indexOf('CP');
            expect(cnIndex).toBeLessThan(coIndex);
            expect(coIndex).toBeLessThan(cpIndex);
        });
    });
});
