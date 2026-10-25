import { alpha, createTheme, type PaletteMode } from '@mui/material/styles';

export const brand = {
  teal: '#00AFB5',
  navy: '#152238',
  white: '#FFFFFF',
  light: '#F5F7FA',
  success: '#16A34A',
  warning: '#F59E0B',
  error: '#DC2626',
};

/** Fixed colours per nutrient so charts and progress bars read consistently across pages. */
export const nutrientColors = {
  calories: brand.teal,
  protein: '#6366F1',
  carbs: '#F59E0B',
  fat: '#EC4899',
  fiber: '#16A34A',
  water: '#0EA5E9',
};

export function buildTheme(mode: PaletteMode) {
  const dark = mode === 'dark';
  const PHONE = '@media (max-width:899.95px)';
  return createTheme({
    palette: {
      mode,
      primary: { main: brand.teal, contrastText: '#FFFFFF' },
      secondary: { main: dark ? '#9FB3C8' : brand.navy },
      success: { main: brand.success },
      warning: { main: brand.warning },
      error: { main: brand.error },
      background: { default: dark ? '#0B1220' : brand.light, paper: dark ? '#111A2E' : brand.white },
      text: { primary: dark ? '#E6EDF5' : brand.navy, secondary: dark ? '#93A4BA' : '#5B6B80' },
      divider: dark ? alpha('#FFFFFF', 0.08) : alpha(brand.navy, 0.08),
    },
    shape: { borderRadius: 14 },
    typography: {
      fontFamily: '"Plus Jakarta Sans", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      // Headings scale down on phones so content, not titles, fills the screen.
      h4: { fontWeight: 800, letterSpacing: '-0.02em', [PHONE]: { fontSize: '1.6rem' } },
      h5: { fontWeight: 700, letterSpacing: '-0.01em', [PHONE]: { fontSize: '1.3rem' } },
      h6: { fontWeight: 700, [PHONE]: { fontSize: '1.08rem' } },
      subtitle1: { fontWeight: 600 },
      button: { fontWeight: 600, textTransform: 'none' },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          // Phone-first: no accidental horizontal scroll, no rubber-band refresh inside the installed app,
          // and no double-tap zoom delays on buttons.
          // Only on <html> (the viewport). Putting overflow-x on <body> too turns body into its own
          // non-scrolling scroll container, and overscroll-behavior then stops the page from scrolling at all.
          html: { overscrollBehaviorY: 'none', overflowX: 'hidden' },
          body: { WebkitTapHighlightColor: 'transparent' },
          'button, a, [role="button"]': { touchAction: 'manipulation' },
        },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: ({ theme }) => ({ border: `1px solid ${theme.palette.divider}`, backgroundImage: 'none' }),
        },
      },
      MuiCardContent: {
        styleOverrides: { root: { [PHONE]: { padding: 16, '&:last-child': { paddingBottom: 16 } } } },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: 10 } } },
      MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
      MuiLinearProgress: { styleOverrides: { root: { height: 8, borderRadius: 8 }, bar: { borderRadius: 8 } } },
      // Inputs stay at 16px so iOS Safari doesn't zoom the page on focus.
      MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
      MuiInputBase: { styleOverrides: { input: { fontSize: 16 } } },
      MuiBottomNavigationAction: { styleOverrides: { root: { minWidth: 0, padding: '6px 4px' } } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 18 }, paperFullScreen: { borderRadius: 0, border: 'none', boxShadow: 'none' } } },
      // Comfortable touch targets on phones.
      MuiIconButton: { styleOverrides: { root: { [PHONE]: { minWidth: 44, minHeight: 44 } } } },
      MuiListItemButton: { styleOverrides: { root: { [PHONE]: { minHeight: 48 } } } },
      MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } } },
      MuiTooltip: { defaultProps: { enterTouchDelay: 700 } },
    },
  });
}
