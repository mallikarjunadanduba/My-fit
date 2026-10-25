import type { ReactNode } from 'react';
import { Box, Card, CardContent, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import FitnessCenterRoundedIcon from '@mui/icons-material/FitnessCenterRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import { brand } from '../../theme/theme';

const GRADIENT = `linear-gradient(160deg, ${brand.navy} 0%, #1B3A55 55%, ${brand.teal} 130%)`;

interface AuthCardProps {
  title: string;
  subtitle?: ReactNode;
  /** Short "what you get" points shown under the title. */
  highlights?: string[];
  children: ReactNode;
  footer?: ReactNode;
}

function Logo({ onDark }: { onDark: boolean }) {
  return (
    <Stack direction="row" spacing={1.25} alignItems="center">
      <Box
        aria-hidden
        sx={{
          width: 40,
          height: 40,
          borderRadius: 2.5,
          display: 'grid',
          placeItems: 'center',
          color: '#fff',
          background: onDark ? 'rgba(255,255,255,0.14)' : `linear-gradient(135deg, ${brand.navy}, ${brand.teal})`,
          border: onDark ? '1px solid rgba(255,255,255,0.22)' : 'none',
        }}
      >
        <FitnessCenterRoundedIcon fontSize="small" />
      </Box>
      <Typography component="div" sx={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.01em', color: onDark ? '#fff' : 'text.primary' }}>
        MyFit Routine
      </Typography>
    </Stack>
  );
}

function Highlights({ items, onDark }: { items: string[]; onDark: boolean }) {
  return (
    <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, mt: 2, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
      {items.map((item) => (
        <Stack component="li" key={item} direction="row" spacing={0.75} alignItems="center">
          <CheckCircleRoundedIcon sx={{ fontSize: 18, color: onDark ? brand.teal : 'primary.main' }} />
          <Typography variant="body2" sx={{ color: onDark ? 'rgba(255,255,255,0.88)' : 'text.secondary', fontWeight: 500 }}>
            {item}
          </Typography>
        </Stack>
      ))}
    </Box>
  );
}

/**
 * Shared layout for login / setup / invite.
 * Phone: full-screen gradient header + white bottom sheet holding the form.
 * Tablet/desktop: centered card on the gradient.
 */
export function AuthCard({ title, subtitle, highlights, children, footer }: AuthCardProps) {
  const phone = useMediaQuery(useTheme().breakpoints.down('sm'));

  if (phone) {
    return (
      <Box component="main" sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: GRADIENT }}>
        <Box sx={{ px: 3, pt: 'calc(env(safe-area-inset-top) + 28px)', pb: 3.5, color: '#fff' }}>
          <Logo onDark />
          <Typography variant="h4" component="h1" sx={{ mt: 3.5, color: '#fff', fontSize: 28, lineHeight: 1.15 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography sx={{ mt: 1, color: 'rgba(255,255,255,0.78)', fontSize: 15, lineHeight: 1.5 }}>{subtitle}</Typography>
          )}
          {highlights && <Highlights items={highlights} onDark />}
        </Box>
        <Box
          sx={{
            flex: 1,
            bgcolor: 'background.paper',
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            px: 3,
            pt: 3.5,
            pb: 'calc(env(safe-area-inset-bottom) + 28px)',
            boxShadow: '0 -12px 40px rgba(0,0,0,0.18)',
          }}
        >
          {children}
          {footer && <Box sx={{ mt: 3 }}>{footer}</Box>}
        </Box>
      </Box>
    );
  }

  return (
    <Box
      component="main"
      sx={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', px: 2, py: 6, background: GRADIENT }}
    >
      <Card sx={{ width: '100%', maxWidth: 460, borderRadius: 5, boxShadow: '0 24px 60px rgba(0,0,0,0.25)', border: 'none' }}>
        <CardContent sx={{ p: 4.5 }}>
          <Logo onDark={false} />
          <Typography variant="h5" component="h1" sx={{ mt: 3 }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
              {subtitle}
            </Typography>
          )}
          {highlights && <Highlights items={highlights} onDark={false} />}
          <Box sx={{ mt: 3 }}>{children}</Box>
          {footer && <Box sx={{ mt: 3 }}>{footer}</Box>}
        </CardContent>
      </Card>
    </Box>
  );
}
