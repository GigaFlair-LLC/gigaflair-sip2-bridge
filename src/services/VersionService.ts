import fs from 'node:fs/promises';
import path from 'node:path';
import { ConfigService } from './ConfigService.js';
import { Logger } from '../types/index.js';

export interface VersionInfo {
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    isCritical: boolean;
    releaseUrl: string;
    error?: string;
}

export class VersionService {
    private cachedInfo: { data: VersionInfo; timestamp: number } | null = null;
    private readonly CACHE_TTL = 60 * 60 * 1000; // 1 hour for manual checks
    private pollTimeout: NodeJS.Timeout | null = null;
    private isRunning = false;
    private logger: Logger;

    constructor(logger?: Logger) {
        this.logger = logger || console;
    }

    public async start(configService: ConfigService): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;

        // Seed cache from persisted config if available
        const config = configService.getConfig();
        if (config.pendingUpdateVersion) {
            const currentVersion = process.env.BUILD_VERSION || await this.getLocalVersion();
            if (this.isNewer(currentVersion, config.pendingUpdateVersion)) {
                this.cachedInfo = {
                    data: {
                        currentVersion,
                        latestVersion: config.pendingUpdateVersion,
                        updateAvailable: true,
                        isCritical: !!config.isCriticalUpdate,
                        releaseUrl: 'https://github.com/GigaFlair/SIP2-Bridge/releases'
                    },
                    timestamp: Date.now()
                };
            }
        }

        this.scheduleNextPoll(configService);
    }

    public stop(): void {
        this.isRunning = false;
        if (this.pollTimeout) {
            clearTimeout(this.pollTimeout);
            this.pollTimeout = null;
        }
    }

    private scheduleNextPoll(configService: ConfigService): void {
        const base24h = 24 * 60 * 60 * 1000;
        const jitterRange = 30 * 60 * 1000; // 30 mins
        const jitter = (Math.random() * jitterRange * 2) - jitterRange;
        const nextTime = base24h + jitter;

        this.pollTimeout = setTimeout(() => {
            if (this.isRunning) {
                this.poll(configService).finally(() => this.scheduleNextPoll(configService));
            }
        }, nextTime);
    }

    public async getVersionInfo(): Promise<VersionInfo> {
        const now = Date.now();
        if (this.cachedInfo && (now - this.cachedInfo.timestamp < this.CACHE_TTL)) {
            return this.cachedInfo.data;
        }

        const currentVersion = process.env.BUILD_VERSION || await this.getLocalVersion();
        let latestVersion = currentVersion;
        let updateAvailable = false;
        let isCritical = false;
        let releaseUrl = 'https://github.com/GigaFlair/SIP2-Bridge/releases';
        let error: string | undefined;

        try {
            const response = await fetch('https://api.github.com/repos/GigaFlair/SIP2-Bridge/releases/latest', {
                headers: {
                    'User-Agent': 'GigaFlair-Bridge-Update-Checker',
                    'Accept': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                latestVersion = data.tag_name;
                releaseUrl = data.html_url;
                isCritical = (data.body || '').includes('[CRITICAL]');
                // Simple semver comparison (v1.0.0 vs v1.0.1)
                updateAvailable = this.isNewer(currentVersion, latestVersion);
            } else {
                error = `GitHub API error: ${response.status}`;
            }
        } catch (err: unknown) {
            error = `Network error: ${err instanceof Error ? err.message : String(err)}`;
        }

        const data: VersionInfo = {
            currentVersion,
            latestVersion,
            updateAvailable,
            isCritical,
            releaseUrl,
            error
        };

        this.cachedInfo = { data, timestamp: now };
        return data;
    }

    private async poll(configService: ConfigService): Promise<void> {
        try {
            const info = await this.getVersionInfo();
            if (info.updateAvailable) {
                await configService.updateConfig({
                    pendingUpdateVersion: info.latestVersion,
                    isCriticalUpdate: info.isCritical
                });
            } else {
                await configService.updateConfig({
                    pendingUpdateVersion: undefined,
                    isCriticalUpdate: undefined
                });
            }
        } catch (err: unknown) {
            this.logger.warn(`[VersionService] Background update check failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    private async getLocalVersion(): Promise<string> {
        try {
            const pkgPath = path.join(process.cwd(), 'package.json');
            const pkgData = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
            return `v${pkgData.version}`;
        } catch {
            return 'v0.0.0-unknown';
        }
    }

    private isNewer(current: string, latest: string): boolean {
        try {
            const c = current.replace(/^v/, '').split('.').map(Number);
            const l = latest.replace(/^v/, '').split('.').map(Number);

            for (let i = 0; i < Math.max(c.length, l.length); i++) {
                const cv = c[i] || 0;
                const lv = l[i] || 0;
                if (lv > cv) return true;
                if (lv < cv) return false;
            }
            return false;
        } catch {
            return false;
        }
    }
}
