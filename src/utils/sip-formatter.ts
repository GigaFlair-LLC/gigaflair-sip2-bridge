import { appendChecksum } from './checksum.js';

/**
 * Formats a current date string in SIP2 format: YYYYMMDD    HHMMSS
 * (4 spaces between date and time)
 */
export function getSipTimestamp(): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const mins = String(now.getUTCMinutes()).padStart(2, '0');
    const secs = String(now.getUTCSeconds()).padStart(2, '0');

    return `${year}${month}${day}    ${hours}${mins}${secs}`;
}

/**
 * Strip SIP2 delimiter and terminator characters to prevent protocol injection.
 */
export function sanitizeSipField(value: string): string {
    // eslint-disable-next-line no-control-regex
    return value.replace(/[|\r\n\x00-\x1F]/g, '');
}

/**
 * Command 23: Patron Status Request
 * 23{language:3}{transactionDate:18}AO{institutionId}|AA{patronBarcode}|AC{terminalPassword}|
 *
 * language: 3-digit code — '001'=English, '011'=French, '021'=German, etc. (SIP2Language constants)
 */
export function formatPatronStatusRequest(
    barcode: string,
    institutionId: string = 'GigaFlair',
    seqNum: number = 0,
    language: string = '001'
): string {
    const timestamp = getSipTimestamp();
    const safeBarcode = sanitizeSipField(barcode);
    const safeInst = sanitizeSipField(institutionId);

    const msg = `23${language.substring(0, 3)}${timestamp}AO${safeInst}|AA${safeBarcode}|AC|`;
    return appendChecksum(msg, seqNum);
}

/**
 * Command 93: Login Request
 * 93{UIDalgorithm}{PWDalgorithm}CN{uid}|CO{pwd}|CP{locationCode}|
 */
export function formatLoginRequest(
    uid: string,
    pwd: string,
    locationCode: string = '',
    seqNum: number = 0
): string {
    const safeUid = sanitizeSipField(uid);
    const safePwd = sanitizeSipField(pwd);
    const safeLoc = sanitizeSipField(locationCode);
    const msg = `9300CN${safeUid}|CO${safePwd}|CP${safeLoc}|`;
    return appendChecksum(msg, seqNum);
}

/**
 * Command 11: Checkout
 * 11{scRenewalPolicy:1}{noBlock:1}{transactionDate:18}{nbDueDate:18}AO{instId}|AA{patron}|AB{item}|AC{pw}|[AD{pin}|]
 *
 * patronPin: optional PIN sent as AD field — required by some ILS in strict self-service mode
 */
export function formatCheckoutRequest(
    patronBarcode: string,
    itemBarcode: string,
    institutionId: string = 'GigaFlair',
    seqNum: number = 0,
    patronPin?: string
): string {
    const timestamp = getSipTimestamp();
    const nbDueDate = ''.padEnd(18, ' '); // Non-blank due date (optional)
    let msg = `11YN${timestamp}${nbDueDate}AO${sanitizeSipField(institutionId)}|AA${sanitizeSipField(patronBarcode)}|AB${sanitizeSipField(itemBarcode)}|AC|`;
    if (patronPin) msg += `AD${sanitizeSipField(patronPin)}|`;
    return appendChecksum(msg, seqNum);
}

/**
 * Command 09: Checkin
 * 09{noBlock}{transactionDate}{returnDate}AO{instId}|AB{item}|AC{pw}|
 */
export function formatCheckinRequest(
    itemBarcode: string,
    institutionId: string = 'GigaFlair',
    seqNum: number = 0
): string {
    const timestamp = getSipTimestamp();
    const msg = `09N${timestamp}${timestamp}AO${sanitizeSipField(institutionId)}|AB${sanitizeSipField(itemBarcode)}|AC|`;
    return appendChecksum(msg, seqNum);
}

/**
 * Command 17: Item Information
 * 17{transactionDate}AO{instId}|AB{item}|
 */
export function formatItemInformationRequest(
    itemBarcode: string,
    institutionId: string = 'GigaFlair',
    seqNum: number = 0
): string {
    const msg = `17${getSipTimestamp()}AO${sanitizeSipField(institutionId)}|AB${sanitizeSipField(itemBarcode)}|`;
    return appendChecksum(msg, seqNum);
}

/**
 * Command 29: Renew
 * 29{scRenewalPolicy:1}{noBlock:1}{transactionDate:18}{nbDueDate:18}AO{instId}|AA{patron}|AB{item}|[AD{pin}|]
 *
 * patronPin: optional PIN — required by some ILS in strict self-service mode
 */
