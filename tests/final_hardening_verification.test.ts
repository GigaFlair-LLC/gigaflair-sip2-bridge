import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';
import { MockLmsServer } from './mock-lms.js';
import { calculateChecksum } from '../src/utils/checksum.js';
import net from 'node:net';

const TEST_API_KEY = 'test-api-key';

describe('SIP2-JSON Hardening Verification', () => {
    let app: FastifyInstance;
    let mockLms: MockLmsServer;
    const lmsPort = 6009;

    beforeAll(async () => {
        mockLms = new MockLmsServer(lmsPort);
        await mockLms.start();

        // Configure app with test environment
        process.env.BRIDGE_API_KEY = TEST_API_KEY;
        process.env.LMS_HOST = '127.0.0.1';
        process.env.LMS_PORT = lmsPort.toString();
        process.env.PORT = '3101';
        process.env.NODE_ENV = 'test';

        app = await createServer();
        await app.ready();
    });

    afterAll(async () => {
        await app.close();
        await mockLms.stop();
    });

    describe('Security & Routing', () => {
        it('should return 404 for an unknown branchId', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/api/v1/patron/status',
                headers: { 'x-api-key': TEST_API_KEY },
                payload: { branchId: 'nonexistent', patronBarcode: '12345' }
            });

            expect(response.statusCode).toBe(404);
            const body = JSON.parse(response.payload);
            expect(body.error).toBe('Not Found');
            expect(body.message).toContain('Unknown branch');
        });
    });

    describe('Concurrency & Sequence Numbers', () => {
        it('should detect and prevent sequence number collisions', async () => {
            const manager = (app as any).sipManager;
            const client = await manager.getClient('main');

            // Force a pending request in the map
            const fakePending = {
                resolve: () => { },
                reject: () => { },
                timer: setTimeout(() => { }, 1000)
            };
            (client as any).pending.set(1, fakePending);

            try {
                // Attempt to send a request with the same seqNum (1)
                await expect(client.sendRaw('23...AY1AZ', 1)).rejects.toThrow('Sequence number 1 already in use');
            } finally {
                clearTimeout(fakePending.timer);
                (client as any).pending.delete(1);
            }
        });

        it('should reject requests when at 10-request capacity', async () => {
            const manager = (app as any).sipManager;
            const client = await manager.getClient('main');

            // Saturate all 10 slots
            const timers: NodeJS.Timeout[] = [];
            for (let i = 0; i < 10; i++) {
                const fake = { resolve: () => { }, reject: () => { }, timer: setTimeout(() => { }, 1000) };
                (client as any).pending.set(i, fake);
                timers.push(fake.timer);
            }

            try {
                await expect(client.patronStatus('12345')).rejects.toThrow('SIP2 client at capacity');
            } finally {
                timers.forEach(t => clearTimeout(t));
                (client as any).pending.clear();
            }
        });
    });

    describe('Protocol Accuracy', () => {
        it('should generate UTC timestamps', async () => {
            const manager = (app as any).sipManager;
            const client = await manager.getClient('main');
            const writeSpy = vi.spyOn((client as any).socket, 'write');

            // We can't easily wait for the real write since we don't want to actually send/wait for response here
            // but we can look at the data being formatted.
            try {
                await client.patronStatus('12345');
            } catch (e) { /* ignore response errors */ }

            const lastCall = writeSpy.mock.calls[writeSpy.mock.calls.length - 1];
            const buffer = lastCall[0] as Buffer;
            const msg = buffer.toString('ascii');

            // Match timestamp YYYYMMDD    HHMMSS (index 5 to 23 approx)
            const tsMatch = msg.match(/\d{8}    (\d{6})/);
            expect(tsMatch).not.toBeNull();

            const now = new Date();
            const utcHours = String(now.getUTCHours()).padStart(2, '0');
            // The timestamp hours should match UTC hours
            expect(tsMatch![1].substring(0, 2)).toBe(utcHours);
        });

        it('should handle latin1 characters from LMS', async () => {
            const manager = (app as any).sipManager;
            const client = await manager.getClient('main');

            // "Æ" is \xC6 in latin1
            const rawResponse = `24Y Y           00120260221    120000AOInst|AA123|AEAlice Æ Patron|BZ0002|AU0000|CD0000|AS0000|BLY|AY0AZ`;
            const checksum = calculateChecksum(rawResponse);
            const fullMsg = `${rawResponse}${checksum}\r`;

            const sendRawSpy = vi.spyOn(client, 'sendRaw').mockResolvedValue(fullMsg);

            const response = await client.patronStatus('123');
            expect(response.patronName).toBe('Alice Æ Patron');
            sendRawSpy.mockRestore();
        });
    });
});
