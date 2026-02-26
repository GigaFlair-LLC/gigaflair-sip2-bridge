import unidecode from 'unidecode';
import net from 'node:net';
import tls from 'node:tls';
import {
    formatPatronStatusRequest,
    formatCheckoutRequest,
    formatCheckinRequest,
    formatItemInformationRequest,
    formatRenewRequest,
    formatFeePaidRequest,
    formatPatronInformationRequest,
    formatHoldRequest,
    formatRenewAllRequest,
    formatEndSessionRequest,
    formatSCStatusRequest,
    formatBlockPatronRequest,
    formatItemStatusUpdateRequest,
    formatPatronEnableRequest
} from '../utils/sip-formatter.js';
import {
    parsePatronStatusResponse,
    parseCheckoutResponse,
    parseCheckinResponse,
    parseItemInformationResponse,
    parseFeePaidResponse,
    parsePatronInformationResponse,
    parseHoldResponse,
    parseRenewAllResponse,
    parseEndSessionResponse,
    parseACSStatusResponse,
    parseItemStatusUpdateResponse,
    parsePatronEnableResponse
} from '../utils/sip-parser.js';
import {
    PatronStatusResponse,
    CheckoutResponse,
    CheckinResponse,
    ItemInformationResponse,
    FeePaidResponse,
    PatronInformationSummary,
    PatronInformationResponse,
    HoldResponse,
    RenewAllResponse,
    EndSessionResponse,
    ACSStatusResponse,
    ItemStatusUpdateResponse,
    PatronEnableResponse,
    Logger
} from '../types/index.js';
import { verifyChecksum } from '../utils/checksum.js';
import { logToDashboard } from '../utils/events.js';

interface PendingRequest {
    resolve: (data: string) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
}

export class SipClient {
    private socket: net.Socket | null = null;
    private host: string;
    private port: number;
    private timeoutMs: number;
    private institutionId: string;
    private useTls: boolean;
    private rejectUnauthorized: boolean;
    private checksumRequired: boolean;
    private connectPromise: Promise<void> | null = null;
    private pending: Map<number, PendingRequest> = new Map();
    private nextSeqNum: number = 0;
    private buffer: string = '';
    private logger: Logger;

    constructor(host: string, port: number, timeoutMs: number = 5000, institutionId: string = 'GigaFlair', useTls: boolean = false, logger?: Logger, rejectUnauthorized: boolean = true, checksumRequired: boolean = true) {
        this.host = host;
        this.port = port;
        this.timeoutMs = timeoutMs;
        this.institutionId = institutionId;
        this.useTls = useTls;
        this.rejectUnauthorized = rejectUnauthorized;
        this.checksumRequired = checksumRequired;
        this.logger = logger || console;
    }

    public connect(): Promise<void> {
        if (this.socket && !this.socket.destroyed) return Promise.resolve();
        if (this.connectPromise) return this.connectPromise;

        this.connectPromise = new Promise<void>((resolve, reject) => {
            let settled = false;

            const connectTimeout = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    this.socket?.destroy();
                    reject(new Error('Connection timeout'));
                }
            }, this.timeoutMs);

            if (this.useTls) {
                this.socket = tls.connect(this.port, this.host, { rejectUnauthorized: this.rejectUnauthorized }, () => {
                    settled = true;
                    clearTimeout(connectTimeout);
                    this.logger.info(`Connected (TLS) to LMS at ${this.host}:${this.port}`);
                    resolve();
                });
            } else {
                this.socket = new net.Socket();
                this.socket.connect(this.port, this.host, () => {
                    settled = true;
                    clearTimeout(connectTimeout);
                    this.logger.info(`Connected to LMS at ${this.host}:${this.port}`);
                    resolve();
                });
            }

            this.socket.on('data', (data) => {
                this.buffer += data.toString('latin1');
                this.processBuffer();
            });

            this.socket.on('error', (err) => {
                clearTimeout(connectTimeout);
                this.logger.error(`SIP Socket Error: ${err.message}`, { stack: err.stack });
                this.socket?.destroy();
                this.cleanupPending(err);
                if (!settled) reject(err);
            });

