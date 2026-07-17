/**
 * inbound-status-compact.js
 * INBOUND ROLE ACCESS HOTFIX — Canonical Module Bootstrap
 *
 * Purpose:
 * - หน้า Inbound อนุญาตเฉพาะ ADMIN และ INBOUND ตาม inbound.js เดิม
 * - หลีกเลี่ยงการเรียก Generic /api/modules สำหรับสิทธิ์ INBOUND
 *   เพราะ Generic Module API ถูกปิดตามนโยบายสิทธิ์
 * - คืนเฉพาะ Module หน้างานจริงให้หน้า Inbound ก่อน DOMContentLoaded
 * - ไม่ลดระดับการตรวจสิทธิ์ฝั่ง Worker หรือ Apps Script
 */
(function (window) {
  'use strict';

  const VERSION =
    '2026.07.17-inbound-role-canonical-module-hotfix-v1';

  const CONFIG =
    window.APP_CONFIG || {};

  const API =
    window.VehicleAPI;

  function cleanText(value) {
    if (value === null || value === undefined) {
      return '';
    }

    return String(value).trim();
  }

  function queryModuleId() {
    try {
      const params =
        new URLSearchParams(
          window.location.search || ''
        );

      return cleanText(
        params.get('module') ||
        params.get('id') ||
        ''
      );
    } catch (error) {
      return '';
    }
  }

  function canonicalInboundModule() {
    const moduleId =
      cleanText(
        CONFIG.INBOUND_DEFAULT_MODULE_ID
      ) ||
      queryModuleId() ||
      'vendors';

    const moduleName =
      cleanText(
        CONFIG.INBOUND_CANONICAL_MODULE_NAME
      ) ||
      'สถานะรถ Vendor ทั่วไป';

    return Object.freeze({
      moduleId: moduleId,
      id: moduleId,
      name: moduleName,
      moduleName: moduleName,
      status: 'ACTIVE',
      published: true,
      accessScope: 'INBOUND_CANONICAL'
    });
  }

  if (
    !API ||
    typeof API.getModules !== 'function'
  ) {
    console.error(
      '[InboundRoleHotfix] ไม่พบ VehicleAPI.getModules'
    );

    window.InboundStatusCompact =
      Object.freeze({
        version: VERSION,
        ready: false,
        reason: 'VEHICLE_API_NOT_READY'
      });

    return;
  }

  const originalGetModules =
    API.getModules.bind(API);

  API.getModules =
    async function getInboundScopedModules() {
      /*
       * หน้า Inbound ปัจจุบันถูกกำหนดให้ใช้ Module หน้างานจริงเพียงชุดเดียว
       * จึงไม่ต้องเปิดสิทธิ์ Generic Module API ให้บัญชี INBOUND
       */
      if (
        CONFIG.INBOUND_FORCE_CANONICAL_MODULE === true
      ) {
        return [
          canonicalInboundModule()
        ];
      }

      return originalGetModules();
    };

  window.InboundStatusCompact =
    Object.freeze({
      version: VERSION,
      ready: true,
      canonicalModule:
        canonicalInboundModule()
    });
})(window);
