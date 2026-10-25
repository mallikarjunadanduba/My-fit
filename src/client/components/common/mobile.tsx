import type { ReactElement, ReactNode } from 'react';
import {
  AppBar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Fab,
  IconButton,
  Tab,
  Tabs,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
  type DialogProps,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';

/**
 * Shared phone-first building blocks. The app is used primarily on phones (360–430px):
 * use these instead of hand-rolled dialogs, FABs and tab bars so every screen behaves the same.
 */

/** Height of the phone bottom navigation + safe area; anything fixed at the bottom must sit above it. */
export const BOTTOM_NAV_OFFSET = 'calc(65px + env(safe-area-inset-bottom))';
/** Height of the phone top app bar + safe area (for sticky elements). */
export const TOP_BAR_OFFSET = 'calc(56px + env(safe-area-inset-top))';

export const visuallyHiddenSx = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  m: '-1px',
  p: 0,
  border: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  clip: 'rect(0 0 0 0)',
} as const;

/** True on phones (below the `md` breakpoint, where the bottom navigation is shown). */
export function usePhone() {
  return useMediaQuery(useTheme().breakpoints.down('md'));
}

/** True on small phones/portrait (below `sm`), where dialogs go full-screen. */
export function useSmallScreen() {
  return useMediaQuery(useTheme().breakpoints.down('sm'));
}

interface ResponsiveDialogProps extends Omit<DialogProps, 'title' | 'children'> {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Footer buttons. On phones they render in a sticky bar at the bottom of the sheet. */
  actions?: ReactNode;
  /** Optional primary action shown in the phone header (e.g. "Save"). */
  headerAction?: ReactNode;
}

/**
 * Dialog that becomes a full-screen sheet on phones: header with close button and title,
 * scrollable body, actions pinned to the bottom (thumb reach). Centered dialog on larger screens.
 */
export function ResponsiveDialog({ title, onClose, children, actions, headerAction, maxWidth = 'sm', ...rest }: ResponsiveDialogProps) {
  const full = useSmallScreen();
  return (
    <Dialog onClose={onClose} fullScreen={full} fullWidth maxWidth={maxWidth} {...rest}>
      {full ? (
        <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', pt: 'env(safe-area-inset-top)' }}>
          <Toolbar sx={{ gap: 1, minHeight: 56 }}>
            <IconButton edge="start" aria-label="Close" onClick={onClose} sx={{ width: 44, height: 44 }}>
              <CloseRoundedIcon />
            </IconButton>
            <Typography variant="h6" component="h2" sx={{ flex: 1, minWidth: 0, fontSize: 18 }} noWrap>
              {title}
            </Typography>
            {headerAction}
          </Toolbar>
        </AppBar>
      ) : (
        <DialogTitle sx={{ pr: 7 }}>
          {title}
          <IconButton aria-label="Close" onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12 }}>
            <CloseRoundedIcon />
          </IconButton>
        </DialogTitle>
      )}
      <DialogContent dividers={!full} sx={full ? { px: 2, py: 2 } : undefined}>
        {children}
      </DialogContent>
      {actions && (
        <DialogActions
          sx={
            full
              ? {
                  position: 'sticky',
                  bottom: 0,
                  bgcolor: 'background.paper',
                  borderTop: 1,
                  borderColor: 'divider',
                  px: 2,
                  pt: 1.5,
                  pb: 'calc(12px + env(safe-area-inset-bottom))',
                  gap: 1,
                  '& > .MuiButton-root': { flex: 1, minHeight: 48 },
                }
              : undefined
          }
        >
          {actions}
        </DialogActions>
      )}
    </Dialog>
  );
}

/**
 * Primary page action. Phone: floating action button above the bottom navigation (thumb reach).
 * Larger screens: a regular contained button rendered where it is placed.
 */
export function PrimaryAction({ icon, label, onClick, disabled }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  const phone = usePhone();
  if (!phone) {
    return (
      <Button variant="contained" startIcon={icon} onClick={onClick} disabled={disabled}>
        {label}
      </Button>
    );
  }
  return (
    <Fab
      variant="extended"
      color="primary"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      sx={{ position: 'fixed', right: 16, bottom: `calc(${BOTTOM_NAV_OFFSET} + 16px)`, zIndex: 1050, gap: 1, boxShadow: '0 8px 24px rgba(0,175,181,0.4)' }}
    >
      {icon}
      {label}
    </Fab>
  );
}

/** Spacer so the last content isn't hidden behind a PrimaryAction FAB on phones. */
export function FabSpacer() {
  const phone = usePhone();
  return phone ? <Box sx={{ height: 72 }} aria-hidden /> : null;
}

/**
 * Section tabs. Phone: sticky under the top app bar, full-width when there are ≤ 4 tabs,
 * otherwise horizontally swipeable.
 */
export function SectionTabs<T extends string>({
  value,
  onChange,
  tabs,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: string; icon?: ReactElement }[];
  ariaLabel: string;
}) {
  const phone = usePhone();
  const few = tabs.length <= 4;
  return (
    <Box
      sx={{
        position: phone ? 'sticky' : 'static',
        top: phone ? TOP_BAR_OFFSET : undefined,
        zIndex: 5,
        mx: phone ? -2 : 0,
        mb: 2,
        bgcolor: 'background.default',
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Tabs
        value={value}
        onChange={(_, v: T) => onChange(v)}
        aria-label={ariaLabel}
        variant={phone && few ? 'fullWidth' : 'scrollable'}
        scrollButtons={false}
        sx={{ minHeight: 48, '& .MuiTab-root': { minHeight: 48, px: phone ? 1.5 : 2, fontSize: 14 } }}
      >
        {tabs.map((t) => (
          <Tab key={t.value} value={t.value} label={t.label} icon={t.icon} iconPosition="start" />
        ))}
      </Tabs>
    </Box>
  );
}
