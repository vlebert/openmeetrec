import { describe, expect, it } from 'vitest';
import manifest from '@/manifest.json';
import pkg from '../../package.json';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IDLE_ICON, RECORDING_ICON } from '@/shared/icons';

/**
 * Garde-fou de l'audit de permissions : toute permission ajoutée au manifest
 * doit être justifiée dans `docs/permissions-audit.md`.
 */
const audit = readFileSync(
  fileURLToPath(new URL('../../docs/permissions-audit.md', import.meta.url)),
  'utf8',
);

describe('manifest', () => {
  it('est un MV3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('documente chaque permission dans l audit', () => {
    for (const permission of manifest.permissions) {
      expect(audit, `permission non documentée : ${permission}`).toContain(`\`${permission}\``);
    }
  });

  it('documente chaque permission d hôte requise', () => {
    for (const host of manifest.host_permissions) {
      expect(audit, `host_permission non documentée : ${host}`).toContain(host);
    }
  });

  it('ne demande pas d accès large par défaut', () => {
    expect(manifest.host_permissions).not.toContain('<all_urls>');
    expect(manifest.optional_host_permissions).toContain('<all_urls>');
  });

  it('n injecte aucun content script', () => {
    expect(manifest).not.toHaveProperty('content_scripts');
  });

  it('ouvre le popup sur l onglet courant plutôt qu un onglet dédié', () => {
    expect(manifest.action.default_popup).toBe('ui/popup.html');
  });

  it('déclare une icône présente dans les sources pour chaque taille', () => {
    for (const declared of [manifest.icons, manifest.action.default_icon, IDLE_ICON, RECORDING_ICON]) {
      expect(Object.keys(declared).sort()).toEqual(['128', '16', '32', '48']);
      for (const path of Object.values(declared)) {
        const file = fileURLToPath(new URL(`../../src/${path}`, import.meta.url));
        expect(existsSync(file), `icône déclarée et absente : ${path}`).toBe(true);
      }
    }
  });

  /**
   * L'icône par défaut est celle du repos : si le manifest embarquait la version
   * au point rouge, la barre d'outils annoncerait un enregistrement en cours dès
   * l'installation, et jusqu'au premier changement d'état.
   */
  it('affiche l icône de repos tant que le service worker n a rien dit', () => {
    expect(manifest.action.default_icon).toEqual(IDLE_ICON);
    expect(manifest.action.default_icon).not.toEqual(RECORDING_ICON);
  });

  /**
   * La version vit dans deux fichiers, et rien au build ne les rapproche : c'est
   * le manifest qui devient la version installée, et `package.json` celle que
   * lit le développeur. Un bump fait dans un seul des deux ne se voit pas.
   */
  it('déclare une version alignée sur le package', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.version).toBe(pkg.version);
  });
});
