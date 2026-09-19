import { SCORE_WEIGHTS } from './config.js';

const round = value => Math.round(value * 10) / 10;

export function calculateScores(checks, matching) {
  const categories = {};
  for (const category of Object.keys(SCORE_WEIGHTS)) {
    const categoryChecks = checks.filter(check => check.category === category);
    categories[category] = categoryChecks.length ? round(100 * categoryChecks.reduce((sum, check) => sum + check.quality, 0) / categoryChecks.length) : 100;
  }
  const componentRoles = new Set(['button', 'input', 'card', 'component', 'dialog', 'navigation']);
  const componentFigma = [...matching.matches.map(match => match.figma), ...matching.unmatchedFigma].filter(node => componentRoles.has(node.role));
  const componentWebsite = [...matching.matches.map(match => match.website), ...matching.unmatchedWebsite].filter(node => componentRoles.has(node.role));
  const componentMatches = matching.matches.filter(match => componentRoles.has(match.figma.role) || componentRoles.has(match.website.role)).length;
  const precision = componentWebsite.length ? componentMatches / componentWebsite.length : 1;
  const recall = componentFigma.length ? componentMatches / componentFigma.length : 1;
  categories.components = round((precision + recall) > 0 ? 200 * precision * recall / (precision + recall) : 0);

  const active = Object.entries(SCORE_WEIGHTS);
  const overall = round(active.reduce((sum, [category, weight]) => sum + categories[category] * weight, 0) / active.reduce((sum, [, weight]) => sum + weight, 0));
  const averageConfidence = matching.matches.length ? round(matching.matches.reduce((sum, match) => sum + match.confidence, 0) / matching.matches.length) : 0;
  return {
    overall,
    categories: {
      structure: categories.structure, layout: categories.geometry, spacing: categories.spacing,
      typography: categories.typography, colorsAndVisuals: categories.visual,
      content: categories.content, components: categories.components
    },
    averageMatchConfidence: averageConfidence,
    calculation: {
      method: 'Each deterministic check produces a quality value from 0 to 1 based on its measured deviation and configured tolerance. Category scores are the arithmetic mean of their checks. The overall score is a weighted mean.',
      weights: SCORE_WEIGHTS,
      componentMethod: 'F1 score from matched, missing, and unexpected interactive/component roles.',
      checkCount: checks.length
    }
  };
}
