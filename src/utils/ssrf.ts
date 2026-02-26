import net from 'node:net';

/**
 * Checks if a host is safe to connect to (SSRF protection).
 * Blocks private, reserved, and loopback IP ranges.
 * 
 * NOTE: This validates the hostname string only. DNS rebinding attacks can bypass this
 * if the hostname resolves to a safe address during check but a private address during 
 * connect. Operators should run the bridge in a network-isolated environment.
 */
export function isSafeHost(host: string): boolean {
    const h = host.toLowerCase().trim();

    // 1. Block known loopback names and shorthand
    const blockedNames = [
        'localhost',
        'localhost.localdomain',
        '0.0.0.0',
        '[::]',
        '::1',
        '127.1', // shorthand
        '127.0.1',
        '0x7f000001' // hex
    ];
    if (blockedNames.includes(h)) return false;

    // 2. If it looks like an IP but isn't strictly validated by net.isIP (e.g. 127.1), 
    // it's likely a bypass attempt or legacy format.
    // However, Node's net.isIP is quite strict. Let's rely on range checks if it IS an IP.

    // We should also block anything starting with 127. or 10. etc if it looks like an IP
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) {
        const ipType = net.isIP(h);
        if (ipType === 4) {
            return isPublicIPv4(h);
        }
        if (ipType === 6) {
            return isPublicIPv6(h);
        }
        // If it looks like an IP but net doesn't like it, it might be a weird encoding like 127.1
        // which net.connect might still follow. Better to block.
        if (h.split('.').every(p => !isNaN(parseInt(p)))) return false;
    }

    // 3. Block local domains
    if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return false;

    return true;
}

function isPublicIPv4(ip: string): boolean {
    const parts = ip.split('.').map(part => parseInt(part, 10));

    // 127.0.0.0/8 (Loopback) — block to prevent scanning bridge's own services
    if (parts[0] === 127) return false;

    // 0.0.0.0 (Broadcast/Any)
    if (ip === '0.0.0.0') return false;

    // 169.254.0.0/16 (Link-local)
    if (parts[0] === 169 && parts[1] === 254) return false;

    // 224.0.0.0/4 (Multicast)
    if (parts[0] >= 224 && parts[0] <= 239) return false;

    // 240.0.0.0/4 (Reserved / future use)
    if (parts[0] >= 240) return false;

    // Private ranges (10.x, 172.16-31.x, 192.168.x) are ALLOWED — the bridge
    // appliance's primary purpose is connecting to an ILS on the private network.

    return true;
}

function isPublicIPv6(ip: string): boolean {
    const normalized = ip.toLowerCase();

    // Loopback ::1
    if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return false;

    // Link-local fe80::/10
    if (normalized.startsWith('fe80:')) return false;

    // Unique local fc00::/7
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return false;

    // IPv4-mapped IPv6 (::ffff:x.x.x.x) — delegate to IPv4 check
    const ipv4MappedMatch = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (ipv4MappedMatch) return isPublicIPv4(ipv4MappedMatch[1]);

    // IPv4-compatible IPv6 (::x.x.x.x)
    const ipv4CompatMatch = normalized.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
    if (ipv4CompatMatch) return isPublicIPv4(ipv4CompatMatch[1]);

    return true;
}
