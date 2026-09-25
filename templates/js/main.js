/* ============================================
   MISA.LOL — Main JavaScript
   Minimal vanilla JS for UI interactions
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
  // ── Mobile Navigation Toggle ──
  const hamburger = document.querySelector('.navbar__hamburger');
  const mobileMenu = document.querySelector('.navbar__mobile-menu');

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('active');
      mobileMenu.classList.toggle('active');
      document.body.style.overflow = mobileMenu.classList.contains('active') ? 'hidden' : '';
    });

    // Close menu when clicking a link
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('active');
        mobileMenu.classList.remove('active');
        document.body.style.overflow = '';
      });
    });
  }

  // ── Tab Switching ──
  const tabContainers = document.querySelectorAll('[data-tabs]');

  tabContainers.forEach(container => {
    const tabs = container.querySelectorAll('.tab');
    const tabId = container.getAttribute('data-tabs');
    const panels = document.querySelectorAll(`[data-tab-panel="${tabId}"]`);

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        // Remove active from all tabs in this group
        tabs.forEach(t => t.classList.remove('tab--active'));
        tab.classList.add('tab--active');

        // Show corresponding panel
        const target = tab.getAttribute('data-tab-target');
        if (panels.length > 0) {
          panels.forEach(panel => {
            panel.style.display = panel.getAttribute('data-tab-content') === target ? '' : 'none';
          });
        }
      });
    });
  });

  // ── Copy Link Button ──
  const copyBtns = document.querySelectorAll('[data-copy]');

  copyBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.getAttribute('data-copy');
      navigator.clipboard.writeText(text).then(() => {
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => {
          btn.textContent = originalText;
        }, 2000);
      }).catch(() => {
        // Fallback
        const input = document.createElement('input');
        input.value = text;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);

        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => {
          btn.textContent = originalText;
        }, 2000);
      });
    });
  });

  // ── Username Availability Check (Simulated) ──
  const claimInput = document.querySelector('.claim-input__field');
  const availabilityIndicator = document.querySelector('.availability');

  if (claimInput && availabilityIndicator) {
    let debounceTimer;
    claimInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      const value = e.target.value.trim();

      if (value.length === 0) {
        availabilityIndicator.style.display = 'none';
        return;
      }

      debounceTimer = setTimeout(() => {
        availabilityIndicator.style.display = 'flex';
        // Always show as available (static demo)
      }, 300);
    });
  }

  // ── Connection Toggle ──
  const connectionToggles = document.querySelectorAll('.connection-row__toggle');

  connectionToggles.forEach(toggle => {
    if (toggle.tagName !== 'BUTTON') return;
    toggle.addEventListener('click', () => {
      if (toggle.classList.contains('connection-row__toggle--connect')) {
        toggle.classList.remove('connection-row__toggle--connect');
        toggle.classList.add('connection-row__toggle--connected');
        toggle.textContent = 'Connected';
      } else {
        toggle.classList.remove('connection-row__toggle--connected');
        toggle.classList.add('connection-row__toggle--connect');
        toggle.textContent = 'Connect';
      }
    });
  });

  // ── Dashboard Sidebar Active State ──
  const sidebarLinks = document.querySelectorAll('.sidebar__link');
  const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';

  sidebarLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href && href === currentPage) {
      sidebarLinks.forEach(l => l.classList.remove('sidebar__link--active'));
      link.classList.add('sidebar__link--active');
    }
  });

  // ── Theme Card Carousel ──
  const carouselPrev = document.querySelector('.carousel-btn--prev');
  const carouselNext = document.querySelector('.carousel-btn--next');
  const carouselContainer = document.querySelector('.themes-carousel');

  if (carouselPrev && carouselNext && carouselContainer) {
    const scrollAmount = 300;

    carouselPrev.addEventListener('click', () => {
      carouselContainer.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
    });

    carouselNext.addEventListener('click', () => {
      carouselContainer.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    });
  }

  // ── Preview Toggle (Desktop/Mobile) ──
  const previewToggles = document.querySelectorAll('.preview-panel__toggle-btn');

  previewToggles.forEach(btn => {
    btn.addEventListener('click', () => {
      previewToggles.forEach(b => b.classList.remove('preview-panel__toggle-btn--active'));
      btn.classList.add('preview-panel__toggle-btn--active');

      const previewFrame = document.querySelector('.preview-panel__frame');
      if (previewFrame) {
        const mode = btn.getAttribute('data-preview');
        if (mode === 'mobile') {
          previewFrame.style.maxWidth = '280px';
          previewFrame.style.margin = '0 auto';
        } else {
          previewFrame.style.maxWidth = '';
          previewFrame.style.margin = '';
        }
      }
    });
  });

  // Auth forms are handled in auth.js. Do not intercept them here.

  // ── Password Visibility Toggle ──
  const passwordToggles = document.querySelectorAll('.password-toggle');

  passwordToggles.forEach(toggle => {
    toggle.addEventListener('click', () => {
      const input = toggle.previousElementSibling;
      if (input) {
        if (input.type === 'password') {
          input.type = 'text';
          toggle.innerHTML = '👁';
        } else {
          input.type = 'password';
          toggle.innerHTML = '👁‍🗨';
        }
      }
    });
  });

  // ── Smooth Scroll for anchor links ──
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // ── Time Range Toggle (Analytics) ──
  const timeRangeBtns = document.querySelectorAll('.time-range__btn');

  timeRangeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const parent = btn.closest('.time-range');
      parent.querySelectorAll('.time-range__btn').forEach(b => b.classList.remove('time-range__btn--active'));
      btn.classList.add('time-range__btn--active');
    });
  });

  // ── Media Tab Filtering ──
  const mediaTabs = document.querySelectorAll('[data-media-tab]');

  mediaTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      mediaTabs.forEach(t => t.classList.remove('tab--active'));
      tab.classList.add('tab--active');
      // In a real app this would filter items; static demo keeps all visible
    });
  });

  // ── Navbar scroll effect ──
  const navbar = document.querySelector('.navbar') || document.querySelector('.dash-navbar');

  if (navbar) {
    let lastScroll = 0;

    window.addEventListener('scroll', () => {
      const currentScroll = window.scrollY;

      if (currentScroll > 50) {
        navbar.style.borderBottomColor = 'rgba(255, 255, 255, 0.08)';
      } else {
        navbar.style.borderBottomColor = '';
      }

      lastScroll = currentScroll;
    });
  }

  // ── Appearance Slider Values ──
  const sliders = document.querySelectorAll('.slider-control input[type="range"]');

  sliders.forEach(slider => {
    const valueDisplay = slider.closest('.slider-control').querySelector('.slider-control__value');
    if (valueDisplay) {
      slider.addEventListener('input', () => {
        valueDisplay.textContent = slider.value + (slider.dataset.unit || '');
      });
    }
  });
});
