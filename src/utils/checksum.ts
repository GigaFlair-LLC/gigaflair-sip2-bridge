/**
 * SIP2 Checksum Calculation
 * 
 * The checksum is the negative of the sum of all characters in the message,
 * modulo 0xFFFF, then formatted as 4 hex digits.
 */

export function calculateChecksum(message: string): string {
    let sum = 0;
    for (let i = 0; i < message.length; i++) {
        sum += message.charCodeAt(i);
    }

    // The negative of the sum, truncated to 16 bits
    const checksum = (-sum & 0xFFFF);

    // Return as 4-character uppercase hex
    return checksum.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Appends the standard SIP2 terminator, sequence number, and checksum.
 * Format: AY{seqNum}AZ{checksum}\r
 */
export function appendChecksum(message: string, seqNum: number = 0): string {
    if (seqNum > 9) throw new Error(`SIP2 sequence number must be 0-9 (got ${seqNum})`);
    const seqStr = seqNum.toString().substring(0, 1); // Simple 1-char sequence for now
    const partialMsg = `${message}AY${seqStr}AZ`;
    const checksum = calculateChecksum(partialMsg);
    return `${partialMsg}${checksum}\r`;
}

/**
 * Verifies if the inbound SIP2 message has a valid checksum
 */
export function verifyChecksum(message: string): boolean {
    // SIP2 messages end with AZ{checksum}\r
    const regex = /AZ([0-9A-Fa-f]{4})\r?$/;
    const match = message.match(regex);

    if (!match) return false;

    const expectedChecksum = match[1].toUpperCase();
    const matchIndex = message.length - match[0].length;
    // The message to checksum includes everything up to and including 'AZ'
    const msgWithoutChecksum = message.substring(0, matchIndex + 2);
    const actualChecksum = calculateChecksum(msgWithoutChecksum);

    return actualChecksum === expectedChecksum;
}
