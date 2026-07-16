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
    '2026.07.17-r16-fast-commit-durable-recovery';

  const MAX_COMMIT_ATTEMPTS = 3;
  const VERIFY_ATTEMPTS = 4;
  const PENDING_MAX_AGE_MS =
    48 * 60 * 60 * 1000;
  const STORAGE_PREFIX =
    'alertvendor:receiving-pending:v2:';

  const inFlight = new Set();
  let recoveryRunning = false;

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

    window.addEventListener(
      'online',
      () => {
        void recoverPendingRequests();
      }
    );

    window.setTimeout(
      () => {
        void recoverPendingRequests();
      },
      700
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
      options &&
      typeof options ===
        'object'
        ? options
        : {};

    const recordId =
      String(
        payload.recordId ||
        ''
      );

    if (
      !recordId ||
      inFlight.has(
        recordId
      )
    ) {
      return;
    }

    const moduleId =
      getModuleId();

    if (!moduleId) {
      removePendingRequest(
        recordId
      );

      if (
        config.interactive !==
        false
      ) {
        await showError(
          'ไม่พบรหัส Module',
          'MODULE_ID_MISSING'
        );
      }

      return;
    }

    if (
      !API ||
      typeof API.completeReceiving !==
        'function'
    ) {
      if (
        config.interactive !==
        false
      ) {
        await showError(
          'ไม่พบ API สำหรับบันทึกรับสินค้าเสร็จ',
          'RECEIVING_API_MISSING'
        );
      }

      return;
    }

    inFlight.add(
      recordId
    );

    setButtonLoading(
      button,
      true
    );

    try {
      let result;

      try {
        result =
          await commitWithRetry(
            moduleId,
            payload
          );

      } catch (error) {
        const verified =
          await verifyCommit(
            moduleId,
            payload
          );

        if (
          verified &&
          verified.completed ===
            true
        ) {
          result = {
            success:
              true,

            committed:
              true,

            alreadyCompleted:
              true,

            verifiedAfterError:
              true,

            message:
              'Server ยืนยันว่าบันทึกรับสินค้าเสร็จแล้ว',

            receivingCompleteAt:
              verified
                .receivingCompleteAt ||
              '',

            receivingCompleteEpochMs:
              Number(
                verified
                  .receivingCompleteEpochMs
              ) || 0,

            requestId:
              verified.requestId ||
              payload.clientRequestId,

            workflowSync:
              verified.workflowSync &&
              typeof verified.workflowSync ===
                'object'
                ? verified.workflowSync
                : {
                    success:
                      false,

                    verificationOnly:
                      true,

                    code:
                      'WORKFLOW_SYNC_NOT_CONFIRMED'
                  }
          };

        } else if (
          isTemporaryError(
            error
          ) ||
          navigator.onLine ===
            false
        ) {
          /*
           * ทั้ง Network/Timeout และ Server Busy เป็นสถานะชั่วคราว
           * เก็บ Request ID เดิมไว้ แล้ว Replay โดยไม่สร้างข้อมูลซ้ำ
           */
          setButtonQueued(
            button
          );

          if (
            config.interactive !==
            false
          ) {
            await showQueued(
              error
            );
          }

          if (
            navigator.onLine !==
            false
          ) {
            window.setTimeout(
              () => {
                void recoverPendingRequests();
              },
              Math.max(
                900,
                retryDelay(
                  error,
                  1
                )
              )
            );
          }

          return;

        } else {
          removePendingRequest(
            recordId
          );

          throw error;
        }
      }

      removePendingRequest(
        recordId
      );

      applyCommittedState(
        recordId,
        result,
        button
      );

      if (
        result &&
        result.workflowSync &&
        result.workflowSync.success ===
          false
      ) {
        scheduleWorkflowRepair(
          moduleId,
          payload
        );

        if (
          config.interactive !==
            false
        ) {
          await showCommittedWithSyncPending(
            result
          );
        }

      } else if (
        config.interactive !==
        false
      ) {
        await showSuccess(
          result
        );

      } else {
        showRecoveryToast(
          'ส่งคำขอรับสินค้าเสร็จที่ค้างไว้สำเร็จ'
        );
      }

      scheduleBoardRefresh();

    } catch (error) {
      if (
        config.interactive !==
          false
      ) {
        await showSaveError(
          error
        );
      }

    } finally {
      inFlight.delete(
        recordId
      );

      if (
        !hasPendingRequest(
          recordId
        )
      ) {
        setButtonLoading(
          button,
          false
        );
      }
    }
  }

  async function commitWithRetry(
    moduleId,
    payload
  ) {
    let lastError =
      null;

    for (
      let attempt = 0;
      attempt <
        MAX_COMMIT_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await API
          .completeReceiving(
            moduleId,
            payload
          );

      } catch (error) {
        lastError =
          error;

        if (
          !isTemporaryError(
            error
          ) ||
          attempt >=
            MAX_COMMIT_ATTEMPTS -
              1 ||
          navigator.onLine ===
            false
        ) {
          throw error;
        }

        await delay(
          retryDelay(
            error,
            attempt
          )
        );
      }
    }

    throw lastError ||
    new Error(
      'บันทึกรับสินค้าเสร็จไม่สำเร็จ'
    );
  }

  async function verifyCommit(
    moduleId,
    payload
  ) {
    if (
      !API ||
      typeof API
        .getReceivingCommitStatus !==
        'function' ||
      navigator.onLine ===
        false
    ) {
      return null;
    }

    for (
      let attempt = 0;
      attempt <
        VERIFY_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const result =
          await API
            .getReceivingCommitStatus(
              moduleId,
              payload
            );

        if (
          result &&
          result.completed ===
            true
        ) {
          return result;
        }

      } catch (error) {
        if (
          isAuthenticationError(
            error
          )
        ) {
          throw error;
        }
      }

      if (
        attempt <
        VERIFY_ATTEMPTS - 1
      ) {
        await delay(
          450 +
          attempt * 550
        );
      }
    }

    return null;
  }

  function scheduleWorkflowRepair(
    moduleId,
    payload
  ) {
    window.setTimeout(
      async () => {
        if (
          navigator.onLine ===
            false
        ) {
          return;
        }

        try {
          await API.completeReceiving(
            moduleId,
            payload
          );
          scheduleBoardRefresh();

        } catch (error) {
          console.warn(
            'Workflow repair retry ยังไม่สำเร็จ',
            error
          );
        }
      },
      1800
    );
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

  async function showSuccess(
    result
  ) {
    if (!window.Swal) {
      return;
    }

    const alreadyCompleted =
      result &&
      result.alreadyCompleted ===
        true;

    await Swal.fire({
      icon:
        'success',

      title:
        alreadyCompleted
          ? 'รายการนี้บันทึกไว้แล้ว'
          : 'บันทึกรับสินค้าเสร็จแล้ว',

      text:
        result &&
        result.message ||
        'เปลี่ยนสถานะเป็นรอรับเอกสารคืนแล้ว',

      confirmButtonText:
        'ตกลง',

      timer:
        alreadyCompleted
          ? 1200
          : 900,

      timerProgressBar:
        true,

      showConfirmButton:
        false
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

    await Swal.fire({
      icon:
        'info',

      title:
        'เก็บคำขอไว้แล้ว',

      text:
        navigator.onLine ===
          false
          ? 'อุปกรณ์ออฟไลน์ ระบบจะส่งคำขอนี้อัตโนมัติเมื่ออินเทอร์เน็ตกลับมา'
          : (
              String(
                error &&
                error.code ||
                ''
              ).toUpperCase().includes(
                'BUSY'
              )
                ? 'ระบบกำลังเขียนข้อมูลจากคำขออื่น คำขอนี้ถูกเก็บไว้และจะลองใหม่อัตโนมัติโดยไม่สร้างข้อมูลซ้ำ'
                : 'การตอบกลับไม่แน่นอน ระบบจะตรวจสอบและส่งซ้ำโดยไม่สร้างข้อมูลซ้ำ'
            ),

      footer:
        escapeHtml(
          error &&
          error.code ||
          'NETWORK_PENDING'
        ),

      confirmButtonText:
        'รับทราบ'
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
    const code =
      String(
        error &&
        error.code ||
        'RECEIVING_SAVE_FAILED'
      );

    const message =
      String(
        error &&
        error.message ||
        'บันทึกรับสินค้าเสร็จไม่สำเร็จ'
      );

    let guidance =
      '';

    if (
      code ===
        'RECEIVING_BUSY' ||
      code ===
        'INBOUND_WORKFLOW_BUSY'
    ) {
      guidance =
        'ระบบตรวจสอบและลองซ้ำอัตโนมัติแล้ว แต่ยังมีงานเขียนค้างอยู่ กรุณากดใหม่อีกครั้ง';
    } else if (
      code ===
        'RECORD_CHANGED' ||
      code ===
        'RECORD_NO_LONGER_ACTIVE'
    ) {
      guidance =
        'ข้อมูลรายการเปลี่ยนแล้ว ระบบจะโหลด Snapshot ล่าสุด';
    } else if (
      code ===
        'DOCUMENT_SUBMIT_REQUIRED' ||
      code ===
        'WORKFLOW_STAGE_ORDER_INVALID'
    ) {
      guidance =
        'ให้ Inbound ยื่นเอกสารก่อน แล้วรีเฟรชข้อมูล';
    }

    if (window.Swal) {
      await Swal.fire({
        icon:
          'error',

        title:
          'บันทึกรับสินค้าเสร็จไม่สำเร็จ',

        html: `
          <p>${escapeHtml(message)}</p>
          ${guidance ? `<p>${escapeHtml(guidance)}</p>` : ''}
          <div class="receiving-error-code">
            รหัส: ${escapeHtml(code)}
          </div>
        `,

        confirmButtonText:
          'ตกลง'
      });
    }

    if (
      [
        'RECORD_CHANGED',
        'RECORD_NO_LONGER_ACTIVE',
        'RECEIVING_ALREADY_COMPLETED'
      ].includes(
        code
      )
    ) {
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
    const code =
      String(
        error &&
        error.code ||
        ''
      ).toUpperCase();

    return [
      'RECEIVING_BUSY',
      'INBOUND_WORKFLOW_BUSY',
      'REQUEST_TIMEOUT',
      'NETWORK_ERROR',
      'EMPTY_RESPONSE',
      'INVALID_JSON_RESPONSE',
      'UPSTREAM_TIMEOUT',
      'GAS_TIMEOUT'
    ].includes(
      code
    ) ||
    [
      408,
      409,
      429,
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
      button.dataset.originalText =
        button.textContent ||
        '';

      button.disabled =
        true;

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

    if (
      button.isConnected &&
      button.dataset.canComplete ===
        'TRUE'
    ) {
      button.disabled =
        false;

      button.textContent =
        button.dataset
          .originalText ||
        'บันทึกรับสินค้าเสร็จ';
    }
  }

  function setButtonQueued(
    button
  ) {
    if (!button) {
      return;
    }

    button.disabled =
      true;

    button.setAttribute(
      'aria-busy',
      'true'
    );

    button.textContent =
      'รอส่งเมื่อออนไลน์';
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

})(
  window,
  document
);
