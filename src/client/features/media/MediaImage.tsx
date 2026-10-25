import { useEffect, useRef, useState } from 'react';
import { Box, Skeleton, Stack, Typography, type SxProps, type Theme } from '@mui/material';
import BrokenImageOutlinedIcon from '@mui/icons-material/BrokenImageOutlined';
import { getMediaAsset } from './mediaApi';

export interface MediaImageProps {
  mediaId: string;
  alt: string;
  sx?: SxProps<Theme>;
  /** CSS object-fit; defaults to cover. */
  fit?: 'cover' | 'contain';
  onClick?: () => void;
}

/**
 * Renders a stored image via a fresh signed URL (GET /api/media/:id).
 * If the image fails to load (e.g. the signed URL expired) it refetches a new URL once.
 */
export function MediaImage({ mediaId, alt, sx, fit = 'cover', onClick }: MediaImageProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const retried = useRef(false);

  useEffect(() => {
    let alive = true;
    retried.current = false;
    setUrl(null);
    setFailed(false);
    getMediaAsset(mediaId)
      .then((a) => alive && setUrl(a.url))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [mediaId]);

  const handleError = () => {
    if (retried.current) {
      setFailed(true);
      return;
    }
    retried.current = true;
    getMediaAsset(mediaId, true)
      .then((a) => setUrl(a.url))
      .catch(() => setFailed(true));
  };

  const base: SxProps<Theme> = { width: '100%', aspectRatio: '1 / 1', borderRadius: 2, overflow: 'hidden', display: 'block' };

  if (failed) {
    return (
      <Stack
        role="img"
        aria-label={`${alt} (unavailable)`}
        alignItems="center"
        justifyContent="center"
        spacing={0.5}
        sx={[base, { bgcolor: 'action.hover', color: 'text.secondary' }, ...(Array.isArray(sx) ? sx : [sx])]}
      >
        <BrokenImageOutlinedIcon />
        <Typography variant="caption">Image unavailable</Typography>
      </Stack>
    );
  }
  if (!url) return <Skeleton variant="rectangular" sx={[base, ...(Array.isArray(sx) ? sx : [sx])]} aria-label={`Loading ${alt}`} />;
  return (
    <Box
      component="img"
      src={url}
      alt={alt}
      loading="lazy"
      onError={handleError}
      onClick={onClick}
      sx={[base, { objectFit: fit, cursor: onClick ? 'pointer' : undefined }, ...(Array.isArray(sx) ? sx : [sx])]}
    />
  );
}

export default MediaImage;
