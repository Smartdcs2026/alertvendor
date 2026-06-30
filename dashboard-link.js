/**
 * dashboard-link.js
 * เพิ่มปุ่ม Dashboard ในทุกหน้า Module
 *
 * ไม่แก้ไข Logic ของ module.js
 */
(function (
  window,
  document
) {
  'use strict';

  document.addEventListener(
    'DOMContentLoaded',
    initializeDashboardLink
  );

  function initializeDashboardLink() {
    if (
      !document.body ||
      document.body.dataset.page !==
        'module'
    ) {
      return;
    }

    if (
      document.getElementById(
        'moduleDashboardLauncher'
      )
    ) {
      return;
    }

    const titleRow =
      document.querySelector(
        '.module-title-row'
      );

    if (!titleRow) {
      return;
    }

    const params =
      new URLSearchParams(
        window.location.search
      );

    const moduleId =
      String(
        params.get('id') || ''
      ).trim();

    if (!moduleId) {
      return;
    }

    const link =
      document.createElement(
        'a'
      );

    link.id =
      'moduleDashboardLauncher';

    link.className =
      'module-dashboard-launcher';

    link.href =
      './dashboard/index.html?module=' +
      encodeURIComponent(
        moduleId
      );

    link.setAttribute(
      'aria-label',
      'เปิด Dashboard ของโมดูลนี้'
    );

    link.innerHTML = `
      <span
        class="module-dashboard-launcher__icon"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          focusable="false"
        >
          <path
            d="M4 19V9m5 10V5m5 14v-7m5 7V3"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
          />
        </svg>
      </span>

      <span>
        <small>ANALYTICS</small>
        <strong>เปิด Dashboard</strong>
      </span>

      <span
        class="module-dashboard-launcher__arrow"
        aria-hidden="true"
      >
        →
      </span>
    `;

    const clock =
      titleRow.querySelector(
        '.module-clock'
      );

    if (clock) {
      titleRow.insertBefore(
        link,
        clock
      );

    } else {
      titleRow.appendChild(
        link
      );
    }
  }
})(window, document);
