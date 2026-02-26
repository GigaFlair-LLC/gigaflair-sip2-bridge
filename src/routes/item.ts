import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { handleSipError, SIP2_SAFE } from './utils.js';

const ItemSchema = z.object({
    branchId: z.string().min(1).max(32).regex(SIP2_SAFE).default('main'),
    itemBarcode: z.string().min(1).max(30).regex(SIP2_SAFE)
});

const BranchSchema = z.object({
    branchId: z.string().min(1).max(32).regex(SIP2_SAFE).default('main'),
});

const ItemStatusUpdateSchema = z.object({
    branchId:       z.string().min(1).max(32).regex(SIP2_SAFE).default('main'),
    itemBarcode:    z.string().min(1).max(30).regex(SIP2_SAFE),
    securityMarker: z.enum(['0', '1', '2', '3']).optional().default('2'),
});

export default async function itemRoutes(fastify: FastifyInstance) {
    fastify.post('/item/status', {
        handler: async (request, reply) => {
            try {
                const { branchId, itemBarcode } = ItemSchema.parse(request.body);
                const result = await fastify.sipManager.itemInformation(branchId, itemBarcode);
                return result;
            } catch (err: unknown) {
                return handleSipError(err, fastify, reply);
            }
        }
    });

    fastify.post('/item/status-update', {
        handler: async (request, reply) => {
            try {
                const { branchId, itemBarcode, securityMarker } = ItemStatusUpdateSchema.parse(request.body);
                const result = await fastify.sipManager.itemStatusUpdate(branchId, itemBarcode, securityMarker);
                return result;
            } catch (err: unknown) {
                return handleSipError(err, fastify, reply);
            }
        }
    });

    fastify.post('/acs-status', {
        handler: async (request, reply) => {
            try {
                const { branchId } = BranchSchema.parse(request.body);
                const result = await fastify.sipManager.scStatus(branchId);
                return result;
            } catch (err: unknown) {
                return handleSipError(err, fastify, reply);
            }
        }
    });
}
