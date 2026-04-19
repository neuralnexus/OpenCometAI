import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(repoRoot, 'manifest.json');

const errors = [];

function existsRelative(relPath) {
  return fs.existsSync(path.join(repoRoot, relPath));
}

function assertFile(relPath, label) {
  if (!relPath || typeof relPath !== 'string') {
    errors.push(`${label}: missing path`);
    return;
  }
  if (!existsRelative(relPath)) {
    errors.push(`${label}: not found (${relPath})`);
  }
}

function assertGlobLikePath(relPath, label) {
  if (!relPath || typeof relPath !== 'string') {
    errors.push(`${label}: missing path`);
    return;
  }
  if (relPath.includes('*')) {
    const rootPart = relPath.split('*')[0];
    const checkPath = rootPart.endsWith('/') ? rootPart.slice(0, -1) : rootPart;
    if (checkPath && !existsRelative(checkPath)) {
      errors.push(`${label}: glob base path not found (${relPath})`);
    }
    return;
  }
  assertFile(relPath, label);
}

function collectJsFiles(absDir) {
  const out = [];
  if (!fs.existsSync(absDir)) return out;

  const stack = [absDir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        out.push(full);
      }
    }
  }

  return out.sort();
}

function checkJsSyntax(absFiles) {
  for (const file of absFiles) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      const rel = path.relative(repoRoot, file);
      const detail = (result.stderr || result.stdout || '').trim();
      errors.push(`Syntax check failed: ${rel}${detail ? `\n${detail}` : ''}`);
    }
  }
}

function validateManifest() {
  if (!fs.existsSync(manifestPath)) {
    errors.push('manifest.json not found');
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    errors.push(`manifest.json parse error: ${e.message}`);
    return;
  }

  if (manifest.manifest_version !== 3) {
    errors.push(`manifest_version must be 3 (got ${manifest.manifest_version})`);
  }

  if (!manifest.name) errors.push('manifest.name is required');
  if (!manifest.version) errors.push('manifest.version is required');

  assertFile(manifest?.background?.service_worker, 'background.service_worker');
  assertFile(manifest?.side_panel?.default_path, 'side_panel.default_path');

  const iconEntries = Object.entries(manifest.icons || {});
  if (iconEntries.length === 0) {
    errors.push('manifest.icons is required');
  }
  for (const [size, iconPath] of iconEntries) {
    assertFile(iconPath, `icons[${size}]`);
  }

  const actionIcons = Object.entries(manifest?.action?.default_icon || {});
  for (const [size, iconPath] of actionIcons) {
    assertFile(iconPath, `action.default_icon[${size}]`);
  }

  const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
  for (const [idx, cs] of contentScripts.entries()) {
    const scripts = Array.isArray(cs.js) ? cs.js : [];
    const styles = Array.isArray(cs.css) ? cs.css : [];
    for (const js of scripts) assertFile(js, `content_scripts[${idx}].js`);
    for (const css of styles) assertFile(css, `content_scripts[${idx}].css`);
  }

  const war = Array.isArray(manifest.web_accessible_resources) ? manifest.web_accessible_resources : [];
  for (const [idx, resBlock] of war.entries()) {
    const resources = Array.isArray(resBlock.resources) ? resBlock.resources : [];
    for (const res of resources) {
      assertGlobLikePath(res, `web_accessible_resources[${idx}]`);
    }
  }
}

validateManifest();

const jsFiles = [
  ...collectJsFiles(path.join(repoRoot, 'src')),
  ...collectJsFiles(path.join(repoRoot, 'scripts')),
  ...collectJsFiles(path.join(repoRoot, 'tests')),
];
checkJsSyntax(jsFiles);

if (errors.length) {
  console.error('Static checks failed:');
  for (const err of errors) {
    console.error(`- ${err}`);
  }
  process.exit(1);
}

console.log(`Static checks passed (manifest + ${jsFiles.length} JavaScript file(s) syntax).`);
