#!/usr/bin/env node
// Copie les procédures Markdown (et leurs images) depuis la bibliothèque Proton Drive
// vers src/content/procedures, puis liste celles qui restent à valider.
//
// Publication : toute procédure rangée dans PLATEFORME/PILIER/ est publiée.
// Les brouillons restent dans _A_VERIFIER, qui n'est jamais publié et sert de liste à valider.
//
// Usage : npm run sync [-- "C:\chemin\vers\Procèdures"]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.resolve(
  process.argv[2] || process.env.PROCEDURES_DIR ||
  path.join(os.homedir(), 'Proton Drive', 'Ciaiuu', 'My files', 'Procèdures')
);
const DEST = path.join(ROOT, 'src', 'content', 'procedures');
const PENDING_FILE = path.join(ROOT, 'procedures-a-valider.md');
const DRAFTS_DIR = '_A_VERIFIER';
const IGNORED_DIRS = new Set([DRAFTS_DIR, 'word', 'banque-images', 'Packet Tracer']);

export function slugify(value) {
  return value
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '').replace(/&/g, ' ')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function readFrontmatter(text) {
  const match = text.match(/^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
    if (field) data[field[1]] = field[2];
  }
  return data;
}

function listMarkdown(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listMarkdown(full));
    // Une procédure se trouve exactement dans PLATEFORME/PILIER/<titre>.md
    else if (entry.name.endsWith('.md') && path.relative(SOURCE, full).split(path.sep).length === 3) found.push(full);
  }
  return found;
}

// Brouillons : tous les .md de _A_VERIFIER, quelle que soit leur profondeur
function listDrafts(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listDrafts(full);
    return entry.name.endsWith('.md') && !entry.name.startsWith('Points') ? [full] : [];
  });
}

// Hors blocs de code : titres décalés d'un niveau (le titre de la page est le seul h1)
// et légende numérotée sous chaque image seule sur sa ligne, comme dans les PDF Word.
function adjustStructure(body) {
  let inFence = false;
  let figure = 0;
  const out = [];
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) { out.push(line); continue; }
    if (/^#{1,5}\s/.test(line)) { out.push('#' + line); continue; }
    const image = line.match(/^\s*!\[([^\]]+)\]\([^)]+\)\s*$/);
    if (image) {
      figure++;
      out.push(line, '', `<p class="figure-caption"><b>Figure ${figure}</b> · ${image[1]}</p>`);
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

// Conversion de la syntaxe propre aux fichiers sources vers du Markdown standard.
function transform(raw, linkMap) {
  const match = raw.match(/^(\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n)([\s\S]*)$/);
  const [frontmatter, body] = match ? [match[1], match[2]] : ['', raw];
  return frontmatter + adjustStructure(body)
    // Encadrés « ::: note » (syntaxe pandoc) en bloc HTML
    .replace(/^:::+\s*(\w+)\s*\r?\n([\s\S]*?)^:::+\s*$/gm,
      (_, kind, inner) => `<div class="callout callout-${kind}">\n\n${inner.trim()}\n\n</div>\n`)
    // Identifiants pandoc de figures et tableaux ({#fig:x}, {#tbl:x})
    .replace(/\s*\{#(fig|tbl):[^}]*\}/g, '')
    // Liens vers les anciens PDF du site : page de la procédure si publiée, texte simple sinon
    .replace(/\[([^\]]+)\]\(https?:\/\/(?:www\.)?nathan-lallier\.com\/assets\/docs\/[^)]*?\/([^/)]+)\.pdf\)/g,
      (_, label, file) => {
        const target = linkMap.get(file.toLowerCase());
        return target ? `[${label}](${target})` : label;
      });
}

function copyImages(text, mdFile) {
  let copied = 0;
  for (const match of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const ref = decodeURI(match[1]);
    if (/^https?:/.test(ref)) continue;
    const src = path.resolve(path.dirname(mdFile), ref);
    const dst = path.join(DEST, path.relative(SOURCE, src));
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      copied++;
    } catch (error) {
      console.warn(`  [image manquante] ${path.relative(SOURCE, mdFile)} → ${ref}`);
    }
  }
  return copied;
}

function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`Dossier source introuvable : ${SOURCE}`);
    process.exit(1);
  }
  const entries = listMarkdown(SOURCE).map((file) => {
    const raw = fs.readFileSync(file, 'utf8');
    const data = readFrontmatter(raw) || {};
    const title = (data.titre || path.basename(file, '.md')).normalize('NFC');
    const platform = path.relative(SOURCE, file).split(path.sep)[0].toLowerCase();
    return { file, raw, data, title, platform, slug: slugify(title) };
  });

  const linkMap = new Map(
    entries.map((e) => [e.slug, `/procedures/${e.platform}/${e.slug}`])
  );

  fs.rmSync(DEST, { recursive: true, force: true });
  let images = 0;
  for (const entry of entries) {
    const dst = path.join(DEST, path.relative(SOURCE, entry.file));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, transform(entry.raw, linkMap));
    images += copyImages(entry.raw, entry.file);
  }

  const pending = listDrafts(path.join(SOURCE, DRAFTS_DIR))
    .map((file) => {
      const data = readFrontmatter(fs.readFileSync(file, 'utf8')) || {};
      return { file, data, title: (data.titre || path.basename(file, '.md')).normalize('NFC') };
    })
    .sort((a, b) => (a.data.reference || '').localeCompare(b.data.reference || '') || a.title.localeCompare(b.title));
  const lines = [
    '# Procédures à valider',
    '',
    `Ces brouillons sont dans \`${DRAFTS_DIR}\` et ne sont pas publiés.`,
    'Pour en publier un, range-le dans `PLATEFORME/PILIER/` avec sa référence, puis relance `npm run sync`.',
    '',
    `Dernière mise à jour : ${new Date().toLocaleDateString('fr-FR')} · ${pending.length} procédure(s)`,
    '',
    '| Référence | Titre | Version | Révision | Fichier |',
    '|---|---|---|---|---|',
    ...pending.map((e) => `| ${e.data.reference || ''} | ${e.title} | ${e.data.version || ''} | ${e.data.revision || ''} | \`${path.relative(SOURCE, e.file).split(path.sep).join('/')}\` |`),
    '',
  ];
  fs.writeFileSync(PENDING_FILE, lines.join('\n'));

  console.log(`Source : ${SOURCE}`);
  console.log(`${linkMap.size} procédure(s) publiée(s), ${images} image(s) copiée(s).`);
  console.log(`${pending.length} procédure(s) à valider, listées dans procedures-a-valider.md.`);
}

main();
