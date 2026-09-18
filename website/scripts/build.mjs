import { build } from 'vite';
import { mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = resolve(root, '../docs');
const assets = resolve(docs, 'assets/workspace');
const temporary = await mkdtemp(resolve(tmpdir(), 'wildfire-website-build-'));
try {
  await build({ root, build: { outDir: temporary, assetsDir: 'assets/workspace', emptyOutDir: true } });
  // Only this build's generated directory is replaced; other Pages assets survive.
  if (assets !== resolve(root, '../docs/assets/workspace')) throw new Error('Unexpected output directory');
  await rm(assets, { recursive: true, force: true });
  await mkdir(assets, { recursive: true });
  await cp(resolve(temporary, 'assets/workspace'), assets, { recursive: true });
  await cp(resolve(temporary, 'index.html'), resolve(docs, 'index.html'));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
