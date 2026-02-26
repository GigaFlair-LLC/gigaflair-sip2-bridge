import { z } from 'zod';

/**
 * Vendor-specific behavioral flags for ILS compatibility.
 * Apply these for known deviations from the SIP2 2.0 standard.
 *
 * Common vendor notes:
 *   Koha               — standard SIP2; set checksumRequired: false for legacy versions
 *   Evergreen          — standard SIP2; strict institutionId matching; may send PE/PI/PC extensions
 *   Alma (Ex Libris)   — set postLoginSCStatus: true
 *   Sierra (Innovative)— sends multiple AF fields; captured in screenMessages[]
 *   Symphony (SirsiDynix)— uses X-prefixed fields (XA,XB,XC...); captured in extensions{}
 *   Polaris            — uses PA (patron expiry), PB (birth date); captured in extensions{}
 *
 * Evergreen-specific notes:
 *   - Institution ID MUST match <institution id=""> in oils_sip.xml (case-sensitive)
 *   - Checksums always present when error-detect is enabled
 *   - May return extension fields: PE (expiry), PI (language), PC (category), CL (sort bin)
 *   - Strongly supports patron PIN (AD field) — may require it if configured
 *   - Does NOT require post-login SC Status
 */
export interface VendorProfile {
    /** Human-readable name for logs and diagnostics (e.g. 'Koha', 'Evergreen', 'Alma', 'Sierra', 'Symphony') */
    name?: string;
    /**
     * Ex Libris Alma requires an SC Status (99) sent immediately after Login (93)
     * before it will accept any operational commands. Without this handshake,
     * Alma silently queues or rejects subsequent commands.
     */
    postLoginSCStatus?: boolean;
    /**
     * Set to false for legacy ILS systems that omit the AY/AZ checksum block entirely.
     * When false, messages without a valid checksum are still processed instead of rejected.
     * Default: true.
     */
    checksumRequired?: boolean;
}

export interface LMSConfig {
    branchId: string;
    host: string;
    port: number;
    useTls: boolean;
    rejectUnauthorized?: boolean;
    sipUser?: string;
    sipPassword?: string;
    institutionId?: string;
    timeoutMs: number;
    vendorProfile?: VendorProfile;
}

export interface EnvConfig {
    LMS_HOST: string;
    LMS_PORT: number;
    SIP2_USER?: string;
    SIP2_PASS?: string;
    SIP2_LOCATION?: string;
    BRIDGE_API_KEY: string;
    PORT: number;
    HOST: string;
    NODE_ENV: string;
}

export const EncryptedPayloadSchema = z.object({
    iv: z.string(),
    content: z.string(),
    tag: z.string()
});

export const UserSchema = z.object({
    username: z.string().min(3),
    passwordHash: z.string(),
    mfaEnabled: z.boolean().default(false),
    role: z.enum(['admin', 'viewer']).default('admin')
});

export type User = z.infer<typeof UserSchema>;

export type SafeUser = Omit<User, 'passwordHash'>;

