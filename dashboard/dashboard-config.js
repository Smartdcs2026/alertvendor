/**
 * dashboard-config.js
 * ROUND 28 — Executive Dashboard
 */
(function (window) {
  'use strict';

  window.DASHBOARD_CONFIG = Object.freeze({
    API_BASE:
      'https://alertvendor.somchaibutphon.workers.dev',

    TOKEN_STORAGE_KEY:
      'alertvendor_access_token',

    LOGIN_URL:
      '../login.html',

    MODULE_URL:
      '../module.html',

    API_TIMEOUT_MS:
      60000,

    REFRESH_SECONDS:
      15,

    ACTIVE_RECORD_LIMIT:
      5000
  });
})(window);
