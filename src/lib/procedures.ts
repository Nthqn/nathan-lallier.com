import { getCollection, type CollectionEntry } from 'astro:content';
import { PILIERS, PLATEFORMES } from '../data/site';

export type Procedure = CollectionEntry<'procedures'> & {
  plateforme: string;
  slug: string;
  url: string;
  pilier: string;
  pilierLabel: string;
  revisionDate: Date | null;
};

// « 16/10/2026 » vers une date JavaScript
export function parseDateFr(value: string): Date | null {
  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
}

export function formatDateFr(date: Date | null): string {
  return date ? date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

export async function getProcedures(): Promise<Procedure[]> {
  const entries = await getCollection('procedures');
  return entries
    .map((entry) => {
      const [plateforme, slug] = entry.id.split('/');
      const pilier = entry.data.reference.split('-')[1] ?? '';
      return {
        ...entry,
        plateforme,
        slug,
        url: `/procedures/${plateforme}/${slug}`,
        pilier,
        pilierLabel: PILIERS[pilier] ?? 'Divers',
        revisionDate: parseDateFr(entry.data.revision),
      };
    })
    .sort((a, b) => a.data.titre.localeCompare(b.data.titre, 'fr'));
}

export function platformOrder(): string[] {
  return Object.keys(PLATEFORMES);
}

export function readingMinutes(body = ''): number {
  const words = body.replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
