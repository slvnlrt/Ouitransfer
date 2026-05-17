import { z } from "zod";

/**
 * Shared error response schema for all route error responses (4xx, 5xx).
 * Must match the shape returned by globalErrorHandler for AppError instances.
 *
 * The globalErrorHandler returns: { error, code?, statusCode?, details? }
 * Using this shared schema ensures the Zod serializer does not strip the
 * extra fields (code, statusCode, details) from error responses.
 */
export const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  statusCode: z.number().optional(),
  timestamp: z.string().optional(),
  details: z.unknown().optional(),
});
