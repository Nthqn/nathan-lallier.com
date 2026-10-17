// Informations affichées à plusieurs endroits du site. Une seule source à modifier.

export const SITE = {
  nom: 'Nathan LALLIER',
  prenom: 'Nathan',
  famille: 'LALLIER',
  poste: 'Apprenti Ingénieur Cloud',
  url: 'https://nathan-lallier.com',
  email: 'contact@nathan-lallier.com',
  github: 'https://github.com/Nthqn',
  linkedin: 'https://www.linkedin.com/in/nathan-lallier',
  cv: '/assets/docs/CV-Nathan-LALLIER.pdf',
  description:
    "Nathan LALLIER, apprenti ingénieur cloud chez SEMIN et élève ingénieur au CESI. Certifié AZ-104 et CCNA, spécialisé Azure, Entra ID, Intune et sécurité.",
  posteEn: 'Cloud Engineering Apprentice',
  descriptionEn:
    'Nathan LALLIER, cloud engineering apprentice at SEMIN and engineering student at CESI. AZ-104 and CCNA certified, focused on Azure, Entra ID, Intune and security.',
  // Début de l'alternance, utilisé pour calculer les mois d'expérience
  debutExperience: new Date('2024-09-01'),
};

export const NAV = ['parcours', 'projets', 'procedures'] as const;

export const poste = (lang: 'fr' | 'en') => (lang === 'en' ? SITE.posteEn : SITE.poste);
export const description = (lang: 'fr' | 'en') => (lang === 'en' ? SITE.descriptionEn : SITE.description);

// Plateformes du catalogue, dans l'ordre d'affichage des filtres
export const PLATEFORMES: Record<string, { label: string; icon: string }> = {
  azure: { label: 'Azure', icon: 'azure' },
  linux: { label: 'Linux', icon: 'linux' },
  windows: { label: 'Windows', icon: 'windows' },
  cisco: { label: 'Cisco', icon: 'cisco' },
  'pare-feu': { label: 'Pare-feu', icon: 'pare-feu' },
};

// Piliers de la convention de nommage (deuxième code de la référence)
export const PILIERS: Record<string, string> = {
  IDM: 'Identité et accès',
  NET: 'Réseau',
  STO: 'Stockage',
  CPT: 'Calcul et virtualisation',
  SYS: 'Système',
  CNT: 'Conteneurs',
  APP: 'Applications',
  SEC: 'Sécurité',
  MON: 'Supervision',
  BCK: 'Sauvegarde et restauration',
  OPS: 'Exploitation et automatisation',
  IAC: 'Infrastructure as Code',
  MIG: 'Migration',
};

export type Certification = {
  nom: string;
  editeur: string;
  badge: string;
  statut: 'obtenue' | 'en-cours' | 'a-venir';
  annee?: number;
  verification?: string;
};

export const CERTIFICATIONS: Certification[] = [
  { nom: 'Azure Fundamentals', editeur: 'Microsoft', badge: 'az900', statut: 'obtenue', verification: 'https://learn.microsoft.com/api/credentials/share/fr-fr/Nathan-4078/2A91CE2E0E0795?sharingId=8483823718AD9B12' },
  { nom: 'Azure Administrator', editeur: 'Microsoft', badge: 'az104', statut: 'obtenue', verification: 'https://learn.microsoft.com/api/credentials/share/fr-fr/Nathan-4078/535A320DB55E56C3?sharingId=8483823718AD9B12' },
  { nom: 'CCNA 1', editeur: 'Cisco', badge: 'ccna1', statut: 'obtenue', verification: 'https://www.credly.com/badges/e9b05e6d-6cbc-4baf-8f7e-7e6b61f414ce/public_url' },
  { nom: 'CCNA 2', editeur: 'Cisco', badge: 'ccna2', statut: 'obtenue', verification: 'https://www.credly.com/badges/973523ab-f891-4356-bb11-d1bdf6f0b09a/public_url' },
  { nom: 'CCNA 3', editeur: 'Cisco', badge: 'ccna3', statut: 'obtenue', verification: 'https://www.credly.com/badges/dcd296ad-261b-49e4-a0ab-5f6df94d0020/public_url' },
  { nom: 'Azure Solutions Architect Expert', editeur: 'Microsoft', badge: 'az305', statut: 'a-venir', annee: 2027 },
  { nom: 'Azure Security Technologies', editeur: 'Microsoft', badge: 'az500', statut: 'a-venir', annee: 2028 },
  { nom: 'AWS Solutions Architect Associate', editeur: 'Amazon Web Services', badge: 'aws-saa-c03', statut: 'a-venir', annee: 2029 },
];

export function moisExperience(date = new Date()): number {
  const d = SITE.debutExperience;
  return (date.getFullYear() - d.getFullYear()) * 12 + (date.getMonth() - d.getMonth());
}
