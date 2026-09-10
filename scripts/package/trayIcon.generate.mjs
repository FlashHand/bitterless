#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const docDirectory = fileURLToPath(new URL('../../doc/', import.meta.url));
const sourcePath = resolve(docDirectory, 'bitterless-tray-source.png');
const macMasterPath = resolve(docDirectory, 'bitterless-tray-mac.png');
const winMasterPath = resolve(docDirectory, 'bitterless-tray-win.png');
const windowsColor = [0x4e, 0x58, 0x82];
const windowsSizes = [16, 20, 24, 32, 40, 48, 64, 256];

const encodeMask = (mask, size, color) => {
  const rgba = Buffer.alloc(size * size * 4);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    rgba[pixel * 4] = color[0];
    rgba[pixel * 4 + 1] = color[1];
    rgba[pixel * 4 + 2] = color[2];
    rgba[pixel * 4 + 3] = mask[pixel];
  }
  return sharp(rgba, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
};

export const renderTrayMasters = async () => {
  const { data, info } = await sharp(sourcePath).greyscale().raw().toBuffer({ resolveWithObject: true });
  // Remove near-white background noise while retaining antialiasing at the selected artwork's edges.
  for (let pixel = 0; pixel < data.length; pixel += 1) {
    data[pixel] = Math.round(Math.max(0, Math.min(255, ((250 - data[pixel]) / 245) * 255)));
  }
  const mask = await sharp(data, { raw: { width: info.width, height: info.height, channels: 1 } })
    .resize(208, 208).extractChannel(0).raw().toBuffer();
  return {
    mac: await encodeMask(mask, 208, [0, 0, 0]),
    win: await encodeMask(mask, 208, windowsColor),
  };
};

const renderTrayIcon = async (masterPath, size, color) => {
  const mask = await sharp(masterPath).resize(size, size).extractChannel('alpha').raw().toBuffer();
  return encodeMask(mask, size, color);
};

export const renderMacTrayIcon = (size) => renderTrayIcon(macMasterPath, size, [0, 0, 0]);

const renderWindowsIco = async () => {
  const images = await Promise.all(windowsSizes.map(async (size) => ({
    size,
    data: await renderTrayIcon(winMasterPath, size, windowsColor),
  })));
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let dataOffset = header.length;
  for (const [index, { size, data }] of images.entries()) {
    const offset = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, offset);
    header.writeUInt8(size === 256 ? 0 : size, offset + 1);
    header.writeUInt16LE(1, offset + 4);
    header.writeUInt16LE(32, offset + 6);
    header.writeUInt32LE(data.length, offset + 8);
    header.writeUInt32LE(dataOffset, offset + 12);
    dataOffset += data.length;
  }
  return Buffer.concat([header, ...images.map(({ data }) => data)]);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const masters = await renderTrayMasters();
  for (const [platform, outputPath] of [['mac', macMasterPath], ['win', winMasterPath]]) {
    await writeFile(outputPath, masters[platform]);
    console.log(`[tray-icon] Generated ${outputPath} (208x208)`);
  }
  for (const [size, suffix] of [[22, ''], [44, '@2x']]) {
    const outputPath = resolve(docDirectory, `bitterless-tray-mac-22${suffix}.png`);
    await writeFile(outputPath, await renderMacTrayIcon(size));
    console.log(`[tray-icon] Generated ${outputPath} (${size}x${size})`);
  }
  const icoPath = fileURLToPath(new URL('../../build/tray-win.ico', import.meta.url));
  await writeFile(icoPath, await renderWindowsIco());
  console.log(`[tray-icon] Generated ${icoPath} (${windowsSizes.join(', ')}px)`);
}
