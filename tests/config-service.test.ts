import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ConfigService } from '../src/services/ConfigService.js';

const TEST_CONFIG_PATH = path.join(process.cwd(), 'tests/temp-config.json');

describe('ConfigService', () => {
    let service: ConfigService;

    beforeEach(async () => {
        process.env.CONFIG_PATH = TEST_CONFIG_PATH;
        process.env.LMS_HOST = 'test-host';
        // Reset Singleton for each test
        ConfigService._resetInstance();
        service = ConfigService.getInstance();

        try {
            await fs.unlink(TEST_CONFIG_PATH);
        } catch { }
    });

    afterEach(async () => {
        try {
            await fs.unlink(TEST_CONFIG_PATH);
        } catch { }
        const secretPath = path.join(process.cwd(), 'tests/test-secret.txt');
        try {
            await fs.unlink(secretPath);
        } catch { }

        // Clean up any test-generated master keys
        try {
            await fs.unlink('.master_key');
        } catch { }
        try {
            await fs.unlink('tests/.master_key');
        } catch { }

        delete process.env.LMS_HOST;
        delete process.env.BRIDGE_API_KEY;
        delete process.env.BRIDGE_API_KEY_FILE;
        delete process.env.SIP2_PASS;
        delete process.env.SIP2_PASS_FILE;
        delete process.env.CONFIG_PATH;
    });

    it('should bootstrap from environment variables if no file exists', async () => {
        process.env.LMS_HOST = 'env-host';
        process.env.BRIDGE_API_KEY = 'env-api-key-12345';

        await service.initialize();

        const config = service.getConfig();
        expect(config.lmsHost).toBe('env-host');
        expect(config.bridgeApiKey).toBe('env-api-key-12345');

        const fileExists = await fs.access(TEST_CONFIG_PATH).then(() => true).catch(() => false);
        expect(fileExists).toBe(true);
    });

    it('should load from JSON file if it exists', async () => {
        const initialConfig = {
            lmsHost: 'file-host',
            lmsPort: 7001,
            bridgeApiKey: 'file-api-key-12345'
        };
        await fs.mkdir(path.dirname(TEST_CONFIG_PATH), { recursive: true });
        await fs.writeFile(TEST_CONFIG_PATH, JSON.stringify(initialConfig));

        delete process.env.LMS_HOST;
        await service.initialize();

        const config = service.getConfig();
        expect(config.lmsHost).toBe('file-host');
        expect(config.lmsPort).toBe(7001);
    });

    it('should prioritize environment variables over JSON file', async () => {
        const initialConfig = {
            lmsHost: 'file-host',
            lmsPort: 7001,
            bridgeApiKey: 'file-api-key-12345'
        };
        await fs.mkdir(path.dirname(TEST_CONFIG_PATH), { recursive: true });
        await fs.writeFile(TEST_CONFIG_PATH, JSON.stringify(initialConfig));

        process.env.LMS_HOST = 'override-host';

        await service.initialize();

        const config = service.getConfig();
        expect(config.lmsHost).toBe('override-host'); // Env wins
        expect(config.lmsPort).toBe(7001); // Load from file kept
    });

    it('should load secrets from _FILE environment variables', async () => {
        const secretPath = path.join(process.cwd(), 'tests/test-secret.txt');
        await fs.writeFile(secretPath, 'file-secret-value\n');
        process.env.SIP2_PASS_FILE = secretPath;
        process.env.BRIDGE_API_KEY = 'normal-api-key-12345'; // needed for zod min length

        await service.initialize();

        const config = service.getConfig();
        expect(config.sip2Password).toBe('file-secret-value'); // trimmed
    });

    it('should prioritize _FILE secrets over plain environment variables', async () => {
        const secretPath = path.join(process.cwd(), 'tests/test-secret.txt');
        await fs.writeFile(secretPath, 'file-priority-value');
        process.env.SIP2_PASS_FILE = secretPath;
        process.env.SIP2_PASS = 'env-plain-value';
        process.env.BRIDGE_API_KEY = 'normal-api-key-12345';

        await service.initialize();

        const config = service.getConfig();
        expect(config.sip2Password).toBe('file-priority-value');
    });

    it('should set isManaged flag in sanitized config for secrets from files', async () => {
        const secretPath = path.join(process.cwd(), 'tests/test-secret.txt');
        await fs.writeFile(secretPath, 'managed-secret');
        process.env.SIP2_PASS_FILE = secretPath;
        process.env.BRIDGE_API_KEY = 'normal-api-key-12345';

        await service.initialize();

        const sanitized = service.getSanitizedConfig();
        expect(sanitized.sip2Password.isManaged).toBe(true);
        expect(sanitized.sip2Password.value).toBe('********');
        expect(sanitized.bridgeApiKey.isManaged).toBe(false);
    });

    it('should throw error when trying to update a managed field (lockdown guard)', async () => {
        const secretPath = path.join(process.cwd(), 'tests/test-secret.txt');
        await fs.writeFile(secretPath, 'locked-secret');
        process.env.SIP2_PASS_FILE = secretPath;
        process.env.BRIDGE_API_KEY = 'normal-api-key-12345';

        await service.initialize();

        await expect(service.updateConfig({ sip2Password: 'try-to-change' }))
            .rejects.toThrow('managed by a system secret');
    });

    it('should handle malformed JSON gracefully and use defaults/env', async () => {
        await fs.mkdir(path.dirname(TEST_CONFIG_PATH), { recursive: true });
        await fs.writeFile(TEST_CONFIG_PATH, '{ malformed json');

        process.env.LMS_HOST = 'recovery-host';
        process.env.BRIDGE_API_KEY = 'recovery-api-key-12345';

        const spy = vi.spyOn(console, 'error').mockImplementation(() => { });

        await service.initialize();

        const config = service.getConfig();
        expect(config.lmsHost).toBe('recovery-host');
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('should notify listeners when config is updated', async () => {
        process.env.BRIDGE_API_KEY = 'listener-api-key-12345';
        process.env.LMS_HOST = 'initial-host';
        await service.initialize();

        let updatedConfig: any = null;
        service.onUpdate((cfg) => {
            updatedConfig = cfg;
        });

        await service.updateConfig({ lmsHost: 'updated-host' });

        expect(updatedConfig.lmsHost).toBe('updated-host');

        const fileData = JSON.parse(await fs.readFile(TEST_CONFIG_PATH, 'utf8'));
        expect(fileData.lmsHost).toBe('updated-host');
    });

    it('should sanitize dangerous fields for UI using structured object', async () => {
        process.env.BRIDGE_API_KEY = 'secret-key-12345';
        process.env.SIP2_PASS = 'secret-pass';
        process.env.LMS_HOST = 'host';
        await service.initialize();

        const sanitized = service.getSanitizedConfig();
        expect(sanitized.bridgeApiKey.value).toBe('********');
        expect(sanitized.bridgeApiKey.isPresent).toBe(true);
        expect(sanitized.bridgeApiKey.isManaged).toBe(false);
        expect(sanitized.sip2Password.value).toBe('********');
        expect(sanitized.users).toBeInstanceOf(Array);
        expect(sanitized.users.length).toBe(0);
    });

    it('should hash user password with argon2', async () => {
        process.env.BRIDGE_API_KEY = 'admin-api-key-12345';
        process.env.LMS_HOST = 'host';
        await service.initialize();

        await service.addUser('new-admin', 'new-password', 'admin');

        const config = service.getConfig();
        expect(config.users[0].username).toBe('new-admin');
        expect(config.users[0].passwordHash).toContain('$argon2');
    });

    it('should not overwrite with empty strings (write-only pattern simulation)', async () => {
        process.env.BRIDGE_API_KEY = 'initial-api-key-12345';
        process.env.LMS_HOST = 'initial-host';
        await service.initialize();

        // Simulate server.ts logic: filter out empty strings
        const body = { sip2Password: '', lmsHost: 'new-host' };
        const patch = Object.fromEntries(
            Object.entries(body).filter(([, v]) => v !== '' && v !== null && v !== undefined)
        );

        await service.updateConfig(patch);

        const config = service.getConfig();
        expect(config.lmsHost).toBe('new-host');
        // It stays the default (undefined) because we filtered out the empty string
        expect(config.sip2Password).toBeUndefined();

        // Let's set it first then try to clear it with empty string
        await service.updateConfig({ sip2Password: 'real-pass' });
        const patch2 = Object.fromEntries(
            Object.entries({ sip2Password: '' }).filter(([, v]) => v !== '' && v !== null && v !== undefined)
        );
        await service.updateConfig(patch2);
        expect(service.getConfig().sip2Password).toBe('real-pass');
    });

    it('should hash and verify API keys', async () => {
        process.env.BRIDGE_API_KEY = 'test-api-key-12345';
        await service.initialize();

        expect(service.verifyApiKey('test-api-key-12345')).toBe(true);
        expect(service.verifyApiKey('wrong-key')).toBe(false);
    });

    it('should generate a new API key and store its hash', async () => {
        process.env.BRIDGE_API_KEY = 'initial-api-key-12345';
        await service.initialize();

        const newKey = await service.generateApiKey();
        expect(newKey).toContain('gf_live_');

        const config = service.getConfig();
        expect(config.apiKeyHash).toBeDefined();
        // bridgeApiKey should still be in-memory but not in stored config
        expect(service.verifyApiKey(newKey)).toBe(true);

        const fileContent = await fs.readFile(TEST_CONFIG_PATH, 'utf8');
        const saved = JSON.parse(fileContent);
        expect(saved.bridgeApiKey).toBeUndefined();
    });

    it('should block API key regeneration if managed by system secret', async () => {
        const secretPath = path.join(process.cwd(), 'tests/test-secret.txt');
        await fs.writeFile(secretPath, 'managed-key-12345');
        process.env.BRIDGE_API_KEY_FILE = secretPath;

        await service.initialize();

        await expect(service.generateApiKey()).rejects.toThrow('managed by a system secret');
    });

    it('should show partial-reveal mask in sanitized config', async () => {
        process.env.BRIDGE_API_KEY = 'gf_live_my_very_long_secret_key_1234567890';
        await service.initialize();

        const sanitized = service.getSanitizedConfig();
        // gf_live_ (8 chars) + **** + 7890 (last 4)
        expect(sanitized.bridgeApiKey.maskedValue).toBe('gf_live_****7890');
    });

    it('should use stored prefix/suffix for masking if available', async () => {
        const initialConfig = {
            lmsHost: 'host',
            apiKeyHash: 'somehash',
            apiKeyPrefix: 'prefix--',
            apiKeySuffix: 'suffix'
        };
        await fs.writeFile(TEST_CONFIG_PATH, JSON.stringify(initialConfig));
        delete process.env.LMS_HOST;

        await service.initialize();
        const sanitized = service.getSanitizedConfig();
        expect(sanitized.bridgeApiKey.maskedValue).toBe('prefix--****suffix');
    });

    it('should encrypt sip2Password on save if GIGAFLAIR_MASTER_KEY is set', async () => {
        process.env.GIGAFLAIR_MASTER_KEY = 'test-master-key';
        process.env.BRIDGE_API_KEY = 'key-12345';
        await service.initialize();

        await service.updateConfig({ sip2Password: 'plain-password' });

        const fileContent = await fs.readFile(TEST_CONFIG_PATH, 'utf8');
        const saved = JSON.parse(fileContent);

        expect(saved.sip2Password).toBeDefined();
        expect(typeof saved.sip2Password).toBe('object');
        expect(saved.sip2Password.iv).toBeDefined();
        expect(saved.sip2Password.content).toBeDefined();
        expect(saved.sip2Password.content).not.toBe('plain-password');
    });

    it('should decrypt sip2Password on load if GIGAFLAIR_MASTER_KEY is set', async () => {
        process.env.GIGAFLAIR_MASTER_KEY = 'test-master-key';
        const initialConfig = {
            lmsHost: 'host',
            bridgeApiKey: 'key-12345',
            sip2Password: {
                iv: '4f796a326c36663533303332',
                content: 'e154868f041893c5d6c8e3',
                tag: '9b8a7c6d5e4f3a2b1c0d9e8f7a6b5c4d'
            }
        };
        // Note: The above is just a placeholder format, I'll use real encrypted data for the test
        const originalPass = 'real-secret-pass';
        // @ts-ignore - reaching into internals for test setup
        const { encrypt } = await import('../src/utils/crypto.js');
        const encrypted = encrypt(originalPass, 'test-master-key');

        const configToSave = {
            lmsHost: 'host',
            bridgeApiKey: 'key-12345',
            sip2Password: encrypted
        };
        await fs.writeFile(TEST_CONFIG_PATH, JSON.stringify(configToSave));

        delete process.env.LMS_HOST;
        await service.initialize();

        expect(service.getConfig().sip2Password).toBe(originalPass);
    });

    it('should fail fast if MASTER_KEY is missing but password is encrypted', async () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });

        // ConfigService uses its own logger which defaults to console.
        // We need to spy on the instance's console.error if it's using it.
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        const initialConfig = {
            lmsHost: 'host',
            bridgeApiKey: 'key-12345',
            sip2Password: { iv: '...', content: '...', tag: '...' }
        };
        await fs.writeFile(TEST_CONFIG_PATH, JSON.stringify(initialConfig));

        // Mock ensureMasterKey to prevent auto-generation, so we can test the "missing" state
        vi.spyOn(service as any, 'ensureMasterKey').mockResolvedValue(undefined);

        // Delete BOTH env and file to force "Master Key missing"
        delete process.env.GIGAFLAIR_MASTER_KEY;
        const masterKeyPath = path.join(path.dirname(TEST_CONFIG_PATH), '.master_key');
        try { await fs.unlink(masterKeyPath); } catch { }

        delete process.env.LMS_HOST;

        await expect(service.initialize()).rejects.toThrow('process.exit');
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Master Key missing'));

        exitSpy.mockRestore();
        errorSpy.mockRestore();
    });
});
