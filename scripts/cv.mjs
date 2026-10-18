// Génère le CV en PDF à partir de sa version Markdown (cv/cv-fr.md, cv/cv-en.md).
// Conventions du Markdown :
//   # Nom, puis un paragraphe pour le titre et un pour les coordonnées, puis l'accroche
//   ## Section
//   ### Intitulé | Lieu ou établissement | Dates (les dates sont alignées à droite)
//   - puces, avec **gras** et [liens](https://...)
import PDFDocument from 'pdfkit';
import { marked } from 'marked';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const CV = {
  fr: { source: 'cv/cv-fr.md', fichier: 'CV-Nathan-LALLIER.pdf', titre: 'CV Nathan LALLIER' },
  en: { source: 'cv/cv-en.md', fichier: 'CV-Nathan-LALLIER-EN.pdf', titre: 'Nathan LALLIER CV' },
};

const POLICE = { normal: 'Helvetica', gras: 'Helvetica-Bold', italique: 'Helvetica-Oblique' };
const COULEUR = { texte: '#222222', secondaire: '#5f5a52', accent: '#0b6f7e' };
const MARGE = 36;
const TAILLE = 9.5;
const INTERLIGNE = 1.2;

// Découpe le contenu en ligne d'un token marked en segments { texte, police, lien }
function segments(tokens, police = POLICE.normal, lien = null) {
  return tokens.flatMap((t) => {
    if (t.type === 'space') return [];
    if (t.type === 'strong') return segments(t.tokens, POLICE.gras, lien);
    if (t.type === 'em') return segments(t.tokens, POLICE.italique, lien);
    if (t.type === 'link') return segments(t.tokens, police, t.href);
    if (t.tokens) return segments(t.tokens, police, lien);
    return [{ texte: decoder(t.text ?? t.raw), police, lien }];
  });
}

const decoder = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function ecrire(doc, segs, { x, largeur, taille = TAILLE, couleur = COULEUR.texte, ...options }) {
  doc.fontSize(taille).fillColor(couleur);
  segs.forEach((s, i) => {
    const suite = i < segs.length - 1;
    const opts = { width: largeur, lineGap: INTERLIGNE, continued: suite, link: s.lien, underline: false, ...options };
    doc.font(s.police);
    if (i === 0) doc.text(s.texte, x, doc.y, opts);
    else doc.text(s.texte, opts);
  });
}

export async function genererCv(lang) {
  const { source, titre } = CV[lang];
  const markdown = await readFile(new URL(`../${source}`, import.meta.url), 'utf8');
  const tokens = marked.lexer(markdown);

  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGE,
    bufferPages: true,
    lang: lang === 'en' ? 'en-GB' : 'fr-FR',
    info: { Title: titre, Author: 'Nathan LALLIER', Subject: titre },
  });
  const morceaux = [];
  doc.on('data', (c) => morceaux.push(c));
  const fin = new Promise((resolve) => doc.on('end', resolve));

  const gauche = MARGE;
  const largeur = doc.page.width - 2 * MARGE;
  let enTete = 0; // paragraphes lus avant la première section
  let dansSection = false;

  for (const t of tokens) {
    if (t.type === 'heading' && t.depth === 1) {
      ecrire(doc, segments(t.tokens), { x: gauche, largeur, taille: 22 });
      doc.moveDown(0.15);
    } else if (t.type === 'heading' && t.depth === 2) {
      dansSection = true;
      doc.moveDown(0.5);
      ecrire(doc, [{ texte: t.text.toUpperCase(), police: POLICE.gras }], { x: gauche, largeur, taille: 10.5, couleur: COULEUR.accent, characterSpacing: 0.6 });
      const y = doc.y + 1;
      doc.moveTo(gauche, y).lineTo(gauche + largeur, y).lineWidth(0.6).strokeColor(COULEUR.accent).stroke();
      doc.y = y + 4;
    } else if (t.type === 'heading' && t.depth === 3) {
      const parties = t.text.split(' | ').map(decoder);
      const dates = parties.length > 1 ? parties.pop() : '';
      const [intitule, ...lieu] = parties;
      doc.moveDown(0.25);
      const y = doc.y;
      doc.font(POLICE.normal).fontSize(TAILLE);
      const largeurDates = dates ? doc.widthOfString(dates) + 12 : 0;
      if (dates) doc.fillColor(COULEUR.secondaire).text(dates, gauche, y, { width: largeur, align: 'right', lineGap: INTERLIGNE });
      doc.y = y;
      const segs = [{ texte: intitule, police: POLICE.gras }];
      if (lieu.length) segs.push({ texte: `  |  ${lieu.join(' | ')}`, police: POLICE.normal });
      ecrire(doc, segs, { x: gauche, largeur: largeur - largeurDates });
    } else if (t.type === 'paragraph') {
      if (!dansSection && enTete === 0) {
        ecrire(doc, segments(t.tokens), { x: gauche, largeur, taille: 12, couleur: COULEUR.accent });
        doc.moveDown(0.3);
      } else if (!dansSection && enTete === 1) {
        ecrire(doc, segments(t.tokens), { x: gauche, largeur, taille: 8.5, couleur: COULEUR.secondaire });
        doc.moveDown(0.6);
      } else {
        ecrire(doc, segments(t.tokens), { x: gauche, largeur });
      }
      if (!dansSection) enTete++;
    } else if (t.type === 'list') {
      for (const item of t.items) {
        const y = doc.y;
        doc.font(POLICE.normal).fontSize(TAILLE).fillColor(COULEUR.accent).text('•', gauche + 4, y, { lineGap: INTERLIGNE });
        doc.y = y;
        ecrire(doc, segments(item.tokens), { x: gauche + 14, largeur: largeur - 14 });
        doc.moveDown(0.05);
      }
    }
  }

  const pages = doc.bufferedPageRange().count;
  if (pages > 1) console.warn(`[cv] ${CV[lang].fichier} fait ${pages} pages, le contenu dépasse une page A4.`);
  doc.end();
  await fin;
  return Buffer.concat(morceaux);
}

// Aperçu sans construire le site : npm run cv (PDF écrits dans cv/, ignorés par git)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { writeFile, mkdir } = await import('node:fs/promises');
  const sortie = process.argv[2] ?? 'cv';
  await mkdir(sortie, { recursive: true });
  for (const lang of Object.keys(CV)) {
    await writeFile(`${sortie}/${CV[lang].fichier}`, await genererCv(lang));
    console.log(`${sortie}/${CV[lang].fichier}`);
  }
}
