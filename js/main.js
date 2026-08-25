/* =================================================================
   DARK MODE – JavaScript (Site Statique)
   Chargé dans le <head> pour anti-flash
   ================================================================= */

/* ==================== 1. ANTI-FLASH ==================== */
(function () {
    var savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark-mode');
    }
})();

/* ==================== 2. TOGGLE AU CLIC ==================== */
document.addEventListener('click', function (e) {
    var target = e.target.closest('#themeToggle');
    if (target) {
        e.preventDefault();
        e.stopPropagation();

        /* Activer les transitions via la classe CSS */
        document.documentElement.classList.add('animating-theme');

        /* Toggle la classe */
        document.documentElement.classList.toggle('dark-mode');
        var isDark = document.documentElement.classList.contains('dark-mode');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');

        /* Retirer la classe de transition après l'animation */
        setTimeout(function () {
            document.documentElement.classList.remove('animating-theme');
        }, 500);
    }
});

// ===== HEADER INTERACTIONS =====
// Called by includes.js after header HTML is loaded

function initHeader() {
    // Effet scroll sur header
    window.addEventListener('scroll', function () {
        var header = document.getElementById('header');
        if (header) {
            if (window.scrollY > 50) {
                header.classList.add('scrolled');
            } else {
                header.classList.remove('scrolled');
            }
        }
    });

    // Détecte la page active
    var currentPath = window.location.pathname.replace(/\.html$/, '');
    if (currentPath.length > 1 && currentPath.slice(-1) === '/') {
        currentPath = currentPath.slice(0, -1);
    }
    if (currentPath === '/' || currentPath === '/index' || currentPath === '') {
        currentPath = '/';
    }
    var navLinks = document.querySelectorAll('.nav-link');

    navLinks.forEach(function (link) {
        link.classList.remove('active');
        link.removeAttribute('aria-current');
        var linkHref = link.getAttribute('href');
        if (linkHref === currentPath) {
            link.classList.add('active');
            link.setAttribute('aria-current', 'page');
        }
    });

    // Bind burger and overlay click handlers (native <button> keyboard support handles Enter/Space)
    var overlay = document.getElementById('navOverlay');
    var burger = document.getElementById('burgerMenu');

    if (overlay) {
        overlay.addEventListener('click', toggleMenu);
    }

    if (burger) {
        burger.addEventListener('click', toggleMenu);
    }

    // Allow closing the mobile menu with Escape
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            var nav = document.getElementById('headerNav');
            if (nav && nav.classList.contains('active')) {
                toggleMenu();
            }
        }
    });
}

// Toggle menu mobile
function toggleMenu() {
    var burger = document.getElementById('burgerMenu');
    var nav = document.getElementById('headerNav');
    var overlay = document.getElementById('navOverlay');
    if (!burger || !nav || !overlay) return;

    burger.classList.toggle('active');
    nav.classList.toggle('active');
    overlay.classList.toggle('active');

    var isOpen = nav.classList.contains('active');
    var openLabel = 'Ouvrir le menu mobile';
    var closeLabel = 'Fermer le menu mobile';
    burger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    burger.setAttribute('aria-label', isOpen ? closeLabel : openLabel);
    overlay.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    overlay.setAttribute('tabindex', isOpen ? '0' : '-1');
    document.body.style.overflow = isOpen ? 'hidden' : '';
}

// ===== COOKIE CONSENT MANAGER =====
// Handles RGPD cookie consent for Google reCAPTCHA.
// If cookies are refused, reCAPTCHA is blocked and a honeypot + timer protect the form.

