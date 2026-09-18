import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { compareStyleSpacing } from './style-spacing.js';
import { drawBorder, selectContent, toFinding } from './run-shared.js';

export async function runStyleSpacingCheck(page, figmaNode, run, runDir, currentPath) {
  const { figmaPhrases, pagePhrases } = await selectContent(page, figmaNode, run.includeHeaderFooter);
  const sections = compareStyleSpacing(figmaPhrases, pagePhrases, figmaNode.absoluteBoundingBox);
  run.comparisons = sections.filter(section => section.rows.length).map(section => ({
    label: section.label,
    rows: section.rows.map(({ kind, figma, website }) => ({ kind, figma, website }))
  }));
  const issues = sections.flatMap(section => section.rows);
  if (!issues.length) return;
  const overlay = PNG.sync.read(await sharp(currentPath).png().toBuffer());
  issues.forEach(issue => drawBorder(overlay, issue.region));
  await writeFile(path.join(runDir, 'style-spacing-overlay.png'), PNG.sync.write(overlay));
  run.artifacts.push({ type: 'style-spacing-overlay', label: 'Website style and spacing issues', url: `/artifacts/${run.id}/style-spacing-overlay.png` });
  run.findings.push(toFinding('style-spacing', 'high', 'Style/spacing differs from Figma', `${issues.length} style or spacing difference${issues.length === 1 ? '' : 's'} found. Review the values by section below.`));
}
