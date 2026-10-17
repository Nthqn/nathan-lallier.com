import { langColor } from './format';

export interface RepoInfo {
  nom: string;
  url: string;
  misAJour: string;
  licence: string | null;
  version: string | null;
  langages: { nom: string; part: number; couleur: string }[];
}

const cache = new Map<string, Promise<RepoInfo | null>>();

// Informations d'un dépôt pour la page d'un projet. Sans réseau, la page s'affiche sans ce bloc.
export function getRepoInfo(fullName: string): Promise<RepoInfo | null> {
  if (!cache.has(fullName)) cache.set(fullName, load(fullName));
  return cache.get(fullName)!;
}

async function load(fullName: string): Promise<RepoInfo | null> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'nathan-lallier.com' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const [repo, langs, release] = await Promise.all(
      ['', '/languages', '/releases/latest'].map((suffix) =>
        fetch(`https://api.github.com/repos/${fullName}${suffix}`, { headers }).then((r) => (r.ok ? r.json() : null))
      )
    );
    if (!repo) return null;
    const total = Object.values<number>(langs ?? {}).reduce((a, b) => a + b, 0) || 1;
    return {
      nom: repo.full_name,
      url: repo.html_url,
      misAJour: repo.pushed_at,
      licence: repo.license?.spdx_id && repo.license.spdx_id !== 'NOASSERTION' ? repo.license.spdx_id : null,
      version: release?.tag_name ?? null,
      langages: Object.entries<number>(langs ?? {})
        .map(([nom, n]) => ({ nom, part: Math.round((n / total) * 100), couleur: langColor(nom) }))
        .filter((l) => l.part > 0),
    };
  } catch {
    return null;
  }
}
