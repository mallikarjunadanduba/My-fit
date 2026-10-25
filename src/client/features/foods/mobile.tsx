import { useState, type ReactNode } from 'react';
import { Box, ButtonBase, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Stack } from '@mui/material';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';

/** Minimum touch target (44×44 px) for icon buttons and small controls. */
export const TAP = { minWidth: 44, minHeight: 44 } as const;

export interface OverflowAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  hidden?: boolean;
}

/** Row-level ⋮ menu: secondary and destructive actions live here instead of a row of icon buttons. */
export function OverflowMenu({ label, actions, edge }: { label: string; actions: OverflowAction[]; edge?: 'end' | false }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const visible = actions.filter((a) => !a.hidden);
  return (
    <>
      <IconButton
        aria-label={label}
        aria-haspopup="menu"
        edge={edge === false ? false : 'end'}
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(e.currentTarget);
        }}
        sx={TAP}
      >
        <MoreVertRoundedIcon />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        onClick={(e) => e.stopPropagation()}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {visible.map((a) => (
          <MenuItem
            key={a.label}
            disabled={a.disabled}
            onClick={() => {
              setAnchor(null);
              a.onClick();
            }}
            sx={{
              minHeight: 48,
              ...(a.destructive ? { color: 'error.main' } : {}),
            }}
          >
            {a.icon && <ListItemIcon sx={a.destructive ? { color: 'error.main' } : undefined}>{a.icon}</ListItemIcon>}
            <ListItemText>{a.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

/** Single-line, horizontally swipeable row (category chips etc.) that bleeds to the screen edges on phones. */
export function HScroll({ children, label }: { children: ReactNode; label: string }) {
  return (
    <Box
      role="group"
      aria-label={label}
      sx={{
        display: 'flex',
        gap: 1,
        overflowX: 'auto',
        mx: { xs: -2, md: 0 },
        px: { xs: 2, md: 0 },
        py: 0.5,
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
        '& > *': { flexShrink: 0 },
      }}
    >
      {children}
    </Box>
  );
}

/**
 * Tappable list row with trailing actions laid out side by side (no absolutely positioned secondary action,
 * so long content can never slide under the buttons). Renders an <li>; put it directly inside a <List>.
 */
export function ActionRow({
  onClick,
  label,
  trailing,
  children,
  dim,
  divider,
}: {
  onClick?: () => void;
  label?: string;
  trailing?: ReactNode;
  children: ReactNode;
  dim?: boolean;
  divider?: boolean;
}) {
  return (
    <Box
      component="li"
      sx={{
        listStyle: 'none',
        display: 'flex',
        alignItems: 'center',
        opacity: dim ? 0.6 : 1,
        borderTop: divider ? 1 : 0,
        borderColor: 'divider',
      }}
    >
      {onClick ? (
        <ButtonBase
          onClick={onClick}
          aria-label={label}
          sx={{
            flex: 1,
            minWidth: 0,
            minHeight: 56,
            justifyContent: 'flex-start',
            textAlign: 'left',
            pl: 2,
            pr: 1,
            py: 1.25,
            gap: 1.5,
          }}
        >
          {children}
        </ButtonBase>
      ) : (
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            minHeight: 56,
            display: 'flex',
            alignItems: 'center',
            pl: 2,
            pr: 1,
            py: 1.25,
            gap: 1.5,
          }}
        >
          {children}
        </Box>
      )}
      {trailing && (
        <Stack direction="row" alignItems="center" sx={{ pr: 0.5, flexShrink: 0 }}>
          {trailing}
        </Stack>
      )}
    </Box>
  );
}
