import express from 'express';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { PNG } from 'pngjs';
import sharp from 'sharp';

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
const toFinding = (severity, title, description) => ({ id: crypto.randomUUID(), category: 'wording', severity, title, description });

function drawBorder(image, region) {
  const color = [239, 49, 49, 255], thickness = 3;
  const set = (x, y) => { if (x >= 0 && x < image.width && y >= 0 && y < image.height) image.data.set(color, (y * image.width + x) * 4); };
  for (let offset = 0; offset < thickness; offset += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) { set(x, region.y + offset); set(x, region.y + region.height - 1 - offset); }
    for (let y = region.y; y < region.y + region.height; y += 1) { set(region.x + offset, y); set(region.x + region.width - 1 - offset, y); }
  }
}
function figmaTextNodes(node, words = []) {
  if (!node || typeof node !== 'object') return words;
  if (node.type === 'TEXT' && node.characters) words.push(...node.characters.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []);
  for (const child of node.children || []) figmaTextNodes(child, words);
  return words;
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
function viewportFromFigmaNode(node) {
  const box = node.absoluteBoundingBox;
  const width = Math.round(box?.width);
  const height = Math.round(box?.height);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error('The selected Figma frame has no usable width and height. Select a frame node.');
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
async function getPageWords(page) {
  return page.evaluate(() => {
    const words = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.parentElement || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.parentElement.tagName)) continue;
      const text = node.textContent || '', matcher = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
      let match;
      while ((match = matcher.exec(text))) {
        const range = document.createRange(); range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight) words.push({ word: match[0].toLocaleLowerCase(), x: Math.round(rect.x), y: Math.round(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height) });
      }
    }
    return words;
  });
}
async function runWordingCheck(page, figmaNode, run, runDir, currentPath) {
  const [figmaWords, pageWords] = await Promise.all([Promise.resolve(figmaTextNodes(figmaNode).map(word => word.toLocaleLowerCase())), getPageWords(page)]);
  const expected = new Map(); for (const word of figmaWords) expected.set(word, (expected.get(word) || 0) + 1);
  const seen = new Map(), differing = [];
  for (const word of pageWords) { const count = (seen.get(word.word) || 0) + 1; seen.set(word.word, count); if (count > (expected.get(word.word) || 0)) differing.push(word); }
  const missing = [...expected].filter(([word, count]) => (seen.get(word) || 0) < count).map(([word]) => word).slice(0, 20);
  const overlay = PNG.sync.read(await sharp(currentPath).png().toBuffer());
  differing.forEach(region => drawBorder(overlay, region));
  await writeFile(path.join(runDir, 'wording-overlay.png'), PNG.sync.write(overlay));
  run.artifacts.push({ type: 'wording-overlay', label: 'Page with wording differences marked', url: `/artifacts/${run.id}/wording-overlay.png` });
  if (differing.length || missing.length) run.findings.push(toFinding('high', 'Wording differs from Figma', `${differing.length} page word${differing.length === 1 ? '' : 's'} highlighted. ${missing.length ? `Words in Figma not found on page: ${missing.join(', ')}.` : ''}`));
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
    const viewport = viewportFromFigmaNode(figmaNode);
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
    try { await runWordingCheck(page, figmaNode, run, runDir, currentPath); }
    catch (error) { run.findings.push(toFinding('high', 'Wording comparison unavailable', error.message)); }
    run.status = run.findings.some(f => f.severity === 'high') ? 'failed' : 'passed';
  } catch (error) {
    run.status = 'error';
    run.error = error.message;
    run.findings.push(toFinding('high', 'Wording test could not complete', error.message));
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
    const run = { id: crypto.randomUUID(), status: 'queued', url: req.body.url, figmaUrl: req.body.figmaUrl, findings: [], artifacts: [], createdAt: new Date().toISOString() };
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
app.listen(port, () => console.log(`Wording Inspector running on http://localhost:${port}`));
