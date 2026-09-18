import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const pixel = (image, x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

test('run uses Figma dimensions and reports phrases by section', async () => {
  const port = 34000 + Math.floor(Math.random() * 10000);
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--import', './test/mock-figma.mjs', 'server.js'], {
    cwd: process.cwd(), env: { ...process.env, PORT: String(port), FIGMA_TOKEN: 'test-token' }, stdio: 'ignore'
  });
  let browser;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try { ready = (await fetch(`${base}/api/health`)).ok; if (ready) break; } catch { /* Starting. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, 'server should start');
    const response = await fetch(`${base}/api/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: `${base}/fixture.html`, figmaUrl: 'https://www.figma.com/design/test?node-id=1-2' })
    });
    assert.equal(response.status, 202);
    let run = await response.json();
    for (let attempt = 0; attempt < 100 && ['queued', 'running'].includes(run.status); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
      run = await fetch(`${base}/api/runs/${run.id}`).then(result => result.json());
    }
    assert.equal(run.status, 'failed');
    assert.equal(run.includeHeaderFooter, false);
    assert.deepEqual(run.viewport, { width: 500, height: 700 });
    assert.deepEqual(run.comparisons.flatMap(section => section.rows.map(row => row.kind)).sort(), ['added', 'changed', 'missing']);
    assert.doesNotMatch(JSON.stringify(run.comparisons), /header text|footer text/i);
    assert.ok(run.artifacts.some(artifact => artifact.type === 'screenshot'));
    assert.ok(run.artifacts.some(artifact => artifact.type === 'figma-reference'));
    assert.ok(run.artifacts.some(artifact => artifact.type === 'wording-overlay'));
    assert.ok(run.artifacts.some(artifact => artifact.type === 'figma-wording-overlay'));

    const artifactImage = async type => {
      const url = run.artifacts.find(artifact => artifact.type === type).url;
      return PNG.sync.read(Buffer.from(await fetch(`${base}${url}`).then(result => result.arrayBuffer())));
    };
    const [current, websiteOverlay, figmaOverlay] = await Promise.all([
      artifactImage('screenshot'), artifactImage('wording-overlay'), artifactImage('figma-wording-overlay')
    ]);
    assert.deepEqual(pixel(figmaOverlay, 20, 230), [239, 49, 49, 255], 'Figma-only text should be outlined on the reference');
    assert.deepEqual(websiteOverlay.data.subarray(0, 60 * websiteOverlay.width * 4), current.data.subarray(0, 60 * current.width * 4), 'header should remain unmarked');
    assert.deepEqual(websiteOverlay.data.subarray(600 * websiteOverlay.width * 4), current.data.subarray(600 * current.width * 4), 'footer should remain unmarked');

    browser = await chromium.launch({ headless: true });
    const fixturePage = await browser.newPage({ viewport: { width: 500, height: 700 } });
    await fixturePage.goto(`${base}/fixture.html`);
    const addedRegion = await fixturePage.locator('#website-only').evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rect = range.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y) };
    });
    assert.deepEqual(pixel(websiteOverlay, addedRegion.x, addedRegion.y), [239, 49, 49, 255], 'website-only text should be outlined');
    await fixturePage.close();
    const page = await browser.newPage();
    await page.goto(base);
    assert.equal(await page.locator('input[name=includeHeaderFooter]').isChecked(), false);
    await page.locator('input[name=url]').fill(`${base}/fixture.html`);
    await page.locator('input[name=figmaUrl]').fill('https://www.figma.com/design/test?node-id=1-2');
    await page.locator('button').click();
    await page.waitForFunction(() => ['failed', 'passed', 'error'].includes(document.querySelector('#status').textContent));
    assert.equal(await page.locator('.comparison-section tbody tr').count(), 3);
    assert.equal(await page.locator('#wording-overlay figure').count(), 2);
    assert.match(await page.locator('#current-render-link').getAttribute('href'), /current\.png$/);
    assert.match(await page.locator('#figma-reference-link').getAttribute('href'), /figma-reference\.png$/);
    await page.locator('input[name=includeHeaderFooter]').check();
    await page.locator('button').click();
    await page.waitForFunction(() => ['failed', 'passed', 'error'].includes(document.querySelector('#status').textContent));
    await page.waitForFunction(() => document.querySelector('#comparisons').textContent.includes('header text'));
    assert.match(await page.locator('#comparisons').textContent(), /header text/i);
    assert.match(await page.locator('#comparisons').textContent(), /footer text/i);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
});
