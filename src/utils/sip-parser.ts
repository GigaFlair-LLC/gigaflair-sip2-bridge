import {
    PatronStatusResponse,
    CheckoutResponse,
    CheckinResponse,
    ItemInformationResponse,
    FeePaidResponse,
    PatronInformationResponse,
    HoldResponse,
    RenewAllResponse,
    EndSessionResponse,
    ACSStatusResponse,
    ItemStatusUpdateResponse,
    PatronEnableResponse
} from '../types/index.js';

export function parseFields(raw: string): Record<string, string> {
    const fields: Record<string, string> = {};
    const parts = raw.split('|');

    const header = parts[0];
    const msgType = header.substring(0, 2);

    // Fixed-field lengths (total chars from start of message, including the 2-char code)
    // This determines the first position where variable-length tag fields can appear.
    const fixedFieldLengths: Record<string, number> = {
        '24': 37, // Patron Status Response:  2(code) + 14(status) + 3(lang) + 18(date) = 37
        '64': 63, // Patron Info Response:    2(code) + 14(status) + 3(lang) + 18(date) + 5×4(counts) + 6(inst) = varies
        '98': 36, // ACS Status Response:     2(code) + 6(flags) + 3(timeout) + 3(retries) + 18(date) + 4(proto)
        '10': 24, // Checkin Response:        2(code) + 4(flags) + 18(date) = 24
        '12': 24, // Checkout Response:       2(code) + 4(flags) + 18(date) = 24
        '30': 21, // Fee Paid Response:       2(code) + 1(accepted) + 18(date) = 21
        '16': 24, // Hold Response:           2(code) + 2(flags) + 18(date) + 2(expiry) = varies
        '36': 21, // End Session Response:    2(code) + 1(end) + 18(date) = 21
        '66': 26, // Renew All Response:      2(code) + 1(ok) + 4+4(counts) + 18(date) - but varies
        '26': 37, // Patron Enable Response:  2(code) + 14(status) + 3(lang) + 18(date) = 37
        '20': 21, // Item Status Update:      2(code) + 1(ok) + 18(date) = 21
        '94': 3,  // Login Response:          2(code) + 1(ok) = 3
        '93': 4,  // Login Request
        '18': 37, // Item Info Response:      2(code) + 2(circStatus) + 2(security) + 2(feeType) + 18(date) + ...  
    };

    const threshold = fixedFieldLengths[msgType] ?? 15;

    // Search for tags in all segments
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];

        // Find all [A-Z]{2} sequences that look like tags
        // In the first segment, only tags after the threshold are valid.
        // In subsequent segments, the segment MUST start with a tag.

        if (i === 0) {
            const tagPattern = /([A-Z]{2})([^|]*?)(?=[A-Z]{2}|$)/g;
            let m;
            while ((m = tagPattern.exec(part)) !== null) {
                if (m.index >= threshold) {
                    fields[m[1]] = m[2];
                }
            }
        } else {
            const tag = part.substring(0, 2);
            if (/^[A-Z]{2}$/.test(tag)) {
                fields[tag] = part.substring(2);
            }
        }
    }

    // Special handling for sequence number if present at the end
    const ayMatch = raw.match(/AY(\d)AZ/);
    if (ayMatch) {
        fields['AY'] = ayMatch[1];
    }

    return fields;
}

/**
 * Like parseFields but collects ALL values for each tag into an array.
 */
