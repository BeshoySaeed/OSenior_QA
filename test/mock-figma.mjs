import { PNG } from 'pngjs';

const originalFetch = globalThis.fetch;
const frame = {
  type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 500, height: 700 },
  children: [
    { type: 'TEXT', characters: 'Figma header text', absoluteBoundingBox: { x: 20, y: 10, width: 150, height: 20 } },
    { type: 'TEXT', characters: 'Checkout', absoluteBoundingBox: { x: 20, y: 80, width: 150, height: 30 } },
    { type: 'TEXT', characters: 'Email', absoluteBoundingBox: { x: 20, y: 130, width: 80, height: 20 } },
    { type: 'TEXT', characters: 'Continue now', absoluteBoundingBox: { x: 20, y: 170, width: 150, height: 20 } },
    { type: 'TEXT', characters: 'Order status', absoluteBoundingBox: { x: 20, y: 230, width: 130, height: 20 } },
    { type: 'FRAME', name: 'Footer', children: [
      { type: 'TEXT', characters: 'Figma footer text', absoluteBoundingBox: { x: 20, y: 630, width: 150, height: 20 } }
    ] }
  ]
};
const styleText = (name, text, x, y) => ({
  type: 'TEXT', name, characters: text, absoluteBoundingBox: { x, y, width: 100, height: 20 },
  style: { fontSize: 16, fontWeight: 400, lineHeightPx: 20 },
  fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }]
});
const styleFrame = {
  type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 500, height: 700 },
  children: [
    { type: 'FRAME', name: 'Header', children: [styleText('Brand', 'Brand', 20, 20)] },
    styleText('Alpha', 'Alpha', 20, 100),
    styleText('Beta', 'Beta', 20, 140),
    { type: 'FRAME', name: 'Footer', children: [styleText('Legal', 'Legal', 20, 620)] }
  ]
};
const image = new PNG({ width: 500, height: 700 });
image.data.fill(255);
const imageBytes = PNG.sync.write(image);

globalThis.fetch = (input, options) => {
  const url = String(input);
  if (url.startsWith('https://api.figma.com/v1/files/')) {
    const id = new URL(url).searchParams.get('ids');
    return Promise.resolve(Response.json({ nodes: { [id]: { document: id === '2:3' ? styleFrame : frame } } }));
  }
  if (url.startsWith('https://api.figma.com/v1/images/')) {
    const id = new URL(url).searchParams.get('ids');
    return Promise.resolve(Response.json({ images: { [id]: 'https://figma.test/reference.png' } }));
  }
  if (url === 'https://figma.test/reference.png') return Promise.resolve(new Response(imageBytes, { status: 200, headers: { 'content-type': 'image/png' } }));
  return originalFetch(input, options);
};