(function () {
    'use strict';

    var CONSENT_KEY = 'cookie-consent';
    var CONSENT_MAX_AGE_MS = 395 * 24 * 60 * 60 * 1000; // 13 mois (~395 jours) — durée max CNIL
    var _focusTrap = null;

    // ---------- Consent state ----------

    function getConsent() {
        try {
            var raw = localStorage.getItem(CONSENT_KEY);
            if (!raw) return null;
            var data = JSON.parse(raw);
            // Vérifie l'expiration (13 mois max CNIL)
            if (Date.now() - data.timestamp > CONSENT_MAX_AGE_MS) {
                localStorage.removeItem(CONSENT_KEY);
                return null;
            }
            return data.value;
        } catch (e) {
            return null;
        }
    }

    function setConsent(value) {
        try {
            localStorage.setItem(CONSENT_KEY, JSON.stringify({
                value: value,
                timestamp: Date.now()
            }));
        } catch (e) { /* silent */ }
    }

    // ---------- Banner ----------

    function showBanner() {
        var banner = document.getElementById('cookie-banner');
        if (!banner) return;
        banner.setAttribute('aria-hidden', 'false');
        // Make focusable elements tabbable
        banner.querySelectorAll('button, a').forEach(function (el) { el.removeAttribute('tabindex'); });
        // Set up focus trap
        _focusTrap = function (e) {
            if (e.key !== 'Tab') return;
            var els = Array.from(banner.querySelectorAll('button:not([tabindex="-1"]), a:not([tabindex="-1"])'));
            if (!els.length) return;
            var first = els[0];
            var last = els[els.length - 1];
            if (e.shiftKey) {
                if (document.activeElement === first) { e.preventDefault(); last.focus(); }
            } else {
                if (document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        };
        document.addEventListener('keydown', _focusTrap);
        // Small delay to trigger CSS transition, then move focus into banner
        requestAnimationFrame(function () {
            banner.classList.add('visible');
            var firstEl = banner.querySelector('button:not([tabindex="-1"]), a:not([tabindex="-1"])');
            if (firstEl) firstEl.focus();
        });
    }

    function hideBanner() {
        var banner = document.getElementById('cookie-banner');
        if (!banner) return;
        // Remove focus trap
        if (_focusTrap) {
            document.removeEventListener('keydown', _focusTrap);
            _focusTrap = null;
        }
        banner.classList.remove('visible');
        banner.setAttribute('aria-hidden', 'true');
        // Remove focusable elements from tab order
        banner.querySelectorAll('button, a').forEach(function (el) { el.setAttribute('tabindex', '-1'); });
    }

    function initBannerButtons() {
        var acceptBtn = document.getElementById('cookie-accept');
        var refuseBtn = document.getElementById('cookie-refuse');

        if (acceptBtn) {
            acceptBtn.addEventListener('click', function () {
                setConsent('accepted');
                hideBanner();
                onConsentAccepted();
            });
        }

        if (refuseBtn) {
            refuseBtn.addEventListener('click', function () {
                setConsent('refused');
                hideBanner();
                onConsentRefused();
            });
        }
    }

    // ---------- reCAPTCHA management ----------

    function loadRecaptcha() {
        // Only load if not already loaded
        if (window.grecaptcha) return;
        var script = document.createElement('script');
        script.src = 'https://www.google.com/recaptcha/api.js';
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
    }

    function onConsentAccepted() {
        // Load reCAPTCHA if we're on the contact page
        var recaptchaContainer = document.querySelector('.recaptcha-container');
        if (recaptchaContainer) {
            recaptchaContainer.style.display = '';
            loadRecaptcha();
        }
        // Remove blocked message if present
        var blockedMsg = document.querySelector('.recaptcha-blocked-msg');
        if (blockedMsg) {
            blockedMsg.remove();
        }
    }

    function onConsentRefused() {
        var recaptchaContainer = document.querySelector('.recaptcha-container');
        if (recaptchaContainer) {
            recaptchaContainer.style.display = 'none';

            // Show blocked message (only if not already shown)
            if (!document.querySelector('.recaptcha-blocked-msg')) {
                var msg = document.createElement('div');
                msg.className = 'recaptcha-blocked-msg';
                var disabledText = 'Le captcha Google est désactivé car vous avez refusé les cookies.';
                var protectedText = 'Le formulaire reste protégé.';
                var changeChoiceText = 'Modifier mon choix';
                msg.innerHTML =
                    '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>' +
                    '<span>' + disabledText + ' ' +
                    protectedText + ' ' +
                    '<button type="button" class="js-cookie-reopen">' + changeChoiceText + '</button></span>';
                recaptchaContainer.parentNode.insertBefore(msg, recaptchaContainer.nextSibling);
                var cookieLink = msg.querySelector('.js-cookie-reopen');
                if (cookieLink) {
                    cookieLink.addEventListener('click', function (e) {
                        e.preventDefault();
                        window.cookieConsent.reopen();
                    });
                }
            }
        }
    }

    // ---------- Honeypot anti-bot ----------

    function initHoneypot() {
        var forms = document.querySelectorAll('form[action*="formspree"]');
        forms.forEach(function (form) {
            // Add Formspree _gotcha honeypot (bots fill it, Formspree blocks them server-side)
            if (!form.querySelector('input[name="_gotcha"]')) {
                var honeypot = document.createElement('input');
                honeypot.type = 'text';
                honeypot.name = '_gotcha';
                honeypot.tabIndex = -1;
                honeypot.autocomplete = 'off';
                honeypot.className = 'honeypot-field';
                honeypot.setAttribute('aria-hidden', 'true');
                form.appendChild(honeypot);
            }

        });
    }

    // ---------- Reopen banner ----------

    function reopenBanner() {
        try {
            localStorage.removeItem(CONSENT_KEY);
        } catch (e) { /* silent */ }

        // Restore reCAPTCHA container visibility
        var recaptchaContainer = document.querySelector('.recaptcha-container');
        if (recaptchaContainer) {
            recaptchaContainer.style.display = '';
        }
        // Remove blocked message
        var blockedMsg = document.querySelector('.recaptcha-blocked-msg');
        if (blockedMsg) {
            blockedMsg.remove();
        }

        showBanner();
    }

    // ---------- Initialization ----------

    function init() {
        initBannerButtons();
        initHoneypot();

        var consent = getConsent();
        if (!consent) {
            showBanner();
        } else if (consent === 'accepted') {
            onConsentAccepted();
        } else if (consent === 'refused') {
            onConsentRefused();
        }
    }

    // Expose reopen function globally
    window.cookieConsent = { reopen: reopenBanner };

    // Initialize when cookie banner is loaded
    // (called by includes.js after loading cookie-banner.html)
    window.initCookieConsent = init;
})();

// ===== SCROLL ANIMATIONS + BACK TO TOP BUTTON =====
// Adds reveal-on-scroll animations to elements and a floating back-to-top button.

(function () {
    'use strict';

    // ---------- Scroll Reveal Animations ----------

    function initScrollAnimations() {
        // Select all elements that should animate on scroll
        var selectors = [
            '.competence-card',
            '.stat-card',
            '.qualite-card',
            '.certification-card',
            '.mission-card',
            '.entreprise-card',
            '.form-card',
            '.hero-content',
            '.hero-image',
            '.section-title',
            '.subsection-title',
            '.proc-tabs-container'
        ];

        var elements = document.querySelectorAll(selectors.join(','));
        var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // Respect reduced-motion strictly: no stagger delays, no observer, immediate reveal
        if (prefersReducedMotion) {
            elements.forEach(function (el) {
                el.classList.remove('scroll-reveal');
                el.classList.add('scroll-revealed');
                el.style.removeProperty('transition-delay');
            });
            return;
        }

        elements.forEach(function (el, index) {
            // Don't re-apply if already animated
            if (el.classList.contains('scroll-reveal')) return;
            el.classList.add('scroll-reveal');
            // Stagger delay for siblings (max 200ms)
            var delay = (index % 5) * 0.08;
            el.style.transitionDelay = delay + 's';
        });

        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('scroll-revealed');
                    observer.unobserve(entry.target); // Only animate once
                }
            });
        }, {
            threshold: 0.08,
            rootMargin: '0px 0px -40px 0px'
        });

        elements.forEach(function (el) {
            observer.observe(el);
        });
    }

    // ---------- Back to Top Button ----------

    function createBackToTopButton() {
        var btn = document.createElement('button');
        btn.id = 'back-to-top';
        btn.className = 'back-to-top';
        var backToTopLabel = 'Retour en haut de la page';
        btn.setAttribute('aria-label', backToTopLabel);
        btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>';
        document.body.appendChild(btn);

        btn.addEventListener('click', function () {
            var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
        });

        // Show/hide on scroll
        var lastScrollY = 0;
        var ticking = false;

        function updateButton() {
            if (window.scrollY > 400) {
                btn.classList.add('visible');
            } else {
                btn.classList.remove('visible');
            }
            ticking = false;
        }

        window.addEventListener('scroll', function () {
            lastScrollY = window.scrollY;
            if (!ticking) {
                requestAnimationFrame(updateButton);
                ticking = true;
            }
        }, { passive: true });
    }

    // ---------- Init ----------

    // Wait for DOM content (including dynamically loaded elements)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            // Small delay to let dynamic content load
            setTimeout(function () {
                initScrollAnimations();
                createBackToTopButton();
            }, 300);
        });
    } else {
        setTimeout(function () {
            initScrollAnimations();
            createBackToTopButton();
        }, 300);
    }
})();

