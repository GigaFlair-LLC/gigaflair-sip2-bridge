import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { handleSipError, SIP2_SAFE } from './utils.js';

const PatronStatusSchema = z.object({
    branchId: z.string()
        .min(1).max(32)
        .regex(SIP2_SAFE, 'branchId contains invalid characters')
        .default('main'),
    patronBarcode: z.string()
        .min(1).max(30)
        .regex(SIP2_SAFE, 'patronBarcode contains invalid characters'),
    language: z.string().regex(/^\d{3}$/).optional().default('001'),
});

export default async function patronRoutes(fastify: FastifyInstance) {
    fastify.post('/patron/status', {
        handler: async (request, reply) => {
            try {
                const { branchId, patronBarcode, language } = PatronStatusSchema.parse(request.body);
                const result = await fastify.sipManager.patronStatus(branchId, patronBarcode, language);
                return result;
            } catch (err: unknown) {
                return handleSipError(err, fastify, reply);
            }
        }
    });

    const FeePaidSchema = z.object({
        branchId: z.string().min(1).max(32).regex(SIP2_SAFE).default('main'),
        patronBarcode: z.string().min(1).max(30).regex(SIP2_SAFE),
        feeId: z.string().min(1).max(30).regex(SIP2_SAFE),
        amount: z.string().min(1).max(10).regex(/^\d+(\.\d{1,2})?$/, 'amount must be a valid monetary value (e.g. 1.00)'),
        feeType: z.enum(['01','02','03','04','05','06','07','08','09']).optional().default('01'),
        paymentType: z.enum(['00','01','02']).optional().default('00'),
        currencyType: z.string().length(3).regex(/^[A-Z]{3}$/).optional().default('USD'),
    });

    fastify.post('/patron/fee-paid', {
        handler: async (request, reply) => {
            try {
                const { branchId, patronBarcode, feeId, amount, feeType, paymentType, currencyType } = FeePaidSchema.parse(request.body);
                const result = await fastify.sipManager.feePaid(branchId, patronBarcode, feeId, amount, feeType, paymentType, currencyType);
                return result;
            } catch (err: unknown) {
                return handleSipError(err, fastify, reply);
            }
        }
    });

    const PatronInformationSchema = z.object({
        branchId: z.string().min(1).max(32).regex(SIP2_SAFE).default('main'),
        patronBarcode: z.string().min(1).max(30).regex(SIP2_SAFE),
        summary: z.object({
            holds:   z.boolean().optional(),
            overdue: z.boolean().optional(),
            charged: z.boolean().optional(),
            fines:   z.boolean().optional(),
            recall:  z.boolean().optional(),
        }).optional(),
        startItem: z.number().int().positive().max(9999).default(1),
        endItem:   z.number().int().positive().max(9999).default(5),
        language: z.string().regex(/^\d{3}$/).optional().default('001'),
    });

    fastify.post('/patron/information', {
        handler: async (request, reply) => {
            try {
                const { branchId, patronBarcode, summary, startItem, endItem, language } = PatronInformationSchema.parse(request.body);
                const result = await fastify.sipManager.patronInformation(branchId, patronBarcode, summary ?? {}, startItem, endItem, language);
                return result;
            } catch (err: unknown) {
                return handleSipError(err, fastify, reply);
            }
        }
    });

    const EndSessionSchema = z.object({
        branchId: z.string().min(1).max(32).regex(SIP2_SAFE).default('main'),
        patronBarcode: z.string().min(1).max(30).regex(SIP2_SAFE),
    });

    fastify.post('/patron/end-session', {
        handler: async (request, reply) => {
            try {
                const { branchId, patronBarcode } = EndSessionSchema.parse(request.body);
                const result = await fastify.sipManager.endSession(branchId, patronBarcode);
                return result;
            } catch (err: unknown) {
                return handleSipError(err, fastify, reply);
            }
        }
    });

    const BlockPatronSchema = z.object({
        branchId:           z.string().min(1).max(32).regex(SIP2_SAFE).default('main'),
        patronBarcode:      z.string().min(1).max(30).regex(SIP2_SAFE),
        cardRetained:       z.boolean().optional().default(false),
        blockedCardMessage: z.string().max(100).regex(SIP2_SAFE).optional().default(''),
    });

    fastify.post('/patron/block', {
        handler: async (request, reply) => {
            try {
                const { branchId, patronBarcode, cardRetained, blockedCardMessage } = BlockPatronSchema.parse(request.body);
                await fastify.sipManager.blockPatron(branchId, patronBarcode, cardRetained, blockedCardMessage);
                return reply.code(204).send();
            } catch (err: unknown) {
                return handleSipError(err, fastify, reply);
            }
        }
    });

    const PatronEnableSchema = z.object({
        branchId:      z.string().min(1).max(32).regex(SIP2_SAFE).default('main'),
        patronBarcode: z.string().min(1).max(30).regex(SIP2_SAFE),
        patronPin:     z.string().min(1).max(30).regex(SIP2_SAFE).optional(),
    });

    fastify.post('/patron/enable', {
        handler: async (request, reply) => {
            try {
                const { branchId, patronBarcode, patronPin } = PatronEnableSchema.parse(request.body);
                const result = await fastify.sipManager.patronEnable(branchId, patronBarcode, patronPin);
                return result;
            } catch (err: unknown) {
                return handleSipError(err, fastify, reply);
            }
        }
    });
}
