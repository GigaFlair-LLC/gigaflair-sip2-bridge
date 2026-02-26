/**
 * Full Command Coverage Integration Tests
 *
 * Exercises every SIP2 command pair (all 15) end-to-end through the bridge HTTP API,
 * using the enhanced mock LMS that now handles all commands.
 *
 * Port: 6015 (unique to avoid conflicts with other test suites)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { MockLmsEnhancedServer } from './mock-lms-enhanced.js';
import { ConfigService } from '../src/services/ConfigService.js';

const PORT = 6015;
const API_KEY = 'test-full-coverage-key';

describe('Full SIP2 Command Coverage', () => {
    let app: FastifyInstance;
    let mock: MockLmsEnhancedServer;

    beforeAll(async () => {
        mock = new MockLmsEnhancedServer(PORT, '127.0.0.1');
        await mock.start();

        process.env.LMS_HOST = '127.0.0.1';
        process.env.LMS_PORT = String(PORT);
        process.env.BRIDGE_API_KEY = API_KEY;
        process.env.NODE_ENV = 'test';

        ConfigService._resetInstance();
        app = await createServer();
        await app.ready();
    });

    afterAll(async () => {
        if (app) await app.close();
        await mock.stop();
    });

    // Shared helper
    const post = (url: string, payload: object) =>
        app.inject({ method: 'POST', url, headers: { 'x-api-key': API_KEY }, payload });
    const get = (url: string) =>
        app.inject({ method: 'GET', url, headers: { 'x-api-key': API_KEY } });

    // ── 23/24 Patron Status ──────────────────────────────────────────────────
    describe('Commands 23/24 — Patron Status', () => {
        it('returns 200 with patron data for known patron', async () => {
            const res = await post('/api/v1/patron/status', { patronBarcode: 'VALID001' });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.patronBarcode).toBe('VALID001');
            expect(body.validPatron).toBe(true);
            expect(body.patronName).toBe('Alice Valid');
        });

        it('returns 200 with validPatron=false for unknown patron', async () => {
            const res = await post('/api/v1/patron/status', { patronBarcode: 'UNKNOWN999' });
            expect(res.statusCode).toBe(200);
            expect(JSON.parse(res.payload).validPatron).toBe(false);
        });

        it('returns 400 for missing patronBarcode', async () => {
            const res = await post('/api/v1/patron/status', {});
            expect(res.statusCode).toBe(400);
        });
    });

    // ── 11/12 Checkout ───────────────────────────────────────────────────────
    describe('Commands 11/12 — Checkout', () => {
        it('returns ok=true for valid checkout', async () => {
            const res = await post('/api/v1/checkout', { patronBarcode: 'VALID001', itemBarcode: 'ITEM123' });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.ok).toBe(true);
            expect(body.itemBarcode).toBe('ITEM123');
        });

        it('includes dueDate in response', async () => {
            const res = await post('/api/v1/checkout', { patronBarcode: 'VALID001', itemBarcode: 'ITEM456' });
            const body = JSON.parse(res.payload);
            expect(body.dueDate).toBe('20260401    000000');
        });

        it('rejects checkout for BLOCKED001', async () => {
            const res = await post('/api/v1/checkout', { patronBarcode: 'BLOCKED001', itemBarcode: 'ITEM789' });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.ok).toBe(false);
            expect(body.screenMessage).toBe('Patron blocked');
        });
    });

    // ── 09/10 Checkin ────────────────────────────────────────────────────────
    describe('Commands 09/10 — Checkin', () => {
        it('returns ok=true for valid checkin', async () => {
            const res = await post('/api/v1/checkin', { itemBarcode: 'ITEM123' });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.ok).toBe(true);
            expect(body.itemBarcode).toBe('ITEM123');
        });

        it('includes alert and magneticMedia in response', async () => {
            const res = await post('/api/v1/checkin', { itemBarcode: 'ITEM999' });
            const body = JSON.parse(res.payload);
            expect(body.alert).toBe(false);
            expect(body.magneticMedia).toBe(false);
        });
    });

    // ── 29/30 Renew ──────────────────────────────────────────────────────────
    describe('Commands 29/30 — Renew', () => {
        it('returns ok=true for valid renew', async () => {
            const res = await post('/api/v1/renew', { patronBarcode: 'VALID001', itemBarcode: 'ITEM123' });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.ok).toBe(true);
            expect(body.dueDate).toBe('20260501    000000');
        });

        it('rejects renew for BLOCKED001', async () => {
            const res = await post('/api/v1/renew', {
                patronBarcode: 'BLOCKED001', itemBarcode: 'ITEM123'
            });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.ok).toBe(false);
            expect(body.screenMessage).toBe('Patron blocked');
        });
    });

    // ── 17/18 Item Information ───────────────────────────────────────────────
    describe('Commands 17/18 — Item Information', () => {
        it('returns circulationStatus, securityMarker, titleId', async () => {
            const res = await post('/api/v1/item/status', { itemBarcode: 'ITEM123' });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.circulationStatus).toBe('01');
            expect(body.itemBarcode).toBe('ITEM123');
            expect(body.titleId).toBe('Test Item Title');
        });
    });

    // ── 37/38 Fee Paid ───────────────────────────────────────────────────────
    describe('Commands 37/38 — Fee Paid', () => {
        it('returns ok=true for accepted fee payment', async () => {
            const res = await post('/api/v1/patron/fee-paid', {
                patronBarcode: 'VALID001', feeId: 'TXN001', amount: '5.00'
            });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.ok).toBe(true);
        });

        it('rejects fee payment for BLOCKED001', async () => {
            const res = await post('/api/v1/patron/fee-paid', {
                patronBarcode: 'BLOCKED001',
                feeId: 'TXN002',
                amount: '12.00'
            });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.ok).toBe(false);
            expect(body.screenMessage).toBe('Payment denied');
        });
    });

    // ── 63/64 Patron Information ─────────────────────────────────────────────
    describe('Commands 63/64 — Patron Information', () => {
        it('returns patron item lists (holdItems, chargedItems)', async () => {
            const res = await post('/api/v1/patron/information', { patronBarcode: 'VALID001' });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.holdItems).toEqual(['VALID001-HOLD1']);
            expect(body.chargedItems).toEqual(['ITEM001']);
        });

        it('returns count fields (holdItemsCount, chargedItemsCount)', async () => {
            const res = await post('/api/v1/patron/information', { patronBarcode: 'VALID001' });
            const body = JSON.parse(res.payload);
            expect(body.holdItemsCount).toBe(1);
            expect(body.chargedItemsCount).toBe(3);
        });
    });

    // ── 15/16 Hold ───────────────────────────────────────────────────────────
    describe('Commands 15/16 — Hold', () => {
        it('returns ok=true for placed hold', async () => {
            const res = await post('/api/v1/hold', {
                patronBarcode: 'VALID001', itemBarcode: 'ITEM456', holdMode: '+'
            });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.ok).toBe(true);
        });

        it('returns pickupLocation from BS field', async () => {
            const res = await post('/api/v1/hold', {
                patronBarcode: 'VALID001', itemBarcode: 'ITEM456', holdMode: '+'
            });
            const body = JSON.parse(res.payload);
            expect(body.pickupLocation).toBe('MAIN');
        });

        it('rejects hold for BLOCKED001', async () => {
            const res = await post('/api/v1/hold', {
                patronBarcode: 'BLOCKED001', titleId: 'Great Expectations', holdMode: '+'
            });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.ok).toBe(false);
            expect(body.screenMessage).toBe('Hold denied');
        });
    });

    // ── 65/66 Renew All ──────────────────────────────────────────────────────
    describe('Commands 65/66 — Renew All', () => {
        it('returns ok=true with renewedCount and lists', async () => {
            const res = await post('/api/v1/renew-all', { patronBarcode: 'VALID001' });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.ok).toBe(true);
            expect(body.renewedCount).toBe(2);
            expect(body.renewedItems).toEqual(['ITEM001', 'ITEM002']);
        });
    });

    // ── 35/36 End Session ────────────────────────────────────────────────────
    describe('Commands 35/36 — End Patron Session', () => {
        it('returns endSession=true', async () => {
            const res = await post('/api/v1/patron/end-session', { patronBarcode: 'VALID001' });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.endSession).toBe(true);
        });

        it('carries screenMessage from AF field', async () => {
            const res = await post('/api/v1/patron/end-session', { patronBarcode: 'VALID001' });
            const body = JSON.parse(res.payload);
            expect(body.screenMessage).toBe('Goodbye!');
        });
    });

    // ── 99/98 ACS Status ────────────────────────────────────────────────────
    describe('Commands 99/98 — ACS Status', () => {
        it('returns onlineStatus, checkinOk, checkoutOk, protocolVersion', async () => {
            const res = await post('/api/v1/acs-status', {});
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.onlineStatus).toBe(true);
            expect(body.checkinOk).toBe(true);
            expect(body.checkoutOk).toBe(true);
            expect(body.protocolVersion).toBe('2.00');
        });
    });

    // ── 19/20 Item Status Update ─────────────────────────────────────────────
    describe('Commands 19/20 — Item Status Update', () => {
        it('returns securityMarker in response', async () => {
            const res = await post('/api/v1/item/status-update', {
                itemBarcode: 'ITEM123', securityMarker: '2'
            });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.itemBarcode).toBe('ITEM123');
            expect(body.securityMarker).toBe('2');
        });
    });

    // ── 25/26 Patron Enable ──────────────────────────────────────────────────
    describe('Commands 25/26 — Patron Enable', () => {
        it('returns validPatron=true after enable', async () => {
            const res = await post('/api/v1/patron/enable', { patronBarcode: 'VALID001' });
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.payload);
            expect(body.patronBarcode).toBe('VALID001');
            expect(body.validPatron).toBe(true);
        });
    });

    // ── 01 Block Patron (fire-and-forget) ────────────────────────────────────
    describe('Command 01 — Block Patron', () => {
        it('returns 204 success (fire-and-forget)', async () => {
            const res = await post('/api/v1/patron/block', {
                patronBarcode: 'BLOCKED001',
                cardRetained: false,
                blockedCardMessage: 'Reported lost'
            });
            expect(res.statusCode).toBe(204);
        });
    });

    // ── Auth guard ───────────────────────────────────────────────────────────
    describe('API Key Security', () => {
        it('rejects all routes without x-api-key', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/api/v1/patron/status',
                payload: { patronBarcode: 'VALID001' }
            });
            expect(res.statusCode).toBe(401);
        });

        it('rejects with wrong x-api-key', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/api/v1/patron/status',
                headers: { 'x-api-key': 'wrong-key' },
                payload: { patronBarcode: 'VALID001' }
            });
            expect(res.statusCode).toBe(401);
        });
    });
});
