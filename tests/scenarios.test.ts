import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { MockLmsEnhancedServer } from './mock-lms-enhanced.js';
import { ConfigService } from '../src/services/ConfigService.js';

describe('Patron Scenarios Integration', () => {
    let app: FastifyInstance;
    let mockLms: MockLmsEnhancedServer;
    const API_KEY = 'test-scenario-key';

    beforeAll(async () => {
        // Setup mock LMS on port 6010 for scenarios
        mockLms = new MockLmsEnhancedServer(6010, '127.0.0.1');
        await mockLms.start();

        // Setup app config
        process.env.LMS_HOST = '127.0.0.1';
        process.env.LMS_PORT = '6010';
        process.env.BRIDGE_API_KEY = API_KEY;
        process.env.NODE_ENV = 'test';

        ConfigService._resetInstance();
        app = await createServer();
        await app.ready();
    });

    afterAll(async () => {
        if (app) await app.close();
        await mockLms.stop();
    });

    const scenarios: [string, object][] = [
        ['VALID001', { patronName: 'Alice Valid', validPatron: true, chargedItemsCount: 3, holdItemsCount: 1 }],
        ['FINES001', { patronName: 'Bob Fineman', flags: { excessiveFines: true, chargePrivilegesDenied: true } }],
        ['LOST001', { patronName: 'Carol Lostcard', flags: { cardReportedLost: true } }],
        ['BLOCKED001', { flags: { chargePrivilegesDenied: true, holdPrivilegesDenied: true } }],
        ['UNKNOWN999', { validPatron: false }]
    ];

    it.each(scenarios)('patron %s returns correct status', async (barcode: string, expected: object) => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/patron/status',
            headers: { 'x-api-key': API_KEY },
            payload: { patronBarcode: barcode }
        });

        expect(response.statusCode).toBe(200);
        const payload = JSON.parse(response.payload);
        expect(payload).toMatchObject(expected);
    });

    it('checkout approved for VALID001', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/checkout',
            headers: { 'x-api-key': API_KEY },
            payload: { patronBarcode: 'VALID001', itemBarcode: 'ITEM123' }
        });

        expect(response.statusCode).toBe(200);
        const payload = JSON.parse(response.payload);
        expect(payload.ok).toBe(true);
        expect(payload.itemBarcode).toBe('ITEM123');
    });

    it('checkin approved for ITEM123', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/checkin',
            headers: { 'x-api-key': API_KEY },
            payload: { itemBarcode: 'ITEM123' }
        });

        expect(response.statusCode).toBe(200);
        const payload = JSON.parse(response.payload);
        expect(payload.ok).toBe(true);
        expect(payload.itemBarcode).toBe('ITEM123');
    });
});
