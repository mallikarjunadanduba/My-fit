import type { ReactNode } from 'react';
import { Box, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import { visuallyHiddenSx } from './mobile';

/**
 * Page title + actions.
 * Phone: the top app bar already shows the page title, so the heading is kept for screen readers only
 * and the subtitle/actions render as one compact row.
 */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  const phone = useMediaQuery(useTheme().breakpoints.down('md'));

  if (phone) {
    return (
      // No visible block (and no gap) when there is nothing besides the title to show.
      <Box sx={{ mb: subtitle || actions ? 2 : 0 }}>
        <Typography variant="h4" component="h1" sx={visuallyHiddenSx}>
          {title}
        </Typography>
        {(subtitle || actions) && (
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ minHeight: 40 }}>
            {subtitle ? (
              <Typography variant="body2" color="text.secondary" component="div" sx={{ minWidth: 0 }}>
                {subtitle}
              </Typography>
            ) : (
              <span />
            )}
            {actions && (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap justifyContent="flex-end">
                {actions}
              </Stack>
            )}
          </Stack>
        )}
      </Box>
    );
  }

  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2} sx={{ mb: 3 }}>
      <Box>
        <Typography variant="h4" component="h1">
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {actions}
        </Stack>
      )}
    </Stack>
  );
}
