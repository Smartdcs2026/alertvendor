/**
 * dashboard-config.js
 * การตั้งค่าระบบ Dashboard แยก
 *
 * ไฟล์นี้ไม่มี Secret
 */
(function (window) {
  'use strict';

  window.DASHBOARD_CONFIG = Object.freeze({
    APP_NAME:
      'Vehicle Control Tower Dashboard',

    API_BASE:
      'https://alertvendor.somchaibutphon.workers.dev',

    TOKEN_STORAGE_KEY:
      'alertvendor_access_token',

    LOGIN_URL:
      '../login.html',

    MODULE_URL:
      '../module.html',

    TIMEZONE:
      'Asia/Bangkok',

    API_TIMEOUT_MS:
      60000,

    REFRESH_SECONDS:
      60,

    ACTIVE_RECORD_LIMIT:
      5000
  });
})(window);
