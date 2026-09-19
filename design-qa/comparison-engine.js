import { DEFAULT_THRESHOLDS } from './config.js';

const round = value => Math.round(value * 10) / 10;
const normalized = value => String(value || '').toLocaleLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ').trim();
const hex = color => color ? `#${color.slice(0, 3).map(value => Math.round(value).toString(16).padStart(2, '0')).join('').toUpperCase()}` : 'none';
const colorDistance = (left, right) => left && right ? Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]) : 0;
const delta = (actual, expected) => round(actual - expected);

function severityFor(category, magnitude, role) {
  if (category === 'structure') {
    if (['button', 'input', 'dialog'].includes(role)) return 'critical';
    return ['card', 'component', 'header', 'footer'].includes(role) ? 'major' : 'minor';
  }
  if (category === 'geometry') return magnitude.ratio >= 0.25 || magnitude.px >= 40 ? 'critical' : magnitude.ratio >= 0.08 || magnitude.px >= 12 ? 'major' : 'minor';
  if (category === 'spacing') return magnitude >= 16 ? 'critical' : magnitude >= 6 ? 'major' : 'minor';
  if (category === 'typography') return magnitude >= 4 ? 'major' : 'minor';
  if (category === 'visual') return magnitude >= 45 ? 'major' : 'minor';
  return 'minor';
}

function topLevelUnmatched(nodes, unmatchedIds) {
  return nodes.filter(node => !node.parentId || !unmatchedIds.has(node.parentId));
}

function relevantStructure(node) {
  return ['button', 'input', 'dialog', 'card', 'component', 'header', 'footer', 'navigation', 'image', 'text', 'listitem'].includes(node.role) && node.rect.width >= 8 && node.rect.height >= 8;
}

