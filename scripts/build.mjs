/**
 * Build de l'extension : bundles Vite + copie des ressources statiques.
 *
 * Le manifest référence des chemins fixes (`background/service-worker.js`,
 * `ui/popup.html`…), donc pas de hash sur les noms de fichiers et une copie
 * telle quelle des .html, des .css et du manifest.
 */

import { access, cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// Vite est importé dynamiquement, et pas en tête de fichier : un `import`
// statique est résolu avant que la moindre ligne ne s'exécute, donc sur un dépôt
// fraîchement cloné le script mourait sur une trace ERR_MODULE_NOT_FOUND qui
// désigne ce fichier au lieu de l'installation manquante.
try {
  await access(join(root, 'node_modules', 'vite'));
} catch {
  console.error('Dépendances absentes : lance `npm ci` avant `npm run build`.');
  console.error("(`node_modules/` n'est pas versionné ; le package-lock.json, si.)");
  process.exit(1);
}
const { build } = await import('vite');
const srcDir = join(root, 'src');
const isTestBuild = process.env.OMR_TEST_BUILD === '1';
const outDir = join(root, isTestBuild ? 'dist-test' : 'dist');

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

// Le build d'intégration parle à un faux endpoint local. Les match patterns
// Chrome n'acceptent pas de port, d'où `http://localhost/*` et non `:PORT`.
if (isTestBuild) {
  const path = join(outDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.name = 'OpenMeetRec (test)';
  manifest.host_permissions = [...manifest.host_permissions, 'http://localhost/*'];
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
}

// Le manifest référence des chemins en dur : une entrée renommée dans
// vite.config.ts ne casserait rien au build, seulement au chargement de
// l'extension. On vérifie donc que tout ce qu'il pointe existe vraiment.
const manifest = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8'));
const referenced = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
].filter(Boolean);

const missing = [];
for (const path of referenced) {
  try {
    await access(join(outDir, path));
  } catch {
    missing.push(path);
  }
}
if (missing.length > 0) {
  console.error(`Fichiers référencés par le manifest et absents de dist/ : ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`Extension construite dans ${relative(root, outDir)}/ (${statics.length} fichiers statiques copiés)`);
