import Fastify, { FastifyInstance } from 'fastify';
import { z } from 'zod';
import fastifyEnv from '@fastify/env';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyCsrf from '@fastify/csrf-protection';
import fastifyHelmet from '@fastify/helmet';
import { SipConnectionManager } from './services/SipConnectionManager.js';
import { ConfigService } from './services/ConfigService.js';
import patronRoutes from './routes/patron.js';
import circulationRoutes from './routes/circulation.js';
import itemRoutes from './routes/item.js';
import { LMSConfig, EnvConfig, AppConfig } from './types/index.js';
import { bridgeEvents, BridgeEvent } from './utils/events.js';
import { isSafeHost } from './utils/ssrf.js';
import { formatLoginRequest } from './utils/sip-formatter.js';
import { VersionService } from './services/VersionService.js';
import { tcpProbe } from './utils/tcp-probe.js';
import { formatUptime } from './utils/format.js';
import { NativeLogger, startLogCleanupTask } from './utils/logger.js';

// fileURLToPath kept for potential future use (e.g. resolving assets relative to this file);
// data/ and public/ are resolved relative to process.cwd() (the project root) instead.
const __filename = fileURLToPath(import.meta.url);
void __filename; // suppress unused-variable warning

// Extend FastifyInstance with our decorator
declare module 'fastify' {
    interface FastifyInstance {
        sipManager: SipConnectionManager;
        config: EnvConfig;
        configService: ConfigService;
    }
    interface Session {
        user?: {
            username: string;
            role: string;
        };
    }
    interface FastifyReply {
        generateCsrf(): Promise<string>;
    }
}

const envSchema = {
    type: 'object',
    properties: {
        BRIDGE_API_KEY: { type: 'string' },
        LMS_HOST: { type: 'string' },
        LMS_PORT: { type: 'number', default: 6001 },
        SIP2_USER: { type: 'string' },
        SIP2_PASS: { type: 'string' },
        SIP2_LOCATION: { type: 'string', default: '' },
        PORT: { type: 'number', default: 3100 },
        HOST: { type: 'string', default: '0.0.0.0' },
        NODE_ENV: { type: 'string', default: 'production' },
        SESSION_SECRET: { type: 'string' }
    }
};

function mapToLmsConfig(appConfig: AppConfig): LMSConfig[] {
    return [
        {
            branchId: 'main',
            host: appConfig.lmsHost,
            port: appConfig.lmsPort,
            useTls: appConfig.useTls,
            rejectUnauthorized: appConfig.rejectUnauthorized,
            timeoutMs: appConfig.timeoutMs,
            institutionId: appConfig.institutionId,
            sipUser: appConfig.sip2User,
            sipPassword: appConfig.sip2Password as string,
            vendorProfile: appConfig.vendorProfile
        }
    ];
}

