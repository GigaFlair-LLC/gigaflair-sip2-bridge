import { describe, it, expect } from 'vitest';
import { calculateChecksum, appendChecksum, verifyChecksum } from '../src/utils/checksum.js';

describe('SIP2 Checksum Unit Test', () => {
    it('should correctly calculate 4-digit hex checksum for a standard message', () => {
        // Standard SIP2 message structure: {data}AY{seq}AZ{checksum}
        // Known good checksum calculated independently (prevents self-verifying tautologies)
        const msgPart = "9300CNadmin|COpassword|CPMainLib|AY0AZ";
        const checksum = calculateChecksum(msgPart);

        expect(checksum).toBe('F28D');

        // Verify using the full utility against the hardcoded string
        const fullMsg = "9300CNadmin|COpassword|CPMainLib|AY0AZF28D\r";
        expect(verifyChecksum(fullMsg)).toBe(true);
    });

    it('should detect checksum corruption', () => {
        // Known good message
        const original = "9300CNadmin|COpassword|CPMainLib|AY0AZF28D\r";
        // Change one character in the data part, keeping the checksum the same
        const corrupted = "9300CNadmin|COPassword|CPMainLib|AY0AZF28D\r";
        expect(verifyChecksum(corrupted)).toBe(false);
    });

    it('should detect an invalid checksum tag', () => {
        const validMsg = appendChecksum("2300120260221    120000AOInstitution|AA123|AC|", 1);
        const invalidMsg = validMsg.replace('AZ', 'AX'); // Break the tag
        expect(verifyChecksum(invalidMsg)).toBe(false);
    });

    it('should append a 4-digit hex checksum with sequence number', () => {
        const msg = "2300120260221    120000AOInstitution|AA123|AC|";
        const result = appendChecksum(msg, 5);
        expect(result).toMatch(/AY5AZ[0-9A-F]{4}\r$/);
    });
});
