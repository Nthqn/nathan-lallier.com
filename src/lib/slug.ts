// Même règle que scripts/sync-procedures.mjs : les liens entre procédures en dépendent
export function slugify(value: string): string {
  return value
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '').replace(/&/g, ' ')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .toLowerCase();
}
