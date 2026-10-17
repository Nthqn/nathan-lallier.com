import type { ImageMetadata } from 'astro';

// Tous les badges de src/assets/badges, indexés par nom de fichier (az104, ccna1…)
const files = import.meta.glob<{ default: ImageMetadata }>('../assets/badges/*.webp', { eager: true });
export const badges: Record<string, ImageMetadata> = Object.fromEntries(
  Object.entries(files).map(([path, mod]) => [path.split('/').pop()!.replace('.webp', ''), mod.default])
);
