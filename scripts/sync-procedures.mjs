#!/usr/bin/env node
// Copie les procédures Markdown (et leurs images) depuis la bibliothèque Proton Drive
// vers src/content/procedures, puis liste celles qui restent à valider.
//
// Publication : une procédure est publiée si elle a un PDF à côté de son dossier markdown/
// (procédure finalisée), ou si sa référence ou son titre figure dans procedures-validees.txt.
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
const VALIDATED_FILE = path.join(ROOT, 'procedures-validees.txt');
const PENDING_FILE = path.join(ROOT, 'procedures-a-valider.md');
const IGNORED_DIRS = new Set(['_A_VERIFIER', 'word', 'banque-images', 'Packet Tracer']);

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
    else if (entry.name.endsWith('.md') && path.basename(dir) === 'markdown') found.push(full);
  }
  return found;
}

function readValidated() {
  if (!fs.existsSync(VALIDATED_FILE)) return new Set();
  return new Set(
    fs.readFileSync(VALIDATED_FILE, 'utf8').split(/\r?\n/)
      .map((line) => line.replace(/#.*/, '').trim().toLowerCase())
      .filter(Boolean)
  );
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
  const validated = readValidated();
  const entries = listMarkdown(SOURCE).map((file) => {
    const raw = fs.readFileSync(file, 'utf8');
    const data = readFrontmatter(raw) || {};
    const title = (data.titre || path.basename(file, '.md')).normalize('NFC');
    const platform = path.relative(SOURCE, file).split(path.sep)[0].toLowerCase();
    const pdf = path.join(path.dirname(path.dirname(file)), path.basename(file, '.md') + '.pdf');
    const published = fs.existsSync(pdf)
      || validated.has((data.reference || '').toLowerCase())
      || validated.has(title.toLowerCase());
    return { file, raw, data, title, platform, slug: slugify(title), published };
  });

  const linkMap = new Map(
    entries.filter((e) => e.published).map((e) => [e.slug, `/procedures/${e.platform}/${e.slug}`])
  );

  fs.rmSync(DEST, { recursive: true, force: true });
  let images = 0;
  for (const entry of entries.filter((e) => e.published)) {
    const dst = path.join(DEST, path.relative(SOURCE, entry.file));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, transform(entry.raw, linkMap));
    images += copyImages(entry.raw, entry.file);
  }

  const pending = entries.filter((e) => !e.published)
    .sort((a, b) => (a.data.reference || '').localeCompare(b.data.reference || '') || a.title.localeCompare(b.title));
  const lines = [
    '# Procédures à valider',
    '',
    'Ces procédures existent en Markdown mais ne sont pas publiées, car elles n\'ont pas encore de PDF.',
    'Pour en publier une, ajoute son titre (ou sa référence) sur une ligne de `procedures-validees.txt`, puis relance `npm run sync`.',
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
