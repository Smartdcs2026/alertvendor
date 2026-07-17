/**
 * receiving.js
 * ROUND 3 — Card-level Progress + Durable Recovery
 *
 * - ป้องกันกดซ้ำใน Browser
 * - ใช้ clientRequestId เดิมทุกครั้ง
 * - Retry เฉพาะข้อผิดพลาดชั่วคราว
 * - ตรวจยืนยันผลกับ Server ก่อนแจ้งล้มเหลว
 * - เก็บคำขอไว้เมื่อ Network หลุดและส่งซ้ำเมื่อ Online
 * - อัปเดตการ์ดทันทีหลัง Commit โดยไม่รอโหลด Board ชุดใหญ่
 */
(function (window, document) {
  'use strict';

  const API = window.VehicleAPI;
  const BUILD =
    '2026.07.17-round3-card-progress-responsive';

  const MAX_COMMIT_ATTEMPTS = 3;
  const VERIFY_ATTEMPTS = 4;
  const PENDING_MAX_AGE_MS =
    48 * 60 * 60 * 1000;
  const STORAGE_PREFIX =
    'alertvendor:receiving-pending:v3:';
  const SYNC_STORAGE_PREFIX =
    'alertvendor:receiving-sync:v2:';
  const TAB_LEASE_PREFIX =
    'alertvendor:receiving-lease:v1:';
  const TAB_LEASE_MS = 45000;
  const RECOVERY_BATCH_SIZE = 10;

  const inFlight = new Set();
  let recoveryRunning = false;
  let workflowRecoveryRunning = false;

  const progressState = new Map();

  document.addEventListener(
    'DOMContentLoaded',
    initialize
  );
function initialize() {
    if (document.body) {
      document.body.dataset.receivingUiBuild = BUILD;
    }

    document.addEventListener('click', handleClick);

    window.addEventListener('online', () => {
      void recoverPendingRequests();
      void recoverPendingWorkflowSyncs();
    });

    window.setTimeout(() => {
      void recoverPendingRequests();
      void recoverPendingWorkflowSyncs();
    }, 700);
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
      stage ===
        'WAITING_RECEIVING' &&
      !button.disabled;

    if (!allowed) {
      await showBlocked(
        button,
        stage
      );
      return;
    }

    const recordId =
      String(
        button.dataset.recordId ||
        ''
      ).trim();

    if (
      !recordId ||
      inFlight.has(
        recordId
      )
    ) {
      return;
    }

    const record =
      window.VehicleModule &&
      typeof window.VehicleModule
        .getRecord ===
        'function'
        ? window.VehicleModule
            .getRecord(
              recordId
            )
        : null;

    const confirmed =
      await confirmReceiving(
        record,
        button
      );

    if (!confirmed) {
      return;
    }

    const payload =
      buildPayload(
        recordId,
        record,
        button
      );

    savePendingRequest(
      payload
    );

    await executeReceiving(
      payload,
      record,
      button,
      {
        interactive:
          true
      }
    );
  }

  function buildPayload(
    recordId,
    record,
    button
  ) {
    return {
      recordId:
        recordId,

      sourceRowNumber:
        Number(
          record &&
          record.sourceRowNumber ||
          button.dataset
            .sourceRowNumber
        ) || 0,

      expectedTimestampIn:
        record &&
        record.timestampIn ||
        button.dataset
          .expectedTimestampIn ||
        '',

      expectedTimestampInEpochMs:
        Number(
          record &&
          record.timestampInEpochMs ||
          button.dataset
            .expectedTimestampInEpochMs
        ) || 0,

      expectedPrimaryValue:
        record &&
        record.primaryValue ||
        button.dataset
          .expectedPrimaryValue ||
        '',

      entryCode:
        record &&
        (
          record.autoId ||
          record.sourceAutoId
        ) ||
        button.dataset.entryCode ||
        '',

      autoId:
        record &&
        (
          record.autoId ||
          record.sourceAutoId
        ) ||
        button.dataset.entryCode ||
        '',

      canonicalRecordId:
        record &&
        record.canonicalRecordId ||
        button.dataset
          .canonicalRecordId ||
        '',

      note:
        'บันทึกรับสินค้าเสร็จจาก Unified Operational Board',

      clientRequestId:
        createRequestId(),

      queuedAt:
        Date.now(),

      attempts: 0,
      nextAttemptAt: 0,
      status: 'PENDING',
      lastErrorCode: ''
    };
  }
async function executeReceiving(
    payload,
    record,
    button,
    options
  ) {
    const config =
      options && typeof options === 'object'
        ? options
        : {};
    const interactive = config.interactive !== false;
    const recordId = String(payload.recordId || '');

    if (!recordId || inFlight.has(recordId)) {
      return;
    }

    const moduleId = getModuleId();

    if (!moduleId) {
      removePendingRequest(recordId);
      if (interactive) {
        await showError('ไม่พบรหัส Module', 'MODULE_ID_MISSING');
      }
      return;
    }

    if (!API || typeof API.completeReceiving !== 'function') {
      if (interactive) {
        await showError(
          'ไม่พบ API สำหรับบันทึกรับสินค้าเสร็จ',
          'RECEIVING_API_MISSING'
        );
      }
      return;
    }

    const lease = acquireRecordLease(recordId,payload.clientRequestId);
    if (!lease.acquired) {
      setCardLiveStatus(
        recordId,
        'VERIFYING',
        'อีกแท็บกำลังส่งรายการนี้ ระบบจะตรวจยืนยันผลแทนการส่งซ้ำ'
      );
      const verified = await verifyCommit(moduleId,payload,recordId);
      if (verified && verified.completed === true) {
        removePendingRequest(recordId);
        applyCommittedState(recordId,verified,button);
        enqueueWorkflowSync(moduleId,payload,verified);
      }
      return;
    }

    inFlight.add(recordId);
    setButtonLoading(button, true);
    setCardLiveStatus(
      recordId,
      'SAVING',
      'กำลังตรวจสอบรายการและเตรียมบันทึก...'
    );

    if (interactive) {
      openSavingProgress(record, payload);
    }

    try {
      let result;
      updateSavingProgress(
        'PREPARE',
        'กำลังตรวจสอบข้อมูลล่าสุดและป้องกันข้อมูลซ้ำ',
        18,
        recordId
      );

      try {
        result = await commitWithRetry(moduleId, payload, recordId);
      } catch (error) {
        updateSavingProgress(
          'VERIFY',
          'คำตอบจาก Server ไม่แน่นอน กำลังตรวจยืนยันผลจริง',
          66,
          recordId
        );
        setCardLiveStatus(
          recordId,
          'VERIFYING',
          'กำลังตรวจสอบว่าคำขอถูกบันทึกแล้วหรือยัง...'
        );

        const verified = await verifyCommit(moduleId, payload, recordId);

        if (verified && verified.completed === true) {
          result = {
            success: true,
            committed: true,
            accepted: true,
            alreadyCompleted: true,
            verifiedAfterError: true,
            message: 'Server ยืนยันว่าบันทึกรับสินค้าเสร็จแล้ว',
            receivingCompleteAt: verified.receivingCompleteAt || '',
            receivingCompleteEpochMs:
              Number(verified.receivingCompleteEpochMs) || 0,
            requestId: verified.requestId || payload.clientRequestId,
            workflowSync: {
              success: false,
              pending: true,
              code: 'WORKFLOW_SYNC_PENDING'
            }
          };
        } else if (verified && verified.staleRecord === true) {
          result = verified;
        } else if (
          isTemporaryError(error) ||
          navigator.onLine === false
        ) {
          const nextAttempts = Number(payload.attempts || 0) + 1;
          savePendingRequest({
            ...payload,
            attempts: nextAttempts,
            status: isNetworkOrTimeoutError(error) ? 'UNKNOWN' : 'RETRY_WAIT',
            lastErrorCode: String(error && error.code || ''),
            lastErrorAt: Date.now(),
            nextAttemptAt: Date.now() + Math.max(900,retryDelay(error,nextAttempts))
          });
          closeSavingProgress(recordId);
          setButtonQueued(button);
          setCardLiveStatus(
            recordId,
            'QUEUED',
            navigator.onLine === false
              ? 'อุปกรณ์ออฟไลน์ เก็บคำขอไว้และจะส่งเมื่อออนไลน์'
              : 'ยังไม่ได้รับคำยืนยัน ระบบจะตรวจสอบและลองใหม่โดยใช้ Request ID เดิม'
          );

          if (interactive) {
            await showQueued(error);
          }

          if (navigator.onLine !== false) {
            window.setTimeout(
              () => void recoverPendingRequests(),
              Math.max(900, retryDelay(error, 1))
            );
          }
          return;
        } else {
          removePendingRequest(recordId);
          throw error;
        }
      }

      if (
        result &&
        result.staleRecord === true &&
        result.committed !== true
      ) {
        removePendingRequest(recordId);
        updateSavingProgress(
          'SYNC',
          'ข้อมูลรายการเปลี่ยนแล้ว กำลังโหลด Snapshot ล่าสุด',
          100,
          recordId
        );
        await delay(180);
        closeSavingProgress(recordId);
        applyStaleRecordState(recordId, result, button);
        scheduleBoardRefresh();

        if (interactive) {
          await showStaleRecord(result);
        }
        return;
      }

      if (!result || result.committed !== true) {
        throw createLocalError(
          result && result.code || 'RECEIVING_NOT_COMMITTED',
          result && result.message || 'Server ไม่ยืนยันการบันทึก'
        );
      }

      updateSavingProgress(
        'VERIFY',
        'บันทึกเวลาใน Server สำเร็จแล้ว',
        82,
        recordId
      );
      setCardLiveStatus(
        recordId,
        'COMMITTED',
        'บันทึกเวลาสำเร็จ กำลังอัปเดตหน้าจอ...'
      );

      removePendingRequest(recordId);
      applyCommittedState(recordId, result, button);

      updateSavingProgress(
        'SYNC',
        'อัปเดตการ์ดแล้ว ระบบจะซิงก์ Workflow เบื้องหลัง',
        96,
        recordId
      );
      await delay(180);
      updateSavingProgress(
        'DONE',
        'บันทึกสำเร็จ ไม่ต้องรอการโหลดข้อมูลทั้งหน้า',
        100,
        recordId
      );
      await delay(180);
      closeSavingProgress(recordId);

      enqueueWorkflowSync(moduleId, payload, result);

      if (interactive) {
        await showSuccess(result);
      } else {
        showRecoveryToast('ส่งคำขอรับสินค้าเสร็จที่ค้างไว้สำเร็จ');
      }

      window.setTimeout(
        () => void recoverPendingWorkflowSyncs(),
        150
      );

    } catch (error) {
      closeSavingProgress(recordId);
      setCardLiveStatus(
        recordId,
        'ERROR',
        'บันทึกไม่สำเร็จ กรุณาตรวจสอบข้อความแจ้งเตือน'
      );
      window.setTimeout(
        () => clearCardLiveStatus(recordId, 'ERROR'),
        9000
      );

      if (interactive) {
        await showSaveError(error);
      }
    } finally {
      inFlight.delete(recordId);
      releaseRecordLease(recordId,payload.clientRequestId);
      if (!hasPendingRequest(recordId)) {
        setButtonLoading(button, false);
      }
    }
  }

  async function commitWithRetry(
    moduleId,
    payload,
    recordId
  ) {
    let lastError = null;

    for (let attempt=0; attempt<MAX_COMMIT_ATTEMPTS; attempt+=1) {
      const attemptNumber = attempt + 1;
      updateSavingProgress(
        'COMMIT',
        attempt === 0
          ? 'กำลังส่งคำขอและบันทึกเวลาใน Server'
          : 'Server ยังไม่พร้อม กำลังลองซ้ำครั้งที่ ' + attemptNumber,
        Math.min(58,30 + attempt * 12),
        recordId
      );
      setCardLiveStatus(
        recordId,
        'SAVING',
        attempt === 0
          ? 'กำลังบันทึกเวลาใน Server...'
          : 'กำลังลองบันทึกซ้ำครั้งที่ ' + attemptNumber + '...'
      );

      try {
        return await API.completeReceiving(moduleId,payload);
      } catch (error) {
        lastError = error;
        if (
          !isTemporaryError(error) ||
          attempt >= MAX_COMMIT_ATTEMPTS - 1 ||
          navigator.onLine === false
        ) {
          throw error;
        }
        await delay(retryDelay(error,attempt));
      }
    }

    throw lastError || new Error('บันทึกรับสินค้าเสร็จไม่สำเร็จ');
  }
async function verifyCommit(
    moduleId,
    payload,
    recordId
  ) {
    if (
      !API ||
      typeof API.getReceivingCommitStatus !== 'function' ||
      navigator.onLine === false
    ) {
      return null;
    }

    for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt += 1) {
      updateSavingProgress(
        'VERIFY',
        'ตรวจสอบผลจริงกับ Server ครั้งที่ ' + (attempt + 1),
        Math.min(82, 66 + attempt * 4),
        recordId
      );

      try {
        const result = await API.getReceivingCommitStatus(
          moduleId,
          payload
        );

        if (
          result &&
          (
            result.completed === true ||
            result.staleRecord === true
          )
        ) {
          return result;
        }
      } catch (error) {
        if (isAuthenticationError(error)) {
          throw error;
        }
      }

      if (attempt < VERIFY_ATTEMPTS - 1) {
        await delay(500 + attempt * 600);
      }
    }

    return null;
  }
function enqueueWorkflowSync(
    moduleId,
    payload,
    result
  ) {
    const item = {
      ...payload,
      moduleId: moduleId,
      receivingCompleteAt:
        result && result.receivingCompleteAt || '',
      receivingCompleteEpochMs:
        Number(result && result.receivingCompleteEpochMs) || 0,
      queuedAt: Date.now(),
      attempts: 0
    };

    saveWorkflowSyncRequest(item);
    setCardLiveStatus(
      payload.recordId,
      'SYNCING',
      'บันทึกสำเร็จแล้ว กำลังซิงก์สถานะ Workflow เบื้องหลัง'
    );
  }

  async function recoverPendingWorkflowSyncs() {
    if (
      workflowRecoveryRunning ||
      navigator.onLine === false ||
      !API ||
      typeof API.syncReceivingWorkflow !== 'function'
    ) {
      return;
    }

    const items = readWorkflowSyncRequests();

    if (!items.length) {
      return;
    }

    workflowRecoveryRunning = true;

    try {
      for (const item of items) {
        if (
          Date.now() - Number(item.queuedAt || 0) > PENDING_MAX_AGE_MS
        ) {
          removeWorkflowSyncRequest(item.recordId);
          continue;
        }

        try {
          const result = await API.syncReceivingWorkflow(
            item.moduleId || getModuleId(),
            item
          );

          if (result && result.success === true) {
            removeWorkflowSyncRequest(item.recordId);
            setCardLiveStatus(
              item.recordId,
              'SYNCED',
              'บันทึกและซิงก์สถานะครบแล้ว'
            );
            window.setTimeout(
              () => clearCardLiveStatus(item.recordId, 'SYNCED'),
              1600
            );
            scheduleBoardRefresh();
            continue;
          }

          throw createLocalError(
            result && result.code || 'WORKFLOW_SYNC_PENDING',
            result && result.message || 'ยังซิงก์ Workflow ไม่สำเร็จ'
          );

        } catch (error) {
          const next = {
            ...item,
            attempts: Number(item.attempts || 0) + 1,
            lastErrorCode: String(error && error.code || ''),
            lastErrorAt: Date.now()
          };
          saveWorkflowSyncRequest(next);
          setCardLiveStatus(
            item.recordId,
            'SYNC_PENDING',
            'บันทึกเวลาแล้ว แต่กำลังรอซิงก์สถานะอัตโนมัติ'
          );

          if (isAuthenticationError(error)) {
            break;
          }
        }
      }
    } finally {
      workflowRecoveryRunning = false;
    }
  }

  function workflowSyncStorageKey() {
    return SYNC_STORAGE_PREFIX + getModuleId();
  }

  function readWorkflowSyncMap() {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(workflowSyncStorageKey()) || '{}'
      );
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch (error) {
      return {};
    }
  }

  function readWorkflowSyncRequests() {
    return Object.values(readWorkflowSyncMap()).sort(
      (left, right) =>
        Number(left.queuedAt || 0) - Number(right.queuedAt || 0)
    );
  }

  function saveWorkflowSyncRequest(payload) {
    try {
      const map = readWorkflowSyncMap();
      map[payload.recordId] = payload;
      localStorage.setItem(
        workflowSyncStorageKey(),
        JSON.stringify(map)
      );
    } catch (error) {
      console.warn('เก็บ Workflow Sync Queue ไม่สำเร็จ', error);
    }
  }

  function removeWorkflowSyncRequest(recordId) {
    try {
      const map = readWorkflowSyncMap();
      delete map[recordId];
      if (Object.keys(map).length) {
        localStorage.setItem(
          workflowSyncStorageKey(),
          JSON.stringify(map)
        );
      } else {
        localStorage.removeItem(workflowSyncStorageKey());
      }
    } catch (error) {
      console.warn('ล้าง Workflow Sync Queue ไม่สำเร็จ', error);
    }
  }

  function createLocalError(code, message) {
    const error = new Error(message || 'เกิดข้อผิดพลาด');
    error.code = code || 'LOCAL_ERROR';
    return error;
  }

