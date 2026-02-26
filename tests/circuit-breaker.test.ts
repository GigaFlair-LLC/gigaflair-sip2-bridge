/**
 * Circuit Breaker Tests
 *
 * Split into two sections:
 * 1. Pure unit tests for the state machine (no network I/O, no timeouts)
 * 2. One integration test verifying the happy path (LMS reachable → 200 OK)
 *
 * The state machine is tested directly via test-only methods to avoid
 * the inherent flakiness of testing timing + real socket behaviour together.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { SipConnectionManager } from '../src/services/SipConnectionManager.js';
import { LMSConfig, FAILURE_THRESHOLD } from '../src/types/index.js';
import { createServer } from '../src/server.js';
import { MockLmsEnhancedServer } from './mock-lms-enhanced.js';
import { ConfigService } from '../src/services/ConfigService.js';

// ──────────────────────────────────────────────────────────────────────────────
// Unit Tests: State Machine (pure, no network, instant)
// ──────────────────────────────────────────────────────────────────────────────

const FAKE_CONFIG: LMSConfig[] = [
    { branchId: 'main', host: '127.0.0.1', port: 9999, useTls: false, timeoutMs: 100 }
];

describe('Circuit Breaker – State Machine (unit)', () => {
    let manager: SipConnectionManager;

    beforeEach(() => {
        manager = new SipConnectionManager(FAKE_CONFIG, '', console);
    });

    it('starts CLOSED', () => {
        expect(manager.getCircuitState('main')).toBe('CLOSED');
    });

    it('stays CLOSED below failure threshold', () => {
        for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
            manager._simulateFailure('main');
        }
        expect(manager.getCircuitState('main')).toBe('CLOSED');
        const state = manager._getBreakerState('main');
        expect(state.failureCount).toBe(FAILURE_THRESHOLD - 1);
    });

    it('opens at failure threshold', () => {
        for (let i = 0; i < FAILURE_THRESHOLD; i++) {
            manager._simulateFailure('main');
        }
        expect(manager.getCircuitState('main')).toBe('OPEN');
        const state = manager._getBreakerState('main');
        expect(state.nextRetryAt).not.toBeNull();
    });

    it('transitions OPEN → HALF_OPEN after backoff expires', () => {
        for (let i = 0; i < FAILURE_THRESHOLD; i++) {
            manager._simulateFailure('main');
        }
        expect(manager.getCircuitState('main')).toBe('OPEN');

        // Expire the backoff
        manager._expireBackoff('main');
        // getCircuitState triggers the transition
        expect(manager.getCircuitState('main')).toBe('HALF_OPEN');
    });

    it('returns to OPEN on failure in HALF_OPEN (re-trips)', () => {
        for (let i = 0; i < FAILURE_THRESHOLD; i++) {
            manager._simulateFailure('main');
        }
        manager._expireBackoff('main');
        manager.getCircuitState('main'); // triggers HALF_OPEN transition

        // Simulate the probe failing
        manager._simulateFailure('main');
        expect(manager.getCircuitState('main')).toBe('OPEN');
    });

    it('closes the circuit on success in HALF_OPEN', () => {
        for (let i = 0; i < FAILURE_THRESHOLD; i++) {
            manager._simulateFailure('main');
        }
        manager._expireBackoff('main');
        manager.getCircuitState('main'); // triggers HALF_OPEN transition

        // Simulate the probe succeeding
        manager._simulateSuccess('main');
        expect(manager.getCircuitState('main')).toBe('CLOSED');

        // Verify counters are reset
        const state = manager._getBreakerState('main');
        expect(state.failureCount).toBe(0);
        expect(state.backoffIndex).toBe(0);
    });

    it('increments backoff index on successive trips', () => {
        // First trip
        for (let i = 0; i < FAILURE_THRESHOLD; i++) manager._simulateFailure('main');
        const state1 = manager._getBreakerState('main');
        expect(state1.backoffIndex).toBe(1);

        // Second trip (expire and re-trip)
        manager._expireBackoff('main');
        manager.getCircuitState('main');      // HALF_OPEN
        manager._simulateFailure('main');     // re-trip to OPEN

        const state2 = manager._getBreakerState('main');
        expect(state2.backoffIndex).toBe(2);
    });

    it('resets backoff index fully after close', () => {
        for (let i = 0; i < FAILURE_THRESHOLD; i++) manager._simulateFailure('main');
        manager._expireBackoff('main');
        manager.getCircuitState('main');
        manager._simulateSuccess('main');

        const state = manager._getBreakerState('main');
        expect(state.backoffIndex).toBe(0);
        expect(state.failureCount).toBe(0);
    });

    it('throws for unknown branchId', () => {
        expect(() => manager.getCircuitState('bad-branch')).toThrow('Unknown branch');
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// Integration Test: Happy Path only (LMS reachable → 200)
// ──────────────────────────────────────────────────────────────────────────────

describe('Circuit Breaker – Integration (happy path)', () => {
    let app: FastifyInstance;
    let mockLms: MockLmsEnhancedServer;
    const API_KEY = 'cb-integration-key';
    const PORT = 6014;

    beforeAll(async () => {
        mockLms = new MockLmsEnhancedServer(PORT, '127.0.0.1');
        await mockLms.start();

        process.env.LMS_HOST = '127.0.0.1';
        process.env.LMS_PORT = PORT.toString();
        process.env.BRIDGE_API_KEY = API_KEY;
        process.env.NODE_ENV = 'test';

        ConfigService._resetInstance();
        app = await createServer();
        await app.ready();
    });

    afterAll(async () => {
        if (app) await app.close();
        if (mockLms) await mockLms.stop().catch(() => { });
    });

    it('returns 200 when LMS is reachable (CLOSED)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/patron/status',
            headers: { 'x-api-key': API_KEY },
            payload: { patronBarcode: 'VALID001' }
        });
        expect(res.statusCode).toBe(200);
        expect(app.sipManager.getCircuitState('main')).toBe('CLOSED');
    });

    it('returns 503 immediately when circuit is forced OPEN via simulation', async () => {
        // Trip the circuit directly (no network required)
        for (let i = 0; i < FAILURE_THRESHOLD; i++) {
            app.sipManager._simulateFailure('main');
        }
        expect(app.sipManager.getCircuitState('main')).toBe('OPEN');

        const start = Date.now();
        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/patron/status',
            headers: { 'x-api-key': API_KEY },
            payload: { patronBarcode: 'VALID001' }
        });
        const dur = Date.now() - start;

        expect(res.statusCode).toBe(503);
        expect(JSON.parse(res.payload).message).toContain('Connection to LMS is currently suspended');
        // Should be instant since circuit is OPEN
        expect(dur).toBeLessThan(200);
    });

    it('re-closes circuit and returns 200 after forced recovery', async () => {
        // Expire the backoff and let the probe succeed (LMS is still running)
        app.sipManager._expireBackoff('main');
        expect(app.sipManager.getCircuitState('main')).toBe('HALF_OPEN');

        const res = await app.inject({
            method: 'POST',
            url: '/api/v1/patron/status',
            headers: { 'x-api-key': API_KEY },
            payload: { patronBarcode: 'VALID001' }
        });

        expect(res.statusCode).toBe(200);
        expect(app.sipManager.getCircuitState('main')).toBe('CLOSED');
    });
});
