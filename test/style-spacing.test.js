import test from 'node:test';
import assert from 'node:assert/strict';
import { compareStyleSpacing } from '../style-spacing.js';

const frame = { x: 0, y: 0 };
const style = { fontSize: 16, fontWeight: 400, lineHeight: 20, color: [0, 0, 0] };
const figma = (text, y) => ({ text, x: 20, y, width: 80, height: 20, style });
const page = (text, y, changes = {}) => ({ text, region: { x: 20, y, width: 80, height: 20 }, style: { ...style, ...changes } });

test('matching Figma positions, gaps, and typography pass', () => {
  const sections = compareStyleSpacing([figma('Beta', 140), figma('Alpha', 100)], [page('Alpha', 100), page('Beta', 140)], frame);
  assert.equal(sections.flatMap(section => section.rows).length, 0);
});

test('spacing and style differences use the wording report row shape', () => {
  const sections = compareStyleSpacing([figma('Alpha', 100), figma('Beta', 140)], [page('Alpha', 100), page('Beta', 166, { fontSize: 20 })], frame);
  assert.deepEqual(sections.filter(section => section.rows.length).map(section => section.label), ['Alignment', 'Spacing', 'Typography']);
  const rows = sections.flatMap(section => section.rows);
  assert.ok(rows.every(row => row.kind === 'changed' && row.figma && row.website && row.region));
  assert.match(rows.map(row => row.website).join(' '), /font size/);
});

test('style comparison reports unavailable when no anchors match', () => {
  assert.throws(() => compareStyleSpacing([figma('Alpha', 100)], [page('Different', 100)], frame), /No matching text anchors/);
});
