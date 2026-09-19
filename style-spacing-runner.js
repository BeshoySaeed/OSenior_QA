import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { compareStyleSpacing } from './style-spacing.js';
import { drawBorder, selectContent, toFinding } from './run-shared.js';

const spacingKeys = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing'];
const excludedName = name => /(^|[\s_-])(header|footer)([\s_-]|$)/i.test(name || '');

function descendantTexts(node, texts = []) {
  if (node?.visible === false) return texts;
  if (node?.type === 'TEXT' && node.characters?.trim()) texts.push(node.characters.trim());
  for (const child of node?.children || []) descendantTexts(child, texts);
  return texts;
}

function variableName(binding, variables) {
  const id = binding?.id || binding?.variableId;
  return id ? variables[id]?.name : undefined;
}

function collectFigmaLayouts(node, includeHeaderFooter, variables) {
  const layouts = [], root = node?.absoluteBoundingBox;
  const visit = (current, parentId = null, depth = 0) => {
    if (!current || current.visible === false || (!includeHeaderFooter && excludedName(current.name))) return;
    const isLayout = ['HORIZONTAL', 'VERTICAL'].includes(current.layoutMode);
    const box = current.absoluteBoundingBox;
    let nextParent = parentId;
    if (isLayout && box && root) {
      const tokens = {};
      for (const key of spacingKeys) tokens[key] = variableName(current.boundVariables?.[key], variables);
      const childBoxes = (current.children || []).filter(child => child.visible !== false && child.absoluteBoundingBox).map(child => child.absoluteBoundingBox);
      const visualInsets = childBoxes.length ? {
        paddingTop: Math.max(0, Math.min(...childBoxes.map(child => child.y)) - box.y),
        paddingRight: Math.max(0, box.x + box.width - Math.max(...childBoxes.map(child => child.x + child.width))),
        paddingBottom: Math.max(0, box.y + box.height - Math.max(...childBoxes.map(child => child.y + child.height))),
        paddingLeft: Math.max(0, Math.min(...childBoxes.map(child => child.x)) - box.x)
      } : undefined;
      const ordered = [...childBoxes].sort((left, right) => current.layoutMode === 'HORIZONTAL' ? left.x - right.x : left.y - right.y);
      const gaps = ordered.slice(1).map((child, index) => current.layoutMode === 'HORIZONTAL'
        ? child.x - (ordered[index].x + ordered[index].width)
        : child.y - (ordered[index].y + ordered[index].height)).filter(value => value >= 0);
      const visualGap = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : undefined;
      const id = current.id || `figma-layout-${layouts.length}`;
      layouts.push({
        id, parentId, depth, name: current.name || current.type, layoutMode: current.layoutMode,
        texts: descendantTexts(current), leafCount: descendantTexts(current).length,
        region: { x: box.x - root.x, y: box.y - root.y, width: box.width, height: box.height },
        spacing: Object.fromEntries(spacingKeys.map(key => [key, Number(current[key] ?? 0)])),
        visualInsets, visualGap, tokens,
        primaryAxisAlignItems: current.primaryAxisAlignItems, counterAxisAlignItems: current.counterAxisAlignItems
      });
      nextParent = id;
    }
    for (const child of current.children || []) visit(child, nextParent, depth + (isLayout ? 1 : 0));
  };
  visit(node);
  return layouts;
}

