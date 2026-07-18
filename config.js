/**
 * config.js
 * การตั้งค่าฝั่ง Frontend
 *
 * ห้ามใส่ Secret ทุกชนิดในไฟล์นี้
 * R3R4 HOTFIX 02: Restore APP_CONFIG + canonical Inbound bootstrap
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

    /*
     * รหัส Module หลักที่หน้า Inbound ใช้งาน
     * ใช้เป็น Public Routing ID เท่านั้น ไม่ใช่ Secret
     */
    INBOUND_DEFAULT_MODULE_ID:
      'vendors',

    INBOUND_CANONICAL_MODULE_NAME:
      'สถานะรถ Vendor ทั่วไป',

    INBOUND_CANONICAL_MODULE_KEYWORDS:
      [
        'VENDOR',
        'ทั่วไป'
      ],

    /*
     * ROUND 03:
     * Frontend ไม่มีสิทธิ์กำหนดเกณฑ์ SLA ทางธุรกิจ
     * ทุกหน้าต้องใช้ effectiveSlaRules / rulesRevision จาก Server Response เท่านั้น
     */
    INBOUND_SLA_SOURCE:
      'SERVER_ONLY',

    /*
     * Phase 2A: Durable Pending Queue สำหรับหน้า Inbound
     * เก็บเฉพาะข้อมูลคำสั่งงาน ไม่เก็บ Token หรือ Secret
     */
    INBOUND_QUEUE_ENABLED:
      true,

    INBOUND_QUEUE_MAX_ITEMS:
      500,

    INBOUND_QUEUE_MAX_ATTEMPTS:
      12,

    INBOUND_QUEUE_RETRY_BASE_MS:
      3000,

    INBOUND_QUEUE_RETRY_MAX_MS:
      300000,

    INBOUND_QUEUE_AUTO_FLUSH_MS:
      15000,

    INBOUND_QUEUE_COMMITTED_RETENTION_HOURS:
      24,

    INBOUND_QUEUE_FAILED_RETENTION_DAYS:
      7,

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
