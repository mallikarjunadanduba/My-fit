import { useState, type ReactNode } from 'react';
import { IconButton, InputAdornment, TextField, type TextFieldProps } from '@mui/material';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import type { UseFormRegisterReturn } from 'react-hook-form';
import type { ApiError } from '../../services/api';

/** Adapts react-hook-form `register()` to MUI TextField (ref goes to the <input>). */
export function mui(r: UseFormRegisterReturn) {
  const { ref, ...rest } = r;
  return { ...rest, inputRef: ref };
}

export const PASSWORD_MIN = 10;

/** slotProps adding a leading icon to the larger, phone-friendly auth fields. */
export const iconSlot = (node: ReactNode) => ({
  input: {
    startAdornment: (
      <InputAdornment position="start" sx={{ color: 'text.secondary' }}>
        {node}
      </InputAdornment>
    ),
  },
});

/** Big, thumb-friendly primary button style used on auth screens. */
export const authButtonSx = { minHeight: 54, borderRadius: 3.5, fontSize: 16, boxShadow: '0 10px 24px rgba(0,175,181,0.35)' };

/** Password input with a show/hide toggle. */
export function PasswordField(props: TextFieldProps) {
  const [show, setShow] = useState(false);
  return (
    <TextField
      {...props}
      type={show ? 'text' : 'password'}
      slotProps={{
        ...props.slotProps,
        input: {
          // Keep caller-supplied input props (e.g. a start icon) alongside the toggle.
          ...(props.slotProps?.input as object | undefined),
          endAdornment: (
            <InputAdornment position="end">
              <IconButton aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow((s) => !s)} edge="end" size="small">
                {show ? <VisibilityOffRoundedIcon fontSize="small" /> : <VisibilityRoundedIcon fontSize="small" />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

/** Human message for an API error, including the first field error if present. */
export function apiErrorMessage(e: ApiError | Error): string {
  const details = (e as ApiError).details as { fieldErrors?: Record<string, string[] | string> } | undefined;
  const first = details?.fieldErrors && Object.values(details.fieldErrors)[0];
  const fieldMsg = Array.isArray(first) ? first[0] : first;
  return fieldMsg ? `${e.message}: ${fieldMsg}` : e.message;
}