export function parseFieldsMulti(raw: string): Record<string, string[]> {
    const fields: Record<string, string[]> = {};
    const parts = raw.split('|');
    const msgType = parts[0].substring(0, 2);

    // Use the same fixed-field lookup as parseFields for consistency
    const fixedFieldLengths: Record<string, number> = {
        '24': 37, '64': 63, '98': 36, '10': 24, '12': 24,
        '30': 21, '16': 24, '36': 21, '66': 26, '26': 37,
        '20': 21, '94': 3, '93': 4, '18': 37,
    };
    const threshold = fixedFieldLengths[msgType] ?? 15;

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];

        if (i === 0) {
            const tagPattern = /([A-Z]{2})([^|]*?)(?=[A-Z]{2}|$)/g;
            let m;
            while ((m = tagPattern.exec(part)) !== null) {
                if (m.index >= threshold) {
                    const tag = m[1];
                    if (!fields[tag]) fields[tag] = [];
                    fields[tag].push(m[2]);
                }
            }
        } else {
            const tag = part.substring(0, 2);
            if (/^[A-Z]{2}$/.test(tag)) {
                if (!fields[tag]) fields[tag] = [];
                fields[tag].push(part.substring(2));
            }
        }
    }
    return fields;
}

// ---------------------------------------------------------------------------
// Known standard SIP2 field tags per response type.
// Any tag returned by an ILS that is NOT in these sets is captured in `extensions`.
// This transparently preserves Symphony XA/XB/XC, Sierra PA/PB, Polaris PA/PB, etc.
// ---------------------------------------------------------------------------
const TAGS_PATRON_STATUS = new Set(['AO', 'AA', 'AE', 'BL', 'BZ', 'CA', 'CB', 'AU', 'CD', 'AS', 'AF', 'AG']);
const TAGS_CHECKOUT = new Set(['AO', 'AA', 'AB', 'AJ', 'AH', 'BV', 'AF', 'AG']);
const TAGS_CHECKIN = new Set(['AO', 'AB', 'AJ', 'AQ', 'AF', 'AG']);
const TAGS_ITEM_INFO = new Set(['AO', 'AB', 'AJ', 'BG', 'BH', 'CK', 'AF']);
const TAGS_FEE_PAID = new Set(['AO', 'AA', 'BK', 'BH', 'AF']);
const TAGS_PATRON_INFO = new Set(['AO', 'AA', 'AE', 'BL', 'BE', 'BF', 'BD', 'AF', 'AT', 'AU', 'AV', 'BU', 'BJ', 'BP', 'BQ']);
const TAGS_HOLD = new Set(['AO', 'AA', 'AB', 'AJ', 'BW', 'BS', 'MN', 'AF', 'AG']);
const TAGS_RENEW_ALL = new Set(['AO', 'AA', 'BM', 'BN', 'AF']);
const TAGS_END_SESSION = new Set(['AO', 'AA', 'AF', 'AG']);
const TAGS_ACS_STATUS = new Set(['AO', 'AM', 'BX', 'AN', 'AF']);
const TAGS_ITEM_STATUS_UPDATE = new Set(['AO', 'AB', 'AJ', 'AF', 'AG']);

/**
 * Returns all variable-length fields from a SIP2 response that are NOT in knownTags.
 * Used to surface vendor-specific extensions (Symphony X* fields, Sierra PA/PB, etc.)
 * without any bridging changes.
 * Returns undefined (omitted from JSON) when no extensions are present.
 */
export function parseExtensions(
    raw: string,
    knownTags: Set<string>
): Record<string, string> | undefined {
    const all = parseFields(raw);
    const ext: Record<string, string> = {};
    for (const [tag, value] of Object.entries(all)) {
        // Ignore SIP2 sequence/checksum tags (AY/AZ) and only capture unknown vendor tags
        if (tag === 'AY' || tag === 'AZ') continue;
        if (!knownTags.has(tag)) ext[tag] = value;
    }
    return Object.keys(ext).length > 0 ? ext : undefined;
}

/**
 * Command 24: Patron Status Response
 * 24{patronStatus}{language}{transactionDate}AO{inst}|AA{barcode}|AE{name}|...
 */
