/**
 * config.js
 * การตั้งค่าฝั่ง Frontend
 *
 * ห้ามใส่ Secret ทุกชนิดในไฟล์นี้
 * ROUND 05 HOTFIX 27: Canonical Login URL
 */
(function (window) {
  'use strict';

  const API_BASE =
    'https://alertvendor.somchaibutphon.workers.dev';

  const CONFIG = Object.freeze({
    APP_NAME:
      'ระบบติดตามสถานะรถและตู้สินค้า',

    API_BASE:
      String(API_BASE || '').replace(/\/+$/, ''),

    PUBLIC_BASE_URL:
      'https://smartdcs2026.github.io/alertvendor',

    LOGIN_URL:
      'https://smartdcs2026.github.io/alertvendor/login.html',

    DASHBOARD_URL:
      'https://smartdcs2026.github.io/alertvendor/index.html',

    INBOUND_URL:
      'https://smartdcs2026.github.io/alertvendor/inbound.html',

    TOKEN_STORAGE_KEY:
      'alertvendor_access_token_v2',

    SESSION_POLICY:
      'WINDOW_ISOLATED',

    API_TIMEOUT_MS:
      60000,

    AUTH_TIMEOUT_MS:
      45000,

    TIMEZONE:
      'Asia/Bangkok',

    DATE_TIME_FORMAT:
      'dd/MM/yyyy HH:mm:ss'
  });

  window.APP_CONFIG = CONFIG;
})(window);
