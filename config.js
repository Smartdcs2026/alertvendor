/**
 * config.js
 * การตั้งค่าฝั่ง Frontend
 *
 * ห้ามใส่ Secret ทุกชนิดในไฟล์นี้
 * ROUND 06 PART 01: Inbound SLA Alert Rules
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

    /*
     * หน้า Inbound ต้องใช้แหล่งข้อมูลเดียวกันทั้ง ADMIN และ INBOUND
     * โดยยึดโมดูลหน้างานจริง: Vendor ทั่วไป
     */
    INBOUND_FORCE_CANONICAL_MODULE:
      true,

    INBOUND_CANONICAL_MODULE_NAME:
      'สถานะรถ Vendor ทั่วไป',

    INBOUND_CANONICAL_MODULE_KEYWORDS:
      [
        'VENDOR',
        'ทั่วไป'
      ],

    /*
     * Round 06 Part 01:
     * SLA / Alert rules สำหรับหน้า Inbound
     * warningMinutes = เริ่มเตือน
     * criticalMinutes = วิกฤต/ควรเร่งดำเนินการ
     */
    INBOUND_SLA_RULES:
      {
        DOCUMENT_SUBMITTED: {
          warningMinutes: 60,
          criticalMinutes: 120,
          label: 'รอรับสินค้า'
        },

        RECEIVING_COMPLETED: {
          warningMinutes: 15,
          criticalMinutes: 30,
          label: 'รอรับเอกสารคืน'
        },

        DOCUMENT_RETURNED: {
          warningMinutes: 30,
          criticalMinutes: 60,
          label: 'รอ Gate Out'
        }
      },

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
