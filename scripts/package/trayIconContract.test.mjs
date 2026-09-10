import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import sharp from 'sharp';
import { parse as parseYaml } from 'yaml';
import { renderMacTrayIcon } from './trayIcon.generate.mjs';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const macTraySource = 'doc/bitterless-tray-mac.png';
const macTrayRepresentations = [
  { filename: 'bitterless-tray-mac-24.png', size: 24 },
  { filename: 'bitterless-tray-mac-24@2x.png', size: 48 },
];
const masterSha256 = 'eb846bfc92ec34aaf405aebb2f4759e91fcb46688307d40e642e256ec67d4de7';

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
  assert(transparentPixels > 0, 'macOS tray source must retain a transparent background');
  assert(artworkPixels > 0, 'macOS tray source must contain visible artwork');
};

test('macOS tray documentation master is unchanged transparent artwork', async () => {
  const source = readProjectFile(macTraySource);
  assert.equal(createHash('sha256').update(source).digest('hex'), masterSha256);
  await assertTransparentArtwork(source, 208);
});

test('macOS tray runtime assets are deterministic 24px and 48px representations of the master', async () => {
  for (const { filename, size } of macTrayRepresentations) {
    const source = readProjectFile(`doc/${filename}`);
    await assertTransparentArtwork(source, size);
    assert(source.equals(await renderMacTrayIcon(size)), `${filename} differs from its generated artwork`);
  }
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
  assert.match(source, /isWin \? 'tray-win\.ico' : 'bitterless-tray-mac-24\.png'/);
  assert.match(source, /isWin \? '\.\.\/\.\.\/build' : '\.\.\/\.\.\/doc'/);
  assert.match(source, /'app\.asar\.unpacked', 'icons'/);
  assert.match(source, /nativeImage\.createFromPath\(iconPath\)/);
  assert.doesNotMatch(source, /\.resize\(/);
  assert.match(source, /icon\.setTemplateImage\(true\)/);
  assert.doesNotMatch(source, /tray-mac@2x\.png/);
});
