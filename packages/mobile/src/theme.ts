/**
 * "Candlelight": the HateD look, as designed in the prototype.
 *
 * Daytime screens (sign-in, profile) sit on blush paper with deep-wine ink and
 * a rose accent. Round screens switch to an evening palette, wine with honey
 * glow, so a round feels like an occasion. Text colours are chosen to clear
 * WCAG AA (4.5:1) on their own background.
 */

export const day = {
  bg: '#FBF3EE',
  surface: '#FFFFFF',
  card: '#FFF9F6',
  line: '#EADBD3',
  ink: '#3A1E2A',
  muted: '#7A5864',
  accent: '#B83A5E',
  accentPressed: '#8F2A48',
  tint: '#F3E1D8',
  field: '#A68A80',
  danger: '#9E2F4E',
  success: '#2F6B4F',
  disabled: '#EBD6DA',
  segment: '#F6EAE4',
  peach: '#F2C4B3',
  blush: '#EBB3C1',
  honey: '#E8A33D',
  honeySoft: '#F7DFB8',
} as const;

export const night = {
  bg: '#2B1620',
  surface: '#3A2130',
  line: '#563848',
  text: '#FBEFE8',
  muted: '#CBB0B9',
  honey: '#F0B256',
  honeyPressed: '#D9993D',
  rose: '#E0728F',
  outline: '#8C6A78',
  blush: '#EBB3C1',
  ember: '#6B4026',
} as const;

/** Font family names as registered in the root layout. */
export const fonts = {
  display: 'Fraunces_500Medium',
  displayBold: 'Fraunces_600SemiBold',
  displayItalic: 'Fraunces_400Regular_Italic',
  body: 'Figtree_400Regular',
  bodyMedium: 'Figtree_500Medium',
  bodySemi: 'Figtree_600SemiBold',
  bodyBold: 'Figtree_700Bold',
} as const;

export type Tone = 'day' | 'night';
