import { SipClient } from './sip-client.js';
import {
    LMSConfig,
    CircuitBreaker,
    CircuitState,
    FAILURE_THRESHOLD,
    BACKOFF_SCHEDULE,
    Logger,
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
    PatronEnableResponse
} from '../types/index.js';
import { formatLoginRequest } from '../utils/sip-formatter.js';
import { EventHub } from './EventHub.js';
import { MaskingService } from './MaskingService.js';

export class SipConnectionManager {
    private clients: Map<string, SipClient> = new Map();
    private configs: Map<string, LMSConfig> = new Map();
    private breakers: Map<string, CircuitBreaker> = new Map();
    /** Per-branch FIFO promise chain for serializing SIP2 operations */
    private queues: Map<string, Promise<void>> = new Map();
    private locationCode: string;
    private logger: Logger;

    constructor(configs: LMSConfig[], locationCode: string = '', logger?: Logger) {
        this.locationCode = locationCode;
        this.logger = logger || console;
        for (const config of configs) {
            this.configs.set(config.branchId, config);
            this.breakers.set(config.branchId, {
                state: 'CLOSED',
                failureCount: 0,
                lastFailureAt: null,
                nextRetryAt: null,
                backoffIndex: 0,
                halfOpenLocked: false
            });
        }
    }

    private getBreaker(branchId: string): CircuitBreaker {
        const breaker = this.breakers.get(branchId);
        if (!breaker) throw new Error(`Unknown branch: ${branchId}`);
        return breaker;
    }

    public getCircuitState(branchId: string): CircuitState {
        const breaker = this.getBreaker(branchId);

        // Check if we should transition from OPEN to HALF_OPEN
        if (breaker.state === 'OPEN' && breaker.nextRetryAt && Date.now() >= breaker.nextRetryAt) {
            breaker.state = 'HALF_OPEN';
        }

        return breaker.state;
    }

    private async getClient(branchId: string): Promise<SipClient> {
        const breaker = this.getBreaker(branchId);

        // Handle state transitions
        if (breaker.state === 'OPEN' && breaker.nextRetryAt && Date.now() >= breaker.nextRetryAt) {
            breaker.state = 'HALF_OPEN';
            breaker.halfOpenLocked = false;
        }

        if (breaker.state === 'OPEN') {
            throw new Error(`Circuit for branch ${branchId} is OPEN. Next retry at ${new Date(breaker.nextRetryAt!).toISOString()}`);
        }

        if (breaker.state === 'HALF_OPEN') {
            if (breaker.halfOpenLocked) {
                throw new Error(`Circuit for branch ${branchId} is HALF_OPEN (probe in flight)`);
            }
            breaker.halfOpenLocked = true;
        }

        let client = this.clients.get(branchId);
        if (!client) {
            const config = this.configs.get(branchId)!;
            client = new SipClient(
                config.host,
                config.port,
                config.timeoutMs,
                config.institutionId || 'GigaFlair',
                !!config.useTls,
                this.logger,
                config.rejectUnauthorized !== false, // Default to true if not explicitly false
                config.vendorProfile?.checksumRequired !== false // Default true; set false for legacy systems without checksums
            );

            try {
                if (config.sipUser && config.sipPassword) {
                    await this.performLogin(client, config);
                }
                this.clients.set(branchId, client);
            } catch (err) {
                client.disconnect();
                throw err;
            }
        }
        return client;
    }