export const AppConfigSchema = z.object({
    lmsHost: z.string().min(1).default('127.0.0.1'),
    lmsPort: z.number().int().positive().default(6001),
    useTls: z.boolean().default(false),
    rejectUnauthorized: z.boolean().default(true),
    sip2User: z.string().optional(),
    sip2Password: z.union([z.string(), EncryptedPayloadSchema]).optional(),
    sip2Location: z.string().default(''),
    bridgeApiKey: z.string().min(8).optional(),
    apiKeyHash: z.string().optional(),
    apiKeyPrefix: z.string().optional(),
    apiKeySuffix: z.string().optional(),
    users: z.array(UserSchema).max(10).default([]),
    institutionId: z.string().default('GigaFlair'),
    timeoutMs: z.number().int().positive().default(5000),
    port: z.number().int().positive().default(3100),
    host: z.string().default('0.0.0.0'),
    pendingUpdateVersion: z.string().optional(),
    isCriticalUpdate: z.boolean().optional(),
    logRetentionHours: z.number().int().min(24).max(720).default(168).optional(),
    vendorProfile: z.object({
        name: z.string().optional(),
        postLoginSCStatus: z.boolean().optional(),
        checksumRequired: z.boolean().optional(),
    }).optional()
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export interface SanitizedConfig extends Omit<AppConfig, 'sip2Password' | 'bridgeApiKey' | 'users' | 'apiKeyHash' | 'apiKeyPrefix' | 'apiKeySuffix' | 'apiKeyIterations'> {
    sip2Password: { value: string; isManaged: boolean; isPresent: boolean };
    bridgeApiKey: {
        value: string;
        maskedValue: string;
        isManaged: boolean;
        isPresent: boolean
    };
    users: SafeUser[];
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreaker {
    state: CircuitState;
    failureCount: number;
    lastFailureAt: number | null;
    nextRetryAt: number | null;
    backoffIndex: number;
    halfOpenLocked: boolean;
}

export const BACKOFF_SCHEDULE = process.env.NODE_ENV === 'test'
    ? [200, 400, 600]
    : [5000, 10000, 20000, 40000, 60000];
export const FAILURE_THRESHOLD = 3;

export interface Logger {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
    debug(msg: string, ...args: unknown[]): void;
}

export interface PatronStatusResponse {
    patronBarcode: string;
    patronName: string;
    validPatron: boolean;
    holdItemsCount: number;
    overdueItemsCount: number;
    chargedItemsCount: number;
    recallItemsCount: number;
    unavailHoldsCount: number;
    flags: {
        chargePrivilegesDenied: boolean;
        renewalPrivilegesDenied: boolean;
        recallPrivilegesDenied: boolean;
        holdPrivilegesDenied: boolean;
        cardReportedLost: boolean;
        tooManyItemsOverdue: boolean;
        excessiveFines: boolean;
    };
    screenMessages?: string[];
    extensions?: Record<string, string>;
}

export interface CheckoutResponse {
    ok: boolean;
    renewalOk: boolean;
    transactionDate: string;
    institutionId: string;
    patronBarcode: string;
    itemBarcode: string;
    titleId: string;
    dueDate: string;
    feeAmount?: string;
    screenMessage?: string;
    screenMessages?: string[];
    printLine?: string;
    extensions?: Record<string, string>;
}

export interface CheckinResponse {
    ok: boolean;
    resensitize: boolean;
    magneticMedia: boolean;
    alert: boolean;
    transactionDate: string;
    institutionId: string;
    itemBarcode: string;
    titleId: string;
    permanentLocation?: string;
    screenMessage?: string;
    screenMessages?: string[];
    printLine?: string;
    extensions?: Record<string, string>;
}

export interface ItemInformationResponse {
    circulationStatus: string;
    securityMarker: string;
    feeType: string;
    transactionDate: string;
    itemBarcode: string;
    titleId: string;
    owner?: string;
    currencyType?: string;
    callNumber?: string;
    extensions?: Record<string, string>;
}

export interface FeePaidResponse {
    ok: boolean;
    transactionDate: string;
    institutionId: string;
    patronBarcode: string;
    transactionId?: string;
    screenMessage?: string;
    screenMessages?: string[];
    extensions?: Record<string, string>;
}

export interface PatronInformationSummary {
    holds?: boolean;
    overdue?: boolean;
    charged?: boolean;
    fines?: boolean;
    recall?: boolean;
}

export interface PatronInformationResponse {
    patronBarcode: string;
    patronName: string;
    validPatron: boolean;
    holdItemsCount: number;
    overdueItemsCount: number;
    chargedItemsCount: number;
    fineItemsCount: number;
    recallItemsCount: number;
    unavailHoldsCount: number;
    flags: {
        chargePrivilegesDenied: boolean;
        renewalPrivilegesDenied: boolean;
        recallPrivilegesDenied: boolean;
        holdPrivilegesDenied: boolean;
        cardReportedLost: boolean;
        tooManyItemsOverdue: boolean;
        excessiveFines: boolean;
    };
    holdItems: string[];
    overdueItems: string[];
    chargedItems: string[];
    fineItems: string[];
    recallItems: string[];
    email?: string;
    phone?: string;
    homeAddress?: string;
    screenMessage?: string;
    screenMessages?: string[];
    extensions?: Record<string, string>;
}

export interface HoldResponse {
    ok: boolean;
    available: boolean;
    transactionDate: string;
    institutionId: string;
    patronBarcode: string;
    itemBarcode?: string;
    titleId?: string;
    expirationDate?: string;
    pickupLocation?: string;
    queuePosition?: string;
    screenMessage?: string;
    screenMessages?: string[];
    printLine?: string;
    extensions?: Record<string, string>;
}

export interface RenewAllResponse {
    ok: boolean;
    renewedCount: number;
    unrenewedCount: number;
    transactionDate: string;
    institutionId: string;
    patronBarcode: string;
    renewedItems: string[];
    unrenewedItems: string[];
    screenMessage?: string;
    screenMessages?: string[];
    extensions?: Record<string, string>;
}

export interface EndSessionResponse {
    endSession: boolean;
    transactionDate: string;
    institutionId: string;
    patronBarcode: string;
    screenMessage?: string;
    screenMessages?: string[];
    printLine?: string;
    extensions?: Record<string, string>;
}

export interface ACSStatusResponse {
    onlineStatus: boolean;
    checkinOk: boolean;
    checkoutOk: boolean;
    acsRenewalPolicy: boolean;
    statusUpdateOk: boolean;
    offlineOk: boolean;
    timeoutPeriod: number;
    retriesAllowed: number;
    dateTimeSync: string;
    protocolVersion: string;
    institutionId: string;
    libraryName?: string;
    supportedMessages?: string;
    terminalLocation?: string;
    screenMessage?: string;
    extensions?: Record<string, string>;
}

/**
 * Response 20: Item Status Update Response
 * 20{securityMarker:1}{transactionDate:18}AO{instId}|AB{item}|AJ{title}|
 */
export interface ItemStatusUpdateResponse {
    securityMarker: string;
    transactionDate: string;
    institutionId: string;
    itemBarcode: string;
    titleId: string;
    screenMessage?: string;
    screenMessages?: string[];
    printLine?: string;
    extensions?: Record<string, string>;
}

/**
 * Response 26: Patron Enable Response — same layout as Patron Status Response (24)
 */
export type PatronEnableResponse = PatronStatusResponse;

/**
 * SIP2 fee type codes (feeType fixed field in Command 37).
 */
export const SIP2FeeType = {
    Other: '01',
    Administrative: '02',
    Damage: '03',
    Overdue: '04',
    Processing: '05',
    Rental: '06',
    Replacement: '07',
    ComputerAccessCharge: '08',
    HoldFee: '09',
} as const;

/**
 * SIP2 payment type codes (paymentType fixed field in Command 37).
 */
export const SIP2PaymentType = {
    Cash: '00',
    Visa: '01',
    CreditCard: '02',
} as const;

/**
 * Commonly used SIP2 language codes (language fixed field in Commands 23, 63).
 */
export const SIP2Language = {
    Unknown: '000',
    English: '001',
    French: '011',
    FrenchCanada: '012',
    German: '021',
    Italian: '031',
    Dutch: '041',
    Swedish: '051',
    Finnish: '061',
    Spanish: '071',
    Danish: '081',
    Portuguese: '091',
    Norwegian: '101',
} as const;