export function parsePatronStatusResponse(raw: string): PatronStatusResponse {
    if (!raw.startsWith('24')) {
        throw new Error(`Expected Patron Status Response (24), got: ${raw.substring(0, 2)}`);
    }
    const statusMask = raw.substring(2, 16);
    const fields = parseFields(raw);
    const multiFields = parseFieldsMulti(raw);

    return {
        patronBarcode: fields['AA'] || '',
        patronName: fields['AE'] || 'Unknown',
        validPatron: (fields['BL'] || 'N') === 'Y',
        holdItemsCount: parseInt(fields['BZ'] || '0', 10),
        overdueItemsCount: parseInt(fields['CA'] || '0', 10),
        chargedItemsCount: parseInt(fields['CB'] || '0', 10),
        recallItemsCount: parseInt(fields['CD'] || '0', 10),
        unavailHoldsCount: parseInt(fields['AS'] || '0', 10),
        flags: {
            chargePrivilegesDenied: statusMask[0] === 'Y',
            renewalPrivilegesDenied: statusMask[1] === 'Y',
            recallPrivilegesDenied: statusMask[2] === 'Y',
            holdPrivilegesDenied: statusMask[3] === 'Y',
            cardReportedLost: statusMask[4] === 'Y',
            tooManyItemsOverdue: statusMask[6] === 'Y',
            excessiveFines: statusMask[10] === 'Y',
        },
        screenMessages: multiFields['AF'] || [],
        extensions: parseExtensions(raw, TAGS_PATRON_STATUS),
    };
}

/**
 * Command 12: Checkout Response
 * 12{ok}{renewalOk}{magneticMedia}{desensitize}{transactionDate}AO{instId}|AA{patron}|AB{item}|AJ{titleId}|AH{dueDate}|
 */
export function parseCheckoutResponse(raw: string): CheckoutResponse {
    if (!raw.startsWith('12') && !raw.startsWith('30')) {
        throw new Error(`Expected Checkout/Renew Response (12/30), got: ${raw.substring(0, 2)}`);
    }
    const fields = parseFields(raw);
    const multiFields = parseFieldsMulti(raw);
    return {
        ok: raw[2] === '1',
        renewalOk: raw[3] === 'Y',
        transactionDate: raw.substring(6, 24).trim(),
        institutionId: fields['AO'] || '',
        patronBarcode: fields['AA'] || '',
        itemBarcode: fields['AB'] || '',
        titleId: fields['AJ'] || 'Unknown Title',
        dueDate: fields['AH'] || '',
        feeAmount: fields['BV'],
        screenMessage: fields['AF'],
        screenMessages: multiFields['AF'] || [],
        printLine: fields['AG'],
        extensions: parseExtensions(raw, TAGS_CHECKOUT),
    };
}

/**
 * Command 10: Checkin Response
 * 10{ok:1}{resensitize:1}{magneticMedia:1}{alert:1}{transactionDate:18}AO{instId}|AB{item}|AJ{titleId}|
 *
 * alert='Y' means the item requires special routing (hold trap, transit, etc.).
 */
export function parseCheckinResponse(raw: string): CheckinResponse {
    if (!raw.startsWith('10')) {
        throw new Error(`Expected Checkin Response (10), got: ${raw.substring(0, 2)}`);
    }
    const fields = parseFields(raw);
    const multiFields = parseFieldsMulti(raw);
    return {
        ok: raw[2] === '1',
        resensitize: raw[3] === 'Y',
        magneticMedia: raw[4] === 'Y',
        alert: raw[5] === 'Y',
        transactionDate: raw.substring(6, 24).trim(),
        institutionId: fields['AO'] || '',
        itemBarcode: fields['AB'] || '',
        titleId: fields['AJ'] || 'Unknown Title',
        permanentLocation: fields['AQ'],
        screenMessage: fields['AF'],
        screenMessages: multiFields['AF'] || [],
        printLine: fields['AG'],
        extensions: parseExtensions(raw, TAGS_CHECKIN),
    };
}

/**
 * Command 18: Item Information Response
 * 18{circStatus}{security}{feeType}{transactionDate}AO{instId}|AB{item}|AJ{title}|
 */
