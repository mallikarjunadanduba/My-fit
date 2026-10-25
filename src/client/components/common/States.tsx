import type { ReactNode } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import type { ApiError } from '../../services/api';

export function LoadingState({ label = 'Loading…', minHeight = 200 }: { label?: string; minHeight?: number }) {
  return (
    <Stack alignItems="center" justifyContent="center" spacing={2} sx={{ minHeight }} role="status" aria-live="polite">
      <CircularProgress size={32} />
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError | Error | string | null; onRetry?: () => void }) {
  const message = typeof error === 'string' ? error : (error?.message ?? 'Something went wrong');
  return (
    <Alert
      severity="error"
      action={
        onRetry ? (
          <Button color="inherit" size="small" onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    >
      {message}
    </Alert>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Stack alignItems="center" spacing={1.5} sx={{ py: 5, px: 2, textAlign: 'center' }}>
      <Box sx={{ color: 'text.secondary', fontSize: 44, display: 'flex' }}>{icon ?? <InboxOutlinedIcon fontSize="inherit" />}</Box>
      <Typography variant="subtitle1">{title}</Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
          {description}
        </Typography>
      )}
      {action}
    </Stack>
  );
}
