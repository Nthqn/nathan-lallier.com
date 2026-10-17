// Comportements communs à toutes les pages

// Thème clair ou sombre
document.querySelector('.theme-toggle')?.addEventListener('click', () => {
  const dark = document.documentElement.classList.toggle('dark-mode');
  try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch { /* stockage indisponible */ }
});

// Menu mobile
const menuButton = document.querySelector<HTMLButtonElement>('.menu-toggle');
const nav = document.getElementById('site-nav');
menuButton?.addEventListener('click', () => {
  const open = nav?.classList.toggle('is-open') ?? false;
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', (open ? menuButton.dataset.labelFermer : menuButton.dataset.labelOuvrir) ?? '');
});

// Apparition au défilement (le contenu reste visible si l'observateur n'existe pas)
const revealed = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  revealed.forEach((el) => observer.observe(el));
} else {
  revealed.forEach((el) => el.classList.add('is-visible'));
}

// Consentement cookies (Google reCAPTCHA du formulaire de contact), conservé 13 mois au maximum (CNIL)
const CONSENT_KEY = 'cookie-consent';
const CONSENT_MAX_AGE = 395 * 24 * 60 * 60 * 1000;

export function getConsent(): 'accepted' | 'refused' | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.timestamp > CONSENT_MAX_AGE) {
      localStorage.removeItem(CONSENT_KEY);
      return null;
    }
    return data.value;
  } catch {
    return null;
  }
}

const banner = document.getElementById('cookie-banner');
const showBanner = () => { if (banner) banner.hidden = false; };

banner?.querySelectorAll<HTMLButtonElement>('[data-consent]').forEach((button) => {
  button.addEventListener('click', () => {
    const value = button.dataset.consent as 'accepted' | 'refused';
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ value, timestamp: Date.now() })); } catch { /* ignoré */ }
    banner.hidden = true;
    document.dispatchEvent(new CustomEvent('consent-change', { detail: value }));
  });
});

document.querySelector('[data-cookie-reopen]')?.addEventListener('click', showBanner);

// Le bandeau ne s'affiche d'office que sur les pages qui en ont besoin (formulaire de contact)
if (document.querySelector('[data-needs-consent]') && getConsent() === null) showBanner();
