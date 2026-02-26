import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MaskingService } from '../src/services/MaskingService.js';
import { EventHub } from '../src/services/EventHub.js';

describe('Security Layer: PII Masking & Event Logging', () => {

    describe('MaskingService', () => {
        it('should deterministically mask a string', () => {
            const input = '1234567890';
            const m1 = MaskingService.mask(input);
            const m2 = MaskingService.mask(input);

            expect(m1).toMatch(/^MASKED_/);
            expect(m1).toBe(m2);
            expect(m1).not.toContain(input);
        });

        it('should produce different masks for different inputs', () => {
            const m1 = MaskingService.mask('PATRON1');
            const m2 = MaskingService.mask('PATRON2');
            expect(m1).not.toBe(m2);
        });

        it('should recursively mask sensitive fields in a complex payload', () => {
            const payload = {
                action: 'Checkout',
                request: {
                    patronBarcode: 'P001',
                    itemBarcode: 'I999',
                    unrelated: 'foo'
                },
                response: {
                    patronName: 'Alice Smith',
                    screenMessage: 'Hello Alice'
                }
            };

            const masked = MaskingService.maskPayload(payload);

            expect(masked.request.patronBarcode).toMatch(/^MASKED_/);
            expect(masked.request.itemBarcode).toMatch(/^MASKED_/);
            expect(masked.request.unrelated).toBe('foo');

            // Should also catch common fields in response objects if they match keys
            // But currently maskPayload only targets specific keys. Let's check which ones.
            // AA, AB, AE, patronbarcode, itembarcode, personalname
        });

        it('should delete passwords/PINs entirely', () => {
            const payload = {
                sipUser: 'admin',
                sipPassword: 'secret_password',
                patronPin: '1234',
                CO: 'sip2_raw_pwd',
                safe: 'keep me'
            };

            const masked = MaskingService.maskPayload(payload);

            expect(masked.sipPassword).toBe('********');
            expect(masked.patronPin).toBe('********');
            expect(masked.CO).toBe('********');
            expect(masked.safe).toBe('keep me');
        });
    });

    describe('EventHub Integration', () => {
        it('should asynchronously emit logs', async () => {
            const logSpy = vi.fn();
            EventHub.on('SIP2_TRANSACTION_LOGGED', logSpy);

            const payload = { data: 'test-log' };
            EventHub.emitLog(payload);

            // Emission is setImmediate, so it hasn't happened yet
            expect(logSpy).not.toHaveBeenCalled();

            // Wait for next tick
            await new Promise(resolve => setImmediate(resolve));

            expect(logSpy).toHaveBeenCalledWith(payload);
        });
    });
});
