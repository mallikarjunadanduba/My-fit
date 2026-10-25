import { useState, type FocusEvent } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Box, Button, Chip, Divider, IconButton, InputAdornment, List, ListItem, ListItemText, Stack, TextField, Typography } from '@mui/material';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import PersonAddAltRoundedIcon from '@mui/icons-material/PersonAddAltRounded';
import { api, toApiError } from '../../services/api';
import { formatInstant } from '../../services/dates';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../auth/AuthContext';
import { useFeedback } from '../../components/common/Feedback';
import { EmptyState, ErrorState, LoadingState } from '../../components/common/States';
import { apiErrorMessage, mui } from './formUtils';
import { RowMenu, SettingsGroup } from './SettingsGroup';
import type { InvitationView } from './types';

const schema = z.object({ email: z.string().trim().min(1, 'Email is required').email('Enter a valid email') });
type Values = z.infer<typeof schema>;

const STATUS: Record<InvitationView['status'], { label: string; color: 'primary' | 'success' | 'default' }> = {
  PENDING: { label: 'Pending', color: 'primary' },
  USED: { label: 'Accepted', color: 'success' },
  EXPIRED: { label: 'Expired', color: 'default' },
};

export function InvitationsSection() {
  const { timezone } = useAuth();
  const { notify, confirm } = useFeedback();
  const list = useAsync(() => api.get<InvitationView[]>('/auth/invitations'), [], { cacheKey: 'settings:invitations' });
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      notify('Invitation link copied');
    } catch {
      notify('Could not copy automatically — select the link and copy it manually.', 'warning');
    }
  };

  const onSubmit = async (v: Values) => {
    try {
      const inv = await api.post<InvitationView>('/auth/invitations', v);
      if (inv?.path) setLink({ email: inv.email, url: `${window.location.origin}${inv.path}` });
      reset();
      void list.reload();
    } catch (e) {
      notify(apiErrorMessage(toApiError(e)), 'error');
    }
  };

  const remove = async (inv: InvitationView) => {
    const pending = inv.status === 'PENDING';
    const ok = await confirm({
      title: pending ? 'Revoke invitation?' : 'Remove invitation record?',
      message: pending ? `The link sent to ${inv.email} will stop working.` : undefined,
      confirmLabel: pending ? 'Revoke' : 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/auth/invitations/${inv.id}`);
      notify(pending ? 'Invitation revoked' : 'Invitation removed');
      list.setData((cur) => cur?.filter((x) => x.id !== inv.id));
    } catch (e) {
      notify(apiErrorMessage(toApiError(e)), 'error');
    }
  };

  let invites;
  if (list.loading && !list.data) invites = <LoadingState minHeight={120} />;
  else if (!list.data) invites = <ErrorState error={list.error ?? 'Invitations unavailable'} onRetry={() => void list.reload()} />;
  else if (!list.data.length)
    invites = <EmptyState title="No invitations yet" description="Invite a family member or training partner above." />;
  else
    invites = (
      <List disablePadding>
        {list.data.map((inv, i) => (
          <Box component="li" key={inv.id} sx={{ listStyle: 'none' }}>
            {i > 0 && <Divider />}
            <ListItem
              component="div"
              sx={{ minHeight: 64, pr: 7 }}
              secondaryAction={
                <RowMenu
                  label={`Options for invitation to ${inv.email}`}
                  items={[
                    {
                      label: inv.status === 'PENDING' ? 'Revoke invitation' : 'Remove from list',
                      icon: <DeleteOutlineRoundedIcon fontSize="small" />,
                      destructive: true,
                      onClick: () => void remove(inv),
                    },
                  ]}
                />
              }
            >
              <ListItemText
                primary={
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                    <Typography component="span" fontWeight={600} noWrap sx={{ minWidth: 0 }}>
                      {inv.email}
                    </Typography>
                    <Chip size="small" label={STATUS[inv.status].label} color={STATUS[inv.status].color} sx={{ flexShrink: 0 }} />
                  </Stack>
                }
                secondary={
                  inv.status === 'USED'
                    ? `Accepted ${formatInstant(inv.usedAt, timezone, 'd MMM yyyy')}`
                    : `${inv.status === 'EXPIRED' ? 'Expired' : 'Expires'} ${formatInstant(inv.expiresAt, timezone, 'd MMM, HH:mm')}`
                }
                slotProps={{ secondary: { noWrap: true } }}
              />
            </ListItem>
          </Box>
        ))}
      </List>
    );

  return (
    <>
      <SettingsGroup title="Invite someone" footer="Creates a one-time link valid for 7 days. Each member gets their own private data, meal plan and targets.">
        <Stack component="form" spacing={1.5} sx={{ p: 2 }} onSubmit={handleSubmit(onSubmit)} noValidate>
          <TextField
            label="Email"
            type="email"
            size="medium"
            autoComplete="off"
            inputMode="email"
            {...mui(register('email'))}
            error={!!errors.email}
            helperText={errors.email?.message}
          />
          <Button type="submit" variant="contained" startIcon={<PersonAddAltRoundedIcon />} disabled={isSubmitting} sx={{ minHeight: 48 }}>
            {isSubmitting ? 'Creating…' : 'Create invite link'}
          </Button>
          {link && (
            <Alert severity="success" onClose={() => setLink(null)}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Link for <b>{link.email}</b>. Copy it now — it is shown only once.
              </Typography>
              <TextField
                value={link.url}
                aria-label="Invitation link"
                slotProps={{
                  htmlInput: { readOnly: true, onFocus: (e: FocusEvent<HTMLInputElement>) => e.target.select() },
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton aria-label="Copy invitation link" onClick={() => void copy(link.url)} edge="end">
                          <ContentCopyRoundedIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />
            </Alert>
          )}
        </Stack>
      </SettingsGroup>

      <SettingsGroup title="Invitations">{invites}</SettingsGroup>
    </>
  );
}
