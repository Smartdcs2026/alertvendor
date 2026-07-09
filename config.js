/**
 * config.js
 * การตั้งค่าฝั่ง Frontend
 *
 * ห้ามใส่ Secret ทุกชนิดในไฟล์นี้
 * ROUND 04: เพิ่มค่าใช้งานหน้า Inbound Scanner
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

    LOGIN_URL:
      './login.html',

    DASHBOARD_URL:
      './index.html',

    INBOUND_URL:
      './inbound.html',

    INBOUND_DEFAULT_MODULE_ID:
      '',

    API_TIMEOUT_MS:
      60000,

    AUTH_TIMEOUT_MS:
      45000,

    SAVE_TIMEOUT_MS:
      90000,

    INBOUND_LOOKUP_TIMEOUT_MS:
      60000,

    INBOUND_SAVE_TIMEOUT_MS:
      90000,

    TIMEZONE:
      'Asia/Bangkok',

    DATE_TIME_FORMAT:
      'dd/MM/yyyy HH:mm:ss'
  });

  window.APP_CONFIG = CONFIG;
})(window);
