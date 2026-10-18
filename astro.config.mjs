// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { CV, genererCv } from './scripts/cv.mjs';
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

// CV en PDF généré à partir du Markdown : à la volée en développement, dans dist/ au build.
const cvPdf = {
  name: 'cv-pdf',
  hooks: {
    'astro:server:setup': ({ server }) => {
      server.middlewares.use(async (req, res, next) => {
        const lang = Object.keys(CV).find((l) => req.url === `/assets/docs/${CV[l].fichier}`);
        if (!lang) return next();
        res.setHeader('Content-Type', 'application/pdf');
        res.end(await genererCv(lang));
      });
    },
    'astro:build:done': async ({ dir }) => {
      const sortie = fileURLToPath(new URL('assets/docs/', dir));
      await mkdir(sortie, { recursive: true });
      for (const lang of Object.keys(CV)) await writeFile(path.join(sortie, CV[lang].fichier), await genererCv(lang));
    },
  },
};

// Procédures pfSense et OPNsense passées du dossier Linux au dossier Pare-feu : les anciennes adresses redirigent.
const PARE_FEU = [
  'installation-et-configuration-initiale-de-pfsense',
  'segmentation-reseau-vlans-sur-pfsense',
  'acces-distant-securise-via-wireguard',
  'filtrage-dns-et-ip-avec-pfblockerng',
  'configuration-dun-proxy-squid-sur-opnsense',
];

export default defineConfig({
  site: 'https://nathan-lallier.com',
  // Pages générées en fichier .html (parcours.html) : les adresses actuelles restent identiques sur GitHub Pages
  build: { format: 'file' },
  trailingSlash: 'never',
  redirects: {
    '/realisations': '/projets',
    ...Object.fromEntries(PARE_FEU.map((s) => [`/procedures/linux/${s}`, `/procedures/pare-feu/${s}`])),
  },
  integrations: [doublonsDossier, cvPdf, sitemap({ filter: (page) => !page.includes('/realisations') && !PARE_FEU.some((s) => page.includes(`/procedures/linux/${s}`)) })],
  markdown: {
    shikiConfig: { theme: 'github-dark-dimmed' },
  },
});
