import assert from 'node:assert/strict';
import test from 'node:test';
import { descriptorFor, presentationModule } from './onlyPreviewPreviewRegionTest.helper.mjs';

test('canonical presentation validation accepts the sheet and ooxml-xlsx contract', () => {
  const descriptor = descriptorFor('workbook.xlsx', 'sheet');
  assert.equal(
    presentationModule.isOnlyPreviewPresentation({
      hostId: 'host-id',
      workspaceId: 'workspace-id-1234',
      selectionRevision: 1,
      surface: 'vue',
      adapterId: 'ooxml-xlsx',
      status: 'loading',
      fileRef: { workspaceId: 'workspace-id-1234', relativePath: 'workbook.xlsx' },
      descriptor: { ...descriptor, workspaceId: 'workspace-id-1234' },
      error: null,
      selectedTextAvailable: false
    }),
    true
  );
});

test('canonical presentation validation accepts the document and ooxml-docx contract', () => {
  const descriptor = descriptorFor('document.docx', 'document');
  assert.equal(
    presentationModule.isOnlyPreviewPresentation({
      hostId: 'host-id',
      workspaceId: 'workspace-id-1234',
      selectionRevision: 1,
      surface: 'vue',
      adapterId: 'ooxml-docx',
      status: 'loading',
      fileRef: { workspaceId: 'workspace-id-1234', relativePath: 'document.docx' },
      descriptor: { ...descriptor, workspaceId: 'workspace-id-1234' },
      error: null,
      selectedTextAvailable: true
    }),
    true
  );
});

test('canonical presentation validation accepts the presentation and ooxml-pptx contract', () => {
  const descriptor = descriptorFor('slides.pptx', 'presentation');
  assert.equal(
    presentationModule.isOnlyPreviewPresentation({
      hostId: 'host-id',
      workspaceId: 'workspace-id-1234',
      selectionRevision: 1,
      surface: 'vue',
      adapterId: 'ooxml-pptx',
      status: 'loading',
      fileRef: { workspaceId: 'workspace-id-1234', relativePath: 'slides.pptx' },
      descriptor: { ...descriptor, workspaceId: 'workspace-id-1234' },
      error: null,
      selectedTextAvailable: true
    }),
    true
  );
});

test('canonical presentation validation scopes recognized unsupported categories to unsupported descriptors', () => {
  const descriptor = {
    ...descriptorFor('fixture.heic', 'unsupported'),
    workspaceId: 'workspace-id-1234',
    unsupportedCategory: 'image-format'
  };
  const presentation = {
    hostId: 'host-id',
    workspaceId: 'workspace-id-1234',
    selectionRevision: 1,
    surface: 'vue',
    adapterId: 'unsupported',
    status: 'loading',
    fileRef: { workspaceId: 'workspace-id-1234', relativePath: 'fixture.heic' },
    descriptor,
    error: null,
    selectedTextAvailable: false
  };
  assert.equal(presentationModule.isOnlyPreviewPresentation(presentation), true);
  assert.equal(
    presentationModule.isOnlyPreviewPresentation({
      ...presentation,
      descriptor: { ...descriptor, unsupportedCategory: 'invented-category' }
    }),
    false
  );
  assert.equal(
    presentationModule.isOnlyPreviewPresentation({
      ...presentation,
      descriptor: { ...descriptor, kind: 'image' }
    }),
    false
  );
  for (const forbidden of ['displayPath', 'absolutePath', 'canonicalPath']) {
    assert.equal(
      presentationModule.isOnlyPreviewPresentation({
        ...presentation,
        descriptor: { ...descriptor, [forbidden]: '/Users/ral/private/fixture.heic' }
      }),
      false,
      forbidden
    );
  }
});
