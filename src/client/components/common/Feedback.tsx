import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Snackbar } from '@mui/material';

type Severity = 'success' | 'error' | 'info' | 'warning';

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
}

interface FeedbackCtx {
  notify: (message: string, severity?: Severity) => void;
  /** Resolves true when the user confirms. Use before every destructive action. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const Ctx = createContext<FeedbackCtx | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; severity: Severity; key: number } | null>(null);
  const [dialog, setDialog] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const notify = useCallback((message: string, severity: Severity = 'success') => {
    setToast({ message, severity, key: Date.now() });
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setDialog(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setDialog(null);
  };

  return (
    <Ctx.Provider value={{ notify, confirm }}>
      {children}
      <Snackbar
        key={toast?.key}
        open={!!toast}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ mb: { xs: 8, md: 0 } }}
      >
        {toast ? (
          <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
      <Dialog open={!!dialog} onClose={() => close(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{dialog?.title}</DialogTitle>
        {dialog?.message && (
          <DialogContent>
            <DialogContentText component="div">{dialog.message}</DialogContentText>
          </DialogContent>
        )}
        <DialogActions>
          <Button onClick={() => close(false)}>Cancel</Button>
          <Button
            variant="contained"
            color={dialog?.destructive ? 'error' : 'primary'}
            onClick={() => close(true)}
            autoFocus
          >
            {dialog?.confirmLabel ?? (dialog?.destructive ? 'Delete' : 'Confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Ctx.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useFeedback must be used inside <FeedbackProvider>');
  return ctx;
}
