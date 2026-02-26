import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from '../src/server.js';
import { FastifyInstance } from 'fastify';
import { MockLmsServer } from './mock-lms.js';

describe('GigaFlair SIP2 Bridge Robustness Test', () => {
    let mockLms: MockLmsServer;
    let app: FastifyInstance;
    const TEST_PORT_LMS = 6006;
    const TEST_API_KEY = 'robust-key';

    beforeAll(async () => {
        process.env.BRIDGE_API_KEY = TEST_API_KEY;
        process.env.LMS_HOST = '127.0.0.1';
        process.env.LMS_PORT = TEST_PORT_LMS.toString();

        mockLms = new MockLmsServer(TEST_PORT_LMS);
        await mockLms.start();
        app = await createServer();
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
        await mockLms.stop();
    });

    describe('Bad Data Rejection (Zod)', () => {
        it('should reject missing barcode with 400', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/patron/status',
                headers: { 'x-api-key': TEST_API_KEY },
                payload: { branchId: 'main' }
            });

            expect(response.statusCode).toBe(400);
            expect(response.payload).toContain('Validation failed');
        });

        it('should reject invalid barcode type with 400', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/patron/status',
                headers: { 'x-api-key': TEST_API_KEY },
                payload: { branchId: 'main', patronBarcode: 12345 }
            });

            expect(response.statusCode).toBe(400);
        });
    });

    describe('Zombie Socket Prevention', () => {
        it('should destroy the SIP socket on app.close()', async () => {
            await app.inject({
                method: 'POST',
                url: '/api/v1/patron/status',
                headers: { 'x-api-key': TEST_API_KEY },
                payload: { branchId: 'main', patronBarcode: '123' }
            });

            const manager = app.sipManager as any;
            const client = [...manager.clients.values()][0];
            const disconnectSpy = vi.spyOn(client, 'disconnect');

            await app.close();
            expect(disconnectSpy).toHaveBeenCalled();
        });
    });
});