// ===== ACCORDION =====
// Handles .bloc-accordion expand/collapse on parcours.html via event delegation.

function initAccordions() {
    var container = document.querySelector('.blocs-container');
    if (!container) return;

    function toggleAccordionItem(header) {
        var accordion = header.parentElement;
        var isOpen = accordion.classList.contains('open');
        document.querySelectorAll('.bloc-accordion').forEach(function (acc) {
            acc.classList.remove('open');
        });
        document.querySelectorAll('.bloc-header').forEach(function (h) {
            h.setAttribute('aria-expanded', 'false');
        });
        if (!isOpen) {
            accordion.classList.add('open');
            header.setAttribute('aria-expanded', 'true');
        }
    }

    container.addEventListener('click', function (e) {
        var header = e.target.closest('.bloc-header');
        if (header) toggleAccordionItem(header);
    });

}



// ===== COUNTER ANIMATION =====
// Animates .counter elements on scroll. Moved from inline <script> in index.html.

function initCounters() {
    var statsGrid = document.querySelector('.stats-grid');
    if (!statsGrid) return;

    var animated = false;

    function animateCounters() {
        document.querySelectorAll('.counter').forEach(function (counter) {
            var target = +counter.getAttribute('data-target');
            var step = target / (2000 / 16);
            var current = 0;
            function tick() {
                current += step;
                if (current < target) {
                    counter.textContent = Math.floor(current);
                    requestAnimationFrame(tick);
                } else {
                    counter.textContent = target;
                }
            }
            tick();
        });
    }

    new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (entry.isIntersecting && !animated) {
                animated = true;
                animateCounters();
            }
        });
    }, { threshold: 0.5 }).observe(statsGrid);
}

// ===== CONTACT FORM =====
// Handles form AJAX submit + toast notifications. Moved from inline <script> in contact.html.

function initContactForm() {
    var form = document.querySelector('form[action*="formspree"]');
    if (!form) return;

    var formLoadTime = Date.now();

    function showToast(message, type) {
        var existing = document.querySelector('.form-toast');
        if (existing) existing.remove();
        var toast = document.createElement('div');
        toast.className = 'form-toast ' + type;
        var icons = {
            success: '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
            error: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>',
            warning: '<svg viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>'
        };
        toast.innerHTML = (icons[type] || '') + '<span>' + message + '</span>';
        document.body.appendChild(toast);
        requestAnimationFrame(function () { toast.classList.add('visible'); });
        setTimeout(function () {
            toast.classList.remove('visible');
            setTimeout(function () { toast.remove(); }, 400);
        }, 5000);
    }

    form.addEventListener('submit', function (e) {
        e.preventDefault();

        if ((Date.now() - formLoadTime) < 3000) {
            showToast('Veuillez patienter quelques secondes avant d\'envoyer.', 'warning');
            return;
        }

        var consent = null;
        try { var raw = localStorage.getItem('cookie-consent'); if (raw) consent = JSON.parse(raw).value; } catch (ex) { }

        if (consent === 'accepted') {
            if (!window.grecaptcha || typeof window.grecaptcha.getResponse !== 'function') {
                showToast('Le captcha est en cours de chargement. Merci de patienter.', 'warning');
                return;
            }
            if (window.grecaptcha.getResponse().length === 0) {
                showToast('Veuillez valider le captcha avant d\'envoyer.', 'warning');
                return;
            }
        }

        var submitBtn = form.querySelector('.form-submit');
        if (submitBtn) submitBtn.classList.add('sending');

        var formData = new FormData(form);
        if (String(formData.get('_gotcha') || '').trim() !== '') return;

        fetch(form.action, { method: 'POST', body: formData, headers: { 'Accept': 'application/json' } })
            .then(function (response) {
                if (submitBtn) submitBtn.classList.remove('sending');
                if (response.ok) {
                    showToast('Message envoyé avec succès !', 'success');
                    form.reset();
                    if (window.grecaptcha) window.grecaptcha.reset();
                } else {
                    showToast('Erreur lors de l\'envoi. Réessayez.', 'error');
                }
            })
            .catch(function () {
                if (submitBtn) submitBtn.classList.remove('sending');
                showToast('Erreur réseau. Vérifiez votre connexion.', 'error');
            });
    });
}

