import net from 'node:net';

/**
 * Probes a TCP port to see if it is reachable.
 * Returns true if connection is successful, false otherwise.
 */
export async function tcpProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const socket = new net.Socket();
        let settled = false;

        const cleanup = () => {
            if (!socket.destroyed) {
                socket.destroy();
            }
        };

        socket.setTimeout(timeoutMs);

        socket.on('connect', () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(true);
        });

        socket.on('timeout', () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(false);
        });

        socket.on('error', () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(false);
        });

        socket.connect(port, host);
    });
}
