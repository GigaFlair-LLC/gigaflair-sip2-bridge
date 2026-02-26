import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/server.js';
import { FastifyInstance } from 'fastify';
import { MockLmsServer } from './mock-lms.js';

describe('sip2-json MVP Verification', () => {
    let mockLms: MockLmsServer;
    let app: FastifyInstance;
    const TEST_PORT_LMS = 6007;
    const TEST_API_KEY = 'test-mvp-key-123';

    beforeAll(async () => {
        // Set env vars for the bridge
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

    it('should return 401 if x-api-key is missing', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/patron/status',
            payload: { patronBarcode: '12345' }
        });

        expect(response.statusCode).toBe(401);
        expect(JSON.parse(response.payload).error).toBe('Unauthorized');
    });

    it('should return 401 if x-api-key is incorrect', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/patron/status',
            headers: { 'x-api-key': 'wrong-key' },
            payload: { patronBarcode: '12345' }
        });

        expect(response.statusCode).toBe(401);
    });

    it('should translate JSON to SIP2 and back with valid API key', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/patron/status',
            headers: { 'x-api-key': TEST_API_KEY },
            payload: {
                branchId: 'main',
                patronBarcode: '987654321'
            }
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body).toMatchObject({
            patronBarcode: '987654321',
            patronName: 'Alice Patron',
            validPatron: true
        });
    });
});
