'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const REQUIRED_TYPES = [
  'public.data', 'public.text', 'public.source-code', 'public.html', 'public.image',
  'public.audio', 'public.movie', 'com.adobe.pdf',
  'org.openxmlformats.wordprocessingml.document', 'org.openxmlformats.spreadsheetml.sheet',
  'org.openxmlformats.presentationml.presentation',
];
const REQUIRED_EXTENSIONS = ['doc', 'docx', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx', 'drawio', 'dio'];

const assertOnlyPreviewAssociations = (plist) => {
  const documents = plist?.CFBundleDocumentTypes;
  if (!Array.isArray(documents) || !documents.length) {
    throw new Error('[onlypreview-associations] Missing CFBundleDocumentTypes');
  }
  const types = new Set();
  const extensions = new Set();
  for (const document of documents) {
    if (document.CFBundleTypeRole !== 'Viewer' || document.LSHandlerRank !== 'Alternate') {
      throw new Error('[onlypreview-associations] Documents must be Viewer/Alternate');
    }
    for (const type of document.LSItemContentTypes ?? []) types.add(type);
    // macOS ignores legacy extensions in a dictionary that supplies LSItemContentTypes.
    if (!document.LSItemContentTypes) {
      for (const extension of document.CFBundleTypeExtensions ?? []) extensions.add(extension);
    }
  }
  for (const type of REQUIRED_TYPES) {
    if (!types.has(type)) throw new Error('[onlypreview-associations] Missing document UTI: ' + type);
  }
  for (const extension of REQUIRED_EXTENSIONS) {
    if (!extensions.has(extension)) {
      throw new Error('[onlypreview-associations] Missing document extension: ' + extension);
    }
  }
  for (const type of ['public.directory', 'public.folder', 'com.apple.application-bundle']) {
    if (types.has(type)) throw new Error('[onlypreview-associations] Not a document type: ' + type);
  }
};

const auditOnlyPreviewAssociations = (context) => {
  if (!['darwin', 'mas'].includes(context.electronPlatformName)) return;
  const plistPath = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app',
    'Contents', 'Info.plist');
  const plist = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plistPath], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
  }));
  assertOnlyPreviewAssociations(plist);
};

module.exports = auditOnlyPreviewAssociations;
module.exports.assertOnlyPreviewAssociations = assertOnlyPreviewAssociations;
