# nathan-lallier.com

Portfolio de Nathan LALLIER, construit avec [Astro](https://astro.build) et publié sur GitHub Pages.

## Prérequis

Node.js 22.22 ou plus récent (version LTS conseillée).

```bash
npm install
```

## Commandes

| Commande | Effet |
|---|---|
| `npm run dev` | Aperçu local sur http://localhost:4321, rechargé à chaque modification |
| `npm run sync` | Copie les procédures depuis Proton Drive et met à jour `procedures-a-valider.md` |
| `npm run build` | Construit le site dans `dist/` |
| `npm run preview` | Affiche le site construit |

## Ajouter du contenu

**Une procédure.** Rédige-la comme d'habitude dans la bibliothèque Proton Drive, puis lance `npm run sync`.
Une procédure est publiée si elle a son PDF à côté du dossier `markdown/`, ou si son titre (ou sa référence) figure dans `procedures-validees.txt`.
Les autres sont listées dans `procedures-a-valider.md`. Le dossier source peut être précisé : `npm run sync -- "D:\autre\chemin"`.

**Un projet complet.** Crée un fichier dans `src/content/projets/` sur le modèle de `orion-consulting-group.md`.
Le champ `depot: "Nthqn/nom-du-depot"` ajoute le bouton GitHub, les langages et la date du dernier commit.

**Un lab.** Ajoute le sujet (topic) `portfolio-lab` au dépôt sur GitHub. La carte et la page sont créées à la publication suivante (au plus tard la nuit suivante).

**Informations personnelles, certifications.** Tout est dans `src/data/site.ts`.

## Publication

Chaque envoi sur la branche `main` publie le site (`.github/workflows/deploy.yml`).
Dans les réglages du dépôt GitHub, rubrique Pages, la source doit être « GitHub Actions ».

## Organisation

```
src/
├── content/procedures/   procédures copiées par npm run sync (ne pas modifier à la main)
├── content/projets/      un fichier Markdown par projet
├── data/site.ts          identité, navigation, certifications
├── pages/                une page par adresse du site
├── components/           éléments réutilisés (en-tête, cartes, listes)
├── layouts/              gabarits de page
└── styles/               styles communs et page de procédure (écran et impression)
public/                   fichiers servis tels quels (polices, CV, DRT, CNAME)
scripts/sync-procedures.mjs
```
