import { useState, type ReactNode } from 'react';
import { Box, Card, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';

/**
 * iOS/Material-style grouped section: small caption above one card that holds list rows.
 * Use for every settings block so the page reads as a native settings screen.
 */
export function SettingsGroup({ title, footer, children, action }: { title?: string; footer?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <Box component="section" sx={{ mb: 3 }}>
      {(title || action) && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 0.5, mb: 1, minHeight: 28 }}>
          {title && (
            <Typography component="h2" sx={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'text.secondary' }}>
              {title}
            </Typography>
          )}
          {action}
        </Box>
      )}
      <Card sx={{ overflow: 'hidden' }}>{children}</Card>
      {footer && (
        <Typography variant="body2" color="text.secondary" component="div" sx={{ px: 0.5, mt: 1, fontSize: 13 }}>
          {footer}
        </Typography>
      )}
    </Box>
  );
}

/** Tinted rounded square used as a leading icon in settings rows. */
export function RowIcon({ color, children }: { color: string; children: ReactNode }) {
  return (
    <Box
      aria-hidden
      sx={{ width: 36, height: 36, borderRadius: 2.5, display: 'grid', placeItems: 'center', color: '#fff', bgcolor: color, '& svg': { fontSize: 20 } }}
    >
      {children}
    </Box>
  );
}

export interface RowMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/** ⋮ overflow menu for secondary/destructive row actions. */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <IconButton edge="end" aria-label={label} aria-haspopup="menu" onClick={(e) => setAnchor(e.currentTarget)}>
        <MoreVertRoundedIcon />
      </IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        {items.map((it) => (
          <MenuItem
            key={it.label}
            disabled={it.disabled}
            onClick={() => {
              setAnchor(null);
              it.onClick();
            }}
            sx={{ minHeight: 48, color: it.destructive ? 'error.main' : undefined }}
          >
            {it.icon && <ListItemIcon sx={{ color: 'inherit' }}>{it.icon}</ListItemIcon>}
            <ListItemText>{it.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
