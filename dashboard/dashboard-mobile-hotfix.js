/************************************************************
 * dashboard-mobile-hotfix.js
 * ROUND 78 — Mobile View + Date + Loading Stabilizer
 * โหลดเป็น JS ตัวสุดท้ายของ dashboard/index.html
 ************************************************************/
(function (window, document) {
  'use strict';

  const BODY_CLASS = 'r78-mobile-stable';
  const LEGACY_BODY_CLASS = 'r77-mobile-stable';
  const DATE_INPUT_ID = 'dashboardShiftDate';
  const DATE_DISPLAY_ID = 'dashboardShiftDateDisplay';
  const MOBILE_QUERY = '(max-width: 920px)';

  let observer = null;
  let timer = 0;
  let lastKickAt = 0;
  let kickCount = 0;

  document.addEventListener('DOMContentLoaded', initialize);
  window.addEventListener('load', () => scheduleStabilize(120));

  function initialize() {
    if (!document.body) {
      return;
    }

    document.body.classList.add(BODY_CLASS, LEGACY_BODY_CLASS);
    bindEvents();
    startObserver();
    stabilizeNow({forceKick: true});

    [250, 700, 1400, 2400].forEach(
      (delay) => window.setTimeout(
        () => stabilizeNow({forceKick: true}),
        delay
      )
    );
  }

  function bindEvents() {
    document.addEventListener(
      'click',
      (event) => {
        const viewButton = event.target.closest('[data-dashboard-view]');

        if (viewButton) {
          const view = normalizeView(viewButton.dataset.dashboardView);

          window.setTimeout(
            () => {
              setBodyView(view);
              stabilizeNow({forceKick: view !== 'LIVE'});
            },
            0
          );

          window.setTimeout(
            () => stabilizeNow({forceKick: view !== 'LIVE'}),
            180
          );

          window.setTimeout(
            () => stabilizeNow({forceKick: view !== 'LIVE'}),
            650
          );
        }

        if (event.target.closest('#dashboardShiftToday')) {
          setDateInputValue(todayIsoBangkok(), true);
          window.setTimeout(
            () => stabilizeNow({forceKick: true}),
            80
          );
        }
      },
      true
    );

    document.addEventListener(
      'change',
      (event) => {
        if (event.target && event.target.id === DATE_INPUT_ID) {
          ensureDateInputValue(false);
          updateDateDisplay();
          scheduleStabilize(120);
        }
      },
      true
    );

    window.addEventListener(
      'resize',
      () => scheduleStabilize(120),
      {passive: true}
    );

    window.addEventListener(
      'orientationchange',
      () => scheduleStabilize(250),
      {passive: true}
    );

    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'visible') {
          scheduleStabilize(160);
        }
      }
    );
  }

  function startObserver() {
    if (typeof MutationObserver !== 'function') {
      return;
    }

    if (observer) {
      observer.disconnect();
    }

    observer = new MutationObserver(() => scheduleStabilize(120));

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['hidden', 'class']
      }
    );
  }

  function scheduleStabilize(delay) {
    if (timer) {
      window.clearTimeout(timer);
    }

    timer = window.setTimeout(
      () => {
        timer = 0;
        stabilizeNow({forceKick: false});
      },
      Number(delay) || 80
    );
  }

  function stabilizeNow(options) {
    if (!document.body) {
      return;
    }

    const config = options && typeof options === 'object' ? options : {};
    const view = getActiveView();

    document.body.classList.add(BODY_CLASS, LEGACY_BODY_CLASS);
    setBodyView(view);
    moveToolbarBeforeWorkspace();
    forceViewVisibility(view);
    ensureDateDisplayElement();

    if (view !== 'LIVE') {
      ensureDateInputValue(config.forceKick === true);
      updateDateDisplay();
      kickShiftDailyIfNeeded(config.forceKick === true);
    } else {
      updateDateDisplay();
    }

    clearMobileGhostStyles();
  }

  function getActiveView() {
    const active = document.querySelector('.dashboard-view-tabs [data-dashboard-view].is-active');

    if (active) {
      return normalizeView(active.dataset.dashboardView);
    }

    const bodyView = normalizeView(document.body.dataset.dashboardView);

    if (bodyView) {
      return bodyView;
    }

    return 'LIVE';
  }

  function normalizeView(value) {
    const text = String(value || '').trim().toUpperCase();

    return ['LIVE', 'SHIFT', 'DAILY'].includes(text)
      ? text
      : 'LIVE';
  }

  function setBodyView(view) {
    const safeView = normalizeView(view);

    document.body.dataset.dashboardView = safeView;
    document.body.classList.toggle('is-live-dashboard', safeView === 'LIVE');
    document.body.classList.toggle('is-shift-dashboard', safeView === 'SHIFT');
    document.body.classList.toggle('is-daily-dashboard', safeView === 'DAILY');
  }

  function forceViewVisibility(view) {
    const safeView = normalizeView(view);
    const workspace = document.getElementById('dashboardShiftWorkspace');
    const dateControls = document.getElementById('dashboardShiftDateControls');
    const liveSections = [
      '.command-row',
      '.operations-row',
      '#mobileAnalyticsTabs',
      '.analytics-row',
      '.mobile-system-title',
      '.system-summary'
    ];

    if (dateControls) {
      if (safeView === 'LIVE') {
        dateControls.hidden = true;
        dateControls.setAttribute('hidden', '');
      } else {
        dateControls.hidden = false;
        dateControls.removeAttribute('hidden');
      }
    }

    if (workspace) {
      if (safeView === 'LIVE') {
        workspace.hidden = true;
        workspace.setAttribute('hidden', '');
      } else {
        workspace.hidden = false;
        workspace.removeAttribute('hidden');
      }
    }

    liveSections.forEach(
      (selector) => {
        document.querySelectorAll(selector).forEach(
          (element) => {
            if (safeView === 'LIVE') {
              element.hidden = false;
              element.removeAttribute('hidden');
            } else {
              element.hidden = true;
              element.setAttribute('hidden', '');
            }
          }
        );
      }
    );
  }

  function moveToolbarBeforeWorkspace() {
    const main = document.querySelector('.control-main');
    const toolbar = document.getElementById('dashboardViewToolbar');
    const workspace = document.getElementById('dashboardShiftWorkspace');

    if (!main || !toolbar || !workspace) {
      return;
    }

    if (toolbar.parentElement !== main || toolbar.nextElementSibling !== workspace) {
      main.insertBefore(toolbar, workspace);
    }
  }

  function ensureDateInputValue(fireChange) {
    const input = document.getElementById(DATE_INPUT_ID);

    if (!input) {
      return '';
    }

    const current = normalizeIsoDate(input.value);

    if (current) {
      input.dataset.lastGoodDate = current;
      return current;
    }

    const fallback =
      normalizeIsoDate(input.dataset.lastGoodDate) ||
      todayIsoBangkok();

    setDateInputValue(fallback, fireChange === true);
    return fallback;
  }

  function setDateInputValue(isoDate, fireChange) {
    const input = document.getElementById(DATE_INPUT_ID);
    const value = normalizeIsoDate(isoDate) || todayIsoBangkok();

    if (!input) {
      return;
    }

    const changed = input.value !== value;

    input.value = value;
    input.setAttribute('value', value);
    input.dataset.lastGoodDate = value;

    updateDateDisplay();

    if (fireChange === true) {
      dispatchDateEvents(input, changed);
    }
  }

  function dispatchDateEvents(input, changed) {
    if (!input) {
      return;
    }

    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));

    if (!changed) {
      input.dispatchEvent(new CustomEvent('alertvendor:date-refresh', {bubbles: true}));
    }
  }

  function ensureDateDisplayElement() {
    const input = document.getElementById(DATE_INPUT_ID);

    if (!input) {
      return null;
    }

    input.classList.add('r66-native-date');

    const label = input.closest('label');

    if (!label) {
      return null;
    }

    let display = document.getElementById(DATE_DISPLAY_ID);

    if (!display) {
      display = document.createElement('span');
      display.id = DATE_DISPLAY_ID;
      display.className = 'r78-date-display r66-date-display';
      label.appendChild(display);
    }

    return display;
  }

  function updateDateDisplay() {
    const input = document.getElementById(DATE_INPUT_ID);
    const display = ensureDateDisplayElement();

    if (!input || !display) {
      return;
    }

    const value =
      normalizeIsoDate(input.value) ||
      normalizeIsoDate(input.dataset.lastGoodDate) ||
      todayIsoBangkok();

    display.textContent = isoToDisplayDateTime(value);
  }

  function kickShiftDailyIfNeeded(force) {
    if (!isMobile()) {
      return;
    }

    const view = getActiveView();

    if (view === 'LIVE') {
      kickCount = 0;
      return;
    }

    const input = document.getElementById(DATE_INPUT_ID);
    const workspace = document.getElementById('dashboardShiftWorkspace');

    if (!input || !workspace) {
      return;
    }

    const hasRealContent = Boolean(
      workspace.querySelector(
        '.shift-executive-header, .shift-executive-kpis, .shift-comparison-grid, .daily-summary-grid, .daily-dashboard-analysis, .shift-dashboard-analysis'
      )
    );

    const hasLoading = Boolean(
      workspace.querySelector('.shift-dashboard-loading')
    );

    if (hasRealContent && !hasLoading) {
      kickCount = 0;
      return;
    }

    const now = Date.now();
    const canKick = force === true || (now - lastKickAt > 1400 && kickCount < 6);

    if (!canKick) {
      return;
    }

    lastKickAt = now;
    kickCount += 1;

    const value = ensureDateInputValue(false);
    input.value = value;
    input.setAttribute('value', value);
    updateDateDisplay();

    window.setTimeout(
      () => dispatchDateEvents(input, false),
      30
    );
  }

  function clearMobileGhostStyles() {
    const selectors = [
      '#dashboardShiftWorkspace',
      '#dashboardViewToolbar',
      '#dashboardShiftDateControls',
      '.shift-dashboard-loading',
      '.shift-executive-header',
      '.shift-executive-kpis',
      '.shift-comparison-grid',
      '.shift-dashboard-analysis',
      '.shift-dashboard-lower',
      '.daily-summary-grid',
      '.daily-dashboard-analysis'
    ];

    selectors.forEach(
      (selector) => {
        document.querySelectorAll(selector).forEach(
          (element) => {
            element.style.opacity = '';
            element.style.filter = '';
            element.style.transform = '';
          }
        );
      }
    );
  }

  function normalizeIsoDate(value) {
    const text = String(value || '').trim();

    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (match) {
      return match[1] + '-' + match[2] + '-' + match[3];
    }

    match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+\d{2}:\d{2}:\d{2})?$/);

    if (match) {
      return match[3] + '-' + match[2] + '-' + match[1];
    }

    return '';
  }

  function isoToDisplayDateTime(value) {
    const iso = normalizeIsoDate(value) || todayIsoBangkok();
    const parts = iso.split('-');

    return parts[2] + '/' + parts[1] + '/' + parts[0] + ' 00:00:00';
  }

  function todayIsoBangkok() {
    const parts = new Intl.DateTimeFormat(
      'en-GB',
      {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }
    )
      .formatToParts(new Date())
      .reduce(
        (result, part) => {
          result[part.type] = part.value;
          return result;
        },
        {}
      );

    return parts.year + '-' + parts.month + '-' + parts.day;
  }

  function isMobile() {
    return window.matchMedia(MOBILE_QUERY).matches;
  }
})(window, document);
