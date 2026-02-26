import { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

export const SIP2_SAFE = /^[a-zA-Z0-9 \-_.]+$/;

export function handleSipError(err: unknown, fastify: FastifyInstance, reply: FastifyReply) {
    const error = err as Error;
    fastify.log.error(error);

    if (error instanceof z.ZodError) {
        return reply.status(400).send({
            error: 'Bad Request',
            message: 'Validation failed',
            details: error.errors
        });
    }

    if (error.message?.includes('Circuit')) {
        return reply.status(503).send({
            error: 'Service Unavailable',
            message: 'Connection to LMS is currently suspended'
        });
    }

    if (error.message?.includes('Unknown branch')) {
        return reply.status(404).send({
            error: 'Not Found',
            message: error.message
        });
    }

    if (error.message?.toLowerCase().includes('timeout')) {
        return reply.status(504).send({
            error: 'Gateway Timeout',
            message: 'LMS failed to respond in time'
        });
    }

    return reply.status(502).send({
        error: 'Bad Gateway',
        message: 'Communication with the LMS failed'
    });
}