async function recoverPendingRequests() {
    if (recoveryRunning || navigator.onLine === false) return;

    const entries = readPendingRequests()
      .filter((payload) => Number(payload.nextAttemptAt || 0) <= Date.now())
      .slice(0,RECOVERY_BATCH_SIZE);

    if (!entries.length) return;

    recoveryRunning = true;

    try {
      for (const payload of entries) {
        if (Date.now() - Number(payload.queuedAt || 0) > PENDING_MAX_AGE_MS) {
          removePendingRequest(payload.recordId);
          continue;
        }

        const moduleId = payload.moduleId || getModuleId();
        const button = findReceivingButton(payload.recordId);
        const record = window.VehicleModule &&
          typeof window.VehicleModule.getRecord === 'function'
            ? window.VehicleModule.getRecord(payload.recordId)
            : null;

        if (String(payload.status || '').toUpperCase() === 'UNKNOWN') {
          const verified = await verifyCommit(moduleId,payload,payload.recordId);
          if (verified && verified.completed === true) {
            removePendingRequest(payload.recordId);
            applyCommittedState(payload.recordId,verified,button);
            enqueueWorkflowSync(moduleId,payload,verified);
            continue;
          }
          if (verified && verified.staleRecord === true) {
            removePendingRequest(payload.recordId);
            applyStaleRecordState(payload.recordId,verified,button);
            scheduleBoardRefresh();
            continue;
          }
        }

        const nextPayload = {
          ...payload,
          attempts: Number(payload.attempts || 0) + 1,
          status: 'SENDING',
          lastAttemptAt: Date.now(),
          updatedAt: Date.now()
        };
        savePendingRequest(nextPayload);
        await executeReceiving(nextPayload,record,button,{ interactive: false });
      }
    } finally {
      recoveryRunning = false;
    }
  }


  function applyCommittedState(
    recordId,
    result,
    sourceButton
  ) {
    const timestamp =
      result &&
      result.receivingCompleteAt ||
      formatLocalDateTime(
        result &&
        result.receivingCompleteEpochMs
      ) ||
      'บันทึกแล้ว';

    getReceivingButtons(
      recordId
    ).forEach(
      (
        button
      ) => {
        button.disabled =
          true;

        button.dataset.canComplete =
          'FALSE';

        button.dataset
          .operationalStage =
          'WAITING_DOCUMENT_RETURN';

        button.setAttribute(
          'aria-disabled',
          'true'
        );

        button.removeAttribute(
          'aria-busy'
        );

        button.textContent =
          'รับสินค้าเสร็จแล้ว';
      }
    );

    if (
      sourceButton &&
      sourceButton.isConnected
    ) {
      sourceButton.textContent =
        'รับสินค้าเสร็จแล้ว';
    }

    clearCardLiveStatus(
      recordId
    );

    const card =
      findVehicleCard(
        recordId
      );

    if (!card) {
      return;
    }

    card.dataset
      .operationalStage =
      'WAITING_DOCUMENT_RETURN';

    const stageSection =
      card.querySelector(
        '.vehicle-operational-stage'
      );

    if (stageSection) {
      stageSection.dataset.stage =
        'WAITING_DOCUMENT_RETURN';

      const title =
        stageSection.querySelector(
          '.vehicle-operational-stage__heading strong'
        );

      if (title) {
        title.textContent =
          'รอ พขร.รับเอกสารคืน';
      }

      const description =
        stageSection.querySelector(
          '.vehicle-operational-stage__heading + p'
        );

      if (description) {
        description.textContent =
          'รับสินค้าเสร็จแล้ว รอ พขร.รับเอกสารคืนจาก Inbound';
      }

      const timelineItems =
        stageSection.querySelectorAll(
          '.vehicle-operational-stage__timeline > div'
        );

      if (
        timelineItems &&
        timelineItems[2]
      ) {
        timelineItems[2]
          .classList.remove(
            'is-pending'
          );

        timelineItems[2]
          .classList.add(
            'is-complete'
          );

        const value =
          timelineItems[2]
            .querySelector(
              'strong'
            );

        if (value) {
          value.textContent =
            timestamp;
        }
      }
    }

    document.dispatchEvent(
      new CustomEvent(
        'alertvendor:receiving-committed',
        {
          detail: {
            recordId:
              recordId,

            receivingCompleteAt:
              timestamp,

            result:
              result ||
              {}
          }
        }
      )
    );
  }

  function scheduleBoardRefresh() {
    window.setTimeout(
      () => {
        if (
          window.VehicleModule &&
          typeof window.VehicleModule
            .refreshOperationalBoard ===
            'function'
        ) {
          void window.VehicleModule
            .refreshOperationalBoard(
              true
            );

          return;
        }

        document.dispatchEvent(
          new CustomEvent(
            'alertvendor:refresh-operational-board'
          )
        );
      },
      350
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
      record &&
      (
        record.appointmentNumber ||
        record.appointment ||
        record.primaryValue
      ) ||
      button.dataset
        .expectedPrimaryValue ||
      '-';

    const company =
      record &&
      (
        record.companyName ||
        record.company
      ) ||
      '-';

    const timestampIn =
      record &&
      record.timestampIn ||
      button.dataset
        .expectedTimestampIn ||
      '-';

    const documentSubmittedAt =
      record &&
      record.documentSubmittedAt ||
      '-';

    const result =
      await Swal.fire({
        icon:
          'question',

        title:
          'ยืนยันรับสินค้าเสร็จ',

        html: `
          <div class="receiving-confirm-grid">
            <div>
              <span>เลขนัดหมาย</span>
              <strong>${escapeHtml(appointment)}</strong>
            </div>

            <div>
              <span>บริษัท</span>
              <strong>${escapeHtml(company)}</strong>
            </div>

            <div>
              <span>เวลาเข้าพื้นที่</span>
              <strong>${escapeHtml(timestampIn)}</strong>
            </div>

            <div>
              <span>ยื่นเอกสาร</span>
              <strong>${escapeHtml(documentSubmittedAt)}</strong>
            </div>
          </div>

          <p class="receiving-confirm-note">
            กดเพียงครั้งเดียว ระบบป้องกันข้อมูลซ้ำและใช้เวลาจาก Server
          </p>
        `,

        showCancelButton:
          true,

        confirmButtonText:
          'บันทึกรับสินค้าเสร็จ',

        cancelButtonText:
          'ยกเลิก',

        reverseButtons:
          true,

        focusCancel:
          true,

        allowOutsideClick:
          false
      });

    return result.isConfirmed ===
      true;
  }

  function applyStaleRecordState(
    recordId,
    result,
    sourceButton
  ) {
    getReceivingButtons(recordId).forEach((button) => {
      button.disabled = true;
      button.dataset.canComplete = 'FALSE';
      button.classList.remove('is-receiving-saving');
      button.classList.remove('is-receiving-queued');
      button.textContent = 'ข้อมูลเปลี่ยนแล้ว';
    });

    setCardLiveStatus(
      recordId,
      'STALE',
      result && result.code === 'RECORD_NO_LONGER_ACTIVE'
        ? 'รายการออกจากพื้นที่แล้ว กำลังโหลดข้อมูลล่าสุด'
        : 'ข้อมูลรายการเปลี่ยนแล้ว กำลังโหลดข้อมูลล่าสุด'
    );

    window.setTimeout(
      () => clearCardLiveStatus(recordId, 'STALE'),
      4500
    );
  }

  async function showStaleRecord(result) {
    if (!window.Swal) {
      return;
    }

    const code = String(result && result.code || 'RECORD_STATE_CHANGED');

    await Swal.fire({
      icon: 'info',
      title: 'ข้อมูลรายการเปลี่ยนแล้ว',
      html: `
        <p>${escapeHtml(result && result.message || 'ระบบพบข้อมูลใหม่กว่าบนหน้าจอ')}</p>
        <p>ระบบไม่ได้สร้างข้อมูลซ้ำ และกำลังโหลด Snapshot ล่าสุด</p>
        <div class="receiving-error-code">รหัส: ${escapeHtml(code)}</div>
      `,
      confirmButtonText: 'รับทราบ',
      timer: 1800,
      timerProgressBar: true
    });
  }
async function showSuccess(
    result
  ) {
    if (!window.Swal) {
      return;
    }

    const alreadyCompleted =
      result && result.alreadyCompleted === true;

    await Swal.fire({
      icon: 'success',
      title: alreadyCompleted
        ? 'รายการนี้บันทึกไว้แล้ว'
        : 'บันทึกรับสินค้าเสร็จแล้ว',
      html: `
        <p>${escapeHtml(result && result.message || 'บันทึกเวลาใน Server สำเร็จ')}</p>
        <p class="receiving-success-subtext">หน้าจออัปเดตแล้ว ส่วน Workflow จะซิงก์เบื้องหลังอัตโนมัติ</p>
      `,
      timer: alreadyCompleted ? 1100 : 1250,
      timerProgressBar: true,
      showConfirmButton: false
    });
  }

  async function showCommittedWithSyncPending(
    result
  ) {
    if (!window.Swal) {
      return;
    }

    await Swal.fire({
      icon:
        'success',

      title:
        'บันทึกรับสินค้าเสร็จแล้ว',

      html: `
        <p>
          ข้อมูลหลักถูกบันทึกสำเร็จแล้ว
        </p>

        <p>
          ระบบกำลังซิงก์สถานะ Inbound ซ้ำอัตโนมัติ
        </p>

        <small class="receiving-warning-code">
          ${escapeHtml(
            result &&
            result.workflowSync &&
            result.workflowSync.code ||
            'WORKFLOW_SYNC_PENDING'
          )}
        </small>
      `,

      confirmButtonText:
        'รับทราบ'
    });
  }
  async function showQueued(
    error
  ) {
    if (!window.Swal) {
      return;
    }

    const code = String(
      error && error.code || 'NETWORK_PENDING'
    ).toUpperCase();
    const offline = navigator.onLine === false;
    const busy = code.includes('BUSY');

    await Swal.fire({
      icon: 'info',
      title:
        offline
          ? 'เก็บคำขอไว้ในอุปกรณ์แล้ว'
          : busy
            ? 'Server กำลังเขียนข้อมูล'
            : 'ยังไม่ได้รับคำยืนยันจาก Server',
      html: `
        <p>
          ${
            offline
              ? 'ระบบจะส่งคำขอเดิมอัตโนมัติเมื่ออินเทอร์เน็ตกลับมา'
              : busy
                ? 'ระบบจะตรวจสอบผลและลองใหม่อัตโนมัติ โดยไม่สร้างข้อมูลซ้ำ'
                : 'ระบบเก็บ Request ID เดิมไว้ และจะตรวจสอบผลก่อนส่งซ้ำ'
          }
        </p>
        <div class="receiving-queued-note">
          ไม่ต้องกดปุ่มซ้ำ และสามารถดูสถานะบนการ์ดได้
        </div>
        <small class="receiving-warning-code">${escapeHtml(code)}</small>
      `,
      confirmButtonText: 'รับทราบ'
    });
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
        icon:
          'warning',

        title:
          'ยังไม่ถึงขั้นตอนรับสินค้าเสร็จ',

        text:
          message,

        confirmButtonText:
          'ตกลง'
      });
    }
  }
  async function showSaveError(
    error
  ) {
    const code = String(
      error && error.code || 'RECEIVING_SAVE_FAILED'
    ).toUpperCase();
    const message = String(
      error && error.message || 'บันทึกรับสินค้าเสร็จไม่สำเร็จ'
    );

    let guidance = 'ตรวจสอบข้อมูลรายการแล้วลองใหม่อีกครั้ง';
    if (code === 'RECEIVING_BUSY' || code === 'INBOUND_WORKFLOW_BUSY') {
      guidance = 'ระบบยังมีงานเขียนค้างอยู่ กรุณารอประมาณ 2 วินาทีแล้วกดใหม่';
    } else if (code === 'RECORD_CHANGED' || code === 'RECORD_NO_LONGER_ACTIVE') {
      guidance = 'ข้อมูลรายการเปลี่ยนแล้ว ระบบจะโหลด Snapshot ล่าสุด';
    } else if (code === 'DOCUMENT_SUBMIT_REQUIRED' || code === 'WORKFLOW_STAGE_ORDER_INVALID') {
      guidance = 'ให้ Inbound ยื่นเอกสารก่อน แล้วรีเฟรชข้อมูล';
    } else if (code === 'INTERNAL_ERROR') {
      guidance = 'เกิดข้อผิดพลาดใน Backend ระบบไม่ได้ถือว่าเป็นงานค้าง กรุณาแจ้ง Admin พร้อมเวลาที่เกิดเหตุ';
    }

    if (window.Swal) {
      await Swal.fire({
        icon: 'error',
        title: 'บันทึกรับสินค้าเสร็จไม่สำเร็จ',
        html: `
          <p>${escapeHtml(message)}</p>
          <p>${escapeHtml(guidance)}</p>
          <div class="receiving-error-code">รหัส: ${escapeHtml(code)}</div>
        `,
        confirmButtonText: 'ตกลง'
      });
    }

    if ([
      'RECORD_CHANGED',
      'RECORD_NO_LONGER_ACTIVE',
      'RECEIVING_ALREADY_COMPLETED'
    ].includes(code)) {
      scheduleBoardRefresh();
    }
  }

  async function showError(
    message,
    code
  ) {
    if (window.Swal) {
      await Swal.fire({
        icon:
          'error',

        title:
          'ไม่สามารถดำเนินการได้',

        html: `
          <p>${escapeHtml(message)}</p>
          <div class="receiving-error-code">
            รหัส: ${escapeHtml(code)}
          </div>
        `,

        confirmButtonText:
          'ตกลง'
      });
    }
  }
  function isTemporaryError(
    error
  ) {
    const code = String(
      error && error.code || ''
    ).toUpperCase();

    if ([
      'INTERNAL_ERROR',
      'RECEIVING_RUNTIME_ERROR',
      'APPS_SCRIPT_ERROR'
    ].includes(code)) {
      return false;
    }

    if ([
      'RECEIVING_BUSY',
      'INBOUND_WORKFLOW_BUSY',
      'REQUEST_TIMEOUT',
      'NETWORK_ERROR',
      'EMPTY_RESPONSE',
      'INVALID_JSON_RESPONSE',
      'GAS_INVALID_RESPONSE',
      'GAS_CONNECTION_FAILED',
      'GAS_HTTP_ERROR',
      'UPSTREAM_TIMEOUT',
      'GAS_TIMEOUT'
    ].includes(code)) {
      return true;
    }

    return !code && [408,409,429,502,503,504].includes(
      Number(error && error.status)
    );
  }

  function isNetworkOrTimeoutError(
    error
  ) {
    const code =
      String(
        error &&
        error.code ||
        ''
      ).toUpperCase();

    return [
      'REQUEST_TIMEOUT',
      'NETWORK_ERROR',
      'EMPTY_RESPONSE',
      'INVALID_JSON_RESPONSE',
      'GAS_INVALID_RESPONSE',
      'GAS_CONNECTION_FAILED',
      'GAS_HTTP_ERROR',
      'UPSTREAM_TIMEOUT',
      'GAS_TIMEOUT'
    ].includes(
      code
    ) ||
    [
      408,
      502,
      503,
      504
    ].includes(
      Number(
        error &&
        error.status
      )
    );
  }

  function isAuthenticationError(
    error
  ) {
    return [
      'AUTH_REQUIRED',
      'SESSION_EXPIRED',
      'INVALID_SESSION'
    ].includes(
      String(
        error &&
        error.code ||
        ''
      ).toUpperCase()
    );
  }

  function retryDelay(
    error,
    attempt
  ) {
    const retryAfter =
      Number(
        error &&
        error.details &&
        error.details
          .retryAfterSeconds
      );

    if (
      Number.isFinite(
        retryAfter
      ) &&
      retryAfter > 0
    ) {
      return Math.min(
        retryAfter *
          1000,
        2500
      );
    }

    return [
      350,
      850,
      1500
    ][attempt] ||
    1500;
  }
  function setButtonLoading(
    button,
    loading
  ) {
    if (!button) {
      return;
    }

    if (loading) {
      if (!button.dataset.originalText) {
        button.dataset.originalText = button.textContent || '';
      }
      button.disabled = true;
      button.setAttribute('aria-busy','true');
      button.classList.add('is-receiving-saving');
      button.textContent = 'กำลังตรวจสอบ...';
      return;
    }

    button.removeAttribute('aria-busy');
    button.classList.remove('is-receiving-saving');
    button.classList.remove('is-receiving-queued');

    if (button.isConnected && button.dataset.canComplete === 'TRUE') {
      button.disabled = false;
      button.textContent =
        button.dataset.originalText || 'บันทึกรับสินค้าเสร็จ';
    }
  }
  function setButtonQueued(
    button
  ) {
    if (!button) {
      return;
    }
    button.disabled = true;
    button.setAttribute('aria-busy','true');
    button.classList.remove('is-receiving-saving');
    button.classList.add('is-receiving-queued');
    button.textContent =
      navigator.onLine === false
        ? 'รออินเทอร์เน็ต'
        : 'กำลังตรวจสอบผล';
  }

  function openSavingProgress(
    record,
    payload
  ) {
    const recordId = String(payload && payload.recordId || '');
    const card = findVehicleCard(recordId);

    if (!recordId || !card) {
      return;
    }

    closeSavingProgress(recordId);

    const appointment =
      record && (
        record.appointmentNumber ||
        record.appointment ||
        record.primaryValue
      ) || payload.expectedPrimaryValue || '-';
    const company =
      record && (record.companyName || record.company) || '-';

    const panel = document.createElement('section');
    panel.className = 'receiving-card-progress';
    panel.dataset.recordId = recordId;
    panel.innerHTML = `
      <div class="receiving-card-progress__head">
        <div>
          <small>กำลังบันทึกรับสินค้าเสร็จ</small>
          <strong>${escapeHtml(appointment)} · ${escapeHtml(company)}</strong>
        </div>
        <span data-receiving-progress-elapsed>0 วินาที</span>
      </div>
      <div class="receiving-card-progress__meter" aria-hidden="true">
        <i data-receiving-progress-bar></i>
      </div>
      <p data-receiving-progress-message>กำลังเตรียมคำขอ...</p>
      <div class="receiving-card-progress__steps" aria-label="ขั้นตอนการบันทึก">
        <span data-receiving-progress-step="PREPARE"><b>1</b>ตรวจสอบ</span>
        <span data-receiving-progress-step="COMMIT"><b>2</b>Commit</span>
        <span data-receiving-progress-step="VERIFY"><b>3</b>ยืนยัน</span>
        <span data-receiving-progress-step="SYNC"><b>4</b>Sync</span>
      </div>
    `;

    const anchor =
      card.querySelector('.vehicle-operational-stage') ||
      card.querySelector('.vehicle-card__footer');

    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    } else {
      card.appendChild(panel);
    }

    card.classList.add('is-receiving-busy');
    card.setAttribute('aria-busy', 'true');

    const item = {
      recordId,
      panel,
      startedAt: Date.now(),
      stage: 'PREPARE',
      elapsedTimer: window.setInterval(
        () => updateProgressElapsed(recordId),
        1000
      )
    };

    progressState.set(recordId, item);
    updateSavingProgress(
      'PREPARE',
      'กำลังเตรียมคำขอและตรวจสอบรายการ',
      10,
      recordId
    );
  }

  function updateSavingProgress(stage,message,percent,recordId) {
    const key = String(recordId || '');
    const item = progressState.get(key);

    if (!item || !item.panel || !item.panel.isConnected) {
      return;
    }

    item.stage = String(stage || item.stage || 'PREPARE').toUpperCase();

    const messageNode = item.panel.querySelector('[data-receiving-progress-message]');
    if (messageNode) {
      messageNode.textContent = message || 'กำลังดำเนินการ...';
    }

    const bar = item.panel.querySelector('[data-receiving-progress-bar]');
    if (bar) {
      bar.style.width = Math.max(4,Math.min(100,Number(percent || 0))) + '%';
    }

    const order=['PREPARE','COMMIT','VERIFY','SYNC','DONE'];
    const currentIndex=order.indexOf(item.stage);
    item.panel.querySelectorAll('[data-receiving-progress-step]').forEach((node) => {
      const nodeIndex=order.indexOf(node.getAttribute('data-receiving-progress-step'));
      node.classList.toggle('is-active',nodeIndex===currentIndex);
      node.classList.toggle(
        'is-done',
        item.stage==='DONE' || (nodeIndex>=0 && currentIndex>=0 && nodeIndex<currentIndex)
      );
    });
  }

  function updateProgressElapsed(recordId) {
    const item = progressState.get(String(recordId || ''));
    if (!item || !item.panel || !item.panel.isConnected) return;

    const node = item.panel.querySelector('[data-receiving-progress-elapsed]');
    if (!node) return;

    const seconds=Math.max(0,Math.floor((Date.now()-item.startedAt)/1000));
    node.textContent=seconds+' วินาที';
  }

  function closeSavingProgress(recordId) {
    const key = String(recordId || '');
    const item = progressState.get(key);

    if (!item) {
      return;
    }

    if (item.elapsedTimer) {
      window.clearInterval(item.elapsedTimer);
    }

    if (item.panel && item.panel.isConnected) {
      item.panel.remove();
    }

    progressState.delete(key);

    const card = findVehicleCard(key);
    if (card) {
      card.classList.remove('is-receiving-busy');
      if (!card.querySelector('.receiving-live-status')) {
        card.removeAttribute('aria-busy');
      }
    }
  }

  function setCardLiveStatus(recordId,status,message) {
    const card=findVehicleCard(recordId);
    if (!card) return;
    let element=card.querySelector('.receiving-live-status');
    if (!element) {
      element=document.createElement('div');
      element.className='receiving-live-status';
      const stage=card.querySelector('.vehicle-operational-stage');
      (stage || card).appendChild(element);
    }
    element.dataset.state=String(status || 'SAVING').toUpperCase();
    element.innerHTML=`<i aria-hidden="true"></i><span>${escapeHtml(message || 'กำลังดำเนินการ...')}</span>`;
    card.dataset.receivingSaveState=element.dataset.state;
    card.setAttribute('aria-busy','true');

    document.dispatchEvent(
      new CustomEvent('alertvendor:receiving-card-state', {
        detail: {
          recordId: String(recordId || ''),
          state: element.dataset.state,
          message: String(message || ''),
          active: true
        }
      })
    );
  }

  function clearCardLiveStatus(recordId,onlyState) {
    const card=findVehicleCard(recordId);
    if (!card) return;
    const element=card.querySelector('.receiving-live-status');
    if (element && (!onlyState || element.dataset.state===onlyState)) {
      element.remove();
    }
    delete card.dataset.receivingSaveState;

    if (!card.querySelector('.receiving-card-progress')) {
      card.removeAttribute('aria-busy');
      card.classList.remove('is-receiving-busy');
    }

    document.dispatchEvent(
      new CustomEvent('alertvendor:receiving-card-state', {
        detail: {
          recordId: String(recordId || ''),
          state: '',
          message: '',
          active: false
        }
      })
    );
  }


  function getReceivingButtons(
    recordId
  ) {
    const escaped =
      cssEscape(
        recordId
      );

    return Array.from(
      document.querySelectorAll(
        '.receiving-complete-button[data-record-id="' +
        escaped +
        '"]'
      )
    );
  }

  function findReceivingButton(
    recordId
  ) {
    return getReceivingButtons(
      recordId
    )[0] ||
    null;
  }

  function findVehicleCard(
    recordId
  ) {
    return document.querySelector(
      '.vehicle-card[data-record-id="' +
      cssEscape(
        recordId
      ) +
      '"]'
    );
  }

  function recordLeaseKey(recordId) {
    return TAB_LEASE_PREFIX + getModuleId() + ':' + String(recordId || '');
  }

  function acquireRecordLease(recordId,requestId) {
    const key=recordLeaseKey(recordId);
    const now=Date.now();
    const owner=createTabId();
    try {
      const current=JSON.parse(localStorage.getItem(key) || 'null');
      if (
        current &&
        Number(current.expiresAt || 0) > now &&
        current.owner !== owner
      ) {
        return { acquired:false, owner:current.owner || '' };
      }
      localStorage.setItem(key,JSON.stringify({
        owner:owner,
        requestId:String(requestId || ''),
        expiresAt:now + TAB_LEASE_MS
      }));
      const verified=JSON.parse(localStorage.getItem(key) || 'null');
      return { acquired:Boolean(verified && verified.owner===owner), owner:owner };
    } catch (error) {
      return { acquired:true, owner:owner, fallback:true };
    }
  }

  function releaseRecordLease(recordId,requestId) {
    const key=recordLeaseKey(recordId);
    try {
      const current=JSON.parse(localStorage.getItem(key) || 'null');
      if (
        !current ||
        current.owner===createTabId() ||
        current.requestId===String(requestId || '')
      ) {
        localStorage.removeItem(key);
      }
    } catch (error) {
      localStorage.removeItem(key);
    }
  }

  function createTabId() {
    const key='alertvendor:receiving-tab-id:v1';
    try {
      let value=sessionStorage.getItem(key);
      if (!value) {
        value='RTAB-'+createRequestId();
        sessionStorage.setItem(key,value);
      }
      return value;
    } catch (error) {
      if (!window.__alertVendorReceivingTabId) {
        window.__alertVendorReceivingTabId='RTAB-'+createRequestId();
      }
      return window.__alertVendorReceivingTabId;
    }
  }

  function storageKey() {
    return (
      STORAGE_PREFIX +
      getModuleId()
    );
  }

  function readPendingMap() {
    try {
      const parsed =
        JSON.parse(
          localStorage.getItem(
            storageKey()
          ) ||
          '{}'
        );

      return (
        parsed &&
        typeof parsed ===
          'object' &&
        !Array.isArray(
          parsed
        )
      )
        ? parsed
        : {};

    } catch (error) {
      return {};
    }
  }

  function readPendingRequests() {
    return Object.values(
      readPendingMap()
    ).sort(
      (
        left,
        right
      ) =>
        Number(
          left.queuedAt ||
          0
        ) -
        Number(
          right.queuedAt ||
          0
        )
    );
  }

