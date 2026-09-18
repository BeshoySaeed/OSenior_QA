const normalize = value => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const rounded = value => `${Math.round(value * 10) / 10}px`;

// The Figma frame is the baseline. Small differences from text rasterization are ignored.
export const STYLE_SPACING_TOLERANCE = Object.freeze({ position: 4, gap: 4, fontSize: 1, lineHeight: 2, fontWeight: 50, colorChannel: 8 });

export function compareStyleSpacing(figmaPhrases, pagePhrases, frame) {
  const orderedFigma = [...figmaPhrases].sort((a, b) => a.y - b.y || a.x - b.x);
  const orderedPage = [...pagePhrases].sort((a, b) => a.region.y - b.region.y || a.region.x - b.region.x);
  const used = new Set();
  const matches = [];
  for (const page of orderedPage) {
    const index = orderedFigma.findIndex((figma, i) => !used.has(i) && normalize(figma.text) === normalize(page.text));
    if (index < 0) continue;
    used.add(index);
    matches.push({ figma: orderedFigma[index], page });
  }
  if (!matches.length) throw new Error('No matching text anchors were found between the page and Figma frame for style/spacing comparison.');

  const alignment = [], spacing = [], typography = [];
  const add = (rows, label, figmaValue, pageValue, region) => rows.push({
    kind: 'changed', figma: `${label}: ${figmaValue}`, website: `${label}: ${pageValue}`, region
  });
  for (const { figma, page } of matches) {
    const expectedX = figma.x - frame.x, expectedY = figma.y - frame.y;
    const actualX = page.region.x, actualY = page.region.y;
    if (Math.abs(expectedX - actualX) > STYLE_SPACING_TOLERANCE.position) add(alignment, `${figma.text} · horizontal position`, rounded(expectedX), rounded(actualX), page.region);
    if (Math.abs(expectedY - actualY) > STYLE_SPACING_TOLERANCE.position) add(alignment, `${figma.text} · vertical position`, rounded(expectedY), rounded(actualY), page.region);
    const expectedStyle = figma.style || {}, actualStyle = page.style || {};
    for (const [key, label, tolerance] of [
      ['fontSize', 'font size', STYLE_SPACING_TOLERANCE.fontSize],
      ['lineHeight', 'line height', STYLE_SPACING_TOLERANCE.lineHeight]
    ]) {
      if (Number.isFinite(expectedStyle[key]) && Number.isFinite(actualStyle[key]) && Math.abs(expectedStyle[key] - actualStyle[key]) > tolerance) {
        add(typography, `${figma.text} · ${label}`, rounded(expectedStyle[key]), rounded(actualStyle[key]), page.region);
      }
    }
    if (Number.isFinite(expectedStyle.fontWeight) && Number.isFinite(actualStyle.fontWeight) && Math.abs(expectedStyle.fontWeight - actualStyle.fontWeight) > STYLE_SPACING_TOLERANCE.fontWeight) {
      add(typography, `${figma.text} · font weight`, String(expectedStyle.fontWeight), String(actualStyle.fontWeight), page.region);
    }
    if (expectedStyle.color?.length === 3 && actualStyle.color?.length === 3 && expectedStyle.color.some((channel, i) => Math.abs(channel - actualStyle.color[i]) > STYLE_SPACING_TOLERANCE.colorChannel)) {
      add(typography, `${figma.text} · text color`, `rgb(${expectedStyle.color.join(', ')})`, `rgb(${actualStyle.color.join(', ')})`, page.region);
    }
  }

  const byFigmaPosition = [...matches].sort((a, b) => a.figma.y - b.figma.y || a.figma.x - b.figma.x);
  for (let i = 1; i < byFigmaPosition.length; i += 1) {
    const previous = byFigmaPosition[i - 1], current = byFigmaPosition[i];
    const sameColumn = Math.abs(previous.figma.x - current.figma.x) <= 8 && Math.abs(previous.page.region.x - current.page.region.x) <= 8;
    const expectedGap = current.figma.y - (previous.figma.y + previous.figma.height);
    const actualGap = current.page.region.y - (previous.page.region.y + previous.page.region.height);
    if (sameColumn && expectedGap >= 0 && actualGap >= 0 && Math.abs(expectedGap - actualGap) > STYLE_SPACING_TOLERANCE.gap) {
      add(spacing, `${previous.figma.text} → ${current.figma.text} · vertical gap`, rounded(expectedGap), rounded(actualGap), current.page.region);
    }
  }
  return [
    { label: 'Alignment', rows: alignment },
    { label: 'Spacing', rows: spacing },
    { label: 'Typography', rows: typography }
  ];
}
