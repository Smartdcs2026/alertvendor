/**
 * dashboard-link.js
 * ROUND 35 — Dashboard Launcher Compatibility
 *
 * รองรับ Header เดิมและ Header แบบ Unified Command Bar
 */
(function (window, document) {
  'use strict';

  const BUTTON_ID =
    'moduleDashboardLauncher';

  const state = {
    observer: null,
    retryTimer: null,
    destroyed: false
  };

  document.addEventListener(
    'DOMContentLoaded',
    initializeDashboardLauncher
  );

  window.addEventListener(
    'beforeunload',
    destroyDashboardLauncher
  );

  function initializeDashboardLauncher() {
    ensureDashboardLauncher();

    state.observer =
      new MutationObserver(
        debounce(
          ensureDashboardLauncher,
          80
        )
      );

    state.observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );

    scheduleRetry();
  }


  function ensureDashboardLauncher() {
    if (state.destroyed) {
      return;
    }

    const existing =
      document.getElementById(
        BUTTON_ID
      );

    const target =
      resolveLauncherTarget();

    if (!target) {
      scheduleRetry();
      return;
    }

    if (existing) {
      if (
        existing.parentElement !==
        target
      ) {
        target.appendChild(
          existing
        );
      }

      syncLauncherHref(
        existing
      );

      return;
    }

    const button =
      createDashboardLauncher();

    target.appendChild(
      button
    );
  }


  function resolveLauncherTarget() {
    return (
      document.querySelector(
        '.module-command-bar .module-clock'
      ) ||
      document.querySelector(
        '.module-header .module-clock'
      ) ||
      document.querySelector(
        '.module-title-row .module-clock'
      ) ||
      document.querySelector(
        '.module-clock'
      ) ||
      document.querySelector(
        '.module-command-bar'
      ) ||
      document.querySelector(
        '.module-header__inner'
      )
    );
  }


  function createDashboardLauncher() {
    const button =
      document.createElement(
        'button'
      );

    button.id =
      BUTTON_ID;

    button.type =
      'button';

    button.className =
      'module-dashboard-launcher';

    button.setAttribute(
      'aria-label',
      'เปิด Dashboard'
    );

    button.setAttribute(
      'title',
      'เปิด Dashboard'
    );

    button.innerHTML = `
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          d="M4 20V10M10 20V4M16 20v-7M22 20H2"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>

      <span>
        Dashboard
      </span>
    `;

    button.addEventListener(
      'click',
      openDashboard
    );

    syncLauncherHref(
      button
    );

    return button;
  }


  function syncLauncherHref(button) {
    button.dataset.moduleId =
      getModuleId();
  }


  function openDashboard() {
    const moduleId =
      getModuleId();

    if (!moduleId) {
      return;
    }

    const dashboardUrl =
      new URL(
        './dashboard/index.html',
        window.location.href
      );

    dashboardUrl.searchParams.set(
      'module',
      moduleId
    );

    window.location.href =
      dashboardUrl.toString();
  }


  function getModuleId() {
    return String(
      new URL(
        window.location.href
      ).searchParams.get(
        'id'
      ) ||
      ''
    ).trim();
  }


  function scheduleRetry() {
    if (
      state.destroyed ||
      state.retryTimer
    ) {
      return;
    }

    state.retryTimer =
      window.setTimeout(
        () => {
          state.retryTimer = null;
          ensureDashboardLauncher();
        },
        350
      );
  }


  function debounce(
    fn,
    delay
  ) {
    let timer = null;

    return function (...args) {
      window.clearTimeout(
        timer
      );

      timer =
        window.setTimeout(
          () => {
            timer = null;
            fn(...args);
          },
          delay
        );
    };
  }


  function destroyDashboardLauncher() {
    state.destroyed = true;

    if (state.observer) {
      state.observer.disconnect();
    }

    if (state.retryTimer) {
      window.clearTimeout(
        state.retryTimer
      );
    }
  }

})(window, document);
