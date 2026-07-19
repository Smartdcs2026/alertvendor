'use strict';

/************************************************************
 * receiving.js
 * ROUND 11 REVISION 2 — Receiving Production One-Click
 *
 * หน้าที่ของ Browser
 * 1) จับเวลา ณ ตอนกด
 * 2) เก็บคำสั่งในเครื่องก่อนส่ง Network
 * 3) นำการ์ดออกจากงานที่ต้องทำทันที
 * 4) ส่งคำสั่งไป Server และตรวจสถานะเงียบ ๆ
 *
 * Browser ไม่ประมวลผล Workflow และไม่เปิด Popup ขวางงาน
 ************************************************************/

(function (window, document) {
  const BUILD = '2026.07.20-round11-revision2-receiving-one-click-v1';
  const STORAGE_PREFIX = 'alertvendor:receiving-command:v2:';
  const MAX_ITEM_AGE_MS = 24 * 60 * 60 * 1000;
  const SEND_RETRY_MIN_MS = 2500;
  const SEND_RETRY_MAX_MS = 60000;
  const STATUS_POLL_MS = 12000;
  const LOOP_MS = 2500;
  const pending = new Map();
  let loopTimer = null;
  let loopRunning = false;

  const PERMANENT_CODES = new Set([
    'AUTH_REQUIRED',
    'FORBIDDEN',
    'MODULE_ID_REQUIRED',
    'INVALID_RECORD_ID',
    'RECORD_NOT_FOUND',
    'STALE_RECORD',
    'SOURCE_RECORD_CHANGED',
    'RECORD_ALREADY_OUT',
    'NOT_CURRENTLY_IN_AREA',
    'DOCUMENT_NOT_SUBMITTED',
    'RECEIVING_NOT_ALLOWED',
    'RECEIVING_DISABLED',
    'RECEIVING_COMMAND_REJECTED'
  ]);

  function initialize() {
    document.body.dataset.receivingUiBuild = BUILD;
    injectUi();
    loadPending();
    document.addEventListener('click', handleClick, true);
    window.addEventListener('online', scheduleLoopNow);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') scheduleLoopNow();
    });
    applyPendingToBoard();
    updateStrip();
    scheduleLoopNow();
  }

  async function handleClick(event) {
    const button = event.target && event.target.closest
      ? event.target.closest('.receiving-complete-button')
      : null;
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    if (button.disabled || button.dataset.canComplete === 'FALSE') return;

    const moduleId = getModuleId();
    const recordId = String(button.dataset.recordId || '').trim();
    if (!moduleId || !recordId) {
      showToast('error', 'ไม่พบข้อมูลรถสำหรับรับสินค้าเสร็จ');
      return;
    }

    const existing = findPendingByRecord(recordId);
    if (existing) {
      showToast('info', 'รายการนี้รับคำสั่งแล้ว ไม่ต้องกดซ้ำ');
      return;
    }

    const record = getRecord(recordId) || {};
    const clickedAtEpochMs = getServerSyncedNow();
    const command = {
      requestId: createRequestId(moduleId, recordId, clickedAtEpochMs),
      moduleId: moduleId,
      recordId: recordId,
      canonicalRecordId: String(
        button.dataset.canonicalRecordId || record.canonicalRecordId || ''
      ).trim(),
      sourceRowNumber: Number(
        button.dataset.sourceRowNumber || record.sourceRowNumber || 0
      ) || 0,
      expectedTimestampIn: String(
        button.dataset.expectedTimestampIn || record.timestampIn || ''
      ).trim(),
      expectedTimestampInEpochMs: Number(
        button.dataset.expectedTimestampInEpochMs || record.timestampInEpochMs || 0
      ) || 0,
      expectedPrimaryValue: String(
        button.dataset.expectedPrimaryValue || record.primaryValue || ''
      ).trim(),
      entryCode: String(
        button.dataset.entryCode || record.autoId || record.sourceAutoId || ''
      ).trim(),
      autoId: String(
        button.dataset.entryCode || record.autoId || record.sourceAutoId || ''
      ).trim(),
      clientRequestId: '',
      clientActionAtEpochMs: clickedAtEpochMs,
      receivingCompleteAt: formatDateTime(clickedAtEpochMs),
      createdAtEpochMs: Date.now(),
      updatedAtEpochMs: Date.now(),
      status: 'LOCAL_ACCEPTED',
      sendAttempts: 0,
      nextSendAtEpochMs: Date.now(),
      nextStatusAtEpochMs: 0,
      serverAccepted: false,
      lastCode: '',
      lastMessage: ''
    };
    command.clientRequestId = command.requestId;

    pending.set(command.requestId, command);
    persistPending();
    setButtonsForRecord(recordId, true);
    dispatchAccepted(command);
    closeDetailModal();
    updateStrip();

    showToast(
      'success',
      'รับสินค้าเสร็จ ' +
        (command.expectedPrimaryValue || command.entryCode || '') +
        ' เวลา ' + timeOnly(clickedAtEpochMs) +
        ' — ทำรายการคันถัดไปได้'
    );

    void submitCommand(command);
  }

  async function submitCommand(command) {
    if (!command || command.inFlight === true || !navigator.onLine) return;
    if (!window.VehicleAPI || typeof window.VehicleAPI.completeReceiving !== 'function') {
      command.lastCode = 'API_NOT_READY';
      scheduleSendRetry(command);
      return;
    }

    command.inFlight = true;
    command.status = command.serverAccepted ? 'SERVER_ACCEPTED' : 'SENDING';
    command.sendAttempts = Number(command.sendAttempts || 0) + 1;
    command.updatedAtEpochMs = Date.now();
    persistPending();
    updateStrip();

    try {
      const result = await window.VehicleAPI.completeReceiving(
        command.moduleId,
        commandPayload(command)
      );

      const code = normalizeCode(result && result.code);
      if (result && (result.rejected === true || result.review === true || isPermanentCode(code))) {
        rejectCommand(command, code, result.message || 'ไม่สามารถบันทึกรายการนี้ได้');
        return;
      }

      if (result && (
        result.queueAccepted === true ||
        result.commandAccepted === true ||
        result.accepted === true ||
        result.committed === true ||
        result.completed === true
      )) {
        command.serverAccepted = true;
        command.status = result.completed === true || result.committed === true
          ? 'DONE'
          : 'SERVER_ACCEPTED';
        command.receivingCompleteAt = String(
          result.receivingCompleteAt || command.receivingCompleteAt
        );
        command.lastCode = code || 'RECEIVING_COMMAND_ACCEPTED';
        command.lastMessage = String(result.message || 'รับคำสั่งแล้ว');
        command.nextStatusAtEpochMs = Date.now() + 2500;
        command.updatedAtEpochMs = Date.now();
        persistPending();

        if (command.status === 'DONE') {
          completeCommand(command, result);
        } else {
          updateStrip();
          scheduleLoopNow();
        }
        return;
      }

      command.lastCode = code || 'UNKNOWN_RESPONSE';
      command.lastMessage = String(result && result.message || 'ระบบยังไม่ยืนยันคำสั่ง');
      scheduleSendRetry(command);
    } catch (error) {
      const code = normalizeCode(error && (error.code || error.apiCode));
      if (isPermanentCode(code)) {
        rejectCommand(command, code, error.message || 'ไม่สามารถบันทึกรายการนี้ได้');
        return;
      }

      /* Timeout อาจเกิดหลัง Server append สำเร็จแล้ว จึงตรวจสถานะก่อนส่งซ้ำ */
      command.lastCode = code || 'NETWORK_OR_TIMEOUT';
      command.lastMessage = String(error && error.message || 'การเชื่อมต่อไม่เสถียร');
      command.status = command.serverAccepted ? 'SERVER_ACCEPTED' : 'VERIFYING';
      command.nextStatusAtEpochMs = Date.now() + 1500;
      command.nextSendAtEpochMs = Date.now() + retryDelay(command.sendAttempts);
      command.updatedAtEpochMs = Date.now();
      persistPending();
      updateStrip();
      scheduleLoopNow();
    } finally {
      command.inFlight = false;
    }
  }

  async function pollCommand(command) {
    if (!command || command.status === 'DONE' || command.inFlight === true || !navigator.onLine) return;
    if (!window.VehicleAPI || typeof window.VehicleAPI.getReceivingCommitStatus !== 'function') return;

    command.inFlight = true;
    command.status = 'VERIFYING';
    command.updatedAtEpochMs = Date.now();
    persistPending();

    try {
      const result = await window.VehicleAPI.getReceivingCommitStatus(
        command.moduleId,
        commandPayload(command)
      );
      const code = normalizeCode(result && result.code);

      if (result && (result.rejected === true || result.review === true || isPermanentCode(code))) {
        rejectCommand(command, code, result.message || 'คำสั่งนี้ไม่สามารถบันทึกได้');
        return;
      }

      if (result && (result.completed === true || result.done === true || result.committed === true)) {
        completeCommand(command, result);
        return;
      }

      if (result && (result.found === true || result.queueAccepted === true || result.commandAccepted === true)) {
        command.serverAccepted = true;
        command.status = 'SERVER_ACCEPTED';
        command.lastCode = code || 'RECEIVING_COMMAND_PENDING';
        command.lastMessage = String(result.message || 'ระบบกำลังบันทึกข้อมูลส่วนกลาง');
        command.nextStatusAtEpochMs = Date.now() + STATUS_POLL_MS;
        command.updatedAtEpochMs = Date.now();
        persistPending();
        updateStrip();
        return;
      }

      if (!command.serverAccepted && Date.now() >= Number(command.nextSendAtEpochMs || 0)) {
        command.status = 'LOCAL_ACCEPTED';
      } else {
        command.nextStatusAtEpochMs = Date.now() + STATUS_POLL_MS;
      }
      persistPending();
    } catch (error) {
      const code = normalizeCode(error && (error.code || error.apiCode));
      if (isPermanentCode(code)) {
        rejectCommand(command, code, error.message || 'คำสั่งนี้ไม่สามารถบันทึกได้');
        return;
      }
      command.lastCode = code || 'STATUS_CHECK_FAILED';
      command.status = command.serverAccepted ? 'SERVER_ACCEPTED' : 'LOCAL_ACCEPTED';
      command.nextStatusAtEpochMs = Date.now() + STATUS_POLL_MS;
      command.updatedAtEpochMs = Date.now();
      persistPending();
    } finally {
      command.inFlight = false;
      updateStrip();
    }
  }

  function completeCommand(command, result) {
    command.status = 'DONE';
    command.updatedAtEpochMs = Date.now();
    dispatchCommitted(command, result || {});
    pending.delete(command.requestId);
    persistPending();
    updateStrip();
    scheduleBoardRevisionCheck();
  }

  function rejectCommand(command, code, message) {
    pending.delete(command.requestId);
    persistPending();
    setButtonsForRecord(command.recordId, false);
    dispatchRejected(command, code, message);
    updateStrip();
    showToast(
      'error',
      (message || 'ไม่สามารถบันทึกรับสินค้าเสร็จได้') +
        (code ? ' [' + code + ']' : '')
    );
    scheduleBoardRefresh();
  }

  function scheduleSendRetry(command) {
    command.status = command.serverAccepted ? 'SERVER_ACCEPTED' : 'LOCAL_ACCEPTED';
    command.nextSendAtEpochMs = Date.now() + retryDelay(command.sendAttempts);
    command.nextStatusAtEpochMs = Date.now() + 1500;
    command.updatedAtEpochMs = Date.now();
    persistPending();
    updateStrip();
    scheduleLoopNow();
  }

  async function processLoop() {
    if (loopRunning) return;
    loopRunning = true;
    try {
      const now = Date.now();
      const items = Array.from(pending.values());
      for (const command of items) {
        if (now - Number(command.createdAtEpochMs || now) > MAX_ITEM_AGE_MS) {
          rejectCommand(
            command,
            'COMMAND_EXPIRED',
            'คำสั่งค้างเกิน 24 ชั่วโมง กรุณาตรวจสอบกับ Admin'
          );
          continue;
        }
        if (!navigator.onLine || command.inFlight === true) continue;

        if (
          command.serverAccepted === true &&
          now >= Number(command.nextStatusAtEpochMs || 0)
        ) {
          await pollCommand(command);
          continue;
        }

        if (
          command.serverAccepted !== true &&
          now >= Number(command.nextStatusAtEpochMs || 0) &&
          command.sendAttempts > 0
        ) {
          await pollCommand(command);
          if (command.serverAccepted === true || command.status === 'DONE') continue;
        }

        if (
          command.serverAccepted !== true &&
          now >= Number(command.nextSendAtEpochMs || 0)
        ) {
          await submitCommand(command);
        }
      }
    } finally {
      loopRunning = false;
      scheduleLoop();
    }
  }

  function scheduleLoopNow() {
    if (loopTimer) window.clearTimeout(loopTimer);
    loopTimer = window.setTimeout(processLoop, 100);
  }

  function scheduleLoop() {
    if (loopTimer) window.clearTimeout(loopTimer);
    loopTimer = window.setTimeout(processLoop, LOOP_MS);
  }

  function commandPayload(command) {
    return {
      recordId: command.recordId,
      canonicalRecordId: command.canonicalRecordId,
      sourceRowNumber: command.sourceRowNumber,
      expectedTimestampIn: command.expectedTimestampIn,
      expectedTimestampInEpochMs: command.expectedTimestampInEpochMs,
      expectedPrimaryValue: command.expectedPrimaryValue,
      entryCode: command.entryCode,
      autoId: command.autoId,
      clientActionAtEpochMs: command.clientActionAtEpochMs,
      queuedAt: command.clientActionAtEpochMs,
      clientOfflineAtClick: navigator.onLine !== true,
      clientRequestId: command.requestId,
      requestId: command.requestId
    };
  }

  function dispatchAccepted(command) {
    const detail = transitionDetail(command);
    if (
      window.VehicleModule &&
      typeof window.VehicleModule.applyReceivingAccepted === 'function'
    ) {
      window.VehicleModule.applyReceivingAccepted(detail);
    } else {
      document.dispatchEvent(new CustomEvent('alertvendor:receiving-accepted', { detail }));
    }
  }

  function dispatchCommitted(command, result) {
    const detail = Object.assign(transitionDetail(command), { result: result || {} });
    if (
      window.VehicleModule &&
      typeof window.VehicleModule.applyReceivingCommitted === 'function'
    ) {
      window.VehicleModule.applyReceivingCommitted(detail);
    } else {
      document.dispatchEvent(new CustomEvent('alertvendor:receiving-committed', { detail }));
    }
  }

  function dispatchRejected(command, code, message) {
    const detail = Object.assign(transitionDetail(command), {
      code: code || 'RECEIVING_COMMAND_REJECTED',
      message: message || 'ไม่สามารถบันทึกได้'
    });
    if (
      window.VehicleModule &&
      typeof window.VehicleModule.applyReceivingRejected === 'function'
    ) {
      window.VehicleModule.applyReceivingRejected(detail);
    } else {
      document.dispatchEvent(new CustomEvent('alertvendor:receiving-rejected', { detail }));
    }
  }

  function transitionDetail(command) {
    return {
      requestId: command.requestId,
      moduleId: command.moduleId,
      recordId: command.recordId,
      canonicalRecordId: command.canonicalRecordId,
      sourceRowNumber: command.sourceRowNumber,
      autoId: command.autoId || command.entryCode,
      receivingCompleteAt: command.receivingCompleteAt,
      receivingCompleteEpochMs: command.clientActionAtEpochMs,
      hideFromReceivingWorkspace: true
    };
  }

  function applyPendingToBoard() {
    pending.forEach(function (command) {
      dispatchAccepted(command);
      setButtonsForRecord(command.recordId, true);
    });
  }

  function setButtonsForRecord(recordId, disabled) {
    const safe = cssEscape(recordId);
    document.querySelectorAll(
      '.receiving-complete-button[data-record-id="' + safe + '"]'
    ).forEach(function (button) {
      button.disabled = disabled === true;
      button.setAttribute('aria-disabled', disabled === true ? 'true' : 'false');
      button.dataset.receivingCommandPending = disabled === true ? 'TRUE' : 'FALSE';
      if (disabled === true) button.textContent = 'รับคำสั่งแล้ว';
    });
  }

  function updateStrip() {
    const strip = document.getElementById('receivingCommandStrip');
    if (!strip) return;
    const count = pending.size;
    if (!count) {
      strip.hidden = true;
      strip.dataset.state = 'IDLE';
      strip.textContent = '';
      return;
    }

    const offline = navigator.onLine !== true;
    const waitingServer = Array.from(pending.values()).filter(function (item) {
      return item.serverAccepted !== true;
    }).length;
    strip.hidden = false;
    strip.dataset.state = offline ? 'OFFLINE' : 'SYNCING';
    strip.innerHTML =
      '<strong>' + (offline ? 'เก็บคำสั่งในเครื่อง' : 'กำลังยืนยันด้านหลัง') + '</strong>' +
      '<span>' + count + ' รายการ' +
      (waitingServer ? ' · รอส่ง ' + waitingServer : '') +
      ' · ไม่ต้องกดซ้ำ</span>';
  }

  function injectUi() {
    if (!document.getElementById('receivingCommandStrip')) {
      const strip = document.createElement('div');
      strip.id = 'receivingCommandStrip';
      strip.className = 'receiving-command-strip';
      strip.hidden = true;
      const main = document.querySelector('main');
      if (main) main.insertBefore(strip, main.firstChild);
      else document.body.appendChild(strip);
    }

    if (!document.getElementById('receivingCommandToastRoot')) {
      const root = document.createElement('div');
      root.id = 'receivingCommandToastRoot';
      root.className = 'receiving-command-toast-root';
      root.setAttribute('aria-live', 'polite');
      document.body.appendChild(root);
    }
  }

  function showToast(type, message) {
    const root = document.getElementById('receivingCommandToastRoot');
    if (!root) return;
    const toast = document.createElement('div');
    toast.className = 'receiving-command-toast is-' + String(type || 'info');
    toast.innerHTML =
      '<span aria-hidden="true">' +
      (type === 'success' ? '✓' : type === 'error' ? '!' : '•') +
      '</span><p>' + escapeHtml(message) + '</p>';
    root.appendChild(toast);
    window.setTimeout(function () {
      toast.classList.add('is-leaving');
      window.setTimeout(function () { toast.remove(); }, 250);
    }, type === 'error' ? 7000 : 3600);
  }

  function loadPending() {
    pending.clear();
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey()) || '{}');
      const now = Date.now();
      Object.keys(parsed).forEach(function (requestId) {
        const item = parsed[requestId];
        if (!item || now - Number(item.createdAtEpochMs || 0) > MAX_ITEM_AGE_MS) return;
        item.inFlight = false;
        pending.set(requestId, item);
      });
    } catch (error) {
      localStorage.removeItem(storageKey());
    }
  }

  function persistPending() {
    try {
      const data = {};
      pending.forEach(function (item, requestId) {
        const copy = Object.assign({}, item);
        delete copy.inFlight;
        data[requestId] = copy;
      });
      if (Object.keys(data).length) localStorage.setItem(storageKey(), JSON.stringify(data));
      else localStorage.removeItem(storageKey());
    } catch (error) {
      /* UI ยังทำงานต่อได้ */
    }
  }

  function findPendingByRecord(recordId) {
    return Array.from(pending.values()).find(function (item) {
      return String(item.recordId || '') === String(recordId || '');
    }) || null;
  }

  function storageKey() {
    return STORAGE_PREFIX + getModuleId();
  }

  function getModuleId() {
    return String(
      new URLSearchParams(window.location.search).get('id') ||
      new URLSearchParams(window.location.search).get('moduleId') ||
      document.body.dataset.moduleId ||
      ''
    ).trim().toLowerCase();
  }

  function getRecord(recordId) {
    if (window.VehicleModule && typeof window.VehicleModule.getRecord === 'function') {
      return window.VehicleModule.getRecord(recordId) || null;
    }
    return null;
  }

  function getServerSyncedNow() {
    if (window.VehicleModule && typeof window.VehicleModule.getServerTimeMs === 'function') {
      const value = Number(window.VehicleModule.getServerTimeMs());
      if (Number.isFinite(value) && value > 0) return value;
    }
    return Date.now();
  }

  function createRequestId(moduleId, recordId, epochMs) {
    const random = window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    return ['RCV2', moduleId, recordId, epochMs, random].join('|').slice(0, 200);
  }

  function retryDelay(attempt) {
    return Math.min(
      SEND_RETRY_MAX_MS,
      SEND_RETRY_MIN_MS * Math.pow(2, Math.min(5, Math.max(0, Number(attempt || 1) - 1)))
    );
  }

  function normalizeCode(value) {
    return String(value || '').trim().toUpperCase();
  }

  function isPermanentCode(code) {
    const clean = normalizeCode(code);
    if (PERMANENT_CODES.has(clean)) return true;
    return [
      'FORBIDDEN',
      'STALE',
      'NOT_FOUND',
      'ALREADY_OUT',
      'NOT_CURRENTLY_IN_AREA',
      'SOURCE_RECORD_CHANGED'
    ].some(function (token) { return clean.indexOf(token) >= 0; });
  }

  function scheduleBoardRevisionCheck() {
    window.setTimeout(function () {
      if (
        window.VehicleModule &&
        typeof window.VehicleModule.verifyOperationalBoardRevision === 'function'
      ) {
        window.VehicleModule.verifyOperationalBoardRevision(120);
      } else {
        document.dispatchEvent(new CustomEvent('alertvendor:check-operational-board-revision'));
      }
    }, 300);
  }

  function scheduleBoardRefresh() {
    window.setTimeout(function () {
      if (
        window.VehicleModule &&
        typeof window.VehicleModule.refreshOperationalBoard === 'function'
      ) {
        void window.VehicleModule.refreshOperationalBoard(true);
      } else {
        document.dispatchEvent(new CustomEvent('alertvendor:refresh-operational-board'));
      }
    }, 250);
  }

  function closeDetailModal() {
    try {
      if (window.Swal && typeof window.Swal.close === 'function') window.Swal.close();
    } catch (error) {}
  }

  function formatDateTime(epochMs) {
    const date = new Date(Number(epochMs) || Date.now());
    const pad = function (value) { return String(value).padStart(2, '0'); };
    return [pad(date.getDate()), pad(date.getMonth() + 1), date.getFullYear()].join('/') +
      ' ' + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(':');
  }

  function timeOnly(epochMs) {
    return formatDateTime(epochMs).slice(-8);
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value || ''));
    return String(value || '').replace(/["\\]/g, '\\$&');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }

  window.VehicleReceiving = Object.freeze({
    build: BUILD,
    getPendingCount: function () { return pending.size; },
    retryNow: scheduleLoopNow
  });
})(window, document);
