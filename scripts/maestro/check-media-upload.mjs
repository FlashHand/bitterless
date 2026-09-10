import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = join(projectRoot, 'src')
const workspaceRoot = projectRoot
const moduleCache = new Map()
const maestroWindowSource = readFileSync(join(root, 'main/maestro/windows/main/maestroWindow.controller.ts'), 'utf8')
const maestroAgentSource = readFileSync(join(root, 'main/agent/maestroAgent.service.ts'), 'utf8')
const chatPanelSource = readFileSync(join(root, 'renderer/maestro/control/src/ChatPanel.vue'), 'utf8')
const runtimeRefsDoc = readFileSync(join(workspaceRoot, 'docs/features/maestro.md'), 'utf8')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const resolveTsModule = (specifier, parentDir = root) => {
  if (specifier.startsWith('@maestro-main/')) return join(root, 'main', 'maestro', `${specifier.slice('@maestro-main/'.length)}.ts`)
  // 交给 SDK 的模块要在这里显式指路,否则守卫报的是 `Cannot find module '@main/agent/...'`,
  // 看着像桥坏了,其实只是解析器没跟上搬迁。
  if (specifier.startsWith('@main/')) return join(root, 'main', `${specifier.slice('@main/'.length)}.ts`)
  if (specifier.startsWith('@maestro-shared/')) return join(root, 'shared', 'maestro', `${specifier.slice('@maestro-shared/'.length)}.ts`)
  if (specifier.startsWith('.')) {
    const base = join(parentDir, specifier)
    for (const candidate of [`${base}.ts`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.js')]) {
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

const loadTsModule = (specifier, parentDir = root) => {
  const file = resolveTsModule(specifier, parentDir)
  if (!file) return require(specifier)
  if (moduleCache.has(file)) return moduleCache.get(file).exports

  const mod = { exports: {} }
  moduleCache.set(file, mod)
  const source = readFileSync(file, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    },
    fileName: file
  }).outputText
  const wrapped = vm.runInThisContext(
    `(function(exports, require, module, __filename, __dirname) {\n${output}\n})`,
    { filename: file }
  )
  wrapped(
    mod.exports,
    (childSpecifier) => loadTsModule(childSpecifier, dirname(file)),
    mod,
    file,
    dirname(file)
  )
  return mod.exports
}

const received = []
const server = createServer((req, res) => {
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    received.push({
      method: req.method,
      url: req.url,
      contentType: req.headers['content-type'] || '',
      auth: req.headers.authorization || '',
      region: req.headers['x-region'] || '',
      workspace: req.headers['x-workspace-id'] || '',
      body
    })
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ data: { url: 'https://cdn.example.test/media/sample.png' } }))
  })
})

assert(chatPanelSource.includes('coach.attachClipboardImage({ sessionId: props.session.id })'), 'pasted screenshots should be handed to main for file materialization')
assert(!chatPanelSource.includes('readAsDataURL'), 'renderer should not convert pasted screenshots into base64 data URLs')
assert(maestroWindowSource.includes('return await this.agentService.attachClipboardImage(params)'), 'controller should expose clipboard materialization')
assert(maestroAgentSource.includes('const image = clipboard.readImage()'), 'AgentService should read pasted screenshots from the system clipboard')
assert(maestroAgentSource.includes('const png = image.toPNG()'), 'clipboard screenshots should be materialized from native image data to PNG bytes')
assert(maestroAgentSource.includes("join(maestroDataRoot(), 'attachments', safeKey)"), 'clipboard screenshots should be written under the isolated Maestro data root')
assert(maestroAgentSource.includes('writeFileSync(file, png)'), 'clipboard screenshots should be persisted as files')
assert(/await this\.attachFiles\(\{\s*sessionId: params\?\.sessionId,\s*paths: \[file\]/.test(maestroAgentSource), 'clipboard screenshot files should re-enter the normal path attachment allowlist')
assert(runtimeRefsDoc.includes('Attach/drop/paste for supported text, image, PDF'), 'embedded feature contract should preserve media attachments')
assert(runtimeRefsDoc.includes('No credential value is written into the Bitterless repository or log output.'), 'embedded feature contract should preserve credential boundaries')

const { resolveRuntimeMediaRefs, isDownloadableMediaUrl } = loadTsModule('@main/agent/runtime/mediaRefResolver')
assert(isDownloadableMediaUrl('https://cdn.example.test/clip.png'), 'http(s) media URLs should be accepted')
assert(!isDownloadableMediaUrl('data:image/png;base64,abc'), 'inline data URLs should not be treated as downloadable media URLs')
const inlineOnly = resolveRuntimeMediaRefs({
  providerId: 'remote-fixture',
  modelId: 'remote-vl',
  media: [{ kind: 'image', url: 'data:image/png;base64,abc', mimeType: 'image/png', name: 'inline.png' }],
  maxImages: 4
})
assert(inlineOnly.media.length === 0 && inlineOnly.images.length === 0, 'inline-only base64 image refs should be dropped')
assert(inlineOnly.warnings.some((item) => item.includes('inline/unsupported')), 'inline-only image refs should emit a warning')
const inlineWithPath = resolveRuntimeMediaRefs({
  providerId: 'remote-fixture',
  modelId: 'remote-vl',
  media: [{ kind: 'image', path: '/tmp/clip.png', url: 'data:image/png;base64,abc', mimeType: 'image/png', name: 'clip.png' }],
  maxImages: 4
})
assert(inlineWithPath.media.length === 1 && !inlineWithPath.media[0].url, 'path refs with inline urls should strip the inline url')
assert(!inlineWithPath.labels.join('\n').includes('data:image'), 'media labels should never expose inline data URLs')
assert(inlineWithPath.warnings.some((item) => item.includes('inline/unsupported')), 'stripped inline urls should emit a warning')

const listen = await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => resolve(server.address()))
})

