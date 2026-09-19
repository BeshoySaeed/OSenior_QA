import test from 'node:test';
import assert from 'node:assert/strict';
import { compareStyleSpacing } from '../style-spacing.js';

const textStyle = { fontSize: 16, fontWeight: 400, lineHeight: 20, color: [0, 0, 0] };
const phrase = (text, y, page = false) => page
  ? { text, region: { x: 20, y, width: 80, height: 20 }, style: textStyle }
  : { text, x: 20, y, width: 80, height: 20, style: textStyle };
const figmaLayout = (itemSpacing = 20) => ({
  name: 'Content', layoutMode: 'VERTICAL', texts: ['Alpha', 'Beta'],
  spacing: { paddingTop: 20, paddingRight: 0, paddingBottom: 0, paddingLeft: 20, itemSpacing },
  tokens: { paddingTop: 'spacing/lg', paddingLeft: 'spacing/lg', itemSpacing: 'spacing/lg' }
});
const pageLayout = (itemSpacing = 20, rawGap = 'var(--spacing-lg)') => ({
  selector: 'main', texts: ['Alpha', 'Beta'], region: { x: 0, y: 60, width: 500, height: 120 },
  spacing: { paddingTop: 20, paddingRight: 0, paddingBottom: 0, paddingLeft: 20, itemSpacing },
  tokens: { paddingTop: '--spacing-lg', paddingLeft: '--spacing-lg', itemSpacing: itemSpacing === 20 ? '--spacing-lg' : '--spacing-xl' },
  authored: { 'padding-top': 'var(--spacing-lg)', 'padding-left': 'var(--spacing-lg)', 'row-gap': rawGap },
  alignment: { justifyContent: 'normal', alignItems: 'normal' }
});
const input = (figma = figmaLayout(), page = pageLayout()) => ({
  figmaLayouts: [figma], pageLayouts: [page], tokens: [{ name: '--spacing-lg', value: 20 }, { name: '--spacing-xl', value: 40 }],
  figmaPhrases: [phrase('Alpha', 80), phrase('Beta', 120)], pagePhrases: [phrase('Alpha', 80, true), phrase('Beta', 120, true)]
});

test('matching auto-layout tokens and typography pass without coordinate findings', () => {
  const sections = compareStyleSpacing(input());
  assert.equal(sections.flatMap(section => section.rows).length, 0);
});

test('spacing mismatch reports expected and actual token names', () => {
  const sections = compareStyleSpacing(input(figmaLayout(), pageLayout(40, 'var(--spacing-xl)')));
  const rows = sections.flatMap(section => section.rows);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].property, 'row-gap');
  assert.match(rows[0].figma, /lg \(20px; spacing\/lg\)/);
  assert.match(rows[0].website, /xl \(40px; --spacing-xl\)/);
  assert.doesNotMatch(JSON.stringify(rows), /vertical position|horizontal position/);
});

test('raw spacing value recommends the matching project token', () => {
  const sections = compareStyleSpacing(input(figmaLayout(), pageLayout(20, '20px')));
  const row = sections.find(section => section.label === 'Design token usage').rows[0];
  assert.equal(row.issue, 'Raw spacing value');
  assert.match(row.figma, /--spacing-lg/);
  assert.match(row.website, /20px resolves to 20px/);
});

test('style comparison reports unavailable when no anchors match', () => {
  const data = input();
  data.figmaLayouts[0].texts = ['Other'];
  data.figmaPhrases = [phrase('Other', 80)];
  assert.throws(() => compareStyleSpacing(data), /No matching content or layout anchors/);
});

