/**
 * SipClient Unit Tests
 *
 * Tests for processBuffer (TCP framing), handleMessage (checksum rejection),
 * connection timeout, sequence number management, and request timeout behavior.
 */

import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import { SipClient } from '../src/services/sip-client.js';
import { appendChecksum, calculateChecksum } from '../src/utils/checksum.js';

// Helper: create a TCP server on a random port
function createMockServer(handler: (socket: net.Socket) => void): Promise<{ server: net.Server; port: number }> {
    return new Promise((resolve) => {
        const server = net.createServer(handler);
        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as net.AddressInfo).port;
            resolve({ server, port });
        });
    });
}

function closeMockServer(server: net.Server): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

describe('SipClient — processBuffer (TCP Framing)', () => {
    let server: net.Server;
    let client: SipClient;

    afterEach(async () => {
        client?.disconnect();
        if (server) await closeMockServer(server);
    });

    it('assembles a complete message from 3 TCP fragments', async () => {
        const fullResponse = appendChecksum(
            '24              00120260223    120000AOLib|AAP_FRAG|AEFragmented Patron|BZ0001|AU0000|CD0000|AS0000|BLY|',
            0
        );

        ({ server } = await createMockServer((socket) => {
            socket.on('data', () => {
                // Send in 3 pieces
                const c1 = fullResponse.substring(0, 15);
                const c2 = fullResponse.substring(15, 50);
                const c3 = fullResponse.substring(50);
                socket.write(c1, 'latin1');
                setTimeout(() => socket.write(c2, 'latin1'), 10);
                setTimeout(() => socket.write(c3, 'latin1'), 20);
            });
        }));
        const port = (server.address() as net.AddressInfo).port;

        client = new SipClient('127.0.0.1', port, 3000, 'Lib', false, undefined, true, true);
        const result = await client.patronStatus('P_FRAG');

        expect(result.patronBarcode).toBe('P_FRAG');
        expect(result.patronName).toBe('Fragmented Patron');
        expect(result.validPatron).toBe(true);
    });

    it('handles two complete messages arriving in a single TCP chunk', async () => {
        // Craft two valid responses for seq 0 and seq 1
        const resp0 = appendChecksum(
            '24              00120260223    120000AOLib|AAP_MULTI0|AEFirst|BZ0000|AU0000|CD0000|AS0000|BLY|',
            0
        );
        const resp1 = appendChecksum(
            '24              00120260223    120000AOLib|AAP_MULTI1|AESecond|BZ0000|AU0000|CD0000|AS0000|BLY|',
            1
        );

        ({ server } = await createMockServer((socket) => {
            let firstRequest = true;
            socket.on('data', () => {
                if (firstRequest) {
                    firstRequest = false;
                    // Wait for both requests to arrive, then send both responses at once
                    setTimeout(() => {
                        socket.write(resp0 + resp1, 'latin1');
                    }, 30);
                }
            });
        }));
        const port = (server.address() as net.AddressInfo).port;

        client = new SipClient('127.0.0.1', port, 3000, 'Lib', false, undefined, true, true);

        // Send two requests concurrently
        const [r0, r1] = await Promise.all([
            client.patronStatus('P_MULTI0'),
            client.patronStatus('P_MULTI1'),
        ]);

        expect(r0.patronBarcode).toBe('P_MULTI0');
        expect(r1.patronBarcode).toBe('P_MULTI1');
    });
});

describe('SipClient — handleMessage (Checksum Validation)', () => {
    let server: net.Server;
    let client: SipClient;

    afterEach(async () => {
        client?.disconnect();
        if (server) await closeMockServer(server);
    });

    it('rejects response with bad checksum when checksumRequired=true', async () => {
        const badResponse = '24              00120260223    120000AOLib|AAP001|AEBad CS|BZ0000|AU0000|CD0000|AS0000|BLY|AY0AZ0000\r';

        ({ server } = await createMockServer((socket) => {
            socket.on('data', () => {
                socket.write(badResponse, 'latin1');
            });
        }));
        const port = (server.address() as net.AddressInfo).port;

        client = new SipClient('127.0.0.1', port, 2000, 'Lib', false, undefined, true, true);
        await expect(client.patronStatus('P001')).rejects.toThrow('SIP2 Checksum Mismatch');
    });

    it('accepts response with bad checksum when checksumRequired=false', async () => {
        const badResponse = '24              00120260223    120000AOLib|AAP001|AELenient|BZ0000|AU0000|CD0000|AS0000|BLY|AY0AZ0000\r';

        ({ server } = await createMockServer((socket) => {
            socket.on('data', () => {
                socket.write(badResponse, 'latin1');
            });
        }));
        const port = (server.address() as net.AddressInfo).port;

        client = new SipClient('127.0.0.1', port, 2000, 'Lib', false, undefined, true, false);
        const result = await client.patronStatus('P001');
        expect(result.patronBarcode).toBe('P001');
        expect(result.patronName).toBe('Lenient');
    });
});