function savePendingRequest(
    payload
  ) {
    try {
      const map = readPendingMap();
      const existing = map[payload.recordId] || {};
      map[payload.recordId] = {
        ...existing,
        ...payload,
        clientRequestId:
          payload.clientRequestId || existing.clientRequestId || createRequestId(),
        requestId:
          payload.clientRequestId || existing.clientRequestId || payload.requestId || '',
        queuedAt:
          Number(existing.queuedAt || payload.queuedAt) || Date.now(),
        updatedAt: Date.now(),
        attempts: Number(payload.attempts || existing.attempts || 0),
        nextAttemptAt: Number(payload.nextAttemptAt || existing.nextAttemptAt || 0),
        status: String(payload.status || existing.status || 'PENDING'),
        lastErrorCode: String(payload.lastErrorCode || existing.lastErrorCode || '')
      };

      localStorage.setItem(storageKey(),JSON.stringify(map));
    } catch (error) {
      console.warn('บันทึก Pending Receiving ไม่สำเร็จ',error);
    }
  }


  function removePendingRequest(
    recordId
  ) {
    try {
      const map =
        readPendingMap();

      delete map[
        recordId
      ];

      if (
        Object.keys(
          map
        ).length
      ) {
        localStorage.setItem(
          storageKey(),
          JSON.stringify(
            map
          )
        );

      } else {
        localStorage.removeItem(
          storageKey()
        );
      }

    } catch (error) {
      console.warn(
        'ล้าง Pending Receiving ไม่สำเร็จ',
        error
      );
    }
  }

  function hasPendingRequest(
    recordId
  ) {
    return Boolean(
      readPendingMap()[
        recordId
      ]
    );
  }

  function createRequestId() {
    if (
      window.crypto &&
      typeof window.crypto
        .randomUUID ===
        'function'
    ) {
      return window.crypto
        .randomUUID();
    }

    return (
      'recv-' +
      Date.now()
        .toString(
          36
        ) +
      '-' +
      Math.random()
        .toString(
          36
        )
        .slice(
          2,
          12
        )
    );
  }

  function formatLocalDateTime(
    epochMs
  ) {
    const value =
      Number(
        epochMs
      );

    if (
      !Number.isFinite(
        value
      ) ||
      value <= 0
    ) {
      return '';
    }

    const date =
      new Date(
        value
      );

    const pad =
      (
        number
      ) =>
        String(
          number
        ).padStart(
          2,
          '0'
        );

    return (
      pad(
        date.getDate()
      ) +
      '/' +
      pad(
        date.getMonth() +
        1
      ) +
      '/' +
      date.getFullYear() +
      ' ' +
      pad(
        date.getHours()
      ) +
      ':' +
      pad(
        date.getMinutes()
      ) +
      ':' +
      pad(
        date.getSeconds()
      )
    );
  }

  function showRecoveryToast(
    message
  ) {
    if (!window.Swal) {
      return;
    }

    void Swal.fire({
      toast:
        true,

      position:
        'top-end',

      icon:
        'success',

      title:
        message,

      timer:
        2600,

      showConfirmButton:
        false
    });
  }

  function getModuleId() {
    const params =
      new URLSearchParams(
        window.location.search
      );

    return String(
      params.get(
        'id'
      ) ||
      params.get(
        'moduleId'
      ) ||
      ''
    ).trim();
  }

  function delay(
    milliseconds
  ) {
    return new Promise(
      (
        resolve
      ) =>
        window.setTimeout(
          resolve,
          milliseconds
        )
    );
  }

  function cssEscape(
    value
  ) {
    if (
      window.CSS &&
      typeof window.CSS.escape ===
        'function'
    ) {
      return window.CSS.escape(
        String(
          value ||
          ''
        )
      );
    }

    return String(
      value ||
      ''
    ).replace(
      /["\\]/g,
      '\\$&'
    );
  }

  function escapeHtml(
    value
  ) {
    const element =
      document.createElement(
        'div'
      );

    element.textContent =
      value === null ||
      value === undefined
        ? ''
        : String(
            value
          );

    return element.innerHTML;
  }

})(
  window,
  document
);
