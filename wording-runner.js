import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { compareWordingSections } from './wording.js';
import { drawBorder, selectContent, toFinding } from './run-shared.js';

async function saveWordingOverlay(run, runDir, sourcePath, rows, type, label, locate) {
  if (!rows.length) return;
  const overlay = PNG.sync.read(await sharp(sourcePath).png().toBuffer());
  const locations = {};
  const badges = [];
  for (const row of rows) {
    const region = locate(row, overlay);
    const left = Math.max(0, region.x);
    const top = Math.max(0, region.y);
    const right = Math.min(overlay.width, region.x + region.width);
    const bottom = Math.min(overlay.height, region.y + region.height);
    if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) continue;
    drawBorder(overlay, { x: left, y: top, width: right - left, height: bottom - top });

    const width = Math.min(12 + row.label.length * 9, overlay.width);
    const height = Math.min(22, overlay.height);
    const x = Math.max(0, Math.min(left, overlay.width - width));
    const positions = [top - height - 2, bottom + 2, top]
      .map(position => Math.max(0, Math.min(position, overlay.height - height)));
    const y = positions.find(position => !badges.some(badge =>
      x < badge.x + badge.width && x + width > badge.x &&
      position < badge.y + height && position + height > badge.y
    )) ?? positions[0];
    badges.push({ x, y, width, label: row.label });
    locations[row.label] = {
      left: 100 * (x + width / 2) / overlay.width,
      top: 100 * (y + height / 2) / overlay.height
    };
  }
  if (!badges.length) return;
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${overlay.width}" height="${overlay.height}">
    ${badges.map(({ x, y, width, label: marker }) => `<g transform="translate(${x} ${y})">
      <rect width="${width}" height="${Math.min(22, overlay.height)}" rx="4" fill="#a51d25" stroke="#fff"/>
      <text x="${width / 2}" y="15" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="bold" fill="#fff">${marker}</text>
    </g>`).join('')}
  </svg>`);
  const fileName = `${type}.png`;
  await sharp(PNG.sync.write(overlay)).composite([{ input: svg }]).png().toFile(path.join(runDir, fileName));
  run.artifacts.push({ type, label, url: `/artifacts/${run.id}/${fileName}`, width: overlay.width, height: overlay.height, locations });
}

export async function runWordingCheck(page, figmaNode, run, runDir, currentPath) {
  const { figmaPhrases, pagePhrases } = await selectContent(page, figmaNode, run.includeHeaderFooter);
  const sections = compareWordingSections(figmaPhrases, pagePhrases);
  const rows = sections.flatMap(section => section.rows);
  const counts = { changed: 0, added: 0, missing: 0 };
  rows.forEach((row, index) => {
    row.label = `W${index + 1}`;
    counts[row.kind] += 1;
  });
  run.comparisons = sections.filter(section => section.rows.length).map(section => ({
    label: section.label,
    rows: section.rows.map(({ label, kind, figma, website }) => ({ label, kind, figma, website }))
  }));
  await saveWordingOverlay(run, runDir, currentPath, rows.filter(row => row.region),
    'wording-overlay', 'Website issues: changed and website-only wording', row => row.region);
  const missingIssues = rows.filter(row => row.kind === 'missing' && row.figmaRegion);
  if (missingIssues.length && run.artifacts.some(artifact => artifact.type === 'figma-reference')) {
    const frame = figmaNode.absoluteBoundingBox;
    await saveWordingOverlay(run, runDir, path.join(runDir, 'figma-reference.png'), missingIssues,
      'figma-wording-overlay', 'Figma issues: wording missing from the website', ({ figmaRegion }, overlay) => ({
        x: Math.round((figmaRegion.x - frame.x) * overlay.width / frame.width),
        y: Math.round((figmaRegion.y - frame.y) * overlay.height / frame.height),
        width: Math.ceil(figmaRegion.width * overlay.width / frame.width),
        height: Math.ceil(figmaRegion.height * overlay.height / frame.height)
      }));
  }
  if (counts.changed || counts.added || counts.missing) run.findings.push(toFinding('wording', 'high', 'Wording differs from Figma', `${counts.changed} changed, ${counts.added} added on the website, ${counts.missing} missing from the website. Review the phrases by section below.`));
}
