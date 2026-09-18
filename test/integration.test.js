import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

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
    assert.deepEqual(run.viewport, { width: 500, height: 700 });
    assert.deepEqual(run.comparisons.flatMap(section => section.rows.map(row => row.kind)).sort(), ['changed', 'missing']);
    assert.ok(run.artifacts.some(artifact => artifact.type === 'screenshot'));
    assert.ok(run.artifacts.some(artifact => artifact.type === 'figma-reference'));
    assert.ok(run.artifacts.some(artifact => artifact.type === 'wording-overlay'));

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(base);
    await page.locator('input[name=url]').fill(`${base}/fixture.html`);
    await page.locator('input[name=figmaUrl]').fill('https://www.figma.com/design/test?node-id=1-2');
    await page.locator('button').click();
    await page.waitForFunction(() => ['failed', 'passed', 'error'].includes(document.querySelector('#status').textContent));
    assert.equal(await page.locator('.comparison-section tbody tr').count(), 2);
    assert.match(await page.locator('#current-render-link').getAttribute('href'), /current\.png$/);
    assert.match(await page.locator('#figma-reference-link').getAttribute('href'), /figma-reference\.png$/);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
});
