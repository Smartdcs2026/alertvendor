/**
 * module-workflow-guard.js
 * PRODUCTION R13 — Local Operational Stage Guard
 *
 * Guard นี้ไม่เรียก API แยกและไม่สร้าง/ซ่อนการ์ด
 * ใช้สถานะจาก Unified Operational Board Snapshot เดียวกับ module.js
 */
(function (window, document) {
  'use strict';

  const BUILD =
    '2026.07.12-r13-local-operational-stage-guard';

  document.addEventListener(
    'DOMContentLoaded',
    initialize
  );

  function initialize() {
    if (document.body) {
      document.body.dataset.workflowGuardBuild =
        BUILD;
    }

    document.addEventListener(
      'click',
      guardReceivingAction,
      true
    );
  }

  function guardReceivingAction(event) {
    const button =
      event.target.closest(
        '.receiving-complete-button'
      );

    if (!button) {
      return;
    }

    const stage =
      String(
        button.dataset.operationalStage ||
        ''
      ).toUpperCase();
    const allowed =
      stage === 'WAITING_RECEIVING' &&
      button.dataset.canComplete ===
        'TRUE' &&
      !button.disabled;

    if (allowed) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const message =
      guardMessage(stage);

    if (window.Swal) {
      void Swal.fire({
        icon: stage === 'DATA_CONFLICT'
          ? 'error'
          : 'warning',
        title: stage === 'DATA_CONFLICT'
          ? 'ข้อมูลรายการขัดแย้ง'
          : 'ยังไม่ถึงขั้นตอนรับสินค้าเสร็จ',
        text: message,
        confirmButtonText: 'ตกลง'
      });
    }
  }

  function guardMessage(stage) {
    const messages = {
      WAITING_INBOUND_DOCUMENT:
        'ต้องให้ Inbound สแกนยื่นเอกสารก่อน',
      WAITING_DOCUMENT_RETURN:
        'รายการนี้รับสินค้าเสร็จแล้ว กำลังรอรับเอกสารคืน',
      WAITING_GATE_OUT:
        'รายการนี้รับเอกสารคืนแล้ว กำลังรอ Gate Out',
      DATA_CONFLICT:
        'ข้อมูล Receiving, Workflow หรือ Gate Out ไม่สอดคล้องกัน กรุณาให้ Admin ตรวจสอบ'
    };

    return messages[stage] ||
      'สถานะปัจจุบันยังไม่พร้อมบันทึกรับสินค้าเสร็จ';
  }
})(window, document);
