import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import sharp from 'sharp';

export async function createVisualArtifacts({ currentPath, figmaPath, runDir, runId, viewport, pixelThreshold = 28 }) {
  const currentBuffer = await sharp(currentPath).resize(viewport.width, viewport.height, { fit: 'fill' }).png().toBuffer();
  const figmaBuffer = await sharp(figmaPath).resize(viewport.width, viewport.height, { fit: 'fill' }).png().toBuffer();
  const normalizedPath = path.join(runDir, 'figma-normalized.png');
  await writeFile(normalizedPath, figmaBuffer);
  const overlayBuffer = await sharp(figmaBuffer).composite([{ input: currentBuffer, blend: 'over', opacity: 0.5 }]).png().toBuffer();
  await writeFile(path.join(runDir, 'comparison-overlay.png'), overlayBuffer);

  const current = PNG.sync.read(currentBuffer), figma = PNG.sync.read(figmaBuffer);
  const difference = new PNG({ width: current.width, height: current.height });
  let changed = 0;
  for (let index = 0; index < current.data.length; index += 4) {
    const distance = Math.hypot(current.data[index] - figma.data[index], current.data[index + 1] - figma.data[index + 1], current.data[index + 2] - figma.data[index + 2]) / Math.sqrt(3);
    const different = distance > pixelThreshold;
    if (different) changed += 1;
    const gray = Math.round((figma.data[index] + figma.data[index + 1] + figma.data[index + 2]) / 3 * 0.35 + 150);
    difference.data[index] = different ? 239 : gray;
    difference.data[index + 1] = different ? 49 : gray;
    difference.data[index + 2] = different ? 49 : gray;
    difference.data[index + 3] = 255;
  }
  await writeFile(path.join(runDir, 'difference-map.png'), PNG.sync.write(difference));
  return {
    pixelDifferenceRatio: changed / (current.width * current.height),
    artifacts: [
      { type: 'figma-normalized', label: 'Figma normalized to the test viewport', url: `/artifacts/${runId}/figma-normalized.png` },
      { type: 'comparison-overlay', label: '50% visual overlay', url: `/artifacts/${runId}/comparison-overlay.png` },
      { type: 'difference-map', label: 'Perceptual difference map (supporting evidence)', url: `/artifacts/${runId}/difference-map.png` }
    ]
  };
}
