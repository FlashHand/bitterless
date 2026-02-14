const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MONGODB_VERSION = '8.2.5';
const MONGODB_ARCHIVE = `mongodb-macos-arm64-${MONGODB_VERSION}.tgz`;
const MONGODB_URL = `https://fastdl.mongodb.org/osx/${MONGODB_ARCHIVE}`;
const EXTERNAL_DIR = path.resolve(__dirname, '..', 'external_resources');
const MONGODB_DIR = path.join(EXTERNAL_DIR, 'mongodb');
const MONGOD_BIN = path.join(MONGODB_DIR, 'bin', 'mongod');

const initMongodb = () => {
  if (fs.existsSync(MONGOD_BIN)) {
    console.log(`[mongodb] already exists at ${MONGODB_DIR}, skipping.`);
    return;
  }

  console.log(`[mongodb] downloading ${MONGODB_URL} ...`);

  const tmpFile = path.join(EXTERNAL_DIR, MONGODB_ARCHIVE);

  try {
    execSync(`curl -L -o "${tmpFile}" "${MONGODB_URL}"`, { stdio: 'inherit' });

    console.log('[mongodb] extracting ...');
    execSync(`tar -xzf "${tmpFile}" -C "${EXTERNAL_DIR}"`, { stdio: 'inherit' });

    // find the extracted mongodb directory (naming varies between versions)
    const entries = fs.readdirSync(EXTERNAL_DIR);
    const mongoEntry = entries.find((e) => e.startsWith('mongodb-macos') && e !== MONGODB_ARCHIVE);
    if (mongoEntry) {
      fs.renameSync(path.join(EXTERNAL_DIR, mongoEntry), MONGODB_DIR);
    }

    fs.unlinkSync(tmpFile);
    console.log(`[mongodb] installed to ${MONGODB_DIR}`);
  } catch (err) {
    console.error('[mongodb] installation failed:', err.message);
    // cleanup on failure
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    process.exit(1);
  }
};

// ensure external_resources dir exists
if (!fs.existsSync(EXTERNAL_DIR)) {
  fs.mkdirSync(EXTERNAL_DIR, { recursive: true });
}

initMongodb();