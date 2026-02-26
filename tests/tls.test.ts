import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { SipClient } from '../src/services/sip-client.js';

describe('SIPClient TLS Connection', () => {
    let server: tls.Server;
    let client: SipClient;
    const PORT = 6040;
    const certPath = path.resolve('tests/fixtures/cert.pem');
    const keyPath = path.resolve('tests/fixtures/key.pem');

    beforeEach(async () => {
        const options = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
        };

        server = tls.createServer(options, (socket) => {
            socket.on('data', () => {
                socket.write('941\r', 'latin1'); // Dummy login success
            });
        });

        await new Promise<void>(resolve => server.listen(PORT, '127.0.0.1', resolve));
    });

    afterEach(async () => {
        if (client) client.disconnect();
        await new Promise(resolve => server.close(resolve));
    });

    it('should connect successfully over TLS and perform a raw command', async () => {
        // useTls=true, rejectUnauthorized=false because it's self-signed
        // Set checksumRequired to false so it doesn't reject our simple mock responses
        client = new SipClient('127.0.0.1', PORT, 2000, 'Test', true, undefined, false, false);

        await client.connect();
        // Since we are connected, sendRaw should work
        const response = await client.sendRaw('9300CNadmin|COpassword|', 0);
        expect(response).toBe('941\r');
    });

    it('should reject connection if certificate is invalid/untrusted and rejectUnauthorized=true', async () => {
        // Default rejectUnauthorized is true
        client = new SipClient('127.0.0.1', PORT, 2000, 'Test', true, undefined, true, false);

        await expect(client.connect()).rejects.toThrow();
    });
});
