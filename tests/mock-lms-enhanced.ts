/**
 * Enhanced Mock LMS — Multi-Patron Scenario Server
 */

import net from 'node:net';
import { calculateChecksum } from '../src/utils/checksum.js';

type PatronProfile = {
    name: string;
    statusMask: string;
    validPatron: 'Y' | 'N';
    holdItems: string;
    overdueItems: string;
    chargedItems: string;
    recallItems: string;
    unavailHolds: string;
};

const PATRON_DB: Record<string, PatronProfile> = {
    VALID001: {
        name: 'Alice Valid',
        statusMask: '              ',
        validPatron: 'Y',
        holdItems: '0001',
        overdueItems: '0000',
        chargedItems: '0003',
        recallItems: '0000',
        unavailHolds: '0001',
    },
    FINES001: {
        name: 'Bob Fineman',
        statusMask: 'Y         Y   ',
        validPatron: 'Y',
        holdItems: '0000',
        overdueItems: '0002',
        chargedItems: '0007',
        recallItems: '0000',
        unavailHolds: '0000',
    },
    LOST001: {
        name: 'Carol Lostcard',
        statusMask: 'YYYYY         ',
        validPatron: 'Y',
        holdItems: '0000',
        overdueItems: '0001',
        chargedItems: '0000',
        recallItems: '0000',
        unavailHolds: '0000',
    },
    OVERDUE001: {
        name: 'Dave Overdue',
        statusMask: '      Y       ',
        validPatron: 'Y',
        holdItems: '0002',
        overdueItems: '0005',
        chargedItems: '0005',
        recallItems: '0002',
        unavailHolds: '0002',
    },
    BLOCKED001: {
        name: 'Eve Blocked',
        statusMask: 'Y  Y          ',
        validPatron: 'Y',
        holdItems: '0000',
        overdueItems: '0000',
        chargedItems: '0000',
        recallItems: '0000',
        unavailHolds: '0000',
    },
};

export class MockLmsEnhancedServer {
    private server: net.Server;
    private port: number;
    private bind: string;

    constructor(port: number = 6001, bind: string = '127.0.0.1') {
        this.port = port;
        this.bind = bind;
        this.server = net.createServer((socket) => this.handleConnection(socket));
    }

