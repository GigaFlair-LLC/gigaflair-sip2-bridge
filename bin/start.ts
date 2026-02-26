#!/usr/bin/env tsx
import { createServer } from '../src/server.js';

async function start() {
    try {
        const server = await createServer();
        await server.ready();

        const PORT = server.config.PORT;
        const HOST = server.config.HOST;

        await server.listen({ port: PORT, host: HOST });
        console.log(`sip2-json Bridge listening on ${HOST}:${PORT}`);
    } catch (err) {
        console.error('Failed to start sip2-json Bridge:', err);
        process.exit(1);
    }
}

start();
