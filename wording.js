const normalize = value => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const words = value => normalize(value).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];

function similarity(left, right) {
  const a = words(left), b = words(right);
  if (!a.length || !b.length) return 0;
  const counts = new Map();
  for (const word of a) counts.set(word, (counts.get(word) || 0) + 1);
  let shared = 0;
  for (const word of b) if (counts.get(word)) { shared += 1; counts.set(word, counts.get(word) - 1); }
  return 2 * shared / (a.length + b.length);
}

function compareSection(label, figma, website) {
  const figmaUsed = new Set(), websiteUsed = new Set();
  const rows = [];

  // Match identical phrases first, regardless of their order within a section.
  for (let p = 0; p < website.length; p += 1) {
    const f = figma.findIndex((phrase, index) => !figmaUsed.has(index) && normalize(phrase.text) === normalize(website[p].text));
    if (f >= 0) { figmaUsed.add(f); websiteUsed.add(p); }
  }

  // Pair only phrases that share enough words to make a change plausible.
  const candidates = [];
  for (let p = 0; p < website.length; p += 1) if (!websiteUsed.has(p)) {
    for (let f = 0; f < figma.length; f += 1) if (!figmaUsed.has(f)) {
      const score = similarity(figma[f].text, website[p].text);
      const minimum = Math.min(words(figma[f].text).length, words(website[p].text).length) < 4 ? 0.55 : 0.42;
      if (score >= minimum) candidates.push({ f, p, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const candidate of candidates) {
    if (figmaUsed.has(candidate.f) || websiteUsed.has(candidate.p)) continue;
    figmaUsed.add(candidate.f); websiteUsed.add(candidate.p);
    rows.push({ kind: 'changed', figma: figma[candidate.f].text, website: website[candidate.p].text, region: website[candidate.p].region, order: website[candidate.p].order });
  }
  for (let p = 0; p < website.length; p += 1) if (!websiteUsed.has(p)) {
    rows.push({ kind: 'added', figma: '', website: website[p].text, region: website[p].region, order: website[p].order });
  }
  for (let f = 0; f < figma.length; f += 1) if (!figmaUsed.has(f)) {
    rows.push({ kind: 'missing', figma: figma[f].text, website: '', order: figma[f].order });
  }
  rows.sort((a, b) => a.order - b.order);
  return { label, rows };
}

export function compareWordingSections(figmaPhrases, pagePhrases) {
  const figma = [...figmaPhrases].sort((a, b) => a.y - b.y || a.x - b.x).map((item, order) => ({ ...item, order }));
  const website = pagePhrases.map((item, order) => ({ ...item, order }));
  const headings = website.map((item, index) => item.heading ? { index, text: item.text } : null).filter(Boolean);
  const usedAnchors = new Set();
  let lastAnchor = -1;
  for (const heading of headings) {
    const index = figma.findIndex((item, i) => i > lastAnchor && !usedAnchors.has(i) && normalize(item.text) === normalize(heading.text));
    heading.figmaIndex = index;
    if (index >= 0) { usedAnchors.add(index); lastAnchor = index; }
  }
  const firstMatch = headings.find(heading => heading.figmaIndex >= 0);
  if (!firstMatch) return [compareSection('Page content', figma, website)];

  const sections = [];
  if (firstMatch.index > 0 || firstMatch.figmaIndex > 0) {
    sections.push(compareSection('Header and introduction', figma.slice(0, firstMatch.figmaIndex), website.slice(0, firstMatch.index)));
  }
  for (let i = 0; i < headings.length; i += 1) {
    const current = headings[i];
    const pageEnd = headings[i + 1]?.index ?? website.length;
    const nextMatch = headings.slice(i + 1).find(heading => heading.figmaIndex >= 0);
    const figmaEnd = nextMatch?.figmaIndex ?? figma.length;
    const reference = current.figmaIndex >= 0 ? figma.slice(current.figmaIndex, figmaEnd) : [];
    sections.push(compareSection(current.text, reference, website.slice(current.index, pageEnd)));
  }
  return sections;
}