async function collectPageLayouts(page, includeHeaderFooter) {
  return page.evaluate(includeHeaderFooter => {
    const excludedSelector = 'header, footer, #mc-header, #mc-footer, .mc-header, .mc-footer';
    const properties = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'row-gap', 'column-gap'];
    const normalize = value => value.replace(/\s+/g, ' ').trim();
    const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const toPixels = value => {
      const match = String(value).trim().match(/^(-?[\d.]+)(px|rem|em)?$/i);
      if (!match) return undefined;
      const number = Number(match[1]);
      return match[2]?.toLowerCase() === 'rem' ? number * rootSize : number;
    };
    const rules = [], customProperties = new Map();
    const readRules = cssRules => {
      for (const rule of cssRules || []) {
        if (rule.cssRules) { readRules(rule.cssRules); continue; }
        if (!rule.style) continue;
        for (const name of rule.style) {
          if (!name.startsWith('--')) continue;
          const value = toPixels(rule.style.getPropertyValue(name));
          if (Number.isFinite(value) && value >= 0 && /(?:space|spacing|gap|gutter|inset|padding|margin|(?:^|[-_])(?:xxs|xs|sm|md|lg|xl|\d+xl)(?:$|[-_]))/i.test(name)) customProperties.set(name, value);
        }
        if (rule.selectorText) rules.push({ selector: rule.selectorText, values: Object.fromEntries(properties.map(property => [property, rule.style.getPropertyValue(property)]).filter(([, value]) => value)) });
      }
    };
    for (const sheet of document.styleSheets) { try { readRules(sheet.cssRules); } catch { /* Cross-origin styles cannot expose source tokens. */ } }
    for (const name of getComputedStyle(document.documentElement)) {
      if (!name.startsWith('--') || customProperties.has(name)) continue;
      const value = toPixels(getComputedStyle(document.documentElement).getPropertyValue(name));
      if (Number.isFinite(value) && value >= 0 && /(?:space|spacing|gap|gutter|inset|padding|margin|(?:^|[-_])(?:xxs|xs|sm|md|lg|xl|\d+xl)(?:$|[-_]))/i.test(name)) customProperties.set(name, value);
    }
    const tokens = [...customProperties].map(([name, value]) => ({ name, value }));
    const tokenAt = value => tokens.find(token => Math.abs(token.value - value) <= 0.1)?.name;
    const selectorFor = element => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const testId = element.getAttribute('data-testid');
      if (testId) return `[data-testid="${testId.replace(/"/g, '\\"')}"]`;
      const classes = [...element.classList].slice(0, 2).map(value => `.${CSS.escape(value)}`).join('');
      return `${element.tagName.toLowerCase()}${classes}`;
    };
    const layoutItems = [];
    for (const element of document.body.querySelectorAll('*')) {
      if (!includeHeaderFooter && element.closest(excludedSelector)) continue;
      const computed = getComputedStyle(element), rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || computed.visibility === 'hidden' || computed.display === 'none') continue;
      const authored = {};
      for (const rule of rules) {
        try { if (element.matches(rule.selector)) Object.assign(authored, rule.values); } catch { /* Unsupported selector. */ }
      }
      for (const property of properties) if (element.style.getPropertyValue(property)) authored[property] = element.style.getPropertyValue(property);
      const isLayout = ['flex', 'inline-flex', 'grid', 'inline-grid'].includes(computed.display);
      const structuralContainer = ['main', 'section', 'article', 'details', 'summary', 'ol', 'ul'].includes(element.tagName.toLowerCase()) && element.children.length > 0;
      if (!isLayout && !Object.keys(authored).length && !structuralContainer) continue;
      const texts = [...element.querySelectorAll('*')].filter(child => !child.children.length).map(child => normalize(child.textContent || '')).filter(Boolean);
      const ownText = normalize([...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(' '));
      if (ownText) texts.unshift(ownText);
      const vertical = computed.flexDirection?.startsWith('column') || computed.display.includes('grid');
      const gapProperty = vertical ? 'row-gap' : 'column-gap';
      const gapValue = parseFloat(computed[vertical ? 'rowGap' : 'columnGap']);
      const directRects = [];
      for (const child of element.children) {
        const childStyle = getComputedStyle(child), childRect = child.getBoundingClientRect();
        if (childStyle.display === 'none' || childStyle.visibility === 'hidden' || ['absolute', 'fixed'].includes(childStyle.position) || childRect.width <= 0 || childRect.height <= 0) continue;
        directRects.push({ x: childRect.x, y: childRect.y, width: childRect.width, height: childRect.height });
      }
      for (const child of element.childNodes) {
        if (child.nodeType !== Node.TEXT_NODE || !normalize(child.textContent)) continue;
        const range = document.createRange();
        range.selectNodeContents(child);
        const textRect = range.getBoundingClientRect();
        if (textRect.width > 0 && textRect.height > 0) directRects.push({ x: textRect.x, y: textRect.y, width: textRect.width, height: textRect.height });
      }
      const visualInsets = directRects.length ? {
        paddingTop: Math.max(0, Math.min(...directRects.map(child => child.y)) - rect.y),
        paddingRight: Math.max(0, rect.x + rect.width - Math.max(...directRects.map(child => child.x + child.width))),
        paddingBottom: Math.max(0, rect.y + rect.height - Math.max(...directRects.map(child => child.y + child.height))),
        paddingLeft: Math.max(0, Math.min(...directRects.map(child => child.x)) - rect.x)
      } : undefined;
      const ordered = [...directRects].sort((left, right) => vertical ? left.y - right.y : left.x - right.x);
      const measuredGaps = ordered.slice(1).map((child, index) => vertical
        ? child.y - (ordered[index].y + ordered[index].height)
        : child.x - (ordered[index].x + ordered[index].width)).filter(value => value >= 0);
      const visualGap = measuredGaps.length ? measuredGaps.sort((a, b) => a - b)[Math.floor(measuredGaps.length / 2)] : undefined;
      const spacing = {
        paddingTop: parseFloat(computed.paddingTop), paddingRight: parseFloat(computed.paddingRight),
        paddingBottom: parseFloat(computed.paddingBottom), paddingLeft: parseFloat(computed.paddingLeft),
        itemSpacing: Number.isFinite(gapValue) ? gapValue : undefined
      };
      const innerMain = vertical ? rect.height - spacing.paddingTop - spacing.paddingBottom : rect.width - spacing.paddingLeft - spacing.paddingRight;
      const usedMain = directRects.reduce((sum, child) => sum + (vertical ? child.height : child.width), 0) + (Number.isFinite(gapValue) ? gapValue * Math.max(0, directRects.length - 1) : 0);
      const innerCross = vertical ? rect.width - spacing.paddingLeft - spacing.paddingRight : rect.height - spacing.paddingTop - spacing.paddingBottom;
      const hasAutoMainMargin = [...element.children].some(child => {
        const childStyle = getComputedStyle(child);
        return vertical ? ['auto'].includes(childStyle.marginTop) || ['auto'].includes(childStyle.marginBottom) : ['auto'].includes(childStyle.marginLeft) || ['auto'].includes(childStyle.marginRight);
      });
      layoutItems.push({
        element,
        selector: selectorFor(element), texts: [...new Set(texts)],
        region: { x: Math.max(0, Math.round(rect.x)), y: Math.max(0, Math.round(rect.y)), width: Math.ceil(rect.width), height: Math.ceil(rect.height) },
        layoutMode: isLayout ? (vertical ? 'VERTICAL' : 'HORIZONTAL') : 'BLOCK',
        leafCount: texts.length, spacing, visualInsets, visualGap, authored,
        tokens: {
          paddingTop: /var\(\s*(--[\w-]+)/i.exec(authored['padding-top'])?.[1] || tokenAt(spacing.paddingTop),
          paddingRight: /var\(\s*(--[\w-]+)/i.exec(authored['padding-right'])?.[1] || tokenAt(spacing.paddingRight),
          paddingBottom: /var\(\s*(--[\w-]+)/i.exec(authored['padding-bottom'])?.[1] || tokenAt(spacing.paddingBottom),
          paddingLeft: /var\(\s*(--[\w-]+)/i.exec(authored['padding-left'])?.[1] || tokenAt(spacing.paddingLeft),
          itemSpacing: /var\(\s*(--[\w-]+)/i.exec(authored[gapProperty])?.[1] || tokenAt(spacing.itemSpacing)
        },
        gapApplicable: isLayout || Number.isFinite(visualGap),
        primaryAlignmentRelevant: isLayout && directRects.length > 0 && !hasAutoMainMargin && innerMain - usedMain > 1,
        counterAlignmentRelevant: isLayout && directRects.some(child => innerCross - (vertical ? child.width : child.height) > 1),
        alignment: { justifyContent: computed.justifyContent, alignItems: computed.alignItems }
      });
    }
    const indexByElement = new Map(layoutItems.map((item, index) => [item.element, index]));
    const layouts = layoutItems.map((item, index) => {
      let parent = item.element.parentElement, depth = 0, parentIndex;
      while (parent) {
        if (indexByElement.has(parent)) { if (parentIndex === undefined) parentIndex = indexByElement.get(parent); depth += 1; }
        parent = parent.parentElement;
      }
      const { element, ...serialized } = item;
      return { ...serialized, id: `page-layout-${index}`, parentId: parentIndex === undefined ? null : `page-layout-${parentIndex}`, depth };
    });
    return { layouts, tokens };
  }, includeHeaderFooter);
}

export async function runStyleSpacingCheck(page, figmaNode, figmaVariables, run, runDir, currentPath) {
  const [{ figmaPhrases, pagePhrases }, pageData] = await Promise.all([
    selectContent(page, figmaNode, run.includeHeaderFooter), collectPageLayouts(page, run.includeHeaderFooter)
  ]);
  const figmaLayouts = collectFigmaLayouts(figmaNode, run.includeHeaderFooter, figmaVariables);
  const sections = compareStyleSpacing({ figmaLayouts, pageLayouts: pageData.layouts, figmaPhrases, pagePhrases, tokens: pageData.tokens });
  run.comparisons = sections.filter(section => section.rows.length).map(section => ({
    label: section.label,
    rows: section.rows.map(({ kind, issue, property, target, figma, website }) => ({ kind, issue, property, target, figma, website }))
  }));
  run.styleSpacing = { baseline: 'figma-auto-layout', websiteTokenCount: pageData.tokens.length, figmaVariableNamesAvailable: Object.keys(figmaVariables).length > 0 };
  const issues = sections.flatMap(section => section.rows);
  if (!issues.length) return;
  const overlay = PNG.sync.read(await sharp(currentPath).png().toBuffer());
  const allRegions = issues.flatMap(issue => issue.regions || [issue.region]).filter(Boolean);
  const uniqueRegions = new Map(allRegions.map(region => [`${region.x}:${region.y}:${region.width}:${region.height}`, region]));
  uniqueRegions.forEach(region => drawBorder(overlay, region));
  await writeFile(path.join(runDir, 'style-spacing-overlay.png'), PNG.sync.write(overlay));
  run.artifacts.push({ type: 'style-spacing-overlay', label: 'Elements with semantic style or spacing issues', url: `/artifacts/${run.id}/style-spacing-overlay.png` });
  run.findings.push(toFinding('style-spacing', 'high', 'Style/spacing differs from Figma', `${issues.length} token, spacing, alignment, or typography difference${issues.length === 1 ? '' : 's'} found. Review the expected and actual design tokens below.`));
}