    private handleConnection(socket: net.Socket) {
        const remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`;
        let buffer = '';

        socket.on('data', (data) => {
            buffer += data.toString('latin1');
            let idx: number;
            while ((idx = buffer.indexOf('\r')) !== -1) {
                const request = buffer.substring(0, idx + 1);
                buffer = buffer.substring(idx + 1);
                this.handleRequest(socket, request.trim(), remoteAddr);
            }
        });

        socket.on('error', (err) => {
            console.error(`[!] Socket error (${remoteAddr}):`, err.message);
        });
    }

    private handleRequest(socket: net.Socket, request: string, from: string): void {
        const command = request.substring(0, 2);
        const seqMatch = request.match(/AY(\d)AZ/);
        const seqNum = seqMatch ? seqMatch[1] : '0';

        let response: string = '';

        const now = new Date();
        const pad = (n: number, w = 2) => String(n).padStart(w, '0');
        const date = `${pad(now.getUTCFullYear(), 4)}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}    ${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;

        switch (command) {
            case '93': {
                response = this.appendChecksumInline(`941AY${seqNum}AZ`);
                break;
            }
            case '23': {
                const aaMatch = request.match(/AA([^|]+)\|/);
                const barcode = aaMatch ? aaMatch[1] : 'UNKNOWN';
                const reqDate = request.substring(5, 23) || '20260221    120000';
                response = this.buildPatronStatusResponse(barcode, seqNum, reqDate);
                break;
            }
            case '11': {
                const baMatch = request.match(/AB([^|]+)\|/);
                const itemBarcode = baMatch ? baMatch[1] : 'ITEM000';
                const aaMatch = request.match(/AA([^|]+)\|/);
                const patronBarcode = aaMatch ? aaMatch[1] : 'UNKNOWN';

                if (patronBarcode === 'BLOCKED001') {
                    response = this.appendChecksumInline(
                        `120N  ${date}AOMockLib|AB${itemBarcode}|AJTest Book|AFPatron blocked|AY${seqNum}AZ`
                    );
                } else {
                    response = this.appendChecksumInline(
                        `121Y  ${date}AOMockLib|AB${itemBarcode}|AJTest Book|AH20260401    000000|AY${seqNum}AZ`
                    );
                }
                break;
            }
            case '09': {
                const biMatch = request.match(/AB([^|]+)\|/);
                const itemBc = biMatch ? biMatch[1] : 'ITEM000';
                // Checkin (10): ok(1) resensitize(1) magnetic(1) alert(1) date(18)
                response = this.appendChecksumInline(
                    `101YNN${date}AOMockLib|AB${itemBc}|AJTest Book|AY${seqNum}AZ`
                );
                break;
            }
            case '17': {
                // Item Information (18): circulationStatus(2) securityMarker(2) feeType(2) date(18)
                const abMatch = request.match(/AB([^|]+)\|/);
                const itemBc = abMatch ? abMatch[1] : 'ITEM000';
                response = this.appendChecksumInline(
                    `18010100${date}AOMockLib|AB${itemBc}|AJTest Item Title|CK808.8 TST|AY${seqNum}AZ`
                );
                break;
            }
            case '29': {
                // Renew (30) — same layout as checkout (12)
                const aaMatch = request.match(/AA([^|]+)\|/);
                const abMatch = request.match(/AB([^|]+)\|/);
                const patron = aaMatch ? aaMatch[1] : 'UNKNOWN';
                const item = abMatch ? abMatch[1] : 'ITEM000';
                if (patron === 'BLOCKED001') {
                    response = this.appendChecksumInline(
                        `300N  ${date}AOMockLib|AA${patron}|AB${item}|AJTest Book|AFPatron blocked|AY${seqNum}AZ`
                    );
                } else {
                    response = this.appendChecksumInline(
                        `301Y  ${date}AOMockLib|AA${patron}|AB${item}|AJTest Book|AH20260501    000000|AY${seqNum}AZ`
                    );
                }
                break;
            }
            case '37': {
                // Fee Paid (38): ok(1) date(18)
                const aaMatch = request.match(/AA([^|]+)\|/);
                const patron = aaMatch ? aaMatch[1] : 'UNKNOWN';
                if (patron === 'BLOCKED001') {
                    response = this.appendChecksumInline(
                        `380${date}AOMockLib|AA${patron}|BKfee-ack-001|AFPayment denied|AY${seqNum}AZ`
                    );
                } else {
                    response = this.appendChecksumInline(
                        `381${date}AOMockLib|AA${patron}|BKfee-ack-001|AY${seqNum}AZ`
                    );
                }
                break;
            }
            case '63': {
                // Patron Information (64): statusMask(14) language(3) date(18) holdCount(4) overdueCount(4)
                //   chargedCount(4) fineCount(4) recallCount(4) unavailHoldsCount(4) + variable fields
                const aaMatch = request.match(/AA([^|]+)\|/);
                const barcode = aaMatch ? aaMatch[1] : 'UNKNOWN';
                const profile = PATRON_DB[barcode];
                const statusMask = profile ? profile.statusMask : '              ';
                const name = profile ? profile.name : 'Unknown Patron';
                const charged = profile ? profile.chargedItems : '0000';
                const overdue = profile ? profile.overdueItems : '0000';
                const holds = profile ? profile.holdItems : '0000';
                const recall = profile ? profile.recallItems : '0000';
                const unavail = profile ? profile.unavailHolds : '0000';
                const fines = '0000'; // Standard 64 has a fines field but we don't map it here yet
                response = this.appendChecksumInline(
                    `64${statusMask}001${date}${holds}${overdue}${charged}${fines}${recall}${unavail}` +
                    `AOMockLib|AA${barcode}|AE${name}|BLY|` +
                    `AT${barcode}-HOLD1|AVITEM001|AY${seqNum}AZ`
                );
                break;
            }
            case '15': {
                // Hold (16): ok(1) available(1) date(18)
                const aaMatch = request.match(/AA([^|]+)\|/);
                const abMatch = request.match(/AB([^|]+)\|/);
                const patron = aaMatch ? aaMatch[1] : 'UNKNOWN';
                const item = abMatch ? abMatch[1] : '';
                const itemPart = item ? `AB${item}|` : '';
                if (patron === 'BLOCKED001') {
                    response = this.appendChecksumInline(
                        `160N${date}AOMockLib|AA${patron}|${itemPart}AJTest Hold Title|AFHold denied|AY${seqNum}AZ`
                    );
                } else {
                    response = this.appendChecksumInline(
                        `161Y${date}AOMockLib|AA${patron}|${itemPart}AJTest Hold Title|BW20261231|BSMAIN|AY${seqNum}AZ`
                    );
                }
                break;
            }
            case '65': {
                // Renew All (66): ok(1) renewedCount(4) unrenewedCount(4) date(18)
                const aaMatch = request.match(/AA([^|]+)\|/);
                const patron = aaMatch ? aaMatch[1] : 'UNKNOWN';
                response = this.appendChecksumInline(
                    `6610002000${date}AOMockLib|AA${patron}|BMITEM001|BMITEM002|AY${seqNum}AZ`
                );
                break;
            }
            case '35': {
                // End Session (36): endSession(1) date(18)
                const aaMatch = request.match(/AA([^|]+)\|/);
                const patron = aaMatch ? aaMatch[1] : 'UNKNOWN';
                response = this.appendChecksumInline(
                    `36Y${date}AOMockLib|AA${patron}|AFGoodbye!|AY${seqNum}AZ`
                );
                break;
            }
            case '99': {
                // ACS Status (98): online(1) checkin(1) checkout(1) renewal(1) statusUpdate(1) offline(1)
                //   timeout(3) retries(3) date(18) protocol(4)
                response = this.appendChecksumInline(
                    `98YYYYYY030003${date}2.00AOMockLib|AMMock Library|BX  YYYYYYYY  YY  |ANTerminal1|AY${seqNum}AZ`
                );
                break;
            }
            case '19': {
                // Item Status Update (20): securityMarker(1) date(18)
                const abMatch = request.match(/AB([^|]+)\|/);
                const item = abMatch ? abMatch[1] : 'ITEM000';
                const marker = request[2] || '2';
                response = this.appendChecksumInline(
                    `20${marker}${date}AOMockLib|AB${item}|AJTest Item|AY${seqNum}AZ`
                );
                break;
            }
            case '25': {
                // Patron Enable (26) — same format as Patron Status (24) but command '26'
                const aaMatch = request.match(/AA([^|]+)\|/);
                const barcode = aaMatch ? aaMatch[1] : 'UNKNOWN';
                const profile = PATRON_DB[barcode];
                const statusMask = profile ? profile.statusMask : '              ';
                const name = profile ? profile.name : 'Unknown Patron';
                response = this.appendChecksumInline(
                    `26${statusMask}001${date}AOMockLib|AA${barcode}|AE${name}|BZ0000|AU0000|CD0000|AS0000|BLY|AY${seqNum}AZ`
                );
                break;
            }
            case '01': {
                // Block Patron — no SIP2 response (fire-and-forget per SIP2 spec)
                break;
            }
        }

        if (response) {
            socket.write(response, 'latin1');
        }
    }