export function formatRenewRequest(
    patronBarcode: string,
    itemBarcode: string,
    institutionId: string = 'GigaFlair',
    seqNum: number = 0,
    patronPin?: string
): string {
    const timestamp = getSipTimestamp();
    const nbDueDate = ''.padEnd(18, ' ');
    let msg = `29YN${timestamp}${nbDueDate}AO${sanitizeSipField(institutionId)}|AA${sanitizeSipField(patronBarcode)}|AB${sanitizeSipField(itemBarcode)}|`;
    if (patronPin) msg += `AD${sanitizeSipField(patronPin)}|`;
    return appendChecksum(msg, seqNum);
}

/**
 * Command 37: Fee Paid
 * 37{transactionDate:18}{feeType:2}{paymentType:2}{currencyType:3}AO{instId}|AA{patron}|BK{feeId}|BV{amount}|[BH{currency}|]
 *
 * feeType:     01=other, 02=admin, 03=damage, 04=overdue, 05=processing,
 *              06=rental, 07=replacement, 08=computer access, 09=hold fee
 * paymentType: 00=cash, 01=VISA, 02=credit card
 * currencyType: ISO 4217 (USD, GBP, EUR, ...)
 */
export function formatFeePaidRequest(
    patronBarcode: string,
    feeId: string,
    amount: string,
    institutionId: string = 'GigaFlair',
    seqNum: number = 0,
    feeType: string = '01',
    paymentType: string = '00',
    currencyType: string = 'USD'
): string {
    const safeCurrency = sanitizeSipField(currencyType).substring(0, 3).padEnd(3, ' ');
    const msg = `37${getSipTimestamp()}${feeType.padEnd(2).substring(0, 2)}${paymentType.padEnd(2).substring(0, 2)}${safeCurrency}AO${sanitizeSipField(institutionId)}|AA${sanitizeSipField(patronBarcode)}|BK${sanitizeSipField(feeId)}|BV${sanitizeSipField(amount)}|BH${safeCurrency.trim()}|`;
    return appendChecksum(msg, seqNum);
}

/**
 * Command 63: Patron Information
 * 63{language:3}{transactionDate:18}{summary:10}AO{instId}|AA{patron}|BP{startItem:4}|BQ{endItem:4}|
 *
 * summary flags (10 chars): each position is 'Y' to request that item list, ' ' otherwise.
 *   [0]=holds [1]=overdue [2]=charged [3]=fines [4]=recall [5-9]=reserved
 * language: 3-digit code — '001'=English, '011'=French, '021'=German, etc.
 */
export function formatPatronInformationRequest(
    patronBarcode: string,
    summary: { holds?: boolean; overdue?: boolean; charged?: boolean; fines?: boolean; recall?: boolean } = {},
    startItem: number = 1,
    endItem: number = 5,
    institutionId: string = 'GigaFlair',
    seqNum: number = 0,
    language: string = '001'
): string {
    const f = (b?: boolean) => (b === true ? 'Y' : ' ');
    const summaryFlags = `${f(summary.holds)}${f(summary.overdue)}${f(summary.charged)}${f(summary.fines)}${f(summary.recall)}     `;
    const start = String(startItem).padStart(4, '0');
    const end = String(endItem).padStart(4, '0');
    const msg = `63${language.substring(0, 3)}${getSipTimestamp()}${summaryFlags}AO${sanitizeSipField(institutionId)}|AA${sanitizeSipField(patronBarcode)}|BP${start}|BQ${end}|`;
    return appendChecksum(msg, seqNum);
}

/**
 * Command 15: Hold
 * 15{holdMode:1}{transactionDate:18}[BW{expiryDate}|]AO{instId}|AA{patron}|[AB{item}|][BT{title}|][BS{pickup}|]AC|
 *
 * holdMode: '+' = add hold, '-' = delete hold, '*' = change hold
 * itemBarcode: use AB for a specific copy hold
 * titleId: use BT for a best-copy hold (ILS chooses available copy)
 */
