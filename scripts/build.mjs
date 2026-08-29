/**
 * Build de l'extension : bundles Vite + copie des ressources statiques.
 *
 * Le manifest référence des chemins fixes (`background/service-worker.js`,
 * `ui/popup.html`…), donc pas de hash sur les noms de fichiers et une copie
 * telle quelle des .html, des .css et du manifest.
 */

import { build } from 'vite';
import { cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(root, 'src');
const outDir = join(root, 'dist');

/** Liste récursive des fichiers correspondant à un suffixe. */
async function collect(dir, suffix, found = []) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) await collect(full, suffix, found);
    else if (item.name.endsWith(suffix)) found.push(full);
  }
  return found;
}

await build();

const statics = [join(srcDir, 'manifest.json'), ...(await collect(srcDir, '.html')), ...(await collect(srcDir, '.css'))];
for (const file of statics) {
  const target = join(outDir, relative(srcDir, file));
  await mkdir(dirname(target), { recursive: true });
  await cp(file, target);
}

console.log(`Extension construite dans ${relative(root, outDir)}/ (${statics.length} fichiers statiques copiés)`);