    private async performLogin(client: SipClient, config: LMSConfig, retries = 2): Promise<void> {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const seqNum = 0;
                const loginStr = formatLoginRequest(config.sipUser!, config.sipPassword!, this.locationCode, seqNum);
                const response = await client.sendRaw(loginStr, seqNum);

                if (response.startsWith('941')) {
                    if (config.vendorProfile?.postLoginSCStatus) {
                        // Ex Libris Alma requires an SC Status (99) immediately after login
                        // to finalise the session before any other commands are accepted.
                        this.logger.info(`[${config.branchId}] Sending post-login SC Status (vendorProfile.postLoginSCStatus=true)`);
                        await client.scStatus();
                    }
                    return;
                }
                throw new Error(`SIP2 Login rejected (response: ${response.substring(0, 5)})`);
            } catch (err) {
                if (attempt === retries) throw err;
                this.logger.warn(`Login attempt ${attempt + 1} failed for ${config.branchId}, retrying...`);
                client.disconnect();
                // Exponential-ish backoff for retries
                await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
            }
        }
    }

    private recordSuccess(branchId: string) {
        const breaker = this.getBreaker(branchId);
        if (breaker.state !== 'CLOSED') {
            this.logger.info(`Circuit for branch ${branchId} transitioned ${breaker.state} -> CLOSED (Success)`);
        }
        breaker.state = 'CLOSED';
        breaker.failureCount = 0;
        breaker.backoffIndex = 0;
        breaker.nextRetryAt = null;
        breaker.halfOpenLocked = false;
    }

    private recordFailure(branchId: string) {
        const breaker = this.getBreaker(branchId);
        breaker.failureCount++;
        breaker.lastFailureAt = Date.now();
        breaker.halfOpenLocked = false;

        if (breaker.failureCount >= FAILURE_THRESHOLD || breaker.state === 'HALF_OPEN') {
            const oldState = breaker.state;
            breaker.state = 'OPEN';
            const backoff = BACKOFF_SCHEDULE[breaker.backoffIndex] || BACKOFF_SCHEDULE[BACKOFF_SCHEDULE.length - 1];
            breaker.nextRetryAt = Date.now() + backoff;
            this.logger.warn(`Circuit for branch ${branchId} transitioned ${oldState} -> OPEN (failure count: ${breaker.failureCount}, backoff: ${backoff}ms)`);
            if (breaker.backoffIndex < BACKOFF_SCHEDULE.length - 1) {
                breaker.backoffIndex++;
            }

            // Cleanup client on hard failure
            const client = this.clients.get(branchId);
            if (client) {
                client.disconnect();
                this.clients.delete(branchId);
            }
        }
    }

    /**
     * Enqueue a SIP2 operation on the per-branch FIFO queue.
     *
     * SIP2 is a sequential protocol — each TCP connection processes one
     * request-response pair at a time.  Without serialisation, concurrent
     * HTTP requests race on the same socket, exhaust the 10 available
     * sequence numbers, and produce misrouted / timed-out responses.
     *
     * The queue chains every operation behind the previous one so that
     * only one SIP2 transaction is in-flight per branch at any given moment.
     * Failures in one operation never break the chain for subsequent callers.
     */
    private execute<T>(branchId: string, actionName: string, requestPayload: unknown, action: (client: SipClient) => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const prev = this.queues.get(branchId) ?? Promise.resolve();
            const current = prev.then(async () => {
                try {
                    const result = await this._executeInner(branchId, actionName, requestPayload, action);
                    resolve(result);
                } catch (err) {
                    reject(err);
                }
            });
            // Normalise to void so the chain never rejects
            this.queues.set(branchId, current.then(() => {}, () => {}));
        });
    }

    /** The actual SIP2 send/receive logic, invoked one-at-a-time per branch by execute(). */
    private async _executeInner<T>(branchId: string, actionName: string, requestPayload: unknown, action: (client: SipClient) => Promise<T>): Promise<T> {
        let client: SipClient;
        try {
            client = await this.getClient(branchId);
        } catch (err: unknown) {
            const error = err as Error;
            const isCircuitGate = error.message.includes('is OPEN') || error.message.includes('probe in flight');
            if (!isCircuitGate) {
                this.recordFailure(branchId);
            }
            throw error;
        }

        try {
            const result = await action(client);
            this.recordSuccess(branchId);

            // Ethics Hook: Log the transaction asynchronously and securely
            EventHub.emitLog(MaskingService.maskPayload({
                action: actionName,
                branchId,
                request: requestPayload,
                response: result,
                timestamp: new Date().toISOString()
            }));

            return result;
        } catch (err) {
            this.recordFailure(branchId);
            throw err;
        }
    }

    public async patronStatus(branchId: string, barcode: string, language: string = '001'): Promise<PatronStatusResponse> {
        return this.execute(branchId, 'PatronStatus', { barcode, language }, (client) => client.patronStatus(barcode, language));
    }

    public async checkout(branchId: string, patronBarcode: string, itemBarcode: string, patronPin?: string): Promise<CheckoutResponse> {
        return this.execute(branchId, 'Checkout', { patronBarcode, itemBarcode }, (client) => client.checkout(patronBarcode, itemBarcode, patronPin));
    }

    public async checkin(branchId: string, itemBarcode: string): Promise<CheckinResponse> {
        return this.execute(branchId, 'Checkin', { itemBarcode }, (client) => client.checkin(itemBarcode));
    }

    public async itemInformation(branchId: string, itemBarcode: string): Promise<ItemInformationResponse> {
        return this.execute(branchId, 'ItemInformation', { itemBarcode }, (client) => client.itemInformation(itemBarcode));
    }

    public async renew(branchId: string, patronBarcode: string, itemBarcode: string, patronPin?: string): Promise<CheckoutResponse> {
        return this.execute(branchId, 'Renew', { patronBarcode, itemBarcode }, (client) => client.renew(patronBarcode, itemBarcode, patronPin));
    }

    public async feePaid(
        branchId: string,
        patronBarcode: string,
        feeId: string,
        amount: string,
        feeType: string = '01',
        paymentType: string = '00',
        currencyType: string = 'USD'
    ): Promise<FeePaidResponse> {
        return this.execute(branchId, 'FeePaid', { patronBarcode, feeId, amount, feeType, paymentType, currencyType }, (client) => client.feePaid(patronBarcode, feeId, amount, feeType, paymentType, currencyType));
    }

    public async patronInformation(
        branchId: string,
        patronBarcode: string,
        summary: PatronInformationSummary = {},
        startItem: number = 1,
        endItem: number = 5,
        language: string = '001'
    ): Promise<PatronInformationResponse> {
        return this.execute(branchId, 'PatronInformation', { patronBarcode, summary, startItem, endItem, language }, (client) => client.patronInformation(patronBarcode, summary, startItem, endItem, language));
    }

    public async hold(
        branchId: string,
        patronBarcode: string,
        holdMode: '+' | '-' | '*',
        itemBarcode?: string,
        expiryDate?: string,
        pickupLocation?: string,
        titleId?: string
    ): Promise<HoldResponse> {
        return this.execute(branchId, 'Hold', { patronBarcode, holdMode, itemBarcode, expiryDate, pickupLocation, titleId }, (client) => client.hold(patronBarcode, holdMode, itemBarcode, expiryDate, pickupLocation, titleId));
    }

    public async renewAll(branchId: string, patronBarcode: string): Promise<RenewAllResponse> {
        return this.execute(branchId, 'RenewAll', { patronBarcode }, (client) => client.renewAll(patronBarcode));
    }

    public async endSession(branchId: string, patronBarcode: string): Promise<EndSessionResponse> {
        return this.execute(branchId, 'EndSession', { patronBarcode }, (client) => client.endSession(patronBarcode));
    }

    public async scStatus(branchId: string): Promise<ACSStatusResponse> {
        return this.execute(branchId, 'SCStatus', {}, (client) => client.scStatus());
    }

    public async blockPatron(
        branchId: string,
        patronBarcode: string,
        cardRetained: boolean = false,
        blockedCardMessage: string = ''
    ): Promise<void> {
        return this.execute(branchId, 'BlockPatron', { patronBarcode, cardRetained, blockedCardMessage }, (client) => client.blockPatron(patronBarcode, cardRetained, blockedCardMessage));
    }

    public async itemStatusUpdate(
        branchId: string,
        itemBarcode: string,
        securityMarker: '0' | '1' | '2' | '3' = '2'
    ): Promise<ItemStatusUpdateResponse> {
        return this.execute(branchId, 'ItemStatusUpdate', { itemBarcode, securityMarker }, (client) => client.itemStatusUpdate(itemBarcode, securityMarker));
    }

    public async patronEnable(
        branchId: string,
        patronBarcode: string,
        patronPin?: string
    ): Promise<PatronEnableResponse> {
        return this.execute(branchId, 'PatronEnable', { patronBarcode }, (client) => client.patronEnable(patronBarcode, patronPin));
    }

    public async reinitialize(newConfigs: LMSConfig[], locationCode?: string) {
        this.logger.info('Re-initializing SipConnectionManager with new configuration...');

        // 1. Drain in-flight operations before tearing down.
        // Capture the current queue promises so we wait for any running transactions
        // to complete (or reject) before clearing state. This prevents crashes from
        // accessing deleted objects during an in-flight SIP2 exchange.
        const drainPromises = Array.from(this.queues.values());
        if (drainPromises.length > 0) {
            this.logger.info(`Draining ${drainPromises.length} in-flight operation queue(s)...`);
            await Promise.allSettled(drainPromises);
        }

        // 2. Gracefully shutdown existing clients (sockets + maps).
        this.shutdown();

        // 3. Update location code
        if (locationCode !== undefined) {
            this.locationCode = locationCode;
        }

        // 4. Clear and rebuild config/breaker maps
        this.configs.clear();
        this.breakers.clear();
        this.queues.clear();

        for (const config of newConfigs) {
            this.configs.set(config.branchId, config);
            this.breakers.set(config.branchId, {
                state: 'CLOSED',
                failureCount: 0,
                lastFailureAt: null,
                nextRetryAt: null,
                backoffIndex: 0,
                halfOpenLocked: false
            });
        }
    }

    public shutdown() {
        for (const client of this.clients.values()) {
            client.disconnect();
        }
        this.clients.clear();
        this.queues.clear();
    }

    /** @internal - Test-only: directly read/set circuit breaker state */
    public _getBreakerState(branchId: string): CircuitBreaker {
        return { ...this.getBreaker(branchId) };
    }

    /** @internal - Test-only: simulate a failure without network I/O */
    public _simulateFailure(branchId: string): void {
        this.recordFailure(branchId);
    }

    /** @internal - Test-only: simulate a success without network I/O */
    public _simulateSuccess(branchId: string): void {
        this.recordSuccess(branchId);
    }

    /** @internal - Test-only: manually set nextRetryAt so HALF_OPEN can be triggered */
    public _expireBackoff(branchId: string): void {
        const breaker = this.getBreaker(branchId);
        if (breaker.state === 'OPEN') {
            breaker.nextRetryAt = Date.now() - 1;
        }
    }
}
