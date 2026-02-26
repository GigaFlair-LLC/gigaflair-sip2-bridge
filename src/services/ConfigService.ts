import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import * as argon2 from 'argon2';
import { AppConfig, AppConfigSchema, SanitizedConfig, User, Logger } from '../types/index.js';
import { encrypt, decrypt, EncryptedPayload } from '../utils/crypto.js';

type ConfigUpdateListener = (config: AppConfig) => void;

export class ConfigService {
    private static instance: ConfigService;
    private configPath: string;
    private masterKeyPath: string;
    private config: AppConfig | null = null;
    private listeners: ConfigUpdateListener[] = [];
    private managedFields = new Set<string>();
    private logger: Logger = console;

    private constructor() {
        if (process.env.CONFIG_PATH) {
            this.configPath = process.env.CONFIG_PATH;
        } else if (process.env.NODE_ENV === 'test') {
            this.configPath = path.join(process.cwd(), 'tests', `test-config-${Math.random().toString(36).substring(7)}.json`);
        } else {
            this.configPath = path.join(process.cwd(), 'data', 'config.json');
        }
        this.masterKeyPath = path.join(path.dirname(this.configPath), '.master_key');
    }

    public static getInstance(): ConfigService {
        if (!ConfigService.instance) {
            ConfigService.instance = new ConfigService();
        }
        return ConfigService.instance;
    }

    public setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /** @internal - For testing only to prevent cross-test pollution */
    public static _resetInstance(): void {
        ConfigService.instance = undefined as unknown as ConfigService;
    }

