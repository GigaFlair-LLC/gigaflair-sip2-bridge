import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        setupFiles: ['./tests/vitest.setup.ts'],
        environment: 'node',
        // Integration test suites bind real TCP ports (mock LMS servers).
        // Running them in parallel causes EADDRINUSE collisions, so we force
        // sequential execution via a single-fork worker pool.
        pool: 'forks',
        poolOptions: {
            forks: {
                maxForks: 1,
            },
        },
    },
});
