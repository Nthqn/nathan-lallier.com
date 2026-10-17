// Couleurs de langage proches de celles de GitHub
const COLORS: Record<string, string> = {
  PowerShell: '#3d6fb6', Shell: '#89e051', Python: '#3572a5', HCL: '#7b42bc', Bicep: '#519aba',
  JavaScript: '#e8c33c', TypeScript: '#3178c6', Go: '#00add8', Dockerfile: '#384d54', YAML: '#cb171e',
  HTML: '#e34c26', CSS: '#663399', Batchfile: '#c1f12e', 'Jinja': '#a52a22',
};
export const langColor = (lang: string | null) => (lang && COLORS[lang]) || '#c9b48a';

export function relativeDate(iso: string, lang: 'fr' | 'en' = 'fr', now = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (days < 7) return rtf.format(-days, 'day');
  if (days < 30) return rtf.format(-Math.floor(days / 7), 'week');
  if (days < 365) return rtf.format(-Math.floor(days / 30), 'month');
  return rtf.format(-Math.floor(days / 365), 'year');
}