export function parseItemInformationResponse(raw: string): ItemInformationResponse {
    if (!raw.startsWith('18')) {
        throw new Error(`Expected Item Information Response (18), got: ${raw.substring(0, 2)}`);
    }
    const fields = parseFields(raw);
    return {
        circulationStatus: raw.substring(2, 4),
        securityMarker: raw.substring(4, 6),
        feeType: raw.substring(6, 8),
        transactionDate: raw.substring(8, 26).trim(),
        itemBarcode: fields['AB'] || '',
        titleId: fields['AJ'] || 'Unknown Title',
        owner: fields['BG'],
        currencyType: fields['BH'],
        callNumber: fields['CK'],
        extensions: parseExtensions(raw, TAGS_ITEM_INFO),
    };
}

/**
 * Command 38: Fee Paid Response
 * 38{ok}{transactionDate}AO{instId}|AA{patron}|BK{feeId}|
 */
export function parseFeePaidResponse(raw: string): FeePaidResponse {
    if (!raw.startsWith('38')) {
        throw new Error(`Expected Fee Paid Response (38), got: ${raw.substring(0, 2)}`);
    }
    const fields = parseFields(raw);
    const multiFields = parseFieldsMulti(raw);
    return {
        ok: raw[2] === '1',
        transactionDate: raw.substring(3, 21).trim(),
        institutionId: fields['AO'] || '',
        patronBarcode: fields['AA'] || '',
        transactionId: fields['BK'],
        screenMessage: fields['AF'],
        screenMessages: multiFields['AF'] || [],
        extensions: parseExtensions(raw, TAGS_FEE_PAID),
    };
}

/**
 * Command 64: Patron Information Response
 * 64{patronStatus:14}{language:3}{transactionDate:18}{holdCount:4}{overdueCount:4}{chargedCount:4}
 *   {fineCount:4}{recallCount:4}{unavailHoldsCount:4}AO{instId}|AA{patron}|AE{name}|...
 *
 * Item lists use repeating tags: AT=holds, AU=overdue, AV=charged, BU=fines, BJ=recall
 */
export function parsePatronInformationResponse(raw: string): PatronInformationResponse {
    if (!raw.startsWith('64')) {
        throw new Error(`Expected Patron Information Response (64), got: ${raw.substring(0, 2)}`);
    }
    const statusMask = raw.substring(2, 16);
    // language:             raw.substring(16, 19) — unused in response object
    // transactionDate:      raw.substring(19, 37) — unused (not mapped to response)
    const holdItemsCount = parseInt(raw.substring(37, 41).trim() || '0', 10);
    const overdueItemsCount = parseInt(raw.substring(41, 45).trim() || '0', 10);
    const chargedItemsCount = parseInt(raw.substring(45, 49).trim() || '0', 10);
    const fineItemsCount = parseInt(raw.substring(49, 53).trim() || '0', 10);
    const recallItemsCount = parseInt(raw.substring(53, 57).trim() || '0', 10);
    const unavailHoldsCount = parseInt(raw.substring(57, 61).trim() || '0', 10);

    const fields = parseFields(raw);
    const multiFields = parseFieldsMulti(raw);

    return {
        patronBarcode: fields['AA'] || '',
        patronName: fields['AE'] || 'Unknown',
        validPatron: (fields['BL'] || 'N') === 'Y',
        holdItemsCount,
        overdueItemsCount,
        chargedItemsCount,
        fineItemsCount,
        recallItemsCount,
        unavailHoldsCount,
        flags: {
            chargePrivilegesDenied: statusMask[0] === 'Y',
            renewalPrivilegesDenied: statusMask[1] === 'Y',
            recallPrivilegesDenied: statusMask[2] === 'Y',
            holdPrivilegesDenied: statusMask[3] === 'Y',
            cardReportedLost: statusMask[4] === 'Y',
            tooManyItemsOverdue: statusMask[6] === 'Y',
            excessiveFines: statusMask[10] === 'Y',
        },
        holdItems: multiFields['AT'] || [],
        overdueItems: multiFields['AU'] || [],
        chargedItems: multiFields['AV'] || [],
        fineItems: multiFields['BU'] || [],
        recallItems: multiFields['BJ'] || [],
        email: fields['BE'],
        phone: fields['BF'],
        homeAddress: fields['BD'],
        screenMessage: fields['AF'],
        screenMessages: multiFields['AF'] || [],
        extensions: parseExtensions(raw, TAGS_PATRON_INFO),
    };
}

