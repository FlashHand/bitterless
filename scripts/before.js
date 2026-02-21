const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const envRigPath = path.join(rootDir, '.env.rig');
const pkgPath = path.join(rootDir, 'package.json');

const parseEnvRig = () => {
  if (!fs.existsSync(envRigPath)) return {};
  const content = fs.readFileSync(envRigPath, 'utf-8');
  const result = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*([\w]+)\s*=\s*(.*?)\s*$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
};

const envVars = parseEnvRig();
const viteEnv = envVars.VITE_ENV || '';

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const baseName = pkg._name;

if (viteEnv) {
  pkg.name = `${baseName}_${viteEnv}`.toLowerCase();
} else {
  pkg.name = baseName.toLowerCase();
}

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
console.log(`[before.js] VITE_ENV=${viteEnv}, package.json name set to: ${pkg.name}`);
