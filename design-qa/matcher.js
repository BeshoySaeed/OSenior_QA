const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function tokenSet(value) { return new Set(normalize(value).split(' ').filter(Boolean)); }
function jaccard(left, right) {
  const a = tokenSet(left), b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}
function textScore(figma, website) {
  const directA = normalize(figma.text), directB = normalize(website.text);
  if (directA && directA === directB) return 1;
  const direct = jaccard(directA, directB);
  const descendants = jaccard(figma.texts.join(' '), website.texts.join(' '));
  return Math.max(direct, descendants);
}
function roleScore(left, right) {
  if (left === right) return 1;
  const groups = [
    new Set(['container', 'component', 'card', 'list', 'table']),
    new Set(['button', 'input']),
    new Set(['text']),
    new Set(['icon', 'image', 'shape'])
  ];
  return groups.some(group => group.has(left) && group.has(right)) ? 0.6 : 0;
}
function geometryScore(left, right, viewport) {
  const diagonal = Math.hypot(viewport.width, viewport.height) || 1;
  const centerA = { x: left.x + left.width / 2, y: left.y + left.height / 2 };
  const centerB = { x: right.x + right.width / 2, y: right.y + right.height / 2 };
  const distance = Math.hypot(centerA.x - centerB.x, centerA.y - centerB.y) / diagonal;
  const width = Math.min(left.width, right.width) / Math.max(left.width, right.width, 1);
  const height = Math.min(left.height, right.height) / Math.max(left.height, right.height, 1);
  return Math.max(0, 1 - distance * 3) * 0.55 + width * 0.225 + height * 0.225;
}
function colorScore(left, right) {
  const a = left.visual?.background || left.visual?.color;
  const b = right.visual?.background || right.visual?.color;
  if (!a || !b) return 0.5;
  const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  return Math.max(0, 1 - distance / 180);
}

export function matchElements(figmaModel, websiteModel, { minimum = 0.52 } = {}) {
  const candidates = [];
  for (const figma of figmaModel.nodes) {
    for (const website of websiteModel.nodes) {
      const signals = {
        text: textScore(figma, website), role: roleScore(figma.role, website.role),
        geometry: geometryScore(figma.rect, website.rect, websiteModel.viewport),
        visual: colorScore(figma, website)
      };
      if (!signals.text && !signals.role) continue;
      let score = signals.text * 0.44 + signals.role * 0.24 + signals.geometry * 0.24 + signals.visual * 0.08;
      if (signals.text === 1) score = Math.max(score, 0.78 + signals.role * 0.1 + signals.geometry * 0.08);
      candidates.push({ figma, website, signals, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const figmaUsed = new Set(), websiteUsed = new Set(), matches = [];
  for (const candidate of candidates) {
    if (candidate.score < minimum || figmaUsed.has(candidate.figma.id) || websiteUsed.has(candidate.website.id)) continue;
    figmaUsed.add(candidate.figma.id); websiteUsed.add(candidate.website.id);
    matches.push(candidate);
  }

  const matchByFigma = new Map(matches.map(match => [match.figma.id, match]));
  for (const match of matches) {
    if (!match.figma.parentId || !match.website.parentId) continue;
    const parent = matchByFigma.get(match.figma.parentId);
    const hierarchy = parent?.website.id === match.website.parentId ? 1 : 0;
    match.signals.hierarchy = hierarchy;
    match.score = Math.min(1, match.score * 0.9 + hierarchy * 0.1);
  }
  matches.sort((a, b) => a.figma.order - b.figma.order);
  return {
    matches: matches.map(match => ({ ...match, confidence: Math.round(match.score * 100) })),
    unmatchedFigma: figmaModel.nodes.filter(node => !figmaUsed.has(node.id)),
    unmatchedWebsite: websiteModel.nodes.filter(node => !websiteUsed.has(node.id))
  };
}
