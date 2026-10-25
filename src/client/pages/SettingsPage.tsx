import { useSearchParams } from 'react-router-dom';
import { Box } from '@mui/material';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useAuth } from '../features/auth/AuthContext';
import { PageHeader } from '../components/common/PageHeader';
import { SectionTabs, usePhone } from '../components/common/mobile';
import { ErrorState, LoadingState } from '../components/common/States';
import { TargetsSection } from '../features/settings/TargetsSection';
import { PreferencesSection } from '../features/settings/PreferencesSection';
import { ProfileSection } from '../features/settings/ProfileSection';
import { SecuritySection } from '../features/settings/SecuritySection';
import { InvitationsSection } from '../features/settings/InvitationsSection';
import type { SettingsBundle } from '../features/settings/types';

// ≤ 4 tabs so they fit full-width on phones; profile + security live together under "Account".
const TABS = [
  { value: 'targets', label: 'Targets' },
  { value: 'general', label: 'General' },
  { value: 'account', label: 'Account' },
  { value: 'invites', label: 'Invites', ownerOnly: true },
] as const;

type TabId = (typeof TABS)[number]['value'];

/** Older links (?tab=preferences / profile / security / invitations) keep working. */
const ALIASES: Record<string, TabId> = { preferences: 'general', profile: 'account', security: 'account', invitations: 'invites' };

export default function SettingsPage() {
  const { user } = useAuth();
  const phone = usePhone();
  const [params, setParams] = useSearchParams();
  const bundle = useAsync(() => api.get<SettingsBundle>('/settings'), [], { cacheKey: 'settings:bundle' });

  const tabs = TABS.filter((t) => !('ownerOnly' in t) || user?.role === 'OWNER');
  const raw = params.get('tab');
  const requested = (raw && (ALIASES[raw] ?? raw)) as TabId | null;
  const tab: TabId = tabs.some((t) => t.value === requested) ? requested! : 'targets';

  const reload = () => void bundle.reload();
  const patchBundle = (update: (b: SettingsBundle) => SettingsBundle) => bundle.setData((cur) => (cur ? update(cur) : cur));

  let body = null;
  if (tab === 'invites') body = <InvitationsSection />;
  else if (bundle.loading && !bundle.data) body = <LoadingState label="Loading settings…" />;
  else if (!bundle.data) body = <ErrorState error={bundle.error ?? 'Settings unavailable'} onRetry={reload} />;
  else if (tab === 'targets') body = <TargetsSection targets={bundle.data.targets} onChanged={reload} />;
  else if (tab === 'general')
    body = <PreferencesSection settings={bundle.data.settings} onSaved={(settings) => patchBundle((b) => ({ ...b, settings }))} />;
  else
    body = (
      <>
        <ProfileSection bundle={bundle.data} onChanged={patchBundle} />
        <SecuritySection />
      </>
    );

  return (
    <Box>
      {/* Phone: the negative margin pulls the (sticky) tabs flush under the app bar. */}
      <Box sx={{ mb: { xs: -3.5, md: 0 } }}>
        <PageHeader title="Settings" subtitle={phone ? undefined : 'Targets, preferences, profile and account security.'} />
      </Box>
      <SectionTabs
        value={tab}
        onChange={(v) => {
          setParams(v === 'targets' ? {} : { tab: v }, { replace: true });
          window.scrollTo({ top: 0 });
        }}
        tabs={tabs.map(({ value, label }) => ({ value, label }))}
        ariaLabel="Settings sections"
      />
      <Box role="tabpanel" aria-label={tabs.find((t) => t.value === tab)?.label} sx={{ maxWidth: tab === 'targets' ? 1100 : 760 }}>
        {body}
      </Box>
    </Box>
  );
}
