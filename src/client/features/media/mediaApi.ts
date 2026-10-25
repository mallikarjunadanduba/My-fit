import { useEffect, useState } from 'react';
import { api, http, toApiError } from '../../services/api';

export type MediaKind = 'PROGRESS_PHOTO' | 'WORKOUT_REFERENCE' | 'FOOD_REFERENCE' | 'PROFILE' | 'OTHER';

/** Shape returned by POST /api/media, GET /api/media and GET /api/media/:id. */
export interface MediaAsset {
  id: string;
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  originalName: string | null;
  notes: string | null;
  takenAt: string | null;
  createdAt: string;
  /** Time-limited presigned URL — never store it; refetch when it expires. */
  url: string;
  urlExpiresAt: string;
}

export interface MediaStatus {
  configured: boolean;
  bucket: string | null;
  /** true = bucket policy allows anonymous reads; null = unknown. */
  publicReadPolicyDetected: boolean | null;
  maxBytes: number;
  allowedTypes: string[];
  signedUrlTtlSeconds: number;
}

/** `image/*` so phones offer the camera; type is validated against ALLOWED_IMAGE_TYPES before upload. */
export const DEFAULT_ACCEPT = 'image/*';
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

let statusCache: { at: number; promise: Promise<MediaStatus> } | null = null;

/** GET /api/media/status, shared across components for 5 minutes. */
export function fetchMediaStatus(force = false): Promise<MediaStatus> {
  if (!force && statusCache && Date.now() - statusCache.at < 5 * 60_000) return statusCache.promise;
  const promise = api.get<MediaStatus>('/media/status');
  statusCache = { at: Date.now(), promise };
  promise.catch(() => {
    statusCache = null;
  });
  return promise;
}

export function useMediaStatus() {
  const [status, setStatus] = useState<MediaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchMediaStatus()
      .then((s) => alive && setStatus(s))
      .catch((e) => alive && setError(toApiError(e).message));
    return () => {
      alive = false;
    };
  }, []);
  return { status, error };
}

export async function uploadMediaFile(
  file: File,
  kind: MediaKind,
  opts: { notes?: string; takenAt?: string; onProgress?: (pct: number) => void; signal?: AbortSignal } = {},
): Promise<MediaAsset> {
  const form = new FormData();
  form.append('kind', kind);
  if (opts.notes) form.append('notes', opts.notes);
  if (opts.takenAt) form.append('takenAt', opts.takenAt);
  form.append('file', file);
  const res = await http.post<{ data: MediaAsset }>('/media', form, {
    signal: opts.signal,
    onUploadProgress: (e) => {
      if (e.total) opts.onProgress?.(Math.round((e.loaded / e.total) * 100));
    },
  });
  return res.data.data;
}

// Signed-URL cache shared by <MediaImage>, refreshed a minute before expiry.
const urlCache = new Map<string, { asset: MediaAsset; expires: number }>();
const inflight = new Map<string, Promise<MediaAsset>>();

export function primeMediaCache(asset: MediaAsset) {
  urlCache.set(asset.id, { asset, expires: new Date(asset.urlExpiresAt).getTime() - 60_000 });
}

export function forgetMedia(id: string) {
  urlCache.delete(id);
}

// Requests made in the same tick are coalesced into one GET /api/media/batch call (a list of photos or
// exercise thumbnails costs one request instead of one per image).
let queue: { id: string; resolve: (a: MediaAsset) => void; reject: (e: unknown) => void }[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_MAX = 50;

function flush() {
  flushTimer = null;
  const pending = queue;
  queue = [];
  for (let i = 0; i < pending.length; i += BATCH_MAX) {
    const chunk = pending.slice(i, i + BATCH_MAX);
    const ids = [...new Set(chunk.map((q) => q.id))];
    api
      .get<MediaAsset[]>('/media/batch', { ids: ids.join(',') })
      .then((assets) => {
        const byId = new Map(assets.map((a) => [a.id, a]));
        for (const q of chunk) {
          const a = byId.get(q.id);
          if (a) {
            primeMediaCache(a);
            q.resolve(a);
          } else q.reject(new Error('Media not found'));
        }
      })
      .catch((e: unknown) => chunk.forEach((q) => q.reject(e)));
  }
}

export function getMediaAsset(id: string, force = false): Promise<MediaAsset> {
  const hit = urlCache.get(id);
  if (!force && hit && hit.expires > Date.now()) return Promise.resolve(hit.asset);
  const pending = inflight.get(id);
  if (pending) return pending;
  const p = new Promise<MediaAsset>((resolve, reject) => {
    queue.push({ id, resolve, reject });
    flushTimer ??= setTimeout(flush, 0);
  }).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

export async function deleteMediaAsset(id: string) {
  await api.delete(`/media/${id}`);
  forgetMedia(id);
}

export const formatBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
