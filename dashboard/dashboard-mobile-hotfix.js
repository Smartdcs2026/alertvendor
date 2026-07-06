/************************************************************
 * dashboard-mobile-hotfix.js
 * ROUND 77 — Mobile Date + Toolbar Stabilizer
 *
 * โหลดเป็น JS ตัวสุดท้ายของ dashboard/index.html
 ************************************************************/
(function (window, document) {
  'use strict';

  const BODY_CLASS =
    'r77-mobile-stable';

  const DATE_INPUT_ID =
    'dashboardShiftDate';

  const DATE_DISPLAY_ID =
    'dashboardShiftDateDisplay';

  let observer = null;
  let timer = 0;

  document.addEventListener(
    'DOMContentLoaded',
    initialize
  );

  window.addEventListener(
    'load',
    () => scheduleStabilize(120)
  );

  function initialize() {
    document.body.classList.add(
      BODY_CLASS
    );

    bindEvents();
    startObserver();
    stabilizeNow();

    window.setTimeout(
      stabilizeNow,
      300
    );

    window.setTimeout(
      stabilizeNow,
      900
    );
  }

  function bindEvents() {
    document.addEventListener(
      'click',
      (event) => {
        const viewButton =
          event.target.closest(
            '[data-dashboard-view]'
          );

        if (viewButton) {
          const view =
            String(
              viewButton.dataset.dashboardView ||
              ''
            ).toUpperCase();

          if (view !== 'LIVE') {
            ensureDateInputValue(true);
          }

          scheduleStabilize(80);
          scheduleStabilize(260);
        }

        if (
          event.target.closest(
            '#dashboardShiftToday'
          )
        ) {
          setDateInputValue(
            todayIsoBangkok(),
            true
          );

          scheduleStabilize(80);
        }
      },
      true
    );

    document.addEventListener(
      'change',
      (event) => {
        if (
          event.target &&
          event.target.id === DATE_INPUT_ID
        ) {
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
      { passive: true }
    );

    window.addEventListener(
      'orientationchange',
      () => scheduleStabilize(250),
      { passive: true }
    );
  }

  function startObserver() {
    if (
      typeof MutationObserver !== 'function'
    ) {
      return;
    }

    if (observer) {
      observer.disconnect();
    }

    observer =
      new MutationObserver(
        () => scheduleStabilize(100)
      );

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          'hidden',
          'class',
          'style'
        ]
      }
    );
  }

  function scheduleStabilize(delay) {
    if (timer) {
      window.clearTimeout(timer);
    }

    timer =
      window.setTimeout(
        () => {
          timer = 0;
          stabilizeNow();
        },
        Number(delay) || 80
      );
  }

  function stabilizeNow() {
    if (!document.body) {
      return;
    }

    document.body.classList.add(
      BODY_CLASS
    );

    moveToolbarBeforeWorkspace();
    ensureDateInputValue(false);
    ensureDateDisplayElement();
    updateDateDisplay();
    clearMobileGhostStyles();
  }

  function moveToolbarBeforeWorkspace() {
    const main =
      document.querySelector(
        '.control-main'
      );

    const toolbar =
      document.getElementById(
        'dashboardViewToolbar'
      );

    const workspace =
      document.getElementById(
        'dashboardShiftWorkspace'
      );

    if (!main || !toolbar || !workspace) {
      return;
    }

    if (
      toolbar.parentElement !== main ||
      toolbar.nextElementSibling !== workspace
    ) {
      main.insertBefore(
        toolbar,
        workspace
      );
    }
  }

  function ensureDateInputValue(fireChange) {
    const input =
      document.getElementById(
        DATE_INPUT_ID
      );

    if (!input) {
      return '';
    }

    const current =
      normalizeIsoDate(
        input.value
      );

    if (current) {
      input.dataset.lastGoodDate =
        current;

      return current;
    }

    const fallback =
      normalizeIsoDate(
        input.dataset.lastGoodDate
      ) ||
      todayIsoBangkok();

    setDateInputValue(
      fallback,
      fireChange === true
    );

    return fallback;
  }

  function setDateInputValue(isoDate, fireChange) {
    const input =
      document.getElementById(
        DATE_INPUT_ID
      );

    const value =
      normalizeIsoDate(isoDate) ||
      todayIsoBangkok();

    if (!input) {
      return;
    }

    const changed =
      input.value !== value;

    input.value = value;
    input.setAttribute(
      'value',
      value
    );
    input.dataset.lastGoodDate =
      value;

    updateDateDisplay();

    if (
      changed &&
      fireChange === true
    ) {
      input.dispatchEvent(
        new Event(
          'change',
          {
            bubbles: true
          }
        )
      );
    }
  }

  function ensureDateDisplayElement() {
    const input =
      document.getElementById(
        DATE_INPUT_ID
      );

    if (!input) {
      return null;
    }

    input.classList.add(
      'r66-native-date'
    );

    const label =
      input.closest('label');

    if (!label) {
      return null;
    }

    let display =
      document.getElementById(
        DATE_DISPLAY_ID
      );

    if (!display) {
      display =
        document.createElement('span');

      display.id =
        DATE_DISPLAY_ID;

      display.className =
        'r66-date-display';

      label.appendChild(display);
    }

    return display;
  }

  function updateDateDisplay() {
    const input =
      document.getElementById(
        DATE_INPUT_ID
      );

    const display =
      ensureDateDisplayElement();

    if (!input || !display) {
      return;
    }

    const value =
      normalizeIsoDate(
        input.value
      ) ||
      normalizeIsoDate(
        input.dataset.lastGoodDate
      ) ||
      todayIsoBangkok();

    display.textContent =
      isoToDisplayDateTime(
        value
      );
  }

  function clearMobileGhostStyles() {
    const selectors = [
      '#dashboardShiftWorkspace',
      '#dashboardViewToolbar',
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
        document
          .querySelectorAll(selector)
          .forEach(
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
    const text =
      String(value || '')
        .trim();

    let match =
      text.match(
        /^(\d{4})-(\d{2})-(\d{2})$/
      );

    if (match) {
      return (
        match[1] + '-' +
        match[2] + '-' +
        match[3]
      );
    }

    match =
      text.match(
        /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+\d{2}:\d{2}:\d{2})?$/
      );

    if (match) {
      return (
        match[3] + '-' +
        match[2] + '-' +
        match[1]
      );
    }

    return '';
  }

  function isoToDisplayDateTime(value) {
    const iso =
      normalizeIsoDate(value) ||
      todayIsoBangkok();

    const parts =
      iso.split('-');

    return (
      parts[2] + '/' +
      parts[1] + '/' +
      parts[0] +
      ' 00:00:00'
    );
  }

  function todayIsoBangkok() {
    const parts =
      new Intl.DateTimeFormat(
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
            result[part.type] =
              part.value;

            return result;
          },
          {}
        );

    return (
      parts.year + '-' +
      parts.month + '-' +
      parts.day
    );
  }

})(window, document);