    public async initialize(): Promise<void> {
        // -1. Handle Master Key (generate or load)
        await this.ensureMasterKey();

        // 0. Emergency Factory Reset Check
        const resetFlagPath = path.join(path.dirname(this.configPath), 'FACTORY_RESET');
        try {
            await fs.access(resetFlagPath);
            // File exists - perform reset
            this.logger.warn('EMERGENCY: Factory Reset triggered. Reverting to defaults.');
            try {
                await fs.unlink(this.configPath);
            } catch (_err) {
                // Ignore if config doesn't exist
            }
            await fs.unlink(resetFlagPath);
            // Initialize with defaults
            this.config = AppConfigSchema.parse({});
            return;
        } catch {
            // Sentinel not found - proceed normally
        }

        // 1. Start with hardcoded defaults (Zod defaults)
        let loadedConfig: Partial<AppConfig> = {};

        // 2. Load from JSON if exists
        let rawData: string | null = null;
        try {
            rawData = await fs.readFile(this.configPath, 'utf8');
        } catch (err: unknown) {
            if (err instanceof Error && (err as { code?: string }).code !== 'ENOENT') {
                this.logger.error('CRITICAL: Failed to read config file:', err.message);
            }
        }

        if (rawData) {
            let parsed: unknown = null;
            try {
                parsed = JSON.parse(rawData);
            } catch (err) {
                this.logger.error('CRITICAL: Failed to parse config.json:', err instanceof Error ? err.message : String(err));
            }

            if (parsed && typeof parsed === 'object' && parsed !== null) {
                const configObj = parsed as Record<string, unknown>;
                // INTERNAL MIGRATION: adminPasswordHash -> users[]
                if (configObj.adminPasswordHash && (!configObj.users || !Array.isArray(configObj.users) || configObj.users.length === 0)) {
                    configObj.users = [{
                        username: 'admin',
                        passwordHash: configObj.adminPasswordHash as string,
                        role: 'admin',
                        mfaEnabled: false
                    }];
                    delete configObj.adminPasswordHash;
                }

                // Internal decryption step before merging env overrides
                if (configObj.sip2Password && typeof configObj.sip2Password === 'object') {
                    const masterKey = process.env.GIGAFLAIR_MASTER_KEY;
                    if (!masterKey) {
                        this.logger.error('CRITICAL: Master Key missing. Cannot decrypt LMS credentials.');
                        process.exit(1);
                        return;
                    }
                    try {
                        configObj.sip2Password = decrypt(configObj.sip2Password as EncryptedPayload, masterKey);
                    } catch {
                        this.logger.error('CRITICAL: Failed to decrypt sip2Password. The Master Key may be incorrect.');
                        process.exit(1);
                        return;
                    }
                }

                const validated = AppConfigSchema.safeParse(configObj);
                if (validated.success) {
                    loadedConfig = { ...validated.data };
                } else {
                    this.logger.error('CRITICAL: config.json is malformed. Falling back to defaults/env.', validated.error.format());
                }
            }
        }

        // 3. Merge process.env overrides (Env always wins, _FILE wins over all)
        const envOverrides: Partial<AppConfig> = {};
        this.managedFields.clear();

        // Check for _FILE secrets first (lockdown mode)
        const sip2PassFileValue = await this.readSecretFile('SIP2_PASS_FILE');
        if (sip2PassFileValue) {
            envOverrides.sip2Password = sip2PassFileValue;
            this.managedFields.add('sip2Password');
        } else if (process.env.SIP2_PASS) {
            envOverrides.sip2Password = process.env.SIP2_PASS;
        }

        // Only load bridgeApiKey from env if apiKeyHash is not present in loaded config
        if (!loadedConfig.apiKeyHash) {
            const apiKeyFileValue = await this.readSecretFile('BRIDGE_API_KEY_FILE');
            if (apiKeyFileValue) {
                envOverrides.bridgeApiKey = apiKeyFileValue;
                this.managedFields.add('bridgeApiKey');
            } else if (process.env.BRIDGE_API_KEY) {
                envOverrides.bridgeApiKey = process.env.BRIDGE_API_KEY;
            }
        }

        // Other env overrides
        if (process.env.LMS_HOST) envOverrides.lmsHost = process.env.LMS_HOST;
        if (process.env.LMS_PORT) envOverrides.lmsPort = parseInt(process.env.LMS_PORT, 10);
        if (process.env.SIP2_USER) envOverrides.sip2User = process.env.SIP2_USER;
        if (process.env.SIP2_LOCATION) envOverrides.sip2Location = process.env.SIP2_LOCATION;
        if (process.env.INSTITUTION_ID) envOverrides.institutionId = process.env.INSTITUTION_ID;
        if (process.env.TIMEOUT_MS) envOverrides.timeoutMs = parseInt(process.env.TIMEOUT_MS, 10);
        if (process.env.PORT) envOverrides.port = parseInt(process.env.PORT, 10);
        if (process.env.HOST) envOverrides.host = process.env.HOST;

        // Final merge
        const finalConfig = AppConfigSchema.parse({
            ...loadedConfig,
            ...envOverrides
        });

        this.config = finalConfig;

        // Ensure the directory exists and initial file is saved if it didn't exist
        await this.ensureDir();
        if (!await this.fileExists(this.configPath)) {
            await this.saveConfig(this.config);
        }
    }

    public getConfig(): AppConfig {
        if (!this.config) {
            throw new Error('ConfigService not initialized. Call initialize() first.');
        }
        return this.config;
    }

    public hasUsers(): boolean {
        return (this.config?.users && this.config.users.length > 0) || false;
    }

    public getMasterKey(): string {
        const key = process.env.GIGAFLAIR_MASTER_KEY;
        if (!key) {
            throw new Error('Master Key not initialized.');
        }
        return key;
    }

    private async ensureMasterKey(): Promise<void> {
        // If env var is already provided, that takes precedence (e.g. Docker secrets)
        if (process.env.GIGAFLAIR_MASTER_KEY) {
            return;
        }

        try {
            // Check if .master_key exists
            const existing = await fs.readFile(this.masterKeyPath, 'utf8');
            if (existing && existing.trim().length > 0) {
                process.env.GIGAFLAIR_MASTER_KEY = existing.trim();
                return;
            }
        } catch (_err) {
            // ENOENT is fine, we'll generate one
        }

        // Generate new key
        const newKey = crypto.randomBytes(32).toString('hex');
        await fs.mkdir(path.dirname(this.masterKeyPath), { recursive: true });
        await fs.writeFile(this.masterKeyPath, newKey, { mode: 0o600 }); // Owner read/write only
        process.env.GIGAFLAIR_MASTER_KEY = newKey;
        this.logger.info('NOTICE: Generated new Master Key for GigaFlair Bridge.');
    }