    private buildPatronStatusResponse(barcode: string, seqNum: string, date: string): string {
        const profile = PATRON_DB[barcode];
        const lang = '001';
        const inst = 'MockLib';

        if (!profile) {
            const statusMask = '              ';
            const msg = `24${statusMask}${lang}${date}AOTest|AA${barcode}|AEUnknown Patron|BZ0000|AU0000|CD0000|AS0000|BLNAY${seqNum}AZ`;
            return this.appendChecksumInline(msg);
        }

        const msg = `24${profile.statusMask}${lang}${date}` +
            `AO${inst}|AA${barcode}|AE${profile.name}|` +
            `BZ${profile.holdItems}|CA${profile.overdueItems}|` +
            `CB${profile.chargedItems}|CD${profile.recallItems}|` +
            `AS${profile.unavailHolds}|` +
            `BL${profile.validPatron}|AY${seqNum}AZ`;
        return this.appendChecksumInline(msg);
    }

    private appendChecksumInline(partial: string): string {
        const cs = calculateChecksum(partial);
        return `${partial}${cs}\r`;
    }

    public start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server.listen(this.port, this.bind, () => {
                console.log(`Enhanced Mock LMS listening on ${this.bind}:${this.port}`);
                resolve();
            });
            this.server.on('error', reject);
        });
    }

    public stop(): Promise<void> {
        return new Promise((resolve) => {
            this.server.close(() => resolve());
        });
    }
}

// Standalone execution
if (import.meta.url === `file://${process.argv[1]}`) {
    const port = parseInt(process.env.LMS_PORT || '6001', 10);
    const bind = process.env.LMS_BIND || '127.0.0.1';
    const mock = new MockLmsEnhancedServer(port, bind);
    mock.start().catch((err) => {
        console.error('Failed to start mock LMS:', err);
        process.exit(1);
    });
}
