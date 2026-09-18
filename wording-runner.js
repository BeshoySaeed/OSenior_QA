import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { compareWordingSections } from './wording.js';
import { drawBorder, selectContent, toFinding } from './run-shared.js';

export async function runWordingCheck(page, figmaNode, run, runDir, currentPath) {
  const { figmaPhrases, pagePhrases } = await selectContent(page, figmaNode, run.includeHeaderFooter);
  const sections = compareWordingSections(figmaPhrases, pagePhrases);
  run.comparisons = sections.filter(section => section.rows.length).map(section => ({
    label: section.label,
    rows: section.rows.map(({ kind, figma, website }) => ({ kind, figma, website }))
  }));
  const rows = sections.flatMap(section => section.rows);
  const counts = { changed: 0, added: 0, missing: 0 };
  rows.forEach(row => { counts[row.kind] += 1; });
  const websiteIssues = rows.filter(row => row.region && ['changed', 'added'].includes(row.kind));
  if (websiteIssues.length) {
    const overlay = PNG.sync.read(await sharp(currentPath).png().toBuffer());
    websiteIssues.forEach(row => drawBorder(overlay, row.region));
    await writeFile(path.join(runDir, 'wording-overlay.png'), PNG.sync.write(overlay));
    run.artifacts.push({ type: 'wording-overlay', label: 'Website issues: changed and website-only wording', url: `/artifacts/${run.id}/wording-overlay.png` });
  }
  const missingIssues = rows.filter(row => row.kind === 'missing' && row.figmaRegion);
  if (missingIssues.length && run.artifacts.some(artifact => artifact.type === 'figma-reference')) {
    const overlay = PNG.sync.read(await sharp(path.join(runDir, 'figma-reference.png')).png().toBuffer());
    const frame = figmaNode.absoluteBoundingBox;
    missingIssues.forEach(row => drawBorder(overlay, {
      x: Math.round((row.figmaRegion.x - frame.x) * overlay.width / frame.width),
      y: Math.round((row.figmaRegion.y - frame.y) * overlay.height / frame.height),
      width: Math.ceil(row.figmaRegion.width * overlay.width / frame.width),
      height: Math.ceil(row.figmaRegion.height * overlay.height / frame.height)
    }));
    await writeFile(path.join(runDir, 'figma-wording-overlay.png'), PNG.sync.write(overlay));
    run.artifacts.push({ type: 'figma-wording-overlay', label: 'Figma issues: wording missing from the website', url: `/artifacts/${run.id}/figma-wording-overlay.png` });
  }
  if (counts.changed || counts.added || counts.missing) run.findings.push(toFinding('wording', 'high', 'Wording differs from Figma', `${counts.changed} changed, ${counts.added} added on the website, ${counts.missing} missing from the website. Review the phrases by section below.`));
}
