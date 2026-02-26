import { describe, it, expect } from 'vitest';
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
    parsePatronEnableResponse,
    parseFields,
    parseFieldsMulti,
    parseExtensions,
} from '../src/utils/sip-parser.js';

// ── Fixture strings ──────────────────────────────────────────────────────────
const DATE = '20260222    120000';

const PATRON_STATUS_RAW = `24              001${DATE}AOMainLib|AASoph12345|AEJane Smith|BZ0002|CA0001|BLY|AY3AZ1234\r`;
const CHECKOUT_RAW = `121Y  ${DATE}                  AOMainLib|AAP12345|ABI98765|AJTest Book|AH20260315    000000|AY1AZ5678\r`;
const CHECKIN_RAW = `101YNN${DATE}AOMainLib|ABI98765|AJTest Book|AY2AZABCD\r`;

// Item Information (18): cmd + circulationStatus(2) + securityMarker(2) + feeType(2) + date(18) + variable
const ITEM_INFO_RAW = `18010100${DATE}AOTest|ABITEM123|AJSome Title|CK808.8 TST|AY0AZ1234\r`;

// Fee Paid (38): cmd + ok(1) + date(18) + variable
const FEE_PAID_RAW = `381${DATE}AOTest|AAP12345|BKtxn-99|AY0AZ1234\r`;

// Patron Information (64): cmd + statusMask(14) + lang(3) + date(18) + counts(24) + variable
const PATRON_INFO_RAW = `64              001${DATE}0002000100030000000000000001AOTest|AAP12345|AEJane Smith|BLY|ATHOLD001|AVITEM001|AVITEM002|AY0AZ1234\r`;

// Hold (16): cmd + ok(1) + available(1) + date(18) + variable
const HOLD_RAW = `161Y${DATE}AOTest|AAP12345|ABITEM456|AJHeld Book|BW20261231|BSMAIN|AY0AZ1234\r`;

// Renew All (66): cmd + ok(1) + renewedCount(4) + unrenewedCount(4) + date(18) + variable
const RENEW_ALL_RAW = `6610002000${DATE}AOTest|AAP12345|BMITEM001|BMITEM002|BNITEM003|BNITEM004|AY0AZ1234\r`;

// End Session (36): cmd + endSession(1) + date(18) + variable
const END_SESSION_RAW = `36Y${DATE}AOTest|AAP12345|AFSession ended.|AY0AZ1234\r`;

// ACS Status (98): cmd + flags(6) + timeout(3) + retries(3) + date(18) + protocol(4) + variable
const ACS_STATUS_RAW = `98YYYYYY030003${DATE}2.00AOTest|AMMock Library|BX  YYYYYYYY  YY  |ANTerminal1|AY0AZ1234\r`;

// Item Status Update (20): cmd + securityMarker(1) + date(18) + variable
const ITEM_UPDATE_RAW = `202${DATE}AOTest|ABITEM123|AJSafe Book|AY0AZ1234\r`;

// Patron Enable (26): same layout as patron status (24) but cmd 26
const PATRON_ENABLE_RAW = `26              001${DATE}AOTest|AAP12345|AEJane Smith|BZ0001|AU0000|CD0000|AS0000|BLY|AY0AZ1234\r`;

// Vendor-extension fixtures
const MULTI_AF_RAW = `24              001${DATE}AOTest|AAP12345|AEJane|BZ0000|AU0000|CD0000|AS0000|BLY|AFFirst msg|AFSecond msg|AY0AZ1234\r`;
const VENDOR_EXT_RAW = `24              001${DATE}AOTest|AAP12345|AEJane|BZ0000|AU0000|CD0000|AS0000|BLY|XAfoo|XBbar|AY0AZ1234\r`;

