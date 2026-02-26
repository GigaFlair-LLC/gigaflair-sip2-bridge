import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../src/utils/crypto.js';

describe('Crypto Utility', () => {
    const masterKey = 'super-secret-master-key';
    const plainText = 'my-sip2-password-123';

    it('should encrypt and decrypt correctly', () => {
        const encrypted = encrypt(plainText, masterKey);

        expect(encrypted.iv).toBeDefined();
        expect(encrypted.content).toBeDefined();
        expect(encrypted.tag).toBeDefined();
        expect(encrypted.content).not.toBe(plainText);

        const decrypted = decrypt(encrypted, masterKey);
        expect(decrypted).toBe(plainText);
    });

    it('should throw error on wrong master key', () => {
        const encrypted = encrypt(plainText, masterKey);

        expect(() => decrypt(encrypted, 'wrong-key')).toThrow();
    });

    it('should throw error on tampered content', () => {
        const encrypted = encrypt(plainText, masterKey);
        // Tamper with the ciphertext (change hex chars)
        const contentArr = encrypted.content.split('');
        contentArr[0] = contentArr[0] === '0' ? '1' : '0';
        encrypted.content = contentArr.join('');

        expect(() => decrypt(encrypted, masterKey)).toThrow();
    });

    it('should produce different IVs for same text', () => {
        const enc1 = encrypt(plainText, masterKey);
        const enc2 = encrypt(plainText, masterKey);

        expect(enc1.iv).not.toBe(enc2.iv);
        expect(enc1.content).not.toBe(enc2.content);
    });
});