/**
 * Command 16: Hold Response
 * 16{ok:1}{available:1}{transactionDate:18}AO{instId}|AA{patron}|[AB{item}|][AJ{title}|]...
 */
export function parseHoldResponse(raw: string): HoldResponse {
    if (!raw.startsWith('16')) {
        throw new Error(`Expected Hold Response (16), got: ${raw.substring(0, 2)}`);
    }
    const fields = parseFields(raw);
    const multiFields = parseFieldsMulti(raw);
    return {
        ok: raw[2] === '1',
        available: raw[3] === 'Y',
        transactionDate: raw.substring(4, 22).trim(),
        institutionId: fields['AO'] || '',
        patronBarcode: fields['AA'] || '',
        itemBarcode: fields['AB'],
        titleId: fields['AJ'],
        expirationDate: fields['BW'],
        pickupLocation: fields['BS'],
        queuePosition: fields['MN'],
        screenMessage: fields['AF'],
        screenMessages: multiFields['AF'] || [],
        printLine: fields['AG'],
        extensions: parseExtensions(raw, TAGS_HOLD),
    };
}

/**
 * Command 66: Renew All Response
 * 66{ok:1}{renewedCount:4}{unrenewedCount:4}{transactionDate:18}AO{instId}|AA{patron}|
 *   [BM{renewedItem}|...][BN{unrenewedItem}|...]
 */
export function parseRenewAllResponse(raw: string): RenewAllResponse {
    if (!raw.startsWith('66')) {
        throw new Error(`Expected Renew All Response (66), got: ${raw.substring(0, 2)}`);
    }
    const ok = raw[2] === '1';
    const renewedCount = parseInt(raw.substring(3, 7).trim() || '0', 10);
    const unrenewedCount = parseInt(raw.substring(7, 11).trim() || '0', 10);
    const transactionDate = raw.substring(11, 29).trim();

    const fields = parseFields(raw);
    const multiFields = parseFieldsMulti(raw);

    return {
        ok,
        renewedCount,
        unrenewedCount,
        transactionDate,
        institutionId: fields['AO'] || '',
        patronBarcode: fields['AA'] || '',
        renewedItems: multiFields['BM'] || [],
        unrenewedItems: multiFields['BN'] || [],
        screenMessage: fields['AF'],
        screenMessages: multiFields['AF'] || [],
        extensions: parseExtensions(raw, TAGS_RENEW_ALL),
    };
}

/**
 * Command 36: End Patron Session Response
 * 36{endSession:1}{transactionDate:18}AO{instId}|AA{patron}|
 */
export function parseEndSessionResponse(raw: string): EndSessionResponse {
    if (!raw.startsWith('36')) {
        throw new Error(`Expected End Session Response (36), got: ${raw.substring(0, 2)}`);
    }
    const fields = parseFields(raw);
    const multiFields = parseFieldsMulti(raw);
    return {
        endSession: raw[2] === 'Y',
        transactionDate: raw.substring(3, 21).trim(),
        institutionId: fields['AO'] || '',
        patronBarcode: fields['AA'] || '',
        screenMessage: fields['AF'],
        screenMessages: multiFields['AF'] || [],
        printLine: fields['AG'],
        extensions: parseExtensions(raw, TAGS_END_SESSION),
    };
}

/**
 * Command 98: ACS Status Response
 * 98{onlineStatus:1}{checkinOk:1}{checkoutOk:1}{acsRenewalPolicy:1}{statusUpdateOk:1}{offlineOk:1}
 *   {timeoutPeriod:3}{retriesAllowed:3}{dateTimeSync:18}{protocolVersion:4}AO{instId}|...
 */
