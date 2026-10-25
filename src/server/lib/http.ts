import type { Request, Response } from 'express';
import { z, type ZodTypeAny } from 'zod';

/**
 * Response envelope used by every endpoint:
 *   success → { data, meta? }
 *   failure → { error: { code, message, details? } }
 */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Forbidden') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);

export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>) {
  return res.json(meta ? { data, meta } : { data });
}

export function created<T>(res: Response, data: T) {
  return res.status(201).json({ data });
}

export function noContent(res: Response) {
  return res.status(204).end();
}

function parseWith<S extends ZodTypeAny>(schema: S, input: unknown, where: string): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError(400, 'VALIDATION_ERROR', `Invalid ${where}`, result.error.flatten());
  }
  return result.data;
}

export const parseBody = <S extends ZodTypeAny>(req: Request, schema: S) => parseWith(schema, req.body ?? {}, 'request body');
export const parseQuery = <S extends ZodTypeAny>(req: Request, schema: S) => parseWith(schema, req.query, 'query parameters');
export const parseParams = <S extends ZodTypeAny>(req: Request, schema: S) => parseWith(schema, req.params, 'path parameters');

export const idParam = z.object({ id: z.string().uuid() });

/** Standard pagination query: ?page=1&pageSize=20 */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export function pageMeta(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
