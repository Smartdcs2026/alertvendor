/**
 * receiving.js
 * Receiving Flow สำหรับหน้า Module
 * ROUND 06 PART 09 — Sync ตรวจรับเสร็จเข้า Inbound Workflow ด้วย Auto ID จริง
 *
 * - ไม่แก้ module.js เดิม
 * - เพิ่มแผงสรุปสำหรับผู้บริหาร
 * - เพิ่มปุ่มบันทึกตรวจรับเสร็จบนการ์ด
 * - แสดงเวลา 2 ช่วง
 * - Admin เปิด/ปิด Feature แยกตาม Module
 * - Silent Refresh แบบ Near Real-time โดยไม่แสดง Loading/Toast
 *   1) Gate In -> รับสินค้าเสร็จ
 *   2) รับสินค้าเสร็จ -> Gate Out
 */
(function (window, document) {
  'use strict';

  const API = window.VehicleAPI;
  const DEFAULT_REFRESH_MS = 15000;
  const DISABLED_REFRESH_MS = 30000;
  const MIN_REFRESH_MS = 10000;
  const MAX_REFRESH_MS = 60000;

  const state = {
    moduleId: '',
    flow: null,
    flowSignature: '',
    enabled: false,
    records: new Map(),
    stageFilter: 'WAITING_RECEIVING',
    refreshDelayMs: DEFAULT_REFRESH_MS,
    refreshTimer: null,
    tickTimer: null,
    observer: null,
    observerRaf: null,
    incompleteObserver: null,
    cardSignatures: new Map(),
    serverOffsetMs: 0,
    loading: false,
    dialogOpen: false,
    savingRecordId: '',
    refreshPending: false,
    scrollQuietUntil: 0,
    scrollQuietTimer: null,
    destroyed: false
  };

  document.addEventListener('DOMContentLoaded', initializeReceivingFlow);
  window.addEventListener('beforeunload', destroyReceivingFlow);

  function initializeReceivingFlow() {
    state.moduleId = getModuleIdFromUrl();

    if (!state.moduleId || !API || typeof API.getReceivingFlow !== 'function') {
      setPanelUnavailable('ระบบ Receiving Flow ยังไม่พร้อม');
      return;
    }

    bindPanelEvents();
    bindReceivingScrollStability();
    observeVehicleCards();
    observeIncompleteSummary();
    correctMovementTerminology();
    syncControlTowerIncomplete();
    void loadReceivingFlow({
      silent: true,
      initial: true
    });

    state.tickTimer =
      window.setInterval(
        updateVisibleStageTimers,
        1000
      );

    document.addEventListener(
      'visibilitychange',
      handleReceivingVisibilityChange
    );

    window.addEventListener(
      'online',
      handleReceivingOnline
    );
  }

  function bindPanelEvents() {
    const panel = document.getElementById('receivingFlowPanel');
    panel && panel.addEventListener('click', handlePanelClick);
    /*
     * ใช้ Capture Phase เพื่อให้ปุ่มตอบสนองก่อน Click Handler
     * ของการ์ดหรือ Module อื่น และเปิดหน้าต่างยืนยันทันที
     */
    document.addEventListener(
      'click',
      handleReceivingCardClick,
      true
    );
  }

  function handlePanelClick(event) {
    const filterButton =
      event.target.closest(
        '[data-receiving-filter]'
      );

    if (filterButton) {
      setReceivingStageFilter(
        filterButton.dataset
          .receivingFilter ||
        'WAITING_RECEIVING'
      );
      return;
    }

    const priorityButton =
      event.target.closest(
        '[data-receiving-scroll-record]'
      );

    if (priorityButton) {
      scrollToRecord(
        priorityButton.dataset
          .receivingScrollRecord
      );
      return;
    }

    const copyButton =
      event.target.closest(
        '[data-receiving-copy-record]'
      );

    if (copyButton) {
      void copyRecordMessage(
        copyButton.dataset
          .receivingCopyRecord
      );
    }
  }


  function setReceivingStageFilter(filterValue) {
    const normalized =
      String(
        filterValue ||
        'WAITING_RECEIVING'
      ).toUpperCase();

    state.stageFilter =
      [
        'ALL',
        'WAITING_RECEIVING',
        'WAITING_GATE_OUT'
      ].includes(normalized)
        ? normalized
        : 'WAITING_RECEIVING';

    syncModuleQueueSelectFromReceivingFilter();
    syncReceivingFilterUi();
    renderPriorityList();
    applyReceivingFilter();
  }


  function syncModuleQueueSelectFromReceivingFilter() {
    const queueSelect =
      document.getElementById(
        'vendorQueueFilter'
      );

    if (!queueSelect) {
      return;
    }

    if (
      state.stageFilter ===
      'WAITING_GATE_OUT'
    ) {
      queueSelect.value =
        'FOLLOW_UP';
      return;
    }

    if (
      state.stageFilter ===
      'WAITING_RECEIVING'
    ) {
      queueSelect.value =
        'ACTIVE';
    }
  }


  function handleReceivingCardClick(event) {
    if (!state.enabled) return;

    const completeButton =
      event.target.closest(
        '[data-receiving-complete-record]'
      );

    if (completeButton) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (
        state.dialogOpen ||
        state.savingRecordId
      ) {
        return;
      }

      const permission =
        getReceivingButtonPermission(
          completeButton
        );

      if (!permission.allowed) {
        void showMessage({
          icon: 'info',
          title: 'ยังไม่ถึงขั้นตอนตรวจรับ',
          text:
            permission.message ||
            'ต้องรอ Inbound บันทึกรับเอกสารก่อน จึงจะบันทึกตรวจรับเสร็จได้',
          confirmButtonText: 'รับทราบ'
        });
        return;
      }

      completeButton.classList.add(
        'is-pressed'
      );

      /*
       * ให้ Browser วาดสถานะกดก่อนหนึ่ง Frame
       * แล้วจึงเปิด SweetAlert ซึ่งผู้ใช้จะเห็นทันที
       */
      window.requestAnimationFrame(
        () => {
          completeButton.classList.remove(
            'is-pressed'
          );

          void handleCompleteReceiving(
            completeButton.dataset
              .receivingCompleteRecord,
            completeButton
          );
        }
      );

      return;
    }

    const copyButton =
      event.target.closest(
        '[data-receiving-copy-card]'
      );

    if (copyButton) {
      event.preventDefault();
      event.stopPropagation();
      void copyRecordMessage(
        copyButton.dataset
          .receivingCopyCard
      );
    }
  }


  function getReceivingButtonPermission(button) {
    if (!button) {
      return {
        allowed: false,
        message: 'ไม่พบปุ่มบันทึกตรวจรับ'
      };
    }

    const card =
      button.closest(
        '.vehicle-card[data-record-id]'
      );

    const allowedByGuard =
      String(
        button.dataset.receivingAllowed ||
        ''
      ).toLowerCase();

    const ariaDisabled =
      String(
        button.getAttribute(
          'aria-disabled'
        ) || ''
      ).toLowerCase();

    if (
      allowedByGuard !== 'true' &&
      (
        button.disabled ||
        ariaDisabled === 'true' ||
        allowedByGuard === 'false'
      )
    ) {
      return {
        allowed: false,
        message:
          button.dataset.receivingBlockMessage ||
          'ต้องรอ Inbound บันทึกรับเอกสารก่อน จึงจะบันทึกตรวจรับเสร็จได้'
      };
    }

    if (
      card &&
      (
        String(card.dataset.hasTimestampOut || '').toLowerCase() === 'true' ||
        String(card.dataset.vendorStage || '').toUpperCase() === 'CLOSED'
      )
    ) {
      return {
        allowed: false,
        message:
          'รายการนี้ปิดงานแล้ว มี Timestamp Out / Gate Out แล้ว'
      };
    }

    const workflowStatus =
      String(
        button.closest('.vehicle-card')?.dataset.workflowGuard ||
        ''
      ).toUpperCase();

    if (
      workflowStatus &&
      workflowStatus !== 'DOCUMENT_SUBMITTED'
    ) {
      return {
        allowed: false,
        message:
          button.dataset.receivingBlockMessage ||
          'Inbound ยังไม่ได้บันทึกรับเอกสาร จึงยังบันทึกตรวจรับเสร็จไม่ได้'
      };
    }

    return {
      allowed: true,
      message: ''
    };
  }



  async function syncInboundWorkflowReceivingComplete(
    item,
    result
  ) {
    if (
      !API ||
      typeof API.completeInboundWorkflowReceiving !==
        'function' ||
      !item
    ) {
      return;
    }

    const workflowIdentity =
      resolveReceivingWorkflowIdentity(
        item
      );

    const syncAutoId =
      workflowIdentity.autoId || '';

    try {
      await API.completeInboundWorkflowReceiving(
        state.moduleId,
        {
          /*
           * Round 06 Part 09:
           * ห้ามใช้ recordId เป็น entryCode หลักอีกต่อไป
           * เพราะ recordId ของหน้า Module อาจเป็นเลขนัดหมาย/รหัสแถว
           * ไม่ใช่ Auto ID จริงของ Gate In
           */
          entryCode:
            syncAutoId ||
            item.entryCode ||
            item.recordId,

          autoId:
            syncAutoId,

          qrText:
            syncAutoId ||
            item.qrText ||
            item.recordId,

          recordId:
            item.recordId,

          sourceRowNumber:
            item.sourceRowNumber,

          expectedTimestampIn:
            item.expectedTimestampIn ||
            item.timestampIn,

          expectedTimestampInEpochMs:
            item.expectedTimestampInEpochMs ||
            item.timestampInEpochMs,

          expectedPrimaryValue:
            item.expectedPrimaryValue ||
            item.primaryValue,

          appointmentNumber:
            workflowIdentity.appointmentNumber ||
            '',

          registration:
            workflowIdentity.registration ||
            '',

          note:
            syncAutoId
              ? 'Sync จากปุ่มตรวจรับเสร็จหน้า Module ด้วย Auto ID ' + syncAutoId
              : 'Sync จากปุ่มตรวจรับเสร็จหน้า Module',

          clientRequestId:
            result &&
            result.requestId
              ? result.requestId
              : ''
        }
      );

    } catch (error) {
      console.warn(
        'Sync ตรวจรับเสร็จเข้า Inbound Workflow ไม่สำเร็จ',
        error
      );

      /*
       * ไม่ย้อนรายการรับสินค้าเสร็จเดิม เพื่อไม่กระทบข้อมูลเดิม
       * แต่แจ้งผู้ใช้ให้ Admin ตรวจสอบ Workflow ต่อ
       */
      if (
        window.Swal &&
        error &&
        !String(error.code || '')
          .includes('RECEIVING_ALREADY_COMPLETED')
      ) {
        await window.Swal.fire({
          icon: 'warning',
          title: 'บันทึกตรวจรับเสร็จแล้ว แต่ยัง Sync Workflow ไม่ครบ',
          text:
            syncAutoId
              ? (
                  'Auto ID: ' +
                  syncAutoId +
                  ' · ' +
                  (error.message || String(error))
                )
              : (
                  'ยังหา Auto ID จริงไม่ได้ · ' +
                  (error.message || String(error))
                ),
          confirmButtonText: 'รับทราบ'
        });
      }
    }
  }

  function resolveReceivingWorkflowIdentity(
    item
  ) {
    const source =
      item &&
      typeof item === 'object'
        ? item
        : {};

    const directAutoId =
      findAutoIdCandidate([
        source.autoId,
        source.entryCode,
        source.qrText,
        source.workflowAutoId,
        source.inboundAutoId,
        source.expectedAutoId
      ]);

    if (directAutoId) {
      return {
        autoId: directAutoId,
        appointmentNumber:
          text(source.appointmentNumber || ''),
        registration:
          text(source.registration || '')
      };
    }

    const fromGuard =
      lookupWorkflowGuardIdentity(
        source
      );

    if (fromGuard.autoId) {
      return fromGuard;
    }

    const fromDom =
      lookupWorkflowIdentityFromDom(
        source
      );

    if (fromDom.autoId) {
      return fromDom;
    }

    const fromFields =
      lookupWorkflowIdentityFromFields(
        source
      );

    if (fromFields.autoId) {
      return fromFields;
    }

    return {
      autoId: '',
      appointmentNumber: '',
      registration: ''
    };
  }

  function lookupWorkflowGuardIdentity(
    item
  ) {
    const guard =
      window.AlertVendorWorkflowGuard;

    if (
      guard &&
      typeof guard.getIdentityForRecord ===
        'function'
    ) {
      const identity =
        guard.getIdentityForRecord(
          item.recordId ||
          item.sourceRowNumber ||
          item.primaryValue ||
          ''
        );

      if (
        identity &&
        identity.autoId
      ) {
        return {
          autoId:
            findAutoIdCandidate([
              identity.autoId
            ]),
          appointmentNumber:
            text(
              identity.appointmentNumber ||
              ''
            ),
          registration:
            text(
              identity.registration ||
              ''
            )
        };
      }
    }

    if (
      guard &&
      typeof guard.getAutoIdForRecord ===
        'function'
    ) {
      const autoId =
        findAutoIdCandidate([
          guard.getAutoIdForRecord(
            item.recordId ||
            item.sourceRowNumber ||
            item.primaryValue ||
            ''
          )
        ]);

      if (autoId) {
        return {
          autoId,
          appointmentNumber: '',
          registration: ''
        };
      }
    }

    return {
      autoId: '',
      appointmentNumber: '',
      registration: ''
    };
  }

  function lookupWorkflowIdentityFromDom(
    item
  ) {
    const recordId =
      String(
        item.recordId ||
        ''
      ).trim();

    const candidates = [];

    if (recordId) {
      candidates.push(
        '.vehicle-card[data-record-id="' +
        cssEscape(recordId) +
        '"]'
      );

      candidates.push(
        '[data-receiving-complete-record="' +
        cssEscape(recordId) +
        '"]'
      );
    }

    for (
      let index = 0;
      index < candidates.length;
      index += 1
    ) {
      const node =
        document.querySelector(
          candidates[index]
        );

      if (!node) continue;

      const card =
        node.closest &&
        (
          node.closest(
            '.vehicle-card[data-record-id]'
          ) ||
          node
        );

      const autoId =
        findAutoIdCandidate([
          node.dataset && node.dataset.workflowAutoId,
          node.dataset && node.dataset.autoId,
          card && card.dataset && card.dataset.workflowAutoId,
          card && card.dataset && card.dataset.autoId,
          node.textContent,
          card && card.textContent
        ]);

      if (autoId) {
        return {
          autoId,
          appointmentNumber:
            text(
              (node.dataset && node.dataset.workflowAppointment) ||
              (card && card.dataset && card.dataset.workflowAppointment) ||
              ''
            ),
          registration:
            text(
              (node.dataset && node.dataset.workflowRegistration) ||
              (card && card.dataset && card.dataset.workflowRegistration) ||
              ''
            )
        };
      }
    }

    return {
      autoId: '',
      appointmentNumber: '',
      registration: ''
    };
  }

  function lookupWorkflowIdentityFromFields(
    item
  ) {
    const fields =
      Array.isArray(
        item && item.fields
      )
        ? item.fields
        : [];

    const joined =
      fields
        .map((field) => {
          if (
            field &&
            typeof field === 'object'
          ) {
            return [
              field.label,
              field.name,
              field.key,
              field.value,
              field.displayValue
            ].join(' ');
          }

          return String(field || '');
        })
        .join(' ');

    return {
      autoId:
        findAutoIdCandidate([
          joined
        ]),
      appointmentNumber: '',
      registration: ''
    };
  }

  function findAutoIdCandidate(
    values
  ) {
    const list =
      Array.isArray(values)
        ? values
        : [values];

    for (
      let index = 0;
      index < list.length;
      index += 1
    ) {
      const value =
        String(
          list[index] ||
          ''
        ).trim();

      if (!value) continue;

      const direct =
        value.match(
          /\bSK\d{6,20}\b/i
        );

      if (direct) {
        return direct[0]
          .toUpperCase();
      }
    }

    return '';
  }

  function cssEscape(value) {
    if (
      window.CSS &&
      typeof window.CSS.escape ===
        'function'
    ) {
      return window.CSS.escape(
        String(value || '')
      );
    }

    return String(value || '')
      .replace(/"/g, '\\22 ')
      .replace(/'/g, '\\27 ');
  }


  async function loadReceivingFlow(options) {
    if (
      state.loading ||
      state.destroyed
    ) {
      return;
    }

    /*
     * ห้าม Silent Refresh สร้าง DOM ใหม่ระหว่างเปิดกล่องยืนยัน
     * หรือระหว่างบันทึก เพราะทำให้ปุ่ม/การ์ดถูกแทนที่กลางคัน
     */
    if (
      state.dialogOpen ||
      state.savingRecordId
    ) {
      state.refreshPending = true;
      scheduleNextReceivingRefresh(900);
      return;
    }

    state.loading = true;

    const config =
      options &&
      typeof options === 'object'
        ? options
        : {};

    try {
      const result =
        await API.getReceivingFlow(
          state.moduleId,
          {
            mode: 'ACTIVE'
          }
        );

      const normalizedResult =
        normalizeReceivingFlowResult(
          result
        );

      state.flow =
        normalizedResult || null;
      configureReceivingRefresh(
        normalizedResult
      );

      if (
        Number.isFinite(
          Number(
            normalizedResult &&
            normalizedResult.generatedAtEpochMs
          )
        )
      ) {
        state.serverOffsetMs =
          Number(
            normalizedResult.generatedAtEpochMs
          ) - Date.now();
      }

      if (
        !normalizedResult ||
        normalizedResult.enabled !== true
      ) {
        disableReceivingUi();
        correctMovementTerminology();
        syncControlTowerIncomplete();
        return;
      }

      enableReceivingUi();

      const nextSignature =
        buildReceivingFlowSignature(
          normalizedResult
        );

      const changed =
        nextSignature !==
        state.flowSignature;

      state.flowSignature =
        nextSignature;

      state.records.clear();

      (
        Array.isArray(
          normalizedResult.records
        )
          ? normalizedResult.records
          : []
      ).forEach(
        (record) => {
          if (
            record &&
            record.recordId
          ) {
            state.records.set(
              String(
                record.recordId
              ),
              record
            );
          }
        }
      );

      updateReceivingMetrics();

      if (
        changed ||
        config.initial === true
      ) {
        renderPriorityList();
        decorateVehicleCards();
      } else {
        /*
         * โครงสร้างข้อมูลไม่เปลี่ยน:
         * ไม่สร้าง Action Queue หรือการ์ดใหม่
         * อัปเดตเฉพาะตัวเลขและ Timer เท่านั้น
         */
        decorateVehicleCardsIfMissing();
      }

      syncReceivingFilterUi();
      applyReceivingFilter();
      updateVisibleStageTimers();

      correctMovementTerminology();
      syncControlTowerIncomplete();

    } catch (error) {
      console.warn(
        'โหลด Receiving Flow ไม่สำเร็จ',
        error
      );

      if (
        state.enabled &&
        config.silent !== true
      ) {
        setPanelUnavailable(
          error &&
          error.message ||
          'โหลดข้อมูลรับสินค้าไม่สำเร็จ'
        );
      }

    } finally {
      state.loading = false;
      scheduleNextReceivingRefresh();
    }
  }


  function normalizeReceivingFlowResult(
    result
  ) {
    if (
      !result ||
      typeof result !== 'object'
    ) {
      return result;
    }

    const records =
      (
        Array.isArray(
          result.records
        )
          ? result.records
          : []
      ).map(
        normalizeReceivingRecordState
      );

    const activeRecords =
      records.filter(
        (record) =>
          record.isCurrentlyInArea ===
            true
      );

    const summary = {
      ...(
        result.summary ||
        {}
      ),

      activeTotal:
        activeRecords.length,

      waitingReceiving:
        activeRecords.filter(
          (record) =>
            record.stageCode ===
              'WAITING_RECEIVING'
        ).length,

      waitingGateOut:
        activeRecords.filter(
          (record) =>
            record.stageCode ===
              'WAITING_GATE_OUT'
        ).length
    };

    const priority =
      activeRecords
        .slice()
        .sort(
          (left, right) => {
            const leftPriority =
              left.stageCode ===
                'WAITING_GATE_OUT'
                ? 2
                : 1;

            const rightPriority =
              right.stageCode ===
                'WAITING_GATE_OUT'
                ? 2
                : 1;

            return (
              rightPriority -
                leftPriority ||
              (
                Number(
                  right.currentStageSeconds
                ) || 0
              ) -
                (
                  Number(
                    left.currentStageSeconds
                  ) || 0
                )
            );
          }
        )
        .slice(
          0,
          10
        );

    return {
      ...result,
      summary:
        summary,
      priority:
        priority,
      records:
        records
    };
  }


  function normalizeReceivingRecordState(
    sourceItem
  ) {
    const item =
      sourceItem &&
      typeof sourceItem === 'object'
        ? sourceItem
        : {};

    const isActive =
      item.isCurrentlyInArea ===
        true;

    const hasReceiving =
      Boolean(
        item.receivingCompleteEpochMs ||
        item.receivingCompleteAt
      );

    const rawTimestampOutEpochMs =
      Number(
        item.timestampOutEpochMs
      );

    const hasTimestampOut =
      Number.isFinite(
        rawTimestampOutEpochMs
      ) &&
      rawTimestampOutEpochMs > 0;

    const gateOutSource =
      String(
        item.gateOutSource ||
        ''
      ).toUpperCase();

    /*
     * รายการ Active ยังอยู่ในพื้นที่
     * จึงห้ามแสดงว่า Gate Out แล้วทุกกรณี
     */
    if (isActive) {
      const nowMs =
        getReceivingNowMs();

      const timestampInEpochMs =
        Number(
          item.timestampInEpochMs
        );

      const receivingEpochMs =
        Number(
          item.receivingCompleteEpochMs
        );

      const activeStageSeconds =
        hasReceiving &&
        Number.isFinite(
          receivingEpochMs
        )
          ? Math.max(
              0,
              Math.floor(
                (
                  nowMs -
                  receivingEpochMs
                ) /
                1000
              )
            )
          : Number.isFinite(
                timestampInEpochMs
              )
            ? Math.max(
                0,
                Math.floor(
                  (
                    nowMs -
                    timestampInEpochMs
                  ) /
                  1000
                )
              )
            : Number(
                item.currentStageSeconds
              ) || 0;

      return {
        ...item,
        stageCode:
          hasReceiving
            ? 'WAITING_GATE_OUT'
            : 'WAITING_RECEIVING',
        stageLabel:
          hasReceiving
            ? 'รับสินค้าเสร็จ รอ Gate Out'
            : 'รอตรวจรับสินค้า',
        isExited:
          false,
        hasRealGateOut:
          false,
        hasAutoClose:
          false,
        rawTimestampOutEpochMs:
          hasTimestampOut
            ? rawTimestampOutEpochMs
            : null,
        timestampOut:
          '',
        timestampOutEpochMs:
          null,
        gateOutSource:
          'PENDING',
        gateOutSourceLabel:
          'ยังไม่มีการสแกน Gate Out',
        canCompleteReceiving:
          !hasReceiving,
        currentStageSeconds:
          activeStageSeconds,
        receivingToGateOutSeconds:
          hasReceiving
            ? activeStageSeconds
            : null,
        receivingToGateOutDisplay:
          hasReceiving
            ? formatDuration(
                activeStageSeconds
              )
            : '',
        arrivalToReceivingSeconds:
          hasReceiving
            ? item.arrivalToReceivingSeconds
            : activeStageSeconds,
        arrivalToReceivingDisplay:
          hasReceiving
            ? item.arrivalToReceivingDisplay
            : formatDuration(
                activeStageSeconds
              )
      };
    }

    const hasAutoClose =
      hasTimestampOut &&
      gateOutSource ===
        'AUTO_CLOSE';

    const hasRealGateOut =
      hasTimestampOut &&
      gateOutSource ===
        'SCANNER';

    let stageCode =
      'INACTIVE_WITHOUT_GATE_OUT_TIME';

    let stageLabel =
      'รายการไม่ Active แต่ไม่พบเวลา Gate Out ที่ยืนยันได้';

    if (hasAutoClose) {
      stageCode =
        hasReceiving
          ? 'AUTO_CLOSED_AFTER_RECEIVING'
          : 'AUTO_CLOSED_WITHOUT_RECEIVING';

      stageLabel =
        hasReceiving
          ? 'รับสินค้าเสร็จแล้ว แต่ไม่พบ Gate Out จริง — ระบบเคลียร์ข้อมูล'
          : 'ระบบเคลียร์ข้อมูล โดยไม่มีข้อมูลรับสินค้าเสร็จ';

    } else if (hasRealGateOut) {
      stageCode =
        hasReceiving
          ? 'EXITED_AFTER_RECEIVING'
          : 'EXITED_WITHOUT_RECEIVING';

      stageLabel =
        hasReceiving
          ? 'Gate Out จริงแล้ว — กระบวนการสมบูรณ์'
          : 'Gate Out จริงแล้ว โดยไม่มีข้อมูลรับสินค้าเสร็จ';
    }

    return {
      ...item,
      stageCode:
        stageCode,
      stageLabel:
        stageLabel,
      isExited:
        hasAutoClose ||
        hasRealGateOut,
      hasRealGateOut:
        hasRealGateOut,
      hasAutoClose:
        hasAutoClose,
      canCompleteReceiving:
        false,
      gateOutSourceLabel:
        hasAutoClose
          ? 'ระบบเคลียร์ข้อมูล ไม่ใช่ Gate Out จริง'
          : hasRealGateOut
            ? 'Gate Out จริง'
            : 'ไม่พบเวลา Gate Out ที่ยืนยันได้'
    };
  }


  function configureReceivingRefresh(result) {
    const refreshSeconds =
      Number(
        result &&
        result.module &&
        result.module.refreshSeconds
      );

    const requestedMs =
      Number.isFinite(
        refreshSeconds
      )
        ? refreshSeconds * 1000
        : DEFAULT_REFRESH_MS;

    state.refreshDelayMs =
      result &&
      result.enabled === true
        ? Math.max(
            MIN_REFRESH_MS,
            Math.min(
              MAX_REFRESH_MS,
              requestedMs
            )
          )
        : DISABLED_REFRESH_MS;
  }


  function scheduleNextReceivingRefresh(
    overrideDelayMs
  ) {
    if (state.destroyed) {
      return;
    }

    if (state.refreshTimer) {
      window.clearTimeout(
        state.refreshTimer
      );
    }

    const delayMs =
      Number.isFinite(
        Number(overrideDelayMs)
      )
        ? Math.max(
            300,
            Number(overrideDelayMs)
          )
        : state.refreshDelayMs;

    state.refreshTimer =
      window.setTimeout(
        () => {
          state.refreshTimer = null;

          if (
            state.dialogOpen ||
            state.savingRecordId
          ) {
            state.refreshPending = true;
            scheduleNextReceivingRefresh(
              900
            );
            return;
          }

          if (
            document.visibilityState ===
              'visible'
          ) {
            void loadReceivingFlow({
              silent: true
            });
          } else {
            scheduleNextReceivingRefresh();
          }
        },
        delayMs
      );
  }


  function requestPendingReceivingRefresh() {
    if (
      !state.refreshPending ||
      state.dialogOpen ||
      state.savingRecordId ||
      state.destroyed
    ) {
      return;
    }

    state.refreshPending = false;

    window.setTimeout(
      () => {
        void loadReceivingFlow({
          silent: true
        });
      },
      0
    );
  }


  function handleReceivingVisibilityChange() {
    if (
      document.visibilityState ===
        'visible'
    ) {
      void loadReceivingFlow({
        silent: true
      });
    }
  }


  function handleReceivingOnline() {
    void loadReceivingFlow({
      silent: true
    });
  }


  function buildReceivingFlowSignature(result) {
    const source =
      result &&
      typeof result === 'object'
        ? result
        : {};

    const summary =
      source.summary &&
      typeof source.summary === 'object'
        ? source.summary
        : {};

    const records =
      Array.isArray(source.records)
        ? source.records
        : [];

    return JSON.stringify({
      enabled:
        source.enabled === true,

      summary: {
        activeTotal:
          Number(summary.activeTotal) || 0,
        waitingReceiving:
          Number(summary.waitingReceiving) || 0,
        waitingGateOut:
          Number(summary.waitingGateOut) || 0,
        receivingCompletedToday:
          Number(summary.receivingCompletedToday) || 0,
        exitedWithoutReceivingToday:
          Number(summary.exitedWithoutReceivingToday) || 0,
        averageArrivalToReceiving:
          summary.averageArrivalToReceiving &&
          summary.averageArrivalToReceiving.display || '',
        averageReceivingToGateOut:
          summary.averageReceivingToGateOut &&
          summary.averageReceivingToGateOut.display || ''
      },

      records:
        records
          .map(
            (record) => ({
              recordId:
                String(record.recordId || ''),
              primaryValue:
                String(record.primaryValue || ''),
              stageCode:
                String(record.stageCode || ''),
              stageLabel:
                String(record.stageLabel || ''),
              timestampIn:
                String(record.timestampIn || ''),
              receivingCompleteAt:
                String(record.receivingCompleteAt || ''),
              canCompleteReceiving:
                record.canCompleteReceiving === true,
              fields:
                (Array.isArray(record.fields) ? record.fields : [])
                  .map(
                    (field) => ({
                      label:
                        String(
                          field &&
                          (field.label || field.displayName || field.header || field.name || field.key) ||
                          ''
                        ),
                      value:
                        String(
                          field &&
                          (field.displayValue ?? field.value ?? field.text ?? '') ||
                          ''
                        ),
                      primary:
                        Boolean(field && field.primary)
                    })
                  )
            })
          )
          .sort(
            (left, right) =>
              left.recordId.localeCompare(right.recordId)
          )
    });
  }

  function enableReceivingUi() {
    state.enabled = true;

    const panel =
      document.getElementById(
        'receivingFlowPanel'
      );

    if (panel) {
      panel.classList.remove(
        'is-hidden'
      );

      panel.removeAttribute(
        'aria-hidden'
      );
    }
  }


  function disableReceivingUi() {
    state.enabled = false;
    state.flowSignature = '';
    state.records.clear();
    state.stageFilter = 'WAITING_RECEIVING';

    const panel =
      document.getElementById(
        'receivingFlowPanel'
      );

    if (panel) {
      panel.classList.add(
        'is-hidden'
      );

      panel.setAttribute(
        'aria-hidden',
        'true'
      );
    }

    document
      .querySelectorAll(
        '[data-receiving-filter]'
      )
      .forEach(
        (button) => {
          const active =
            button.dataset
              .receivingFilter ===
              'WAITING_RECEIVING';

          button.classList.toggle(
            'is-active',
            active
          );

          button.setAttribute(
            'aria-pressed',
            String(active)
          );
        }
      );

    removeReceivingDecorations();
    applyReceivingFilter();
  }


  function removeReceivingDecorations() {
    document
      .querySelectorAll(
        '.receiving-card-stage'
      )
      .forEach(
        (element) => {
          element.remove();
        }
      );

    document
      .querySelectorAll(
        '.vehicle-card[data-receiving-stage]'
      )
      .forEach(
        (card) => {
          delete card.dataset
            .receivingStage;

          card.classList.remove(
            'is-receiving-filter-hidden'
          );
        }
      );
  }


  function decorateVehicleCardsIfMissing() {
    if (!state.enabled) {
      return;
    }

    const missing =
      Array.from(
        document.querySelectorAll(
          '.vehicle-card[data-record-id]'
        )
      ).some(
        (card) => {
          const recordId =
            String(
              card.dataset.recordId ||
              ''
            );

          return (
            state.records.has(
              recordId
            ) &&
            !card.querySelector(
              '.receiving-card-stage'
            )
          );
        }
      );

    if (missing) {
      decorateVehicleCards();
    }
  }

  function updateReceivingMetrics() {
    const flow = state.flow || {};
    const summary = flow.summary || {};

    setText(
      'receivingUpdatedAt',
      flow.generatedAt
        ? 'ข้อมูลล่าสุด ' + flow.generatedAt
        : 'ข้อมูลเป็นปัจจุบัน'
    );
    setText('receivingWaitingCount', formatNumber(summary.waitingReceiving));
    setText('receivingWaitingGateOutCount', formatNumber(summary.waitingGateOut));
    setText('receivingCompletedTodayCount', formatNumber(summary.receivingCompletedToday));
    setText('receivingMissingCount', formatNumber(summary.exitedWithoutReceivingToday));
    setText(
      'receivingAverageStageOne',
      summary.averageArrivalToReceiving && summary.averageArrivalToReceiving.display
        ? summary.averageArrivalToReceiving.display
        : '--:--:--'
    );
    setText(
      'receivingAverageStageTwo',
      summary.averageReceivingToGateOut && summary.averageReceivingToGateOut.display
        ? summary.averageReceivingToGateOut.display
        : '--:--:--'
    );

    const panel = document.getElementById('receivingFlowPanel');
    if (panel) {
      panel.classList.remove('is-unavailable');
      panel.classList.remove('is-hidden');
      panel.removeAttribute('aria-hidden');
    }
  }


  function renderReceivingPanel() {
    updateReceivingMetrics();
    renderPriorityList();
    syncReceivingFilterUi();
    applyReceivingFilter();
  }


  function getReceivingPriorityItems() {
    return Array.from(state.records.values())
      .map(normalizeReceivingRecordState)
      .filter((item) => item.isCurrentlyInArea === true)
      .filter(
        (item) =>
          state.stageFilter === 'ALL' ||
          item.stageCode === state.stageFilter
      )
      .sort(
        (left, right) => {
          const leftStage = left.stageCode === 'WAITING_GATE_OUT' ? 2 : 1;
          const rightStage = right.stageCode === 'WAITING_GATE_OUT' ? 2 : 1;
          return (
            rightStage - leftStage ||
            (Number(right.currentStageSeconds) || 0) -
              (Number(left.currentStageSeconds) || 0)
          );
        }
      )
      .slice(0, 8);
  }


  function renderPriorityList() {
    const container = document.getElementById('receivingPriorityList');
    if (!container) return;

    const items = getReceivingPriorityItems();

    if (items.length === 0) {
      container.innerHTML = `
        <div class="receiving-priority-empty">
          ไม่มีรายการในขั้นตอนที่เลือก
        </div>
      `;
      return;
    }

    container.innerHTML = items.map((item, index) => {
      const identity = getReceivingOperationalIdentity(item);
      return `
        <article
          class="receiving-priority-item"
          data-stage="${escapeHtml(item.stageCode || '')}"
        >
          <div class="receiving-priority-rank">${index + 1}</div>

          <div class="receiving-priority-main">
            <strong>${escapeHtml(identity.company)}</strong>
            <span class="receiving-priority-identity">
              นัดหมาย <b>${escapeHtml(identity.appointment)}</b>
              <i>•</i>
              ทะเบียน <b>${escapeHtml(identity.registration)}</b>
            </span>
            <em>${escapeHtml(item.stageLabel || '-')}</em>
          </div>

          <div class="receiving-priority-time">
            <span>เวลาช่วงปัจจุบัน</span>
            <strong data-receiving-live-timer="${escapeHtml(item.recordId || '')}">
              ${escapeHtml(formatDuration(item.currentStageSeconds))}
            </strong>
          </div>

          <div class="receiving-priority-actions">
            <button
              type="button"
              data-receiving-scroll-record="${escapeHtml(item.recordId || '')}"
            >ดูรายการ</button>

            <button
              type="button"
              data-receiving-copy-record="${escapeHtml(item.recordId || '')}"
            >คัดลอก</button>
          </div>
        </article>
      `;
    }).join('');
  }


  function getReceivingOperationalIdentity(sourceItem) {
    const item = sourceItem && typeof sourceItem === 'object' ? sourceItem : {};
    const fields = Array.isArray(item.fields) ? item.fields : [];

    const findValue = (patterns) => {
      for (const field of fields) {
        const label = normalizeReceivingIdentityText(
          field && (field.label || field.displayName || field.header || field.name || field.key)
        );
        const value = String(
          field && (field.displayValue ?? field.value ?? field.text ?? '') || ''
        ).trim();
        if (value && patterns.some((pattern) => label.includes(pattern))) {
          return value;
        }
      }
      return '';
    };

    return {
      company: String(item.primaryValue || item.expectedPrimaryValue || 'ไม่ระบุบริษัท').trim(),
      appointment:
        findValue(['เลขนัดหมาย','หมายเลขนัดหมาย','นัดหมาย','appointment','booking']) ||
        inferReceivingNumericIdentity(fields) || '-',
      registration:
        findValue(['ทะเบียน','ทะเบียนรถ','registration','plate','หมายเลขรถ','เลขตู้','container']) || '-'
    };
  }


  function inferReceivingNumericIdentity(fields) {
    for (const field of fields) {
      const value = String(
        field && (field.displayValue ?? field.value ?? '') || ''
      ).trim();
      if (/^\d{5,12}$/.test(value)) return value;
    }
    return '';
  }


  function normalizeReceivingIdentityText(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[\s_\-:]+/g, '');
  }


  function syncReceivingFilterUi() {
    const summary = state.flow && state.flow.summary || {};
    const total = Number(summary.activeTotal) || state.records.size;
    const waiting = Number(summary.waitingReceiving) || 0;
    const gateOut = Number(summary.waitingGateOut) || 0;

    setText('receivingFilterAllCount', formatNumber(total));
    setText('receivingFilterWaitingCount', formatNumber(waiting));
    setText('receivingFilterGateOutCount', formatNumber(gateOut));

    document.querySelectorAll('[data-receiving-filter]').forEach((button) => {
      const active = String(button.dataset.receivingFilter || '').toUpperCase() === state.stageFilter;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    document.querySelectorAll('.receiving-flow-metric[data-receiving-filter]').forEach((metric) => {
      metric.classList.toggle(
        'is-filter-active',
        String(metric.dataset.receivingFilter || '').toUpperCase() === state.stageFilter
      );
    });

    const context = document.getElementById('receivingFilterContext');
    if (!context) return;

    const labels = {
      ALL: 'ทั้งหมด',
      WAITING_RECEIVING: 'รอตรวจรับสินค้า',
      WAITING_GATE_OUT: 'รับสินค้าเสร็จ รอ Gate Out'
    };
    const count = state.stageFilter === 'WAITING_RECEIVING'
      ? waiting
      : state.stageFilter === 'WAITING_GATE_OUT'
        ? gateOut
        : total;

    context.dataset.filter = state.stageFilter;
    const labelNode = context.querySelector('strong');
    const countNode = context.querySelector('em');
    if (labelNode) labelNode.textContent = labels[state.stageFilter] || labels.WAITING_RECEIVING;
    if (countNode) countNode.textContent = formatNumber(count) + ' รายการ';
  }

  function observeIncompleteSummary() {
    const source =
      document.getElementById(
        'summaryIncomplete'
      );

    if (!source) {
      return;
    }

    state.incompleteObserver =
      new MutationObserver(
        syncControlTowerIncomplete
      );

    state.incompleteObserver.observe(
      source,
      {
        childList:
          true,

        characterData:
          true,

        subtree:
          true
      }
    );
  }


  function syncControlTowerIncomplete() {
    const source =
      document.getElementById(
        'summaryIncomplete'
      );

    const target =
      document.getElementById(
        'controlIncomplete'
      );

    if (
      source &&
      target
    ) {
      target.textContent =
        String(
          source.textContent ||
          '0'
        ).trim() ||
        '0';
    }
  }


  function getReceivingNowMs() {
    return (
      Date.now() +
      Number(
        state.serverOffsetMs ||
        0
      )
    );
  }


  function observeVehicleCards() {
    const list =
      document.getElementById(
        'vehicleList'
      );

    if (!list) {
      return;
    }

    state.observer =
      new MutationObserver(
        (mutations) => {
          /*
           * การเปลี่ยน innerHTML ภายใน Receiving Card
           * เกิดจากตัว Receiving เอง จึงต้องไม่นำกลับมา
           * เรียก decorateVehicleCards ซ้ำเป็นวงจรไม่สิ้นสุด
           */
          const hasExternalMutation =
            mutations.some(
              (mutation) => {
                const target =
                  mutation.target;

                if (
                  target instanceof Element &&
                  target.closest(
                    '.receiving-card-stage'
                  )
                ) {
                  return false;
                }

                const changedNodes = [
                  ...mutation.addedNodes,
                  ...mutation.removedNodes
                ];

                if (
                  changedNodes.length > 0 &&
                  changedNodes.every(
                    isReceivingOwnedNode
                  )
                ) {
                  return false;
                }

                return true;
              }
            );

          if (!hasExternalMutation) {
            return;
          }

          if (state.observerRaf) {
            return;
          }

          state.observerRaf =
            window.requestAnimationFrame(
              () => {
                state.observerRaf = null;
                decorateVehicleCards();
                applyReceivingFilter();
              }
            );
        }
      );

    state.observer.observe(
      list,
      {
        childList: true,
        subtree: true
      }
    );
  }


  function isReceivingOwnedNode(node) {
    if (!(node instanceof Element)) {
      return true;
    }

    return (
      node.classList.contains(
        'receiving-card-stage'
      ) ||
      Boolean(
        node.closest(
          '.receiving-card-stage'
        )
      )
    );
  }


  function decorateVehicleCards() {
    if (!state.enabled) {
      removeReceivingDecorations();
      return;
    }

    document
      .querySelectorAll(
        '.vehicle-card[data-record-id]'
      )
      .forEach(
        (card) => {
          const recordId =
            String(
              card.dataset.recordId ||
              ''
            );

          const item =
            state.records.get(
              recordId
            );

          if (!item) {
            return;
          }

          card.dataset.receivingStage =
            item.stageCode ||
            'UNKNOWN';

          let stage =
            card.querySelector(
              '.receiving-card-stage'
            );

          if (!stage) {
            stage =
              document.createElement(
                'section'
              );

            stage.className =
              'receiving-card-stage';

            const footer =
              card.querySelector(
                '.vehicle-card__footer'
              );

            footer
              ? card.insertBefore(
                  stage,
                  footer
                )
              : card.appendChild(
                  stage
                );
          }

          const signature =
            buildReceivingCardSignature(
              item
            );

          /*
           * ไม่เขียน innerHTML ซ้ำเมื่อข้อมูลโครงสร้างเดิม
           * ตัวเลขเวลาที่เดินทุกวินาทีอัปเดตเฉพาะ textContent
           */
          if (
            stage.dataset
              .receivingSignature ===
              signature
          ) {
            return;
          }

          stage.dataset.stage =
            item.stageCode ||
            'UNKNOWN';

          stage.dataset
            .receivingSignature =
            signature;

          stage.innerHTML =
            buildReceivingStageHtml(
              item
            );

          state.cardSignatures.set(
            recordId,
            signature
          );
        }
      );

    updateVisibleStageTimers();
  }


  function buildReceivingCardSignature(
    sourceItem
  ) {
    const item =
      normalizeReceivingRecordState(
        sourceItem
      );

    return JSON.stringify({
      recordId:
        item.recordId || '',
      stageCode:
        item.stageCode || '',
      stageLabel:
        item.stageLabel || '',
      receivingCompleteEpochMs:
        Number(
          item.receivingCompleteEpochMs
        ) || 0,
      timestampOutEpochMs:
        Number(
          item.timestampOutEpochMs
        ) || 0,
      gateOutSource:
        item.gateOutSource || '',
      canCompleteReceiving:
        item.canCompleteReceiving ===
          true,
      arrivalToReceivingSeconds:
        item.receivingCompleteEpochMs
          ? Number(
              item.arrivalToReceivingSeconds
            ) || 0
          : null,
      receivingToGateOutSeconds:
        item.timestampOutEpochMs
          ? Number(
              item.receivingToGateOutSeconds
            ) || 0
          : null
    });
  }


  function buildReceivingStageHtml(
    sourceItem
  ) {
    const item =
      normalizeReceivingRecordState(
        sourceItem
      );

    const hasReceiving =
      Boolean(
        item.receivingCompleteEpochMs ||
        item.receivingCompleteAt
      );

    const hasGateOut =
      Boolean(
        item.gateOutSource ||
        item.gateOutAt ||
        item.gateOutEpochMs
      );

    const canShowCompleteButton =
      item.canCompleteReceiving &&
      !hasReceiving &&
      !hasGateOut;

    const stageOneLabel = hasReceiving
      ? 'เข้า → ตรวจรับเสร็จ'
      : 'เข้า → รอตรวจรับ';
    const stageTwoLabel = hasReceiving
      ? 'ตรวจรับเสร็จ → Gate Out'
      : 'เริ่มหลังตรวจรับเสร็จ';

    return `
      <div class="receiving-card-stage__head">
        <div>
          <small>ขั้นตอนตรวจรับ</small>
          <strong>${escapeHtml(item.stageLabel || '-')}</strong>
        </div>

        ${hasReceiving
          ? '<span class="receiving-complete-badge">บันทึกแล้ว</span>'
          : '<span class="receiving-pending-badge">รอดำเนินการ</span>'}
      </div>

      <div class="receiving-stage-grid">
        <div data-phase="ONE">
          <span>${escapeHtml(stageOneLabel)}</span>
          <strong
            data-receiving-live-timer="${escapeHtml(item.recordId || '')}"
            data-receiving-phase="ONE"
          >
            ${escapeHtml(item.arrivalToReceivingDisplay || '--:--:--')}
          </strong>
          <small>
            ${item.receivingCompleteAt
              ? escapeHtml(item.receivingCompleteAt)
              : 'กำลังนับเวลา'}
          </small>
        </div>

        <div data-phase="TWO">
          <span>${escapeHtml(stageTwoLabel)}</span>
          <strong
            data-receiving-live-timer="${escapeHtml(item.recordId || '')}"
            data-receiving-phase="TWO"
          >
            ${escapeHtml(item.receivingToGateOutDisplay || '--:--:--')}
          </strong>
          <small>
            ${item.gateOutSource === 'SCANNER'
              ? 'Gate Out จริง'
              : item.gateOutSource === 'AUTO_CLOSE'
                ? 'ระบบเคลียร์ ไม่ใช่ Gate Out จริง'
                : hasReceiving
                  ? 'กำลังรอสแกน Gate Out'
                  : 'เริ่มนับหลังบันทึกตรวจรับเสร็จ'}
          </small>
        </div>
      </div>

      <div class="receiving-card-stage__actions">
        ${canShowCompleteButton
          ? `
            <button
              type="button"
              class="receiving-complete-button"
              data-receiving-complete-record="${escapeHtml(item.recordId || '')}"
              data-receiving-allowed="${item.canCompleteReceiving ? 'true' : 'false'}"
              aria-disabled="${item.canCompleteReceiving ? 'false' : 'true'}"
              ${item.canCompleteReceiving ? '' : 'disabled'}
            >
              บันทึกตรวจรับเสร็จ
            </button>
          `
          : ''}

        <button
          type="button"
          class="receiving-copy-button"
          data-receiving-copy-card="${escapeHtml(item.recordId || '')}"
        >
          คัดลอกสถานะ
        </button>
      </div>
    `;
  }


  /**
   * สร้างข้อมูลตรวจทานก่อนบันทึกตรวจรับเสร็จ
   * แสดงข้อมูลทุกช่องที่ API ส่งมาใน item.fields
   */
  function buildReceivingReviewHtml(
    sourceItem,
    elapsedSeconds,
    reviewDate
  ) {
    const item =
      normalizeReceivingRecordState(
        sourceItem
      );

    const fields =
      normalizeReceivingReviewFields(
        item
      );

    const fieldRows =
      fields.length > 0
        ? fields
            .map(
              (field) => `
                <div
                  class="receiving-review-field${field.missing ? ' is-missing' : ''}"
                >
                  <span>${escapeHtml(field.label)}</span>

                  <strong>
                    ${escapeHtml(
                      field.missing
                        ? 'ไม่มีข้อมูล'
                        : field.value
                    )}
                  </strong>
                </div>
              `
            )
            .join('')
        : `
            <div class="receiving-review-empty">
              ไม่มีข้อมูลประกอบเพิ่มเติมในรายการนี้
            </div>
          `;

    const sourceRowNumber =
      Number(
        item.sourceRowNumber
      );

    const technicalLine = [
      item.recordId
        ? 'รหัสรายการ: ' +
          String(item.recordId)
        : '',

      Number.isInteger(
        sourceRowNumber
      )
        ? 'แถวต้นทาง: ' +
          sourceRowNumber
        : ''
    ]
      .filter(Boolean)
      .join(' • ');

    return `
      <div class="receiving-review-dialog">
        <section class="receiving-review-step">
          <strong>ขั้นตอนที่กำลังบันทึก</strong>
          <span>Inbound บันทึกรับเอกสารแล้ว → คลัง/User/Admin ยืนยันตรวจรับเสร็จ</span>
        </section>

        <section class="receiving-review-identity">
          <small>รายการที่กำลังบันทึก</small>

          <strong>
            ${escapeHtml(
              item.primaryValue ||
              item.expectedPrimaryValue ||
              '-'
            )}
          </strong>

          <span>
            ${escapeHtml(
              item.stageLabel ||
              'รอตรวจรับสินค้า'
            )}
          </span>

          ${
            technicalLine
              ? `
                  <em>
                    ${escapeHtml(technicalLine)}
                  </em>
                `
              : ''
          }
        </section>

        <section class="receiving-review-summary">
          <div>
            <span>เวลาเข้า Gate In</span>

            <strong>
              ${escapeHtml(
                item.timestampIn ||
                item.expectedTimestampIn ||
                '-'
              )}
            </strong>
          </div>

          <div>
            <span>ระยะเวลาตั้งแต่เข้า</span>

            <strong>
              ${escapeHtml(
                formatDuration(
                  elapsedSeconds
                )
              )}
            </strong>
          </div>

          <div>
            <span>เวลาตรวจทานปัจจุบัน</span>

            <strong>
              ${escapeHtml(
                formatReceivingReviewDateTime(
                  reviewDate
                )
              )}
            </strong>
          </div>

          <div>
            <span>ขั้นตอนหลังบันทึก</span>

            <strong>
              รับเสร็จ รอ Gate Out
            </strong>
          </div>
        </section>

        <section class="receiving-review-section">
          <header>
            <div>
              <small>RECORD DETAILS</small>
              <h3>ข้อมูลรายการทั้งหมด</h3>
            </div>

            <span>
              ${fields.length} ช่องข้อมูล
            </span>
          </header>

          <div class="receiving-review-fields">
            ${fieldRows}
          </div>
        </section>

        <label class="receiving-review-acknowledge">
          <input
            id="receivingReviewCheckbox"
            type="checkbox"
            value="REVIEWED"
          >

          <span>
            <strong>
              ตรวจสอบข้อมูลครบถ้วนแล้ว
            </strong>

            <small>
              ยืนยันว่ารายการ รถ/ตู้ เวลาเข้า
              และข้อมูลประกอบด้านบนถูกต้อง
            </small>
          </span>
        </label>

        <p class="receiving-review-note">
          S&LP SKDC06
        </p>
      </div>
    `;
  }


  function normalizeReceivingReviewFields(
    item
  ) {
    const source =
      Array.isArray(
        item && item.fields
      )
        ? item.fields
        : [];

    const primaryValue =
      String(
        item &&
        (
          item.primaryValue ||
          item.expectedPrimaryValue
        ) ||
        ''
      ).trim();

    const results = [];
    const seen = new Set();

    source.forEach(
      (field, index) => {
        const normalized =
          normalizeReceivingReviewField(
            field,
            index
          );

        /*
         * รายการหลักแสดงแล้วในส่วนหัว
         * จึงไม่แสดงซ้ำในตารางรายละเอียด
         */
        if (
          normalized.primary ||
          (
            primaryValue &&
            normalized.value ===
              primaryValue &&
            normalized.label ===
              'รายการหลัก'
          )
        ) {
          return;
        }

        const signature =
          (
            normalized.label +
            '\u0000' +
            normalized.value
          ).toLowerCase();

        if (seen.has(signature)) {
          return;
        }

        seen.add(signature);
        results.push(normalized);
      }
    );

    return results;
  }


  function normalizeReceivingReviewField(
    field,
    index
  ) {
    if (
      field === null ||
      field === undefined
    ) {
      return {
        label:
          'ข้อมูลช่องที่ ' +
          (index + 1),
        value: '',
        missing: true,
        primary: false
      };
    }

    if (
      typeof field !==
        'object'
    ) {
      const primitiveValue =
        String(field).trim();

      return {
        label:
          'ข้อมูลช่องที่ ' +
          (index + 1),
        value:
          primitiveValue,
        missing:
          !primitiveValue,
        primary: false
      };
    }

    const label =
      String(
        field.label ||
        field.displayName ||
        field.header ||
        field.name ||
        field.key ||
        (
          field.primary
            ? 'รายการหลัก'
            : 'ข้อมูลช่องที่ ' +
              (index + 1)
        )
      ).trim();

    const rawValue =
      field.displayValue ??
      field.value ??
      field.text ??
      field.content ??
      '';

    const value =
      Array.isArray(rawValue)
        ? rawValue
            .map(
              (entry) =>
                String(
                  entry === null ||
                  entry === undefined
                    ? ''
                    : entry
                ).trim()
            )
            .filter(Boolean)
            .join(', ')
        : String(
            rawValue === null ||
            rawValue === undefined
              ? ''
              : rawValue
          ).trim();

    return {
      label:
        label ||
        'ข้อมูลช่องที่ ' +
        (index + 1),
      value:
        value,
      missing:
        !value,
      primary:
        field.primary === true
    };
  }


  function formatReceivingReviewDateTime(
    date
  ) {
    const safeDate =
      date instanceof Date
        ? date
        : new Date(date);

    if (
      Number.isNaN(
        safeDate.getTime()
      )
    ) {
      return '-';
    }

    const parts =
      new Intl.DateTimeFormat(
        'en-GB',
        {
          timeZone:
            'Asia/Bangkok',
          day:
            '2-digit',
          month:
            '2-digit',
          year:
            'numeric',
          hour:
            '2-digit',
          minute:
            '2-digit',
          second:
            '2-digit',
          hour12:
            false
        }
      )
        .formatToParts(
          safeDate
        )
        .reduce(
          (result, part) => {
            result[part.type] =
              part.value;

            return result;
          },
          {}
        );

    return (
      parts.day +
      '/' +
      parts.month +
      '/' +
      parts.year +
      ' ' +
      parts.hour +
      ':' +
      parts.minute +
      ':' +
      parts.second
    );
  }


  async function completeReceivingByInboundWorkflowOnly(item, button) {
    const identity =
      resolveReceivingWorkflowIdentity(
        item
      );

    const autoId =
      identity.autoId ||
      findAutoIdCandidate([
        button &&
        button.dataset &&
        button.dataset.workflowAutoId,
        button &&
        button.closest &&
        button.closest('.vehicle-card') &&
        button.closest('.vehicle-card').dataset &&
        button.closest('.vehicle-card').dataset.autoId
      ]);

    if (!autoId) {
      throw new Error(
        'ไม่พบ Auto ID จึงไม่สามารถบันทึกตรวจรับลง Inbound Workflow ได้'
      );
    }

    const result =
      await API.completeInboundWorkflowReceiving(
        state.moduleId,
        {
          entryCode:
            autoId,
          autoId:
            autoId,
          qrText:
            autoId,
          recordId:
            item.recordId || autoId,
          appointmentNumber:
            identity.appointmentNumber || item.appointmentNumber || '',
          registration:
            identity.registration || item.registration || '',
          note:
            'บันทึกตรวจรับเสร็จจากหน้า Module โดยใช้ Inbound Workflow เป็นแหล่งข้อมูลหลัก',
          clientRequestId:
            'MODULE_RECEIVING_' +
            autoId +
            '_' +
            Date.now()
        }
      );

    return {
      success: true,
      inboundWorkflowOnly: true,
      autoId:
        autoId,
      receivingCompleteAt:
        result &&
        (
          result.receivingCompletedAt ||
          result.updatedAt ||
          result.generatedAt
        ) ||
        formatDateTime(
          new Date(
            getReceivingNowMs()
          )
        ),
      arrivalToReceivingDisplay:
        item.arrivalToReceivingDisplay || '',
      raw:
        result
    };
  }


  async function handleCompleteReceiving(
    recordId,
    button
  ) {
    const cleanRecordId =
      String(recordId || '');

    const item =
      state.records.get(
        cleanRecordId
      );

    if (
      state.dialogOpen ||
      state.savingRecordId
    ) {
      return;
    }

    const permission =
      getReceivingButtonPermission(
        button
      );

    if (!permission.allowed) {
      await showMessage({
        icon: 'info',
        title: 'ยังไม่ถึงขั้นตอนตรวจรับ',
        text:
          permission.message,
        confirmButtonText: 'รับทราบ'
      });
      return;
    }

    if (
      !item
    ) {
      await showMessage({
        icon: 'warning',
        title: 'ไม่พบข้อมูลรายการ',
        text:
          'กรุณารีเฟรชข้อมูล แล้วลองใหม่อีกครั้ง',
        confirmButtonText: 'รับทราบ'
      });
      return;
    }

    const workflowReadyOverride =
      permission.allowed === true &&
      String(
        button &&
        button.dataset &&
        button.dataset.receivingAllowed ||
        ''
      ).toLowerCase() === 'true';

    if (
      !item.canCompleteReceiving &&
      !workflowReadyOverride
    ) {
      await showMessage({
        icon: 'info',
        title: 'ไม่สามารถบันทึกได้',
        text:
          'รายการนี้ตรวจรับเสร็จแล้ว หรือมีเวลาออก / Gate Out แล้ว',
        confirmButtonText: 'รับทราบ'
      });
      return;
    }

    if (
      !item.canCompleteReceiving &&
      workflowReadyOverride &&
      (
        item.receivingCompleteAt ||
        item.receivingCompleteEpochMs ||
        (
          item.gateOutSource &&
          item.gateOutSource !== 'PENDING'
        )
      )
    ) {
      await showMessage({
        icon: 'info',
        title: 'ไม่สามารถบันทึกได้',
        text:
          'รายการนี้ตรวจรับเสร็จแล้ว หรือมีเวลาออก / Gate Out แล้ว',
        confirmButtonText: 'รับทราบ'
      });
      return;
    }

    if (
      item.gateOutSource &&
      item.gateOutSource !== 'PENDING'
    ) {
      await showMessage({
        icon: 'info',
        title: 'รายการนี้ปิดงานแล้ว',
        text:
          'พบข้อมูล Gate Out แล้ว จึงไม่สามารถบันทึกตรวจรับย้อนหลังจากปุ่มนี้ได้',
        confirmButtonText: 'รับทราบ'
      });
      return;
    }

    state.dialogOpen = true;
    document.body.classList.add(
      'receiving-dialog-open'
    );

    const now =
      new Date(
        getReceivingNowMs()
      );

    const elapsedSeconds =
      item.timestampInEpochMs
        ? Math.max(
            0,
            Math.floor(
              (
                now.getTime() -
                Number(
                  item.timestampInEpochMs
                )
              ) / 1000
            )
          )
        : item
            .arrivalToReceivingSeconds;

    try {
      /*
       * ไม่มีการเรียก API หรืออ่านข้อมูลใหม่ก่อนเปิดกล่องนี้
       * กล่องยืนยันจึงต้องปรากฏทันทีหลังแตะปุ่ม
       */
      const confirmation =
        await window.Swal.fire({
          icon: 'question',
          title:
            'ยืนยันบันทึกตรวจรับเสร็จ',
          html:
            buildReceivingReviewHtml(
              item,
              elapsedSeconds,
              now
            ),
          width:
            760,
          showCancelButton: true,
          confirmButtonText:
            'ยืนยันบันทึกตรวจรับเสร็จ',
          cancelButtonText:
            'ย้อนกลับ',
          reverseButtons: true,
          focusConfirm: false,
          allowOutsideClick: false,
          allowEscapeKey: true,
          returnFocus: false,
          customClass: {
            popup:
              'receiving-review-popup',
            htmlContainer:
              'receiving-review-html',
            confirmButton:
              'receiving-review-confirm-button',
            cancelButton:
              'receiving-review-cancel-button'
          },
          didOpen: () => {
            const checkbox =
              document.getElementById(
                'receivingReviewCheckbox'
              );

            const confirmButton =
              window.Swal
                .getConfirmButton();

            if (confirmButton) {
              confirmButton.disabled =
                true;
            }

            if (
              checkbox &&
              confirmButton
            ) {
              checkbox.addEventListener(
                'change',
                () => {
                  confirmButton.disabled =
                    !checkbox.checked;

                  if (
                    checkbox.checked
                  ) {
                    window.Swal
                      .resetValidationMessage();
                  }
                }
              );
            }
          },
          preConfirm: () => {
            const checkbox =
              document.getElementById(
                'receivingReviewCheckbox'
              );

            if (
              !checkbox ||
              checkbox.checked !== true
            ) {
              window.Swal
                .showValidationMessage(
                  'กรุณาตรวจสอบข้อมูลทั้งหมด และทำเครื่องหมายยืนยันก่อนบันทึก'
                );

              return false;
            }

            return true;
          }
        });

      if (!confirmation.isConfirmed) {
        return;
      }

      state.savingRecordId =
        cleanRecordId;

      setButtonLoading(
        button,
        true,
        'กำลังบันทึก...'
      );

      /*
       * ROUND 06 PART 09.2F
       * ใช้ Inbound Workflow เป็นแหล่งบันทึกหลัก 100%
       * ไม่เขียนชีทรับสินค้าเสร็จแยกก่อนแล้วค่อย sync อีกต่อไป
       */
      const result =
        await completeReceivingByInboundWorkflowOnly(
          item,
          button
        );

      if (
        result &&
        result.record
      ) {
        const normalizedRecord =
          normalizeReceivingRecordState(
            result.record
          );

        state.records.set(
          String(
            normalizedRecord.recordId
          ),
          normalizedRecord
        );

        /*
         * ปรับเฉพาะการ์ดที่บันทึกสำเร็จ
         * ไม่วาดการ์ดทั้งหมดใหม่
         */
        const card =
          Array.from(
            document.querySelectorAll(
              '.vehicle-card[data-record-id]'
            )
          ).find(
            (element) =>
              String(
                element.dataset.recordId ||
                ''
              ) ===
              cleanRecordId
          );

        if (card) {
          const stage =
            card.querySelector(
              '.receiving-card-stage'
            );

          if (stage) {
            delete stage.dataset
              .receivingSignature;
          }
        }

        decorateVehicleCards();
      }

      await window.Swal.fire({
        icon: 'success',
        title:
          result &&
          result.alreadyCompleted
            ? 'รายการนี้บันทึกแล้ว'
            : 'บันทึกตรวจรับเสร็จแล้ว',
        html: `
          <div class="receiving-success-dialog">
            <span>วันเวลาตรวจรับเสร็จ</span>

            <strong>
              ${escapeHtml(
                result && (
                  result.receivingCompleteAt ||
                  result.record &&
                  result.record.receivingCompleteAt
                ) || '-'
              )}
            </strong>

            <span>Gate In → ตรวจรับเสร็จ</span>

            <strong>
              ${escapeHtml(
                result && (
                  result.arrivalToReceivingDisplay ||
                  result.record &&
                  result.record.arrivalToReceivingDisplay
                ) || '-'
              )}
            </strong>
          </div>
        `,
        confirmButtonText: 'ตกลง',
        returnFocus: false
      });

      if (button) {
        button.remove();
      }

      state.refreshPending = true;

      document.dispatchEvent(
        new CustomEvent(
          'alertvendor:receiving-completed',
          {
            detail: {
              recordId: cleanRecordId
            }
          }
        )
      );

    } catch (error) {
      await showApiError(
        error,
        'บันทึกตรวจรับเสร็จไม่สำเร็จ'
      );

    } finally {
      setButtonLoading(
        button,
        false
      );

      state.savingRecordId = '';
      state.dialogOpen = false;

      document.body.classList.remove(
        'receiving-dialog-open'
      );

      requestPendingReceivingRefresh();
    }
  }


  function bindReceivingScrollStability() {
    const markActivity = () => {
      state.scrollQuietUntil = Date.now() + 220;

      if (state.scrollQuietTimer) {
        window.clearTimeout(state.scrollQuietTimer);
      }

      document.body.classList.add('is-user-scrolling');

      state.scrollQuietTimer = window.setTimeout(() => {
        state.scrollQuietTimer = null;
        document.body.classList.remove('is-user-scrolling');
        updateVisibleStageTimers();
      }, 240);
    };

    window.addEventListener('scroll', markActivity, { passive: true });
    window.addEventListener('wheel', markActivity, { passive: true });
    window.addEventListener('touchmove', markActivity, { passive: true });
  }


  function updateVisibleStageTimers() {
    if (
      !state.enabled ||
      Date.now() < state.scrollQuietUntil
    ) {
      return;
    }

    const nowMs = getReceivingNowMs();

    document.querySelectorAll('[data-receiving-live-timer]').forEach((element) => {
      const recordId = String(element.dataset.receivingLiveTimer || '');
      const sourceItem = state.records.get(recordId);
      if (!sourceItem) return;

      const item =
        normalizeReceivingRecordState(
          sourceItem
        );

      const phase = String(element.dataset.receivingPhase || '').toUpperCase();
      let seconds = Number(item.currentStageSeconds) || 0;

      if (phase === 'ONE') {
        if (item.receivingCompleteEpochMs) {
          seconds = Number(item.arrivalToReceivingSeconds) || 0;
        } else if (item.timestampInEpochMs) {
          seconds = Math.max(
            0,
            Math.floor((nowMs - Number(item.timestampInEpochMs)) / 1000)
          );
        }
      } else if (phase === 'TWO') {
        if (item.receivingCompleteEpochMs) {
          const endMs = item.timestampOutEpochMs || nowMs;
          seconds = Math.max(
            0,
            Math.floor((Number(endMs) - Number(item.receivingCompleteEpochMs)) / 1000)
          );
        } else {
          element.textContent = '--:--:--';
          return;
        }
      } else if (item.stageCode === 'WAITING_GATE_OUT' && item.receivingCompleteEpochMs) {
        seconds = Math.max(
          0,
          Math.floor((nowMs - Number(item.receivingCompleteEpochMs)) / 1000)
        );
      } else if (item.stageCode === 'WAITING_RECEIVING' && item.timestampInEpochMs) {
        seconds = Math.max(
          0,
          Math.floor((nowMs - Number(item.timestampInEpochMs)) / 1000)
        );
      }

      element.textContent = formatDuration(seconds);
    });
  }

  function applyReceivingFilter() {
    /*
     * ROUND 06 PART 09.2E5
     * ให้ module.js เป็นเจ้าของการกรองหลักของหน้า Module เพียงตัวเดียว
     * receiving.js ห้ามซ่อน/แสดงการ์ดเอง เพราะจะทำให้จำนวนกับรายการไม่ตรงกัน
     */
    document
      .querySelectorAll(
        '.vehicle-card[data-record-id]'
      )
      .forEach((card) => {
        card.classList.remove(
          'is-receiving-filter-hidden'
        );
        card.removeAttribute(
          'aria-hidden'
        );
      });
  }


  function scrollToRecord(recordId) {
    const sourceItem = state.records.get(String(recordId || ''));
    const item = sourceItem ? normalizeReceivingRecordState(sourceItem) : null;

    if (
      item &&
      ['WAITING_RECEIVING','WAITING_GATE_OUT'].includes(item.stageCode)
    ) {
      setReceivingStageFilter(item.stageCode);
    }

    const card = Array.from(
      document.querySelectorAll('.vehicle-card[data-record-id]')
    ).find((element) =>
      String(element.dataset.recordId || '') === String(recordId || '')
    );

    if (!card) return;

    card.classList.remove('is-receiving-filter-hidden');
    card.removeAttribute('aria-hidden');
    card.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center'
    });
    card.classList.add('receiving-highlight');
    window.setTimeout(() => card.classList.remove('receiving-highlight'), 1800);
  }

  async function copyRecordMessage(recordId) {
    const sourceItem = state.records.get(String(recordId || ''));
    if (!sourceItem) return;

    const item =
      normalizeReceivingRecordState(
        sourceItem
      );

    const generatedAt = state.flow && state.flow.generatedAt
      ? state.flow.generatedAt
      : '';

    const lines = [
      'แจ้งติดตามสถานะรถ/ตู้สินค้า',
      '',
      'Module: ' + (
        state.flow && state.flow.module && state.flow.module.name || state.moduleId
      ),
      'รายการ: ' + (item.primaryValue || '-'),
      'เวลาเข้า: ' + (item.timestampIn || '-'),
      'สถานะ: ' + (item.stageLabel || '-'),
      'ช่วงเข้า → ตรวจรับเสร็จ: ' + (
        item.arrivalToReceivingDisplay || formatDuration(item.currentStageSeconds) || '-'
      ),
      'รับสินค้าเสร็จ: ' + (item.receivingCompleteAt || 'ยังไม่บันทึก'),
      'ช่วงตรวจรับเสร็จ → Gate Out: ' + (
        item.receivingToGateOutDisplay || 'ยังไม่เริ่ม'
      ),
      'Gate Out: ' + (item.timestampOut || 'ยังไม่มีการสแกน Gate Out'),
      'สถานะเวลาออก: ' + (item.gateOutSourceLabel || 'ยังไม่มีการสแกน Gate Out'),
      generatedAt ? 'ข้อมูล ณ ' + generatedAt : ''
    ].filter(Boolean);

    try {
      await copyText(lines.join('\n'));
      showToast('คัดลอกข้อความแล้ว', 'success');
    } catch (error) {
      await showMessage({
        icon: 'error',
        title: 'คัดลอกไม่สำเร็จ',
        text: 'เบราว์เซอร์ไม่อนุญาตให้คัดลอกข้อความ'
      });
    }
  }

  function correctMovementTerminology() {
    setMetricLabel(
      '.movement-chart-legend [data-series="OUT"]',
      'ออก/เคลียร์รวม'
    );

    setMetricLabel(
      '#timelineFocusPreview [data-metric="OUT"] span',
      'ออก/เคลียร์'
    );
  }

  function setMetricLabel(selector, text) {
    const element = document.querySelector(selector);
    if (element) element.textContent = text;
  }

  function setPanelUnavailable(message) {
    const panel = document.getElementById('receivingFlowPanel');
    panel && panel.classList.add('is-unavailable');
    setText('receivingUpdatedAt', message || 'ระบบยังไม่พร้อม');
  }

  function setButtonLoading(button, loading, text) {
    if (!button) return;

    if (loading) {
      if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.textContent = text || 'กำลังดำเนินการ...';
    } else {
      button.disabled = false;
      if (button.dataset.originalText) button.textContent = button.dataset.originalText;
    }
  }

  async function showApiError(error, title) {
    if (window.Swal) {
      await window.Swal.fire({
        icon: 'error',
        title: title || 'เกิดข้อผิดพลาด',
        html: `
          <div class="swal-error-content">
            <div>${escapeHtml(error && error.message || 'เกิดข้อผิดพลาดจากระบบ')}</div>
            ${error && error.requestId
              ? `<div class="request-id">รหัสอ้างอิง: ${escapeHtml(error.requestId)}</div>`
              : ''}
          </div>
        `,
        confirmButtonText: 'ตกลง'
      });
      return;
    }

    window.alert(error && error.message || title || 'เกิดข้อผิดพลาด');
  }

  async function showMessage(options) {
    if (window.Swal) return window.Swal.fire(options);
    window.alert(options && (options.text || options.title) || '');
    return { isConfirmed: true };
  }

  function showToast(message, icon) {
    if (!window.Swal) return;
    window.Swal.fire({
      toast: true,
      position: 'top-end',
      icon: icon || 'success',
      title: message,
      showConfirmButton: false,
      timer: 1700,
      timerProgressBar: true
    });
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('COPY_FAILED');
  }

  function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remaining = seconds % 60;
    return (
      String(hours).padStart(2, '0') + ':' +
      String(minutes).padStart(2, '0') + ':' +
      String(remaining).padStart(2, '0')
    );
  }

  function formatNumber(value) {
    return String(Number(value) || 0);
  }

  function setText(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getModuleIdFromUrl() {
    const url = new URL(window.location.href);
    return String(url.searchParams.get('id') || '').trim();
  }

  function destroyReceivingFlow() {
    state.destroyed = true;
    if (state.refreshTimer) window.clearTimeout(state.refreshTimer);
    if (state.tickTimer) window.clearInterval(state.tickTimer);
    if (state.observer) state.observer.disconnect();
    if (state.observerRaf) {
      window.cancelAnimationFrame(
        state.observerRaf
      );
    }
    if (state.incompleteObserver) state.incompleteObserver.disconnect();

    document.removeEventListener(
      'click',
      handleReceivingCardClick,
      true
    );

    document.removeEventListener(
      'visibilitychange',
      handleReceivingVisibilityChange
    );

    window.removeEventListener(
      'online',
      handleReceivingOnline
    );
  }


  function text(value) {
    return String(
      value === undefined ||
      value === null
        ? ''
        : value
    ).trim();
  }

})(window, document);
