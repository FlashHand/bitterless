import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import sharp from 'sharp';
import { parse as parseYaml } from 'yaml';
import { renderMacTrayIcon, renderTrayMasters } from './trayIcon.generate.mjs';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const macTraySource = 'doc/bitterless-tray-mac.png';
const macTrayRepresentations = [
  { filename: 'bitterless-tray-mac-22.png', size: 22 },
  { filename: 'bitterless-tray-mac-22@2x.png', size: 44 },
];
const selectedSourceSha256 = 'f6c83974d0314ce2ff129ae97829d5bbd9b3abf781283d3e6cb15883d08a4594';
const windowsColor = [0x4e, 0x58, 0x82];

const readProjectFile = (relativePath) => readFileSync(resolve(projectRoot, relativePath));
const readProjectText = (relativePath) => readProjectFile(relativePath).toString('utf8');

const assertTransparentArtwork = async (source, size) => {
  const metadata = await sharp(source).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, size);
  assert.equal(metadata.height, size);
  assert.equal(metadata.channels, 4);
  assert.equal(metadata.hasAlpha, true);

  const { data } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparentPixels = 0;
  let artworkPixels = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) transparentPixels += 1;
    if (data[offset + 3] > 0) artworkPixels += 1;
  }
  assert(transparentPixels > 0, 'tray source must retain a transparent background');
  assert(artworkPixels > 0, 'tray source must contain visible artwork');
  return data;
};

test('platform masters preserve the selected artwork with transparent facial cutouts and shared geometry', async () => {
  assert.equal(
    createHash('sha256').update(readProjectFile('doc/bitterless-tray-source.png')).digest('hex'),
    selectedSourceSha256
  );
  const mac = readProjectFile(macTraySource);
  const win = readProjectFile('doc/bitterless-tray-win.png');
  const generated = await renderTrayMasters();
  assert(mac.equals(generated.mac), 'macOS master differs from the selected source conversion');
  assert(win.equals(generated.win), 'Windows master differs from the selected source conversion');
  const macPixels = await assertTransparentArtwork(mac, 208);
  const winPixels = await assertTransparentArtwork(win, 208);
  for (let offset = 0; offset < macPixels.length; offset += 4) {
    assert.equal(macPixels[offset + 3], winPixels[offset + 3], 'platforms must share the same alpha geometry');
    assert.deepEqual([...macPixels.subarray(offset, offset + 3)], [0, 0, 0]);
    assert.deepEqual([...winPixels.subarray(offset, offset + 3)], windowsColor);
  }
  assert.equal(macPixels[3], 0, 'background must be fully transparent');
  for (const [x, y] of [[67, 101], [143, 101], [104, 129], [104, 144]]) {
    assert(macPixels[(y * 208 + x) * 4 + 3] <= 5, `facial cutout at ${x},${y} must remain transparent after downsampling`);
  }
});

test('macOS tray runtime assets are deterministic 22px and 44px representations of the master', async () => {
  for (const { filename, size } of macTrayRepresentations) {
    const source = readProjectFile(`doc/${filename}`);
    await assertTransparentArtwork(source, size);
    assert(source.equals(await renderMacTrayIcon(size)), `${filename} differs from its generated artwork`);
  }
});

test('Windows ICO contains the required transparent Royal Blue representations', async () => {
  const source = readProjectFile('build/tray-win.ico');
  const sizes = [16, 20, 24, 32, 40, 48, 64, 256];
  assert.equal(source.readUInt16LE(0), 0);
  assert.equal(source.readUInt16LE(2), 1);
  assert.equal(source.readUInt16LE(4), sizes.length);
  let nextOffset = 6 + sizes.length * 16;
  for (const [index, size] of sizes.entries()) {
    const entry = 6 + index * 16;
    assert.equal(source.readUInt8(entry) || 256, size);
    assert.equal(source.readUInt8(entry + 1) || 256, size);
    assert.equal(source.readUInt16LE(entry + 4), 1);
    assert.equal(source.readUInt16LE(entry + 6), 32);
    const length = source.readUInt32LE(entry + 8);
    assert.equal(source.readUInt32LE(entry + 12), nextOffset);
    const png = source.subarray(nextOffset, nextOffset + length);
    const pixels = await assertTransparentArtwork(png, size);
    const expectedAlpha = await sharp(readProjectFile('doc/bitterless-tray-win.png'))
      .resize(size, size).extractChannel('alpha').raw().toBuffer();
    for (let pixel = 0; pixel < expectedAlpha.length; pixel += 1) {
      assert.equal(pixels[pixel * 4 + 3], expectedAlpha[pixel]);
      assert.deepEqual([...pixels.subarray(pixel * 4, pixel * 4 + 3)], windowsColor);
    }
    nextOffset += length;
  }
  assert.equal(nextOffset, source.length);
});

test('builder packages both macOS runtime representations under the runtime icon directory', () => {
  const templateSource = readProjectText('electron-builder.tmp.yml');
  const template = parseYaml(templateSource);
  for (const { filename } of macTrayRepresentations) {
    assert(
      template.extraResources?.some(
        (resource) =>
          resource?.from === `doc/${filename}` &&
          resource?.to === `app.asar.unpacked/icons/${filename}`
      ),
      `builder template must package the ${filename} representation at its runtime path`
    );
  }
  assert.equal(template.extraResources?.some((resource) => resource?.from === macTraySource), false);
  assert.doesNotMatch(templateSource, /build\/tray-mac@2x\.png/);
  assert.doesNotMatch(templateSource, /bitterless-tray-mac-24(?:@2x)?\.png/);
  assert(
    template.extraResources?.some(
      (resource) =>
        resource?.from === 'build/tray-win.ico' &&
        resource?.to === 'app.asar.unpacked/icons/tray-win.ico'
    ),
    'Windows tray packaging must stay unchanged'
  );
});

test('tray runtime resolves development and packaged assets without the retired macOS icon', () => {
  const source = readProjectText('src/main/tray/tray.helper.ts');
  assert.match(source, /isWin \? 'tray-win\.ico' : 'bitterless-tray-mac-22\.png'/);
  assert.match(source, /isWin \? '\.\.\/\.\.\/build' : '\.\.\/\.\.\/doc'/);
  assert.match(source, /'app\.asar\.unpacked', 'icons'/);
  assert.match(source, /nativeImage\.createFromPath\(iconPath\)/);
  assert.doesNotMatch(source, /\.resize\(/);
  assert.match(source, /icon\.setTemplateImage\(true\)/);
  assert.doesNotMatch(source, /tray-mac@2x\.png/);
  assert.doesNotMatch(source, /bitterless-tray-mac-24(?:@2x)?\.png/);
});
