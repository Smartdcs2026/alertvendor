/**
 * dashboard-config.js
 * ROUND 05 HOTFIX 30 — Dashboard Session Key v2
 */
(function (window) {
  'use strict';

  window.DASHBOARD_CONFIG = Object.freeze({
    API_BASE:
      'https://alertvendor.somchaibutphon.workers.dev',

    /*
     * ต้องตรงกับ config.js หลัก
     * ไม่เช่นนั้น Dashboard จะหา session ไม่เจอ แล้วเด้งกลับหน้า Login/Index
     */
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

    REFRESH_SECONDS:
      15,

    ACTIVE_RECORD_LIMIT:
      5000
  });
})(window);
