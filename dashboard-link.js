/**
 * dashboard-link.js
 * ปุ่มเปิด Dashboard แบบกะทัดรัดในหน้า Module
 *
 * หลักการ:
 * - ไม่แทรกปุ่มเป็นแถวใหม่ใน .module-title-row
 * - ย้ายปุ่มเข้าไปอยู่ภายใน .module-clock
 * - ไม่แก้ไข Logic ของ module.js
 */
(function (window, document) {
  'use strict';

  document.addEventListener('DOMContentLoaded', initializeDashboardLink);

  function initializeDashboardLink() {
    if (!document.body || document.body.dataset.page !== 'module') {
      return;
    }

    const titleRow = document.querySelector('.module-title-row');
    const clock = titleRow?.querySelector('.module-clock');

    if (!titleRow || !clock) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const moduleId = String(params.get('id') || '').trim();

    if (!moduleId) {
      return;
    }

    let link = document.getElementById('moduleDashboardLauncher');

    if (!link) {
      link = document.createElement('a');
      link.id = 'moduleDashboardLauncher';
      link.className = 'module-dashboard-launcher';
    }

    link.href =
      './dashboard/index.html?module=' + encodeURIComponent(moduleId);

    link.setAttribute('aria-label', 'เปิด Dashboard ของโมดูลนี้');
    link.setAttribute('title', 'เปิด Dashboard');

    link.innerHTML = `
      <svg
        class="module-dashboard-launcher__icon"
        viewBox="0 0 24 24"
        aria-hidden="true"
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

      <span>Dashboard</span>
    `;

    clock.classList.add('module-clock--with-dashboard');

    if (link.parentElement !== clock) {
      clock.insertBefore(link, clock.firstChild);
    }
  }
})(window, document);