// ===== HERO DROPDOWN (bouton "Mes réalisations") =====
function initHeroDropdown() {
    var dropdown = document.getElementById('realisationsDropdown');
    var toggle = document.getElementById('realisationsDropdownToggle');
    if (!dropdown || !toggle) return;

    function closeDropdown() {
        dropdown.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
    }

    function openDropdown() {
        dropdown.classList.add('open');
        toggle.setAttribute('aria-expanded', 'true');
    }

    toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        if (dropdown.classList.contains('open')) {
            closeDropdown();
        } else {
            openDropdown();
        }
    });

    document.addEventListener('click', function (e) {
        if (dropdown.classList.contains('open') && !dropdown.contains(e.target)) {
            closeDropdown();
        }
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && dropdown.classList.contains('open')) {
            closeDropdown();
            toggle.focus();
        }
    });
}

// ===== REALISATIONS PAGE =====
function initRealisations() {
    var hasProcedures = Boolean(document.querySelector('#proceduresContainer'));
    var hasProjects = Boolean(document.querySelector('.projet-card[data-project-status]'));
    if (!hasProcedures && !hasProjects) return;

    if (hasProcedures) {
        // --- Procédures ---
        var tabOrder = Array.from(document.querySelectorAll('.proc-tab-btn'))
            .map(function (btn) { return btn.dataset.tab; })
            .filter(function (tab) { return Boolean(tab); });

        var procedures = {};
        tabOrder.forEach(function (tab) {
            procedures[tab] = [];
        });

        var currentTab = tabOrder[0] || 'cisco';
        var searchActive = false;
        var defaultIcon = 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm0 2.5L18.5 9H14V4.5z';
        var iconPaths = {
            file: defaultIcon,
            security: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z',
            network: 'M4 5h16v3H4V5zm0 5h16v3H4v-3zm0 5h10v3H4v-3zm12 0h4v3h-4v-3z',
            storage: 'M12 3C7.58 3 4 4.79 4 7v10c0 2.21 3.58 4 8 4s8-1.79 8-4V7c0-2.21-3.58-4-8-4zm0 2c3.31 0 6 .9 6 2s-2.69 2-6 2-6-.9-6-2 2.69-2 6-2zm0 14c-3.31 0-6-.9-6-2v-2c1.3 1 3.44 1.5 6 1.5s4.7-.5 6-1.5v2c0 1.1-2.69 2-6 2zm0-5c-3.31 0-6-.9-6-2v-2c1.3 1 3.44 1.5 6 1.5s4.7-.5 6-1.5v2c0 1.1-2.69 2-6 2z',
            cloud: 'M19.35 10.04A7.49 7.49 0 0 0 5 8a5 5 0 0 0 0 10h13a4 4 0 0 0 1.35-7.96z',
            identity: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
            system: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zm0 2v12h16V6H4zm2 9l-2-2 2-2 1.4 1.4L6.8 13l.6.6L6 15zm3 0h6v-2H9v2z',
            deploy: 'M12 2l4 7h-3v4h-2V9H8l4-7zm-7 13h14v2H5v-2zm0 4h14v2H5v-2z',
            config: 'M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
            monitor: 'M3 3h2v18H3V3zm16 8h2v10h-2V11zM7 13h2v8H7v-8zm4-6h2v14h-2V7zm4-4h2v18h-2V3z',
            key: 'M7 14a5 5 0 1 1 4.9 6H10l-1 1H7v-2H5v-2h2.2l1-1h1.7A5 5 0 0 1 7 14zm5-3a3 3 0 1 0 .001 6.001A3 3 0 0 0 12 11z',
            lock: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2 0-.73.4-1.37 1-1.72V11h2v2.28c.6.35 1 .99 1 1.72 0 1.1-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z',
            sync: 'M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8c-.45-.83-.7-1.79-.7-2.8 0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z',
            budget: 'M12 1C5.92 1 1 5.92 1 12s4.92 11 11 11 11-4.92 11-11S18.08 1 12 1zm1 17.93V20h-2v-1.08c-1.72-.36-3-1.9-3-3.72h2c0 .98.8 1.8 1.8 1.8h.4c1 0 1.8-.82 1.8-1.8s-.8-1.8-1.8-1.8h-.4a3.8 3.8 0 0 1 0-7.6H13V4h-2v1.07C9.28 5.43 8 6.96 8 8.79h2c0-.98.8-1.79 1.8-1.79h.4c1 0 1.8.81 1.8 1.79s-.8 1.8-1.8 1.8h-.4a3.8 3.8 0 1 0 0 7.6H13z',
            policy: 'M3 5v14h18V5H3zm8 12H5v-2h6v2zm8-4H5v-2h14v2zm0-4H5V7h14v2z',
            tags: 'M20 10V4H4v6l8 8 8-8zm-8 5.17L6.83 10H18L12 15.17z'
        };
        var categoryIconFallback = {
            cisco: 'network',
            windows: 'system',
            linux: 'system',
            azure: 'cloud'
        };
        var iconKeywordRules = [
            { icon: 'security', regex: /\b(securite|security|acl|nsg|mfa|firewall|hardening|policy|policies|zero trust)\b/ },
            { icon: 'identity', regex: /\b(entra|identity|identit|utilisateur|users?|roles?|active directory|controleur de domaine|gpo)\b/ },
            { icon: 'network', regex: /\b(reseau|network|routage|routing|vlan|vnet|peering|dns|dhcp|nat|ospf|eigrp|proxy)\b/ },
            { icon: 'storage', regex: /\b(stockage|storage|files?|fichiers?|samba|azcopy|sas|volume|raid|ntfs|backup)\b/ },
            { icon: 'monitor', regex: /\b(zabbix|monitor|supervision|observabilite)\b/ },
            { icon: 'deploy', regex: /\b(installation|installer|deploiement|deploy|wds|docker|portainer|mise en place)\b/ },
            { icon: 'config', regex: /\b(configuration|config|cfg)\b/ }
        ];
        var azureIconRules = [
            { icon: 'key', regex: /\b(key vault|vault|secret|secrets)\b/ },
            { icon: 'budget', regex: /\b(budget|budgets|cout|cost|billing|alerte|alertes|alerts)\b/ },
            { icon: 'lock', regex: /\b(conditional access|mfa|secure|security|securite|lock|locks|verrou|verrous)\b/ },
            { icon: 'identity', regex: /\b(idm|entra|identity|identit|managed identities|users?|utilisateurs?|roles?)\b/ },
            { icon: 'network', regex: /\b(net|network|reseau|vnet|peering|nsg|dns|dhcp)\b/ },
            { icon: 'storage', regex: /\b(sto|storage|stockage|files?|file sync|azcopy|sas|tiers?|lifecycle|versioning|soft delete|access keys?)\b/ },
            { icon: 'sync', regex: /\b(sync|replication|replica|montage|transfert)\b/ },
            { icon: 'policy', regex: /\b(policy|policies|management group|resource group|groupe de ressources|cfg|configuration)\b/ },
            { icon: 'tags', regex: /\b(tag|tags)\b/ }
        ];

        function normalizeSearchText(value) {
            return String(value || '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]+/g, ' ')
                .trim();
        }

        function selectIconPath(doc) {
            var searchable = normalizeSearchText([
                doc && doc.title,
                doc && doc.file_name,
                doc && doc.relative_path,
                doc && doc.category
            ].join(' '));

            if (doc && doc.category === 'azure') {
                for (var j = 0; j < azureIconRules.length; j++) {
                    if (azureIconRules[j].regex.test(searchable)) {
                        return iconPaths[azureIconRules[j].icon] || iconPaths.cloud;
                    }
                }
            }

            for (var i = 0; i < iconKeywordRules.length; i++) {
                if (iconKeywordRules[i].regex.test(searchable)) {
                    return iconPaths[iconKeywordRules[i].icon] || defaultIcon;
                }
            }

            var fallbackKey = categoryIconFallback[doc && doc.category] || 'file';
            return iconPaths[fallbackKey] || defaultIcon;
        }

        function updateTabCounts() {
            tabOrder.forEach(function (category) {
                var countEl = document.getElementById('count-' + category);
                if (countEl) countEl.textContent = String((procedures[category] || []).length);
            });
        }

        function buildProcedureFromDoc(doc) {
            if (!doc || !doc.url) return null;
            return {
                title: doc.title || (doc.file_name ? doc.file_name.replace(/\.pdf$/i, '') : 'Document PDF'),
                url: doc.url,
                icon: selectIconPath(doc)
            };
        }

        function loadProceduresFromManifest() {
            var manifestUrl = '/assets/data/docs.json';
            var requestUrl = manifestUrl + '?v=' + encodeURIComponent(String(Date.now()));
            return fetch(requestUrl, { cache: 'no-store' })
                .then(function (response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + requestUrl);
                    return response.json();
                })
                .then(function (data) {
                    var nextProcedures = {};
                    tabOrder.forEach(function (category) {
                        nextProcedures[category] = [];
                    });

                    var documents = data && Array.isArray(data.documents) ? data.documents : [];
                    documents.forEach(function (doc) {
                        if (!doc || !Object.prototype.hasOwnProperty.call(nextProcedures, doc.category)) return;
                        var proc = buildProcedureFromDoc(doc);
                        if (proc) nextProcedures[doc.category].push(proc);
                    });

                    tabOrder.forEach(function (category) {
                        nextProcedures[category].sort(function (a, b) {
                            return a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' });
                        });
                    });

                    procedures = nextProcedures;
                    updateTabCounts();
                    renderAllContent();

                    var searchInput = document.getElementById('searchInput');
                    if (searchInput && searchInput.value.trim() !== '') {
                        searchProcedures();
                    } else {
                        setTabState(currentTab);
                    }
                })
                .catch(function (error) {
                    console.error('Procedures manifest load failed:', error);
                    tabOrder.forEach(function (category) {
                        procedures[category] = [];
                    });
                    updateTabCounts();
                    renderAllContent();
                    setTabState(currentTab);
                });
        }

        function createCard(proc, category) {
            var iconPath = (proc.icon && proc.icon.trim()) ? proc.icon : defaultIcon;
            var resolvedUrl = encodeURI(proc.url.normalize('NFD'));
            return '<article class="proc-card ' + category + '" data-title="' + proc.title.toLowerCase() + '">' +
                '<div class="proc-icon"><svg viewBox="0 0 24 24"><path d="' + iconPath + '" /></svg></div>' +
                '<h3 class="proc-card-title">' + proc.title + '</h3>' +
                '<a href="' + resolvedUrl + '" target="_blank" rel="noopener noreferrer" class="proc-btn" aria-label="Ouvrir la procédure : ' + proc.title + '">' +
                'Voir<svg viewBox="0 0 24 24"><path d="M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z" /></svg>' +
                '</a></article>';
        }

        function renderAllContent() {
            var container = document.getElementById('proceduresContainer');
            if (!container) return;

            if (tabOrder.length === 0) {
                container.innerHTML = '';
                return;
            }

            var html = '';
            tabOrder.forEach(function (category) {
                var procs = procedures[category] || [];
                var isActive = category === currentTab;
                html += '<div class="proc-tab-content ' + (isActive ? 'active' : '') + '" id="tab-' + category + '" role="tabpanel" aria-labelledby="proc-tab-' + category + '" tabindex="' + (isActive ? '0' : '-1') + '"' + (isActive ? '' : ' hidden') + '>' +
                    '<div class="proc-grid">' + procs.map(function (proc) { return createCard(proc, category); }).join('') + '</div></div>';
            });
            container.innerHTML = html;
        }

        function setTabState(tabName) {
            document.querySelectorAll('.proc-tab-btn').forEach(function (btn) {
                var isActive = btn.dataset.tab === tabName;
                btn.classList.toggle('active', isActive);
                btn.setAttribute('aria-selected', String(isActive));
                btn.setAttribute('tabindex', isActive ? '0' : '-1');
            });
            document.querySelectorAll('.proc-tab-content').forEach(function (panel) {
                var isActive = panel.id === 'tab-' + tabName;
                panel.classList.toggle('active', isActive);
                panel.hidden = !isActive;
                panel.setAttribute('tabindex', isActive ? '0' : '-1');
            });
        }

        function switchTab(tabName, shouldFocus) {
            if (searchActive) {
                var si = document.getElementById('searchInput');
                if (si) si.value = '';
                searchProcedures();
            }
            var activeButton = document.querySelector('.proc-tab-btn[data-tab="' + tabName + '"]');
            if (!activeButton) return;
            currentTab = tabName;
            setTabState(tabName);
            if (shouldFocus) activeButton.focus();
        }

        function searchProcedures() {
            var searchInput = document.getElementById('searchInput');
            var noResults = document.getElementById('noResults');
            var searchResults = document.getElementById('searchResults');
            var container = document.getElementById('proceduresContainer');
            if (!searchInput || !noResults || !searchResults || !container) return;

            var searchTerm = searchInput.value.toLowerCase().trim();
            if (searchTerm === '') {
                searchActive = false;
                renderAllContent();
                setTabState(currentTab);
                noResults.style.display = 'none';
                searchResults.textContent = '';
                return;
            }
            searchActive = true;
            var matchingProcs = [];
            tabOrder.forEach(function (category) {
                (procedures[category] || []).forEach(function (proc) {
                    if (proc.title.toLowerCase().includes(searchTerm)) {
                        matchingProcs.push(Object.assign({}, proc, { category: category }));
                    }
                });
            });
            if (matchingProcs.length === 0) {
                noResults.style.display = 'block';
                searchResults.textContent = '';
                container.innerHTML = '';
            } else {
                noResults.style.display = 'none';
                searchResults.textContent = matchingProcs.length + ' procédure' + (matchingProcs.length > 1 ? 's' : '') + ' trouvée' + (matchingProcs.length > 1 ? 's' : '');
                container.innerHTML = '<div class="proc-tab-content active" id="tab-search" role="region" aria-label="Résultats de recherche de procédures"><div class="proc-grid">' +
                    matchingProcs.map(function (proc) { return createCard(proc, proc.category); }).join('') + '</div></div>';
            }
        }

        function initProcTabsAccessibility() {
            var tabsNav = document.querySelector('.proc-tabs-nav');
            if (!tabsNav) return;
            tabsNav.addEventListener('keydown', function (event) {
                var keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
                if (!keys.includes(event.key)) return;
                var tabs = Array.from(tabsNav.querySelectorAll('.proc-tab-btn'));
                var currentIndex = tabs.findIndex(function (tab) { return tab.dataset.tab === currentTab; });
                if (currentIndex === -1) return;
                var nextIndex = currentIndex;
                if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
                if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
                if (event.key === 'Home') nextIndex = 0;
                if (event.key === 'End') nextIndex = tabs.length - 1;
                event.preventDefault();
                switchTab(tabs[nextIndex].dataset.tab, true);
            });
        }

        document.querySelectorAll('.proc-tab-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                switchTab(this.dataset.tab);
            });
        });

        var searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.addEventListener('input', searchProcedures);

        updateTabCounts();
        renderAllContent();
        setTabState(currentTab);
        initProcTabsAccessibility();
        loadProceduresFromManifest();
    }

    // --- Projet cards interactions ---
    var projectCards = Array.from(document.querySelectorAll('.projet-card[data-project-status]'));
    var projectFilterButtons = Array.from(document.querySelectorAll('.projet-filter-btn[data-project-filter]'));
    var projectCount = document.querySelector('[data-project-count]');

    function updateProjectCount(visibleCount) {
        if (!projectCount) return;
        var label = visibleCount > 1 ? 'projets visibles' : 'projet visible';
        projectCount.textContent = visibleCount + ' ' + label;
    }

    function setProjectFilter(filterName) {
        var visibleCount = 0;
        projectCards.forEach(function (card) {
            var matches = filterName === 'all' || card.dataset.projectStatus === filterName;
            card.hidden = !matches;
            if (matches) visibleCount++;
        });

        projectFilterButtons.forEach(function (btn) {
            var isActive = btn.dataset.projectFilter === filterName;
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-pressed', String(isActive));
        });

        updateProjectCount(visibleCount);
    }

    if (projectCards.length) {
        projectCards.forEach(function (card) {
            var toggleBtn = card.querySelector('[data-projet-toggle]');
            var toggleLabel = toggleBtn ? toggleBtn.querySelector('[data-toggle-label]') : null;

            function setCollapsed(collapsed) {
                card.classList.toggle('is-collapsed', collapsed);
                if (toggleBtn) {
                    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
                    if (toggleLabel) toggleLabel.textContent = collapsed ? 'D\u00e9tails' : 'R\u00e9duire';
                }
            }

            if (toggleBtn) {
                toggleBtn.addEventListener('click', function () {
                    var nextCollapsed = !card.classList.contains('is-collapsed');
                    setCollapsed(nextCollapsed);
                });
            }

            if (card.dataset.projectStatus === 'in-progress') {
                setCollapsed(true);
            }
        });
    }

    if (projectFilterButtons.length && projectCards.length) {
        projectFilterButtons.forEach(function (btn) {
            btn.addEventListener('click', function () {
                setProjectFilter(btn.dataset.projectFilter || 'all');
            });
        });
        var defaultProjectFilter = projectFilterButtons.find(function (btn) {
            return btn.classList.contains('is-active');
        }) || projectFilterButtons[0];
        setProjectFilter(defaultProjectFilter ? defaultProjectFilter.dataset.projectFilter : 'all');
    } else if (projectCards.length) {
        updateProjectCount(projectCards.length);
    }

    // --- Projet architecture inspector ---
    var archInspector = document.getElementById('archInspector');
    var archNodes = Array.from(document.querySelectorAll('.arch-interactive[data-arch-node]'));
    if (archInspector && archNodes.length) {
        var archData = {
            gateway: {
                title: 'Upstream Gateway',
                role: 'Passerelle amont',
                text: 'Point de sortie vers Internet pour les deux sites. Le routage inter-sites passe ensuite par ORION/LYRA via IPsec.',
                services: ['Accès WAN', 'Routage amont', 'Transit Internet'],
                links: [
                    { label: 'DRT - Topologie globale', url: 'assets/docs/DRT-%20ORION%20Consulting%20Group.pdf#page=7' }
                ]
            },
            orion: {
                title: 'ORION',
                role: 'Pare-feu principal (Site 1)',
                text: 'Pare-feu pfSense du site principal: segmentation VLAN, règles inter-zones et terminaison du tunnel IPsec.',
                services: ['pfSense', 'Règles VLAN/DMZ', 'NAT', 'VPN IPsec'],
                links: [
                    { label: 'DRT - Tunnel IPsec', url: 'assets/docs/DRT-%20ORION%20Consulting%20Group.pdf#page=16' },
                    { label: 'DRT - Règles pare-feu ORION', url: 'assets/docs/DRT-%20ORION%20Consulting%20Group.pdf#page=32' },
                    { label: 'Procédures réseau', url: '/procedures' }
                ]
            },
            lyra: {
                title: 'LYRA',
                role: 'Pare-feu secondaire (Site 2)',
                text: 'Pare-feu pfSense du site distant, interconnecté à ORION avec un tunnel IPsec site-à-site.',
                services: ['pfSense', 'Filtrage LAN site 2', 'VPN IPsec'],
                links: [
                    { label: 'DRT - Côté LYRA (IPsec)', url: 'assets/docs/DRT-%20ORION%20Consulting%20Group.pdf#page=16' },
                    { label: 'DRT - Règles pare-feu LYRA', url: 'assets/docs/DRT-%20ORION%20Consulting%20Group.pdf#page=36' },
                    { label: 'Procédures réseau', url: '/procedures' }
                ]
            },
            meissa: {
                title: 'MEISSA',
                role: 'Serveur DMZ',
                text: 'Serveur Ubuntu exposé en DMZ pour l’hébergement du site vitrine, isolé du réseau interne.',
                services: ['Nginx', 'DMZ', 'Publication web'],
                links: [
                    { label: 'DRT - Architecture cible', url: 'assets/docs/DRT-%20ORION%20Consulting%20Group.pdf#page=7' },
                    { label: 'Procédures Linux', url: '/procedures' }
                ]
            },
            rigel: {
                title: 'RIGEL',
                role: 'Contrôleur de domaine principal',
                text: 'Serveur Windows principal du SI: AD DS/DNS et services de fichiers avec réplication vers VEGA.',
                services: ['AD DS', 'DNS', 'Fichiers', 'DFS-R'],
                links: [
                    { label: 'DRT - Déploiement RIGEL', url: 'assets/docs/DRT-%20ORION%20Consulting%20Group.pdf#page=19' },
                    { label: 'DRT - Annuaire Active Directory', url: 'assets/docs/DRT-%20ORION%20Consulting%20Group.pdf#page=18' },
                    { label: 'Procédures Windows', url: '/procedures' }
                ]
            },
            vega: {
                title: 'VEGA',
                role: 'Contrôleur de domaine secondaire',
                text: 'Serveur Windows répliqué sur le site distant pour assurer la continuité AD/DNS en cas d’incident site 1.',
                services: ['AD DS (secondaire)', 'DNS', 'Réplication AD', 'Continuité d’activité'],
                links: [
                    { label: 'DRT - Déploiement VEGA', url: 'assets/docs/DRT-%20ORION%20Consulting%20Group.pdf#page=22' },
                    { label: 'DRT - Résilience annuaire', url: 'assets/docs/DRT-%20ORION%20Consulting%20Group.pdf#page=6' },
                    { label: 'Procédures Windows', url: '/procedures' }
                ]
            },
            bellatrix: {
                title: 'BELLATRIX',
                role: 'Gestion de parc',
                text: 'Serveur Ubuntu dédié à GLPI pour l’inventaire, le support et l’administration centralisée du parc.',
                services: ['GLPI', 'Portail d’admin', 'Inventaire parc', 'LDAPS'],
                links: [
                    { label: 'DRT - GLPI et inventaire', url: 'assets/docs/DRT-%20ORION%20Consulting%20Group.pdf#page=45' },
                    { label: 'Procédures Linux', url: '/procedures' }
                ]
            },
            sulafat: {
                title: 'SULAFAT',
                role: 'Supervision',
                text: 'Serveur Ubuntu de supervision proactive avec Zabbix et agents déployés sur les machines du SI.',
                services: ['Zabbix Server', 'Agents', 'Monitoring', 'Alerting'],
                links: [
                    { label: 'DRT - Supervision Zabbix', url: 'assets/docs/DRT-%20ORION%20Consulting%20Group.pdf#page=44' },
                    { label: 'Procédures Linux', url: '/procedures' }
                ]
            },
            'pc-client-01': {
                title: 'PC-CLIENT-01',
                role: 'Poste utilisateur (Site 1)',
                text: 'Poste du site principal intégré au domaine, consommant les services AD/DNS/fichiers/supervision.',
                services: ['Jointure domaine', 'GPO', 'Agent GLPI/Zabbix'],
                links: [
                    { label: 'DRT - Déploiement agents via GPO', url: 'assets/docs/DRT-%20ORION%20Consulting%20Group.pdf#page=47' },
                    { label: 'Procédures Windows', url: '/procedures' }
                ]
            },
            'pc-client-02': {
                title: 'PC-CLIENT-02',
                role: 'Poste utilisateur (Site 2)',
                text: 'Poste distant interconnecté via IPsec, utilisant les services répliqués et le socle centralisé.',
                services: ['Jointure domaine', 'Accès inter-sites', 'Agent GLPI/Zabbix'],
                links: [
                    { label: 'DRT - Tests inter-sites', url: 'assets/docs/DRT-%20ORION%20Consulting%20Group.pdf#page=17' },
                    { label: 'Procédures Windows', url: '/procedures' }
                ]
            }
        };

        var archTitle = archInspector.querySelector('[data-arch-title]');
        var archRole = archInspector.querySelector('[data-arch-role]');
        var archText = archInspector.querySelector('[data-arch-text]');
        var archServices = archInspector.querySelector('[data-arch-services]');
        var archLinks = archInspector.querySelector('[data-arch-links]');

        function setActiveArchNode(nodeKey) {
            var data = archData[nodeKey] || archData.orion;
            if (!data || !archTitle || !archRole || !archText || !archServices || !archLinks) return;

            archNodes.forEach(function (node) {
                var isCurrent = node.dataset.archNode === nodeKey;
                node.classList.toggle('is-active', isCurrent);
                node.setAttribute('aria-pressed', String(isCurrent));
            });

            archTitle.textContent = data.title;
            archRole.textContent = data.role;
            archText.textContent = data.text;

            archServices.innerHTML = '';
            (data.services || []).forEach(function (service) {
                var li = document.createElement('li');
                li.textContent = service;
                archServices.appendChild(li);
            });

            archLinks.innerHTML = '';
            (data.links || []).forEach(function (linkData) {
                var li = document.createElement('li');
                var link = document.createElement('a');
                link.textContent = linkData.label;
                link.href = linkData.url;
                if (/\.pdf(#|$)/i.test(linkData.url)) {
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                }
                li.appendChild(link);
                archLinks.appendChild(li);
            });
        }

        archNodes.forEach(function (node) {
            node.addEventListener('click', function () {
                setActiveArchNode(node.dataset.archNode);
            });
        });

        var defaultNode = archNodes.find(function (node) {
            return node.dataset.archNode === 'orion';
        }) || archNodes[0];

        if (defaultNode) {
            setActiveArchNode(defaultNode.dataset.archNode);
        }
    }
}

