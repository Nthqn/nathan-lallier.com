// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { copyFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Quand projets.html et le dossier projets/ coexistent, GitHub Pages peut rediriger /projets vers /projets/.
// On copie donc chaque page de ce type en projets/index.html pour que les deux adresses répondent.
const doublonsDossier = {
  name: 'doublons-dossier',
  hooks: {
    'astro:build:done': async ({ dir }) => {
      const walk = async (d) => {
        for (const entry of await readdir(d, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const sub = path.join(d, entry.name);
          const page = `${sub}.html`;
          if (await stat(page).then(() => true, () => false)) await copyFile(page, path.join(sub, 'index.html'));
          await walk(sub);
        }
      };
      await walk(fileURLToPath(dir));
    },
  },
};

export default defineConfig({
  site: 'https://nathan-lallier.com',
  // Pages générées en fichier .html (parcours.html) : les adresses actuelles restent identiques sur GitHub Pages
  build: { format: 'file' },
  trailingSlash: 'never',
  redirects: {
    '/realisations': '/projets',
  },
  integrations: [doublonsDossier, sitemap({ filter: (page) => !page.includes('/realisations') })],
  markdown: {
    shikiConfig: { theme: 'github-dark-dimmed' },
  },
});
