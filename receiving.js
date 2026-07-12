/**
 * receiving.js
 * PRODUCTION R15 — Consolidated Receiving Action Controller
 *
 * หน้าที่เฉพาะ:
 * - รับคลิกปุ่ม "บันทึกรับสินค้าเสร็จ"
 * - ตรวจสถานะจาก Unified Operational Board ที่ฝังอยู่ในการ์ด
 * - ส่งคำขอบันทึกเพียงครั้งเดียว
 * - รีเฟรช Operational Board หลังบันทึก
 *
 * ไฟล์นี้ไม่โหลด Receiving Flow แยก ไม่กรอง/ซ่อนการ์ด
 * และไม่ใช้ MutationObserver เพื่อหลีกเลี่ยง Race Condition
 */
(function (window, document) {
  'use strict';

  const API = window.VehicleAPI;
  const BUILD =
    '2026.07.12-r15-consolidated-action';

  const inFlight = new Set();

  document.addEventListener(
    'DOMContentLoaded',
    initialize
  );

  function initialize() {
    if (document.body) {
      document.body.dataset.receivingUiBuild =
        BUILD;
    }

    document.addEventListener(
      'click',
      handleClick
    );
  }

  async function handleClick(event) {
    const button =
      event.target.closest(
        '.receiving-complete-button'
      );

    if (!button) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const stage =
      String(
        button.dataset.operationalStage ||
        ''
      ).toUpperCase();

    const allowed =
      button.dataset.canComplete ===
        'TRUE' &&
      stage === 'WAITING_RECEIVING' &&
      !button.disabled;

    if (!allowed) {
      await showBlocked(button, stage);
      return;
    }

    const recordId =
      String(
        button.dataset.recordId ||
        ''
      );

    if (
      !recordId ||
      inFlight.has(recordId)
    ) {
      return;
    }

    const record =
      window.VehicleModule &&
      typeof window.VehicleModule
        .getRecord === 'function'
        ? window.VehicleModule
            .getRecord(recordId)
        : null;

    const confirmed =
      await confirmReceiving(
        record,
        button
      );

    if (!confirmed) {
      return;
    }

    await saveReceiving(
      recordId,
      record,
      button
    );
  }

  async function confirmReceiving(
    record,
    button
  ) {
    if (!window.Swal) {
      return window.confirm(
        'ยืนยันบันทึกรับสินค้าเสร็จ?'
      );
    }

    const appointment =
      record && (
        record.appointmentNumber ||
        record.appointment
      ) ||
      record && record.primaryValue ||
      button.dataset.expectedPrimaryValue ||
      '-';
    const company =
      record && (
        record.companyName ||
        record.company
      ) ||
      '-';
    const timestampIn =
      record && record.timestampIn ||
      button.dataset.expectedTimestampIn ||
      '-';
    const entryShift =
      record && record.entryShiftCode ||
      '-';
    const ownerShift =
      record && record.ownerShiftCode ||
      '-';
    const documentSubmittedAt =
      record && record.documentSubmittedAt ||
      '-';

    const result = await Swal.fire({
      icon: 'question',
      title: 'ยืนยันรับสินค้าเสร็จ',
      html: `
        <div class="receiving-confirm-grid">
          <div><span>เลขนัดหมาย</span><strong>${escapeHtml(appointment)}</strong></div>
          <div><span>บริษัท</span><strong>${escapeHtml(company)}</strong></div>
          <div><span>เวลาเข้าพื้นที่</span><strong>${escapeHtml(timestampIn)}</strong></div>
          <div><span>ยื่นเอกสาร</span><strong>${escapeHtml(documentSubmittedAt)}</strong></div>
          <div><span>กะเข้า</span><strong>${escapeHtml(entryShift)}</strong></div>
          <div><span>กะผู้รับผิดชอบ</span><strong>${escapeHtml(ownerShift)}</strong></div>
        </div>
        <p class="receiving-confirm-note">
          ระบบจะใช้เวลาจาก Server และเปลี่ยนสถานะเป็น “รอรับเอกสารคืน”
        </p>
      `,
      showCancelButton: true,
      confirmButtonText:
        'บันทึกรับสินค้าเสร็จ',
      cancelButtonText: 'ยกเลิก',
      reverseButtons: true,
      focusCancel: true,
      allowOutsideClick: false
    });

    return result.isConfirmed === true;
  }

  async function saveReceiving(
    recordId,
    record,
    button
  ) {
    if (
      !API ||
      typeof API.completeReceiving !==
        'function'
    ) {
      await showError(
        'ไม่พบ API สำหรับบันทึกรับสินค้าเสร็จ',
        'RECEIVING_API_MISSING'
      );
      return;
    }

    const moduleId = getModuleId();

    if (!moduleId) {
      await showError(
        'ไม่พบรหัส Module',
        'MODULE_ID_MISSING'
      );
      return;
    }

    inFlight.add(recordId);
    setButtonLoading(button, true);

    try {
      const payload = {
        recordId: recordId,
        sourceRowNumber:
          Number(
            record && record.sourceRowNumber ||
            button.dataset.sourceRowNumber
          ) || 0,
        expectedTimestampIn:
          record && record.timestampIn ||
          button.dataset.expectedTimestampIn ||
          '',
        expectedTimestampInEpochMs:
          Number(
            record && record.timestampInEpochMs ||
            button.dataset.expectedTimestampInEpochMs
          ) || 0,
        expectedPrimaryValue:
          record && record.primaryValue ||
          button.dataset.expectedPrimaryValue ||
          '',
        entryCode:
          record && (
            record.autoId ||
            record.sourceAutoId
          ) ||
          button.dataset.entryCode ||
          '',
        canonicalRecordId:
          record && record.canonicalRecordId ||
          button.dataset.canonicalRecordId ||
          '',
        note:
          'บันทึกรับสินค้าเสร็จจาก Unified Operational Board'
      };

      const result =
        await API.completeReceiving(
          moduleId,
          payload
        );

      const workflowSync =
        result && result.workflowSync ||
        null;

      if (
        workflowSync &&
        workflowSync.success === false
      ) {
        await showWorkflowWarning(
          result,
          workflowSync
        );
      } else {
        await showSuccess(result);
      }

      await refreshBoard();

    } catch (error) {
      await showSaveError(error);

    } finally {
      inFlight.delete(recordId);
      setButtonLoading(button, false);
    }
  }

  async function refreshBoard() {
    if (
      window.VehicleModule &&
      typeof window.VehicleModule
        .refreshOperationalBoard ===
        'function'
    ) {
      await window.VehicleModule
        .refreshOperationalBoard(true);
      return;
    }

    document.dispatchEvent(
      new CustomEvent(
        'alertvendor:refresh-operational-board'
      )
    );
  }

  async function showBlocked(
    button,
    stage
  ) {
    const messages = {
      WAITING_INBOUND_DOCUMENT:
        'ต้องให้ Inbound ยื่นเอกสารก่อน จึงจะบันทึกรับสินค้าเสร็จได้',
      WAITING_DOCUMENT_RETURN:
        'รายการนี้รับสินค้าเสร็จแล้ว กำลังรอ Inbound รับเอกสารคืน',
      WAITING_GATE_OUT:
        'รายการนี้รับเอกสารคืนแล้ว กำลังรอ Gate Out',
      DATA_CONFLICT:
        'ข้อมูลรายการนี้ไม่สอดคล้องกัน กรุณาให้ Admin ตรวจสอบ'
    };

    const message =
      messages[stage] ||
      button.title ||
      'สถานะปัจจุบันยังไม่พร้อมบันทึกรับสินค้าเสร็จ';

    if (window.Swal) {
      await Swal.fire({
        icon: 'warning',
        title: 'ยังไม่ถึงขั้นตอนรับสินค้าเสร็จ',
        text: message,
        confirmButtonText: 'ตกลง'
      });
    }
  }

  async function showSuccess(result) {
    const alreadyCompleted =
      result &&
      result.alreadyCompleted === true;

    if (window.Swal) {
      await Swal.fire({
        icon: 'success',
        title: alreadyCompleted
          ? 'รายการนี้บันทึกไว้แล้ว'
          : 'บันทึกรับสินค้าเสร็จแล้ว',
        text:
          result && result.message ||
          'ระบบเปลี่ยนสถานะเป็นรอรับเอกสารคืนแล้ว',
        confirmButtonText: 'ตกลง',
        timer: alreadyCompleted
          ? undefined
          : 1500,
        timerProgressBar:
          !alreadyCompleted
      });
    }
  }

  async function showWorkflowWarning(
    result,
    workflowSync
  ) {
    if (!window.Swal) {
      return;
    }

    await Swal.fire({
      icon: 'warning',
      title: 'บันทึกรับสินค้าแล้ว แต่ Workflow ยังไม่ซิงก์',
      html: `
        <p>${escapeHtml(
          result && result.message ||
          'บันทึก Receiving สำเร็จ'
        )}</p>
        <p class="receiving-warning-code">
          ${escapeHtml(
            workflowSync.code ||
            'WORKFLOW_SYNC_FAILED'
          )}
        </p>
        <p>${escapeHtml(
          workflowSync.message ||
          'ให้ Admin ตรวจสอบ Workflow Sync Repair'
        )}</p>
      `,
      confirmButtonText: 'รับทราบ'
    });
  }

  async function showSaveError(error) {
    const code =
      String(
        error && error.code ||
        'RECEIVING_SAVE_FAILED'
      );
    const message =
      String(
        error && error.message ||
        'บันทึกรับสินค้าเสร็จไม่สำเร็จ'
      );

    let guidance = '';

    if (code === 'RECEIVING_BUSY') {
      guidance =
        'ระบบกำลังเขียนข้อมูลอยู่ กรุณารอประมาณ 2 วินาทีแล้วกดใหม่';
    } else if (
      code === 'RECORD_CHANGED' ||
      code === 'RECORD_NO_LONGER_ACTIVE'
    ) {
      guidance =
        'ข้อมูลรายการเปลี่ยนแล้ว ระบบจะโหลด Snapshot ล่าสุดให้';
    } else if (
      code === 'DOCUMENT_SUBMIT_REQUIRED' ||
      code === 'WORKFLOW_STAGE_ORDER_INVALID'
    ) {
      guidance =
        'ให้ Inbound ยื่นเอกสารก่อน แล้วรีเฟรชข้อมูล';
    }

    if (window.Swal) {
      await Swal.fire({
        icon: 'error',
        title: 'บันทึกรับสินค้าเสร็จไม่สำเร็จ',
        html: `
          <p>${escapeHtml(message)}</p>
          ${guidance ? `<p>${escapeHtml(guidance)}</p>` : ''}
          <div class="receiving-error-code">รหัส: ${escapeHtml(code)}</div>
        `,
        confirmButtonText: 'ตกลง'
      });
    }

    if (
      code === 'RECORD_CHANGED' ||
      code === 'RECORD_NO_LONGER_ACTIVE' ||
      code === 'RECEIVING_ALREADY_COMPLETED'
    ) {
      await refreshBoard();
    }
  }

  async function showError(message, code) {
    if (window.Swal) {
      await Swal.fire({
        icon: 'error',
        title: 'ไม่สามารถดำเนินการได้',
        html: `
          <p>${escapeHtml(message)}</p>
          <div class="receiving-error-code">รหัส: ${escapeHtml(code)}</div>
        `,
        confirmButtonText: 'ตกลง'
      });
    }
  }

  function setButtonLoading(
    button,
    loading
  ) {
    if (!button) {
      return;
    }

    if (loading) {
      button.dataset.originalText =
        button.textContent || '';
      button.disabled = true;
      button.setAttribute(
        'aria-busy',
        'true'
      );
      button.textContent =
        'กำลังบันทึก...';
      return;
    }

    button.removeAttribute(
      'aria-busy'
    );

    if (button.isConnected) {
      button.textContent =
        button.dataset.originalText ||
        'บันทึกรับสินค้าเสร็จ';
      button.disabled =
        button.dataset.canComplete !==
        'TRUE';
    }
  }

  function getModuleId() {
    return String(
      new URLSearchParams(
        window.location.search
      ).get('id') ||
      new URLSearchParams(
        window.location.search
      ).get('moduleId') ||
      ''
    ).trim();
  }

  function escapeHtml(value) {
    const element =
      document.createElement('div');
    element.textContent =
      value === null ||
      value === undefined
        ? ''
        : String(value);
    return element.innerHTML;
  }
})(window, document);