export function formatHoldRequest(
    holdMode: '+' | '-' | '*',
    patronBarcode: string,
    itemBarcode?: string,
    expiryDate?: string,
    pickupLocation?: string,
    institutionId: string = 'GigaFlair',
    seqNum: number = 0,
    titleId?: string
): string {
    const timestamp = getSipTimestamp();
    let msg = `15${holdMode}${timestamp}`;
    if (expiryDate) msg += `BW${sanitizeSipField(expiryDate)}|`;
    msg += `AO${sanitizeSipField(institutionId)}|AA${sanitizeSipField(patronBarcode)}|`;
    if (itemBarcode) msg += `AB${sanitizeSipField(itemBarcode)}|`;
    if (titleId) msg += `BT${sanitizeSipField(titleId)}|`;
    if (pickupLocation) msg += `BS${sanitizeSipField(pickupLocation)}|`;
    msg += 'AC|';
    return appendChecksum(msg, seqNum);
}

/**
 * Command 65: Renew All
 * 65{transactionDate:18}{nbDueDate:18}AO{instId}|AA{patron}|AC|
 */
export function formatRenewAllRequest(
    patronBarcode: string,
    institutionId: string = 'GigaFlair',
    seqNum: number = 0
): string {
    const timestamp = getSipTimestamp();
    const msg = `65${timestamp}${timestamp}AO${sanitizeSipField(institutionId)}|AA${sanitizeSipField(patronBarcode)}|AC|`;
    return appendChecksum(msg, seqNum);
}

/**
 * Command 35: End Patron Session
 * 35{transactionDate:18}AO{instId}|AA{patron}|AC|
 */
export function formatEndSessionRequest(
    patronBarcode: string,
    institutionId: string = 'GigaFlair',
    seqNum: number = 0
): string {
    const msg = `35${getSipTimestamp()}AO${sanitizeSipField(institutionId)}|AA${sanitizeSipField(patronBarcode)}|AC|`;
    return appendChecksum(msg, seqNum);
}

/**
 * Command 99: SC Status
 * 99{statusCode:1}{maxPrintWidth:3}{protocolVersion:4}
 *
 * statusCode:    0 = SC OK, 1 = printer unavailable, 2 = shutting down
 * maxPrintWidth: typically '080'
 * protocolVersion: '2.00'
 */
export function formatSCStatusRequest(seqNum: number = 0): string {
    const msg = `9900802.00`;
    return appendChecksum(msg, seqNum);
}

/**
 * Command 01: Block Patron
 * 01{cardRetained:1}{transactionDate:18}AO{instId}|AA{patron}|AC{pw}|AL{message}|
 *
 * No SIP2 response is issued for this command — the ILS acts asynchronously.
 * cardRetained: 'Y' if the self-service terminal physically retained the card, 'N' otherwise.
 */
export function formatBlockPatronRequest(
    patronBarcode: string,
    cardRetained: boolean = false,
    blockedCardMessage: string = '',
    institutionId: string = 'GigaFlair',
    seqNum: number = 0
): string {
    const retained = cardRetained ? 'Y' : 'N';
    const msg = `01${retained}${getSipTimestamp()}AO${sanitizeSipField(institutionId)}|AA${sanitizeSipField(patronBarcode)}|AC|AL${sanitizeSipField(blockedCardMessage)}|`;
    return appendChecksum(msg, seqNum);
}

/**
 * Command 19: Item Status Update
 * 19{securityMarker:1}{transactionDate:18}AO{instId}|AB{item}|
 *
 * securityMarker: '0'=other, '1'=none, '2'=tattle-tape (3M), '3'=whisper tape (Checkpoint)
 * Use this to reconcile physical gate state with the ILS when checkout/checkin already failed.
 */
export function formatItemStatusUpdateRequest(
    itemBarcode: string,
    securityMarker: '0' | '1' | '2' | '3' = '2',
    institutionId: string = 'GigaFlair',
    seqNum: number = 0
): string {
    const msg = `19${securityMarker}${getSipTimestamp()}AO${sanitizeSipField(institutionId)}|AB${sanitizeSipField(itemBarcode)}|`;
    return appendChecksum(msg, seqNum);
}

/**
 * Command 25: Patron Enable
 * 25{transactionDate:18}AO{instId}|AA{patron}|AC{pw}|[AD{pin}|]
 *
 * Re-enables a patron that was blocked by a Block Patron (01) command.
 * patronPin: optional — include to require PIN verification before enabling.
 */
export function formatPatronEnableRequest(
    patronBarcode: string,
    patronPin?: string,
    institutionId: string = 'GigaFlair',
    seqNum: number = 0
): string {
    let msg = `25${getSipTimestamp()}AO${sanitizeSipField(institutionId)}|AA${sanitizeSipField(patronBarcode)}|AC|`;
    if (patronPin) msg += `AD${sanitizeSipField(patronPin)}|`;
    return appendChecksum(msg, seqNum);
}
