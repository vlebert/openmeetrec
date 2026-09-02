/**
 * Génère les captures d'écran pour la fiche Chrome Web Store.
 *
 * Charge le build de test (`dist-test/`, capture factice — le vrai
 * `chrome.tabCapture` n'est pas pilotable en automatisation) sur la page
 * fixture de visio, prend des captures de l'UI réelle (popup, options), puis
 * les compose sur une toile 1280x800 pour respecter le format attendu par le
 * store. Pas un test : script à lancer manuellement, résultat dans
 * `store/screenshots/`.
 *
 * Usage : OMR_CHROMIUM=/path/to/chrome DISPLAY=:1 node scripts/screenshots.mjs
 */

import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distTest = join(root, 'dist-test');
const outDir = join(root, 'store', 'screenshots');
const meetingPagePath = join(root, 'tests', 'integration', 'fixtures', 'meeting-page.html');
const logoSvg = readFileSync(join(root, 'src', 'assets', 'logo.svg'), 'utf8');

mkdirSync(outDir, { recursive: true });

async function startMockApi() {
  const calls = [];
  const server = createServer((req, res) => {
    const parts = [];
    req.on('data', (chunk) => parts.push(chunk));
    req.on('end', () => {
      const url = req.url ?? '/';
      if (req.method === 'GET' && url.startsWith('/meeting')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(readFileSync(meetingPagePath));
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'mock-1' }] }));
        return;
      }
      const body = Buffer.concat(parts);
      calls.push(body.length);
      const seconds = Math.max(1, Math.round(body.length / 16_100));
      const count = Math.max(1, Math.floor(seconds / 5));
      const segments = Array.from({ length: count }, (_, i) => ({
        text: `segment ${i * 5}`,
        start: i * 5,
        end: Math.min((i + 1) * 5, seconds),
        speaker_id: i % 2,
      }));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: segments.map((s) => s.text).join(' '), segments }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { url: `http://localhost:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Compose une capture brute sur une toile 1280x800, avec logo et légende sobre. */
async function compose(browser, rawPngPath, caption, outPath) {
  const b64 = readFileSync(rawPngPath).toString('base64');
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent(`
    <!doctype html>
    <html><head><style>
      html, body { margin: 0; width: 1280px; height: 800px; }
      body {
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
        background: linear-gradient(135deg, #eef2ff, #e0f2fe);
        font-family: system-ui, sans-serif;
      }
      .wordmark { display: flex; align-items: center; gap: 8px; }
      .wordmark svg { width: 24px; height: 24px; }
      .wordmark span { font-size: 16px; font-weight: 700; color: #1e293b; letter-spacing: -0.01em; }
      .frame {
        background: #fff; border-radius: 16px; padding: 20px;
        box-shadow: 0 24px 64px rgba(15, 23, 42, 0.18);
        display: flex; align-items: center; justify-content: center;
      }
      img { display: block; max-width: 1180px; max-height: 660px; width: auto; height: auto; border-radius: 8px; }
      figcaption { font-size: 16px; color: #475569; text-align: center; }
    </style></head>
    <body>
      <div class="wordmark">${logoSvg}<span>OpenMeetRec</span></div>
      <div class="frame"><img src="data:image/png;base64,${b64}" /></div>
      <figcaption>${caption}</figcaption>
    </body></html>
  `);
  await page.screenshot({ path: outPath });
  await page.close();
}

async function main() {
  const api = await startMockApi();

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    // 2x : les captures brutes sont réduites dans le cadre composé, l'excès de
    // pixels garde le texte net plutôt que flou après redimensionnement.
    deviceScaleFactor: 2,
    ...(process.env.OMR_CHROMIUM ? { executablePath: process.env.OMR_CHROMIUM } : {}),
    args: [
      `--disable-extensions-except=${distTest}`,
      `--load-extension=${distTest}`,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--no-first-run',
    ],
  });

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extId = new URL(worker.url()).host;

  // Config "vitrine" : provider Mistral, réglages plausibles, pour la capture Options.
  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      config: {
        provider: 'mistral',
        model: 'voxtral-mini-latest',
        apiKeys: { mistral: 'sk-demo-0000000000000000000000' },
        diarize: true,
        downloadAudio: false,
        language: null,
        meetingReminder: true,
        meetingPatterns: ['meet.google.com/*', '*.zoom.us/j/*', 'teams.live.com/*'],
      },
    });
  });

  // `main { max-width: 560px }` (options.css) : un viewport plus large ne fait
  // que rajouter des marges mortes des deux côtés. 592 = 560 + le padding du
  // conteneur, pour que le contenu remplisse tout le cadre de la capture.
  const optionsPage = await context.newPage();
  await optionsPage.setViewportSize({ width: 592, height: 1400 });
  await optionsPage.goto(`chrome-extension://${extId}/ui/options.html`);
  await optionsPage.waitForTimeout(400);
  // Page pleine hauteur = 3 fieldsets + bouton Save, trop haute pour rester
  // lisible une fois réduite dans le cadre 1280x800. Illustratif, pas
  // exhaustif : on s'arrête après "Output", "Meeting reminder" reste hors
  // champ pour cette capture.
  const cropHeight = await optionsPage.evaluate(() => {
    const legends = [...document.querySelectorAll('fieldset legend')];
    const output = legends.find((l) => l.textContent === 'Output')?.closest('fieldset');
    return Math.ceil((output?.getBoundingClientRect().bottom ?? 400) + 24);
  });
  const optionsRaw = join(outDir, '_raw-options.png');
  await optionsPage.screenshot({ path: optionsRaw, clip: { x: 0, y: 0, width: 592, height: cropHeight } });
  await optionsPage.close();

  const meeting = await context.newPage();
  await meeting.goto(`${api.url}/meeting`);
  await meeting.waitForSelector('#state');

  const tabId = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? -1;
  });

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 300, height: 480 });
  await popup.goto(`chrome-extension://${extId}/ui/popup.html`);
  await popup.waitForTimeout(400);
  // La popup est ouverte comme un onglet normal pour l'automatisation, donc
  // `chrome.tabs.query({active:true})` s'y voit elle-même comme onglet actif
  // et affiche son propre ID d'extension — jamais le cas en usage réel, où la
  // popup n'est pas un onglet. Corrigé pour la capture uniquement.
  await popup.evaluate(() => {
    document.getElementById('platform').textContent = 'meet.google.com';
  });
  const idleRaw = join(outDir, '_raw-popup-idle.png');
  await popup.screenshot({ path: idleRaw });

  // Bascule sur l'endpoint mock pour que la session fonctionne réellement pendant la capture.
  await worker.evaluate(async (endpoint) => {
    const { config } = await chrome.storage.local.get('config');
    await chrome.storage.local.set({
      config: {
        ...config,
        provider: 'custom',
        model: 'mock-1',
        customEndpoint: endpoint,
        customSupportsSegments: true,
        customSupportsDiarization: true,
        apiKeys: { custom: 'demo-key' },
      },
    });
  }, `${api.url}/v1/audio/transcriptions`);

  await popup.evaluate(
    async ({ tabId, url }) =>
      chrome.runtime.sendMessage({ target: 'sw', type: 'START_RECORDING', tabId, url, micEnabled: true }),
    { tabId, url: `${api.url}/meeting` },
  );

  await popup.waitForTimeout(9000);
  // Idem : la vraie valeur ici serait « localhost » (serveur mock local).
  await popup.evaluate(() => {
    document.getElementById('platform').textContent = 'meet.google.com';
  });
  const recordingRaw = join(outDir, '_raw-popup-recording.png');
  await popup.screenshot({ path: recordingRaw });

  // Capture propre (pas de cadre store, pas de dégradé) pour le README, cadrée
  // au plus près du popup plutôt que sur tout le viewport de la page-onglet.
  const appBox = await popup.evaluate(() => {
    const rect = document.getElementById('app').getBoundingClientRect();
    return { width: rect.width, height: rect.bottom };
  });
  await popup.screenshot({
    path: join(root, 'docs', 'screenshot.png'),
    clip: { x: 0, y: 0, width: appBox.width, height: appBox.height },
  });

  await popup.evaluate(() => chrome.runtime.sendMessage({ target: 'sw', type: 'STOP_RECORDING' }));
  await popup.waitForTimeout(3000);

  // Composition à part, headless : la fenêtre headed est bornée à la résolution
  // de l'écran VNC (souvent < 800 de haut), ce qui rognerait la toile 1280x800.
  const composeBrowser = await chromium.launch({
    headless: true,
    ...(process.env.OMR_CHROMIUM ? { executablePath: process.env.OMR_CHROMIUM } : {}),
  });
  await compose(composeBrowser, optionsRaw, 'Settings', join(outDir, '1-options.png'));
  await compose(composeBrowser, idleRaw, 'Ready to record', join(outDir, '2-popup-idle.png'));
  await compose(composeBrowser, recordingRaw, 'Recording in progress', join(outDir, '3-popup-recording.png'));
  await composeBrowser.close();

  await context.close();
  await api.close();

  console.log(`Captures composées dans ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
