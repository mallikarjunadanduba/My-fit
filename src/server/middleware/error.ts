import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { AppError } from '../lib/http';
import { UnitMismatchError } from '../../shared/nutrition';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let e: AppError;
  if (err instanceof AppError) e = err;
  else if (err instanceof UnitMismatchError || err instanceof RangeError) e = new AppError(400, 'BAD_REQUEST', err.message);
  else if (err instanceof MulterError) {
    e = new AppError(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'UPLOAD_ERROR', err.message);
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') e = new AppError(404, 'NOT_FOUND', 'Record not found');
    else if (err.code === 'P2002') e = new AppError(409, 'CONFLICT', 'A record with these values already exists');
    else if (err.code === 'P2003') e = new AppError(409, 'CONFLICT', 'Related record is missing or still in use');
    else e = new AppError(500, 'DB_ERROR', 'Database error');
  } else if (typeof err === 'object' && err && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
    e = new AppError(400, 'BAD_JSON', 'Malformed JSON body');
  } else if (typeof err === 'object' && err && 'type' in err && (err as { type: string }).type === 'entity.too.large') {
    e = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
  } else {
    e = new AppError(500, 'INTERNAL', 'Something went wrong');
  }

  if (e.status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}`, err);

  res.status(e.status).json({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } });
}
