import net from 'node:net';
import { calculateChecksum } from './utils/checksum.js';

const PORT = 6001;

const server = net.createServer((socket) => {
    console.log('Mock LMS: Client connected');

    socket.on('data', (data) => {
        const request = data.toString();
        console.log(`Mock LMS: Received: ${request.trim()}`);

        // Parse command (first 2 chars)
        const command = request.substring(0, 2);

        if (command === '23') {
            // Patron Status Request
            // Extract barcode (AA field)
            const aaMatch = request.match(/AA([^|]+)\|/);
            const barcode = aaMatch ? aaMatch[1] : 'UNKNOWN';

            // Build Patron Status Response (Command 24)
            // 24{status}{lang}{date}AO{inst}|AA{barcode}|AE{name}|BZ{charged}|AU{fines}|...
            const status = 'Y Y           '; // Valid patron, etc.
            const lang = '001';
            const date = '20260221    120000';
            const inst = 'GigaFlair';
            const name = 'Alice Patron';

            // Extract sequence number from request to echo it back
            const seqMatch = request.match(/AY(\d)AZ/);
            const seqNum = seqMatch ? seqMatch[1] : '0';

            const msg = `24${status}${lang}${date}AO${inst}|AA${barcode}|AE${name}|BZ0002|AU0000|AY${seqNum}AZ`;
            const checksum = calculateChecksum(msg);
            const response = `${msg}${checksum}\r`;

            console.log(`Mock LMS: Sending: ${response.trim()}`);
            socket.write(response);
        } else if (command === '93') {
            // Login Request (94 Response)
            const seqMatch = request.match(/AY(\d)AZ/);
            const seqNum = seqMatch ? seqMatch[1] : '0';
            const msg = `941AY${seqNum}AZ`; // 1 = valid
            const checksum = calculateChecksum(msg);
            socket.write(`${msg}${checksum}\r`);
        } else {
            console.log(`Mock LMS: Unknown command ${command}`);
        }
    });

    socket.on('end', () => {
        console.log('Mock LMS: Client disconnected');
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`Mock LMS listening on 127.0.0.1:${PORT}`);
});
