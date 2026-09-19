import test from 'node:test';
import assert from 'node:assert/strict';
import { matchElements } from '../design-qa/matcher.js';
import { compareModels } from '../design-qa/comparison-engine.js';
import { calculateScores } from '../design-qa/scoring.js';

const visual = { background: [255, 255, 255, 255], color: [20, 30, 24, 255], borderColor: [190, 198, 191, 255], borderWidth: 1, radius: 8, opacity: 1 };
const typography = { family: 'Inter', size: 16, weight: 600, lineHeight: 24, letterSpacing: 0, align: 'center', lines: 1 };
const layout = { mode: 'VERTICAL', paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16, gap: 16, primaryAlign: '', counterAlign: '' };
const node = (source, id, role, text, rect, parentId = null) => ({
  id, source, parentId, depth: parentId ? 1 : 0, order: Number(id.match(/\d+/)?.[0] || 0), name: text || role,
  nodeType: role, role, text, texts: text ? [text] : [], rect: { ...rect }, layout: { ...layout },
  typography: ['text', 'button'].includes(role) ? { ...typography } : undefined,
  visual: { ...visual }, selector: source === 'website' ? `#${id}` : undefined
});

function models(viewport = { width: 500, height: 700 }) {
  const figma = [
    node('figma', 'f1', 'card', '', { x: 40, y: 80, width: 420, height: 180 }),
    node('figma', 'f2', 'text', 'Welcome', { x: 60, y: 100, width: 180, height: 24 }, 'f1'),
    node('figma', 'f3', 'button', 'Continue', { x: 60, y: 180, width: 160, height: 48 }, 'f1')
  ];
  figma[0].texts = ['Welcome', 'Continue'];
  const website = [
    node('website', 'w1', 'card', '', { x: 40, y: 80, width: 420, height: 180 }),
    node('website', 'w2', 'text', 'Welcome', { x: 60, y: 100, width: 180, height: 24 }, 'w1'),
    node('website', 'w3', 'button', 'Continue', { x: 60, y: 180, width: 160, height: 48 }, 'w1')
  ];
  website[0].texts = ['Welcome', 'Continue'];
  return { figma: { viewport, nodes: figma }, website: { viewport, nodes: website } };
}
function run(data) {
  const matching = matchElements(data.figma, data.website);
  const comparison = compareModels(data.figma, data.website, matching);
  return { matching, comparison, scores: calculateScores(comparison.checks, matching) };
}

test('ground truth: perfect match has no meaningful issues', () => {
  const result = run(models());
  assert.equal(result.comparison.issues.length, 0);
  assert.equal(result.scores.overall, 100);
  assert.equal(result.matching.matches.length, 3);
});

test('ground truth: spacing mismatch identifies property, values, and cause', () => {
  const data = models(); data.website.nodes[0].layout.gap = 28; data.website.nodes[2].rect.y += 12;
  const result = run(data);
  const issue = result.comparison.issues.find(item => item.category === 'spacing');
  assert.equal(issue.delta.gap, 12);
  assert.match(issue.measured, /gap: \+12px/);
  assert.match(issue.likelyCause, /padding or gap/);
  assert.ok(!result.comparison.issues.some(item => item.type === 'geometry-mismatch' && item.target === '#w3'), 'a parent gap defect should not be duplicated as a child position defect');
});

test('ground truth: typography mismatch reports size, line height, and weight', () => {
  const data = models(); Object.assign(data.website.nodes[1].typography, { size: 20, lineHeight: 30, weight: 400 });
  const issue = run(data).comparison.issues.find(item => item.category === 'typography');
  assert.deepEqual({ size: issue.delta.size, lineHeight: issue.delta.lineHeight, weight: issue.delta.weight }, { size: 4, lineHeight: 6, weight: -200 });
});

test('ground truth: alignment mismatch identifies the affected axis', () => {
  const data = models(); data.figma.nodes[0].layout.primaryAlign = 'CENTER'; data.website.nodes[0].layout.primaryAlign = 'flex-start';
  const issue = run(data).comparison.issues.find(item => item.category === 'spacing');
  assert.match(issue.measured, /primary alignment/);
  assert.equal(issue.expected.alignment.primary, 'center');
  assert.equal(issue.actual.alignment.primary, 'start');
});