const dir = mkdtempSync(join(tmpdir(), 'coach-media-upload-'))
try {
  const file = join(dir, 'sample.png')
  writeFileSync(file, Buffer.from('hello-media-binary'))
  const { uploadMediaRefsForProvider } = loadTsModule('@maestro-main/networking/api/mediaUpload.api')

  delete process.env.COACH_MEDIA_UPLOAD_URL
  const noEndpoint = await uploadMediaRefsForProvider({
    providerId: 'remote-fixture',
    refs: [{ kind: 'image', path: file, url: 'data:image/png;base64,aWdub3JlZA==', mimeType: 'image/png', name: 'sample.png', size: 18 }]
  })
  assert(noEndpoint.uploaded === 0, 'unconfigured upload should not upload')
  assert(!noEndpoint.refs[0]?.url, 'unconfigured upload should still strip inline media URLs')
  assert(noEndpoint.warnings.some((item) => item.includes('inline/unsupported')), 'unconfigured upload should warn about stripped inline media URLs')
  assert(noEndpoint.warnings.some((item) => item.includes('No media upload endpoint')), 'unconfigured upload should return warning')

  process.env.COACH_MEDIA_UPLOAD_URL = `http://127.0.0.1:${listen.port}/upload`
  const uploaded = await uploadMediaRefsForProvider({
    providerId: 'remote-fixture',
    refs: [{ kind: 'image', path: file, url: 'data:image/png;base64,aWdub3JlZA==', mimeType: 'image/png', name: 'sample.png', size: 18 }]
  })
  assert(uploaded.uploaded === 1, 'configured upload should upload one media ref')
  assert(uploaded.refs[0]?.url === 'https://cdn.example.test/media/sample.png', 'upload should attach returned URL')
  assert(uploaded.warnings.some((item) => item.includes('inline/unsupported')), 'upload should warn and strip inline media URLs before uploading')
  assert(received.length === 1, 'server should receive one upload request')
  assert(received[0].method === 'POST' && received[0].url === '/upload', 'upload should POST to configured endpoint')
  assert(String(received[0].contentType).includes('multipart/form-data'), 'upload should use multipart form data')
  assert(!received[0].auth && !received[0].region && !received[0].workspace, 'generic media upload should not send provider-specific auth/region/workspace headers')
  const bodyText = received[0].body.toString('latin1')
  assert(bodyText.includes('hello-media-binary'), 'multipart body should contain raw binary content')
  assert(!bodyText.includes('aGVsbG8tbWVkaWEtYmluYXJ5'), 'multipart body should not contain base64 content')

  console.log('[check-media-upload] ok')
} finally {
  server.close()
  rmSync(dir, { recursive: true, force: true })
  delete process.env.COACH_MEDIA_UPLOAD_URL
}
