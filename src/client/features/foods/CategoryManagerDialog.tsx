import { useState } from 'react';
import { Alert, Button, Chip, IconButton, List, ListItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { api } from '../../services/api';
import { useFeedback } from '../../components/common/Feedback';
import type { FoodCategory } from './types';
import { errorMessage } from './formHelpers';
import { ResponsiveDialog } from '../../components/common/mobile';

/** Add, rename and delete food categories. Built-in categories can be renamed but not deleted. */
export function CategoryManagerDialog({
  open,
  categories,
  onClose,
  onChanged,
}: {
  open: boolean;
  categories: FoodCategory[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { notify, confirm } = useFeedback();
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      notify(message);
      onChanged();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    if (await run(() => api.post('/foods/categories', { name }), `Added “${name}”`)) setNewName('');
  };

  const rename = async () => {
    if (!editing?.name.trim()) return;
    if (
      await run(
        () =>
          api.patch(`/foods/categories/${editing.id}`, {
            name: editing.name.trim(),
          }),
        'Category renamed',
      )
    )
      setEditing(null);
  };

  const remove = async (c: FoodCategory) => {
    const ok = await confirm({
      title: `Delete “${c.name}”?`,
      message: `${c.foodCount ? `${c.foodCount} food(s) will lose this category. ` : ''}The foods themselves are not deleted.`,
      destructive: true,
    });
    if (ok) await run(() => api.delete(`/foods/categories/${c.id}`), 'Category deleted');
  };

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      title={<>Food categories</>}
      actions={
        <>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <Stack
        direction="row"
        spacing={1}
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
        sx={{ mb: 2 }}
      >
        <TextField
          size="medium"
          label="New category"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 60 } }}
        />
        <Button type="submit" variant="contained" disabled={busy || !newName.trim()}>
          Add
        </Button>
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {categories.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No categories yet.
        </Typography>
      ) : (
        <List dense disablePadding>
          {categories.map((c) =>
            editing?.id === c.id ? (
              <ListItem key={c.id} disableGutters>
                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{ width: '100%' }}
                  component="form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void rename();
                  }}
                >
                  <TextField
                    size="medium"
                    value={editing.name}
                    onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                    autoFocus
                    slotProps={{
                      htmlInput: {
                        'aria-label': `Rename ${c.name}`,
                        maxLength: 60,
                      },
                    }}
                  />
                  <IconButton type="submit" aria-label="Save name" disabled={busy}>
                    <CheckRoundedIcon />
                  </IconButton>
                  <IconButton aria-label="Cancel rename" onClick={() => setEditing(null)}>
                    <CloseRoundedIcon />
                  </IconButton>
                </Stack>
              </ListItem>
            ) : (
              <ListItem
                key={c.id}
                disableGutters
                secondaryAction={
                  <Stack direction="row">
                    <Tooltip title="Rename">
                      <IconButton aria-label={`Rename ${c.name}`} onClick={() => setEditing({ id: c.id, name: c.name })}>
                        <EditRoundedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={c.isSystem ? 'Built-in categories cannot be deleted' : 'Delete'}>
                      <span>
                        <IconButton aria-label={`Delete ${c.name}`} disabled={c.isSystem || busy} onClick={() => remove(c)}>
                          <DeleteOutlineRoundedIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                }
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="body2">{c.name}</Typography>
                  {c.isSystem && <Chip label="Built-in" size="small" variant="outlined" sx={{ height: 20 }} />}
                  {c.foodCount != null && (
                    <Typography variant="body2" color="text.secondary">
                      {c.foodCount} food{c.foodCount === 1 ? '' : 's'}
                    </Typography>
                  )}
                </Stack>
              </ListItem>
            ),
          )}
        </List>
      )}
    </ResponsiveDialog>
  );
}
