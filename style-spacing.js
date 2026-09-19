const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const px = value => `${Math.round(value * 10) / 10}px`;

// Figma auto-layout is the source of truth. Tolerances only absorb browser rounding.
export const STYLE_SPACING_TOLERANCE = Object.freeze({ spacing: 1, fontSize: 1, lineHeight: 2, fontWeight: 50, colorChannel: 8 });
const VISUAL_SPACING_TOLERANCE = 3;

const SPACING_PROPERTIES = [
  ['paddingTop', 'padding-top'], ['paddingRight', 'padding-right'],
  ['paddingBottom', 'padding-bottom'], ['paddingLeft', 'padding-left']
];

function tokenLabel(name) {
  if (!name) return undefined;
  const clean = name.replace(/^--/, '');
  return clean.split(/[/.]/).at(-1).replace(/^(?:space|spacing)[-_]?/i, '') || clean;
}

function exactToken(value, tokens) {
  return [...tokens].sort((a, b) => a.name.length - b.name.length)
    .find(token => Math.abs(token.value - value) <= STYLE_SPACING_TOLERANCE.spacing);
}

function nearestToken(value, tokens) {
  return [...tokens].sort((a, b) => Math.abs(a.value - value) - Math.abs(b.value - value))[0];
}

function describeSpacing(value, tokens, preferredName) {
  const token = preferredName ? { name: preferredName, value } : exactToken(value, tokens);
  if (token) return `${tokenLabel(token.name)} (${px(value)}; ${token.name})`;
  const nearest = nearestToken(value, tokens);
  return nearest ? `custom ${px(value)}; nearest ${tokenLabel(nearest.name)} (${px(nearest.value)}; ${nearest.name})` : px(value);
}

function textOverlap(left, right) {
  const a = new Set(left.map(normalize).filter(Boolean));
  const b = new Set(right.map(normalize).filter(Boolean));
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return shared ? (2 * shared) / (a.size + b.size) : 0;
}

function geometrySimilarity(left, right) {
  if (!left || !right) return undefined;
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
  const diagonal = Math.hypot(rightEdge, bottomEdge) || 1;
  const centerLeft = { x: left.x + left.width / 2, y: left.y + left.height / 2 };
  const centerRight = { x: right.x + right.width / 2, y: right.y + right.height / 2 };
  const distance = Math.hypot(centerLeft.x - centerRight.x, centerLeft.y - centerRight.y);
  const position = Math.max(0, 1 - distance / (diagonal * 0.12));
  const width = Math.min(left.width, right.width) / Math.max(left.width, right.width, 1);
  const height = Math.min(left.height, right.height) / Math.max(left.height, right.height, 1);
  return position * 0.55 + ((width + height) / 2) * 0.45;
}

function countSimilarity(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return 0.5;
  return Math.min(left, right) / Math.max(left, right, 1);
}

