import crypto from 'node:crypto';

export interface EncryptedPayload {
    iv: string;       // 12-byte nonce, hex
    content: string;  // encrypted text, hex
    tag: string;      // 16-byte auth tag, hex
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * Derives a 32-byte key from any string using SHA-256.
 */
function deriveKey(masterKey: string): Buffer {
    return crypto.createHash('sha256').update(masterKey).digest();
}

/**
 * Encrypts text using aes-256-gcm with a master key.
 */
export function encrypt(text: string, masterKey: string): EncryptedPayload {
    const key = deriveKey(masterKey);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag().toString('hex');

    return {
        iv: iv.toString('hex'),
        content: encrypted,
        tag: tag
    };
}

/**
 * Decrypts an EncryptedPayload using aes-256-gcm with a master key.
 * Throws an error if the auth tag is invalid or if the key is wrong.
 */
export function decrypt(payload: EncryptedPayload, masterKey: string): string {
    const key = deriveKey(masterKey);
    const iv = Buffer.from(payload.iv, 'hex');
    const tag = Buffer.from(payload.tag, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

    decipher.setAuthTag(tag);

    let decrypted = decipher.update(payload.content, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}
