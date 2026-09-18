import crypto from 'node:crypto';

export const toFinding = (category, severity, title, description) => ({
  id: crypto.randomUUID(), category, severity, title, description
});

export function drawBorder(image, region) {
  const color = [239, 49, 49, 255], thickness = 3;
  const set = (x, y) => { if (x >= 0 && x < image.width && y >= 0 && y < image.height) image.data.set(color, (y * image.width + x) * 4); };
  for (let offset = 0; offset < thickness; offset += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) { set(x, region.y + offset); set(x, region.y + region.height - 1 - offset); }
    for (let y = region.y; y < region.y + region.height; y += 1) { set(region.x + offset, y); set(region.x + region.width - 1 - offset, y); }
  }
}

function figmaColor(node) {
  const fill = node.fills?.find(item => item.visible !== false && item.type === 'SOLID');
  if (!fill?.color) return undefined;
  return [fill.color.r, fill.color.g, fill.color.b].map(channel => Math.round(channel * 255));
}

function figmaTextPhrases(node, includeHeaderFooter, phrases = []) {
  if (!node || typeof node !== 'object' || node.visible === false) return phrases;
  if (!includeHeaderFooter && /(^|[\s_-])(header|footer)([\s_-]|$)/i.test(node.name || '')) return phrases;
  const box = node.absoluteBoundingBox;
  if (node.type === 'TEXT' && node.characters?.trim() && box) {
    phrases.push({
      text: node.characters.trim(), x: box.x, y: box.y, width: box.width, height: box.height,
      style: { fontSize: node.style?.fontSize, fontWeight: node.style?.fontWeight, lineHeight: node.style?.lineHeightPx, color: figmaColor(node) }
    });
  }
  for (const child of node.children || []) figmaTextPhrases(child, includeHeaderFooter, phrases);
  return phrases;
}

async function getPagePhrases(page, includeHeaderFooter) {
  return page.evaluate(includeHeaderFooter => {
    const phrases = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const excludedSelector = 'header, footer, #mc-header, #mc-footer, .mc-header, .mc-footer';
    const excludedRegions = includeHeaderFooter ? [] : [...document.querySelectorAll(excludedSelector)].map(element => {
      const rect = element.getBoundingClientRect();
      return { y: rect.y, height: rect.height };
    }).filter(rect => rect.height > 0);
    const seenHeadings = new Set();
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName) || parent.closest('[aria-hidden="true"]') || (!includeHeaderFooter && parent.closest(excludedSelector))) continue;
      const heading = parent.closest('h1,h2,h3');
      if (heading && seenHeadings.has(heading)) continue;
      const text = (heading ? heading.textContent : node.textContent)?.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const range = document.createRange();
      if (heading) { range.selectNodeContents(heading); seenHeadings.add(heading); }
      else range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
      const computed = window.getComputedStyle(heading || parent);
      const color = computed.color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      phrases.push({
        text, heading: Boolean(heading),
        region: { x: Math.max(0, Math.round(rect.x)), y: Math.max(0, Math.round(rect.y)), width: Math.ceil(rect.width), height: Math.ceil(rect.height) },
        style: { fontSize: parseFloat(computed.fontSize), fontWeight: parseFloat(computed.fontWeight), lineHeight: parseFloat(computed.lineHeight), color }
      });
    }
    return { phrases, excludedRegions };
  }, includeHeaderFooter);
}

export async function selectContent(page, figmaNode, includeHeaderFooter) {
  const { phrases: pagePhrases, excludedRegions } = await getPagePhrases(page, includeHeaderFooter);
  const allFigmaPhrases = figmaTextPhrases(figmaNode, includeHeaderFooter);
  if (!allFigmaPhrases.length && includeHeaderFooter) throw new Error('No text was found in the selected Figma frame.');
  const frameTop = figmaNode.absoluteBoundingBox.y;
  const figmaPhrases = allFigmaPhrases.filter(phrase => {
    const centerY = phrase.y - frameTop + phrase.height / 2;
    return !excludedRegions.some(region => centerY >= region.y && centerY <= region.y + region.height);
  });
  return { figmaPhrases, pagePhrases };
}