describe('SIP2 Parser Fixture Tests', () => {
    describe('parsePatronStatusResponse', () => {
        it('extracts patron barcode from AA field', () => {
            expect(parsePatronStatusResponse(PATRON_STATUS_RAW).patronBarcode).toBe('Soph12345');
        });
        it('extracts patron name from AE field', () => {
            expect(parsePatronStatusResponse(PATRON_STATUS_RAW).patronName).toBe('Jane Smith');
        });
        it('reads validPatron from BL field', () => {
            expect(parsePatronStatusResponse(PATRON_STATUS_RAW).validPatron).toBe(true);
        });
        it('reads holdItemsCount from BZ field', () => {
            expect(parsePatronStatusResponse(PATRON_STATUS_RAW).holdItemsCount).toBe(2);
        });
        it('reads overdueItemsCount from CA field', () => {
            expect(parsePatronStatusResponse(PATRON_STATUS_RAW).overdueItemsCount).toBe(1);
        });
        it('reads chargedItemsCount from CB field (if present)', () => {
            // PATRON_STATUS_RAW doesn't have CB, so should be 0
            expect(parsePatronStatusResponse(PATRON_STATUS_RAW).chargedItemsCount).toBe(0);
        });
        it('reads status flags correctly from mask', () => {
            const { flags } = parsePatronStatusResponse(PATRON_STATUS_RAW);
            expect(flags.chargePrivilegesDenied).toBe(false);
            expect(flags.cardReportedLost).toBe(false);
        });
        it('populates screenMessages array for AF fields', () => {
            const { screenMessages } = parsePatronStatusResponse(MULTI_AF_RAW);
            expect(screenMessages).toEqual(['First msg', 'Second msg']);
        });
        it('populates extensions for non-standard tags', () => {
            const { extensions } = parsePatronStatusResponse(VENDOR_EXT_RAW);
            expect(extensions).toMatchObject({ XA: 'foo', XB: 'bar' });
        });
        it('returns undefined extensions when no non-standard tags present', () => {
            expect(parsePatronStatusResponse(PATRON_STATUS_RAW).extensions).toBeUndefined();
        });
    });

    describe('parseCheckoutResponse', () => {
        it('ok is true when char[2] is 1', () => {
            expect(parseCheckoutResponse(CHECKOUT_RAW).ok).toBe(true);
        });
        it('item barcode extracted from AB field', () => {
            expect(parseCheckoutResponse(CHECKOUT_RAW).itemBarcode).toBe('I98765');
        });
        it('due date extracted from AH field', () => {
            expect(parseCheckoutResponse(CHECKOUT_RAW).dueDate).toBe('20260315    000000');
        });
    });

    describe('parseCheckinResponse', () => {
        it('ok is true when char[2] is 1', () => {
            expect(parseCheckinResponse(CHECKIN_RAW).ok).toBe(true);
        });
        it('item barcode extracted from AB field', () => {
            expect(parseCheckinResponse(CHECKIN_RAW).itemBarcode).toBe('I98765');
        });
        it('reads alert flag from char[5]', () => {
            // CHECKIN_RAW has 'N' at position 5 → no alert
            expect(parseCheckinResponse(CHECKIN_RAW).alert).toBe(false);
        });
        it('reads magneticMedia from char[4]', () => {
            expect(parseCheckinResponse(CHECKIN_RAW).magneticMedia).toBe(false);
        });
    });

    describe('parseItemInformationResponse', () => {
        it('reads circulationStatus from chars [2:4]', () => {
            expect(parseItemInformationResponse(ITEM_INFO_RAW).circulationStatus).toBe('01');
        });
        it('reads securityMarker from chars [4:6]', () => {
            expect(parseItemInformationResponse(ITEM_INFO_RAW).securityMarker).toBe('01');
        });
        it('reads feeType from chars [6:8]', () => {
            expect(parseItemInformationResponse(ITEM_INFO_RAW).feeType).toBe('00');
        });
        it('extracts itemBarcode from AB field', () => {
            expect(parseItemInformationResponse(ITEM_INFO_RAW).itemBarcode).toBe('ITEM123');
        });
        it('extracts titleId from AJ field', () => {
            expect(parseItemInformationResponse(ITEM_INFO_RAW).titleId).toBe('Some Title');
        });
        it('extracts callNumber from CK field', () => {
            expect(parseItemInformationResponse(ITEM_INFO_RAW).callNumber).toBe('808.8 TST');
        });
    });

    describe('parseFeePaidResponse', () => {
        it('ok is true when char[2] is 1', () => {
            expect(parseFeePaidResponse(FEE_PAID_RAW).ok).toBe(true);
        });
        it('extracts patronBarcode from AA field', () => {
            expect(parseFeePaidResponse(FEE_PAID_RAW).patronBarcode).toBe('P12345');
        });
        it('extracts transactionId from BK field', () => {
            expect(parseFeePaidResponse(FEE_PAID_RAW).transactionId).toBe('txn-99');
        });
        it('extracts transactionDate at chars [3:21]', () => {
            expect(parseFeePaidResponse(FEE_PAID_RAW).transactionDate).toBe(DATE.trim());
        });
    });

    describe('parsePatronInformationResponse', () => {
        it('reads holdItemsCount from chars [37:41]', () => {
            expect(parsePatronInformationResponse(PATRON_INFO_RAW).holdItemsCount).toBe(2);
        });
        it('reads overdueItemsCount from chars [41:45]', () => {
            expect(parsePatronInformationResponse(PATRON_INFO_RAW).overdueItemsCount).toBe(1);
        });
        it('reads chargedItemsCount from chars [45:49]', () => {
            expect(parsePatronInformationResponse(PATRON_INFO_RAW).chargedItemsCount).toBe(3);
        });
        it('reads unavailHoldsCount from chars [57:61]', () => {
            expect(parsePatronInformationResponse(PATRON_INFO_RAW).unavailHoldsCount).toBe(0);
        });
        it('extracts patronName from AE field', () => {
            expect(parsePatronInformationResponse(PATRON_INFO_RAW).patronName).toBe('Jane Smith');
        });
        it('populates chargedItems list from AV fields', () => {
            const { chargedItems } = parsePatronInformationResponse(PATRON_INFO_RAW);
            expect(chargedItems).toEqual(['ITEM001', 'ITEM002']);
        });
        it('populates holdItems list from AT fields', () => {
            const { holdItems } = parsePatronInformationResponse(PATRON_INFO_RAW);
            expect(holdItems).toEqual(['HOLD001']);
        });
    });

    describe('parseHoldResponse', () => {
        it('ok is true when char[2] is 1', () => {
            expect(parseHoldResponse(HOLD_RAW).ok).toBe(true);
        });
        it('available is true when char[3] is Y', () => {
            expect(parseHoldResponse(HOLD_RAW).available).toBe(true);
        });
        it('extracts itemBarcode from AB field', () => {
            expect(parseHoldResponse(HOLD_RAW).itemBarcode).toBe('ITEM456');
        });
        it('extracts titleId from AJ field', () => {
            expect(parseHoldResponse(HOLD_RAW).titleId).toBe('Held Book');
        });
        it('extracts expirationDate from BW field', () => {
            expect(parseHoldResponse(HOLD_RAW).expirationDate).toBe('20261231');
        });
        it('extracts pickupLocation from BS field', () => {
            expect(parseHoldResponse(HOLD_RAW).pickupLocation).toBe('MAIN');
        });
    });

    describe('parseRenewAllResponse', () => {
        it('ok is true when char[2] is 1', () => {
            expect(parseRenewAllResponse(RENEW_ALL_RAW).ok).toBe(true);
        });
        it('reads renewedCount from chars [3:7]', () => {
            expect(parseRenewAllResponse(RENEW_ALL_RAW).renewedCount).toBe(2);
        });
        it('reads unrenewedCount from chars [7:11]', () => {
            expect(parseRenewAllResponse(RENEW_ALL_RAW).unrenewedCount).toBe(2);
        });
        it('populates renewedItems from BM fields', () => {
            const { renewedItems } = parseRenewAllResponse(RENEW_ALL_RAW);
            expect(renewedItems).toEqual(['ITEM001', 'ITEM002']);
        });
        it('populates unrenewedItems from BN fields', () => {
            const { unrenewedItems } = parseRenewAllResponse(RENEW_ALL_RAW);
            expect(unrenewedItems).toEqual(['ITEM003', 'ITEM004']);
        });
    });

    describe('parseEndSessionResponse', () => {
        it('endSession is true when char[2] is Y', () => {
            expect(parseEndSessionResponse(END_SESSION_RAW).endSession).toBe(true);
        });
        it('extracts transactionDate at chars [3:21]', () => {
            expect(parseEndSessionResponse(END_SESSION_RAW).transactionDate.trim()).toBe(DATE.trim());
        });
        it('extracts patronBarcode from AA field', () => {
            expect(parseEndSessionResponse(END_SESSION_RAW).patronBarcode).toBe('P12345');
        });
        it('extracts screenMessage from AF field', () => {
            expect(parseEndSessionResponse(END_SESSION_RAW).screenMessage).toBe('Session ended.');
        });
    });

    describe('parseACSStatusResponse', () => {
        it('reads onlineStatus from char[2]', () => {
            expect(parseACSStatusResponse(ACS_STATUS_RAW).onlineStatus).toBe(true);
        });
        it('reads checkinOk from char[3]', () => {
            expect(parseACSStatusResponse(ACS_STATUS_RAW).checkinOk).toBe(true);
        });
        it('reads checkoutOk from char[4]', () => {
            expect(parseACSStatusResponse(ACS_STATUS_RAW).checkoutOk).toBe(true);
        });
        it('reads timeoutPeriod from chars [8:11]', () => {
            expect(parseACSStatusResponse(ACS_STATUS_RAW).timeoutPeriod).toBe(30);
        });
        it('reads retriesAllowed from chars [11:14]', () => {
            expect(parseACSStatusResponse(ACS_STATUS_RAW).retriesAllowed).toBe(3);
        });
        it('reads protocolVersion from chars [32:36]', () => {
            expect(parseACSStatusResponse(ACS_STATUS_RAW).protocolVersion).toBe('2.00');
        });
        it('extracts libraryName from AM field', () => {
            expect(parseACSStatusResponse(ACS_STATUS_RAW).libraryName).toBe('Mock Library');
        });
        it('extracts terminalLocation from AN field', () => {
            expect(parseACSStatusResponse(ACS_STATUS_RAW).terminalLocation).toBe('Terminal1');
        });
    });

    describe('parseItemStatusUpdateResponse', () => {
        it('reads securityMarker from char[2]', () => {
            expect(parseItemStatusUpdateResponse(ITEM_UPDATE_RAW).securityMarker).toBe('2');
        });
        it('extracts itemBarcode from AB field', () => {
            expect(parseItemStatusUpdateResponse(ITEM_UPDATE_RAW).itemBarcode).toBe('ITEM123');
        });
        it('extracts titleId from AJ field', () => {
            expect(parseItemStatusUpdateResponse(ITEM_UPDATE_RAW).titleId).toBe('Safe Book');
        });
        it('extracts transactionDate at chars [3:21]', () => {
            expect(parseItemStatusUpdateResponse(ITEM_UPDATE_RAW).transactionDate.trim()).toBe(DATE.trim());
        });
    });

    describe('parsePatronEnableResponse', () => {
        it('extracts patronBarcode from AA field', () => {
            expect(parsePatronEnableResponse(PATRON_ENABLE_RAW).patronBarcode).toBe('P12345');
        });
        it('extracts patronName from AE field', () => {
            expect(parsePatronEnableResponse(PATRON_ENABLE_RAW).patronName).toBe('Jane Smith');
        });
        it('reads validPatron from BL field', () => {
            expect(parsePatronEnableResponse(PATRON_ENABLE_RAW).validPatron).toBe(true);
        });
        it('reads holdItemsCount from BZ field', () => {
            expect(parsePatronEnableResponse(PATRON_ENABLE_RAW).holdItemsCount).toBe(1);
        });
        it('status flags all false when mask is spaces', () => {
            const { flags } = parsePatronEnableResponse(PATRON_ENABLE_RAW);
            expect(flags.chargePrivilegesDenied).toBe(false);
            expect(flags.cardReportedLost).toBe(false);
        });
    });

    describe('parseExtensions', () => {
        it('returns undefined when all tags are known', () => {
            const knownTags = new Set(['AO', 'AA', 'AE', 'BL', 'BZ', 'CA', 'CB', 'AU', 'CD', 'AS', 'AF', 'AG', 'AY', 'AZ']);
            expect(parseExtensions(PATRON_STATUS_RAW, knownTags)).toBeUndefined();
        });
        it('captures XA/XB Symphony extension tags', () => {
            const knownTags = new Set(['AO', 'AA', 'AE', 'BL', 'BZ', 'CA', 'CB', 'AU', 'CD', 'AS', 'AF', 'AG', 'AY', 'AZ']);
            const ext = parseExtensions(VENDOR_EXT_RAW, knownTags);
            expect(ext).toMatchObject({ XA: 'foo', XB: 'bar' });
        });
    });

    describe('parseFieldsMulti', () => {
        it('collects multiple AF screen messages into an array', () => {
            const multi = parseFieldsMulti(MULTI_AF_RAW);
            expect(multi['AF']).toEqual(['First msg', 'Second msg']);
        });
        it('collects multiple AV (charged) items', () => {
            const multi = parseFieldsMulti(PATRON_INFO_RAW);
            expect(multi['AV']).toEqual(['ITEM001', 'ITEM002']);
        });
    });

    describe('parseFields Edge Cases', () => {
        it('handles multiple tags in the fixed header (before first pipe)', () => {
            const raw = `24              001${DATE}AOMainLib|AA12345|AEJane Smith|AY0AZ1234\r`;
            const fields = parseFields(raw);
            expect(fields['AO']).toBe('MainLib');
            expect(fields['AA']).toBe('12345');
            expect(fields['AE']).toBe('Jane Smith');
        });
        it('does not crash on minimal input', () => {
            expect(() => parseFields('')).not.toThrow();
            expect(() => parseFields('24')).not.toThrow();
        });
    });
});

