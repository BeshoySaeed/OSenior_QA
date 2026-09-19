export async function analyzeWebsite(page, { includeHeaderFooter = true } = {}) {
  return page.evaluate(includeHeaderFooter => {
    const excludedSelector = 'header, footer, #mc-header, #mc-footer, .mc-header, .mc-footer';
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
    const parseColor = value => {
      const numbers = String(value).match(/[\d.]+/g)?.map(Number);
      if (!numbers?.length) return undefined;
      if (numbers.length === 3) numbers.push(1);
      return [numbers[0], numbers[1], numbers[2], Math.round(numbers[3] * 255)];
    };
    const selectorFor = element => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const testId = element.getAttribute('data-testid');
      if (testId) return `[data-testid="${testId.replace(/"/g, '\\"')}"]`;
      const role = element.getAttribute('role');
      const name = element.getAttribute('aria-label');
      if (role && name) return `[role="${role}"][aria-label="${name.replace(/"/g, '\\"')}"]`;
      const path = [];
      for (let current = element; current && current !== document.body && path.length < 4; current = current.parentElement) {
        const tag = current.tagName.toLowerCase();
        const siblings = current.parentElement ? [...current.parentElement.children].filter(item => item.tagName === current.tagName) : [];
        path.unshift(`${tag}${siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ''}`);
      }
      return path.join(' > ') || element.tagName.toLowerCase();
    };
    const inferRole = element => {
      const explicit = element.getAttribute('role');
      if (explicit) return explicit;
      const tag = element.tagName.toLowerCase();
      if (tag === 'body') return 'container';
      if (tag === 'header') return 'header';
      if (tag === 'footer') return 'footer';
      if (tag === 'nav') return 'navigation';
      if (tag === 'button' || (tag === 'a' && /btn|button|cta/i.test(element.className))) return 'button';
      if (['input', 'textarea', 'select'].includes(tag)) return 'input';
      if (tag === 'dialog') return 'dialog';
      if (tag === 'table') return 'table';
      if (['ul', 'ol'].includes(tag)) return 'list';
      if (tag === 'li') return 'listitem';
      if (/card|tile/i.test(`${element.id} ${element.className}`)) return 'card';
      if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'label', 'span'].includes(tag)) return 'text';
      if (['img', 'svg', 'picture'].includes(tag)) return 'image';
      if (['main', 'section', 'article', 'aside', 'form'].includes(tag)) return tag === 'article' ? 'card' : 'container';
      return 'element';
    };
    const semanticTags = new Set(['body', 'header', 'footer', 'nav', 'main', 'section', 'article', 'aside', 'form', 'button', 'a', 'input', 'textarea', 'select', 'label', 'h1', 'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'table', 'img', 'svg']);
    const candidates = [];
    for (const element of [document.body, ...document.body.querySelectorAll('*')]) {
      if (!includeHeaderFooter && element.closest(excludedSelector)) continue;
      const style = getComputedStyle(element);
      const measuredRect = element.getBoundingClientRect();
      const rect = element === document.body
        ? { x: 0, y: 0, left: 0, top: 0, right: viewport.width, bottom: viewport.height, width: viewport.width, height: viewport.height }
        : measuredRect;
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || rect.width < 1 || rect.height < 1) continue;
      if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= viewport.height || rect.left >= viewport.width) continue;
      const tag = element.tagName.toLowerCase();
      const directText = normalize([...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(' '));
      const leafTexts = [...element.querySelectorAll('*')]
        .filter(child => !child.children.length && (includeHeaderFooter || !child.closest(excludedSelector)))
        .map(child => normalize(child.textContent)).filter(Boolean);
      const background = parseColor(style.backgroundColor);
      const hasPaint = background?.[3] > 0 || parseFloat(style.borderTopWidth) > 0 || style.boxShadow !== 'none';
      const hasLayout = ['flex', 'inline-flex', 'grid', 'inline-grid'].includes(style.display);
      if (!semanticTags.has(tag) && !directText && !hasPaint && !hasLayout && !element.hasAttribute('data-testid')) continue;
      candidates.push({ element, style, rect, tag, directText, texts: [...new Set([directText, ...leafTexts].filter(Boolean))] });
      if (candidates.length >= 600) break;
    }
    const indexByElement = new Map(candidates.map((item, index) => [item.element, index]));
    const nodes = candidates.map((item, index) => {
      const { element, style, rect, tag, directText, texts } = item;
      let parent = element.parentElement;
      while (parent && !indexByElement.has(parent)) parent = parent.parentElement;
      const parentIndex = parent ? indexByElement.get(parent) : undefined;
      const lineHeight = parseFloat(style.lineHeight);
      const fontSize = parseFloat(style.fontSize);
      const role = inferRole(element);
      const textRole = role === 'text' || ['button', 'input'].includes(role);
      let geometryRect = rect;
      if (role === 'text' && normalize(element.textContent)) {
        const range = document.createRange();
        range.selectNodeContents(element);
        const textRect = range.getBoundingClientRect();
        if (textRect.width > 0 && textRect.height > 0) geometryRect = textRect;
      }
      return {
        id: `web-${index}`, source: 'website', parentId: Number.isInteger(parentIndex) ? `web-${parentIndex}` : null,
        depth: (() => { let depth = 0, current = element.parentElement; while (current && current !== document.body) { depth += 1; current = current.parentElement; } return depth; })(),
        order: index, name: element.getAttribute('aria-label') || element.id || element.classList[0] || tag,
        nodeType: tag, role, selector: selectorFor(element), text: directText || (['button', 'a', 'label'].includes(tag) ? normalize(element.innerText) : ''), texts,
        rect: { x: geometryRect.x, y: geometryRect.y, width: geometryRect.width, height: geometryRect.height },
        layout: {
          mode: style.display.includes('flex') ? (style.flexDirection.startsWith('row') ? 'HORIZONTAL' : 'VERTICAL') : style.display.includes('grid') ? 'GRID' : 'NONE',
          paddingTop: parseFloat(style.paddingTop), paddingRight: parseFloat(style.paddingRight),
          paddingBottom: parseFloat(style.paddingBottom), paddingLeft: parseFloat(style.paddingLeft),
          marginTop: parseFloat(style.marginTop), marginRight: parseFloat(style.marginRight),
          marginBottom: parseFloat(style.marginBottom), marginLeft: parseFloat(style.marginLeft),
          gap: parseFloat(style.flexDirection.startsWith('row') ? style.columnGap : style.rowGap) || 0,
          primaryAlign: style.justifyContent, counterAlign: style.alignItems,
          position: style.position
        },
        typography: textRole ? {
          family: style.fontFamily.split(',')[0].replace(/["']/g, '').trim(), size: fontSize,
          weight: parseFloat(style.fontWeight), lineHeight: Number.isFinite(lineHeight) ? lineHeight : fontSize * 1.2,
          letterSpacing: parseFloat(style.letterSpacing) || 0, align: style.textAlign,
          lines: Math.max(1, Math.round(geometryRect.height / (Number.isFinite(lineHeight) ? lineHeight : geometryRect.height)))
        } : undefined,
        visual: {
          background: parseColor(style.backgroundColor), color: parseColor(style.color), borderColor: parseColor(style.borderTopColor),
          borderWidth: parseFloat(style.borderTopWidth) || 0, radius: parseFloat(style.borderTopLeftRadius) || 0,
          opacity: parseFloat(style.opacity), shadow: style.boxShadow === 'none' ? undefined : style.boxShadow
        },
        semantics: { tag, ariaRole: element.getAttribute('role'), accessibleName: element.getAttribute('aria-label'), testId: element.getAttribute('data-testid') }
      };
    });
    return { source: 'website', viewport, url: location.href, title: document.title, nodes };
  }, includeHeaderFooter);
}
