import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { MediaKind } from '@prisma/client';
import { env } from '../env';
import { auth, requireOwner } from '../middleware/auth';
import { AppError, created, idParam, noContent, ok, paginationQuery, parseBody, parseParams, parseQuery } from '../lib/http';
import {
  cleanupOrphanMedia,
  deleteMedia,
  getMedia,
  getMediaBatch,
  getMediaStatus,
  listMedia,
  updateMedia,
  uploadMedia,
} from '../services/media.service';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MEDIA_MAX_BYTES, files: 1, fields: 10, fieldSize: 4096 },
});

const kindSchema = z.nativeEnum(MediaKind);
const notesSchema = z.string().trim().max(1000);
const takenAtSchema = z.string().datetime({ offset: true }).transform((s) => new Date(s));

const uploadFields = z.object({
  kind: kindSchema,
  notes: notesSchema.optional().transform((v) => (v ? v : null)),
  takenAt: z
    .union([takenAtSchema, z.literal('')])
    .optional()
    .transform((v) => (v instanceof Date ? v : null)),
});

/** Storage availability for the UI (never includes credentials). */
router.get('/status', async (_req, res) => {
  ok(res, getMediaStatus());
});

router.post('/', upload.single('file'), async (req, res) => {
  const { userId } = auth(req);
  if (!req.file) throw new AppError(400, 'FILE_REQUIRED', 'Attach an image in the "file" field.');
  const fields = parseBody(req, uploadFields);
  const asset = await uploadMedia({
    userId,
    kind: fields.kind,
    buffer: req.file.buffer,
    declaredMime: req.file.mimetype,
    originalName: req.file.originalname,
    notes: fields.notes,
    takenAt: fields.takenAt,
  });
  created(res, asset);
});

router.get('/', async (req, res) => {
  const q = parseQuery(req, paginationQuery.extend({ kind: kindSchema.optional(), pageSize: z.coerce.number().int().min(1).max(100).default(24) }));
  const { data, meta } = await listMedia(auth(req).userId, q);
  ok(res, data, meta);
});

/** Owner-only maintenance: remove uploads that never completed. */
router.post('/cleanup', requireOwner, async (req, res) => {
  const { olderThanHours } = parseBody(req, z.object({ olderThanHours: z.number().int().min(1).max(24 * 30).default(24) }));
  ok(res, await cleanupOrphanMedia(olderThanHours));
});

/** GET /api/media/batch?ids=a,b,c → assets (fresh signed URLs) for up to 50 ids in one request. */
router.get('/batch', async (req, res) => {
  const { ids } = parseQuery(
    req,
    z.object({
      ids: z
        .string()
        .max(50 * 37)
        .transform((v) => [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))])
        .pipe(z.array(z.string().uuid()).max(50)),
    }),
  );
  ok(res, await getMediaBatch(auth(req).userId, ids));
});

router.get('/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await getMedia(auth(req).userId, id));
});

router.patch('/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  const body = parseBody(
    req,
    z
      .object({ notes: notesSchema.nullable().optional(), takenAt: takenAtSchema.nullable().optional() })
      .strict()
      .refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
  );
  ok(res, await updateMedia(auth(req).userId, id, body));
});

router.delete('/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  await deleteMedia(auth(req).userId, id);
  noContent(res);
});

export default router;
