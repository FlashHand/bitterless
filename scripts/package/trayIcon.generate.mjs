#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const docDirectory = fileURLToPath(new URL('../../doc/', import.meta.url));
const sourcePath = resolve(docDirectory, 'bitterless-tray-mac.png');

export const renderMacTrayIcon = (size) =>
  sharp(sourcePath).resize(size, size).ensureAlpha().png().toBuffer();

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [size, suffix] of [[24, ''], [48, '@2x']]) {
    const outputPath = resolve(docDirectory, `bitterless-tray-mac-24${suffix}.png`);
    await writeFile(outputPath, await renderMacTrayIcon(size));
    console.log(`[tray-icon] Generated ${outputPath} (${size}x${size})`);
  }
}
