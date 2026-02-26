import net from 'node:net';
import { calculateChecksum } from '../src/utils/checksum.js';

export class MockLmsServer {
    private server: net.Server;
    public port: number;

    constructor(port: number = 6001) {
        this.port = port;
        this.server = net.createServer((socket) => {
            socket.on('data', (data) => {
                const request = data.toString('latin1');
                const command = request.substring(0, 2);

                // Extract sequence number
                const seqMatch = request.match(/AY(\d)AZ/);
                const seqNum = seqMatch ? seqMatch[1] : '0';

                if (command === '93') {
                    // Login Request -> Login Response (94)
                    // 94{success}
                    const msg = `941AY${seqNum}AZ`; // 1 = Success
                    const checksum = calculateChecksum(msg);
                    socket.write(`${msg}${checksum}\r`);
                } else if (command === '23') {
                    // Patron Status Request -> Patron Status Response (24)
                    const status = 'Y Y           ';
                    const lang = '001';
                    const date = '20260221    120000';
                    const inst = 'GigaFlair';
                    const aaMatch = request.match(/AA([^|]+)\|/);
                    const barcode = aaMatch ? aaMatch[1] : 'UNKNOWN';

                    const msg = `24${status}${lang}${date}AO${inst}|AA${barcode}|AEAlice Patron|BZ0002|AU0000|CD0000|AS0000|BLY|AY${seqNum}AZ`;
                    const checksum = calculateChecksum(msg);
                    socket.write(`${msg}${checksum}\r`);
                }
            });
        });
    }

    public start(): Promise<void> {
        return new Promise((resolve) => {
            this.server.listen(this.port, '127.0.0.1', () => {
                console.log(`Test Mock LMS listening on ${this.port}`);
                resolve();
            });
        });
    }

    public stop(): Promise<void> {
        return new Promise((resolve) => {
            this.server.close(() => resolve());
        });
    }
}
