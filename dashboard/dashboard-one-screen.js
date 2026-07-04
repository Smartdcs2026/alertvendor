/************************************************************
 * dashboard-one-screen.js
 * ROUND 64 — Unified one-screen layout controller
 ************************************************************/

(function (window, document) {
  'use strict';

  const DATE_TIME_PATTERN =
    /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}$/;

  const RAW_DATE_PATTERNS = [
    /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2}\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+GMT[+-]\d{4}(?:\s*\([^)]+\))?/gi,
    /\b\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
    /\b\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}\b/g
  ];

  let layoutTimer = 0;
  let observer = null;
  let patchedSwal = false;

  function init() {
    syncDashboardMode();
    syncViewportSize();
    patchSweetAlert();
    normalizeDateTimes(document.body);
    bindEvents();
    createObserver();
    scheduleLayout();
  }

  function bindEvents() {
    document.addEventListener(
      'click',
      (event) => {
        if (
          event.target.closest('[data-dashboard-view]')
        ) {
          window.setTimeout(
            () => {
              syncDashboardMode();
              scheduleLayout();
            },
            80
          );
        }
      },
      true
    );

    document.addEventListener(
      'fullscreenchange',
      () => {
        syncViewportSize();
        scheduleLayout();
      }
    );

    window.addEventListener(
      'resize',
      scheduleLayout,
      {
        passive: true
      }
    );

    window.addEventListener(
      'orientationchange',
      scheduleLayout,
      {
        passive: true
      }
    );
  }

  function syncDashboardMode() {
    const active =
      document.querySelector(
        '[data-dashboard-view].is-active'
      );

    const view =
      active &&
      active.dataset &&
      active.dataset.dashboardView
        ? active.dataset.dashboardView
        : document.getElementById(
            'dashboardShiftWorkspace'
          ) &&
          !document.getElementById(
            'dashboardShiftWorkspace'
          ).hidden
            ? 'SHIFT'
            : 'LIVE';

    document.body.dataset.dashboardView =
      view;
  }

  function syncViewportSize() {
    const header =
      document.querySelector(
        '.control-header'
      );

    const toolbar =
      document.getElementById(
        'dashboardViewToolbar'
      );

    const headerHeight =
      header
        ? Math.ceil(
            header.getBoundingClientRect()
              .height
          )
        : 76;

    const toolbarHeight =
      toolbar
        ? Math.ceil(
            toolbar.getBoundingClientRect()
              .height
          )
        : 58;

    document.documentElement
      .style.setProperty(
        '--r64-header-h',
        headerHeight + 'px'
      );

    document.documentElement
      .style.setProperty(
        '--r64-toolbar-h',
        toolbarHeight + 'px'
      );

    document.documentElement
      .style.setProperty(
        '--r64-vh',
        window.innerHeight + 'px'
      );
  }

  function scheduleLayout() {
    if (layoutTimer) {
      window.clearTimeout(layoutTimer);
    }

    syncDashboardMode();
    syncViewportSize();

    layoutTimer =
      window.setTimeout(
        () => {
          syncDashboardMode();
          syncViewportSize();
          normalizeDateTimes(document.body);
          resizeCharts();
        },
        180
      );
  }

  function resizeCharts() {
    const charts =
      window.Chart &&
      window.Chart.instances
        ? Object.values(window.Chart.instances)
        : [];

    charts.forEach(
      (chart) => {
        if (
          chart &&
          typeof chart.resize === 'function'
        ) {
          chart.resize();
        }
      }
    );
  }

  function createObserver() {
    if (observer) {
      observer.disconnect();
    }

    observer =
      new MutationObserver(
        (mutations) => {
          let shouldRun = false;

          for (const mutation of mutations) {
            if (
              mutation.type === 'childList' ||
              mutation.type === 'characterData'
            ) {
              shouldRun = true;
              break;
            }
          }

          if (shouldRun) {
            scheduleLayout();
          }
        }
      );

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true,
        characterData: true
      }
    );
  }

  function patchSweetAlert() {
    if (
      patchedSwal ||
      !window.Swal ||
      typeof window.Swal.fire !== 'function'
    ) {
      if (!patchedSwal) {
        window.setTimeout(
          patchSweetAlert,
          120
        );
      }
      return;
    }

    patchedSwal = true;

    const originalFire =
      window.Swal.fire.bind(window.Swal);

    window.Swal.fire =
      function patchedFire(options, ...rest) {
        if (
          options &&
          typeof options === 'object'
        ) {
          const originalDidOpen =
            options.didOpen;

          options.didOpen =
            function didOpenWithRound64(popup) {
              normalizeDateTimes(popup);

              if (
                typeof originalDidOpen === 'function'
              ) {
                originalDidOpen(popup);
              }
            };
        }

        const result =
          originalFire(options, ...rest);

        window.setTimeout(
          () => {
            const popup =
              document.querySelector(
                '.swal2-popup'
              );

            if (popup) {
              normalizeDateTimes(popup);
            }
          },
          80
        );

        return result;
      };
  }

  function normalizeDateTimes(root) {
    if (!root) {
      return;
    }

    const walker =
      document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            const text =
              node.nodeValue || '';

            if (
              !text ||
              !mightContainDate(text)
            ) {
              return NodeFilter.FILTER_REJECT;
            }

            const parent =
              node.parentElement;

            if (
              parent &&
              (
                parent.tagName === 'SCRIPT' ||
                parent.tagName === 'STYLE' ||
                parent.tagName === 'TEXTAREA' ||
                parent.tagName === 'INPUT'
              )
            ) {
              return NodeFilter.FILTER_REJECT;
            }

            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

    const nodes = [];

    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }

    nodes.forEach(
      (node) => {
        const next =
          normalizeDateText(
            node.nodeValue || ''
          );

        if (
          next &&
          next !== node.nodeValue
        ) {
          node.nodeValue = next;
        }
      }
    );
  }

  function mightContainDate(text) {
    return (
      /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+/.test(text) ||
      /\b\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}/.test(text) ||
      /\b\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}\b/.test(text)
    );
  }

  function normalizeDateText(text) {
    let result = String(text || '');

    RAW_DATE_PATTERNS.forEach(
      (pattern) => {
        result =
          result.replace(
            pattern,
            (match) => {
              const formatted =
                formatDateTime(match);

              return formatted || match;
            }
          );
      }
    );

    return result;
  }

  function formatDateTime(value) {
    const text =
      String(value || '').trim();

    if (!text) {
      return '';
    }

    if (DATE_TIME_PATTERN.test(text)) {
      return text;
    }

    const dmy =
      text.match(
        /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/
      );

    if (dmy) {
      return text;
    }

    const nativeDate =
      new Date(text);

    if (
      !Number.isNaN(nativeDate.getTime())
    ) {
      return formatBangkok(nativeDate);
    }

    return '';
  }

  function formatBangkok(date) {
    const parts =
      new Intl.DateTimeFormat(
        'en-GB',
        {
          timeZone: 'Asia/Bangkok',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        }
      )
        .formatToParts(date)
        .reduce(
          (result, part) => {
            result[part.type] =
              part.value;
            return result;
          },
          {}
        );

    return (
      parts.day + '/' +
      parts.month + '/' +
      parts.year + ' ' +
      parts.hour + ':' +
      parts.minute + ':' +
      parts.second
    );
  }

  if (
    document.readyState === 'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      init
    );
  } else {
    init();
  }
})(window, document);
