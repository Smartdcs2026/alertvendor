/**
 * receiving.js
 * PHASE 5 ROUND 03 — Fast Commit + Durable Recovery
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
    '2026.07.18-r2rev1-receiving-nonblocking-transition-v1';

  /* Worker และ Backend ทำ Idempotency/Verification อยู่แล้ว: ส่ง POST หลักเพียงครั้งเดียว */
  const MAX_COMMIT_ATTEMPTS = 1;
  const VERIFY_ATTEMPTS = 4;
  const PENDING_MAX_AGE_MS =
    48 * 60 * 60 * 1000;
  const STORAGE_PREFIX =
    'alertvendor:receiving-pending:v3:';
  const SYNC_STORAGE_PREFIX =
    'alertvendor:receiving-sync:v1:';
  const COMMITTED_OVERLAY_PREFIX =
    'alertvendor:receiving-committed:v1:';
  const COMMITTED_OVERLAY_MAX_AGE_MS =
    30 * 60 * 1000;

  const inFlight = new Set();
  let recoveryRunning = false;
  let workflowRecoveryRunning = false;

  const progressState = {
    open: false,
    recordId: '',
    startedAt: 0,
    elapsedTimer: null,
    stage: ''
  };

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
        Date.now()
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

    inFlight.add(recordId);
    setButtonLoading(button, true);
    setCardLiveStatus(
      recordId,
      'SAVING',
      'กำลังตรวจสอบข้อมูลและเตรียมบันทึก...'
    );

    if (interactive) {
      openSavingProgress(record, payload);
    }

    try {
      let result;
      updateSavingProgress(
        'PREPARE',
        'กำลังตรวจสอบข้อมูลล่าสุด',
        18
      );

      try {
        result = await commitWithRetry(moduleId, payload, recordId);
      } catch (error) {
        updateSavingProgress(
          'VERIFY',
          'กำลังยืนยันผลการบันทึก',
          66
        );
        setCardLiveStatus(
          recordId,
          'VERIFYING',
          'กำลังตรวจสอบผลการบันทึก...'
        );

        const verified = await verifyCommit(moduleId, payload);

        if (verified && verified.completed === true) {
          result = {
            success: true,
            committed: true,
            accepted: true,
            alreadyCompleted: true,
            verifiedAfterError: true,
            message: 'ยืนยันว่าบันทึกรับสินค้าเสร็จแล้ว',
            receivingCompleteAt: verified.receivingCompleteAt || '',
            receivingCompleteEpochMs:
              Number(verified.receivingCompleteEpochMs) || 0,
            requestId: verified.requestId || payload.clientRequestId,
            workflowSync: {
              success: false,
              pending: true,
              code: 'STEP_UPDATE_PENDING'
            }
          };
        } else if (verified && verified.staleRecord === true) {
          result = verified;
        } else if (
          isTemporaryError(error) ||
          navigator.onLine === false
        ) {
          closeSavingProgress();
          setButtonQueued(button);
          setCardLiveStatus(
            recordId,
            'QUEUED',
            navigator.onLine === false
              ? 'อุปกรณ์ออฟไลน์ ระบบจะส่งคำขอนี้ให้อัตโนมัติเมื่อออนไลน์'
              : 'กำลังรอยืนยันจากระบบ ระบบจะตรวจสอบและลองใหม่ให้อัตโนมัติ'
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
          'ข้อมูลมีการเปลี่ยนแปลง กำลังโหลดข้อมูลล่าสุด',
          100
        );
        await delay(180);
        closeSavingProgress();
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
          result && result.message || 'ยังไม่ได้รับคำยืนยันการบันทึก'
        );
      }

      updateSavingProgress(
        'VERIFY',
        'บันทึกรับสินค้าเสร็จสำเร็จแล้ว',
        82
      );
      setCardLiveStatus(
        recordId,
        'COMMITTED',
        'บันทึกสำเร็จ กำลังย้ายรายการไปขั้นตอนถัดไป...'
      );

      removePendingRequest(recordId);
      saveCommittedOverlay(payload, result);
      applyCommittedState(recordId, result, button, payload);

      updateSavingProgress(
        'SYNC',
        'กำลังย้ายรายการไปแท็บขั้นตอนถัดไป',
        96
      );
      await delay(180);
      updateSavingProgress(
        'DONE',
        'บันทึกสำเร็จแล้ว',
        100
      );
      await delay(180);
      closeSavingProgress();

      enqueueWorkflowSync(moduleId, payload, result);

      if (interactive) {
        await showSuccess(result, record);
      } else {
        showRecoveryToast('ส่งคำขอรับสินค้าเสร็จที่ค้างไว้สำเร็จ');
      }

      window.setTimeout(
        () => void recoverPendingWorkflowSyncs(),
        150
      );

    } catch (error) {
      closeSavingProgress();
      setCardLiveStatus(
        recordId,
        'ERROR',
        'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
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
          ? 'กำลังบันทึกรับสินค้าเสร็จ'
          : 'ระบบตอบกลับช้า กำลังลองอีกครั้งที่ ' + attemptNumber,
        Math.min(58,30 + attempt * 12)
      );
      setCardLiveStatus(
        recordId,
        'SAVING',
        attempt === 0
          ? 'กำลังบันทึกรับสินค้าเสร็จ...'
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
    payload
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
        'กำลังยืนยันผล ครั้งที่ ' + (attempt + 1),
        Math.min(82, 66 + attempt * 4)
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
      'บันทึกสำเร็จแล้ว กำลังย้ายรายการไปขั้นตอนถัดไป'
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
              'บันทึกและย้ายรายการเรียบร้อยแล้ว'
            );
            window.setTimeout(
              () => clearCardLiveStatus(item.recordId, 'SYNCED'),
              1600
            );
            scheduleBoardRevisionCheck(250);
            continue;
          }

          throw createLocalError(
            result && result.code || 'STEP_UPDATE_PENDING',
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
            'บันทึกแล้ว กำลังย้ายรายการไปขั้นตอนถัดไป'
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

  function committedOverlayStorageKey() {
    return COMMITTED_OVERLAY_PREFIX + getModuleId();
  }

  function readCommittedOverlayMap() {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(
          committedOverlayStorageKey()
        ) || '{}'
      );

      return parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
          ? parsed
          : {};
    } catch (error) {
      return {};
    }
  }

  function saveCommittedOverlay(
    payload,
    result
  ) {
    const recordId = String(
      payload && payload.recordId || ''
    ).trim();

    if (!recordId) {
      return;
    }

    try {
      const map =
        readCommittedOverlayMap();
      const now =
        Date.now();

      Object.keys(map).forEach(
        (key) => {
          const expiresAt =
            Number(
              map[key] &&
              map[key].expiresAt ||
              0
            );

          if (
            !expiresAt ||
            expiresAt <= now
          ) {
            delete map[key];
          }
        }
      );

      map[recordId] = {
        recordId:
          recordId,

        canonicalRecordId:
          String(
            payload &&
            payload.canonicalRecordId ||
            result &&
            result.canonicalRecordId ||
            ''
          ),

        sourceRowNumber:
          Number(
            payload &&
            payload.sourceRowNumber ||
            result &&
            result.sourceRowNumber ||
            0
          ) || 0,

        autoId:
          String(
            payload &&
            (
              payload.autoId ||
              payload.entryCode
            ) ||
            result &&
            (
              result.autoId ||
              result.entryCode
            ) ||
            ''
          ),

        receivingCompleteAt:
          String(
            result &&
            result.receivingCompleteAt ||
            ''
          ),

        receivingCompleteEpochMs:
          Number(
            result &&
            result.receivingCompleteEpochMs ||
            0
          ) || 0,

        committedAt:
          now,

        expiresAt:
          now +
          COMMITTED_OVERLAY_MAX_AGE_MS
      };

      localStorage.setItem(
        committedOverlayStorageKey(),
        JSON.stringify(map)
      );
    } catch (error) {
      console.warn(
        'เก็บสถานะรับสินค้าเสร็จชั่วคราวไม่สำเร็จ',
        error
      );
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
      console.warn('เก็บ คิวอัปเดตขั้นตอน ไม่สำเร็จ', error);
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
      console.warn('ล้าง คิวอัปเดตขั้นตอน ไม่สำเร็จ', error);
    }
  }

  function createLocalError(code, message) {
    const error = new Error(message || 'เกิดข้อผิดพลาด');
    error.code = code || 'LOCAL_ERROR';
    return error;
  }

  async function recoverPendingRequests() {
    if (
      recoveryRunning ||
      navigator.onLine ===
        false
    ) {
      return;
    }

    const entries =
      readPendingRequests();

    if (!entries.length) {
      return;
    }

    recoveryRunning =
      true;

    try {
      for (
        const payload of entries
      ) {
        if (
          Date.now() -
            Number(
              payload.queuedAt ||
              0
            ) >
          PENDING_MAX_AGE_MS
        ) {
          removePendingRequest(
            payload.recordId
          );
          continue;
        }

        const button =
          findReceivingButton(
            payload.recordId
          );

        const record =
          window.VehicleModule &&
          typeof window.VehicleModule
            .getRecord ===
            'function'
            ? window.VehicleModule
                .getRecord(
                  payload.recordId
                )
            : null;

        await executeReceiving(
          payload,
          record,
          button,
          {
            interactive:
              false
          }
        );
      }

    } finally {
      recoveryRunning =
        false;
    }
  }

  function applyCommittedState(
    recordId,
    result,
    sourceButton,
    payload
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

    const transitionDetail = {
      recordId:
        recordId,

      canonicalRecordId:
        String(
          result &&
          result.canonicalRecordId ||
          payload &&
          payload.canonicalRecordId ||
          ''
        ),

      sourceRowNumber:
        Number(
          result &&
          result.sourceRowNumber ||
          payload &&
          payload.sourceRowNumber ||
          0
        ) || 0,

      autoId:
        String(
          result &&
          (
            result.autoId ||
            result.entryCode
          ) ||
          payload &&
          (
            payload.autoId ||
            payload.entryCode
          ) ||
          ''
        ),

      receivingCompleteAt:
        timestamp,

      result:
        result ||
        {}
    };

    let appliedDirectly = false;

    if (
      window.VehicleModule &&
      typeof window.VehicleModule
        .applyReceivingCommitted ===
        'function'
    ) {
      try {
        appliedDirectly =
          window.VehicleModule
            .applyReceivingCommitted(
              transitionDetail
            ) === true;
      } catch (error) {
        console.warn(
          'อัปเดตการ์ดหลังรับสินค้าเสร็จแบบ Local ไม่สำเร็จ',
          error
        );
      }
    }

    if (!appliedDirectly) {
      document.dispatchEvent(
        new CustomEvent(
          'alertvendor:receiving-committed',
          {
            detail:
              transitionDetail
          }
        )
      );
    }

    scheduleBoardRevisionCheck(350);
  }

  function scheduleBoardRevisionCheck(
    delayMs
  ) {
    const delay =
      Math.max(
        120,
        Number(delayMs) ||
        250
      );

    window.setTimeout(
      () => {
        if (
          window.VehicleModule &&
          typeof window.VehicleModule
            .verifyOperationalBoardRevision ===
            'function'
        ) {
          window.VehicleModule
            .verifyOperationalBoardRevision(
              120
            );
          return;
        }

        document.dispatchEvent(
          new CustomEvent(
            'alertvendor:check-operational-board-revision'
          )
        );
      },
      delay
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

        focusConfirm:
          true,

        focusCancel:
          false,

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
    result,
    record
  ) {
    if (!window.Swal) {
      return;
    }

    const source =
      record &&
      typeof record === 'object'
        ? record
        : {};

    const appointment =
      String(
        source.appointmentNumber ||
        source.primaryValue ||
        result &&
        result.appointmentNumber ||
        ''
      ).trim();

    const company =
      String(
        source.companyName ||
        result &&
        result.companyName ||
        ''
      ).trim();

    const identity =
      [
        appointment,
        company
      ]
        .filter(Boolean)
        .join(' · ');

    const alreadyCompleted =
      result &&
      result.alreadyCompleted === true;

    await Swal.fire({
      toast: true,
      position: 'bottom',
      icon: undefined,
      title: undefined,
      html: `
        <div class="receiving-snackbar">
          <span class="receiving-snackbar__icon" aria-hidden="true">✓</span>
          <div class="receiving-snackbar__content">
            <strong>
              ${alreadyCompleted
                ? 'รายการนี้บันทึกไว้แล้ว'
                : 'บันทึกรับสินค้าเสร็จสำเร็จ'}
            </strong>
            ${identity
              ? `<span>${escapeHtml(identity)}</span>`
              : ''}
            <small>ย้ายไปรอรับเอกสารคืนแล้ว</small>
          </div>
        </div>
      `,
      timer:
        alreadyCompleted
          ? 1600
          : 1800,
      timerProgressBar: false,
      showConfirmButton: false,
      showCloseButton: false,
      allowEscapeKey: true,
      allowOutsideClick: true,
      customClass: {
        container:
          'receiving-material-snackbar-container',
        popup:
          'receiving-material-snackbar'
      }
    });
  }

  async function showCommittedWithSyncPending(
    result
  ) {
    if (!window.Swal) {
      return;
    }

    await Swal.fire({
      toast: true,
      position: 'bottom',
      icon: undefined,
      title: undefined,
      html: `
        <div class="receiving-snackbar receiving-snackbar--pending">
          <span class="receiving-snackbar__icon" aria-hidden="true">✓</span>
          <div class="receiving-snackbar__content">
            <strong>บันทึกรับสินค้าเสร็จสำเร็จ</strong>
            <small>กำลังย้ายรายการไปขั้นตอนถัดไปอัตโนมัติ</small>
          </div>
        </div>
      `,
      timer: 2200,
      timerProgressBar: false,
      showConfirmButton: false,
      showCloseButton: false,
      allowEscapeKey: true,
      allowOutsideClick: true,
      customClass: {
        container:
          'receiving-material-snackbar-container',
        popup:
          'receiving-material-snackbar'
      }
    });
  }
  async function showQueued(
    error
  ) {
    const code = String(
      error && error.code || 'NETWORK_PENDING'
    ).toUpperCase();
    const offline = navigator.onLine === false;
    const busy = code.includes('BUSY');

    /*
     * Hotfix UX:
     * งานค้าง/Server Busy เป็นสถานะกู้คืนอัตโนมัติ
     * จึงห้ามเปิด Modal บังหน้าจอและห้ามให้ผู้ใช้กดรับทราบ
     */
    if (!window.Swal) {
      return;
    }

    void Swal.fire({
      toast: true,
      position: 'top-end',
      icon:
        offline
          ? 'warning'
          : 'info',
      title:
        offline
          ? 'เก็บรายการไว้แล้ว รออินเทอร์เน็ต'
          : busy
            ? 'กำลังยืนยันผลอัตโนมัติ'
            : 'กำลังตรวจสอบผลจาก Server',
      text:
        offline
          ? 'ระบบจะส่งคำขอเดิมให้อัตโนมัติเมื่อออนไลน์'
          : 'ทำรายการอื่นต่อได้ ไม่ต้องกดปุ่มเดิมซ้ำ',
      timer: 2300,
      timerProgressBar: false,
      showConfirmButton: false,
      showCloseButton: false
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
      button.textContent = 'กำลังบันทึก...';
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
    progressState.open = true;
    progressState.recordId =
      String(
        payload &&
        payload.recordId ||
        ''
      );
    progressState.startedAt =
      Date.now();
    progressState.stage =
      'PREPARE';

    ensureCardProgressPanel(
      progressState.recordId
    );

    updateSavingProgress(
      'PREPARE',
      'กำลังตรวจสอบข้อมูลก่อนบันทึก',
      10
    );

    if (
      progressState.elapsedTimer
    ) {
      window.clearInterval(
        progressState.elapsedTimer
      );
    }

    progressState.elapsedTimer =
      window.setInterval(
        updateProgressElapsed,
        1000
      );
  }

  function updateSavingProgress(
    stage,
    message,
    percent
  ) {
    progressState.stage =
      String(
        stage ||
        progressState.stage ||
        'PREPARE'
      ).toUpperCase();

    if (
      !progressState.recordId
    ) {
      return;
    }

    const panel =
      ensureCardProgressPanel(
        progressState.recordId
      );

    if (!panel) {
      return;
    }

    const normalizedPercent =
      Math.max(
        4,
        Math.min(
          100,
          Number(
            percent || 0
          )
        )
      );

    panel.dataset.state =
      progressState.stage === 'DONE'
        ? 'DONE'
        : 'SAVING';

    panel.dataset.stage =
      progressState.stage;

    const messageNode =
      panel.querySelector(
        '[data-receiving-card-progress-message]'
      );

    if (messageNode) {
      messageNode.textContent =
        message ||
        'กำลังดำเนินการ';
    }

    const bar =
      panel.querySelector(
        '[data-receiving-card-progress-bar]'
      );

    if (bar) {
      bar.style.width =
        normalizedPercent +
        '%';
    }

    updateCardProgressSteps(
      panel,
      progressState.stage
    );
  }

  function updateProgressElapsed() {
    if (
      !progressState.open ||
      !progressState.recordId
    ) {
      return;
    }

    const panel =
      findCardProgressPanel(
        progressState.recordId
      );

    const node =
      panel &&
      panel.querySelector(
        '[data-receiving-card-progress-elapsed]'
      );

    if (!node) {
      return;
    }

    const seconds =
      Math.max(
        0,
        Math.floor(
          (
            Date.now() -
            progressState.startedAt
          ) /
          1000
        )
      );

    node.textContent =
      seconds < 3
        ? 'ระบบตรวจสอบผลให้อัตโนมัติ'
        : 'ยังทำงานอยู่ · สามารถทำรายการอื่นต่อได้';
  }

  function closeSavingProgress() {
    if (
      progressState.elapsedTimer
    ) {
      window.clearInterval(
        progressState.elapsedTimer
      );

      progressState.elapsedTimer =
        null;
    }

    const recordId =
      progressState.recordId;

    if (recordId) {
      const panel =
        findCardProgressPanel(
          recordId
        );

      if (
        panel &&
        panel.dataset.state !==
          'QUEUED' &&
        panel.dataset.state !==
          'ERROR' &&
        panel.dataset.state !==
          'SYNC_PENDING'
      ) {
        panel.remove();
      }

      const card =
        findVehicleCard(
          recordId
        );

      if (card) {
        delete card.dataset
          .receivingSaveState;
      }
    }

    /*
     * ปิด popup รุ่นเก่าที่อาจค้างจาก Cache เดิม
     * แต่รอบนี้จะไม่สร้าง popup สำหรับ Progress อีกแล้ว
     */
    const popup =
      window.Swal &&
      typeof Swal.getPopup ===
        'function'
        ? Swal.getPopup()
        : null;

    if (
      popup &&
      popup.classList.contains(
        'receiving-progress-popup'
      ) &&
      typeof Swal.close ===
        'function'
    ) {
      Swal.close();
    }

    progressState.open = false;
    progressState.recordId = '';
    progressState.stage = '';
  }

  function ensureCardProgressPanel(
    recordId
  ) {
    const card =
      findVehicleCard(
        recordId
      );

    if (!card) {
      return null;
    }

    let panel =
      card.querySelector(
        '.receiving-card-progress'
      );

    if (panel) {
      return panel;
    }

    panel =
      document.createElement(
        'section'
      );

    panel.className =
      'receiving-card-progress';

    panel.dataset.state =
      'SAVING';

    panel.dataset.stage =
      'PREPARE';

    panel.setAttribute(
      'role',
      'status'
    );

    panel.setAttribute(
      'aria-live',
      'polite'
    );

    panel.innerHTML = `
      <div class="receiving-card-progress__header">
        <span class="receiving-card-progress__spinner" aria-hidden="true"></span>
        <div>
          <strong data-receiving-card-progress-message>
            กำลังบันทึกรับสินค้าเสร็จ...
          </strong>
          <small data-receiving-card-progress-elapsed>
            ระบบตรวจสอบผลให้อัตโนมัติ
          </small>
        </div>
      </div>

      <div class="receiving-card-progress__meter" aria-hidden="true">
        <i data-receiving-card-progress-bar></i>
      </div>
    `;

    const footer =
      card.querySelector(
        '.vehicle-card__footer'
      );

    if (footer) {
      card.insertBefore(
        panel,
        footer
      );
    } else {
      card.appendChild(
        panel
      );
    }

    card.dataset.receivingSaveState =
      'SAVING';

    return panel;
  }

  function findCardProgressPanel(
    recordId
  ) {
    const card =
      findVehicleCard(
        recordId
      );

    return card
      ? card.querySelector(
          '.receiving-card-progress'
        )
      : null;
  }

  function updateCardProgressSteps(
    panel,
    stage
  ) {
    const order = [
      'PREPARE',
      'COMMIT',
      'VERIFY',
      'SYNC',
      'DONE'
    ];

    const normalizedStage =
      String(
        stage || 'PREPARE'
      ).toUpperCase();

    const currentIndex =
      order.indexOf(
        normalizedStage
      );

    panel
      .querySelectorAll(
        '[data-receiving-card-progress-step]'
      )
      .forEach(
        (node) => {
          const nodeStage =
            String(
              node.getAttribute(
                'data-receiving-card-progress-step'
              ) ||
              ''
            ).toUpperCase();

          const nodeIndex =
            order.indexOf(
              nodeStage
            );

          node.classList.toggle(
            'is-active',
            nodeIndex ===
              currentIndex
          );

          node.classList.toggle(
            'is-done',
            normalizedStage ===
              'DONE' ||
            (
              nodeIndex >= 0 &&
              currentIndex >= 0 &&
              nodeIndex <
                currentIndex
            )
          );
        }
      );
  }

  function setCardLiveStatus(
    recordId,
    status,
    message
  ) {
    const panel =
      ensureCardProgressPanel(
        recordId
      );

    if (!panel) {
      return;
    }

    const normalizedStatus =
      String(
        status || 'SAVING'
      ).toUpperCase();

    panel.dataset.state =
      normalizedStatus;

    const messageNode =
      panel.querySelector(
        '[data-receiving-card-progress-message]'
      );

    if (messageNode) {
      messageNode.textContent =
        message ||
        'กำลังดำเนินการ';
    }

    const stageMap = {
      SAVING: '',
      VERIFYING: 'VERIFY',
      COMMITTED: 'SYNC',
      SYNCING: 'SYNC',
      SYNC_PENDING: 'SYNC',
      SYNCED: 'DONE',
      DONE: 'DONE',
      QUEUED: 'VERIFY',
      STALE: 'VERIFY',
      ERROR: 'VERIFY'
    };

    const percentMap = {
      SAVING: 12,
      VERIFYING: 68,
      COMMITTED: 86,
      SYNCING: 92,
      SYNC_PENDING: 92,
      SYNCED: 100,
      DONE: 100,
      QUEUED: 64,
      STALE: 70,
      ERROR: 72
    };

    const stage =
      stageMap[
        normalizedStatus
      ] ||
      progressState.stage ||
      'PREPARE';

    panel.dataset.stage =
      stage;

    const bar =
      panel.querySelector(
        '[data-receiving-card-progress-bar]'
      );

    if (bar) {
      bar.style.width =
        String(
          percentMap[
            normalizedStatus
          ] ||
          12
        ) +
        '%';
    }

    updateCardProgressSteps(
      panel,
      stage
    );

    const card =
      findVehicleCard(
        recordId
      );

    if (card) {
      card.dataset.receivingSaveState =
        normalizedStatus;
    }
  }

  function clearCardLiveStatus(
    recordId,
    onlyState
  ) {
    const card =
      findVehicleCard(
        recordId
      );

    if (!card) {
      return;
    }

    const panel =
      card.querySelector(
        '.receiving-card-progress'
      );

    const expectedState =
      String(
        onlyState || ''
      ).toUpperCase();

    if (
      panel &&
      (
        !expectedState ||
        String(
          panel.dataset.state ||
          ''
        ).toUpperCase() ===
          expectedState
      )
    ) {
      panel.remove();
    }

    if (
      !expectedState ||
      String(
        card.dataset
          .receivingSaveState ||
        ''
      ).toUpperCase() ===
        expectedState
    ) {
      delete card.dataset
        .receivingSaveState;
    }
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
      const map =
        readPendingMap();

      map[
        payload.recordId
      ] =
        payload;

      localStorage.setItem(
        storageKey(),
        JSON.stringify(
          map
        )
      );

    } catch (error) {
      console.warn(
        'บันทึก Pending Receiving ไม่สำเร็จ',
        error
      );
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


  window.VehicleReceiving = Object.freeze({
    build:
      BUILD,

    recoverPendingRequests() {
      return recoverPendingRequests();
    },

    recoverPendingWorkflowSyncs() {
      return recoverPendingWorkflowSyncs();
    },

    getCommittedOverlay(recordId) {
      const map =
        readCommittedOverlayMap();

      return map[
        String(
          recordId || ''
        )
      ] || null;
    }
  });

})(
  window,
  document
);
