const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim();

function colorFromPaint(paints) {
  const paint = Array.isArray(paints) && paints.find(item => item.visible !== false && item.type === 'SOLID');
  if (!paint?.color) return undefined;
  const alpha = Math.round((paint.opacity ?? 1) * 255);
  return [paint.color.r, paint.color.g, paint.color.b].map(value => Math.round(value * 255)).concat(alpha);
}

function shadowFromEffects(effects) {
  const effect = effects?.find(item => item.visible !== false && ['DROP_SHADOW', 'INNER_SHADOW'].includes(item.type));
  if (!effect) return undefined;
  return { type: effect.type, x: effect.offset?.x || 0, y: effect.offset?.y || 0, blur: effect.radius || 0, spread: effect.spread || 0, color: effect.color ? [effect.color.r, effect.color.g, effect.color.b].map(value => Math.round(value * 255)) : undefined };
}

function inferRole(node, text) {
  const label = `${node.name || ''} ${text}`.toLowerCase();
  if (node.type === 'TEXT') return 'text';
  if (['FRAME', 'GROUP', 'SECTION', 'COMPONENT', 'INSTANCE'].includes(node.type) && /header|navbar|navigation|top bar/.test(label)) return 'header';
  if (['FRAME', 'GROUP', 'SECTION', 'COMPONENT', 'INSTANCE'].includes(node.type) && /footer/.test(label)) return 'footer';
  if (/button|btn|cta|call to action/.test(label)) return 'button';
  if (/input|field|select|textarea|search/.test(label)) return 'input';
  if (/modal|dialog/.test(label)) return 'dialog';
  if (/card|tile/.test(label)) return 'card';
  if (/table/.test(label)) return 'table';
  if (/list/.test(label)) return 'list';
  if (/icon/.test(label) || ['VECTOR', 'BOOLEAN_OPERATION'].includes(node.type)) return 'icon';
  if (['COMPONENT', 'INSTANCE'].includes(node.type)) return 'component';
  if (['FRAME', 'GROUP', 'SECTION'].includes(node.type)) return 'container';
  if (['RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR'].includes(node.type)) return 'shape';
  return 'element';
}

function descendantText(node, values = []) {
  if (node?.visible === false) return values;
  if (node?.type === 'TEXT' && node.characters) values.push(normalizeText(node.characters));
  for (const child of node?.children || []) descendantText(child, values);
  return values;
}

function variableName(binding, variables) {
  const id = binding?.id || binding?.variableId;
  return id ? variables[id]?.name : undefined;
}

function meaningful(node) {
  if (node.type === 'TEXT' || ['COMPONENT', 'INSTANCE'].includes(node.type)) return true;
  if (['FRAME', 'GROUP', 'SECTION'].includes(node.type)) return Boolean(node.children?.length || node.fills?.length || node.strokes?.length);
  return ['RECTANGLE', 'ELLIPSE', 'VECTOR', 'BOOLEAN_OPERATION', 'POLYGON', 'STAR'].includes(node.type);
}

export function analyzeFigma(figmaNode, { viewport, variables = {}, includeHeaderFooter = true } = {}) {
  const frame = figmaNode.absoluteBoundingBox;
  if (!frame) throw new Error('The selected Figma node has no bounding box. Select a frame.');
  const target = viewport || { width: Math.round(frame.width), height: Math.round(frame.height) };
  const scaleX = target.width / frame.width, scaleY = target.height / frame.height;
  const nodes = [];
  let order = 0;

  const visit = (node, parentId = null, depth = 0) => {
    if (!node || node.visible === false) return;
    const text = node.type === 'TEXT' ? normalizeText(node.characters) : '';
    const allText = [...new Set(descendantText(node).filter(Boolean))];
    const role = inferRole(node, text);
    if (!includeHeaderFooter && ['header', 'footer'].includes(role)) return;
    const box = node.absoluteBoundingBox;
    const id = node.id || `figma-${order}`;
    if (box && meaningful(node)) {
      const radius = typeof node.cornerRadius === 'number' ? node.cornerRadius : node.rectangleCornerRadii?.[0];
      const bound = node.boundVariables || {};
      nodes.push({
        id, source: 'figma', parentId, depth, order: order++, name: node.name || node.type,
        nodeType: node.type, role, text, texts: allText,
        rect: {
          x: (box.x - frame.x) * scaleX, y: (box.y - frame.y) * scaleY,
          width: box.width * scaleX, height: box.height * scaleY
        },
        layout: {
          mode: node.layoutMode, wrap: node.layoutWrap,
          paddingTop: (node.paddingTop ?? 0) * scaleY, paddingRight: (node.paddingRight ?? 0) * scaleX,
          paddingBottom: (node.paddingBottom ?? 0) * scaleY, paddingLeft: (node.paddingLeft ?? 0) * scaleX,
          gap: (node.itemSpacing ?? 0) * (node.layoutMode === 'HORIZONTAL' ? scaleX : scaleY),
          primaryAlign: node.primaryAxisAlignItems, counterAlign: node.counterAxisAlignItems,
          constraints: node.constraints,
          tokens: {
            paddingTop: variableName(bound.paddingTop, variables), paddingRight: variableName(bound.paddingRight, variables),
            paddingBottom: variableName(bound.paddingBottom, variables), paddingLeft: variableName(bound.paddingLeft, variables),
            gap: variableName(bound.itemSpacing, variables)
          }
        },
        typography: node.type === 'TEXT' ? {
          family: node.style?.fontFamily, size: node.style?.fontSize, weight: node.style?.fontWeight,
          lineHeight: node.style?.lineHeightPx, letterSpacing: node.style?.letterSpacing,
          align: node.style?.textAlignHorizontal, lines: Math.max(1, Math.round(box.height / (node.style?.lineHeightPx || box.height)))
        } : undefined,
        visual: {
          background: node.type === 'TEXT' ? undefined : colorFromPaint(node.fills),
          color: node.type === 'TEXT' ? colorFromPaint(node.fills) : undefined,
          borderColor: colorFromPaint(node.strokes), borderWidth: node.strokeWeight || 0,
          radius: Number.isFinite(radius) ? radius : 0, opacity: node.opacity ?? 1,
          shadow: shadowFromEffects(node.effects)
        },
        component: node.type === 'INSTANCE' ? { kind: 'instance', componentId: node.componentId } : node.type === 'COMPONENT' ? { kind: 'component', key: node.key } : undefined
      });
    }
    const nextParent = box && meaningful(node) ? id : parentId;
    for (const child of node.children || []) visit(child, nextParent, depth + 1);
  };
  visit(figmaNode);
  return {
    source: 'figma', viewport: target, originalFrame: frame,
    normalization: { scaleX, scaleY }, nodes
  };
}
