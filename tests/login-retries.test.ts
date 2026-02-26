import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { SipConnectionManager } from '../src/services/SipConnectionManager.js';
import { LMSConfig } from '../src/types/index.js';

describe('SipConnectionManager Login Retries', () => {
    it('should retry login and eventually succeed if the first attempts fail', async () => {
        let loginAttempts = 0;
        const PORT = 6030;
        const server = net.createServer((socket) => {
            socket.on('data', (data) => {
                const req = data.toString('latin1');
                if (req.startsWith('93')) {
                    loginAttempts++;
                    if (loginAttempts < 3) {
                        // Return 940 (Login rejected)
                        socket.write('940\r', 'latin1');
                    } else {
                        // Return 941 (Login successful)
                        socket.write('941\r', 'latin1');
                    }
                } else if (req.startsWith('23')) {
                    // Patron Status Request
                    socket.write('24              00120260223    120000AOTest|AAVALID_PATRON|AEAlice|BLY|AY0AZ1234\r', 'latin1');
                }
            });
        });

        await new Promise<void>(resolve => server.listen(PORT, '127.0.0.1', resolve));

        const config: LMSConfig = {
            branchId: 'TEST_BRANCH',
            host: '127.0.0.1',
            port: PORT,
            sipUser: 'admin',
            sipPassword: 'password123',
            timeoutMs: 2000,
            useTls: false,
            vendorProfile: { checksumRequired: false } // Bypass checksums for simplicity in this test
        };

        const scm = new SipConnectionManager([config]);

        // This will call getClient -> performLogin
        // performLogin has retries=2 (total 3 attempts)
        const result = await scm.patronStatus('TEST_BRANCH', 'VALID_PATRON');

        expect(loginAttempts).toBe(3);
        expect(result.patronBarcode).toBe('VALID_PATRON');
        expect(result.validPatron).toBe(true);

        scm.shutdown();
        await new Promise(resolve => server.close(resolve));
    }, 10000);

    it('should throw if all login attempts fail', async () => {
        let loginAttempts = 0;
        const PORT = 6031;
        const server = net.createServer((socket) => {
            socket.on('data', (data) => {
                const req = data.toString('latin1');
                // Extract sequence number from the request (last 4 digits before CR)
                const sequence = req.slice(-5, -1); // e.g., "0001"
                if (req.startsWith('93')) {
                    loginAttempts++;
                    // Return 940 (Login rejected)
                    // Format: 940<sequence><checksum>\r
                    const response = `940${sequence}F000\r`; // F000 is a dummy checksum
                    socket.write(response, 'latin1');
                }
            });
        });

        await new Promise<void>(resolve => server.listen(PORT, '127.0.0.1', resolve));

        const config: LMSConfig = {
            branchId: 'FAIL_BRANCH',
            host: '127.0.0.1',
            port: PORT,
            sipUser: 'admin',
            sipPassword: 'wrong_password',
            timeoutMs: 1000,
            useTls: false,
            vendorProfile: { checksumRequired: false }
        };

        const scm = new SipConnectionManager([config]);

        await expect(scm.patronStatus('FAIL_BRANCH', 'ANY')).rejects.toThrow('SIP2 Login rejected');
        expect(loginAttempts).toBe(3); // 1 initial + 2 retries

        scm.shutdown();
        await new Promise(resolve => server.close(resolve));
    }, 10000);
});