export function parseACSStatusResponse(raw: string): ACSStatusResponse {
    if (!raw.startsWith('98')) {
        throw new Error(`Expected ACS Status Response (98), got: ${raw.substring(0, 2)}`);
    }
    const fields = parseFields(raw);
    return {
        onlineStatus: raw[2] === 'Y',
        checkinOk: raw[3] === 'Y',
        checkoutOk: raw[4] === 'Y',
        acsRenewalPolicy: raw[5] === 'Y',
        statusUpdateOk: raw[6] === 'Y',
        offlineOk: raw[7] === 'Y',
        timeoutPeriod: parseInt(raw.substring(8, 11).trim() || '0', 10),
        retriesAllowed: parseInt(raw.substring(11, 14).trim() || '0', 10),
        dateTimeSync: raw.substring(14, 32).trim(),
        protocolVersion: raw.substring(32, 36).trim(),
        institutionId: fields['AO'] || '',
        libraryName: fields['AM'],
        supportedMessages: fields['BX'],
        terminalLocation: fields['AN'],
        screenMessage: fields['AF'],
        extensions: parseExtensions(raw, TAGS_ACS_STATUS),
    };
}

/**
 * Command 20: Item Status Update Response
 * 20{securityMarker:1}{transactionDate:18}AO{instId}|AB{item}|AJ{title}|
 */
export function parseItemStatusUpdateResponse(raw: string): ItemStatusUpdateResponse {
    if (!raw.startsWith('20')) {
        throw new Error(`Expected Item Status Update Response (20), got: ${raw.substring(0, 2)}`);
    }
    const fields = parseFields(raw);
    const multiFields = parseFieldsMulti(raw);
    return {
        securityMarker: raw[2],
        transactionDate: raw.substring(3, 21).trim(),
        institutionId: fields['AO'] || '',
        itemBarcode: fields['AB'] || '',
        titleId: fields['AJ'] || '',
        screenMessage: fields['AF'],
        screenMessages: multiFields['AF'] || [],
        printLine: fields['AG'],
        extensions: parseExtensions(raw, TAGS_ITEM_STATUS_UPDATE),
    };
}

/**
 * Command 26: Patron Enable Response
 * 26{patronStatus:14}{language:3}{transactionDate:18}AO{instId}|AA{patron}|AE{name}|...
 * Same layout as Patron Status Response (24) — shares the same parser.
 */
export function parsePatronEnableResponse(raw: string): PatronEnableResponse {
    if (!raw.startsWith('26')) {
        throw new Error(`Expected Patron Enable Response (26), got: ${raw.substring(0, 2)}`);
    }
    const statusMask = raw.substring(2, 16);
    const fields = parseFields(raw);
    const multiFields = parseFieldsMulti(raw);
    return {
        patronBarcode: fields['AA'] || '',
        patronName: fields['AE'] || 'Unknown',
        validPatron: (fields['BL'] || 'N') === 'Y',
        holdItemsCount: parseInt(fields['BZ'] || '0', 10),
        overdueItemsCount: parseInt(fields['CA'] || '0', 10),
        chargedItemsCount: parseInt(fields['CB'] || '0', 10),
        recallItemsCount: parseInt(fields['CD'] || '0', 10),
        unavailHoldsCount: parseInt(fields['AS'] || '0', 10),
        flags: {
            chargePrivilegesDenied: statusMask[0] === 'Y',
            renewalPrivilegesDenied: statusMask[1] === 'Y',
            recallPrivilegesDenied: statusMask[2] === 'Y',
            holdPrivilegesDenied: statusMask[3] === 'Y',
            cardReportedLost: statusMask[4] === 'Y',
            tooManyItemsOverdue: statusMask[6] === 'Y',
            excessiveFines: statusMask[10] === 'Y',
        },
        screenMessages: multiFields['AF'] || [],
        extensions: parseExtensions(raw, TAGS_PATRON_STATUS),
    };
}
