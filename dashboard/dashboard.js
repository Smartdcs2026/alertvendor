/**
 * dashboard.js
 * ROUND 28 — Executive Dashboard + Silent Refresh
 */
(function (window, document) {
  'use strict';

  const CONFIG =
    window.DASHBOARD_CONFIG || {};

  const API =
    window.DashboardAPI;

  const state = {
    moduleId:
      '',

    session:
      null,

    module:
      {},

    records:
      [],

    movement:
      {},

    receiving:
      {
        enabled:
          false,

        summary:
          {},

        records:
          []
      },

    receivingByRecordId:
      new Map(),

    period:
      'ROLLING_24',

    searchText:
      '',

    statusFilter:
      'ALL',

    stageFilter:
      'ALL',

    serverOffsetMs:
      0,

    signature:
      '',

    refreshInProgress:
      false,

    refreshTimer:
      null,

    clockTimer:
      null,

    chart:
      null,

    destroyed:
      false
  };

  document.addEventListener(
    'DOMContentLoaded',
    initializeDashboard
  );

  window.addEventListener(
    'beforeunload',
    destroyDashboard
  );

  async function initializeDashboard() {
    bindEvents();
    startClock();
    showLoading(true);

    try {
      if (!API) {
        throw new Error(
          'ไม่พบ dashboard-api.js'
        );
      }

      if (
        typeof window.Chart ===
          'undefined'
      ) {
        throw new Error(
          'ไม่พบ Chart.js'
        );
      }

      state.moduleId =
        getModuleIdFromUrl();

      if (!state.moduleId) {
        throw new Error(
          'ไม่พบรหัส Module'
        );
      }

      state.session =
        await API.me();

      if (
        !state.session ||
        !state.session.authenticated
      ) {
        redirectToLogin();
        return;
      }

      await refreshDashboard({
        silent: false,
        initial: true
      });
    } catch (error) {
      if (
        isAuthenticationError(error)
      ) {
        redirectToLogin();
        return;
      }

      await showError(
        error,
        'เปิด Dashboard ไม่สำเร็จ'
      );
    } finally {
      showLoading(false);
    }
  }

  function bindEvents() {
    byId('dashboardBackButton')
      ?.addEventListener(
        'click',
        goBackToModule
      );

    byId('dashboardRefreshButton')
      ?.addEventListener(
        'click',
        () => {
          void refreshDashboard({
            silent: false
          });
        }
      );

    byId('dashboardFullscreenButton')
      ?.addEventListener(
        'click',
        toggleFullscreen
      );

    byId('dashboardPeriodGroup')
      ?.addEventListener(
        'click',
        (event) => {
          const button =
            event.target.closest(
              '[data-period]'
            );

          if (!button) {
            return;
          }

          state.period =
            String(
              button.dataset.period ||
              'ROLLING_24'
            ).toUpperCase();

          document
            .querySelectorAll(
              '[data-period]'
            )
            .forEach(
              (item) => {
                item.classList.toggle(
                  'is-active',
                  item === button
                );
              }
            );

          renderFlowKpis();
          renderHourlyChart(true);
        }
      );

    byId('dashboardSearchInput')
      ?.addEventListener(
        'input',
        debounce(
          (event) => {
            state.searchText =
              String(
                event.target.value ||
                ''
              )
                .trim()
                .toLowerCase();

            renderRecordTable();
          },
          150
        )
      );

    byId('dashboardStatusFilter')
      ?.addEventListener(
        'change',
        (event) => {
          state.statusFilter =
            String(
              event.target.value ||
              'ALL'
            ).toUpperCase();

          renderRecordTable();
        }
      );

    byId('dashboardStageFilter')
      ?.addEventListener(
        'change',
        (event) => {
          state.stageFilter =
            String(
              event.target.value ||
              'ALL'
            ).toUpperCase();

          renderRecordTable();
        }
      );

    document.addEventListener(
      'click',
      handleDashboardClick
    );

    document.addEventListener(
      'visibilitychange',
      () => {
        if (
          document.visibilityState ===
            'visible'
        ) {
          void refreshDashboard({
            silent: true
          });
        }
      }
    );

    window.addEventListener(
      'online',
      () => {
        void refreshDashboard({
          silent: true
        });
      }
    );

    document.addEventListener(
      'fullscreenchange',
      syncFullscreenButton
    );
  }

  function handleDashboardClick(event) {
    const statusButton =
      event.target.closest(
        '[data-status-filter]'
      );

    if (statusButton) {
      state.statusFilter =
        String(
          statusButton.dataset
            .statusFilter ||
          'ALL'
        ).toUpperCase();

      const select =
        byId('dashboardStatusFilter');

      if (select) {
        select.value =
          state.statusFilter;
      }

      renderRecordTable();
      scrollToRecords();
      return;
    }

    const stageButton =
      event.target.closest(
        '[data-stage-filter]'
      );

    if (stageButton) {
      state.stageFilter =
        String(
          stageButton.dataset
            .stageFilter ||
          'ALL'
        ).toUpperCase();

      const select =
        byId('dashboardStageFilter');

      if (select) {
        select.value =
          state.stageFilter;
      }

      renderRecordTable();
      scrollToRecords();
      return;
    }

    const actionButton =
      event.target.closest(
        '[data-action-record]'
      );

    if (actionButton) {
      const title =
        String(
          actionButton.dataset
            .actionRecord ||
          ''
        );

      state.searchText =
        title.toLowerCase();

      const search =
        byId('dashboardSearchInput');

      if (search) {
        search.value = title;
      }

      renderRecordTable();
      scrollToRecords();
    }
  }

  async function refreshDashboard(options) {
    if (
      state.refreshInProgress ||
      state.destroyed
    ) {
      return;
    }

    const config =
      options &&
      typeof options === 'object'
        ? options
        : {};

    const silent =
      config.silent === true;

    state.refreshInProgress =
      true;

    if (!silent) {
      setConnectionState(
        'LOADING',
        'กำลังอัปเดต'
      );

      setRefreshButtonLoading(true);
    }

    try {
      const results =
        await Promise.all([
          API.getModule(
            state.moduleId
          ),

          API.getActiveRecords(
            state.moduleId
          ),

          API.getMovementSummary(
            state.moduleId
          ),

          API.getReceivingFlow(
            state.moduleId
          )
        ]);

      const recordsResult =
        results[1] || {};

      state.module = {
        ...(results[0] || {}),
        ...(recordsResult.module || {})
      };

      state.records =
        Array.isArray(
          recordsResult.records
        )
          ? recordsResult.records
          : [];

      state.movement =
        results[2] || {};

      state.receiving =
        results[3] || {
          enabled: false,
          summary: {},
          records: []
        };

      state.receivingByRecordId =
        new Map();

      (
        Array.isArray(
          state.receiving.records
        )
          ? state.receiving.records
          : []
      ).forEach(
        (record) => {
          if (
            record &&
            record.recordId
          ) {
            state.receivingByRecordId
              .set(
                String(
                  record.recordId
                ),
                record
              );
          }
        }
      );

      updateServerOffset(
        recordsResult.generatedAt ||
        state.movement.generatedAt ||
        state.receiving.generatedAt
      );

      recalculateRecords();

      const nextSignature =
        buildStableSignature();

      const changed =
        nextSignature !==
        state.signature;

      state.signature =
        nextSignature;

      if (
        changed ||
        config.initial === true
      ) {
        const scrollY =
          window.scrollY;

        renderDashboard({
          silent: silent
        });

        if (silent) {
          window.requestAnimationFrame(
            () => {
              window.scrollTo({
                top: scrollY,
                behavior: 'auto'
              });
            }
          );
        }
      } else {
        updateLiveDurations();
      }

      setText(
        'dashboardLastUpdated',
        'ข้อมูลล่าสุด ' +
        (
          recordsResult.generatedAt ||
          state.movement.generatedAt ||
          state.receiving.generatedAt ||
          formatBangkokDateTime(
            getServerNow()
          )
        )
      );

      setConnectionState(
        'ONLINE',
        'Live'
      );
    } catch (error) {
      if (
        isAuthenticationError(error)
      ) {
        redirectToLogin();
        return;
      }

      if (!silent) {
        setConnectionState(
          'ERROR',
          'เชื่อมต่อไม่สำเร็จ'
        );

        await showError(
          error,
          'โหลด Dashboard ไม่สำเร็จ'
        );
      } else {
        console.warn(
          'Dashboard silent refresh ไม่สำเร็จ',
          error
        );
      }
    } finally {
      state.refreshInProgress =
        false;

      if (!silent) {
        setRefreshButtonLoading(false);
      }

      scheduleRefresh();
    }
  }

  function renderDashboard(options) {
    renderModuleHeader();
    renderThresholds();
    renderSituation();
    renderStatusKpis();
    renderFlowKpis();
    renderReceivingKpis();
    renderHourlyChart(
      options &&
      options.silent === true
    );
    renderActionQueue();
    renderRecordTable();
  }

  function renderModuleHeader() {
    setText(
      'dashboardModuleTitle',
      state.module.name ||
      state.module.moduleName ||
      state.moduleId
    );

    setText(
      'dashboardModuleDescription',
      state.module.description ||
      'ติดตามสถานะรถและตู้สินค้าแบบเรียลไทม์'
    );
  }

  function renderThresholds() {
    const thresholds =
      getThresholds();

    setText(
      'dashboardWarningThreshold',
      thresholds.warningMinutes +
      ' นาที'
    );

    setText(
      'dashboardOverdueThreshold',
      thresholds.redMinutes +
      ' นาที'
    );

    setText(
      'dashboardAutoCloseThreshold',
      thresholds.autoCloseHours +
      ' ชม.'
    );
  }

  function renderSituation() {
    const counts =
      countStatuses();

    const receivingSummary =
      state.receiving.summary || {};

    let code = 'NORMAL';
    let label = 'สถานการณ์ปกติ';
    let message =
      'ยังไม่มีรายการที่ต้องเร่งสั่งการ';

    if (counts.OVERDUE > 0) {
      code = 'CRITICAL';
      label = 'ต้องเร่งดำเนินการ';
      message =
        counts.OVERDUE +
        ' รายการเกินเวลา';
    } else if (
      Number(
        receivingSummary
          .waitingGateOut
      ) > 0
    ) {
      code = 'ACTION';
      label = 'ต้องติดตาม Gate Out';
      message =
        receivingSummary
          .waitingGateOut +
        ' รายการรับสินค้าเสร็จแล้วแต่ยังไม่ออก';
    } else if (counts.WARNING > 0) {
      code = 'WATCH';
      label = 'ต้องติดตามใกล้ชิด';
      message =
        counts.WARNING +
        ' รายการใกล้เกินเวลา';
    } else if (
      counts.INCOMPLETE > 0
    ) {
      code = 'DATA';
      label = 'ต้องตรวจสอบข้อมูล';
      message =
        counts.INCOMPLETE +
        ' รายการข้อมูลไม่สมบูรณ์';
    }

    const panel =
      byId('dashboardSituation');

    if (panel) {
      panel.dataset.state = code;
    }

    setText(
      'dashboardSituationLabel',
      label
    );

    setText(
      'dashboardSituationMessage',
      message
    );
  }

  function renderStatusKpis() {
    const counts =
      countStatuses();

    setText(
      'kpiActive',
      state.records.length
    );

    setText(
      'kpiNormal',
      counts.NORMAL
    );

    setText(
      'kpiWarning',
      counts.WARNING
    );

    setText(
      'kpiOverdue',
      counts.OVERDUE
    );

    setText(
      'kpiIncomplete',
      counts.INCOMPLETE
    );
  }

  function renderFlowKpis() {
    const selected =
      getSelectedMovement();

    const inCount =
      Number(selected.in) || 0;

    const outReal =
      Number(selected.outReal) || 0;

    const outAuto =
      Number(selected.outAuto) || 0;

    const netActual =
      inCount - outReal;

    setText('kpiIn', inCount);
    setText('kpiOutReal', outReal);
    setText('kpiAutoClose', outAuto);

    setText(
      'kpiNetActual',
      netActual > 0
        ? '+' + netActual
        : String(netActual)
    );

    setText(
      'dashboardFlowPeriodLabel',
      state.period === 'TODAY'
        ? 'วันนี้'
        : 'ย้อนหลัง 24 ชั่วโมง'
    );
  }

  function renderReceivingKpis() {
    const section =
      byId('dashboardReceivingSection');

    const stageFilter =
      byId('dashboardStageFilter');

    if (
      !state.receiving ||
      state.receiving.enabled !== true
    ) {
      section?.classList.add(
        'is-hidden'
      );

      section?.setAttribute(
        'aria-hidden',
        'true'
      );

      stageFilter?.classList.add(
        'is-hidden'
      );

      state.stageFilter = 'ALL';
      return;
    }

    section?.classList.remove(
      'is-hidden'
    );

    section?.removeAttribute(
      'aria-hidden'
    );

    stageFilter?.classList.remove(
      'is-hidden'
    );

    const summary =
      state.receiving.summary || {};

    setText(
      'kpiWaitingReceiving',
      Number(
        summary.waitingReceiving
      ) || 0
    );

    setText(
      'kpiWaitingGateOut',
      Number(
        summary.waitingGateOut
      ) || 0
    );

    setText(
      'kpiReceivingToday',
      Number(
        summary.receivingCompletedToday
      ) || 0
    );

    setText(
      'kpiMissingReceiving',
      Number(
        summary.exitedWithoutReceivingToday
      ) || 0
    );

    setText(
      'kpiAverageStageOne',
      durationResultText(
        summary.averageArrivalToReceiving
      )
    );

    setText(
      'kpiAverageStageTwo',
      durationResultText(
        summary.averageReceivingToGateOut
      )
    );
  }

  function renderHourlyChart(silent) {
    const canvas =
      byId('hourlyMovementChart');

    if (!canvas) {
      return;
    }

    const hours =
      getHourlyRows();

    byId('hourlyMovementEmpty')
      ?.classList.toggle(
        'is-hidden',
        hours.length > 0
      );

    canvas.classList.toggle(
      'is-hidden',
      hours.length === 0
    );

    if (hours.length === 0) {
      state.chart?.destroy();
      state.chart = null;
      return;
    }

    const data = {
      labels:
        hours.map(getHourLabel),

      datasets: [
        {
          label: 'Gate In',
          data: hours.map(
            (hour) =>
              Number(hour.in) || 0
          ),
          backgroundColor: '#0f9d7a',
          borderRadius: 4
        },
        {
          label: 'Gate Out จริง',
          data: hours.map(
            (hour) =>
              Number(hour.outReal) || 0
          ),
          backgroundColor: '#2563eb',
          borderRadius: 4
        },
        {
          label: 'ระบบเคลียร์ข้อมูล',
          data: hours.map(
            (hour) =>
              Number(hour.outAuto) || 0
          ),
          backgroundColor: '#7c3aed',
          borderRadius: 4
        }
      ]
    };

    if (state.chart) {
      state.chart.data = data;

      state.chart.update(
        silent
          ? 'none'
          : undefined
      );

      return;
    }

    state.chart =
      new Chart(
        canvas,
        {
          type: 'bar',
          data: data,
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: {
              mode: 'index',
              intersect: false
            },
            plugins: {
              legend: {
                position: 'bottom',
                labels: {
                  usePointStyle: true,
                  boxWidth: 8,
                  font: {
                    size: 10
                  }
                }
              }
            },
            scales: {
              x: {
                grid: {
                  display: false
                },
                ticks: {
                  maxRotation: 0,
                  autoSkip: true,
                  maxTicksLimit: 12
                }
              },
              y: {
                beginAtZero: true,
                ticks: {
                  precision: 0
                }
              }
            }
          }
        }
      );
  }

  function renderActionQueue() {
    const container =
      byId('dashboardActionQueue');

    if (!container) {
      return;
    }

    const queue =
      state.records
        .map(buildActionItem)
        .filter(Boolean)
        .sort(
          (left, right) =>
            left.priority -
              right.priority ||
            right.seconds -
              left.seconds
        )
        .slice(0, 8);

    setText(
      'dashboardActionCount',
      queue.length + ' รายการ'
    );

    if (queue.length === 0) {
      container.innerHTML = `
        <div class="dashboard-empty">
          ไม่มีรายการที่ต้องเร่งสั่งการ
        </div>
      `;
      return;
    }

    container.innerHTML =
      queue.map(
        (item, index) => `
          <button
            type="button"
            class="dashboard-action-item"
            data-priority="${item.code}"
            data-action-record="${escapeHtml(item.title)}"
          >
            <span class="dashboard-action-rank">
              ${index + 1}
            </span>

            <span class="dashboard-action-main">
              <strong>${escapeHtml(item.title)}</strong>
              <small>${escapeHtml(item.action)}</small>
            </span>

            <span class="dashboard-action-time">
              ${escapeHtml(formatDuration(item.seconds))}
            </span>
          </button>
        `
      ).join('');
  }

  function buildActionItem(record) {
    const receiving =
      state.receivingByRecordId
        .get(
          String(
            record.recordId || ''
          )
        );

    if (
      record.statusCode ===
        'OVERDUE'
    ) {
      return {
        priority: 0,
        code: 'OVERDUE',
        title: getRecordTitle(record),
        action:
          'เกิน SLA ต้องเร่งติดตาม',
        seconds:
          Number(
            record.durationSeconds
          ) || 0
      };
    }

    if (
      receiving &&
      receiving.stageCode ===
        'WAITING_GATE_OUT'
    ) {
      return {
        priority: 1,
        code: 'WAITING_GATE_OUT',
        title: getRecordTitle(record),
        action:
          'รับสินค้าเสร็จแล้ว รอ Gate Out',
        seconds:
          Number(
            receiving.currentStageSeconds
          ) || 0
      };
    }

    if (
      record.statusCode ===
        'INCOMPLETE'
    ) {
      return {
        priority: 2,
        code: 'INCOMPLETE',
        title: getRecordTitle(record),
        action:
          'ตรวจสอบข้อมูลต้นทาง',
        seconds: 0
      };
    }

    if (
      record.statusCode ===
        'WARNING'
    ) {
      return {
        priority: 3,
        code: 'WARNING',
        title: getRecordTitle(record),
        action:
          'ใกล้ถึงเกณฑ์เกินเวลา',
        seconds:
          Number(
            record.durationSeconds
          ) || 0
      };
    }

    if (
      receiving &&
      receiving.stageCode ===
        'WAITING_RECEIVING'
    ) {
      return {
        priority: 4,
        code: 'WAITING_RECEIVING',
        title: getRecordTitle(record),
        action:
          'รอบันทึกรับสินค้าเสร็จ',
        seconds:
          Number(
            receiving.currentStageSeconds
          ) || 0
      };
    }

    return null;
  }

  function renderRecordTable() {
    const tbody =
      byId('dashboardRecordTableBody');

    if (!tbody) {
      return;
    }

    const records =
      state.records
        .filter(recordMatchesFilters)
        .sort(compareRecords);

    tbody.innerHTML = '';

    byId('dashboardRecordEmpty')
      ?.classList.toggle(
        'is-hidden',
        records.length > 0
      );

    const fragment =
      document.createDocumentFragment();

    records.forEach(
      (record) => {
        const receiving =
          state.receivingByRecordId
            .get(
              String(
                record.recordId || ''
              )
            );

        const row =
          document.createElement('tr');

        row.dataset.status =
          record.statusCode ||
          'INCOMPLETE';

        const stageLabel =
          receiving
            ? receiving.stageLabel
            : 'อยู่ในพื้นที่';

        const stageSeconds =
          receiving
            ? Number(
                receiving.currentStageSeconds
              ) || 0
            : Number(
                record.durationSeconds
              ) || 0;

        row.innerHTML = `
          <td data-label="รายการ">
            <strong>${escapeHtml(getRecordTitle(record))}</strong>
            <small>${escapeHtml(getRecordSecondary(record))}</small>
          </td>

          <td data-label="ขั้นตอน">
            <span
              class="dashboard-stage-badge"
              data-stage="${escapeHtml(receiving && receiving.stageCode || 'ACTIVE')}"
            >
              ${escapeHtml(stageLabel)}
            </span>
          </td>

          <td data-label="เวลาเข้า">
            ${escapeHtml(record.timestampIn || '-')}
          </td>

          <td data-label="เวลาช่วงปัจจุบัน">
            <strong
              class="dashboard-live-duration"
              data-live-record="${escapeHtml(record.recordId || '')}"
            >
              ${escapeHtml(formatDuration(stageSeconds))}
            </strong>
          </td>

          <td data-label="สถานะ SLA">
            <span
              class="dashboard-status-badge"
              data-status="${escapeHtml(record.statusCode || 'INCOMPLETE')}"
            >
              ${escapeHtml(getStatusLabel(record.statusCode))}
            </span>
          </td>
        `;

        fragment.appendChild(row);
      }
    );

    tbody.appendChild(fragment);
  }

  function recordMatchesFilters(record) {
    if (
      state.statusFilter !== 'ALL' &&
      record.statusCode !==
        state.statusFilter
    ) {
      return false;
    }

    const receiving =
      state.receivingByRecordId
        .get(
          String(
            record.recordId || ''
          )
        );

    if (
      state.stageFilter !== 'ALL' &&
      (
        !receiving ||
        receiving.stageCode !==
          state.stageFilter
      )
    ) {
      return false;
    }

    if (!state.searchText) {
      return true;
    }

    return [
      getRecordTitle(record),
      getRecordSecondary(record),
      record.searchText || '',
      receiving &&
      receiving.stageLabel || ''
    ]
      .join(' ')
      .toLowerCase()
      .includes(state.searchText);
  }

  function recalculateRecords() {
    const nowMs =
      getServerNow().getTime();

    const thresholds =
      getThresholds();

    state.records.forEach(
      (record) => {
        const timestampInMs =
          Number(
            record.timestampInEpochMs
          );

        if (
          !record.isCurrentlyInArea ||
          !Number.isFinite(
            timestampInMs
          )
        ) {
          record.durationSeconds = 0;
          record.statusCode =
            'INCOMPLETE';
          return;
        }

        record.durationSeconds =
          Math.max(
            0,
            Math.floor(
              (
                nowMs -
                timestampInMs
              ) / 1000
            )
          );

        record.statusCode =
          record.durationSeconds >=
            thresholds.redSeconds
            ? 'OVERDUE'
            : record.durationSeconds >=
                thresholds.warningSeconds
              ? 'WARNING'
              : 'NORMAL';
      }
    );
  }

  function updateLiveDurations() {
    const nowMs =
      getServerNow().getTime();

    document
      .querySelectorAll(
        '[data-live-record]'
      )
      .forEach(
        (element) => {
          const recordId =
            String(
              element.dataset.liveRecord ||
              ''
            );

          const record =
            state.records.find(
              (item) =>
                String(
                  item.recordId || ''
                ) === recordId
            );

          if (!record) {
            return;
          }

          const receiving =
            state.receivingByRecordId
              .get(recordId);

          let startMs =
            Number(
              record.timestampInEpochMs
            );

          if (
            receiving &&
            receiving.stageCode ===
              'WAITING_GATE_OUT' &&
            receiving
              .receivingCompleteEpochMs
          ) {
            startMs =
              Number(
                receiving
                  .receivingCompleteEpochMs
              );
          }

          const seconds =
            Number.isFinite(startMs)
              ? Math.max(
                  0,
                  Math.floor(
                    (
                      nowMs -
                      startMs
                    ) / 1000
                  )
                )
              : 0;

          element.textContent =
            formatDuration(seconds);
        }
      );
  }

  function startClock() {
    updateClock();

    state.clockTimer =
      window.setInterval(
        () => {
          updateClock();
          updateLiveDurations();
        },
        1000
      );
  }

  function updateClock() {
    setText(
      'dashboardCurrentDateTime',
      formatBangkokDateTime(
        getServerNow()
      )
    );
  }

  function scheduleRefresh() {
    if (state.destroyed) {
      return;
    }

    if (state.refreshTimer) {
      window.clearTimeout(
        state.refreshTimer
      );
    }

    const seconds =
      Math.max(
        10,
        Math.min(
          60,
          Number(
            state.module.refreshSeconds
          ) ||
          Number(
            CONFIG.REFRESH_SECONDS
          ) ||
          15
        )
      );

    state.refreshTimer =
      window.setTimeout(
        () => {
          if (
            document.visibilityState ===
              'visible'
          ) {
            void refreshDashboard({
              silent: true
            });
          } else {
            scheduleRefresh();
          }
        },
        seconds * 1000
      );
  }

  function getThresholds() {
    const thresholds =
      state.movement.thresholds || {};

    const warningMinutes =
      Number(
        thresholds.warningStartMinutes
      ) ||
      Number(
        state.module.warningStartMinutes
      ) || 45;

    const redMinutes =
      Number(
        thresholds.redStartMinutes
      ) ||
      Number(
        state.module.redStartMinutes
      ) || 60;

    const autoCloseHours =
      Number(
        thresholds.autoCloseHours
      ) || 36;

    return {
      warningMinutes: warningMinutes,
      redMinutes: redMinutes,
      autoCloseHours: autoCloseHours,
      warningSeconds:
        warningMinutes * 60,
      redSeconds:
        redMinutes * 60
    };
  }

  function getSelectedMovement() {
    const selected =
      state.period === 'TODAY'
        ? state.movement.today
        : state.movement.rolling24;

    return selected &&
      typeof selected === 'object'
        ? selected
        : state.movement.currentRound ||
          {};
  }

  function getHourlyRows() {
    const hours =
      state.movement.hours || {};

    return state.period === 'TODAY'
      ? (
          Array.isArray(hours.today)
            ? hours.today
            : []
        )
      : (
          Array.isArray(hours.rolling24)
            ? hours.rolling24
            : []
        );
  }

  function countStatuses() {
    const result = {
      NORMAL: 0,
      WARNING: 0,
      OVERDUE: 0,
      INCOMPLETE: 0
    };

    state.records.forEach(
      (record) => {
        const code =
          String(
            record.statusCode ||
            'INCOMPLETE'
          ).toUpperCase();

        if (
          Object.prototype
            .hasOwnProperty.call(
              result,
              code
            )
        ) {
          result[code] += 1;
        } else {
          result.INCOMPLETE += 1;
        }
      }
    );

    return result;
  }

  function compareRecords(left, right) {
    const order = {
      OVERDUE: 0,
      WARNING: 1,
      INCOMPLETE: 2,
      NORMAL: 3
    };

    return (
      (
        order[left.statusCode] ?? 9
      ) -
      (
        order[right.statusCode] ?? 9
      )
    ) ||
    (
      Number(
        right.durationSeconds
      ) -
      Number(
        left.durationSeconds
      )
    );
  }

  function getRecordTitle(record) {
    return String(
      record.primaryValue ||
      record.recordId ||
      'ไม่ระบุรายการ'
    );
  }

  function getRecordSecondary(record) {
    const fields =
      Array.isArray(record.fields)
        ? record.fields
        : [];

    return fields
      .filter(
        (field) =>
          field &&
          field.value &&
          !field.primary
      )
      .slice(0, 2)
      .map(
        (field) => field.value
      )
      .join(' · ') ||
      'ไม่มีข้อมูลประกอบ';
  }

  function getStatusLabel(code) {
    return {
      NORMAL: 'ปกติ',
      WARNING: 'เฝ้าระวัง',
      OVERDUE: 'เกินเวลา',
      INCOMPLETE: 'ข้อมูลไม่สมบูรณ์'
    }[
      String(code || '')
    ] || 'ไม่ทราบสถานะ';
  }

  function getHourLabel(hour) {
    return String(
      hour.label ||
      hour.hourLabel ||
      hour.hour ||
      '--:00'
    );
  }

  function buildStableSignature() {
    return JSON.stringify({
      module: {
        id:
          state.module.id ||
          state.module.moduleId,
        name:
          state.module.name,
        description:
          state.module.description,
        refreshSeconds:
          state.module.refreshSeconds
      },

      records:
        state.records.map(
          (record) => ({
            id:
              record.recordId,
            status:
              record.statusCode,
            in:
              record.timestampInEpochMs,
            out:
              record.timestampOutEpochMs,
            primary:
              record.primaryValue
          })
        ),

      /*
       * ตัด generatedAt / servedAt / remaining time ออกจาก Signature
       * เพื่อไม่ให้ Dashboard วาด DOM ใหม่ทุกครั้งที่ Silent Refresh
       */
      movement: {
        thresholds:
          state.movement.thresholds || {},

        currentState: {
          activeNow:
            state.movement.currentState &&
            state.movement.currentState.activeNow,
          normal:
            state.movement.currentState &&
            state.movement.currentState.normal,
          warning:
            state.movement.currentState &&
            state.movement.currentState.warning,
          overdue:
            state.movement.currentState &&
            state.movement.currentState.overdue,
          incomplete:
            state.movement.currentState &&
            state.movement.currentState.incomplete,
          nearAutoClose:
            state.movement.currentState &&
            state.movement.currentState.nearAutoClose
        },

        today:
          stableMovementMetric(
            state.movement.today
          ),

        rolling24:
          stableMovementMetric(
            state.movement.rolling24
          ),

        hoursToday:
          stableMovementHours(
            state.movement.hours &&
            state.movement.hours.today
          ),

        hoursRolling24:
          stableMovementHours(
            state.movement.hours &&
            state.movement.hours.rolling24
          )
      },

      receiving: {
        enabled:
          state.receiving.enabled,
        summary:
          state.receiving.summary,
        records:
          (
            state.receiving.records ||
            []
          ).map(
            (record) => ({
              id:
                record.recordId,
              stage:
                record.stageCode,
              receiving:
                record
                  .receivingCompleteEpochMs,
              out:
                record.timestampOutEpochMs
            })
          )
      }
    });
  }


  function stableMovementMetric(metric) {
    const source =
      metric &&
      typeof metric === 'object'
        ? metric
        : {};

    return {
      in:
        Number(source.in) || 0,
      outReal:
        Number(source.outReal) || 0,
      outAuto:
        Number(source.outAuto) || 0,
      outTotal:
        Number(source.outTotal) || 0,
      movementTotal:
        Number(source.movementTotal) || 0,
      net:
        Number(source.net) || 0
    };
  }


  function stableMovementHours(hours) {
    return (
      Array.isArray(hours)
        ? hours
        : []
    ).map(
      (hour) => ({
        label:
          getHourLabel(hour),
        in:
          Number(hour.in) || 0,
        outReal:
          Number(hour.outReal) || 0,
        outAuto:
          Number(hour.outAuto) || 0,
        outTotal:
          Number(hour.outTotal) || 0
      })
    );
  }

  function updateServerOffset(value) {
    const date =
      parseSystemDateTime(value);

    if (date) {
      state.serverOffsetMs =
        date.getTime() -
        Date.now();
    }
  }

  function parseSystemDateTime(value) {
    const text =
      String(value || '').trim();

    const match =
      text.match(
        /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/
      );

    if (!match) {
      return null;
    }

    return new Date(
      match[3] + '-' +
      match[2] + '-' +
      match[1] + 'T' +
      match[4] + ':' +
      match[5] + ':' +
      match[6] + '+07:00'
    );
  }

  function getServerNow() {
    return new Date(
      Date.now() +
      state.serverOffsetMs
    );
  }

  function formatBangkokDateTime(date) {
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
        .formatToParts(date)
        .reduce(
          (result, part) => {
            result[part.type] =
              part.value;
            return result;
          },
          {}
        );

    return (
      parts.day + '/' +
      parts.month + '/' +
      parts.year + ' ' +
      parts.hour + ':' +
      parts.minute + ':' +
      parts.second
    );
  }

  function formatDuration(seconds) {
    const total =
      Math.max(
        0,
        Math.floor(
          Number(seconds) || 0
        )
      );

    const hours =
      Math.floor(total / 3600);

    const minutes =
      Math.floor(
        (total % 3600) / 60
      );

    const remaining =
      total % 60;

    return (
      String(hours).padStart(2, '0') +
      ':' +
      String(minutes).padStart(2, '0') +
      ':' +
      String(remaining).padStart(2, '0')
    );
  }

  function durationResultText(result) {
    return result && result.display
      ? result.display
      : '--:--:--';
  }

  function setConnectionState(
    code,
    text
  ) {
    const element =
      byId('dashboardConnection');

    if (element) {
      element.dataset.state = code;
      element.textContent = text;
    }
  }

  function setRefreshButtonLoading(
    loading
  ) {
    const button =
      byId('dashboardRefreshButton');

    if (!button) {
      return;
    }

    button.disabled = loading;

    button.textContent =
      loading
        ? 'กำลังอัปเดต...'
        : 'รีเฟรช';
  }

  function showLoading(show) {
    byId('dashboardLoading')
      ?.classList.toggle(
        'is-hidden',
        !show
      );
  }

  async function showError(error, title) {
    if (!window.Swal) {
      window.alert(
        error &&
        error.message ||
        title
      );
      return;
    }

    await window.Swal.fire({
      icon: 'error',
      title: title,
      text:
        error &&
        error.message ||
        'เกิดข้อผิดพลาด',
      confirmButtonText: 'ตกลง'
    });
  }

  function isAuthenticationError(error) {
    return Boolean(
      error &&
      (
        error.status === 401 ||
        [
          'AUTH_REQUIRED',
          'SESSION_EXPIRED',
          'INVALID_SESSION'
        ].includes(error.code)
      )
    );
  }

  function redirectToLogin() {
    API?.clearSession?.();

    window.location.replace(
      String(
        CONFIG.LOGIN_URL ||
        '../login.html'
      )
    );
  }

  function goBackToModule() {
    window.location.href =
      String(
        CONFIG.MODULE_URL ||
        '../module.html'
      ) +
      '?id=' +
      encodeURIComponent(
        state.moduleId
      );
  }

  async function toggleFullscreen() {
    if (!document.fullscreenElement) {
      await document.documentElement
        .requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  }

  function syncFullscreenButton() {
    const label =
      document.querySelector(
        '[data-fullscreen-label]'
      );

    if (label) {
      label.textContent =
        document.fullscreenElement
          ? 'ออกเต็มจอ'
          : 'เต็มจอ';
    }
  }

  function scrollToRecords() {
    document
      .querySelector(
        '.dashboard-record-panel'
      )
      ?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
  }

  function setText(id, value) {
    const element = byId(id);

    if (element) {
      element.textContent =
        String(
          value === null ||
          value === undefined
            ? ''
            : value
        );
    }
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(
      value === null ||
      value === undefined
        ? ''
        : value
    )
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getModuleIdFromUrl() {
    return String(
      new URL(
        window.location.href
      ).searchParams.get(
        'module'
      ) || ''
    ).trim();
  }

  function debounce(fn, wait) {
    let timer;

    return function (...args) {
      window.clearTimeout(timer);

      timer =
        window.setTimeout(
          () => fn(...args),
          wait
        );
    };
  }

  function destroyDashboard() {
    state.destroyed = true;

    if (state.refreshTimer) {
      window.clearTimeout(
        state.refreshTimer
      );
    }

    if (state.clockTimer) {
      window.clearInterval(
        state.clockTimer
      );
    }

    state.chart?.destroy();
  }

})(window, document);
