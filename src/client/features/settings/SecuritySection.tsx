import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Chip, Divider, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Stack } from '@mui/material';
import DevicesRoundedIcon from '@mui/icons-material/DevicesRounded';
import SmartphoneRoundedIcon from '@mui/icons-material/SmartphoneRounded';
import ComputerRoundedIcon from '@mui/icons-material/ComputerRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import { api, toApiError } from '../../services/api';
import { formatInstant } from '../../services/dates';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../auth/AuthContext';
import { useFeedback } from '../../components/common/Feedback';
import { EmptyState, ErrorState, LoadingState } from '../../components/common/States';
import { PASSWORD_MIN, PasswordField, apiErrorMessage, mui } from './formUtils';
import { RowMenu, SettingsGroup } from './SettingsGroup';
import type { ActiveSession } from './types';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z.string().min(PASSWORD_MIN, `At least ${PASSWORD_MIN} characters`).max(200),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: 'Choose a different password' });
type Values = z.infer<typeof schema>;

/** Short, readable device description from a user-agent string. */
function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
  return browser || os ? [browser, os].filter(Boolean).join(' on ') : ua.slice(0, 60);
}

const isMobileAgent = (ua: string | null) => !!ua && /Android|iPhone|iPad|Mobile/.test(ua);

export function SecuritySection() {
  const { timezone, logout } = useAuth();
  const { notify, confirm } = useFeedback();
  const navigate = useNavigate();
  const sessions = useAsync(() => api.get<ActiveSession[]>('/settings/sessions'), [], { cacheKey: 'settings:sessions' });
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });

  const onSubmit = async (v: Values) => {
    try {
      const res = await api.post<{ otherSessionsRevoked: number }>('/auth/change-password', {
        currentPassword: v.currentPassword,
        newPassword: v.newPassword,
      });
      reset();
      const n = res?.otherSessionsRevoked ?? 0;
      notify(n ? `Password changed. Signed out ${n} other session${n === 1 ? '' : 's'}.` : 'Password changed.');
      void sessions.reload();
    } catch (e) {
      notify(apiErrorMessage(toApiError(e)), 'error');
    }
  };

  const revoke = async (s: ActiveSession) => {
    const ok = await confirm({
      title: 'Sign out this device?',
      message: `${describeAgent(s.userAgent)} will need to sign in again.`,
      confirmLabel: 'Sign out',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/settings/sessions/${s.id}`);
      notify('Device signed out');
      sessions.setData((cur) => cur?.filter((x) => x.id !== s.id));
    } catch (e) {
      notify(apiErrorMessage(toApiError(e)), 'error');
    }
  };

  const signOut = async () => {
    if (!(await confirm({ title: 'Sign out of this device?', confirmLabel: 'Sign out' }))) return;
    await logout();
    navigate('/login', { replace: true });
  };

  let sessionList;
  if (sessions.loading && !sessions.data) sessionList = <LoadingState minHeight={120} />;
  else if (!sessions.data) sessionList = <ErrorState error={sessions.error ?? 'Sessions unavailable'} onRetry={() => void sessions.reload()} />;
  else if (!sessions.data.length) sessionList = <EmptyState title="No active sessions" icon={<DevicesRoundedIcon fontSize="inherit" />} />;
  else
    sessionList = (
      <List disablePadding>
        {sessions.data.map((s, i) => (
          <Box component="li" key={s.id} sx={{ listStyle: 'none' }}>
            {i > 0 && <Divider variant="inset" />}
            <ListItem
              component="div"
              sx={{ minHeight: 64, pr: s.current ? 14 : 7 }}
              secondaryAction={
                s.current ? (
                  <Chip size="small" color="primary" label="This device" />
                ) : (
                  <RowMenu
                    label={`Options for ${describeAgent(s.userAgent)}`}
                    items={[{ label: 'Sign out device', icon: <LogoutRoundedIcon fontSize="small" />, destructive: true, onClick: () => void revoke(s) }]}
                  />
                )
              }
            >
              <ListItemIcon sx={{ minWidth: 52 }}>
                <Box sx={{ width: 36, height: 36, borderRadius: 2.5, display: 'grid', placeItems: 'center', bgcolor: 'action.hover', color: 'text.secondary' }}>
                  {isMobileAgent(s.userAgent) ? <SmartphoneRoundedIcon fontSize="small" /> : <ComputerRoundedIcon fontSize="small" />}
                </Box>
              </ListItemIcon>
              <ListItemText
                primary={describeAgent(s.userAgent)}
                secondary={`Active ${formatInstant(s.lastSeenAt, timezone, 'd MMM, HH:mm')}${s.ip ? ` · ${s.ip}` : ''}`}
                slotProps={{ primary: { fontWeight: 600, noWrap: true }, secondary: { noWrap: true } }}
              />
            </ListItem>
          </Box>
        ))}
      </List>
    );

  return (
    <>
      <SettingsGroup title="Change password" footer="Changing your password signs out every other device.">
        <Stack component="form" spacing={2} sx={{ p: 2 }} onSubmit={handleSubmit(onSubmit)} noValidate>
          <PasswordField
            label="Current password"
            size="medium"
            autoComplete="current-password"
            {...mui(register('currentPassword'))}
            error={!!errors.currentPassword}
            helperText={errors.currentPassword?.message}
          />
          <PasswordField
            label="New password"
            size="medium"
            autoComplete="new-password"
            {...mui(register('newPassword'))}
            error={!!errors.newPassword}
            helperText={errors.newPassword?.message ?? `At least ${PASSWORD_MIN} characters`}
          />
          <PasswordField
            label="Confirm new password"
            size="medium"
            autoComplete="new-password"
            {...mui(register('confirm'))}
            error={!!errors.confirm}
            helperText={errors.confirm?.message}
          />
          <Button type="submit" variant="contained" disabled={isSubmitting} sx={{ minHeight: 48 }}>
            {isSubmitting ? 'Changing…' : 'Change password'}
          </Button>
        </Stack>
      </SettingsGroup>

      <SettingsGroup title="Signed-in devices">{sessionList}</SettingsGroup>

      <SettingsGroup>
        <ListItemButton onClick={() => void signOut()} sx={{ minHeight: 56, color: 'error.main', justifyContent: 'center', gap: 1, fontWeight: 700 }}>
          <LogoutRoundedIcon fontSize="small" />
          Sign out of this device
        </ListItemButton>
      </SettingsGroup>
    </>
  );
}
