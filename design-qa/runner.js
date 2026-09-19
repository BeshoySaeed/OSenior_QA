import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { analyzeFigma } from './figma-analyzer.js';
import { analyzeWebsite } from './website-analyzer.js';
import { matchElements } from './matcher.js';
import { compareModels } from './comparison-engine.js';
import { calculateScores } from './scoring.js';
import { createVisualArtifacts } from './visual-artifacts.js';
import { DEFAULT_THRESHOLDS } from './config.js';
import { drawBorder, toFinding } from '../run-shared.js';

async function annotate(inputPath, outputPath, regions) {
  if (!regions.length) return false;
  const image = PNG.sync.read(await sharp(inputPath).png().toBuffer());
  const unique = new Map(regions.map(region => [`${region.x}:${region.y}:${region.width}:${region.height}`, region]));
  unique.forEach(region => drawBorder(image, {
    x: Math.max(0, Math.round(region.x)), y: Math.max(0, Math.round(region.y)),
    width: Math.max(1, Math.round(region.width)), height: Math.max(1, Math.round(region.height))
  }));
  await writeFile(outputPath, PNG.sync.write(image));
  return true;
}

export async function runDesignQA(page, figmaNode, figmaVariables, run, runDir, currentPath) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(run.thresholds || {}) };
  const [figmaModel, websiteModel] = await Promise.all([
    Promise.resolve(analyzeFigma(figmaNode, { viewport: run.viewport, variables: figmaVariables, includeHeaderFooter: run.includeHeaderFooter })),
    analyzeWebsite(page, { includeHeaderFooter: run.includeHeaderFooter })
  ]);
  const matching = matchElements(figmaModel, websiteModel, { minimum: thresholds.matchMinimum });
  const comparison = compareModels(figmaModel, websiteModel, matching, thresholds);
  const scores = calculateScores(comparison.checks, matching);
  const counts = comparison.issues.reduce((result, issue) => ({ ...result, [issue.severity]: (result[issue.severity] || 0) + 1 }), { critical: 0, major: 0, minor: 0 });

  run.issues = comparison.issues;
  run.scores = scores;
  run.analysis = {
    figmaElements: figmaModel.nodes.length, websiteElements: websiteModel.nodes.length,
    matchedElements: matching.matches.length, unmatchedFigma: matching.unmatchedFigma.length,
    unmatchedWebsite: matching.unmatchedWebsite.length,
    viewportNormalization: figmaModel.normalization,
    pixelEvidenceIsSupportingOnly: true,
    thresholds
  };
  run.matches = matching.matches.map(match => ({
    figmaId: match.figma.id, websiteId: match.website.id,
    figmaName: match.figma.name, websiteSelector: match.website.selector,
    role: match.figma.role, confidence: match.confidence, signals: match.signals,
    figmaRegion: match.figma.rect, websiteRegion: match.website.rect
  }));
  const issuesByCategory = comparison.issues.reduce((groups, issue) => {
    (groups[issue.category] ||= []).push(issue);
    return groups;
  }, {});
  run.comparisons = Object.entries(issuesByCategory).map(([label, issues]) => ({
    label: label[0].toUpperCase() + label.slice(1),
    rows: issues.map(issue => ({ kind: 'changed', issue: issue.type, figma: JSON.stringify(issue.expected), website: JSON.stringify(issue.actual) }))
  }));

  if (comparison.issues.length) {
    run.findings.push(toFinding('design-qa', 'high', `${comparison.issues.length} design QA issue${comparison.issues.length === 1 ? '' : 's'} found`, `${counts.critical} critical, ${counts.major} major, and ${counts.minor} minor. Overall alignment: ${scores.overall}%.`));
  }
  const websiteRegions = comparison.issues.map(issue => issue.websiteRegion).filter(Boolean);
  if (await annotate(currentPath, path.join(runDir, 'design-qa-issues.png'), websiteRegions)) {
    run.artifacts.push({ type: 'design-qa-issues', label: 'Website issues highlighted', url: `/artifacts/${run.id}/design-qa-issues.png` });
  }
  const figmaReference = path.join(runDir, 'figma-reference.png');
  if (run.artifacts.some(artifact => artifact.type === 'figma-reference')) {
    const visual = await createVisualArtifacts({ currentPath, figmaPath: figmaReference, runDir, runId: run.id, viewport: run.viewport, pixelThreshold: thresholds.pixelDifference });
    run.visualEvidence = { pixelDifferenceRatio: visual.pixelDifferenceRatio, role: 'supporting evidence; not used in issue severity or scores' };
    run.artifacts.push(...visual.artifacts);
    const normalizedPath = path.join(runDir, 'figma-normalized.png');
    const figmaRegions = comparison.issues.map(issue => issue.figmaRegion).filter(Boolean);
    if (await annotate(normalizedPath, path.join(runDir, 'figma-issues.png'), figmaRegions)) {
      run.artifacts.push({ type: 'figma-issues', label: 'Figma issue regions highlighted', url: `/artifacts/${run.id}/figma-issues.png` });
    }
  }
}
