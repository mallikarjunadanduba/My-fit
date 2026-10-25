import { useId, useRef, useState } from 'react';
import { Alert, Box, Button, LinearProgress, Stack, Typography } from '@mui/material';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import { toApiError } from '../../services/api';
import { ALLOWED_IMAGE_TYPES, DEFAULT_ACCEPT, DEFAULT_MAX_BYTES, fetchMediaStatus, formatBytes, primeMediaCache, uploadMediaFile, type MediaAsset, type MediaKind } from './mediaApi';

export interface MediaUploadButtonProps {
  kind: MediaKind;
  onUploaded: (asset: MediaAsset) => void;
  label?: string;
  /** File-picker accept attribute (default `image/*` so phones offer the camera). Server accepts JPEG, PNG and WebP. */
  accept?: string;
  notes?: string;
  takenAt?: string;
  disabled?: boolean;
  size?: 'small' | 'medium' | 'large';
  variant?: 'text' | 'outlined' | 'contained';
}

const NOT_CONFIGURED =
  'Photo storage is not set up on the server yet, so uploads are unavailable. Ask the app owner to configure the media bucket.';

function friendlyError(err: unknown): string {
  const e = toApiError(err);
  if (e.code === 'STORAGE_NOT_CONFIGURED') return NOT_CONFIGURED;
  if (e.status === 413) return 'That file is too large. Please choose a smaller image.';
  if (e.status === 415) return 'Only JPEG, PNG or WebP images can be uploaded.';
  return e.message;
}

/**
 * File picker that validates type/size on the client, uploads to POST /api/media with progress,
 * and calls `onUploaded` with the stored asset (including a short-lived signed URL).
 */
export function MediaUploadButton({
  kind,
  onUploaded,
  label = 'Upload photo',
  accept = DEFAULT_ACCEPT,
  notes,
  takenAt,
  disabled,
  size = 'medium',
  variant = 'outlined',
}: MediaUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    const status = await fetchMediaStatus().catch(() => null);
    const maxBytes = status?.maxBytes ?? DEFAULT_MAX_BYTES;
    const allowed = status?.allowedTypes ?? ALLOWED_IMAGE_TYPES;
    if (status && !status.configured) {
      setError(NOT_CONFIGURED);
      return;
    }
    if (!allowed.includes(file.type)) {
      setError(`"${file.name}" is not a supported image. Use JPEG, PNG or WebP${file.type === 'image/heic' ? ' (HEIC photos can be exported as JPEG from your phone)' : ''}.`);
      return;
    }
    if (file.size > maxBytes) {
      setError(`"${file.name}" is ${formatBytes(file.size)}; the limit is ${formatBytes(maxBytes)}.`);
      return;
    }
    setProgress(0);
    try {
      const asset = await uploadMediaFile(file, kind, { notes, takenAt, onProgress: setProgress });
      primeMediaCache(asset);
      onUploaded(asset);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setProgress(null);
    }
  };

  const busy = progress !== null;
  return (
    <Box>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        hidden
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void handleFile(f);
        }}
      />
      <Button
        variant={variant}
        size={size}
        startIcon={<CloudUploadOutlinedIcon />}
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        sx={{ minHeight: 44 }}
      >
        {busy ? 'Uploading…' : label}
      </Button>
      {busy && (
        <Stack spacing={0.5} sx={{ mt: 1, maxWidth: 260 }}>
          <LinearProgress variant="determinate" value={progress ?? 0} aria-label="Upload progress" />
          <Typography variant="caption" color="text.secondary">
            {progress}% uploaded
          </Typography>
        </Stack>
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
    </Box>
  );
}

export default MediaUploadButton;