function matchLayouts(figmaLayouts, pageLayouts) {
  const candidates = [];
  for (let f = 0; f < figmaLayouts.length; f += 1) {
    for (let p = 0; p < pageLayouts.length; p += 1) {
      const figma = figmaLayouts[f], page = pageLayouts[p];
      const signals = {
        text: textOverlap(figma.texts, page.texts),
        geometry: geometrySimilarity(figma.region, page.region),
        dimension: figma.region && page.region ? Math.min(
          Math.min(figma.region.width, page.region.width) / Math.max(figma.region.width, page.region.width, 1),
          Math.min(figma.region.height, page.region.height) / Math.max(figma.region.height, page.region.height, 1)
        ) : undefined,
        orientation: figma.layoutMode && page.layoutMode ? Number(figma.layoutMode === page.layoutMode) : 0.5,
        contentCount: countSimilarity(figma.leafCount ?? figma.texts.length, page.leafCount ?? page.texts.length),
        depth: countSimilarity((figma.depth ?? 0) + 1, (page.depth ?? 0) + 1)
      };
      if (!signals.text && !(signals.geometry >= 0.72)) continue;
      if (Number.isFinite(signals.dimension) && signals.dimension < 0.55) continue;
      const score = Number.isFinite(signals.geometry)
        ? signals.text * 0.28 + signals.geometry * 0.42 + signals.orientation * 0.15 + signals.contentCount * 0.1 + signals.depth * 0.05
        : signals.text * 0.75 + signals.orientation * 0.2 + signals.contentCount * 0.05;
      if (score >= 0.58) candidates.push({ f, p, score, signals });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const figmaUsed = new Set(), pageUsed = new Set(), matches = [];
  for (const candidate of candidates) {
    if (figmaUsed.has(candidate.f) || pageUsed.has(candidate.p)) continue;
    figmaUsed.add(candidate.f); pageUsed.add(candidate.p);
    matches.push({
      figma: figmaLayouts[candidate.f], page: pageLayouts[candidate.p],
      confidence: Math.round(candidate.score * 100), signals: candidate.signals
    });
  }
  return matches;
}

const alignment = value => ({ MIN: 'start', MAX: 'end', CENTER: 'center', SPACE_BETWEEN: 'space-between' })[value] || normalize(value).replace(/^flex-/, '');

export function compareStyleSpacing({ figmaLayouts, pageLayouts, figmaPhrases, pagePhrases, tokens = [] }) {
  const sections = { tokens: [], spacing: [], alignment: [], typography: [] };
  const add = (rows, issue, target, property, expected, actual, region) => rows.push({
    kind: 'changed', issue, property, target, figma: `${target} · ${property}: ${expected}`,
    website: `${target} · ${property}: ${actual}`, region
  });

  const layoutMatches = matchLayouts(figmaLayouts, pageLayouts);
  for (const { figma, page } of layoutMatches) {
    for (const [key, property] of SPACING_PROPERTIES) {
      const hasVisualMeasurement = Number.isFinite(figma.visualInsets?.[key]) && Number.isFinite(page.visualInsets?.[key]);
      const expected = figma.spacing[key];
      const actual = page.spacing[key];
      if (!Number.isFinite(expected) || !Number.isFinite(actual) || Math.abs(expected - actual) <= STYLE_SPACING_TOLERANCE.spacing) continue;
      if (hasVisualMeasurement && Math.abs(figma.visualInsets[key] - page.visualInsets[key]) <= VISUAL_SPACING_TOLERANCE) continue;
      add(sections.spacing, 'Spacing token', page.selector, property,
        describeSpacing(expected, tokens, figma.tokens[key]), describeSpacing(actual, tokens, page.tokens[key]), page.region);
    }
    const hasRawGap = Number.isFinite(figma.spacing.itemSpacing) && Number.isFinite(page.spacing.itemSpacing);
    const hasVisualGap = Number.isFinite(figma.visualGap) && Number.isFinite(page.visualGap);
    const expectedGap = hasRawGap ? figma.spacing.itemSpacing : figma.visualGap;
    const actualGap = hasRawGap ? page.spacing.itemSpacing : page.visualGap;
    if (page.gapApplicable !== false && Number.isFinite(expectedGap) && Number.isFinite(actualGap) && Math.abs(expectedGap - actualGap) > STYLE_SPACING_TOLERANCE.spacing) {
      if (hasVisualGap && Math.abs(figma.visualGap - page.visualGap) <= VISUAL_SPACING_TOLERANCE) continue;
      const property = figma.layoutMode === 'HORIZONTAL' ? 'column-gap' : 'row-gap';
      const figmaToken = hasRawGap ? figma.tokens.itemSpacing : undefined;
      const pageToken = hasRawGap ? page.tokens.itemSpacing : undefined;
      add(sections.spacing, 'Spacing token', page.selector, property,
        describeSpacing(expectedGap, tokens, figmaToken),
        describeSpacing(actualGap, tokens, pageToken), page.region);
    }
    if (page.primaryAlignmentRelevant !== false && figma.primaryAxisAlignItems && page.alignment.justifyContent && alignment(figma.primaryAxisAlignItems) !== alignment(page.alignment.justifyContent)) {
      add(sections.alignment, 'Alignment', page.selector, 'justify-content', alignment(figma.primaryAxisAlignItems), alignment(page.alignment.justifyContent), page.region);
    }
    if (page.counterAlignmentRelevant !== false && figma.counterAxisAlignItems && page.alignment.alignItems && alignment(figma.counterAxisAlignItems) !== alignment(page.alignment.alignItems)) {
      add(sections.alignment, 'Alignment', page.selector, 'align-items', alignment(figma.counterAxisAlignItems), alignment(page.alignment.alignItems), page.region);
    }

    for (const [key, property] of [...SPACING_PROPERTIES, ['itemSpacing', figma.layoutMode === 'HORIZONTAL' ? 'column-gap' : 'row-gap']]) {
      const actual = page.spacing[key], raw = page.authored[property];
      if (!raw || !Number.isFinite(actual) || actual === 0 || /var\(\s*--/i.test(raw)) continue;
      const token = exactToken(actual, tokens);
      if (token) add(sections.tokens, 'Raw spacing value', page.selector, property,
        `${tokenLabel(token.name)} token (${token.name})`, `${raw} resolves to ${px(actual)}`, page.region);
    }
  }

  const used = new Set();
  const orderedFigma = [...figmaPhrases].sort((a, b) => a.y - b.y || a.x - b.x);
  const orderedPage = [...pagePhrases].sort((a, b) => a.region.y - b.region.y || a.region.x - b.region.x);
  for (const page of orderedPage) {
    const index = orderedFigma.findIndex((figma, i) => !used.has(i) && normalize(figma.text) === normalize(page.text));
    if (index < 0) continue;
    used.add(index);
    const figma = orderedFigma[index], expected = figma.style || {}, actual = page.style || {};
    for (const [key, property, tolerance] of [
      ['fontSize', 'font-size', STYLE_SPACING_TOLERANCE.fontSize],
      ['lineHeight', 'line-height', STYLE_SPACING_TOLERANCE.lineHeight]
    ]) {
      if (Number.isFinite(expected[key]) && Number.isFinite(actual[key]) && Math.abs(expected[key] - actual[key]) > tolerance) {
        add(sections.typography, 'Typography', figma.text, property, px(expected[key]), px(actual[key]), page.region);
      }
    }
    if (Number.isFinite(expected.fontWeight) && Number.isFinite(actual.fontWeight) && Math.abs(expected.fontWeight - actual.fontWeight) > STYLE_SPACING_TOLERANCE.fontWeight) {
      add(sections.typography, 'Typography', figma.text, 'font-weight', String(expected.fontWeight), String(actual.fontWeight), page.region);
    }
    if (expected.color?.length === 3 && actual.color?.length === 3 && expected.color.some((channel, i) => Math.abs(channel - actual.color[i]) > STYLE_SPACING_TOLERANCE.colorChannel)) {
      add(sections.typography, 'Typography', figma.text, 'color', `rgb(${expected.color.join(', ')})`, `rgb(${actual.color.join(', ')})`, page.region);
    }
  }

  if (!layoutMatches.length && !used.size) throw new Error('No matching content or layout anchors were found between the page and Figma frame.');
  const deduplicate = rows => {
    const groups = new Map();
    for (const row of rows) {
      const key = [row.issue, row.property, row.target, row.figma, row.website].join('\u0000');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return [...groups.values()].map(group => {
      const first = group[0];
      if (group.length === 1) return { ...first, regions: [first.region] };
      return {
        ...first, occurrences: group.length, regions: group.map(row => row.region),
        target: `${first.target} (${group.length} instances)`,
        figma: `${first.figma} · ${group.length} matched instances`,
        website: `${first.website} · ${group.length} matched instances`
      };
    });
  };
  return [
    { label: 'Design token usage', rows: sections.tokens },
    { label: 'Spacing tokens', rows: sections.spacing },
    { label: 'Alignment', rows: sections.alignment },
    { label: 'Typography', rows: sections.typography }
  ].map(section => ({ ...section, rows: deduplicate(section.rows) }));
}
