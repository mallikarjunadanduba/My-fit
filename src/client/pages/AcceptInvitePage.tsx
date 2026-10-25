import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Stack, TextField } from '@mui/material';
import { api, toApiError } from '../services/api';
import { useAuth } from '../features/auth/AuthContext';
import { useAsync } from '../hooks/useAsync';
import { LoadingState } from '../components/common/States';
import { AuthCard } from '../features/settings/AuthCard';
import { PASSWORD_MIN, PasswordField, apiErrorMessage, authButtonSx, iconSlot, mui } from '../features/settings/formUtils';
import MailRoundedIcon from '@mui/icons-material/MailRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';

const schema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(80),
    password: z.string().min(PASSWORD_MIN, `At least ${PASSWORD_MIN} characters`).max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });
type Values = z.infer<typeof schema>;

export default function AcceptInvitePage() {
  const { token = '' } = useParams();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const check = useAsync(() => api.get<{ email: string; expiresAt: string }>(`/auth/invitations/${encodeURIComponent(token)}/check`), [token]);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: '', password: '', confirm: '' } });

  const onSubmit = async ({ name, password }: Values) => {
    setError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await api.post('/auth/accept-invite', { token, name, password, ...(timezone ? { timezone } : {}) });
      await refresh();
      navigate('/', { replace: true });
    } catch (e) {
      setError(apiErrorMessage(toApiError(e)));
    }
  };

  if (check.loading) {
    return (
      <AuthCard title="Checking invitation">
        <LoadingState label="Checking your invitation link…" minHeight={120} />
      </AuthCard>
    );
  }

  if (check.error || !check.data) {
    const invalid = check.error?.status === 404;
    return (
      <AuthCard
        title={invalid ? 'Invitation not valid' : 'Could not check invitation'}
        subtitle={
          invalid ? 'This link has expired, was already used, or was revoked. Ask the account owner for a new link.' : check.error?.message
        }
      >
        <Stack spacing={1.5}>
          {!invalid && (
            <Button variant="outlined" onClick={() => void check.reload()}>
              Try again
            </Button>
          )}
          <Button component={RouterLink} to="/login" variant="contained">
            Go to sign in
          </Button>
        </Stack>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Join MyFit Routine" subtitle={`You’ve been invited as ${check.data.email}. Choose your name and a password.`}>
      <Stack component="form" spacing={2.25} onSubmit={handleSubmit(onSubmit)} noValidate>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          size="medium"
          label="Email"
          value={check.data.email}
          disabled
          slotProps={{ ...iconSlot(<MailRoundedIcon />), htmlInput: { readOnly: true } }}
        />
        <TextField
          size="medium"
          label="Your name"
          autoComplete="name"
          autoCapitalize="words"
          {...mui(register('name'))}
          error={!!errors.name}
          helperText={errors.name?.message}
          slotProps={iconSlot(<PersonRoundedIcon />)}
        />
        <PasswordField
          size="medium"
          label="Password"
          autoComplete="new-password"
          {...mui(register('password'))}
          error={!!errors.password}
          helperText={errors.password?.message ?? `At least ${PASSWORD_MIN} characters`}
          slotProps={iconSlot(<LockRoundedIcon />)}
        />
        <PasswordField
          size="medium"
          label="Confirm password"
          autoComplete="new-password"
          {...mui(register('confirm'))}
          error={!!errors.confirm}
          helperText={errors.confirm?.message}
          slotProps={iconSlot(<LockRoundedIcon />)}
        />
        <Button type="submit" variant="contained" size="large" disabled={isSubmitting} sx={authButtonSx}>
          {isSubmitting ? 'Creating account…' : 'Create account'}
        </Button>
      </Stack>
    </AuthCard>
  );
}
