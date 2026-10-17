import type { Loader } from 'astro/loaders';

interface Options {
  user: string;
  topic: string;
}

export interface Lab {
  nom: string;
  description: string;
  url: string;
  homepage: string | null;
  langage: string | null;
  langages: { nom: string; part: number }[];
  sujets: string[];
  misAJour: string;
  etoiles: number;
  brancheParDefaut: string;
}

// Lit sur GitHub les dépôts publics d'un utilisateur qui portent un sujet donné.
// Sans réseau ou en cas de limite d'API, la collection reste vide et le site se construit quand même.
export function githubLabs({ user, topic }: Options): Loader {
  return {
    name: 'github-labs',
    load: async ({ store, logger, renderMarkdown, generateDigest }) => {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'nathan-lallier.com',
      };
      const token = process.env.GITHUB_TOKEN;
      if (token) headers.Authorization = `Bearer ${token}`;
      const api = (path: string, extra: Record<string, string> = {}) =>
        fetch(`https://api.github.com${path}`, { headers: { ...headers, ...extra } });

      try {
        const search = await api(`/search/repositories?q=${encodeURIComponent(`user:${user} topic:${topic} fork:true`)}&sort=updated&per_page=100`);
        if (!search.ok) throw new Error(`recherche GitHub : HTTP ${search.status}`);
        const { items = [] } = await search.json();
        store.clear();

        for (const repo of items) {
          const [langRes, readmeRes] = await Promise.all([
            api(`/repos/${repo.full_name}/languages`),
            api(`/repos/${repo.full_name}/readme`, { Accept: 'application/vnd.github.raw' }),
          ]);
          const bytes: Record<string, number> = langRes.ok ? await langRes.json() : {};
          const total = Object.values(bytes).reduce((a, b) => a + b, 0) || 1;
          const langages = Object.entries(bytes)
            .map(([nom, n]) => ({ nom, part: Math.round((n / total) * 100) }))
            .filter((l) => l.part > 0);

          let readme = readmeRes.ok ? await readmeRes.text() : '';
          // Les images relatives du README pointent vers le dépôt
          const raw = `https://raw.githubusercontent.com/${repo.full_name}/${repo.default_branch}/`;
          readme = readme.replace(/(!\[[^\]]*\]\()(?!https?:|#)\.?\/?([^)]+\))/g, `$1${raw}$2`);

          const data: Lab = {
            nom: repo.name,
            description: repo.description ?? '',
            url: repo.html_url,
            homepage: repo.homepage || null,
            langage: repo.language,
            langages,
            sujets: (repo.topics ?? []).filter((t: string) => t !== topic),
            misAJour: repo.pushed_at,
            etoiles: repo.stargazers_count,
            brancheParDefaut: repo.default_branch,
          };
          store.set({
            id: repo.name.toLowerCase(),
            data: data as unknown as Record<string, unknown>,
            rendered: readme ? await renderMarkdown(readme) : undefined,
            digest: generateDigest({ ...data, readme }),
          });
        }
        logger.info(`${items.length} lab(s) chargé(s) depuis GitHub`);
      } catch (error) {
        logger.warn(`Labs non chargés (${(error as Error).message}). La section Labs sera vide.`);
      }
    },
  };
}
