import { getCollection, type CollectionEntry } from 'astro:content';
import type { Lang } from '../i18n';

export type Projet = CollectionEntry<'projets'>;

// Textes d'un projet dans la langue de la page : ceux d'origine, ou la traduction si elle existe
export function projetVue(projet: Projet, lang: Lang) {
  const d = projet.data;
  const tr = d.langue !== lang ? d.traduction ?? {} : {};
  return {
    ...d,
    titre: tr.titre ?? d.titre,
    titreAccent: tr.titreAccent ?? d.titreAccent,
    resume: tr.resume ?? d.resume,
    categorie: tr.categorie ?? d.categorie,
    faits: tr.faits ?? d.faits,
    besoin: tr.besoin ?? d.besoin,
    realisation: tr.realisation ?? d.realisation,
    resultat: tr.resultat ?? d.resultat,
    // Le texte détaillé n'est rédigé que dans la langue d'origine
    contenuAutreLangue: d.langue !== lang,
  };
}

export async function getProjets() {
  return (await getCollection('projets')).sort((a, b) => a.data.ordre - b.data.ordre);
}