            this.socket.on('close', () => {
                this.logger.info('SIP Socket Closed');
                this.socket = null;
                this.cleanupPending(new Error('Connection closed'));
            });
        }).finally(() => {
            this.connectPromise = null;
        });

        return this.connectPromise;
    }

    private processBuffer() {
        let newlineIndex: number;
        while ((newlineIndex = this.buffer.indexOf('\r')) !== -1) {
            const message = this.buffer.substring(0, newlineIndex + 1);
            this.buffer = this.buffer.substring(newlineIndex + 1);

            // Handle if there's a following \n (standard CRLF)
            if (this.buffer.startsWith('\n')) {
                this.buffer = this.buffer.substring(1);
            }

            // Trim leading newlines/whitespace from the message before handling
            // This prevents \n from the previous message's CRLF from breaking checksums
            this.handleMessage(message.trimStart());
        }
    }

    private handleMessage(message: string) {
        if (!verifyChecksum(message)) {
            if (this.checksumRequired) {
                logToDashboard('error', 'Invalid checksum received from LMS', { message: message.trim() });
                this.logger.error(`Invalid checksum received from LMS: ${message.trim()}`);

                // SECURITY/ROBUSTNESS: Reject the corresponding pending request instead of let it hang until timeout
                const match = message.match(/AY(\d)AZ/);
                if (match) {
                    const seqNum = parseInt(match[1], 10);
                    const pending = this.pending.get(seqNum);
                    if (pending) {
                        clearTimeout(pending.timer);
                        this.pending.delete(seqNum);
                        pending.reject(new Error('SIP2 Checksum Mismatch'));
                    }
                }
                return;
            }
            // checksumRequired=false: warn but still process (accommodates some legacy ILS systems)
            logToDashboard('warn', 'SIP2 message has invalid checksum — processing anyway (checksumRequired=false)', { message: message.trim() });
            this.logger.warn(`SIP2 checksum missing/invalid — processing anyway (checksumRequired=false): ${message.trim()}`);
        }

        logToDashboard('info', 'SIP2 Response', { raw: message.trim() });

        const match = message.match(/AY(\d)AZ/);
        if (match) {
            const seqNum = parseInt(match[1], 10);
            const pending = this.pending.get(seqNum);
            if (pending) {
                clearTimeout(pending.timer);
                this.pending.delete(seqNum);
                pending.resolve(message);
            } else {
                // Sequence number present but no matching pending request — log for diagnostics
                this.logger.warn(`SIP2 response with sequence number ${seqNum} has no matching pending request — discarding. ` +
                    `Pending seqs: [${[...this.pending.keys()].join(', ')}]. Response prefix: ${message.substring(0, 20)}`);
                logToDashboard('warn', `SIP2 response discarded: seq ${seqNum} has no pending request`, { raw: message.trim() });
            }
        } else {
            // No sequence number found — only resolve if exactly one request is pending
            // to avoid delivering the wrong response to the wrong caller
            if (this.pending.size === 1) {
                const firstKey = this.pending.keys().next().value;
                if (firstKey !== undefined) {
                    const pending = this.pending.get(firstKey)!;
                    clearTimeout(pending.timer);
                    this.pending.delete(firstKey);
                    pending.resolve(message);
                }
            } else if (this.pending.size > 1) {
                this.logger.error('SIP2 response without sequence number while multiple requests pending — discarding to prevent data leak');
                logToDashboard('error', 'SIP2 response discarded: no sequence number with multiple pending requests', { raw: message.trim() });
            } else {
                // No pending requests at all — unsolicited message from LMS
                this.logger.warn(`Unsolicited SIP2 message received (no pending requests): ${message.substring(0, 40)}`);
                logToDashboard('warn', 'Unsolicited SIP2 message from LMS (no pending requests)', { raw: message.trim() });
            }
        }
    }

    private cleanupPending(err: Error) {
        if (this.pending.size === 0) return;
        for (const [, request] of this.pending) {
            clearTimeout(request.timer);
            request.reject(err);
        }
        this.pending.clear();
    }

    public async sendRaw(raw: string, seqNum: number): Promise<string> {
        await this.connect();

        return new Promise((resolve, reject) => {
            if (this.pending.has(seqNum)) {
                return reject(new Error(`Sequence number ${seqNum} already in use`));
            }
            const timer = setTimeout(() => {
                this.pending.delete(seqNum);
                if (this.socket) {
                    this.socket.destroy();
                    this.socket = null;
                }
                reject(new Error('SIP Request Timeout'));
            }, this.timeoutMs);

            if (!this.socket || this.socket.destroyed) {
                clearTimeout(timer);
                return reject(new Error('Socket not available'));
            }

            this.pending.set(seqNum, { resolve, reject, timer });

            // Normalize to ASCII to prevent UTF-8 overflows on legacy systems
            const normalized = unidecode(raw);
            logToDashboard('info', 'SIP2 Request', { raw: normalized.trim() });
            this.socket.write(Buffer.from(normalized, 'ascii'));
        });
    }

    public async patronStatus(barcode: string, language: string = '001'): Promise<PatronStatusResponse> {
        const seqNum = this.getAvailableSeqNum();
        const rawRequest = formatPatronStatusRequest(barcode, this.institutionId, seqNum, language);
        const rawResponse = await this.sendRaw(rawRequest, seqNum);
        return parsePatronStatusResponse(rawResponse);
    }

    public async checkout(patronBarcode: string, itemBarcode: string, patronPin?: string): Promise<CheckoutResponse> {
        const seqNum = this.getAvailableSeqNum();
        const rawRequest = formatCheckoutRequest(patronBarcode, itemBarcode, this.institutionId, seqNum, patronPin);
        const rawResponse = await this.sendRaw(rawRequest, seqNum);
        return parseCheckoutResponse(rawResponse);
    }

    public async checkin(itemBarcode: string): Promise<CheckinResponse> {
        const seqNum = this.getAvailableSeqNum();
        const rawRequest = formatCheckinRequest(itemBarcode, this.institutionId, seqNum);
        const rawResponse = await this.sendRaw(rawRequest, seqNum);
        return parseCheckinResponse(rawResponse);
    }

    public async itemInformation(itemBarcode: string): Promise<ItemInformationResponse> {
        const seqNum = this.getAvailableSeqNum();
        const rawRequest = formatItemInformationRequest(itemBarcode, this.institutionId, seqNum);
        const rawResponse = await this.sendRaw(rawRequest, seqNum);
        return parseItemInformationResponse(rawResponse);
    }

    public async renew(patronBarcode: string, itemBarcode: string, patronPin?: string): Promise<CheckoutResponse> {
        const seqNum = this.getAvailableSeqNum();
        const rawRequest = formatRenewRequest(patronBarcode, itemBarcode, this.institutionId, seqNum, patronPin);
        const rawResponse = await this.sendRaw(rawRequest, seqNum);
        return parseCheckoutResponse(rawResponse); // Renew 29 returns 30 (same as 12)
    }

    public async feePaid(
        patronBarcode: string,
        feeId: string,
        amount: string,
        feeType: string = '01',
        paymentType: string = '00',
        currencyType: string = 'USD'
    ): Promise<FeePaidResponse> {
        const seqNum = this.getAvailableSeqNum();
        const rawRequest = formatFeePaidRequest(patronBarcode, feeId, amount, this.institutionId, seqNum, feeType, paymentType, currencyType);
        const rawResponse = await this.sendRaw(rawRequest, seqNum);
        return parseFeePaidResponse(rawResponse);
    }

    public async patronInformation(
        patronBarcode: string,
        summary: PatronInformationSummary = {},
        startItem: number = 1,
        endItem: number = 5,
        language: string = '001'
    ): Promise<PatronInformationResponse> {
        const seqNum = this.getAvailableSeqNum();
        const rawRequest = formatPatronInformationRequest(patronBarcode, summary, startItem, endItem, this.institutionId, seqNum, language);
        const rawResponse = await this.sendRaw(rawRequest, seqNum);
        return parsePatronInformationResponse(rawResponse);
    }

    public async hold(
        patronBarcode: string,
        holdMode: '+' | '-' | '*',
        itemBarcode?: string,
        expiryDate?: string,
        pickupLocation?: string,
        titleId?: string
    ): Promise<HoldResponse> {
        const seqNum = this.getAvailableSeqNum();
        const rawRequest = formatHoldRequest(holdMode, patronBarcode, itemBarcode, expiryDate, pickupLocation, this.institutionId, seqNum, titleId);
        const rawResponse = await this.sendRaw(rawRequest, seqNum);
        return parseHoldResponse(rawResponse);
    }

    public async renewAll(patronBarcode: string): Promise<RenewAllResponse> {
        const seqNum = this.getAvailableSeqNum();
        const rawRequest = formatRenewAllRequest(patronBarcode, this.institutionId, seqNum);
        const rawResponse = await this.sendRaw(rawRequest, seqNum);
        return parseRenewAllResponse(rawResponse);
    }

    public async endSession(patronBarcode: string): Promise<EndSessionResponse> {
        const seqNum = this.getAvailableSeqNum();
        const rawRequest = formatEndSessionRequest(patronBarcode, this.institutionId, seqNum);
        const rawResponse = await this.sendRaw(rawRequest, seqNum);
        return parseEndSessionResponse(rawResponse);
    }

    public async scStatus(): Promise<ACSStatusResponse> {
        const seqNum = this.getAvailableSeqNum();
        const rawRequest = formatSCStatusRequest(seqNum);
        const rawResponse = await this.sendRaw(rawRequest, seqNum);
        if (!rawResponse.startsWith('98')) {
            throw new Error(`Unexpected response to SC Status (expected 98, got: ${rawResponse.substring(0, 5)})`);
        }
        return parseACSStatusResponse(rawResponse);
    }

    /**
     * Command 01: Block Patron (no SIP2 response)
     * Sends the block command and resolves immediately — the ILS acts asynchronously.
     */
    public async blockPatron(
        patronBarcode: string,
        cardRetained: boolean = false,
        blockedCardMessage: string = ''
    ): Promise<void> {
        const seqNum = this.getAvailableSeqNum();
        const rawRequest = formatBlockPatronRequest(patronBarcode, cardRetained, blockedCardMessage, this.institutionId, seqNum);
        // Command 01 has no response — write and forget
        await this.connect();
        if (!this.socket || this.socket.destroyed) throw new Error('Socket not available');
        const normalized = unidecode(rawRequest);
        logToDashboard('info', 'SIP2 Request (Block Patron — no response expected)', { raw: normalized.trim() });
        this.socket.write(Buffer.from(normalized, 'ascii'));
    }

    public async itemStatusUpdate(
        itemBarcode: string,
        securityMarker: '0' | '1' | '2' | '3' = '2'
    ): Promise<ItemStatusUpdateResponse> {
        const seqNum = this.getAvailableSeqNum();
        const rawRequest = formatItemStatusUpdateRequest(itemBarcode, securityMarker, this.institutionId, seqNum);
        const rawResponse = await this.sendRaw(rawRequest, seqNum);
        return parseItemStatusUpdateResponse(rawResponse);
    }

    public async patronEnable(
        patronBarcode: string,
        patronPin?: string
    ): Promise<PatronEnableResponse> {
        const seqNum = this.getAvailableSeqNum();
        const rawRequest = formatPatronEnableRequest(patronBarcode, patronPin, this.institutionId, seqNum);
        const rawResponse = await this.sendRaw(rawRequest, seqNum);
        return parsePatronEnableResponse(rawResponse);
    }

    private getAvailableSeqNum(): number {
        for (let i = 0; i < 10; i++) {
            const candidate = (this.nextSeqNum + i) % 10;
            if (!this.pending.has(candidate)) {
                this.nextSeqNum = (candidate + 1) % 10;
                return candidate;
            }
        }
        throw new Error('SIP2 client at capacity: all 10 sequence numbers in use');
    }

    public disconnect() {
        this.socket?.destroy();
        this.socket = null;
    }
}
