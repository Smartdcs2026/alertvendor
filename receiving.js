/**
 * receiving.js
 * Receiving Flow สำหรับหน้า Module
 *
 * - ไม่แก้ module.js เดิม
 * - เพิ่มแผงสรุปสำหรับผู้บริหาร
 * - เพิ่มปุ่มบันทึกรับสินค้าเสร็จบนการ์ด
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
    stageFilter: 'ALL',
    refreshDelayMs: DEFAULT_REFRESH_MS,
    refreshTimer: null,
    tickTimer: null,
    observer: null,
    incompleteObserver: null,
    serverOffsetMs: 0,
    loading: false,
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
    document.addEventListener('click', handleReceivingCardClick);
  }

  function handlePanelClick(event) {
    const filterButton = event.target.closest('[data-receiving-filter]');

    if (filterButton) {
      state.stageFilter = String(
        filterButton.dataset.receivingFilter || 'ALL'
      ).toUpperCase();

      document.querySelectorAll('[data-receiving-filter]').forEach((button) => {
        button.classList.toggle('is-active', button === filterButton);
      });

      applyReceivingFilter();
      return;
    }

    const priorityButton = event.target.closest('[data-receiving-scroll-record]');
    if (priorityButton) {
      scrollToRecord(priorityButton.dataset.receivingScrollRecord);
      return;
    }

    const copyButton = event.target.closest('[data-receiving-copy-record]');
    if (copyButton) {
      void copyRecordMessage(copyButton.dataset.receivingCopyRecord);
    }
  }

  function handleReceivingCardClick(event) {
    if (!state.enabled) return;
    const completeButton = event.target.closest('[data-receiving-complete-record]');

    if (completeButton) {
      event.preventDefault();
      event.stopPropagation();
      void handleCompleteReceiving(
        completeButton.dataset.receivingCompleteRecord,
        completeButton
      );
      return;
    }

    const copyButton = event.target.closest('[data-receiving-copy-card]');
    if (copyButton) {
      event.preventDefault();
      event.stopPropagation();
      void copyRecordMessage(copyButton.dataset.receivingCopyCard);
    }
  }

  async function loadReceivingFlow(options) {
    if (
      state.loading ||
      state.destroyed
    ) {
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

      state.flow = result || null;
      configureReceivingRefresh(result);

      if (
        Number.isFinite(
          Number(
            result &&
            result.generatedAtEpochMs
          )
        )
      ) {
        state.serverOffsetMs =
          Number(
            result.generatedAtEpochMs
          ) - Date.now();
      }

      if (
        !result ||
        result.enabled !== true
      ) {
        disableReceivingUi();
        correctMovementTerminology();
        syncControlTowerIncomplete();
        return;
      }

      enableReceivingUi();

      const nextSignature =
        buildReceivingFlowSignature(
          result
        );

      const changed =
        nextSignature !==
        state.flowSignature;

      state.flowSignature =
        nextSignature;

      state.records.clear();

      (
        Array.isArray(
          result.records
        )
          ? result.records
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

      setText(
        'receivingUpdatedAt',
        result.generatedAt
          ? 'ข้อมูลล่าสุด ' +
            result.generatedAt
          : 'ข้อมูลเป็นปัจจุบัน'
      );

      if (
        changed ||
        config.initial === true
      ) {
        renderReceivingPanel();
        decorateVehicleCards();
        applyReceivingFilter();

      } else {
        /*
         * ข้อมูลไม่เปลี่ยน จึงไม่สร้าง DOM ใหม่
         * ป้องกันหน้าจอกระพริบและรักษา Scroll
         */
        decorateVehicleCardsIfMissing();
      }

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


  function scheduleNextReceivingRefresh() {
    if (state.destroyed) {
      return;
    }

    if (state.refreshTimer) {
      window.clearTimeout(
        state.refreshTimer
      );
    }

    state.refreshTimer =
      window.setTimeout(
        () => {
          state.refreshTimer = null;

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
        state.refreshDelayMs
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


  function buildReceivingFlowSignature(
    result
  ) {
    const source =
      result &&
      typeof result === 'object'
        ? result
        : {};

    return JSON.stringify({
      enabled:
        source.enabled === true,

      summary:
        source.summary || {},

      priority:
        source.priority || [],

      records:
        source.records || []
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
    state.stageFilter = 'ALL';

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
          button.classList.toggle(
            'is-active',
            button.dataset
              .receivingFilter ===
              'ALL'
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

  function renderReceivingPanel() {
    const flow = state.flow || {};
    const summary = flow.summary || {};

    setText(
      'receivingUpdatedAt',
      flow.generatedAt ? 'ข้อมูลล่าสุด ' + flow.generatedAt : 'กำลังโหลดข้อมูล'
    );
    setText('receivingWaitingCount', formatNumber(summary.waitingReceiving));
    setText('receivingWaitingGateOutCount', formatNumber(summary.waitingGateOut));
    setText('receivingCompletedTodayCount', formatNumber(summary.receivingCompletedToday));
    setText('receivingGateOutTodayCount', formatNumber(summary.actualGateOutToday));
    setText('receivingAutoClosedTodayCount', formatNumber(summary.autoClosedToday));
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

    renderPriorityList(Array.isArray(flow.priority) ? flow.priority : []);

    const panel = document.getElementById('receivingFlowPanel');

    if (panel) {
      panel.classList.remove('is-unavailable');
      panel.classList.remove('is-hidden');
      panel.removeAttribute('aria-hidden');
    }
  }

  function renderPriorityList(items) {
    const container = document.getElementById('receivingPriorityList');
    if (!container) return;

    if (!Array.isArray(items) || items.length === 0) {
      container.innerHTML = `
        <div class="receiving-priority-empty">
          ไม่มีรายการที่ต้องติดตามในขณะนี้
        </div>
      `;
      return;
    }

    container.innerHTML = items.slice(0, 5).map((item, index) => `
      <article
        class="receiving-priority-item"
        data-stage="${escapeHtml(item.stageCode || '')}"
      >
        <div class="receiving-priority-rank">${index + 1}</div>

        <div class="receiving-priority-main">
          <strong>${escapeHtml(item.primaryValue || 'ไม่พบข้อมูลหลัก')}</strong>
          <span>${escapeHtml(item.stageLabel || '-')}</span>
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
          >
            ดูรายการ
          </button>

          <button
            type="button"
            data-receiving-copy-record="${escapeHtml(item.recordId || '')}"
          >
            คัดลอก
          </button>
        </div>
      </article>
    `).join('');
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
    const list = document.getElementById('vehicleList');
    if (!list) return;

    state.observer = new MutationObserver(() => {
      window.requestAnimationFrame(() => {
        decorateVehicleCards();
        applyReceivingFilter();
      });
    });

    state.observer.observe(list, { childList: true, subtree: true });
  }

  function decorateVehicleCards() {
    if (!state.enabled) {
      removeReceivingDecorations();
      return;
    }
    document.querySelectorAll('.vehicle-card[data-record-id]').forEach((card) => {
      const recordId = String(card.dataset.recordId || '');
      const item = state.records.get(recordId);
      if (!item) return;

      card.dataset.receivingStage = item.stageCode || 'UNKNOWN';

      let stage = card.querySelector('.receiving-card-stage');
      if (!stage) {
        stage = document.createElement('section');
        stage.className = 'receiving-card-stage';

        const footer = card.querySelector('.vehicle-card__footer');
        footer ? card.insertBefore(stage, footer) : card.appendChild(stage);
      }

      stage.dataset.stage = item.stageCode || 'UNKNOWN';
      stage.innerHTML = buildReceivingStageHtml(item);
    });

    updateVisibleStageTimers();
  }

  function buildReceivingStageHtml(item) {
    const hasReceiving = Boolean(item.receivingCompleteAt);
    const stageOneLabel = hasReceiving
      ? 'เข้า → รับสินค้าเสร็จ'
      : 'เข้า → รอรับสินค้าเสร็จ';
    const stageTwoLabel = hasReceiving
      ? 'รับเสร็จ → Gate Out'
      : 'เริ่มหลังรับสินค้าเสร็จ';

    return `
      <div class="receiving-card-stage__head">
        <div>
          <small>RECEIVING FLOW</small>
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
                  ? 'กำลังรอ Gate Out'
                  : 'ยังไม่เริ่มช่วงที่ 2'}
          </small>
        </div>
      </div>

      <div class="receiving-card-stage__actions">
        ${item.canCompleteReceiving
          ? `
            <button
              type="button"
              class="receiving-complete-button"
              data-receiving-complete-record="${escapeHtml(item.recordId || '')}"
            >
              บันทึกรับสินค้าเสร็จ
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

  async function handleCompleteReceiving(recordId, button) {
    const item = state.records.get(String(recordId || ''));

    if (!item || !item.canCompleteReceiving) {
      await showMessage({
        icon: 'info',
        title: 'ไม่สามารถบันทึกได้',
        text: 'รายการนี้บันทึกรับสินค้าเสร็จแล้ว หรือมีเวลาออกแล้ว'
      });
      return;
    }

    const now = new Date(getReceivingNowMs());
    const elapsedSeconds = item.timestampInEpochMs
      ? Math.max(0, Math.floor((now.getTime() - Number(item.timestampInEpochMs)) / 1000))
      : item.arrivalToReceivingSeconds;

    const confirmation = await window.Swal.fire({
      icon: 'question',
      title: 'ยืนยันรับสินค้าเสร็จ',
      html: `
        <div class="receiving-confirm-dialog">
          <div><span>รายการ</span><strong>${escapeHtml(item.primaryValue || '-')}</strong></div>
          <div><span>เวลาเข้าพื้นที่</span><strong>${escapeHtml(item.timestampIn || '-')}</strong></div>
          <div><span>ระยะเวลาตั้งแต่เข้า</span><strong>${escapeHtml(formatDuration(elapsedSeconds))}</strong></div>
          <p>
            ระบบจะบันทึกวันและเวลาจาก Server
            ในรูปแบบ dd/MM/yyyy HH:mm:ss
          </p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'ยืนยันรับสินค้าเสร็จ',
      cancelButtonText: 'ยกเลิก',
      reverseButtons: true,
      allowOutsideClick: false
    });

    if (!confirmation.isConfirmed) return;

    setButtonLoading(button, true, 'กำลังบันทึก...');

    try {
      const result = await API.completeReceiving(state.moduleId, {
        recordId: item.recordId,
        expectedTimestampIn: item.expectedTimestampIn || item.timestampIn,
        expectedTimestampInEpochMs:
          item.expectedTimestampInEpochMs || item.timestampInEpochMs,
        expectedPrimaryValue: item.expectedPrimaryValue || item.primaryValue
      });

      if (result && result.record) {
        state.records.set(String(result.record.recordId), result.record);
      }

      renderReceivingPanel();
      decorateVehicleCards();
      applyReceivingFilter();

      await window.Swal.fire({
        icon: 'success',
        title: result && result.alreadyCompleted
          ? 'รายการนี้บันทึกแล้ว'
          : 'บันทึกรับสินค้าเสร็จแล้ว',
        html: `
          <div class="receiving-success-dialog">
            <span>วันเวลารับสินค้าเสร็จ</span>
            <strong>
              ${escapeHtml(
                result && (
                  result.receivingCompleteAt ||
                  result.record && result.record.receivingCompleteAt
                ) || '-'
              )}
            </strong>
          </div>
        `,
        confirmButtonText: 'ตกลง'
      });

      void loadReceivingFlow({ silent: true });
    } catch (error) {
      await showApiError(error, 'บันทึกรับสินค้าเสร็จไม่สำเร็จ');
    } finally {
      setButtonLoading(button, false);
    }
  }

  function updateVisibleStageTimers() {
    const nowMs = getReceivingNowMs();

    document.querySelectorAll('[data-receiving-live-timer]').forEach((element) => {
      const recordId = String(element.dataset.receivingLiveTimer || '');
      const item = state.records.get(recordId);
      if (!item) return;

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
    if (!state.enabled) {
      document.querySelectorAll('.vehicle-card').forEach((card) => {
        card.classList.remove('is-receiving-filter-hidden');
      });
      return;
    }
    document.querySelectorAll('.vehicle-card[data-record-id]').forEach((card) => {
      const item = state.records.get(String(card.dataset.recordId || ''));
      const visible = state.stageFilter === 'ALL' || (
        item && item.stageCode === state.stageFilter
      );
      card.classList.toggle('is-receiving-filter-hidden', !visible);
    });
  }

  function scrollToRecord(recordId) {
    state.stageFilter = 'ALL';

    document.querySelectorAll('[data-receiving-filter]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.receivingFilter === 'ALL');
    });

    applyReceivingFilter();

    const card = Array.from(
      document.querySelectorAll('.vehicle-card[data-record-id]')
    ).find((element) => String(element.dataset.recordId || '') === String(recordId || ''));

    if (!card) return;

    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('receiving-highlight');
    window.setTimeout(() => card.classList.remove('receiving-highlight'), 1800);
  }

  async function copyRecordMessage(recordId) {
    const item = state.records.get(String(recordId || ''));
    if (!item) return;

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
      'ช่วงเข้า → รับสินค้าเสร็จ: ' + (
        item.arrivalToReceivingDisplay || formatDuration(item.currentStageSeconds) || '-'
      ),
      'รับสินค้าเสร็จ: ' + (item.receivingCompleteAt || 'ยังไม่บันทึก'),
      'ช่วงรับเสร็จ → Gate Out: ' + (
        item.receivingToGateOutDisplay || 'ยังไม่เริ่ม'
      ),
      'Gate Out: ' + (item.timestampOut || 'ยังไม่มีเวลาออก'),
      'แหล่งเวลาออก: ' + (item.gateOutSourceLabel || '-'),
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
    setMetricLabel('#movementOverview [data-metric="OUT"] > span', 'ออก/เคลียร์รวม');
    setMetricLabel('#movementOverview [data-metric="NET"] > span', 'สุทธิรวม');

    const outReal = document.getElementById('movementOutReal');
    if (outReal && outReal.previousElementSibling) {
      outReal.previousElementSibling.textContent = 'ออกจริง Gate Out';
    }

    const outAuto = document.getElementById('movementOutAuto');
    if (outAuto && outAuto.previousElementSibling) {
      outAuto.previousElementSibling.textContent = 'ระบบเคลียร์ข้อมูล';
    }

    setMetricLabel('.movement-chart-legend [data-series="OUT"]', 'ออก/เคลียร์');
    setMetricLabel('#timelineFocusPreview [data-metric="OUT"] span', 'ออก/เคลียร์');

    const overview = document.getElementById('movementOverview');
    if (overview && !overview.querySelector('.movement-data-definition')) {
      const note = document.createElement('div');
      note.className = 'movement-data-definition';
      note.innerHTML = `
        <strong>คำจำกัดความข้อมูล</strong>
        <span>
          ออก/เคลียร์รวม = Gate Out จริง + ระบบเคลียร์อัตโนมัติ
          โดยระบบเคลียร์ไม่ใช่การออกจากคลังจริง
        </span>
      `;
      overview.appendChild(note);
    }
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
    if (state.incompleteObserver) state.incompleteObserver.disconnect();

    document.removeEventListener(
      'visibilitychange',
      handleReceivingVisibilityChange
    );

    window.removeEventListener(
      'online',
      handleReceivingOnline
    );
  }

})(window, document);