    public getSanitizedConfig(): SanitizedConfig {
        const cfg = this.getConfig();
        // Return Omit to ensure we don't accidentally spread secrets
        const { sip2Password, bridgeApiKey, users, apiKeyHash, apiKeyPrefix, apiKeySuffix, ...rest } = cfg;

        // Calculate masked value
        let maskedValue = '********';
        if (apiKeyPrefix && apiKeySuffix) {
            maskedValue = `${apiKeyPrefix}****${apiKeySuffix}`;
        } else if (bridgeApiKey) {
            maskedValue = this.maskApiKey(bridgeApiKey);
        }

        return {
            ...rest,
            sip2Password: {
                value: '********',
                isManaged: this.managedFields.has('sip2Password'),
                isPresent: !!sip2Password
            },
            bridgeApiKey: {
                value: '********',
                maskedValue,
                isManaged: this.managedFields.has('bridgeApiKey'),
                isPresent: !!bridgeApiKey || !!apiKeyHash
            },
            users: users.map(u => {
                // Return sanitized user without passwordHash
                return {
                    username: u.username,
                    mfaEnabled: u.mfaEnabled,
                    role: u.role
                };
            })
        };
    }

    public async updateConfig(patch: Partial<AppConfig>): Promise<void> {
        const current = this.getConfig();

        // Lockdown guards
        if (patch.sip2Password !== undefined && this.managedFields.has('sip2Password')) {
            throw new Error('sip2Password is managed by a system secret and cannot be changed.');
        }
        if (patch.bridgeApiKey !== undefined && this.managedFields.has('bridgeApiKey')) {
            throw new Error('bridgeApiKey is managed by a system secret and cannot be changed.');
        }
        // If an API key hash exists, the plain key cannot be set via updateConfig
        if (patch.bridgeApiKey !== undefined && current.apiKeyHash) {
            throw new Error('An API key hash is configured; the plain bridgeApiKey cannot be set directly.');
        }
        // If an API key hash exists, the prefix/suffix cannot be set directly
        if ((patch.apiKeyPrefix !== undefined || patch.apiKeySuffix !== undefined) && current.apiKeyHash) {
            throw new Error('An API key hash is configured; apiKeyPrefix and apiKeySuffix cannot be set directly.');
        }

        const merged = { ...current, ...patch };
        const validated = AppConfigSchema.parse(merged);

        this.config = validated;
        this.logger.info(`Config updated. New timeout: ${this.config.timeoutMs}ms.`);
        await this.saveConfig(this.config);
        this.notifyListeners();
    }

    public verifyApiKey(incoming: string): boolean {
        const cfg = this.getConfig();

        // 1. Check against hash on disk (if exists)
        if (cfg.apiKeyHash) {
            const incomingHash = crypto.createHash('sha256').update(incoming).digest('hex');
            return crypto.timingSafeEqual(Buffer.from(incomingHash), Buffer.from(cfg.apiKeyHash));
        }

        // 2. Fallback to plain text key (e.g. from environment)
        if (cfg.bridgeApiKey) {
            const incomingBuf = Buffer.from(incoming);
            const actualBuf = Buffer.from(cfg.bridgeApiKey);
            if (incomingBuf.length !== actualBuf.length) return false;
            return crypto.timingSafeEqual(incomingBuf, actualBuf);
        }

        return false;
    }

    public async generateApiKey(): Promise<string> {
        if (this.managedFields.has('bridgeApiKey')) {
            throw new Error('bridgeApiKey is managed by a system secret and cannot be changed.');
        }

        const raw = `gf_live_${crypto.randomBytes(32).toString('hex')}`;
        const prefix = raw.slice(0, 8);
        const suffix = raw.slice(-4);
        const hash = crypto.createHash('sha256').update(raw).digest('hex');

        await this.updateConfig({
            apiKeyHash: hash,
            apiKeyPrefix: prefix,
            apiKeySuffix: suffix,
            bridgeApiKey: undefined // Clear the plain key from stored config
        });

        return raw;
    }

