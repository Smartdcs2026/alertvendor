/**
 * module-workspace-compact.js
 * ROUND 3 — Responsive Workspace Runtime
 * Build: 2026.07.17-round3-responsive-r1
 */
(function (window, document) {
  'use strict';

  const BUILD = '2026.07.17-round3-responsive-r1';
  const state = {
    resizeRaf: 0,
    observer: null,
    mutationObserver: null,
    liveRegion: null,
    destroyed: false
  };

  document.addEventListener('DOMContentLoaded', initialize, { once: true });
  window.addEventListener('pagehide', destroy, { once: true });

  function initialize() {
    if (!document.body || !document.body.classList.contains('module-page')) {
      return;
    }

    document.body.dataset.moduleWorkspaceBuild = BUILD;
    document.documentElement.style.overflowX = 'clip';

    ensureLiveRegion();
    measureLayout();
    observeLayout();
    observeVehicleCards();
    bindEvents();
    updateFullscreenState();
  }

  function bindEvents() {
    window.addEventListener('resize', scheduleMeasure, { passive: true });
    window.addEventListener('orientationchange', scheduleMeasure, { passive: true });
    document.addEventListener('fullscreenchange', updateFullscreenState);
    document.addEventListener('webkitfullscreenchange', updateFullscreenState);
    document.addEventListener('alertvendor:records-updated', () => {
      window.requestAnimationFrame(() => {
        decorateVehicleCards();
        measureLayout();
      });
    });
    document.addEventListener('alertvendor:receiving-card-state', handleReceivingCardState);
  }

  function scheduleMeasure() {
    if (state.resizeRaf) {
      window.cancelAnimationFrame(state.resizeRaf);
    }

    state.resizeRaf = window.requestAnimationFrame(() => {
      state.resizeRaf = 0;
      measureLayout();
    });
  }

  function measureLayout() {
    if (state.destroyed || !document.body) return;

    const header = document.querySelector('.module-header');
    const footer = document.querySelector('body.module-page > footer.app-footer.module-footer');
    const container = document.querySelector('.module-container');
    const width = Math.max(0, document.documentElement.clientWidth || window.innerWidth || 0);

    document.documentElement.style.setProperty(
      '--module-header-measured',
      Math.ceil(header ? header.getBoundingClientRect().height : 58) + 'px'
    );
    document.documentElement.style.setProperty(
      '--module-footer-measured',
      Math.ceil(footer ? footer.getBoundingClientRect().height : 38) + 'px'
    );

    document.body.dataset.moduleViewport = viewportName(width);

    if (container) {
      const containerWidth = Math.round(container.getBoundingClientRect().width);
      container.dataset.workspaceDensity = densityName(containerWidth);
    }

    detectPageOverflow();
  }

  function viewportName(width) {
    if (width < 390) return 'PHONE_SMALL';
    if (width < 600) return 'PHONE';
    if (width < 900) return 'TABLET';
    if (width < 1280) return 'NOTEBOOK';
    if (width < 1700) return 'DESKTOP';
    return 'WIDE';
  }

  function densityName(width) {
    if (width < 480) return 'COMPACT';
    if (width < 900) return 'MEDIUM';
    return 'COMFORTABLE';
  }

  function observeLayout() {
    if (typeof ResizeObserver !== 'function') return;

    state.observer = new ResizeObserver(scheduleMeasure);
    [
      document.querySelector('.module-header'),
      document.querySelector('.module-container'),
      document.querySelector('body.module-page > footer.app-footer.module-footer')
    ].filter(Boolean).forEach((node) => state.observer.observe(node));
  }

  function observeVehicleCards() {
    const list = document.getElementById('vehicleList');
    if (!list || typeof MutationObserver !== 'function') {
      decorateVehicleCards();
      return;
    }

    state.mutationObserver = new MutationObserver((mutations) => {
      let changed = false;
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' && mutation.addedNodes.length) {
          changed = true;
        }
      });

      if (changed) {
        window.requestAnimationFrame(() => {
          decorateVehicleCards();
          detectPageOverflow();
        });
      }
    });

    state.mutationObserver.observe(list, {
      childList: true,
      subtree: true
    });

    decorateVehicleCards();
  }

  function decorateVehicleCards() {
    document.querySelectorAll('.vehicle-card').forEach((card) => {
      if (card.dataset.round3Responsive === 'TRUE') return;

      card.dataset.round3Responsive = 'TRUE';
      card.querySelectorAll('.vehicle-field strong, .vehicle-field a').forEach((node) => {
        const value = String(node.textContent || '').trim();
        if (value) node.title = value;
      });
    });
  }

  function handleReceivingCardState(event) {
    const detail = event && event.detail && typeof event.detail === 'object'
      ? event.detail
      : {};
    const recordId = String(detail.recordId || '');
    const active = detail.active === true;
    const card = findCard(recordId);

    if (card) {
      card.classList.toggle('is-receiving-busy', active);
      if (active) {
        card.setAttribute('aria-busy', 'true');
      } else if (!card.querySelector('.receiving-card-progress, .receiving-live-status')) {
        card.removeAttribute('aria-busy');
      }
    }

    if (active && detail.message) {
      announce(String(detail.message));
    }
  }

  function findCard(recordId) {
    if (!recordId) return null;
    const escaped = window.CSS && typeof window.CSS.escape === 'function'
      ? window.CSS.escape(recordId)
      : recordId.replace(/["\\]/g, '\\$&');
    return document.querySelector('.vehicle-card[data-record-id="' + escaped + '"]');
  }

  function ensureLiveRegion() {
    let region = document.getElementById('moduleWorkspaceLiveRegion');
    if (!region) {
      region = document.createElement('div');
      region.id = 'moduleWorkspaceLiveRegion';
      region.className = 'sr-only';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      region.setAttribute('aria-atomic', 'true');
      document.body.appendChild(region);
    }
    state.liveRegion = region;
  }

  function announce(message) {
    if (!state.liveRegion) return;
    state.liveRegion.textContent = '';
    window.setTimeout(() => {
      if (state.liveRegion) state.liveRegion.textContent = message;
    }, 30);
  }

  function updateFullscreenState() {
    const active = Boolean(
      document.fullscreenElement ||
      document.webkitFullscreenElement
    );
    document.body && document.body.classList.toggle('is-native-fullscreen', active);
    scheduleMeasure();
  }

  function detectPageOverflow() {
    if (!document.body) return;

    const rootWidth = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth > rootWidth + 2;
    document.body.dataset.horizontalOverflow = overflow ? 'TRUE' : 'FALSE';

    if (overflow) {
      console.warn('ROUND 3: พบองค์ประกอบกว้างเกินหน้าจอ', {
        viewportWidth: rootWidth,
        scrollWidth: document.documentElement.scrollWidth
      });
    }
  }

  function destroy() {
    state.destroyed = true;
    if (state.resizeRaf) window.cancelAnimationFrame(state.resizeRaf);
    if (state.observer) state.observer.disconnect();
    if (state.mutationObserver) state.mutationObserver.disconnect();
  }
})(window, document);
