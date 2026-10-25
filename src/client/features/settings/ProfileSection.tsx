import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Avatar, Box, Button, Card, Chip, Stack, TextField, Typography } from '@mui/material';
import VerifiedUserRoundedIcon from '@mui/icons-material/VerifiedUserRounded';
import { api, toApiError } from '../../services/api';
import { useAuth } from '../auth/AuthContext';
import { useFeedback } from '../../components/common/Feedback';
import { MediaUploadButton } from '../media/MediaUploadButton';
import { MediaImage } from '../media/MediaImage';
import { apiErrorMessage, mui } from './formUtils';
import { SettingsGroup } from './SettingsGroup';
import type { SettingsBundle, UserSettingsView } from './types';

const schema = z.object({ name: z.string().trim().min(1, 'Name is required').max(80) });
type Values = z.infer<typeof schema>;

const AVATAR = 104;

export function ProfileSection({ bundle, onChanged }: { bundle: SettingsBundle; onChanged: (update: (b: SettingsBundle) => SettingsBundle) => void }) {
  const { refresh } = useAuth();
  const { notify, confirm } = useFeedback();
  const { account, settings } = bundle;
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: account.name } });

  useEffect(() => reset({ name: account.name }), [account.name, reset]);

  const onSubmit = async (v: Values) => {
    try {
      const next = await api.patch<SettingsBundle['account']>('/settings/profile', v);
      onChanged((b) => ({ ...b, account: next }));
      void refresh();
      notify('Profile updated');
    } catch (e) {
      notify(apiErrorMessage(toApiError(e)), 'error');
    }
  };

  const setPhoto = async (profileMediaId: string | null) => {
    try {
      const next = await api.patch<UserSettingsView>('/settings', { profileMediaId });
      onChanged((b) => ({ ...b, settings: { ...b.settings, ...next } }));
      notify(profileMediaId ? 'Profile photo updated' : 'Profile photo removed');
    } catch (e) {
      notify(apiErrorMessage(toApiError(e)), 'error');
    }
  };

  const removePhoto = async () => {
    if (await confirm({ title: 'Remove profile photo?', confirmLabel: 'Remove', destructive: true })) await setPhoto(null);
  };

  return (
    <>
      <Card sx={{ mb: 3 }}>
        <Stack alignItems="center" sx={{ px: 2, pt: 3, pb: 2.5, textAlign: 'center' }}>
          <Box
            sx={{
              width: AVATAR,
              height: AVATAR,
              borderRadius: '50%',
              overflow: 'hidden',
              bgcolor: 'action.hover',
              boxShadow: (t) => `0 0 0 4px ${t.palette.background.paper}, 0 0 0 6px ${t.palette.primary.main}`,
              '& img': { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
            }}
          >
            {settings.profileMediaId ? (
              <MediaImage mediaId={settings.profileMediaId} alt={`${account.name} profile photo`} fit="cover" sx={{ width: AVATAR, height: AVATAR }} />
            ) : (
              <Avatar sx={{ width: AVATAR, height: AVATAR, fontSize: 40, fontWeight: 700, bgcolor: 'primary.main', color: '#fff' }} alt={account.name}>
                {account.name.slice(0, 1).toUpperCase()}
              </Avatar>
            )}
          </Box>
          <Typography sx={{ mt: 2, fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' }}>{account.name}</Typography>
          <Typography color="text.secondary" sx={{ wordBreak: 'break-all' }}>
            {account.email}
          </Typography>
          <Chip
            icon={<VerifiedUserRoundedIcon />}
            label={account.role === 'OWNER' ? 'Account owner' : 'Member'}
            size="small"
            color={account.role === 'OWNER' ? 'primary' : 'default'}
            variant="outlined"
            sx={{ mt: 1.25 }}
          />
          <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
            <MediaUploadButton
              kind="PROFILE"
              variant="outlined"
              label={settings.profileMediaId ? 'Change photo' : 'Add photo'}
              accept="image/*"
              onUploaded={(asset) => void setPhoto(asset.id)}
            />
            {settings.profileMediaId && (
              <Button color="error" onClick={() => void removePhoto()} sx={{ minHeight: 40 }}>
                Remove
              </Button>
            )}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
            Photos are stored privately and only shown to you.
          </Typography>
        </Stack>
      </Card>

      <SettingsGroup title="Display name" footer="Your email is used to sign in and can’t be changed here.">
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate sx={{ p: 2 }}>
          <TextField
            label="Name"
            size="medium"
            autoComplete="name"
            {...mui(register('name'))}
            error={!!errors.name}
            helperText={errors.name?.message}
          />
          <Button type="submit" variant="contained" fullWidth disabled={!isDirty || isSubmitting} sx={{ mt: 2, minHeight: 48 }}>
            {isSubmitting ? 'Saving…' : 'Save name'}
          </Button>
        </Box>
      </SettingsGroup>
    </>
  );
}
