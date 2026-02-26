import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { handleSipError, SIP2_SAFE } from './utils.js';

const PatronItemSchema = z.object({
    branchId: z.string().min(1).max(32).regex(SIP2_SAFE).default('main'),
    patronBarcode: z.string().min(1).max(30).regex(SIP2_SAFE),
    itemBarcode: z.string().min(1).max(30).regex(SIP2_SAFE),
    patronPin: z.string().min(1).max(30).regex(SIP2_SAFE).optional(),
});

const CheckinSchema = z.object({
    branchId: z.string().min(1).max(32).regex(SIP2_SAFE).default('main'),
    itemBarcode: z.string().min(1).max(30).regex(SIP2_SAFE)
});

export default async function circulationRoutes(fastify: FastifyInstance) {
    fastify.post('/checkout', {
        handler: async (request, reply) => {
            try {
                const { branchId, patronBarcode, itemBarcode, patronPin } = PatronItemSchema.parse(request.body);
                const result = await fastify.sipManager.checkout(branchId, patronBarcode, itemBarcode, patronPin);
                return result;
            } catch (err: unknown) {
                return handleSipError(err, fastify, reply);
            }
        }
    });

    fastify.post('/checkin', {
        handler: async (request, reply) => {
            try {
                const { branchId, itemBarcode } = CheckinSchema.parse(request.body);
                const result = await fastify.sipManager.checkin(branchId, itemBarcode);
                return result;
            } catch (err: unknown) {
                return handleSipError(err, fastify, reply);
            }
        }
    });

    fastify.post('/renew', {
        handler: async (request, reply) => {
            try {
                const { branchId, patronBarcode, itemBarcode, patronPin } = PatronItemSchema.parse(request.body);
                const result = await fastify.sipManager.renew(branchId, patronBarcode, itemBarcode, patronPin);
                return result;
            } catch (err: unknown) {
                return handleSipError(err, fastify, reply);
            }
        }
    });

    const HoldSchema = z.object({
        branchId:       z.string().min(1).max(32).regex(SIP2_SAFE).default('main'),
        holdMode:       z.enum(['+', '-', '*']).default('+'),
        patronBarcode:  z.string().min(1).max(30).regex(SIP2_SAFE),
        itemBarcode:    z.string().min(1).max(30).regex(SIP2_SAFE).optional(),
        titleId:        z.string().min(1).max(100).regex(SIP2_SAFE).optional(),
        expiryDate:     z.string().max(18).regex(SIP2_SAFE).optional(),
        pickupLocation: z.string().max(30).regex(SIP2_SAFE).optional(),
    });

    fastify.post('/hold', {
        handler: async (request, reply) => {
            try {
                const { branchId, holdMode, patronBarcode, itemBarcode, expiryDate, pickupLocation, titleId } = HoldSchema.parse(request.body);
                const result = await fastify.sipManager.hold(branchId, patronBarcode, holdMode, itemBarcode, expiryDate, pickupLocation, titleId);
                return result;
            } catch (err: unknown) {
                return handleSipError(err, fastify, reply);
            }
        }
    });

    const RenewAllSchema = z.object({
        branchId:      z.string().min(1).max(32).regex(SIP2_SAFE).default('main'),
        patronBarcode: z.string().min(1).max(30).regex(SIP2_SAFE),
    });

    fastify.post('/renew-all', {
        handler: async (request, reply) => {
            try {
                const { branchId, patronBarcode } = RenewAllSchema.parse(request.body);
                const result = await fastify.sipManager.renewAll(branchId, patronBarcode);
                return result;
            } catch (err: unknown) {
                return handleSipError(err, fastify, reply);
            }
        }
    });
}