    private maskApiKey(key: string): string {
        if (key.length <= 12) return '********';
        const prefix = key.slice(0, 8);
        const suffix = key.slice(-4);
        return `${prefix}****${suffix}`;
    }

    public async verifyLogin(username: string, plain: string): Promise<User | null> {
        const cfg = this.getConfig();
        const user = cfg.users.find(u => u.username === username);
        if (!user) return null;

        const isValid = await argon2.verify(user.passwordHash, plain);
        return isValid ? user : null;
    }

    public async addUser(username: string, plain: string, role: 'admin' | 'viewer' = 'admin'): Promise<void> {
        const cfg = this.getConfig();
        if (cfg.users.length >= 10) {
            throw new Error('Maximum user limit (10) reached.');
        }
        if (cfg.users.some(u => u.username === username)) {
            throw new Error('Username already exists.');
        }

        const passwordHash = await argon2.hash(plain);
        const newUser: User = {
            username,
            passwordHash,
            role,
            mfaEnabled: false
        };

        await this.updateConfig({
            users: [...cfg.users, newUser]
        });
    }

    public async deleteUser(username: string): Promise<void> {
        const cfg = this.getConfig();
        const user = cfg.users.find(u => u.username === username);
        if (!user) throw new Error('User not found.');

        // Lockout prevention: don't delete the last admin
        if (user.role === 'admin') {
            const adminCount = cfg.users.filter(u => u.role === 'admin').length;
            if (adminCount <= 1) {
                throw new Error('Cannot delete the last remaining administrator.');
            }
        }

        await this.updateConfig({
            users: cfg.users.filter(u => u.username !== username)
        });
    }

    public async resetUserPassword(username: string, newPlain: string): Promise<void> {
        const cfg = this.getConfig();
        const userIndex = cfg.users.findIndex(u => u.username === username);
        if (userIndex === -1) throw new Error('User not found.');

        const passwordHash = await argon2.hash(newPlain);
        const updatedUsers = [...cfg.users];
        updatedUsers[userIndex] = { ...updatedUsers[userIndex], passwordHash };

        await this.updateConfig({ users: updatedUsers });
    }

    public onUpdate(listener: ConfigUpdateListener): void {
        this.listeners.push(listener);
    }

    private async readSecretFile(envVar: string): Promise<string | null> {
        const filePath = process.env[envVar];
        if (!filePath) return null;
        try {
            const content = await fs.readFile(filePath, 'utf8');
            return content.trim();
        } catch (err) {
            this.logger.error(`Error reading secret file from ${envVar} (${filePath}): ${err}`);
            return null;
        }
    }

    private async saveConfig(cfg: AppConfig): Promise<void> {
        const tmpPath = `${this.configPath}.tmp`;

        // Tier 2 Security: Encrypt recoverable credentials before writing to disk
        const toSave = { ...cfg };
        const masterKey = process.env.GIGAFLAIR_MASTER_KEY;

        if (toSave.sip2Password && typeof toSave.sip2Password === 'string') {
            if (masterKey) {
                toSave.sip2Password = encrypt(toSave.sip2Password, masterKey);
            } else {
                this.logger.warn('WARNING: GIGAFLAIR_MASTER_KEY not set. LMS credentials will be saved in plain text.');
            }
        }

        await fs.writeFile(tmpPath, JSON.stringify(toSave, null, 2), 'utf8');
        await fs.rename(tmpPath, this.configPath);
    }

    private async ensureDir(): Promise<void> {
        const dir = path.dirname(this.configPath);
        await fs.mkdir(dir, { recursive: true });
    }

    private async fileExists(p: string): Promise<boolean> {
        try {
            await fs.access(p);
            return true;
        } catch {
            return false;
        }
    }

    private notifyListeners(): void {
        for (const listener of this.listeners) {
            try {
                listener(this.config!);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                this.logger.error(`Error in ConfigUpdate listener: ${message}`);
            }
        }
    }
}
