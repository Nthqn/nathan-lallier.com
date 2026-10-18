import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { slugify } from './lib/slug';
import { githubLabs } from './lib/github-loader';

// Procédures copiées depuis Proton Drive par `npm run sync`
const procedures = defineCollection({
  loader: glob({
    pattern: '*/*/*.md',
    base: './src/content/procedures',
    generateId: ({ entry, data }) =>
      `${entry.split('/')[0].toLowerCase()}/${slugify(String(data.titre ?? entry))}`,
  }),
  schema: z.object({
    titre: z.string(),
    type: z.string().default('PROCEDURE'),
    class: z.string().default(''),
    reference: z.string().default(''),
    creation: z.string().default(''),
    revision: z.string().default(''),
    version: z.string().default('1.0'),
    auteur: z.string().default('Nathan LALLIER'),
  }),
});

// Projets complets, un fichier Markdown par projet
const projets = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/projets' }),
  schema: ({ image }) => z.object({
    titre: z.string(),
    titreAccent: z.string().optional(),
    resume: z.string(),
    statut: z.enum(['termine', 'en-cours']),
    categorie: z.string(),
    // Cadre du projet (évaluation de formation, étude de cas…), affiché à côté de l'année
    contexte: z.string().optional(),
    // Projet présenté sur la page d'accueil
    aLaUne: z.boolean().default(true),
    annee: z.number(),
    ordre: z.number().default(0),
    depot: z.string().optional(),
    technologies: z.array(z.string()).default([]),
    faits: z.array(z.object({ label: z.string(), valeur: z.string() })).default([]),
    besoin: z.string().optional(),
    realisation: z.string().optional(),
    resultat: z.string().optional(),
    documents: z.array(z.object({ titre: z.string(), url: z.string(), detail: z.string().optional() })).default([]),
    proceduresLiees: z.array(z.string()).default([]),
    couverture: image().optional(),
    // Langue de rédaction du projet, et textes de présentation traduits dans l'autre langue
    langue: z.enum(['fr', 'en']).default('fr'),
    traduction: z.object({
      titre: z.string().optional(),
      titreAccent: z.string().optional(),
      resume: z.string().optional(),
      categorie: z.string().optional(),
      contexte: z.string().optional(),
      faits: z.array(z.object({ label: z.string(), valeur: z.string() })).optional(),
      besoin: z.string().optional(),
      realisation: z.string().optional(),
      resultat: z.string().optional(),
    }).optional(),
  }),
});

// Labs : dépôts GitHub portant le sujet « portfolio-lab », lus à chaque publication
const labs = defineCollection({
  loader: githubLabs({ user: 'Nthqn', topic: 'portfolio-lab' }),
});

export const collections = { procedures, projets, labs };