test('nested containers with identical text are matched by geometry and orientation', () => {
  const outerFigma = {
    ...figmaLayout(), name: 'Accordion group', layoutMode: 'VERTICAL', texts: ['Question'],
    region: { x: 20, y: 100, width: 460, height: 200 }, leafCount: 1, depth: 0
  };
  const innerFigma = {
    ...figmaLayout(8), name: 'Accordion summary', layoutMode: 'HORIZONTAL', texts: ['Question'],
    region: { x: 40, y: 120, width: 420, height: 40 }, leafCount: 1, depth: 1,
    spacing: { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, itemSpacing: 8 }
  };
  const outerPage = {
    ...pageLayout(), selector: '.accordion-group', layoutMode: 'VERTICAL', texts: ['Question'],
    region: { x: 20, y: 100, width: 460, height: 200 }, leafCount: 1, depth: 0
  };
  const innerPage = {
    ...pageLayout(8), selector: '.accordion-summary', layoutMode: 'HORIZONTAL', texts: ['Question'],
    region: { x: 40, y: 120, width: 420, height: 40 }, leafCount: 1, depth: 1,
    spacing: { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, itemSpacing: 8 }
  };
  const data = input();
  data.figmaLayouts = [outerFigma, innerFigma];
  data.pageLayouts = [innerPage, outerPage];
  assert.equal(compareStyleSpacing(data).flatMap(section => section.rows).length, 0);
});

test('visually equal effective inset suppresses wrapper token ownership noise', () => {
  const figma = { ...figmaLayout(), visualInsets: { paddingTop: 20, paddingRight: 0, paddingBottom: 0, paddingLeft: 20 } };
  const page = {
    ...pageLayout(), spacing: { ...pageLayout().spacing, paddingTop: 0, paddingLeft: 0 },
    visualInsets: { paddingTop: 20, paddingRight: 0, paddingBottom: 0, paddingLeft: 20 }
  };
  assert.equal(compareStyleSpacing(input(figma, page)).flatMap(section => section.rows).length, 0);
});

test('same-text wrappers with incompatible dimensions are not treated as the same container', () => {
  const figma = { ...figmaLayout(), region: { x: 0, y: 100, width: 500, height: 240 }, leafCount: 2 };
  const page = {
    ...pageLayout(), region: { x: 0, y: 100, width: 500, height: 60 }, leafCount: 2,
    spacing: { ...pageLayout().spacing, paddingTop: 60 }
  };
  assert.equal(compareStyleSpacing(input(figma, page)).flatMap(section => section.rows).length, 0);
});

test('gap and alignment are ignored when the DOM properties cannot affect layout', () => {
  const figma = { ...figmaLayout(20), primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' };
  const page = {
    ...pageLayout(0), gapApplicable: false, primaryAlignmentRelevant: false, counterAlignmentRelevant: false,
    spacing: { ...pageLayout(0).spacing, itemSpacing: undefined }
  };
  assert.equal(compareStyleSpacing(input(figma, page)).flatMap(section => section.rows).length, 0);
});

test('identical repeated component issues are grouped with an occurrence count', () => {
  const figmaA = { ...figmaLayout(), texts: ['A'], region: { x: 0, y: 0, width: 500, height: 60 }, leafCount: 1 };
  const figmaB = { ...figmaLayout(), texts: ['B'], region: { x: 0, y: 100, width: 500, height: 60 }, leafCount: 1 };
  const pageA = { ...pageLayout(), selector: '.summary', texts: ['A'], region: { x: 0, y: 0, width: 500, height: 60 }, leafCount: 1, spacing: { ...pageLayout().spacing, paddingTop: 40 } };
  const pageB = { ...pageLayout(), selector: '.summary', texts: ['B'], region: { x: 0, y: 100, width: 500, height: 60 }, leafCount: 1, spacing: { ...pageLayout().spacing, paddingTop: 40 } };
  const data = input(); data.figmaLayouts = [figmaA, figmaB]; data.pageLayouts = [pageA, pageB];
  const rows = compareStyleSpacing(data).find(section => section.label === 'Spacing tokens').rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].occurrences, 2);
  assert.match(rows[0].target, /2 instances/);
  assert.equal(rows[0].regions.length, 2);
});
