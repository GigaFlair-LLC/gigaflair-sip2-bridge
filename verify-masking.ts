import { MaskingService } from './src/services/MaskingService.js';

// Synthetic test data — not real credentials
const testPayload = {
    action: 'Login',
    branchId: 'main',
    sipUser: 'admin',
    sipPassword: 'verysecretpassword',
    patronPin: '1234',
    request: {
        patronBarcode: 'P12345678',
        itemBarcode: 'I00010002',
        password: 'patron_password',
        unrelated: 'keep_this'
    },
    sip2Raw: '6300020260224    064010AOMain|AAP12345678|AD1234|'
};

console.log('--- Original Payload ---');
console.log(JSON.stringify(testPayload, null, 2));

console.log('\n--- Masked Payload ---');
const masked = MaskingService.maskPayload(testPayload);
console.log(JSON.stringify(masked, null, 2));

// Sanity Checks
console.log('\n--- Verification ---');
const passMasked = masked.sipPassword === '********';
const pinMasked = masked.patronPin === '********';
const reqPassMasked = masked.request.password === '********';
const barcodeMasked = masked.request.patronBarcode.startsWith('MASKED_');
const deepCheck = masked.request.unrelated === 'keep_this';

console.log(`SIP Password Masked: ${passMasked}`);
console.log(`Patron PIN Masked: ${pinMasked}`);
console.log(`Request Password Masked: ${reqPassMasked}`);
console.log(`Patron Barcode Masked: ${barcodeMasked}`);
console.log(`Deep Object Scan (unrelated field preserved): ${deepCheck}`);

if (passMasked && pinMasked && reqPassMasked && barcodeMasked && deepCheck) {
    console.log('\n✅ Data Masking Verification PASSED');
} else {
    console.log('\n❌ Data Masking Verification FAILED');
    process.exit(1);
}