describe('SipClient — Request Timeout', () => {
    it('rejects with timeout error when LMS never responds', async () => {
        const { server, port } = await createMockServer((socket) => {
            // Accept connection but never respond — force timeout
            socket.on('error', () => {}); // swallow reset errors
        });

        const client = new SipClient('127.0.0.1', port, 200, 'Lib', false, undefined, true, true);

        const start = Date.now();
        await expect(client.patronStatus('P_TIMEOUT')).rejects.toThrow('SIP Request Timeout');
        const elapsed = Date.now() - start;

        // Verify timeout was roughly the configured 200ms
        expect(elapsed).toBeGreaterThanOrEqual(150);
        expect(elapsed).toBeLessThan(2000);

        client.disconnect();
        // Force-close all server connections so it shuts down immediately
        server.close();
        await new Promise(resolve => setTimeout(resolve, 50));
    });
});

describe('SipClient — Connection Timeout', () => {
    it('rejects when connecting to a non-listening port', async () => {
        const client = new SipClient('127.0.0.1', 19999, 300, 'Lib');

        await expect(client.connect()).rejects.toThrow();
        client.disconnect();
    });
});

describe('SipClient — Sequence Number Management', () => {
    it('wraps sequence numbers from 9 back to 0', () => {
        const client = new SipClient('localhost', 1, 1000);
        const pending = (client as any).pending;

        // Occupy slots 0-8
        for (let i = 0; i < 9; i++) {
            pending.set(i, { timer: null });
        }
        (client as any).nextSeqNum = 9;

        const seq = (client as any).getAvailableSeqNum();
        expect(seq).toBe(9);

        // nextSeqNum should have wrapped
        expect((client as any).nextSeqNum).toBe(0);
    });

    it('throws when all 10 slots are occupied', () => {
        const client = new SipClient('localhost', 1, 1000);
        const pending = (client as any).pending;

        for (let i = 0; i < 10; i++) {
            pending.set(i, { timer: null });
        }

        expect(() => (client as any).getAvailableSeqNum()).toThrow('all 10 sequence numbers in use');
    });

    it('reuses freed sequence numbers', () => {
        const client = new SipClient('localhost', 1, 1000);
        const pending = (client as any).pending;

        // Fill all 10
        for (let i = 0; i < 10; i++) {
            pending.set(i, { timer: null });
        }

        // Free slot 5
        pending.delete(5);
        const seq = (client as any).getAvailableSeqNum();
        expect(seq).toBe(5);
    });
});

describe('SipClient — cleanupPending', () => {
    let server: net.Server;
    let client: SipClient;

    afterEach(async () => {
        client?.disconnect();
        if (server) await closeMockServer(server);
    });

    it('rejects all pending requests when connection closes', async () => {
        ({ server } = await createMockServer((socket) => {
            // Accept connection, then close it immediately after first data
            socket.on('data', () => {
                socket.destroy();
            });
        }));
        const port = (server.address() as net.AddressInfo).port;

        client = new SipClient('127.0.0.1', port, 5000, 'Lib', false, undefined, true, true);

        await expect(client.patronStatus('P_CLOSE')).rejects.toThrow();
    });
});

describe('SipClient — sendRaw duplicate sequence number', () => {
    let server: net.Server;
    let client: SipClient;

    afterEach(async () => {
        client?.disconnect();
        if (server) await closeMockServer(server);
    });

    it('rejects if sequence number is already in use', async () => {
        ({ server } = await createMockServer(() => { /* no-op */ }));
        const port = (server.address() as net.AddressInfo).port;

        client = new SipClient('127.0.0.1', port, 5000, 'Lib', false, undefined, true, true);
        await client.connect();

        // Manually inject a pending entry for seq 0
        (client as any).pending.set(0, { timer: setTimeout(() => {}, 9999), resolve: () => {}, reject: () => {} });

        await expect(client.sendRaw('testAY0AZ1234\r', 0)).rejects.toThrow('already in use');

        // Clean up the timer
        clearTimeout((client as any).pending.get(0)?.timer);
    });
});
