import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { createReadStream } from 'node:fs';
import { MaskingService } from '../services/MaskingService.js';
import { Logger } from '../types/index.js';
import { logToDashboard } from './events.js';

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export class NativeLogger implements Logger {
    private logFilePath: string;
    private writeQueue: string[] = [];
    private isWriting = false;

    constructor(logFilePath: string) {
        this.logFilePath = logFilePath;
        this.ensureDir();
    }

    private async ensureDir(): Promise<void> {
        const dir = path.dirname(this.logFilePath);
        try {
            await fs.mkdir(dir, { recursive: true });
        } catch (err) {
            console.error(`Failed to create log directory: ${dir}`, err);
        }
    }

    /**
     * Extracts a device identifier from the request or payload.
     * Checks payload for deviceId/terminalId first, then falls back to headers/IP.
     */
    public extractDeviceId(req: unknown, payload?: Record<string, unknown>): string {
        if (payload) {
            if (payload.deviceId) return String(payload.deviceId);
            if (payload.terminalId) return String(payload.terminalId);
        }

        if (req && typeof req === 'object') {
            const r = req as Record<string, unknown>;
            const body = r.body as Record<string, unknown> | undefined;
            if (body && body.deviceId) return String(body.deviceId);
            if (body && body.terminalId) return String(body.terminalId);
            const headers = r.headers as Record<string, unknown> | undefined;
            if (headers && headers['x-forwarded-for']) {
                const forwarded = headers['x-forwarded-for'];
                return Array.isArray(forwarded) ? forwarded[0] : String(forwarded).split(',')[0].trim();
            }
            if (r.ip) return String(r.ip);
            const socket = r.socket as Record<string, unknown> | undefined;
            if (socket && socket.remoteAddress) return String(socket.remoteAddress);
        }

        return 'UNKNOWN_DEVICE';
    }

    /**
     * Internal async writer that processes the queue sequentially to avoid file locking issues
     * without blocking the main event thread.
     */
    private async processWriteQueue(): Promise<void> {
        if (this.isWriting || this.writeQueue.length === 0) return;
        this.isWriting = true;

        const entriesToWrite = [...this.writeQueue];
        this.writeQueue = []; // Clear queue for incoming logs

        try {
            const data = entriesToWrite.join('\n') + '\n';
            await fs.appendFile(this.logFilePath, data, 'utf8');
        } catch (err) {
            console.error('Failed to write to log file:', err);
            // On failure, re-queue the items at the beginning
            this.writeQueue.unshift(...entriesToWrite);
        } finally {
            this.isWriting = false;
            // Process any new items added while writing
            if (this.writeQueue.length > 0) {
                setImmediate(() => this.processWriteQueue());
            }
        }
    }

    private log(level: LogLevel, deviceId: string | null, msg: string, ...args: unknown[]): void {
        const timestamp = new Date().toISOString();
        const prefix = deviceId ? `[${deviceId}]` : '[SYSTEM]';

        // Use MaskingService to sanitize any object arguments
        const sanitizedArgs = args.map(arg => {
            if (arg === null || arg === undefined) return '';
            if (typeof arg === 'object') {
                return JSON.stringify(MaskingService.maskPayload(arg));
            }
            return String(arg);
        });

        const argString = sanitizedArgs.length > 0 ? ` ${sanitizedArgs.join(' ')}` : '';
        const logEntry = `${timestamp} - ${level} - ${prefix} ${msg}${argString}`;

        // Also pipe to dashbord
        // Also pipe to dashboard (map debug -> info since dashboard only supports info/warn/error)
        const dashLevel = level === 'DEBUG' ? 'info' : level.toLowerCase() as 'info' | 'warn' | 'error';
        logToDashboard(dashLevel, msg, sanitizedArgs.length > 0 ? { args: sanitizedArgs } : undefined);

        // Also pipe to standard out, but use console correctly
        switch (level) {
            case 'INFO': console.log(logEntry); break;
            case 'WARN': console.warn(logEntry); break;
            case 'ERROR': console.error(logEntry); break;
            case 'DEBUG': console.debug(logEntry); break;
        }

        // Add to file writing queue
        this.writeQueue.push(logEntry);
        setImmediate(() => this.processWriteQueue());
    }

    public info(msg: string, ...args: unknown[]): void {
        this.log('INFO', null, msg, ...args);
    }

    public warn(msg: string, ...args: unknown[]): void {
        this.log('WARN', null, msg, ...args);
    }

    public error(msg: string, ...args: unknown[]): void {
        this.log('ERROR', null, msg, ...args);
    }

    public debug(msg: string, ...args: unknown[]): void {
        this.log('DEBUG', null, msg, ...args);
    }

    /**
     * For request-scoped logging where deviceId is strictly prepended
     */
    public reqInfo(req: unknown, payload: Record<string, unknown> | undefined, msg: string, ...args: unknown[]): void {
        const deviceId = this.extractDeviceId(req, payload);
        this.log('INFO', deviceId, msg, ...args);
    }

    public reqError(req: unknown, payload: Record<string, unknown> | undefined, msg: string, ...args: unknown[]): void {
        const deviceId = this.extractDeviceId(req, payload);
        this.log('ERROR', deviceId, msg, ...args);
    }
}

/**
 * Time-based cleanup utility for purging logs older than retention hours.
 * Uses streams to handle large files efficiently.
 */
export async function runLogCleanup(logFilePath: string, retentionHours: number): Promise<void> {
    try {
        await fs.access(logFilePath);
    } catch {
        // File doesn't exist, nothing to clean
        return;
    }

    const tmpPath = `${logFilePath}.tmp`;
    const cutoffTime = new Date(Date.now() - retentionHours * 60 * 60 * 1000).getTime();

    let writeHandle: fs.FileHandle | null = null;
    let keepCount = 0;
    let dropCount = 0;

    try {
        writeHandle = await fs.open(tmpPath, 'w');

        const fileStream = createReadStream(logFilePath, 'utf8');
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        for await (const line of rl) {
            // Log format: 2026-02-24T18:00:00.000Z - INFO - [DEVICE] msg...
            const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
            if (timestampMatch) {
                const logTime = new Date(timestampMatch[1]).getTime();
                if (logTime >= cutoffTime) {
                    await writeHandle.write(line + '\n');
                    keepCount++;
                } else {
                    dropCount++;
                }
            } else {
                // Keep lines without a standard timestamp (e.g. stack traces spread across lines)
                await writeHandle.write(line + '\n');
            }
        }

        await writeHandle.close();
        writeHandle = null;

        // Atomically replace old log with cleaned log
        await fs.rename(tmpPath, logFilePath);

        if (dropCount > 0) {
            console.log(`[SYSTEM] Log cleanup complete. Retained ${keepCount} lines, purged ${dropCount} lines older than ${retentionHours}h.`);
        }
    } catch (err) {
        console.error('Failed to run log cleanup:', err);
        if (writeHandle) {
            await writeHandle.close();
        }
    } finally {
        try {
            await fs.unlink(tmpPath);
        } catch {
            // Ignore failure to delete tmp file if it was already renamed
        }
    }
}

/**
 * Starts a background interval to periodically clean the log file.
 */
export function startLogCleanupTask(logFilePath: string, getRetentionHours: () => number, intervalHours = 1): NodeJS.Timeout {
    return setInterval(() => {
        const retention = getRetentionHours();
        runLogCleanup(logFilePath, retention).catch(err => {
            console.error('Log cleanup task failed:', err);
        });
    }, intervalHours * 60 * 60 * 1000);
}
