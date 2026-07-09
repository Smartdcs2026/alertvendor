/************************************************************
 * dashboard-executive-readability.js
 * ROUND 66 — Executive Readability Fix
 ************************************************************/

(function (window, document) {
  'use strict';

  const DATE_FULL =
    /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}$/;

  let timer = 0;
  let observer = null;

  function init() {
    document.body.classList.add(
      'r66-executive-readability'
    );

    moveGlobalInfoToContext();
    prepareDatePickerDisplay();
    shortenDailyHistoryHeaders();
    normalizeVisibleDates(document.body);
    bindEvents();
    startObserver();
    scheduleRefresh();
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
            scheduleRefresh,
            80
          );
        }
      },
      true
    );

    const input =
      document.getElementById(
        'dashboardShiftDate'
      );

    if (input) {
      input.addEventListener(
        'change',
        () => {
          updateDateDisplay();
          window.setTimeout(
            scheduleRefresh,
            120
          );
        }
      );
    }

    document.addEventListener(
      'fullscreenchange',
      scheduleRefresh
    );

    window.addEventListener(
      'resize',
      scheduleRefresh,
      {
        passive:
          true
      }
    );
  }

  function scheduleRefresh() {
    if (timer) {
      window.clearTimeout(timer);
    }

    timer =
      window.setTimeout(
        () => {
          moveGlobalInfoToContext();
          prepareDatePickerDisplay();
          updateDateDisplay();
          shortenDailyHistoryHeaders();
          normalizeVisibleDates(document.body);
          resizeCharts();
        },
        140
      );
  }

  function moveGlobalInfoToContext() {
    const liveHeading =
      document.querySelector(
        '#dashboardSituation .panel-heading h2'
      );

    if (
      liveHeading &&
      !liveHeading.querySelector(
        '.r66-context-info'
      )
    ) {
      const button =
        document.createElement(
          'button'
        );

      button.type =
        'button';
      button.className =
        'r66-context-info';
      button.dataset.dashboardInfo =
        'overview';
      button.setAttribute(
        'aria-label',
        'อธิบายสถานการณ์สด'
      );
      button.textContent =
        'i';

      liveHeading.appendChild(
        button
      );
    }
  }

  function prepareDatePickerDisplay() {
    const input =
      document.getElementById(
        'dashboardShiftDate'
      );

    if (!input) {
      return;
    }

    input.classList.add(
      'r66-native-date'
    );

    const label =
      input.closest('label');

    if (
      label &&
      !label.querySelector(
        '.r66-date-display'
      )
    ) {
      const display =
        document.createElement(
          'span'
        );

      display.className =
        'r66-date-display';
      display.id =
        'dashboardShiftDateDisplay';

      label.appendChild(
        display
      );

      label.addEventListener(
        'click',
        () => {
          if (
            typeof input.showPicker ===
              'function'
          ) {
            try {
              input.showPicker();
            } catch (error) {
              input.focus();
            }
          } else {
            input.focus();
          }
        }
      );
    }

    updateDateDisplay();
  }

  function updateDateDisplay() {
    const input =
      document.getElementById(
        'dashboardShiftDate'
      );

    const display =
      document.getElementById(
        'dashboardShiftDateDisplay'
      );

    if (
      !input ||
      !display
    ) {
      return;
    }

    display.textContent =
      dateInputToDisplay(
        input.value
      );
  }

  function dateInputToDisplay(value) {
    const text =
      String(value || '')
        .trim();

    const match =
      text.match(
        /^(\d{4})-(\d{2})-(\d{2})$/
      );

    if (!match) {
      return '--/--/---- 00:00:00';
    }

    return (
      match[3] + '/' +
      match[2] + '/' +
      match[1] +
      ' 00:00:00'
    );
  }

  function shortenDailyHistoryHeaders() {
    const table =
      document.querySelector(
        '.daily-history-table'
      );

    if (!table) {
      return;
    }

    const labels = [
      'วัน',
      'เข้า',
      'ออก',
      'ปลาย',
      'เกิน',
      'กลาง',
      'เฉลี่ย',
      'สถานะ'
    ];

    table
      .querySelectorAll('thead th')
      .forEach(
        (cell, index) => {
          if (labels[index]) {
            cell.textContent =
              labels[index];
          }
        }
      );

    table
      .querySelectorAll(
        'tbody tr'
      )
      .forEach(
        (row) => {
          const first =
            row.children[0];

          if (first) {
            first.textContent =
              normalizeDateOnlyToFull(
                first.textContent
              );
          }
        }
      );
  }

  function normalizeDateOnlyToFull(value) {
    const text =
      String(value || '')
        .trim();

    if (DATE_FULL.test(text)) {
      return text;
    }

    const dmy =
      text.match(
        /^(\d{2})\/(\d{2})\/(\d{4})$/
      );

    if (dmy) {
      return (
        dmy[1] + '/' +
        dmy[2] + '/' +
        dmy[3] +
        ' 00:00:00'
      );
    }

    const iso =
      text.match(
        /^(\d{4})-(\d{2})-(\d{2})$/
      );

    if (iso) {
      return (
        iso[3] + '/' +
        iso[2] + '/' +
        iso[1] +
        ' 00:00:00'
      );
    }

    return text;
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
        () => {
          scheduleRefresh();
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
          'hidden',
          'value'
        ]
      }
    );
  }

  function normalizeVisibleDates(root) {
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
              !hasDateCandidate(text)
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
            node.nodeValue
          );

        if (
          next &&
          next !== node.nodeValue
        ) {
          node.nodeValue =
            next;
        }
      }
    );
  }

  function hasDateCandidate(text) {
    return (
      /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+/.test(text) ||
      /\b\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}/.test(text) ||
      /\b\d{4}-\d{2}-\d{2}\b/.test(text) ||
      /\b\d{2}\/\d{2}\/\d{4}\b/.test(text)
    );
  }

  function normalizeDateText(text) {
    let result =
      String(text || '');

    result =
      result.replace(
        /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2}\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+GMT[+-]\d{4}(?:\s*\([^)]+\))?/gi,
        (match) =>
          formatDateTime(match) ||
          match
      );

    result =
      result.replace(
        /\b\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
        (match) =>
          formatDateTime(match) ||
          match
      );

    result =
      result.replace(
        /\b\d{4}-\d{2}-\d{2}\b/g,
        (match) =>
          normalizeDateOnlyToFull(match)
      );

    result =
      result.replace(
        /\b\d{2}\/\d{2}\/\d{4}(?!\s+\d{2}:\d{2}:\d{2})\b/g,
        (match) =>
          normalizeDateOnlyToFull(match)
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

    if (DATE_FULL.test(text)) {
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

  function resizeCharts() {
    if (!window.Chart) {
      return;
    }

    const charts =
      window.Chart.instances
        ? Object.values(
            window.Chart.instances
          )
        : [];

    charts.forEach(
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
