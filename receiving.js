/**
 * receiving.js
 * PHASE 3A — Idempotent Receiving Action + Ambiguous Result Recovery
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
    '2026.07.13-phase3a-receiving-idempotent-recovery';
  const PENDING_PREFIX =
    'alertvendor:receiving-pending:phase3a';
  const PENDING_TTL_MS =
    24 * 60 * 60 * 1000;

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

    cleanupExpiredPending();
    updatePendingIndicator();

    document.addEventListener(
      'click',
      handleClick
    );

    document.addEventListener(
      'alertvendor:records-updated',
      reconcilePendingFromCurrentBoard
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

    const boardState =
      getBoardState();

    if (!boardState.writable) {
      await showReadOnlyBoard(
        boardState
      );
      return;
    }

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
      const pendingKey =
        getPendingKey(
          moduleId,
          record,
          button,
          recordId
        );
      const previousPending =
        readPending(pendingKey);
      const requestId =
        previousPending &&
        previousPending.requestId ||
        createRequestId();

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
          'บันทึกรับสินค้าเสร็จจาก Unified Operational Board',
        clientRequestId:
          requestId,
        requestId:
          requestId
      };

      writePending(
        pendingKey,
        {
          moduleId,
          recordId,
          canonicalRecordId:
            payload.canonicalRecordId || '',
          entryCode:
            payload.entryCode || '',
          requestId,
          payload,
          createdAt:
            previousPending &&
            previousPending.createdAt ||
            Date.now(),
          updatedAt: Date.now()
        }
      );

      const result =
        await API.completeReceiving(
          moduleId,
          payload
        );

      removePending(pendingKey);

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
      const reconciled =
        await reconcileAmbiguousSave(
          recordId,
          record,
          button,
          error
        );

      if (!reconciled) {
        if (!isAmbiguousWriteError(error)) {
          removePendingByRecord(
            getModuleId(),
            recordId
          );
        }

        await showSaveError(error);
      }

    } finally {
      inFlight.delete(recordId);
      setButtonLoading(button, false);
    }
  }

  function getBoardState() {
    if (
      window.VehicleModule &&
      typeof window.VehicleModule.getBoardState === 'function'
    ) {
      return window.VehicleModule.getBoardState();
    }

    return {
      health: 'BLOCKED',
      writable: false
    };
  }

  async function showReadOnlyBoard(boardState) {
    const health = String(boardState && boardState.health || 'BLOCKED');
    const message = health === 'STALE'
      ? 'กำลังใช้ Snapshot สำรอง จึงปิดการบันทึกชั่วคราว กรุณากดโหลดใหม่เมื่ออินเทอร์เน็ตพร้อม'
      : health === 'INTEGRITY_ERROR'
        ? 'พบข้อมูลไม่สมดุล ระบบปิดการบันทึกเพื่อป้องกันการเปลี่ยนสถานะผิดคัน'
        : 'ระบบยังไม่สามารถยืนยันสถานะรถจาก Backend ได้';

    if (window.Swal) {
      await Swal.fire({
        icon: 'warning',
        title: 'หน้าจออยู่ในโหมดอ่านอย่างเดียว',
        text: message,
        confirmButtonText: 'รับทราบ'
      });
    }
  }

  function createRequestId() {
    if (
      window.crypto &&
      typeof window.crypto.randomUUID === 'function'
    ) {
      return window.crypto.randomUUID();
    }

    return 'recv-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 12);
  }

  function pendingStorageKey(key) {
    return PENDING_PREFIX + ':' + key;
  }

  function getPendingKey(moduleId, record, button, recordId) {
    const canonical = String(
      record && record.canonicalRecordId ||
      button && button.dataset.canonicalRecordId ||
      recordId || ''
    ).trim();

    return [
      String(moduleId || '').trim().toLowerCase(),
      canonical
    ].join('|');
  }

  function writePending(key, value) {
    try {
      window.localStorage.setItem(
        pendingStorageKey(key),
        JSON.stringify(value)
      );
    } catch (error) {
      console.warn('เก็บรายการ Receiving ที่รอยืนยันไม่สำเร็จ', error);
    }

    updatePendingIndicator();
  }

  function readPending(key) {
    try {
      const raw = window.localStorage.getItem(pendingStorageKey(key));
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function removePending(key) {
    try {
      window.localStorage.removeItem(pendingStorageKey(key));
    } catch (error) {
      console.warn('ล้างรายการ Receiving ที่ยืนยันแล้วไม่สำเร็จ', error);
    }

    updatePendingIndicator();
  }

  function listPending() {
    const items = [];

    try {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key || !key.startsWith(PENDING_PREFIX + ':')) continue;

        const raw = window.localStorage.getItem(key);
        if (!raw) continue;

        try {
          items.push({ storageKey: key, data: JSON.parse(raw) });
        } catch (error) {
          window.localStorage.removeItem(key);
        }
      }
    } catch (error) {
      console.warn('อ่านรายการ Receiving ที่รอยืนยันไม่สำเร็จ', error);
    }

    return items;
  }

  function cleanupExpiredPending() {
    const now = Date.now();

    listPending().forEach((item) => {
      const createdAt = Number(item.data && item.data.createdAt || 0);
      if (!createdAt || now - createdAt > PENDING_TTL_MS) {
        try { window.localStorage.removeItem(item.storageKey); } catch (error) {}
      }
    });
  }

  function updatePendingIndicator() {
    const moduleId = getModuleId();
    const count = listPending().filter((item) =>
      String(item.data && item.data.moduleId || '') === moduleId
    ).length;
    const node = document.getElementById('modulePendingWrites');

    if (node) {
      node.textContent = count > 0
        ? 'รอยืนยัน ' + count + ' รายการ'
        : 'ไม่มีรายการค้างส่ง';
      node.dataset.pending = count > 0 ? 'TRUE' : 'FALSE';
    }

    document.dispatchEvent(new CustomEvent(
      'alertvendor:receiving-pending-change',
      { detail: { moduleId, count } }
    ));
  }

  function removePendingByRecord(moduleId, recordId) {
    listPending().forEach((item) => {
      const data = item.data || {};
      if (
        String(data.moduleId || '') === String(moduleId || '') &&
        String(data.recordId || '') === String(recordId || '')
      ) {
        try { window.localStorage.removeItem(item.storageKey); } catch (error) {}
      }
    });
    updatePendingIndicator();
  }

  function isAmbiguousWriteError(error) {
    const code = String(error && error.code || '').toUpperCase();
    const status = Number(error && error.status || 0);

    return [
      'REQUEST_TIMEOUT',
      'NETWORK_ERROR',
      'GAS_TIMEOUT',
      'GAS_CONNECTION_FAILED',
      'EMPTY_RESPONSE',
      'INVALID_JSON_RESPONSE'
    ].includes(code) || status === 502 || status === 504 || status === 0;
  }

  async function reconcileAmbiguousSave(recordId, record, button, error) {
    if (!isAmbiguousWriteError(error)) {
      return false;
    }

    try {
      await refreshBoard();

      const current = window.VehicleModule &&
        typeof window.VehicleModule.getRecord === 'function'
          ? window.VehicleModule.getRecord(recordId)
          : null;

      const committed = Boolean(
        !current ||
        current.receivingCompleteAt ||
        String(current.operationalStage || '').toUpperCase() !== 'WAITING_RECEIVING'
      );

      if (!committed) {
        await showUnknownWriteResult(error);
        return true;
      }

      removePendingByRecord(getModuleId(), recordId);

      if (window.Swal) {
        await Swal.fire({
          icon: 'success',
          title: 'ระบบยืนยันผลการบันทึกแล้ว',
          text: 'การตอบกลับครั้งแรกขาดหาย แต่ Snapshot ล่าสุดยืนยันว่ารับสินค้าเสร็จแล้ว',
          confirmButtonText: 'ตกลง'
        });
      }

      return true;
    } catch (refreshError) {
      await showUnknownWriteResult(error);
      return true;
    }
  }

  async function showUnknownWriteResult(error) {
    if (!window.Swal) return;

    await Swal.fire({
      icon: 'warning',
      title: 'ยังยืนยันผลการบันทึกไม่ได้',
      html: `
        <p>เครือข่ายขาดหายระหว่างบันทึก ระบบเก็บรหัสคำขอเดิมไว้แล้ว</p>
        <p>เมื่อข้อมูลสดกลับมา ให้กดรายการเดิมอีกครั้ง ระบบจะส่งด้วยรหัสเดิมและไม่บันทึกซ้ำ</p>
        <p class="receiving-warning-code">${escapeHtml(
          error && error.code || 'UNKNOWN_WRITE_RESULT'
        )}</p>
      `,
      confirmButtonText: 'รับทราบ'
    });
  }

  function reconcilePendingFromCurrentBoard() {
    const moduleId = getModuleId();

    listPending().forEach((item) => {
      const data = item.data || {};
      if (String(data.moduleId || '') !== moduleId) return;

      const current = window.VehicleModule &&
        typeof window.VehicleModule.getRecord === 'function'
          ? window.VehicleModule.getRecord(data.recordId)
          : null;

      if (
        !current ||
        current.receivingCompleteAt ||
        String(current.operationalStage || '').toUpperCase() !== 'WAITING_RECEIVING'
      ) {
        try { window.localStorage.removeItem(item.storageKey); } catch (error) {}
      }
    });

    updatePendingIndicator();
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
