import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Stack, TextField, Typography } from '@mui/material';
import MailRoundedIcon from '@mui/icons-material/MailRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import { api, toApiError } from '../services/api';
import { useAuth } from '../features/auth/AuthContext';
import { AuthCard } from '../features/settings/AuthCard';
import { PasswordField, apiErrorMessage, authButtonSx, iconSlot, mui } from '../features/settings/formUtils';

const schema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});
type Values = z.infer<typeof schema>;

export default function LoginPage() {
  const { status, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  if (status?.setupRequired) return <Navigate to="/setup" replace />;

  const onSubmit = async (values: Values) => {
    setError(null);
    try {
      await api.post('/auth/login', values);
      await refresh();
      navigate(from && from.startsWith('/') && !from.startsWith('//') ? from : '/', { replace: true });
    } catch (e) {
      setError(apiErrorMessage(toApiError(e)));
    }
  };

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to keep today’s meals, workouts and alarms on track."
      footer={
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
          New here? Ask the account owner for an invitation link.
        </Typography>
      }
    >
      <Stack component="form" spacing={2.25} onSubmit={handleSubmit(onSubmit)} noValidate>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          size="medium"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          slotProps={iconSlot(<MailRoundedIcon />)}
          {...mui(register('email'))}
          error={!!errors.email}
          helperText={errors.email?.message}
        />
        <PasswordField
          size="medium"
          label="Password"
          autoComplete="current-password"
          slotProps={iconSlot(<LockRoundedIcon />)}
          {...mui(register('password'))}
          error={!!errors.password}
          helperText={errors.password?.message}
        />
        <Button type="submit" variant="contained" size="large" disabled={isSubmitting} sx={authButtonSx}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </Stack>
    </AuthCard>
  );
}
