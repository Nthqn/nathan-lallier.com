// Gestion des deux langues du site : le français à la racine, l'anglais sous /en.
// Les procédures n'existent qu'en français, la version anglaise renvoie vers elles.

export type Lang = 'fr' | 'en';
export const LANGS: Lang[] = ['fr', 'en'];

export const ROUTES = {
  accueil: { fr: '/', en: '/en' },
  parcours: { fr: '/parcours', en: '/en/background' },
  projets: { fr: '/projets', en: '/en/projects' },
  procedures: { fr: '/procedures', en: '/procedures' },
  contact: { fr: '/contact', en: '/en/contact' },
  mentions: { fr: '/mentions', en: '/en/legal-notice' },
  politique: { fr: '/politique', en: '/en/privacy' },
  accessibilite: { fr: '/accessibilite', en: '/en/accessibility' },
} as const;

export type RouteKey = keyof typeof ROUTES;

export const route = (key: RouteKey, lang: Lang) => ROUTES[key][lang];
export const projetUrl = (id: string, lang: Lang) => (lang === 'en' ? `/en/projects/${id}` : `/projets/${id}`);
export const labUrl = (id: string, lang: Lang) => (lang === 'en' ? `/en/labs/${id}` : `/labs/${id}`);

export function langFromPath(pathname: string): Lang {
  return /^\/en(\/|\.html$|$)/.test(pathname) ? 'en' : 'fr';
}

const clean = (pathname: string) => pathname.replace(/\.html$/, '').replace(/\/index$/, '').replace(/(.)\/$/, '$1') || '/';

// Adresse équivalente dans chaque langue, ou null si la page n'existe que dans une langue
export function alternates(pathname: string): Record<Lang, string> | null {
  const path = clean(pathname);
  for (const r of Object.values(ROUTES)) {
    if (r.fr === r.en) continue;
    if (path === r.fr || path === r.en) return { fr: r.fr, en: r.en };
  }
  let m = path.match(/^\/(?:projets|en\/projects)\/([^/]+)$/);
  if (m) return { fr: projetUrl(m[1], 'fr'), en: projetUrl(m[1], 'en') };
  m = path.match(/^\/(?:labs|en\/labs)\/([^/]+)$/);
  if (m) return { fr: labUrl(m[1], 'fr'), en: labUrl(m[1], 'en') };
  return null;
}

export const LOCALE: Record<Lang, string> = { fr: 'fr-FR', en: 'en-GB' };

export function formatDate(date: Date | null, lang: Lang): string {
  return date ? date.toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

// Textes de l'interface partagés par plusieurs pages
export const UI = {
  fr: {
    skip: 'Aller au contenu principal',
    navLabel: 'Navigation principale',
    accueilLabel: 'Accueil, Nathan LALLIER',
    nav: { parcours: 'Parcours', projets: 'Projets', procedures: 'Procédures', contact: 'Contact' },
    cvLong: 'Télécharger mon CV',
    cvCourt: 'Mon CV',
    theme: 'Changer de thème',
    menuOuvrir: 'Ouvrir le menu',
    menuFermer: 'Fermer le menu',
    langue: { label: 'Read in English', court: 'EN', autre: 'en' as Lang },
    footerTitre: ['Mes', 'réseaux', '/ me contacter'],
    email: "M'écrire un email",
    legalLabel: 'Informations légales',
    mentions: 'Mentions légales',
    politique: 'Politique de confidentialité',
    accessibilite: 'Accessibilité',
    cookiesGerer: 'Gérer les cookies',
    cookiesTexte: 'Le formulaire de contact utilise <strong>Google reCAPTCHA</strong>, qui peut déposer des cookies tiers.',
    cookiesPlus: 'En savoir plus',
    cookiesLabel: 'Gestion des cookies',
    refuser: 'Refuser',
    accepter: 'Accepter',
    termine: 'Terminé',
    enCours: 'En cours',
    projetComplet: 'Projet complet',
    lire: 'Lire',
    labSansDescription: 'Pas encore de description.',
    filAriane: "Fil d'Ariane",
  },
  en: {
    skip: 'Skip to main content',
    navLabel: 'Main navigation',
    accueilLabel: 'Home, Nathan LALLIER',
    nav: { parcours: 'Background', projets: 'Projects', procedures: 'Procedures', contact: 'Contact' },
    cvLong: 'Download my CV',
    cvCourt: 'My CV',
    theme: 'Toggle theme',
    menuOuvrir: 'Open menu',
    menuFermer: 'Close menu',
    langue: { label: 'Lire en français', court: 'FR', autre: 'fr' as Lang },
    footerTitre: ['Find', 'me', 'online'],
    email: 'Send me an email',
    legalLabel: 'Legal information',
    mentions: 'Legal notice',
    politique: 'Privacy policy',
    accessibilite: 'Accessibility',
    cookiesGerer: 'Manage cookies',
    cookiesTexte: 'The contact form uses <strong>Google reCAPTCHA</strong>, which may set third-party cookies.',
    cookiesPlus: 'Learn more',
    cookiesLabel: 'Cookie settings',
    refuser: 'Decline',
    accepter: 'Accept',
    termine: 'Completed',
    enCours: 'In progress',
    projetComplet: 'Full project',
    lire: 'Read',
    labSansDescription: 'No description yet.',
    filAriane: 'Breadcrumb',
  },
} satisfies Record<Lang, unknown>;

export const ui = (lang: Lang) => UI[lang];
