import { useState, type ReactNode } from 'react';
import { IconButton, ListItemIcon, Menu, MenuItem } from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';

export interface RowMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
}

/** Overflow ⋮ menu for list rows (secondary/destructive actions live here instead of rows of icon buttons). */
export function RowMenu({ label, items, edge = 'end' }: { label: string; items: RowMenuItem[]; edge?: 'end' | false }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const visible = items.filter((i) => !i.hidden);
  return (
    <>
      <IconButton
        edge={edge}
        aria-label={label}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(e.currentTarget);
        }}
      >
        <MoreVertIcon />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        onClick={(e) => e.stopPropagation()}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {visible.map((i) => (
          <MenuItem
            key={i.label}
            disabled={i.disabled}
            onClick={() => {
              setAnchor(null);
              i.onClick();
            }}
            sx={{ minHeight: 48, ...(i.danger ? { color: 'error.main' } : {}) }}
          >
            {i.icon && <ListItemIcon sx={i.danger ? { color: 'inherit' } : undefined}>{i.icon}</ListItemIcon>}
            {i.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
