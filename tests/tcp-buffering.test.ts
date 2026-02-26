import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import net from 'node:net';
import { SipClient } from '../src/services/sip-client.js';

describe('TCP Message Fragmentation & Buffering', () => {
    let server: net.Server;
    let client: SipClient;
    const PORT = 6025;
    let sockets: net.Socket[] = [];

    beforeEach(async () => {
        server = net.createServer((socket) => {
            sockets.push(socket);
        });
        await new Promise<void>(resolve => server.listen(PORT, '127.0.0.1', resolve));
        client = new SipClient('127.0.0.1', PORT, 2000, 'Test', false);
    });

    afterEach(async () => {
        client.disconnect();
        for (const socket of sockets) {
            socket.destroy();
        }
        sockets = [];
        await new Promise(resolve => server.close(resolve));
    });

    it('should correctly buffer and reassemble a fragmented SIP2 message', async () => {
        // We will send the response in 3 chunks
        const fullMessage = '24              00120260223    120000AOMainLib|AAP0001|AEJane|BLY|AY0AZF234\r';
        const chunk1 = fullMessage.substring(0, 10);
        const chunk2 = fullMessage.substring(10, 40);
        const chunk3 = fullMessage.substring(40);

        server.on('connection', (socket) => {
            socket.on('data', () => {
                // When request comes in, reply with fragmented chunks
                setTimeout(() => socket.write(chunk1, 'latin1'), 10);
                setTimeout(() => socket.write(chunk2, 'latin1'), 30);
                setTimeout(() => socket.write(chunk3, 'latin1'), 50);
            });
        });

        // The parser parses it if it successfully reconstructs the buffer
        // Let's pass checksumRequired=false through SipClient for this test as F234 is dummy
        client = new SipClient('127.0.0.1', PORT, 2000, 'Test', false, undefined, true, false);

        const response = await client.patronStatus('P0001');
        expect(response.patronBarcode).toBe('P0001');
        expect(response.patronName).toBe('Jane');
        expect(response.validPatron).toBe(true);
    });

    it('should handle multiple complete messages in a single TCP read', async () => {
        const message1 = '24              00120260223    120000AOMainLib|AAP0001|AEJane|BLY|AY0AZ1234\r';
        const message2 = '24              00120260223    120000AOMainLib|AAP0002|AEJohn|BLY|AY1AZ5678\r';

        server.on('connection', (socket) => {
            socket.on('data', () => {
                // Reply with both messages concatenated in one burst
                socket.write(message1 + message2, 'latin1');
            });
        });

        client = new SipClient('127.0.0.1', PORT, 2000, 'Test', false, undefined, true, false);

        // Send two requests almost simultaneously
        const p1 = client.patronStatus('P0001'); // gets sequence 0
        const p2 = client.patronStatus('P0002'); // gets sequence 1

        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1.patronBarcode).toBe('P0001');
        expect(r1.patronName).toBe('Jane');
        expect(r2.patronBarcode).toBe('P0002');
        expect(r2.patronName).toBe('John');
    });

    it('should correctly handle a chunk containing the end of one message and start of next', async () => {
        const message1 = '24              00120260223    120000AOMainLib|AAP0001|AEJane|BLY|AY0AZ1234\r';
        const message2 = '24              00120260223    120000AOMainLib|AAP0002|AEJohn|BLY|AY1AZ5678\r';

        const combined = message1 + message2;
        // Split right at the boundary
        const chunk1 = combined.substring(0, message1.length + 5); // contains all msg1 + "24   "
        const chunk2 = combined.substring(message1.length + 5);

        server.on('connection', (socket) => {
            socket.on('data', () => {
                setTimeout(() => socket.write(chunk1, 'latin1'), 10);
                setTimeout(() => socket.write(chunk2, 'latin1'), 30);
            });
        });

        client = new SipClient('127.0.0.1', PORT, 2000, 'Test', false, undefined, true, false);

        const p1 = client.patronStatus('P0001');
        const p2 = client.patronStatus('P0002');

        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1.patronBarcode).toBe('P0001');
        expect(r2.patronBarcode).toBe('P0002');
    });
});
