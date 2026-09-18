import test from 'node:test';
import assert from 'node:assert/strict';
import { compareWordingSections } from '../wording.js';

const figma = (text, y) => ({ text, x: 0, y, width: 80, height: 18 });
const page = (text, order, heading = false) => ({ text, heading, region: { x: 0, y: order * 20, width: 80, height: 18 } });

test('shared phrases are not reported when section order changes', () => {
  const result = compareWordingSections(
    [figma('More info', 0), figma('Contact', 20), figma('Support', 40)],
    [page('More info', 0, true), page('Support', 1), page('Contact', 2)]
  );
  assert.equal(result.flatMap(section => section.rows).length, 0);
});

test('changed phrase is paired and extra section is kept separate', () => {
  const result = compareWordingSections(
    [figma('Start portal', 0), figma('Confirm appointment today', 20), figma('More info', 80)],
    [page('Start portal', 0, true), page('Confirm appointment tomorrow', 1), page('Parcel tracking', 2, true), page('Track your parcel', 3), page('More info', 4, true)]
  );
  const start = result.find(section => section.label === 'Start portal');
  const tracking = result.find(section => section.label === 'Parcel tracking');
  assert.deepEqual(start.rows.map(row => row.kind), ['changed']);
  assert.deepEqual(tracking.rows.map(row => row.kind), ['added', 'added']);
  assert.equal(result.find(section => section.label === 'More info').rows.length, 0);
});

test('missing Figma text is reported without a page highlight region', () => {
  const result = compareWordingSections([figma('Start portal', 0), figma('Important introduction', 20)], [page('Start portal', 0, true)]);
  assert.equal(result[0].rows[0].kind, 'missing');
  assert.equal(result[0].rows[0].figma, 'Important introduction');
  assert.equal(result[0].rows[0].region, undefined);
  assert.deepEqual(result[0].rows[0].figmaRegion, { x: 0, y: 20, width: 80, height: 18 });
});
