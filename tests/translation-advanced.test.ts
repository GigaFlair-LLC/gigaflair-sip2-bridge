import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    formatPatronStatusRequest,
    formatLoginRequest
} from '../src/utils/sip-formatter.js';
import {
    parsePatronStatusResponse,
    parseFields
} from '../src/utils/sip-parser.js';
import { calculateChecksum, appendChecksum, verifyChecksum } from '../src/utils/checksum.js';
import { SipClient } from '../src/services/sip-client.js';

describe('Advanced SIP2 Translation Suite (Production-Readiness)', () => {

    describe('Timing & Environment Tolerances', () => {

        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
            vi.restoreAllMocks();
        });

        it('1. Transaction Date Clock Skew Tolerance', () => {
            // Our system uses getSipTimestamp() which is strictly UTC.
            // We simulate parsing a message from an LMS that has a skewed clock.
            // The parser should treat transactionDate as an opaque string and not crash.
            const skewedDateRaw = '24              00120280101    120000AOMainLib|AAP123|';
            const parsed = parsePatronStatusResponse(skewedDateRaw);
            expect(parsed.patronBarcode).toBe('P123'); // Still parses completely fine
            expect(parsed.validPatron).toBe(false);
        });

        it('8. Environment Variable Config Impact (Timezone Independence)', () => {
            // Because getSipTimestamp uses UTC functions, modifying the local TZ 
            // shouldn't alter the output.
            vi.setSystemTime(new Date('2026-02-23T12:00:00Z'));
            process.env.TZ = 'America/New_York';
            const nyTime = formatLoginRequest('admin', 'pwd', '', 0);

            process.env.TZ = 'Asia/Tokyo';
            const tokyoTime = formatLoginRequest('admin', 'pwd', '', 0);

            expect(nyTime).toBe(tokyoTime); // Strict idempotency regardless of server locale
        });

        it('10. System Time Jump Handling (NTP Step adjustments)', () => {
            vi.setSystemTime(new Date('2026-02-23T12:00:00Z'));
            const msg1 = formatPatronStatusRequest('123', 'Inst', 0);

            // Jump clock forward 30 seconds
            vi.setSystemTime(new Date('2026-02-23T12:00:30Z'));
            const msg2 = formatPatronStatusRequest('123', 'Inst', 0);

            expect(msg1).not.toBe(msg2);
            // Verify timestamp actually advanced in the SIP payload
            const timestamp2 = msg2.substring(5, 23); // 23001YYYYMMDD    HHMMSS
            expect(timestamp2.endsWith('30')).toBe(true);
        });

    });

    describe('Protocol Limits & Edge Cases', () => {

        it('2. Sequence Number Overflow/Wrap', () => {
            // Refactored to test the ACTUAL wrapping logic inside SipClient
            const client = new SipClient('localhost', 6005, 5000);
            const getSeqNum = () => (client as any).getAvailableSeqNum();

            // Mark sequence numbers 0 through 8 as pending
            for (let i = 0; i < 9; i++) {
                (client as any).pending.set(i, { timer: null });
            }
            (client as any).nextSeqNum = 9;

            // The available sequence number should be 9
            expect(getSeqNum()).toBe(9);
            // After 9 is given, nextSeqNum should wrap to 0
            expect((client as any).nextSeqNum).toBe(0);

            // Give it 9 so it's fully saturated
            (client as any).pending.set(9, { timer: null });
            // It should now throw because capacity (10) is reached
            expect(() => getSeqNum()).toThrow('SIP2 client at capacity: all 10 sequence numbers in use');
        });

        it('6. Network Byte Order / Partial Read Recovery', () => {
            // Simulating a partial TCP packet read (missing the terminator and checksum)
            const fullMessage = '121Y  20260223    090000                  AOMainLib|AAP0001|ABI1234|AY0AZABCD\r';
            const partial = fullMessage.slice(0, 63); // Cuts off inside the AB field (ABI)

            // Our simple split('|') parser handles it natively by extracting what it can
            const fields = parseFields(partial);
            expect(fields['AO']).toBe('MainLib');
            expect(fields['AA']).toBe('P0001');
            // 'AB' is truncated, but parser still grabs the partial value
            expect(fields['AB']).toBe('I');
            expect(verifyChecksum(partial)).toBe(false); // Checksum fails as expected
        });

    });

    describe('Performance & GC Tests', () => {

        it('3. Processing Deadline Enforcement (SLA < 500ms)', () => {
            const start = performance.now();
            let sumLength = 0;
            // Translate 10,000 messages (10x the requested limit to prove extreme headroom)
            // Testing the pure parser performance with proper response messages (24)
            const statusMask = '              '; // 14 blanks
            const lang = '001';
            const transDate = '20250101    120000';
            for (let i = 0; i < 10000; i++) {
                const patronId = `P${i}`;
                const sip = `24${statusMask}${lang}${transDate}AOTestLib|AA${patronId}|`;
                const parsed = parsePatronStatusResponse(sip);
                sumLength += parsed.patronBarcode.length;
            }
            const duration = performance.now() - start;
            expect(duration).toBeLessThan(500); // Must complete within 500ms
            expect(sumLength).toBeGreaterThan(10000); // Ensure optimizer didn't skip loop
        });

        // Only run GC tests if the runtime was launched with --expose-gc
        it.skipIf(typeof global.gc !== 'function')('4. Memory Leak Detection (Allocation Bounds)', () => {
            const iterations = 50000;

            global.gc!();
            const memoryBefore = process.memoryUsage().heapUsed;

            for (let i = 0; i < iterations; i++) {
                const sip = formatLoginRequest('admin', 'complex_password_12345!@#', 'LocA', i % 10);
                parseFields(sip);
            }

            global.gc!();
            const memoryAfter = process.memoryUsage().heapUsed;

            // Delta should be minimal after GC. We allow up to 15MB delta due to V8's heuristics
            const deltaMB = (memoryAfter - memoryBefore) / 1024 / 1024;
            expect(deltaMB).toBeLessThan(15);
        });

    });

});