// ===== PAGE-SPECIFIC INITIALIZATIONS =====
document.addEventListener('DOMContentLoaded', function () {
    initAccordions();
    initCounters();
    initContactForm();
    initRealisations();
    initHeroDropdown();
});

// ===== HEADER & FOOTER INCLUDES =====
// Loads shared header and footer HTML into placeholder elements on every page.
// Shows skeleton shimmer placeholders during loading.

(function () {
    'use strict';

    // Skeleton shimmer HTML
    var headerSkeleton =
        '<div class="skeleton-header">' +
        '<div class="skeleton-line skeleton-logo"></div>' +
        '<div class="skeleton-nav">' +
        '<div class="skeleton-line skeleton-link"></div>' +
        '<div class="skeleton-line skeleton-link"></div>' +
        '<div class="skeleton-line skeleton-link"></div>' +
        '<div class="skeleton-line skeleton-link"></div>' +
        '</div>' +
        '</div>';

    var footerSkeleton =
        '<div class="skeleton-footer">' +
        '<div class="skeleton-line skeleton-footer-logo"></div>' +
        '<div class="skeleton-line skeleton-footer-line skeleton-footer-line-1"></div>' +
        '<div class="skeleton-line skeleton-footer-line skeleton-footer-line-2"></div>' +
        '</div>';

    function showSkeleton(placeholder, html) {
        if (placeholder) placeholder.innerHTML = html;
    }

    function getIncludeFallbackMarkup(targetEl) {
        if (!targetEl || !targetEl.id) return '';

        if (targetEl.id === 'header-placeholder') {
            return '<div class="include-fallback include-fallback-header" role="alert">Navigation temporairement indisponible. <a href="/" class="include-fallback-link">Retour accueil</a></div>';
        }

        if (targetEl.id === 'footer-placeholder') {
            return '<div class="include-fallback include-fallback-footer" role="status">Le pied de page ne peut pas etre charge.</div>';
        }

        return '';
    }

    function loadInclude(url, targetEl, onLoaded) {
        if (!targetEl) return;

        fetch(url)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status + ' for ' + url);
                }
                return response.text();
            })
            .then(function (html) {
                targetEl.innerHTML = html;
                if (typeof onLoaded === 'function') onLoaded();
            })
            .catch(function (error) {
                var fallbackMarkup = getIncludeFallbackMarkup(targetEl);
                targetEl.innerHTML = fallbackMarkup;
                targetEl.setAttribute('data-include-error', 'true');
                console.error('Include load failed:', error);
            });
    }

    document.addEventListener('DOMContentLoaded', function () {
        var headerEl = document.getElementById('header-placeholder');
        var footerEl = document.getElementById('footer-placeholder');

        // Show skeletons immediately
        showSkeleton(headerEl, headerSkeleton);
        showSkeleton(footerEl, footerSkeleton);

        // Load header
        loadInclude('/includes/header.html', headerEl, function () {
            // After header is loaded, initialize header JS (scroll, burger, active link)
            if (typeof initHeader === 'function') {
                initHeader();
            }

        });

        // Load footer
        loadInclude('/includes/footer.html', footerEl, function () {
            var footerYearEl = document.getElementById('footerYear');
            if (footerYearEl) {
                footerYearEl.textContent = String(new Date().getFullYear());
            }
            // Bind cookie reopen link (replaces inline onclick)
            var cookieReopenLink = document.querySelector('[data-action="cookie-reopen"]');
            if (cookieReopenLink) {
                cookieReopenLink.addEventListener('click', function (e) {
                    e.preventDefault();
                    if (window.cookieConsent) window.cookieConsent.reopen();
                });
            }
        });

        // Load cookie consent banner
        loadInclude('/includes/cookie-banner.html', document.getElementById('cookie-banner-placeholder'), function () {
            // Initialize cookie consent logic
            if (typeof initCookieConsent === 'function') {
                initCookieConsent();
            }
        });
    });
})();