export function compareModels(figmaModel, websiteModel, matching, thresholdOverrides = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...thresholdOverrides };
  const issues = [], checks = [];
  const addCheck = (category, quality) => checks.push({ category, quality: Math.max(0, Math.min(1, quality)) });
  const addIssue = issue => issues.push({
    id: `issue-${issues.length + 1}`,
    status: issue.confidence < thresholds.confidentMatch * 100 ? 'needs-review' : 'confirmed',
    ...issue
  });

  const figmaUnmatchedIds = new Set(matching.unmatchedFigma.map(node => node.id));
  for (const node of topLevelUnmatched(matching.unmatchedFigma, figmaUnmatchedIds).filter(relevantStructure)) {
    addCheck('structure', 0);
    addIssue({
      category: 'structure', type: 'missing', severity: severityFor('structure', 1, node.role), title: `Missing ${node.role}: ${node.text || node.name}`,
      target: node.text || node.name, confidence: 95, figmaRegion: node.rect,
      measured: `Figma contains a ${node.role} at (${round(node.rect.x)}, ${round(node.rect.y)}) sized ${round(node.rect.width)} × ${round(node.rect.height)}px; no website element met the matching threshold.`,
      expected: { present: true, role: node.role }, actual: { present: false }, delta: { count: -1 },
      likelyCause: 'The component may be missing, hidden, outside the viewport, or implemented with substantially different content and structure.',
      investigation: `Inspect the website near the highlighted Figma region and verify the ${node.role} is rendered for this viewport.`
    });
  }
  const websiteUnmatchedIds = new Set(matching.unmatchedWebsite.map(node => node.id));
  for (const node of topLevelUnmatched(matching.unmatchedWebsite, websiteUnmatchedIds).filter(relevantStructure)) {
    addCheck('structure', 0);
    addIssue({
      category: 'structure', type: 'extra', severity: severityFor('structure', 1, node.role), title: `Unexpected ${node.role}: ${node.text || node.name}`,
      target: node.selector, confidence: 92, websiteRegion: node.rect,
      measured: `The website contains a ${node.role} sized ${round(node.rect.width)} × ${round(node.rect.height)}px; no Figma element met the matching threshold.`,
      expected: { present: false }, actual: { present: true, role: node.role }, delta: { count: 1 },
      likelyCause: 'The implementation may contain an extra component, state, or responsive variant.',
      investigation: `Inspect ${node.selector} and confirm whether it belongs in the selected Figma frame.`
    });
  }

  const matchByFigma = new Map(matching.matches.map(match => [match.figma.id, match]));
  const matchedParents = new Map(matching.matches.map(match => [match.figma.id, match.website]));
  const spacingProperties = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'gap'];
  const parentsWithSpacingFailures = new Set(matching.matches.filter(({ figma, website }) =>
    spacingProperties.some(key => Math.abs((website.layout[key] || 0) - (figma.layout[key] || 0)) > thresholds.spacingPx)
  ).map(match => match.figma.id));
  for (const match of matching.matches) {
    const { figma, website, confidence } = match;
    addCheck('structure', 1);
    const parentWebsite = figma.parentId ? matchedParents.get(figma.parentId) : undefined;
    const parentFigma = figma.parentId ? figmaModel.nodes.find(node => node.id === figma.parentId) : undefined;
    const parentMatch = figma.parentId ? matchByFigma.get(figma.parentId) : undefined;
    if (parentMatch && website.parentId !== parentMatch.website.id) {
      addCheck('structure', 0.35);
      addIssue({
        category: 'structure', type: 'hierarchy-mismatch', severity: 'major', title: `${figma.role} is under the wrong parent`,
        target: website.selector, confidence: Math.min(confidence, parentMatch.confidence), figmaRegion: figma.rect, websiteRegion: website.rect,
        measured: `Figma places this ${figma.role} inside “${parentMatch.figma.name}”; the website places it under a different measured parent.`,
        expected: { parent: parentMatch.figma.name, parentRole: parentMatch.figma.role },
        actual: { parent: website.parentId, expectedWebsiteParent: parentMatch.website.selector }, delta: { hierarchy: 1 },
        likelyCause: 'The DOM or component hierarchy differs from the design hierarchy.',
        investigation: `Inspect the DOM parent of ${website.selector} and compare its component ownership with ${parentMatch.website.selector}.`
      });
    }
    const expectedPosition = parentWebsite && parentFigma
      ? { x: figma.rect.x - parentFigma.rect.x, y: figma.rect.y - parentFigma.rect.y }
      : { x: figma.rect.x, y: figma.rect.y };
    const actualPosition = parentWebsite
      ? { x: website.rect.x - parentWebsite.rect.x, y: website.rect.y - parentWebsite.rect.y }
      : { x: website.rect.x, y: website.rect.y };
    const geometry = {
      x: delta(actualPosition.x, expectedPosition.x), y: delta(actualPosition.y, expectedPosition.y),
      width: delta(website.rect.width, figma.rect.width), height: delta(website.rect.height, figma.rect.height)
    };
    const maxGeometryPx = Math.max(...Object.values(geometry).map(Math.abs));
    const maxGeometryRatio = Math.max(Math.abs(geometry.width) / Math.max(figma.rect.width, 1), Math.abs(geometry.height) / Math.max(figma.rect.height, 1));
    const widthFailure = Math.abs(geometry.width) > thresholds.sizePx && Math.abs(geometry.width) / Math.max(figma.rect.width, 1) > thresholds.sizePercent;
    const heightFailure = Math.abs(geometry.height) > thresholds.sizePx && Math.abs(geometry.height) / Math.max(figma.rect.height, 1) > thresholds.sizePercent;
    const xFailure = Math.abs(geometry.x) > thresholds.positionPx, yFailure = Math.abs(geometry.y) > thresholds.positionPx;
    const parentSpacingExplainsPosition = parentFigma && parentsWithSpacingFailures.has(parentFigma.id) && !widthFailure && !heightFailure && (
      (parentFigma.layout.mode === 'VERTICAL' && !xFailure) || (parentFigma.layout.mode === 'HORIZONTAL' && !yFailure)
    );
    const geometryFailure = !parentSpacingExplainsPosition && (xFailure || yFailure || widthFailure || heightFailure);
    addCheck('geometry', geometryFailure ? Math.max(0, 1 - maxGeometryRatio * 3 - maxGeometryPx / 200) : 1);
    if (geometryFailure) {
      const differences = Object.entries(geometry).filter(([key, value]) => Math.abs(value) > (['x', 'y'].includes(key) ? thresholds.positionPx : thresholds.sizePx));
      addIssue({
        category: 'geometry', type: 'geometry-mismatch', severity: severityFor('geometry', { px: maxGeometryPx, ratio: maxGeometryRatio }, figma.role),
        title: `${figma.role} geometry differs`, target: website.selector, confidence,
        figmaRegion: figma.rect, websiteRegion: website.rect,
        measured: differences.map(([key, value]) => `${key}: ${value > 0 ? '+' : ''}${value}px`).join('; '),
        expected: { x: round(expectedPosition.x), y: round(expectedPosition.y), width: round(figma.rect.width), height: round(figma.rect.height) },
        actual: { x: round(actualPosition.x), y: round(actualPosition.y), width: round(website.rect.width), height: round(website.rect.height) }, delta: geometry,
        likelyCause: geometry.width || geometry.height ? 'The component dimensions or its parent layout constraints differ from Figma.' : 'The element is offset relative to its matched parent.',
        investigation: `Inspect width, height, positioning, and parent layout rules for ${website.selector}.`
      });
    }

    const spacingDelta = Object.fromEntries(spacingProperties.map(key => [key, delta(website.layout[key] || 0, figma.layout[key] || 0)]));
    const spacingFailures = Object.entries(spacingDelta).filter(([, value]) => Math.abs(value) > thresholds.spacingPx);
    for (const key of spacingProperties) addCheck('spacing', Math.abs(spacingDelta[key]) > thresholds.spacingPx ? Math.max(0, 1 - Math.abs(spacingDelta[key]) / 32) : 1);
    const expectedAlign = { primary: normalized(figma.layout.primaryAlign), counter: normalized(figma.layout.counterAlign) };
    const actualAlign = { primary: normalized(website.layout.primaryAlign).replace(/^flex-/, ''), counter: normalized(website.layout.counterAlign).replace(/^flex-/, '') };
    const mapAlign = value => ({ min: 'start', max: 'end', center: 'center', space_between: 'space-between' })[value] || value;
    const alignmentFailures = [];
    if (expectedAlign.primary && actualAlign.primary && mapAlign(expectedAlign.primary) !== actualAlign.primary && actualAlign.primary !== 'normal') alignmentFailures.push('primary alignment');
    if (expectedAlign.counter && actualAlign.counter && mapAlign(expectedAlign.counter) !== actualAlign.counter && actualAlign.counter !== 'normal') alignmentFailures.push('cross-axis alignment');
    if (spacingFailures.length || alignmentFailures.length) {
      const maxSpacing = Math.max(0, ...spacingFailures.map(([, value]) => Math.abs(value)));
      addIssue({
        category: 'spacing', type: 'spacing-mismatch', severity: severityFor('spacing', maxSpacing, figma.role),
        title: `${figma.role} spacing or alignment differs`, target: website.selector, confidence,
        figmaRegion: figma.rect, websiteRegion: website.rect,
        measured: [...spacingFailures.map(([key, value]) => `${key}: ${value > 0 ? '+' : ''}${value}px`), ...alignmentFailures].join('; '),
        expected: { ...Object.fromEntries(spacingProperties.map(key => [key, round(figma.layout[key] || 0)])), alignment: expectedAlign },
        actual: { ...Object.fromEntries(spacingProperties.map(key => [key, round(website.layout[key] || 0)])), alignment: actualAlign }, delta: spacingDelta,
        likelyCause: spacingFailures.length ? 'The container padding or gap differs from the Figma auto-layout values.' : 'The flex or grid alignment differs from Figma auto-layout.',
        investigation: `Inspect padding, gap, justify-content, and align-items for ${website.selector}.`
      });
    }

    if (figma.typography && website.typography) {
      const typographyDelta = {
        size: delta(website.typography.size, figma.typography.size),
        lineHeight: delta(website.typography.lineHeight, figma.typography.lineHeight || website.typography.lineHeight),
        weight: delta(website.typography.weight, figma.typography.weight || website.typography.weight),
        letterSpacing: delta(website.typography.letterSpacing, figma.typography.letterSpacing || 0),
        lines: delta(website.typography.lines, figma.typography.lines)
      };
      const familyDiffers = normalized(figma.typography.family) && normalized(figma.typography.family) !== normalized(website.typography.family);
      const typographyFailures = Object.entries(typographyDelta).filter(([key, value]) => Math.abs(value) > ({ size: thresholds.fontSizePx, lineHeight: thresholds.lineHeightPx, weight: thresholds.fontWeight, letterSpacing: thresholds.letterSpacingPx, lines: 0 }[key]));
      const typographyQuality = Math.max(0, 1 - Math.max(0, ...typographyFailures.map(([, value]) => Math.abs(value))) / 12 - (familyDiffers ? 0.35 : 0));
      addCheck('typography', typographyFailures.length || familyDiffers ? typographyQuality : 1);
      if (typographyFailures.length || familyDiffers) addIssue({
        category: 'typography', type: 'typography-mismatch', severity: severityFor('typography', Math.max(0, ...typographyFailures.map(([, value]) => Math.abs(value))), figma.role),
        title: `Typography differs for “${figma.text || figma.name}”`, target: website.selector, confidence,
        figmaRegion: figma.rect, websiteRegion: website.rect,
        measured: [familyDiffers ? `font family: ${figma.typography.family} → ${website.typography.family}` : '', ...typographyFailures.map(([key, value]) => `${key}: ${value > 0 ? '+' : ''}${value}${key === 'weight' || key === 'lines' ? '' : 'px'}`)].filter(Boolean).join('; '),
        expected: figma.typography, actual: website.typography, delta: typographyDelta,
        likelyCause: typographyDelta.lines ? 'Font metrics or text-box width cause different wrapping.' : 'The applied font token or text style differs from Figma.',
        investigation: `Inspect font-family, font-size, font-weight, line-height, letter-spacing, and width for ${website.selector}.`
      });
    }

    const visualChanges = [];
    for (const [key, label] of [['background', 'background'], ['color', 'text color'], ['borderColor', 'border color']]) {
      const expected = figma.visual[key], actual = website.visual[key];
      if (!expected || !actual) continue;
      const distance = colorDistance(expected, actual);
      addCheck('visual', distance > thresholds.colorDistance ? Math.max(0, 1 - distance / 180) : 1);
      if (distance > thresholds.colorDistance) visualChanges.push({ key, label, distance: round(distance), expected: hex(expected), actual: hex(actual) });
    }
    for (const [key, label, tolerance] of [['borderWidth', 'border width', thresholds.borderWidthPx], ['radius', 'border radius', thresholds.radiusPx], ['opacity', 'opacity', thresholds.opacity]]) {
      const expected = figma.visual[key], actual = website.visual[key];
      if (!Number.isFinite(expected) || !Number.isFinite(actual)) continue;
      const difference = Math.abs(actual - expected);
      addCheck('visual', difference > tolerance ? Math.max(0, 1 - difference / (key === 'opacity' ? 1 : 24)) : 1);
      if (difference > tolerance) visualChanges.push({ key, label, distance: difference, expected, actual });
    }
    const figmaHasShadow = Boolean(figma.visual.shadow), websiteHasShadow = Boolean(website.visual.shadow);
    addCheck('visual', figmaHasShadow === websiteHasShadow ? 1 : 0);
    if (figmaHasShadow !== websiteHasShadow) visualChanges.push({
      key: 'shadow', label: 'shadow', distance: 100,
      expected: figmaHasShadow ? 'present' : 'none', actual: websiteHasShadow ? 'present' : 'none'
    });
    if (visualChanges.length) addIssue({
      category: 'visual', type: 'visual-mismatch', severity: severityFor('visual', Math.max(...visualChanges.map(change => change.distance)), figma.role),
      title: `${figma.role} visual style differs`, target: website.selector, confidence,
      figmaRegion: figma.rect, websiteRegion: website.rect,
      measured: visualChanges.map(change => `${change.label}: ${change.expected} → ${change.actual}`).join('; '),
      expected: Object.fromEntries(visualChanges.map(change => [change.key, change.expected])), actual: Object.fromEntries(visualChanges.map(change => [change.key, change.actual])),
      delta: Object.fromEntries(visualChanges.map(change => [change.key, round(change.distance)])),
      likelyCause: 'A color, border, radius, opacity, or shadow token differs from the design.',
      investigation: `Inspect background, color, border, border-radius, opacity, and shadow styles for ${website.selector}.`
    });

    if (figma.text && website.text && normalized(figma.text) !== normalized(website.text)) {
      addCheck('content', 0);
      addIssue({
        category: 'content', type: 'content-mismatch', severity: 'minor', title: `Content differs for ${figma.role}`,
        target: website.selector, confidence, figmaRegion: figma.rect, websiteRegion: website.rect,
        measured: `Figma: “${figma.text}”; website: “${website.text}”`, expected: { text: figma.text }, actual: { text: website.text }, delta: {},
        likelyCause: 'The implemented copy differs from the selected Figma frame.', investigation: `Verify the copy source used by ${website.selector}.`
      });
    } else if (figma.text || website.text) addCheck('content', 1);
  }

  for (const parentMatch of matching.matches) {
    if (['VERTICAL', 'HORIZONTAL', 'GRID'].includes(parentMatch.figma.layout.mode)) continue;
    const siblings = matching.matches.filter(match => match.figma.parentId === parentMatch.figma.id && match.website.parentId === parentMatch.website.id);
    if (siblings.length < 2) continue;
    siblings.sort((left, right) => left.figma.rect.y - right.figma.rect.y || left.figma.rect.x - right.figma.rect.x);
    for (let index = 1; index < siblings.length; index += 1) {
      const previous = siblings[index - 1], current = siblings[index];
      const expectedGap = current.figma.rect.y - (previous.figma.rect.y + previous.figma.rect.height);
      const actualGap = current.website.rect.y - (previous.website.rect.y + previous.website.rect.height);
      if (expectedGap < 0 || actualGap < 0) continue;
      const gapDelta = delta(actualGap, expectedGap);
      addCheck('spacing', Math.abs(gapDelta) > thresholds.spacingPx ? Math.max(0, 1 - Math.abs(gapDelta) / 32) : 1);
      if (Math.abs(gapDelta) <= thresholds.spacingPx) continue;
      const confidence = Math.min(previous.confidence, current.confidence, parentMatch.confidence);
      addIssue({
        category: 'spacing', type: 'relationship-spacing', severity: severityFor('spacing', Math.abs(gapDelta), parentMatch.figma.role),
        title: `Gap between “${previous.figma.text || previous.figma.name}” and “${current.figma.text || current.figma.name}” differs`,
        target: current.website.selector, confidence, figmaRegion: current.figma.rect, websiteRegion: current.website.rect,
        measured: `Vertical gap: ${round(expectedGap)}px in Figma, ${round(actualGap)}px on the website (${gapDelta > 0 ? '+' : ''}${gapDelta}px).`,
        expected: { relationship: `${previous.figma.name} → ${current.figma.name}`, gap: round(expectedGap) },
        actual: { relationship: `${previous.website.selector} → ${current.website.selector}`, gap: round(actualGap) }, delta: { gap: gapDelta },
        likelyCause: 'The sibling margin, parent flow, or intervening content differs from the design.',
        investigation: `Inspect the block flow and margins between ${previous.website.selector} and ${current.website.selector}.`
      });
    }
  }

  const severityOrder = { critical: 0, major: 1, minor: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.category.localeCompare(b.category));
  return { issues, checks, thresholds };
}
