/**
 * dashboard-config.js
 * PHASE 4A — Dashboard Single Snapshot + Reconciliation
 */
(function (window) {
  'use strict';

  window.DASHBOARD_CONFIG = Object.freeze({
    API_BASE:
      'https://alertvendor.somchaibutphon.workers.dev',

    TOKEN_STORAGE_KEY:
      'alertvendor_access_token_v2',

    LOGIN_URL:
      'https://smartdcs2026.github.io/alertvendor/login.html',

    MODULE_URL:
      'https://smartdcs2026.github.io/alertvendor/module.html',

    INBOUND_URL:
      'https://smartdcs2026.github.io/alertvendor/inbound.html',

    API_TIMEOUT_MS:
      60000,

    GET_RETRY_COUNT:
      2,

    GET_RETRY_BASE_MS:
      700,

    REFRESH_SECONDS:
      15,

    OPERATIONAL_BOARD_LIMIT:
      3000,

    LAST_GOOD_SNAPSHOT_TTL_MS:
      15 * 60 * 1000,

    SNAPSHOT_STALE_AFTER_MS:
      90 * 1000
  });
})(window);
