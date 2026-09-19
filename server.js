import express from 'express';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { runWordingCheck } from './wording-runner.js';
import { runStyleSpacingCheck } from './style-spacing-runner.js';
import { runDesignQA } from './design-qa/runner.js';
import { toFinding } from './run-shared.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const artifactRoot = path.join(root, 'artifacts');
const runs = new Map();
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(root, 'public')));
app.use('/artifacts', express.static(artifactRoot));

function safeUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) targets are supported.');
  return url;
}
function parseFigmaReference(value) {
  const url = safeUrl(value);
  if (!/(^|\.)figma\.com$/i.test(url.hostname)) throw new Error('Use a valid figma.com design URL.');
  const parts = url.pathname.split('/').filter(Boolean);
  const marker = parts.findIndex(part => ['file', 'design'].includes(part));
  const fileKey = marker >= 0 ? parts[marker + 1] : undefined;
  const nodeId = url.searchParams.get('node-id')?.replace(/-/g, ':');
  if (!fileKey || !nodeId) throw new Error('The Figma URL must include a file/design key and node-id query parameter.');
  return { fileKey, nodeId };
}
function parseTestType(value) {
  if (value === undefined) return 'design-qa';
  if (['design-qa', 'wording', 'style-spacing'].includes(value)) return value;
  throw new Error('Select exactly one test type: design-qa, wording, or style-spacing.');
}
async function getFigmaNode(figmaUrl, figmaToken) {
  const token = figmaToken || process.env.FIGMA_TOKEN;
  if (!token) throw new Error('No Figma token is available. Enter a token for this run or set FIGMA_TOKEN before starting the server.');
  const { fileKey, nodeId } = parseFigmaReference(figmaUrl);
  const response = await fetch(`https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`, { headers: { 'X-Figma-Token': token } });
  if (!response.ok) throw new Error(`Figma text lookup failed (${response.status}). Check the token and file permissions.`);
  const payload = await response.json();
  const node = payload.nodes?.[nodeId]?.document;
  if (!node) throw new Error('Figma did not return the selected frame.');
  return node;
}
async function getFigmaVariables(figmaUrl, figmaToken) {
  const token = figmaToken || process.env.FIGMA_TOKEN;
  const { fileKey } = parseFigmaReference(figmaUrl);
  const response = await fetch(`https://api.figma.com/v1/files/${fileKey}/variables/local`, { headers: { 'X-Figma-Token': token } });
  if (!response.ok) return {};
  const payload = await response.json();
  return payload.meta?.variables || {};
}
function viewportFromFigmaNode(node) {
  const box = node.absoluteBoundingBox;
  const width = Math.round(box?.width);
  const height = Math.round(box?.height);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error('The selected Figma frame has no usable width and height. Select a frame node.');
  }
  return { width, height };
}
function viewportForRun(node, requested) {
  if (requested === undefined) return viewportFromFigmaNode(node);
  const width = Number(requested?.width), height = Number(requested?.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 240 || height < 240 || width > 4000 || height > 4000) {
    throw new Error('Viewport width and height must be whole numbers between 240 and 4000.');
  }
  return { width, height };
}
async function saveFigmaReference(figmaUrl, figmaToken, run, runDir) {
  const token = figmaToken || process.env.FIGMA_TOKEN;
  if (!token) return;
  const { fileKey, nodeId } = parseFigmaReference(figmaUrl);
  const response = await fetch(`https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=1`, { headers: { 'X-Figma-Token': token } });
  if (!response.ok) throw new Error(`Figma reference export failed (${response.status}).`);
  const payload = await response.json();
  const imageUrl = payload.images?.[nodeId];
  if (!imageUrl) throw new Error('Figma did not return an image for the selected frame.');
  const image = await fetch(imageUrl);
  if (!image.ok) throw new Error(`Could not download Figma reference (${image.status}).`);
  await writeFile(path.join(runDir, 'figma-reference.png'), Buffer.from(await image.arrayBuffer()));
  run.artifacts.push({ type: 'figma-reference', label: 'Figma references', url: `/artifacts/${run.id}/figma-reference.png` });
}
async function runSuite(run, request) {
  const { url, figmaUrl, figmaToken, dismissSelector } = request;
  const runDir = path.join(artifactRoot, run.id);
  await mkdir(runDir, { recursive: true });
  let browser;
  try {
    run.status = 'running';
    run.startedAt = new Date().toISOString();
    const target = safeUrl(url);
    const figmaNode = await getFigmaNode(figmaUrl, figmaToken);
    const viewport = viewportForRun(figmaNode, request.viewport);
    run.viewport = viewport;
    try { await saveFigmaReference(figmaUrl, figmaToken, run, runDir); }
    catch (error) { run.referenceError = error.message; }
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport, colorScheme: 'light', reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(target.href, { waitUntil: 'networkidle', timeout: 30_000 });
    run.resolvedUrl = page.url();
    if (dismissSelector) { try { await page.locator(dismissSelector).click({ timeout: 3_000 }); } catch { /* Optional notification. */ } }
    const currentPath = path.join(runDir, 'current.png');
    await page.screenshot({ path: currentPath, fullPage: false });
    run.artifacts.push({ type: 'screenshot', label: 'Current render', url: `/artifacts/${run.id}/current.png` });
    try {
      if (run.testType === 'wording') await runWordingCheck(page, figmaNode, run, runDir, currentPath);
      else {
        const figmaVariables = await getFigmaVariables(figmaUrl, figmaToken);
        if (run.testType === 'style-spacing') await runStyleSpacingCheck(page, figmaNode, figmaVariables, run, runDir, currentPath);
        else await runDesignQA(page, figmaNode, figmaVariables, run, runDir, currentPath);
      }
    } catch (error) {
      const title = run.testType === 'wording' ? 'Wording comparison unavailable' : run.testType === 'style-spacing' ? 'Style/spacing comparison unavailable' : 'Design QA comparison unavailable';
      run.findings.push(toFinding(run.testType, 'high', title, error.message));
    }
    run.status = run.findings.some(f => f.severity === 'high') ? 'failed' : 'passed';
  } catch (error) {
    run.status = 'error';
    run.error = error.message;
    const label = run.testType === 'wording' ? 'Wording' : run.testType === 'style-spacing' ? 'Style/spacing' : 'Design QA';
    run.findings.push(toFinding(run.testType, 'high', `${label} test could not complete`, error.message));
  } finally {
    run.finishedAt = new Date().toISOString();
    await writeFile(path.join(runDir, 'report.json'), JSON.stringify(run, null, 2));
    if (browser) await browser.close();
  }
}
app.post('/api/runs', (req, res) => {
  try {
    safeUrl(req.body.url);
    parseFigmaReference(req.body.figmaUrl);
    const testType = parseTestType(req.body.testType);
    if (req.body.includeHeaderFooter !== undefined && typeof req.body.includeHeaderFooter !== 'boolean') throw new Error('includeHeaderFooter must be true or false.');
    const allowedThresholds = ['positionPx', 'sizePx', 'sizePercent', 'spacingPx', 'fontSizePx', 'lineHeightPx', 'letterSpacingPx', 'fontWeight', 'borderWidthPx', 'radiusPx', 'colorDistance', 'opacity', 'matchMinimum', 'confidentMatch', 'pixelDifference'];
    const thresholds = req.body.thresholds === undefined ? undefined : Object.fromEntries(Object.entries(req.body.thresholds).filter(([key, value]) => allowedThresholds.includes(key) && Number.isFinite(value)));
    const run = { id: crypto.randomUUID(), status: 'queued', url: req.body.url, figmaUrl: req.body.figmaUrl, testType, includeHeaderFooter: req.body.includeHeaderFooter !== false, thresholds, findings: [], artifacts: [], createdAt: new Date().toISOString() };
    runs.set(run.id, run);
    res.status(202).json(run);
    void runSuite(run, req.body);
  } catch (error) { res.status(400).json({ error: error.message }); }
});
app.get('/api/runs/:id', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found.' });
  res.json(run);
});
app.get('/api/health', (_req, res) => res.json({ ok: true, browserInstalled: existsSync(path.join(root, 'node_modules')) }));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Web Quality Inspector running on http://localhost:${port}`));
