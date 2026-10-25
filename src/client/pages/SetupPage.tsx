import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Navigate, useNavigate } from 'react-router-dom';
import { Alert, Button, Stack, TextField, Typography } from '@mui/material';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import MailRoundedIcon from '@mui/icons-material/MailRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import { api, toApiError } from '../services/api';
import { useAuth } from '../features/auth/AuthContext';
import { AuthCard } from '../features/settings/AuthCard';
import { TimezoneSelect } from '../features/settings/TimezoneSelect';
import { PASSWORD_MIN, PasswordField, apiErrorMessage, authButtonSx, iconSlot, mui } from '../features/settings/formUtils';

const schema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(80),
    email: z.string().trim().min(1, 'Email is required').email('Enter a valid email'),
    password: z.string().min(PASSWORD_MIN, `At least ${PASSWORD_MIN} characters`).max(200),
    confirm: z.string(),
    timezone: z.string().min(1, 'Choose a timezone'),
    setupToken: z.string().trim().max(500),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });
type Values = z.infer<typeof schema>;


export default function SetupPage() {
  const { status, refresh } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '', confirm: '', timezone: 'Asia/Kolkata', setupToken: '' },
  });

  // Setup is only possible on an empty install.
  if (status && !status.setupRequired) return <Navigate to="/login" replace />;

  const onSubmit = async ({ confirm: _confirm, setupToken, ...values }: Values) => {
    setError(null);
    try {
      await api.post('/auth/setup', { ...values, ...(setupToken ? { setupToken } : {}) });
      await refresh();
      navigate('/', { replace: true });
    } catch (e) {
      setError(apiErrorMessage(toApiError(e)));
    }
  };

  return (
    <AuthCard
      title="Let’s set up your routine"
      subtitle="Create your account — everything below is ready for you and fully editable."
      highlights={['Coach’s meal plan', 'Nutrition targets', 'Daily routine', 'Meal & gym alarms']}
    >
      <Stack component="form" spacing={2.25} onSubmit={handleSubmit(onSubmit)} noValidate>
        {error && <Alert severity="error">{error}</Alert>}
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
        <TextField
          size="medium"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          {...mui(register('email'))}
          error={!!errors.email}
          helperText={errors.email?.message}
          slotProps={iconSlot(<MailRoundedIcon />)}
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
        <Controller
          control={control}
          name="timezone"
          render={({ field, fieldState }) => (
            <TimezoneSelect
              size="medium"
              value={field.value}
              onChange={field.onChange}
              error={!!fieldState.error}
              helperText={fieldState.error?.message ?? 'Sets your “today”, alarms and reports.'}
            />
          )}
        />
        {status?.setupTokenRequired && (
          <TextField
            size="medium"
            label="Setup token"
            autoComplete="off"
            autoCapitalize="none"
            {...mui(register('setupToken'))}
            error={!!errors.setupToken}
            helperText="Required on this server to create the first account."
            slotProps={iconSlot(<KeyRoundedIcon />)}
          />
        )}
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={isSubmitting}
          sx={authButtonSx}
        >
          {isSubmitting ? 'Setting things up…' : 'Create account'}
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', px: 1 }} role="status" aria-live="polite">
          {isSubmitting
            ? 'Loading your meal plan, foods, routine and alarms — this can take up to a minute. Please keep this screen open.'
            : 'Starter food values are estimates. Your targets only change when you edit them.'}
        </Typography>
      </Stack>
    </AuthCard>
  );
}
