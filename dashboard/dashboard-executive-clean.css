/************************************************************
 * dashboard-executive-clean.js
 * ROUND 80 — Executive Clean Layout Controller
 ************************************************************/

(function (window, document) {
  'use strict';

  const DATE_TIME_FULL =
    /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}$/;

  const RAW_DATE_PATTERNS = [
    /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2}\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+GMT[+-]\d{4}(?:\s*\([^)]+\))?/gi,
    /\b\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
    /\b\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}\b/g
  ];

  let layoutTimer = 0;
  let observer = null;
  let swalPatched = false;

  function init() {
    document.body.classList.add(
      'r65-dashboard-clean'
    );

    syncMode();
    syncHeights();
    patchSweetAlert();
    normalizeDateTimes(document.body);
    bindEvents();
    startObserver();

    scheduleLayout();
  }

  function bindEvents() {
    document.addEventListener(
      'click',
      (event) => {
        if (
          event.target.closest(
            '[data-dashboard-view]'
          )
        ) {
          window.setTimeout(
            scheduleLayout,
            80
          );
        }
      },
      true
    );

    document.addEventListener(
      'fullscreenchange',
      scheduleLayout
    );

    window.addEventListener(
      'resize',
      scheduleLayout,
      {
        passive:
          true
      }
    );

    window.addEventListener(
      'orientationchange',
      scheduleLayout,
      {
        passive:
          true
      }
    );
  }

  function syncMode() {
    const active =
      document.querySelector(
        '.dashboard-view-tabs [data-dashboard-view].is-active'
      );

    let mode =
      active &&
      active.dataset
        ? active.dataset.dashboardView
        : '';

    const workspace =
      document.getElementById(
        'dashboardShiftWorkspace'
      );

    if (!mode) {
      mode =
        workspace &&
        workspace.hidden === false
          ? 'SHIFT'
          : 'LIVE';
    }

    document.body.dataset.dashboardView =
      mode || 'LIVE';
  }

  function syncHeights() {
    const header =
      document.querySelector(
        '.control-header'
      );

    const toolbar =
      document.getElementById(
        'dashboardViewToolbar'
      );

    const isSmallScreen =
      window.matchMedia &&
      window.matchMedia(
        '(max-width: 920px)'
      ).matches;

    const measuredHeaderHeight =
      header
        ? Math.ceil(
            header.getBoundingClientRect()
              .height
          )
        : 76;

    const measuredToolbarHeight =
      toolbar
        ? Math.ceil(
            toolbar.getBoundingClientRect()
              .height
          )
        : 54;

    /*
     * ROUND 80:
     * ห้ามนำค่าความสูง header ตอนจอเล็กไปค้างใช้บน desktop
     * เพราะตอน mobile header ถูกจัดเป็นหลายแถว ทำให้สูงกว่าปกติ
     * เมื่อขยายกลับ desktop จึงเกิดอาการแถบด้านบนใหญ่ผิดปกติ
     */
    const headerHeight =
      isSmallScreen
        ? measuredHeaderHeight
        : 76;

    const toolbarHeight =
      isSmallScreen
        ? measuredToolbarHeight
        : 54;

    document.documentElement
      .style.setProperty(
        '--r65-header-h',
        headerHeight + 'px'
      );

    document.documentElement
      .style.setProperty(
        '--r65-toolbar-h',
        toolbarHeight + 'px'
      );

    document.documentElement
      .style.setProperty(
        '--r65-vh',
        window.innerHeight + 'px'
      );

    document.documentElement
      .style.setProperty(
        '--shift-dashboard-header-height',
        headerHeight + 'px'
      );

    document.documentElement
      .style.setProperty(
        '--shift-dashboard-viewport-height',
        window.innerHeight + 'px'
      );
  }

  function scheduleLayout() {
    if (layoutTimer) {
      window.clearTimeout(layoutTimer);
    }

    syncMode();
    syncHeights();

    layoutTimer =
      window.setTimeout(
        () => {
          syncMode();
          syncHeights();
          normalizeDateTimes(document.body);
          resizeCharts();
        },
        160
      );
  }

  function resizeCharts() {
    if (!window.Chart) {
      return;
    }

    const instances =
      window.Chart.instances
        ? Object.values(
            window.Chart.instances
          )
        : [];

    instances.forEach(
      (chart) => {
        if (
          chart &&
          typeof chart.resize ===
            'function'
        ) {
          try {
            chart.resize();
          } catch (error) {
            /* no-op */
          }
        }
      }
    );
  }

  function startObserver() {
    if (
      typeof MutationObserver !==
        'function'
    ) {
      return;
    }

    if (observer) {
      observer.disconnect();
    }

    observer =
      new MutationObserver(
        (mutations) => {
          let shouldRun =
            false;

          for (const mutation of mutations) {
            if (
              mutation.type ===
                'childList' ||
              mutation.type ===
                'characterData' ||
              (
                mutation.type ===
                  'attributes' &&
                mutation.attributeName ===
                  'class'
              )
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
        childList:
          true,
        subtree:
          true,
        characterData:
          true,
        attributes:
          true,
        attributeFilter: [
          'class',
          'hidden'
        ]
      }
    );
  }

  function patchSweetAlert() {
    if (
      swalPatched ||
      !window.Swal ||
      typeof window.Swal.fire !==
        'function'
    ) {
      if (!swalPatched) {
        window.setTimeout(
          patchSweetAlert,
          120
        );
      }

      return;
    }

    swalPatched = true;

    const originalFire =
      window.Swal.fire.bind(
        window.Swal
      );

    window.Swal.fire =
      function round65SwalFire(
        options,
        ...rest
      ) {
        if (
          options &&
          typeof options ===
            'object'
        ) {
          const originalDidOpen =
            options.didOpen;

          options.didOpen =
            function round65DidOpen(
              popup
            ) {
              normalizeDateTimes(
                popup
              );

              if (
                typeof originalDidOpen ===
                  'function'
              ) {
                originalDidOpen(
                  popup
                );
              }
            };
        }

        const result =
          originalFire(
            options,
            ...rest
          );

        window.setTimeout(
          () => {
            const popup =
              document.querySelector(
                '.swal2-popup'
              );

            if (popup) {
              normalizeDateTimes(
                popup
              );
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
              !mightContainDate(text)
            ) {
              return NodeFilter
                .FILTER_REJECT;
            }

            const parent =
              node.parentElement;

            if (
              parent &&
              [
                'SCRIPT',
                'STYLE',
                'TEXTAREA',
                'INPUT'
              ].includes(
                parent.tagName
              )
            ) {
              return NodeFilter
                .FILTER_REJECT;
            }

            return NodeFilter
              .FILTER_ACCEPT;
          }
        }
      );

    const nodes = [];

    while (walker.nextNode()) {
      nodes.push(
        walker.currentNode
      );
    }

    nodes.forEach(
      (node) => {
        const next =
          normalizeDateText(
            node.nodeValue || ''
          );

        if (
          next &&
          next !==
            node.nodeValue
        ) {
          node.nodeValue =
            next;
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
    let result =
      String(text || '');

    RAW_DATE_PATTERNS.forEach(
      (pattern) => {
        result =
          result.replace(
            pattern,
            (match) => {
              const formatted =
                formatDateTime(
                  match
                );

              return formatted ||
                match;
            }
          );
      }
    );

    return result;
  }

  function formatDateTime(value) {
    const text =
      String(value || '')
        .trim();

    if (!text) {
      return '';
    }

    if (
      DATE_TIME_FULL.test(text)
    ) {
      return text;
    }

    const nativeDate =
      new Date(text);

    if (
      !Number.isNaN(
        nativeDate.getTime()
      )
    ) {
      return formatBangkok(
        nativeDate
      );
    }

    const isoMatch =
      text.match(
        /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})/
      );

    if (isoMatch) {
      const parsed =
        new Date(
          isoMatch[1] +
          '-' +
          isoMatch[2] +
          '-' +
          isoMatch[3] +
          'T' +
          isoMatch[4] +
          ':' +
          isoMatch[5] +
          ':' +
          isoMatch[6] +
          '+07:00'
        );

      if (
        !Number.isNaN(
          parsed.getTime()
        )
      ) {
        return formatBangkok(
          parsed
        );
      }
    }

    return '';
  }

  function formatBangkok(date) {
    const parts =
      new Intl.DateTimeFormat(
        'en-GB',
        {
          timeZone:
            'Asia/Bangkok',
          day:
            '2-digit',
          month:
            '2-digit',
          year:
            'numeric',
          hour:
            '2-digit',
          minute:
            '2-digit',
          second:
            '2-digit',
          hour12:
            false
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
    document.readyState ===
      'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      init
    );
  } else {
    init();
  }
})(window, document);