async function pathExists(p: string): Promise<boolean> {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

async function getDirSize(dirPath: string): Promise<number> {
    try {
        if (!(await pathExists(dirPath))) return 0;
        const files = await fs.readdir(dirPath, { withFileTypes: true });
        const sizes = await Promise.all(files.map(async (file) => {
            const filePath = path.join(dirPath, file.name);
            if (file.isDirectory()) return getDirSize(filePath);
            const stats = await fs.stat(filePath);
            return stats.size;
        }));
        return sizes.reduce((acc, size) => acc + size, 0);
    } catch (_err) {
        return 0;
    }
}

export async function createServer(): Promise<FastifyInstance> {
    // Use process.cwd() so the path resolves to the project root whether running
    // from source (ts-node: cwd = project root) or compiled (node dist/...: cwd = project root).
    // __dirname-relative paths break in production because dist/src/server.js is one
    // level deeper than the project root.
    const dataDir = path.join(process.cwd(), 'data');
    const logsDir = path.join(dataDir, 'logs');

    const nativeLogger = new NativeLogger(path.join(logsDir, 'bridge.log'));

    const server = Fastify({
        logger: false // Disable Pino
    });

    // Inject NativeLogger as the Fastify logger
    (server as unknown as Record<string, unknown>).log = nativeLogger;

    // Register Environment Variables Plugin
    await server.register(fastifyEnv, {
        schema: envSchema,
        dotenv: true
    });

    // Register Static Files Plugin (for Dashboard & Setup)
    await server.register(fastifyStatic, {
        root: path.join(process.cwd(), 'public'),
        prefix: '/'
    });

    // Register Cookie & Session
    await server.register(fastifyCookie);

    // Session secret priority:
    // 1. SESSION_SECRET env var (explicit override)
    // 2. Derived deterministically from GIGAFLAIR_MASTER_KEY (stable across restarts)
    // 3. Random fallback (sessions lost on restart — warn in production)
    let sessionSecret: string;
    if (process.env.SESSION_SECRET) {
        sessionSecret = process.env.SESSION_SECRET;
    } else if (process.env.GIGAFLAIR_MASTER_KEY) {
        // Derive a stable session secret from the persisted master key
        sessionSecret = crypto.createHmac('sha256', process.env.GIGAFLAIR_MASTER_KEY)
            .update('gigaflair-session-secret-v1')
            .digest('hex');
    } else {
        sessionSecret = crypto.randomBytes(32).toString('hex');
        if (process.env.NODE_ENV === 'production') {
            server.log.warn('SESSION_SECRET not provided and no Master Key available. Sessions will be invalidated on restart.');
        }
    }
    await server.register(fastifySession, {
        secret: sessionSecret,
        cookie: {
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            sameSite: 'strict'
        }
    });

    // 0. Security Headers (Helmet)
    await server.register(fastifyHelmet, {
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net", "blob:"],
                scriptSrcAttr: ["'unsafe-inline'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com", "https://cdn.tailwindcss.com"],
                imgSrc: ["'self'", "data:", "https://*", "blob:"],
                fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
                connectSrc: ["'self'", "https://cdn.tailwindcss.com"],
                frameSrc: ["'self'"],
                objectSrc: ["'none'"],
                upgradeInsecureRequests: null
            }
        },
        hsts: false
    });

    // 1. Rate Limiting
    await server.register(fastifyRateLimit, {
        max: 100,
        timeWindow: '1 minute'
    });

    // 2. CSRF Protection
    await server.register(fastifyCsrf, {
        sessionPlugin: '@fastify/session',
        getToken: (request) => {
            return request.headers['x-csrf-token'] as string;
        }
    });

    // Initialize ConfigService
    const configService = ConfigService.getInstance();
    configService.setLogger(server.log);
    await configService.initialize();
    server.decorate('configService', configService);

    const versionService = new VersionService(server.log);

    // Health check (registered before security hooks)
    server.get('/health', async () => ({ status: 'ok' }));

    // CSRF Token Route
    server.get('/api/admin/csrf-token', async (_request, reply) => {
        return { token: await reply.generateCsrf() };
    });

    // Global Auth & Security Hook
    server.addHook('preHandler', async (request, reply) => {
        const url = request.url;
        const usersExist = configService.hasUsers();

        // 0. Public Assets & Root
        if (url === '/') return;
        // Allow static file requests (e.g. .html, .css, .js) but NOT API routes containing dots
        if (!url.startsWith('/api') && /^\/[\w\-/]*\.[\w]+$/.test(url.split('?')[0])) return;

        // 1. Day Zero Onboarding Redirect / API Auth
        if (!usersExist) {
            // If it's an API route, don't redirect, just enforce API key or move to setup
            if (url.startsWith('/api/v1')) {
                const apiKey = request.headers['x-api-key'];
                if (typeof apiKey === 'string' && configService.verifyApiKey(apiKey)) return;
                return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or missing API Key' });
            }

            if (url === '/onboarding' || url === '/api/setup/create-admin' || url === '/api/setup/recovery-key' || url.startsWith('/api/setup')) return;
            return reply.redirect('/onboarding');
        }

        // 2. Setup Lockout / Public Routes
        if (url === '/health') return;
        // When users already exist, /onboarding should redirect to dashboard
        if (url === '/onboarding') return reply.redirect('/dashboard');
        if (url === '/setup' || url.startsWith('/api/setup')) {
            // Post-setup: sensitive setup routes MUST have a valid session
            if (usersExist) {
                const sensitiveSetupRoutes = ['/api/setup/recovery-key', '/api/setup/initialize', '/api/setup/test-connection', '/api/setup/validate-license'];
                if (sensitiveSetupRoutes.includes(url)) {
                    if (!request.session?.user) {
                        return reply.status(401).send({ error: 'Unauthorized', message: 'Session required for this resource' });
                    }
                    // Recovery key requires admin role specifically
                    if (url === '/api/setup/recovery-key' && request.session.user.role !== 'admin') {
                        return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
                    }
                }
            }
            return;
        }
        if (url === '/dashboard') return;

        // 3. Admin API Routes & Config Management - Check Session
        if (url.startsWith('/api/admin') || url.startsWith('/api/v1/config') || url.startsWith('/api/system')) {
            if (url === '/api/admin/login' || url === '/api/admin/csrf-token') return; // Allow login and token fetch
            if (!request.session.user) {
                return reply.status(401).send({ error: 'Unauthorized', message: 'Session expired or invalid' });
            }
            return;
        }

        // 4. Regular API V1 Routes (Translation) - Check API Key
        const apiKey = request.headers['x-api-key'];
        if (typeof apiKey !== 'string' || !configService.verifyApiKey(apiKey)) {
            return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or missing API Key' });
        }
    });

    // 4. CSRF Protection Hook (Selective)
    server.addHook('preHandler', (request, reply, done) => {
        const url = request.url;
        // Skip CSRF for GET/HEAD, Public API, and Health
        if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return done();
        if (url === '/health' || url === '/api/admin/login') return done();

        // All public translation routes use API keys (no session), exempt from CSRF
        if (url.startsWith('/api/v1/') && !url.startsWith('/api/v1/config')) return done();

        // Skip CSRF during the absolute Day Zero phase before admin exists
        if (!configService.hasUsers()) return done();

        server.csrfProtection(request, reply, done);
    });

    // Static Page Routes
    server.get('/onboarding', async (_request, reply) => {
        return reply.sendFile('onboarding.html');
    });

    server.get('/setup', async (_request, reply) => {
        return reply.sendFile('setup.html');
    });

    server.get('/dashboard', async (request, reply) => {
        if (!request.session.user) {
            return reply.redirect('/setup'); // Simple redirect if not logged in
        }
        return reply.sendFile('dashboard.html');
    });

    // Default root route
    server.get('/', async (request, reply) => {
        if (!request.session.user) {
            const config = configService.getSanitizedConfig();
            if (config.users.length === 0) return reply.redirect('/onboarding');
            return reply.sendFile('dashboard.html'); // The dashboard will handle login view
        }
        return reply.redirect('/dashboard');
    });

    const appConfig = configService.getConfig();
    const configs = mapToLmsConfig(appConfig);

    const sipManager = new SipConnectionManager(configs, appConfig.sip2Location, server.log);
    server.decorate('sipManager', sipManager);

    // Observer for live config updates
    configService.onUpdate((newConfig) => {
        const updatedLmsConfigs = mapToLmsConfig(newConfig);
        server.sipManager.reinitialize(updatedLmsConfigs, newConfig.sip2Location);
    });

    // --- ADMINISTRATIVE API ROUTES ---

    // Auth
    server.post('/api/admin/login', {
        config: {
            rateLimit: {
                max: 5,
                timeWindow: '1 minute'
            }
        }
    }, async (request, reply) => {
        const body = request.body as Record<string, unknown>;
        const { username, password } = body;
        if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
            return reply.status(400).send({ error: 'Bad Request', message: 'username and password are required' });
        }
        const user = await configService.verifyLogin(username, password);
        if (user) {
            // SECURITY: Regenerate session on login to prevent session fixation
            await request.session.regenerate();
            request.session.user = { username: user.username, role: user.role };
            return { success: true, user: { username: user.username, role: user.role } };
        }
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid username or password' });
    });

    server.post('/api/admin/logout', async (request) => {
        await request.session.destroy();
        return { success: true };
    });

    server.get('/api/admin/me', async (request) => {
        return { user: request.session.user };
    });

    // User Management
    server.get('/api/admin/users', async () => {
        const config = configService.getSanitizedConfig();
        return config.users;
    });

    server.post('/api/admin/users', async (request, reply) => {
        if (request.session.user?.role !== 'admin') {
            return reply.status(403).send({ error: 'Forbidden', message: 'Only administrators can create users' });
        }
        const { username, password, role } = request.body as Record<string, string>;
        try {
            await configService.addUser(username, password, role as 'admin' | 'viewer');
            return { success: true };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return reply.status(400).send({ error: 'Bad Request', message });
        }
    });

    server.delete('/api/admin/users/:username', async (request, reply) => {
        if (request.session.user?.role !== 'admin') {
            return reply.status(403).send({ error: 'Forbidden', message: 'Only administrators can delete users' });
        }
        const { username } = request.params as { username: string };
        try {
            await configService.deleteUser(username);
            return { success: true };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return reply.status(400).send({ error: 'Bad Request', message });
        }
    });

    server.post('/api/admin/users/:username/reset-password', async (request, reply) => {
        const { username: targetUser } = request.params as { username: string };
        if (request.session.user?.role !== 'admin' && request.session.user?.username !== targetUser) {
            return reply.status(403).send({ error: 'Forbidden', message: 'Unauthorized password reset' });
        }
        const { newPassword } = request.body as Record<string, string>;
        if (!newPassword || newPassword.length < 8) {
            return reply.status(400).send({ error: 'Bad Request', message: 'Password must be at least 8 characters' });
        }
        try {
            await configService.resetUserPassword(targetUser, newPassword);
            return { success: true };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return reply.status(400).send({ error: 'Bad Request', message });
        }
    });

    // System Status
    server.get('/api/admin/status', async () => {
        const state = server.sipManager.getCircuitState('main');
        return {
            state,
            uptime: process.uptime(),
            timestamp: Date.now()
        };
    });

    server.get('/api/system/health', async (request, reply) => {
        if (request.session.user?.role !== 'admin') {
            return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
        }

        const config = configService.getConfig();
        const uptimeSeconds = process.uptime();
        const uptimeStr = formatUptime(uptimeSeconds);

        // 2. LMS Status (Port Ping using tcpProbe)
        const reachable = await tcpProbe(config.lmsHost, config.lmsPort, 3000);
        const lmsStatus = reachable ? 'reachable' : 'unreachable';

        // 4. Memory Usage
        const mem = process.memoryUsage();
        const memoryUsageMb = Math.round(mem.rss / 1024 / 1024 * 100) / 100;

        // 5. Disk Usage (Data directory)
        const dataDir = path.join(process.cwd(), 'data');
        const diskUsageBytes = await getDirSize(dataDir);
        const diskUsageMb = Math.round(diskUsageBytes / 1024 / 1024 * 100) / 100;

        return {
            uptime: uptimeStr,
            lmsStatus,
            memoryUsageMb,
            diskUsageMb
        };
    });

    server.get('/api/system/version', async (request, reply) => {
        if (request.session.user?.role !== 'admin') {
            return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
        }
        return await versionService.getVersionInfo();
    });

    server.post('/api/admin/reconnect', async () => {
        const appConfig = configService.getConfig();
        const configs = mapToLmsConfig(appConfig);
        await server.sipManager.reinitialize(configs, appConfig.sip2Location);
        return { success: true };
    });

    // Real-time Logs (SSE)
    server.get('/api/admin/logs', (request, reply) => {
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');

        const onLog = (data: unknown) => {
            reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        bridgeEvents.on(BridgeEvent.LOG, onLog);

        request.raw.on('close', () => {
            bridgeEvents.off(BridgeEvent.LOG, onLog);
        });
    });

    // --- END ADMINISTRATIVE API ROUTES ---

    // Routes (Public API v1)
    server.register(patronRoutes, { prefix: '/api/v1' });
    server.register(circulationRoutes, { prefix: '/api/v1' });
    server.register(itemRoutes, { prefix: '/api/v1' });

    // --- ADMINISTRATIVE API ROUTES ---

    // Config Management Routes (Session Protected via preHandler)
    server.get('/api/admin/config', async () => {
        return configService.getSanitizedConfig();
    });

    server.patch('/api/admin/config', async (request, reply) => {
        const body = request.body as Partial<AppConfig>;
        try {
            const BLOCKED_PATCH_FIELDS = new Set(['users', 'apiKeyHash', 'apiKeyPrefix', 'apiKeySuffix', 'apiKeyIterations']);
            // Allow empty strings for fields like location/user, but skip password if empty to prevent accidental clearing
            const patch = Object.fromEntries(
                Object.entries(body).filter(([k, v]) => {
                    if (BLOCKED_PATCH_FIELDS.has(k)) return false;
                    if (v === null || v === undefined) return false;
                    if (k === 'sip2Password' && v === '') return false;
                    return true;
                })
            );
            await configService.updateConfig(patch);
            return { status: 'updated' };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return reply.status(400).send({ error: 'Bad Request', message });
        }
    });

    server.post('/api/admin/config/regenerate-api-key', async (_request, reply) => {
        try {
            const newKey = await configService.generateApiKey();
            return { success: true, key: newKey };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return reply.status(500).send({ error: 'Internal Server Error', message });
        }
    });

    // --- SETUP WIZARD API ROUTES ---

    // Mutex to prevent race condition in admin creation
    let adminCreationInProgress = false;
    server.post('/api/setup/create-admin', async (request, reply) => {
        const config = configService.getSanitizedConfig();
        if (config.users.length > 0) {
            return reply.status(403).send({ error: 'Forbidden', message: 'Admin already created' });
        }
        // SECURITY: Prevent TOCTOU race — two concurrent requests both passing the above check
        if (adminCreationInProgress) {
            return reply.status(409).send({ error: 'Conflict', message: 'Admin creation already in progress' });
        }
        adminCreationInProgress = true;

        const { username, password } = request.body as Record<string, string>;
        if (!password || password.length < 8) {
            return reply.status(400).send({ error: 'Bad Request', message: 'Password must be at least 8 characters' });
        }

        try {
            await configService.addUser(username || 'admin', password, 'admin');
            // SECURITY: Regenerate session on admin creation to prevent session fixation
            await request.session.regenerate();
            request.session.user = { username: username || 'admin', role: 'admin' };
            return { success: true };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return reply.status(500).send({ error: 'Internal Server Error', message });
        } finally {
            adminCreationInProgress = false;
        }
    });


    server.get('/api/setup/recovery-key', async (_request, reply) => {
        try {
            const key = configService.getMasterKey();
            return { success: true, key };
        } catch (_err) {
            return reply.status(500).send({ success: false, message: 'Master key not available' });
        }
    });

    server.post('/api/setup/test-connection', async (request, reply) => {
        const body = request.body as Record<string, string | number>;
        const { lmsHost, sip2User, sip2Password, sip2Location } = body;
        const lmsPort = typeof body.lmsPort === 'number' ? body.lmsPort : parseInt(String(body.lmsPort), 10);

        if (!lmsHost || typeof lmsHost !== 'string' || isNaN(lmsPort) || lmsPort < 1 || lmsPort > 65535) {
            return reply.status(400).send({ success: false, message: 'Invalid host or port' });
        }

        // SSRF Protection: Hardened check
        if (!isSafeHost(String(lmsHost))) {
            return reply.status(400).send({
                success: false,
                message: 'Security Violation: Connections to internal or loopback addresses are forbidden.'
            });
        }

        return new Promise((resolve) => {
            const socket = new net.Socket();
            let resolved = false;

            const cleanup = () => {
                if (!socket.destroyed) {
                    socket.destroy();
                }
            };

            socket.setTimeout(5000);
            socket.on('timeout', () => {
                if (resolved) return;
                resolved = true;
                cleanup();
                resolve(reply.status(408).send({ success: false, message: 'Connection timeout (LMS did not respond in 5s)' }));
            });

            socket.connect(lmsPort as number, lmsHost as string, () => {
                // Connected! If credentials provided, send login. Otherwise send SC Status probe.
                if (sip2User) {
                    const loginMsg = formatLoginRequest(String(sip2User), String(sip2Password), sip2Location ? String(sip2Location) : undefined);
                    socket.write(loginMsg);
                } else {
                    socket.write('99\r');
                }
            });

            socket.on('data', (data: Buffer) => {
                if (resolved) return;
                resolved = true;
                cleanup();
                const response = data.toString();
                if (response.startsWith('941') || response.startsWith('98')) {
                    const msg = response.startsWith('941') ? 'Login successful' : 'LMS connection verified (98 ACS Status received)';
                    resolve(reply.send({ success: true, message: msg }));
                } else if (response.startsWith('940')) {
                    resolve(reply.send({ success: false, message: 'LMS rejected login credentials' }));
                } else {
                    resolve(reply.send({ success: false, message: `Unexpected LMS response: ${response.substring(0, 10)}...` }));
                }
            });

            socket.on('error', (err: Error) => {
                if (resolved) return;
                resolved = true;
                cleanup();
                resolve(reply.status(500).send({ success: false, message: `Connection failed: ${err.message}` }));
            });
        });
    });

    const VendorProfileSchema = z.object({
        checksumRequired: z.boolean().optional(),
        postLoginSCStatus: z.boolean().optional(),
    }).passthrough().optional();

    const InitializeBodySchema = z.object({
        lmsHost: z.string().min(1).max(253),
        lmsPort: z.string().regex(/^\d+$/).transform(v => parseInt(v, 10)),
        sip2User: z.string().max(64).optional().default(''),
        sip2Password: z.string().max(128).optional().default(''),
        sip2Location: z.string().max(32).optional().default(''),
        vendorProfile: VendorProfileSchema,
    });

    server.post('/api/setup/initialize', async (request, reply) => {
        const parsed = InitializeBodySchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: 'Bad Request', message: 'Invalid setup parameters', details: parsed.error.errors });
        }
        const { lmsHost, lmsPort, sip2User, sip2Password, sip2Location, vendorProfile } = parsed.data;

        // SSRF Protection: validate lmsHost before persisting
        if (!isSafeHost(String(lmsHost))) {
            return reply.status(400).send({
                success: false,
                message: 'Security Violation: Connections to internal or loopback addresses are forbidden.'
            });
        }

        try {
            // adminPassword is no longer sent/needed here

            // 2. Set LMS config
            await configService.updateConfig({
                lmsHost,
                lmsPort,
                sip2User,
                sip2Password,
                sip2Location,
                ...(vendorProfile ? { vendorProfile } : {})
            });

            // 3. Generate initial API key for the bridge
            const apiKey = await configService.generateApiKey();

            // Start background services now that we're initialized
            versionService.start(configService).catch(() => { });

            return { success: true, apiKey };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return reply.status(500).send({ error: 'Internal Server Error', message });
        }
    });

    // --- END SETUP WIZARD API ROUTES ---

    // Background Services (Start if already initialized)
    if (configService.getSanitizedConfig().users.length > 0) {
        versionService.start(configService).catch(err => {
            server.log.error('Failed to start VersionService:', err);
        });
    }

    // Start Log Cleanup Task
    const cleanupTask = startLogCleanupTask(
        path.join(logsDir, 'bridge.log'),
        () => configService.getConfig().logRetentionHours || 168
    );

    // Cleanup on close
    server.addHook('onClose', async (instance) => {
        clearInterval(cleanupTask);
        versionService.stop();
        await instance.sipManager.shutdown();
    });

    return server;
}

// Start only if run directly
if (process.argv[1]?.includes('server.ts') || process.argv[1]?.includes('server.js')) {
    createServer().then(async server => {
        const { port, host } = server.configService.getConfig();
        try {
            await server.listen({ port, host });
            server.log.info(`GigaFlair SIP2 Bridge listening on ${host}:${port}`);
        } catch (err) {
            server.log.error(err, 'Failed to start GigaFlair SIP2 Bridge');
            process.exit(1);
        }
    }).catch(err => {
        console.error('Failed to create server:', err); // Keep console.error for initial server creation failure
        process.exit(1);
    });
}
