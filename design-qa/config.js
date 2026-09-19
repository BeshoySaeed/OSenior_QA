export const DEFAULT_THRESHOLDS = Object.freeze({
  positionPx: 4,
  sizePx: 4,
  sizePercent: 0.03,
  spacingPx: 2,
  fontSizePx: 1,
  lineHeightPx: 2,
  letterSpacingPx: 0.5,
  fontWeight: 100,
  borderWidthPx: 1,
  radiusPx: 2,
  colorDistance: 18,
  opacity: 0.05,
  matchMinimum: 0.52,
  confidentMatch: 0.72,
  pixelDifference: 28
});

export const SCORE_WEIGHTS = Object.freeze({
  structure: 0.24,
  geometry: 0.22,
  spacing: 0.18,
  typography: 0.16,
  visual: 0.14,
  content: 0.06
});

export const SEVERITY_PENALTIES = Object.freeze({ critical: 18, major: 9, minor: 3 });
