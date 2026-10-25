import { Alert, AlertTitle } from '@mui/material';
import { useMediaStatus } from './mediaApi';

/** Warns when photo storage is unavailable or the bucket allows public reads. Renders nothing otherwise. */
export function MediaStatusBanner() {
  const { status } = useMediaStatus();
  if (!status) return null;
  if (!status.configured) {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        <AlertTitle>Photo storage is not configured</AlertTitle>
        Progress photos are unavailable until the server owner sets the media bucket environment variables. Measurements still work.
      </Alert>
    );
  }
  if (status.publicReadPolicyDetected) {
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        <AlertTitle>Photo privacy notice</AlertTitle>
        Your bucket allows public reads; photos use unguessable links but anyone with a link can view them. Remove the bucket&apos;s
        public-read policy for full privacy.
      </Alert>
    );
  }
  return null;
}
