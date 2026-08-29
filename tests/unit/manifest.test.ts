import { describe, expect, it } from 'vitest';
import manifest from '@/manifest.json';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

  it('déclare une version alignée sur le package', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
