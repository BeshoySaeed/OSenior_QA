import { PNG } from 'pngjs';

const originalFetch = globalThis.fetch;
const frame = {
  type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 500, height: 700 },
  children: [
    { type: 'TEXT', characters: 'Checkout', absoluteBoundingBox: { x: 20, y: 20, width: 150, height: 30 } },
    { type: 'TEXT', characters: 'Email', absoluteBoundingBox: { x: 20, y: 80, width: 80, height: 20 } },
    { type: 'TEXT', characters: 'Continue now', absoluteBoundingBox: { x: 20, y: 120, width: 150, height: 20 } },
    { type: 'TEXT', characters: 'Order status', absoluteBoundingBox: { x: 20, y: 180, width: 130, height: 20 } }
  ]
};
const image = new PNG({ width: 500, height: 700 });
image.data.fill(255);
const imageBytes = PNG.sync.write(image);

globalThis.fetch = (input, options) => {
  const url = String(input);
  if (url.startsWith('https://api.figma.com/v1/files/')) return Promise.resolve(Response.json({ nodes: { '1:2': { document: frame } } }));
  if (url.startsWith('https://api.figma.com/v1/images/')) return Promise.resolve(Response.json({ images: { '1:2': 'https://figma.test/reference.png' } }));
  if (url === 'https://figma.test/reference.png') return Promise.resolve(new Response(imageBytes, { status: 200, headers: { 'content-type': 'image/png' } }));
  return originalFetch(input, options);
};