test('ground truth: missing button is critical', () => {
  const data = models(); data.website.nodes = data.website.nodes.filter(item => item.role !== 'button');
  const issue = run(data).comparison.issues.find(item => item.type === 'missing');
  assert.equal(issue.severity, 'critical');
  assert.match(issue.title, /Missing button/);
});

test('ground truth: extra card is detected', () => {
  const data = models(); data.website.nodes.push(node('website', 'w4', 'card', 'Promotion', { x: 40, y: 300, width: 420, height: 120 }));
  const issue = run(data).comparison.issues.find(item => item.type === 'extra');
  assert.equal(issue.actual.role, 'card');
});

test('ground truth: relative position mismatch reports measured offset', () => {
  const data = models(); data.website.nodes[2].rect.y += 18;
  const issue = run(data).comparison.issues.find(item => item.type === 'geometry-mismatch' && item.target === '#w3');
  assert.equal(issue.delta.y, 18);
  assert.match(issue.measured, /y: \+18px/);
});

test('ground truth: different content is matched and reported with confidence', () => {
  const data = models(); data.website.nodes[1].text = 'Hello'; data.website.nodes[1].texts = ['Hello']; data.website.nodes[0].texts = ['Hello', 'Continue'];
  const issue = run(data).comparison.issues.find(item => item.type === 'content-mismatch');
  assert.equal(issue.expected.text, 'Welcome');
  assert.equal(issue.actual.text, 'Hello');
  assert.ok(issue.confidence >= 50);
  assert.equal(issue.status, 'needs-review');
});

test('ground truth: responsive viewport geometry is evaluated independently', () => {
  const data = models({ width: 390, height: 844 });
  data.figma.nodes[0].rect.width = 350; data.website.nodes[0].rect.width = 300;
  const result = run(data);
  assert.ok(result.comparison.issues.some(issue => issue.category === 'geometry' && issue.delta.width === -50));
  assert.ok(result.scores.categories.layout < 100);
});

test('ground truth: color mismatch reports exact colors and lowers visual score', () => {
  const data = models(); data.website.nodes[0].visual.background = [0, 0, 0, 255];
  const result = run(data);
  const issue = result.comparison.issues.find(item => item.category === 'visual');
  assert.equal(issue.expected.background, '#FFFFFF');
  assert.equal(issue.actual.background, '#000000');
  assert.ok(result.scores.categories.colorsAndVisuals < 100);
});

test('ground truth: missing shadow is reported as a visual token difference', () => {
  const data = models(); data.figma.nodes[0].visual.shadow = { x: 0, y: 4, blur: 12 };
  const issue = run(data).comparison.issues.find(item => item.type === 'visual-mismatch');
  assert.equal(issue.expected.shadow, 'present');
  assert.equal(issue.actual.shadow, 'none');
});

test('ground truth: wrong component ownership is a hierarchy issue', () => {
  const data = models(); data.website.nodes[1].parentId = 'w3';
  const issue = run(data).comparison.issues.find(item => item.type === 'hierarchy-mismatch');
  assert.equal(issue.expected.parent, 'card');
  assert.equal(issue.actual.expectedWebsiteParent, '#w1');
});

test('ground truth: non-auto-layout sibling gaps are measured as relationships', () => {
  const data = models(); data.figma.nodes[0].layout.mode = 'NONE'; data.website.nodes[0].layout.mode = 'NONE'; data.website.nodes[2].rect.y += 12;
  const issue = run(data).comparison.issues.find(item => item.type === 'relationship-spacing');
  assert.equal(issue.delta.gap, 12);
  assert.match(issue.measured, /Vertical gap/);
});

test('ground truth: repeated labels use geometry to keep instances paired', () => {
  const viewport = { width: 500, height: 700 };
  const figma = { viewport, nodes: [
    node('figma', 'f1', 'button', 'View', { x: 20, y: 50, width: 100, height: 40 }),
    node('figma', 'f2', 'button', 'View', { x: 20, y: 250, width: 100, height: 40 })
  ] };
  const website = { viewport, nodes: [
    node('website', 'w2', 'button', 'View', { x: 20, y: 250, width: 100, height: 40 }),
    node('website', 'w1', 'button', 'View', { x: 20, y: 50, width: 100, height: 40 })
  ] };
  const pairs = matchElements(figma, website).matches.map(match => [match.figma.id, match.website.id]);
  assert.deepEqual(pairs, [['f1', 'w1'], ['f2', 'w2']]);
});
