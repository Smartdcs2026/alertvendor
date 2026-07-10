/**
 * dashboard.js
 * ROUND 05 HOTFIX 30 — Executive Control Room Dashboard Session Fix
 */
(function (window, document) {
  'use strict';

  const CONFIG = window.DASHBOARD_CONFIG || {};
  const API = window.DashboardAPI;

  const COLORS = Object.freeze({
    green: '#0f9d7a',
    amber: '#e88709',
    red: '#e33434',
    blue: '#2369d8',
    purple: '#7c3aed',
    slate: '#7b91a0',
    navy: '#0b4868',
    grid: '#e5edf2',
    text: '#516b7d'
  });

  const state = {
    moduleId: '',
    session: null,
    module: {},
    records: [],
    movement: {},
    receiving: {
      enabled: false,
      summary: {},
      records: []
    },
    receivingByRecordId: new Map(),
    period: 'ROLLING_24',
    searchText: '',
    statusFilter: 'ALL',
    stageFilter: 'ALL',
    serverOffsetMs: 0,
    signature: '',
    refreshInProgress: false,
    refreshTimer: null,
    clockTimer: null,
    charts: {
      hourly: null,
      status: null,
      activeTrend: null,
      longestWaiting: null
    },
    destroyed: false,
    mobileChart: 'hourly',
    mobileRecordView: 'COMPACT',
    mobileRecordLimit: 12,
    responsiveMobile: null
  };

  const doughnutCenterPlugin = {
    id: 'dashboardDoughnutCenter',

    afterDraw(chart) {
      if (
        chart.canvas.id !== 'statusDistributionChart' ||
        !chart.chartArea
      ) {
        return;
      }

      const {ctx, chartArea} = chart;
      const total = state.records.length;
      const x = (chartArea.left + chartArea.right) / 2;
      const y = (chartArea.top + chartArea.bottom) / 2;

      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.fillStyle = '#6a8190';
      ctx.font = '700 9px system-ui';
      ctx.fillText('รวม', x, y - 13);

      ctx.fillStyle = '#10283a';
      ctx.font = '900 23px system-ui';
      ctx.fillText(String(total), x, y + 4);

      ctx.fillStyle = '#6a8190';
      ctx.font = '700 8px system-ui';
      ctx.fillText('รายการ', x, y + 20);

      ctx.restore();
    }
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
        throw new Error('ไม่พบ dashboard-api.js');
      }

      if (typeof window.Chart === 'undefined') {
        throw new Error('ไม่พบ Chart.js');
      }

      Chart.register(doughnutCenterPlugin);

      state.moduleId = getModuleIdFromUrl();

      if (!state.moduleId) {
        throw new Error('ไม่พบรหัส Module');
      }

      state.session = await API.me();

      if (
        !state.session ||
        !state.session.authenticated
      ) {
        redirectToLogin();
        return;
      }

      if (!isDashboardAllowedRole(state.session)) {
        if (getSessionRole(state.session) === 'INBOUND') {
          redirectToInbound();
          return;
        }

        redirectToLogin();
        return;
      }

      renderUserIdentity();
      syncResponsiveDashboard();

      await refreshDashboard({
        silent: false,
        initial: true
      });
    } catch (error) {
      if (isAuthenticationError(error)) {
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
      ?.addEventListener('click', goBackToModule);

    byId('dashboardRefreshButton')
      ?.addEventListener(
        'click',
        () => void refreshDashboard({silent: false})
      );

    byId('dashboardFullscreenButton')
      ?.addEventListener('click', toggleFullscreen);

    byId('dashboardPeriodGroup')
      ?.addEventListener(
        'click',
        (event) => {
          const button = event.target.closest('[data-period]');

          if (!button) {
            return;
          }

          state.period = String(
            button.dataset.period || 'ROLLING_24'
          ).toUpperCase();

          document
            .querySelectorAll('[data-period]')
            .forEach(
              (item) => item.classList.toggle(
                'is-active',
                item === button
              )
            );

          renderPeriodDependentData(false);
        }
      );

    byId('dashboardSearchInput')
      ?.addEventListener(
        'input',
        debounce(
          (event) => {
            state.searchText = String(
              event.target.value || ''
            ).trim().toLowerCase();

            renderRecordTable();
          },
          130
        )
      );

    byId('dashboardStatusFilter')
      ?.addEventListener(
        'change',
        (event) => {
          state.statusFilter = String(
            event.target.value || 'ALL'
          ).toUpperCase();

          renderRecordTable();
        }
      );

    byId('dashboardStageFilter')
      ?.addEventListener(
        'change',
        (event) => {
          state.stageFilter = String(
            event.target.value || 'ALL'
          ).toUpperCase();

          renderRecordTable();
        }
      );

    byId('dashboardResetFilters')
      ?.addEventListener(
        'click',
        resetRecordFilters
      );

    byId('mobileAnalyticsTabs')
      ?.addEventListener(
        'click',
        handleMobileChartTab
      );

    document
      .querySelector('.mobile-view-switch')
      ?.addEventListener(
        'click',
        handleMobileRecordView
      );

    byId('mobileLoadMoreRecords')
      ?.addEventListener(
        'click',
        () => {
          state.mobileRecordLimit += 12;
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
        if (document.visibilityState === 'visible') {
          void refreshDashboard({silent: true});
        }
      }
    );

    window.addEventListener(
      'online',
      () => void refreshDashboard({silent: true})
    );

    window.addEventListener(
      'resize',
      debounce(
        () => {
          syncResponsiveDashboard();
          resizeCharts();
        },
        120
      )
    );

    document.addEventListener(
      'fullscreenchange',
      syncFullscreenButton
    );
  }



  function handleMobileRecordView(event) {
    const button =
      event.target.closest(
        '[data-mobile-view]'
      );

    if (!button) {
      return;
    }

    const mode =
      String(
        button.dataset.mobileView ||
        'COMPACT'
      ).toUpperCase();

    state.mobileRecordView =
      mode === 'DETAIL'
        ? 'DETAIL'
        : 'COMPACT';

    state.mobileRecordLimit = 12;

    document.body.dataset.mobileRecordView =
      state.mobileRecordView;

    const recordsPanel =
      document.querySelector(
        '.records-panel'
      );

    if (recordsPanel) {
      recordsPanel.classList.toggle(
        'is-compact-view',
        state.mobileRecordView ===
          'COMPACT'
      );

      recordsPanel.classList.toggle(
        'is-detail-view',
        state.mobileRecordView ===
          'DETAIL'
      );
    }

    document
      .querySelectorAll(
        '[data-mobile-view]'
      )
      .forEach(
        (item) => item.classList.toggle(
          'is-active',
          item === button
        )
      );

    renderRecordTable();
  }


  function showMobileRecordDetails(recordId) {
    const record =
      state.records.find(
        (item) =>
          String(
            item.recordId ||
            ''
          ) ===
          String(
            recordId ||
            ''
          )
      );

    if (!record) {
      return;
    }

    const receiving =
      state.receivingByRecordId.get(
        String(
          record.recordId ||
          ''
        )
      );

    const dimensions =
      extractRecordDimensions(
        record
      );

    const stageCode =
      receiving &&
      receiving.stageCode ||
      'ACTIVE';

    const stageLabel =
      receiving &&
      receiving.stageLabel ||
      'อยู่ในพื้นที่';

    const canonicalValues =
      new Set(
        [
          dimensions.company,
          dimensions.appointment,
          dimensions.identifier,
          dimensions.driver,
          record.timestampIn,
          formatDuration(
            record.durationSeconds
          ),
          getStatusLabel(
            record.statusCode
          ),
          stageLabel
        ]
          .map(
            (value) =>
              normalizeText(
                value
              )
          )
          .filter(Boolean)
      );

    const ignoredLabels = [
      'บริษัท',
      'หน่วยงาน',
      'vendor',
      'company',
      'เลขนัดหมาย',
      'นัดหมาย',
      'appointment',
      'booking',
      'ทะเบียน',
      'ทะเบียนรถ',
      'registration',
      'plate',
      'ชื่อคนขับ',
      'ชื่อผู้ขับ',
      'พนักงานขับรถ',
      'driver'
    ]
      .map(
        normalizeText
      );

    const seen =
      new Set();

    const extraDetails =
      (
        Array.isArray(
          record.fields
        )
          ? record.fields
          : []
      )
        .filter(
          (field) => {
            if (
              !field ||
              field.primary
            ) {
              return false;
            }

            const label =
              normalizeText(
                field.label ||
                field.header ||
                field.name ||
                field.key ||
                ''
              );

            const value =
              String(
                field.value ??
                field.displayValue ??
                ''
              ).trim();

            if (!value) {
              return false;
            }

            if (
              ignoredLabels.some(
                (pattern) =>
                  label.includes(
                    pattern
                  )
              )
            ) {
              return false;
            }

            const normalizedValue =
              normalizeText(
                value
              );

            if (
              canonicalValues.has(
                normalizedValue
              )
            ) {
              return false;
            }

            const signature =
              label +
              '\u0000' +
              normalizedValue;

            if (
              seen.has(
                signature
              )
            ) {
              return false;
            }

            seen.add(
              signature
            );

            return true;
          }
        )
        .slice(
          0,
          6
        )
        .map(
          (field) => `
            <div class="record-inspector-extra">
              <span>
                ${escapeHtml(
                  field.label ||
                  field.header ||
                  field.name ||
                  field.key ||
                  'ข้อมูลเพิ่มเติม'
                )}
              </span>

              <strong>
                ${escapeHtml(
                  formatDashboardDisplayDateTime(
                    field.value ??
                    field.displayValue ??
                    '-'
                  )
                )}
              </strong>
            </div>
          `
        )
        .join('');

    const driverCard =
      dimensions.driver
        ? `
            <div class="record-inspector-info">
              <span>ชื่อผู้ขับ</span>

              <strong>
                ${escapeHtml(
                  dimensions.driver
                )}
              </strong>
            </div>
          `
        : '';

    window.Swal?.fire({
      html: `
        <div class="record-inspector">
          <header class="record-inspector-hero">
            <small>
              ACTIVE VEHICLE RECORD
            </small>

            <h2>
              ${escapeHtml(
                dimensions.company
              )}
            </h2>

            <div class="record-inspector-statuses">
              <span
                class="status-badge"
                data-status="${escapeHtml(
                  record.statusCode ||
                  'INCOMPLETE'
                )}"
              >
                ${escapeHtml(
                  getStatusLabel(
                    record.statusCode
                  )
                )}
              </span>

              <span
                class="stage-badge"
                data-stage="${escapeHtml(
                  stageCode
                )}"
              >
                ${escapeHtml(
                  stageLabel
                )}
              </span>
            </div>
          </header>

          <section class="record-inspector-appointment-panel">
            <span>เลขนัดหมาย</span>

            <strong>
              ${escapeHtml(
                dimensions.appointment
              )}
            </strong>
          </section>

          <section class="record-inspector-info-grid">
            <div class="record-inspector-info record-inspector-info--plate">
              <span>ทะเบียนรถ / หมายเลขตู้</span>

              <strong>
                ${escapeHtml(
                  dimensions.identifier
                )}
              </strong>
            </div>

            <div class="record-inspector-info">
              <span>เวลาเข้า Gate In</span>

              <strong>
                ${escapeHtml(
                  record.timestampIn ||
                  '-'
                )}
              </strong>
            </div>

            <div class="record-inspector-info">
              <span>ระยะเวลาปัจจุบัน</span>

              <strong class="record-inspector-duration">
                ${escapeHtml(
                  formatDuration(
                    record.durationSeconds
                  )
                )}
              </strong>
            </div>

            ${driverCard}
          </section>

          ${
            extraDetails
              ? `
                  <section class="record-inspector-details">
                    <header>
                      ข้อมูลประกอบ
                    </header>

                    ${extraDetails}
                  </section>
                `
              : ''
          }
        </div>
      `,
      showConfirmButton:
        true,
      confirmButtonText:
        'ปิด',
      width:
        620,
      padding:
        '0',
      customClass: {
        popup:
          'record-inspector-popup',
        htmlContainer:
          'record-inspector-html',
        confirmButton:
          'record-inspector-close'
      }
    });
  }

  function handleMobileChartTab(event) {
    const button =
      event.target.closest(
        '[data-chart-tab]'
      );

    if (!button) {
      return;
    }

    setMobileChartTab(
      String(
        button.dataset.chartTab ||
        'hourly'
      )
    );
  }


  function setMobileChartTab(chartKey) {
    const safeKey =
      [
        'hourly',
        'status',
        'trend',
        'waiting',
        'flow'
      ].includes(chartKey)
        ? chartKey
        : 'hourly';

    state.mobileChart =
      safeKey;

    document
      .querySelectorAll(
        '[data-chart-tab]'
      )
      .forEach(
        (button) => {
          const active =
            button.dataset.chartTab ===
            safeKey;

          button.classList.toggle(
            'is-active',
            active
          );

          button.setAttribute(
            'aria-selected',
            String(active)
          );
        }
      );

    document
      .querySelectorAll(
        '[data-chart-panel]'
      )
      .forEach(
        (panel) => {
          panel.classList.toggle(
            'is-mobile-active',
            panel.dataset.chartPanel ===
              safeKey
          );
        }
      );

    window.setTimeout(
      resizeCharts,
      80
    );
  }


  function syncResponsiveDashboard() {
    const mobile =
      window.matchMedia(
        '(max-width: 760px)'
      ).matches;

    const breakpointChanged =
      state.responsiveMobile !==
      mobile;

    state.responsiveMobile =
      mobile;

    document.body.classList.toggle(
      'is-mobile-dashboard',
      mobile
    );

    const recordView =
      state.mobileRecordView ||
      'COMPACT';

    document.body.dataset.mobileRecordView =
      recordView;

    const recordsPanel =
      document.querySelector(
        '.records-panel'
      );

    if (recordsPanel) {
      recordsPanel.classList.toggle(
        'is-compact-view',
        recordView === 'COMPACT'
      );

      recordsPanel.classList.toggle(
        'is-detail-view',
        recordView === 'DETAIL'
      );
    }

    if (mobile) {
      setMobileChartTab(
        state.mobileChart ||
        'hourly'
      );
    }

    if (
      breakpointChanged &&
      state.records.length > 0
    ) {
      renderRecordTable();
    }
  }

  function handleDashboardClick(event) {
    const mobileRecord =
      event.target.closest(
        '[data-mobile-record-id]'
      );

    if (
      mobileRecord &&
      window.matchMedia(
        '(max-width: 760px)'
      ).matches
    ) {
      showMobileRecordDetails(
        mobileRecord.dataset.mobileRecordId
      );
      return;
    }

    const statusButton =
      event.target.closest('[data-status-filter]');

    if (statusButton) {
      state.statusFilter = String(
        statusButton.dataset.statusFilter || 'ALL'
      ).toUpperCase();

      const select = byId('dashboardStatusFilter');

      if (select) {
        select.value = state.statusFilter;
      }

      renderRecordTable();
      focusRecordsPanel();
      return;
    }

    const stageButton =
      event.target.closest('[data-stage-filter]');

    if (stageButton) {
      state.stageFilter = String(
        stageButton.dataset.stageFilter || 'ALL'
      ).toUpperCase();

      const select = byId('dashboardStageFilter');

      if (select) {
        select.value = state.stageFilter;
      }

      renderRecordTable();
      focusRecordsPanel();
      return;
    }

    const recordButton =
      event.target.closest('[data-focus-record]');

    if (recordButton) {
      const value = String(
        recordButton.dataset.focusRecord || ''
      );

      state.searchText = value.toLowerCase();

      const search = byId('dashboardSearchInput');

      if (search) {
        search.value = value;
      }

      renderRecordTable();
      focusRecordsPanel();
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
      options && typeof options === 'object'
        ? options
        : {};

    const silent = config.silent === true;

    state.refreshInProgress = true;

    if (!silent) {
      setConnectionState('LOADING', 'กำลังอัปเดต');
      setRefreshButtonLoading(true);
    }

    try {
      const [
        module,
        recordsResult,
        movement,
        receiving
      ] = await Promise.all([
        API.getModule(state.moduleId),
        API.getActiveRecords(state.moduleId),
        API.getMovementSummary(state.moduleId),
        API.getReceivingFlow(state.moduleId)
      ]);

      state.module = {
        ...(module || {}),
        ...(
          recordsResult &&
          recordsResult.module ||
          {}
        )
      };

      state.records = Array.isArray(
        recordsResult &&
        recordsResult.records
      )
        ? recordsResult.records
        : [];

      state.movement = movement || {};

      state.receiving =
        normalizeDashboardReceivingFlow(
          receiving
        ) || {
          enabled: false,
          summary: {},
          records: []
        };

      rebuildReceivingIndex();

      updateServerOffset(
        recordsResult && recordsResult.generatedAt ||
        state.movement.generatedAt ||
        state.receiving.generatedAt
      );

      recalculateRecords();

      const nextSignature = buildStableSignature();
      const changed = nextSignature !== state.signature;
      state.signature = nextSignature;

      if (changed || config.initial === true) {
        renderDashboard(silent);
      } else {
        updateLiveDurations();
      }

      const generatedAt =
        recordsResult && recordsResult.generatedAt ||
        state.movement.generatedAt ||
        state.receiving.generatedAt ||
        formatBangkokDateTime(getServerNow());

      setText(
        'dashboardLastUpdated',
        'อัปเดตล่าสุด ' + generatedAt
      );

      setText(
        'summaryLastUpdate',
        generatedAt
      );

      setConnectionState('ONLINE', 'LIVE');
    } catch (error) {
      if (isAuthenticationError(error)) {
        redirectToLogin();
        return;
      }

      if (!silent) {
        setConnectionState('ERROR', 'ERROR');

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
      state.refreshInProgress = false;

      if (!silent) {
        setRefreshButtonLoading(false);
      }

      scheduleRefresh();
    }
  }


  function normalizeDashboardReceivingFlow(
    flow
  ) {
    if (
      !flow ||
      typeof flow !== 'object'
    ) {
      return flow;
    }

    const records =
      (
        Array.isArray(flow.records)
          ? flow.records
          : []
      ).map(
        normalizeDashboardReceivingRecord
      );

    const active =
      records.filter(
        (record) =>
          record.isCurrentlyInArea ===
            true
      );

    return {
      ...flow,
      records:
        records,
      summary: {
        ...(flow.summary || {}),
        activeTotal:
          active.length,
        waitingReceiving:
          active.filter(
            (record) =>
              record.stageCode ===
                'WAITING_RECEIVING'
          ).length,
        waitingGateOut:
          active.filter(
            (record) =>
              record.stageCode ===
                'WAITING_GATE_OUT'
          ).length
      }
    };
  }


  function normalizeDashboardReceivingRecord(
    sourceRecord
  ) {
    const record =
      sourceRecord &&
      typeof sourceRecord === 'object'
        ? sourceRecord
        : {};

    const isActive =
      record.isCurrentlyInArea ===
        true;

    const hasReceiving =
      Boolean(
        record.receivingCompleteEpochMs ||
        record.receivingCompleteAt
      );

    const timestampOutEpochMs =
      Number(
        record.timestampOutEpochMs
      );

    const hasTimestampOut =
      Number.isFinite(
        timestampOutEpochMs
      ) &&
      timestampOutEpochMs > 0;

    const gateOutSource =
      String(
        record.gateOutSource ||
        ''
      ).toUpperCase();

    if (isActive) {
      const nowMs =
        Date.now() +
        state.serverOffsetMs;

      const timestampInEpochMs =
        Number(
          record.timestampInEpochMs
        );

      const receivingEpochMs =
        Number(
          record.receivingCompleteEpochMs
        );

      const currentStageSeconds =
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
                record.currentStageSeconds
              ) || 0;

      return {
        ...record,
        stageCode:
          hasReceiving
            ? 'WAITING_GATE_OUT'
            : 'WAITING_RECEIVING',
        stageLabel:
          hasReceiving
            ? 'รับสินค้าเสร็จ รอ Gate Out'
            : 'รอรับสินค้าเสร็จ',
        isExited:
          false,
        timestampOut:
          '',
        timestampOutEpochMs:
          null,
        gateOutSource:
          'PENDING',
        gateOutSourceLabel:
          'ยังไม่มีการสแกน Gate Out',
        currentStageSeconds:
          currentStageSeconds
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

    if (hasAutoClose) {
      return {
        ...record,
        stageCode:
          hasReceiving
            ? 'AUTO_CLOSED_AFTER_RECEIVING'
            : 'AUTO_CLOSED_WITHOUT_RECEIVING',
        stageLabel:
          hasReceiving
            ? 'รับสินค้าเสร็จแล้ว แต่ไม่พบ Gate Out จริง — ระบบเคลียร์ข้อมูล'
            : 'ระบบเคลียร์ข้อมูล โดยไม่มีข้อมูลรับสินค้าเสร็จ'
      };
    }

    if (hasRealGateOut) {
      return {
        ...record,
        stageCode:
          hasReceiving
            ? 'EXITED_AFTER_RECEIVING'
            : 'EXITED_WITHOUT_RECEIVING',
        stageLabel:
          hasReceiving
            ? 'Gate Out จริงแล้ว — กระบวนการสมบูรณ์'
            : 'Gate Out จริงแล้ว โดยไม่มีข้อมูลรับสินค้าเสร็จ'
      };
    }

    return {
      ...record,
      stageCode:
        'INACTIVE_WITHOUT_GATE_OUT_TIME',
      stageLabel:
        'รายการไม่ Active แต่ไม่พบเวลา Gate Out ที่ยืนยันได้'
    };
  }

  function rebuildReceivingIndex() {
    state.receivingByRecordId = new Map();

    (
      Array.isArray(state.receiving.records)
        ? state.receiving.records
        : []
    ).forEach(
      (record) => {
        if (record && record.recordId) {
          state.receivingByRecordId.set(
            String(record.recordId),
            record
          );
        }
      }
    );
  }

  function renderDashboard(silent) {
    renderModuleHeader();
    renderThresholds();
    renderSituation();
    renderCurrentStatus();
    renderReceiving();
    renderOverdueList();
    renderActionQueue();
    renderRecordTable();
    renderPeriodDependentData(silent);
    renderStatusChart(silent);
    renderLongestWaitingChart(silent);
    renderSystemSummary();
  }

  function renderPeriodDependentData(silent) {
    renderFlowSummary();
    renderHourlyChart(silent);
    renderActiveTrendChart(silent);
    renderProcessFunnel();
    renderSystemSummary();
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
      'ติดตามรถและตู้สินค้าในพื้นที่แบบเรียลไทม์'
    );
  }

  function renderUserIdentity() {
    const user =
      state.session &&
      (
        state.session.user ||
        state.session
      ) ||
      {};

    setText(
      'dashboardUserName',
      user.displayName ||
      user.name ||
      user.username ||
      'ผู้ใช้งาน'
    );

    setText(
      'dashboardUserRole',
      String(user.role || 'Dashboard').toUpperCase()
    );
  }

  function renderThresholds() {
    const thresholds = getThresholds();

    setText(
      'dashboardWarningThreshold',
      thresholds.warningMinutes
    );

    setText(
      'dashboardOverdueThreshold',
      thresholds.redMinutes
    );

    setText(
      'dashboardAutoCloseThreshold',
      thresholds.autoCloseHours
    );
  }

  function renderSituation() {
    const counts = countStatuses();
    const receivingSummary =
      state.receiving.summary || {};

    let code = 'NORMAL';
    let count = 0;
    let label = 'สถานการณ์ปกติ';
    let message = 'ไม่มีรายการที่ต้องเร่งสั่งการ';

    if (counts.OVERDUE > 0) {
      code = 'CRITICAL';
      count = counts.OVERDUE;
      label = 'ต้องเร่งดำเนินการ';
      message = count + ' รายการเกินเวลา';
    } else if (
      Number(receivingSummary.waitingGateOut) > 0
    ) {
      code = 'ACTION';
      count = Number(receivingSummary.waitingGateOut);
      label = 'ติดตาม Gate Out';
      message = count + ' รายการรับสินค้าเสร็จแล้ว';
    } else if (counts.WARNING > 0) {
      code = 'WATCH';
      count = counts.WARNING;
      label = 'ติดตามใกล้ชิด';
      message = count + ' รายการใกล้เกินเวลา';
    } else if (counts.INCOMPLETE > 0) {
      code = 'DATA';
      count = counts.INCOMPLETE;
      label = 'ตรวจสอบข้อมูล';
      message = count + ' รายการข้อมูลไม่สมบูรณ์';
    }

    const panel = byId('dashboardSituation');

    if (panel) {
      panel.dataset.state = code;
    }

    setText('dashboardSituationCount', count);
    setText('dashboardSituationLabel', label);
    setText('dashboardSituationMessage', message);
  }

  function renderCurrentStatus() {
    const counts = countStatuses();

    setText('kpiActive', state.records.length);
    setText('kpiNormal', counts.NORMAL);
    setText('kpiWarning', counts.WARNING);
    setText('kpiOverdue', counts.OVERDUE);
    setText('kpiIncomplete', counts.INCOMPLETE);
  }

  function renderFlowSummary() {
    const selected = getSelectedMovement();

    setText(
      'dashboardFlowPeriodLabel',
      state.period === 'TODAY'
        ? 'วันนี้'
        : 'ย้อนหลัง 24 ชั่วโมง'
    );

    setText(
      'summaryGateIn',
      Number(selected.in) || 0
    );

    setText(
      'summaryGateOut',
      Number(selected.outReal) || 0
    );

    setText(
      'summaryActive',
      state.records.length
    );

    setText('summaryModuleCount', 1);
  }

  function renderReceiving() {
    const section =
      byId('dashboardReceivingSection');

    const stageFilter =
      byId('dashboardStageFilter');

    if (
      !state.receiving ||
      state.receiving.enabled !== true
    ) {
      section?.classList.add('is-hidden');
      section?.setAttribute('aria-hidden', 'true');
      stageFilter?.classList.add('is-hidden');

      state.stageFilter = 'ALL';
      return;
    }

    section?.classList.remove('is-hidden');
    section?.removeAttribute('aria-hidden');
    stageFilter?.classList.remove('is-hidden');

    const summary = state.receiving.summary || {};

    setText(
      'kpiWaitingReceiving',
      Number(summary.waitingReceiving) || 0
    );

    setText(
      'kpiWaitingGateOut',
      Number(summary.waitingGateOut) || 0
    );

    setText(
      'kpiReceivingToday',
      Number(summary.receivingCompletedToday) || 0
    );

    setText(
      'kpiMissingReceiving',
      Number(summary.exitedWithoutReceivingToday) || 0
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

  function renderOverdueList() {
    const container = byId('dashboardOverdueList');

    if (!container) {
      return;
    }

    const items = state.records
      .filter(
        (record) =>
          record.statusCode === 'OVERDUE' ||
          record.statusCode === 'WARNING'
      )
      .sort(
        (left, right) =>
          statusPriority(left.statusCode) -
            statusPriority(right.statusCode) ||
          Number(right.durationSeconds) -
            Number(left.durationSeconds)
      )
      .slice(0, 7);

    const overdueCount = state.records.filter(
      (record) => record.statusCode === 'OVERDUE'
    ).length;

    setText(
      'dashboardOverdueListCount',
      overdueCount + ' รายการ'
    );

    if (items.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          ไม่มีรายการเกินเวลาหรือเฝ้าระวัง
        </div>
      `;
      return;
    }

    container.innerHTML = items.map(
      (record, index) => {
        const dimensions =
          extractRecordDimensions(record);

        return `
          <button
            type="button"
            class="overdue-item"
            data-tone="${escapeHtml(record.statusCode)}"
            data-focus-record="${escapeHtml(dimensions.title)}"
          >
            <span class="overdue-item__rank">
              ${index + 1}
            </span>

            <span class="overdue-item__main">
              <strong>${escapeHtml(dimensions.title)}</strong>
              <span>${escapeHtml(dimensions.company)}</span>
            </span>

            <span class="overdue-item__time">
              ${escapeHtml(formatDuration(record.durationSeconds))}
            </span>
          </button>
        `;
      }
    ).join('');
  }

  function renderActionQueue() {
    const container = byId('dashboardActionQueue');

    if (!container) {
      return;
    }

    const queue = state.records
      .map(buildActionItem)
      .filter(Boolean)
      .sort(
        (left, right) =>
          left.priority - right.priority ||
          right.seconds - left.seconds
      )
      .slice(0, 8);

    setText(
      'dashboardActionCount',
      queue.length + ' รายการ'
    );

    if (queue.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          ไม่มีรายการที่ต้องสั่งการ
        </div>
      `;
      return;
    }

    container.innerHTML = queue.map(
      (item, index) => `
        <button
          type="button"
          class="action-item"
          data-priority="${escapeHtml(item.code)}"
          data-focus-record="${escapeHtml(item.title)}"
        >
          <span class="action-item__rank">
            ${index + 1}
          </span>

          <span class="action-item__main">
            <strong>${escapeHtml(item.title)}</strong>
            <small>${escapeHtml(item.action)}</small>
          </span>

          <span class="action-item__time">
            ${escapeHtml(formatDuration(item.seconds))}
          </span>
        </button>
      `
    ).join('');
  }

  function buildActionItem(record) {
    const receiving =
      state.receivingByRecordId.get(
        String(record.recordId || '')
      );

    const dimensions =
      extractRecordDimensions(record);

    if (record.statusCode === 'OVERDUE') {
      return {
        priority: 0,
        code: 'OVERDUE',
        title: dimensions.title,
        action: 'เกิน SLA ต้องเร่งติดตาม',
        seconds: Number(record.durationSeconds) || 0
      };
    }

    if (
      receiving &&
      receiving.stageCode === 'WAITING_GATE_OUT'
    ) {
      return {
        priority: 1,
        code: 'WAITING_GATE_OUT',
        title: dimensions.title,
        action: 'รับสินค้าเสร็จแล้ว รอ Gate Out',
        seconds: Number(receiving.currentStageSeconds) || 0
      };
    }

    if (record.statusCode === 'INCOMPLETE') {
      return {
        priority: 2,
        code: 'INCOMPLETE',
        title: dimensions.title,
        action: 'ตรวจสอบข้อมูลต้นทาง',
        seconds: Number(record.durationSeconds) || 0
      };
    }

    if (record.statusCode === 'WARNING') {
      return {
        priority: 3,
        code: 'WARNING',
        title: dimensions.title,
        action: 'ใกล้ถึงเกณฑ์เกินเวลา',
        seconds: Number(record.durationSeconds) || 0
      };
    }

    if (
      receiving &&
      receiving.stageCode === 'WAITING_RECEIVING'
    ) {
      return {
        priority: 4,
        code: 'WAITING_RECEIVING',
        title: dimensions.title,
        action: 'รอบันทึกรับสินค้าเสร็จ',
        seconds: Number(receiving.currentStageSeconds) || 0
      };
    }

    return null;
  }


  function resetRecordFilters() {
    state.searchText = '';
    state.statusFilter = 'ALL';
    state.stageFilter = 'ALL';

    const search =
      byId(
        'dashboardSearchInput'
      );

    const status =
      byId(
        'dashboardStatusFilter'
      );

    const stage =
      byId(
        'dashboardStageFilter'
      );

    if (search) {
      search.value = '';
    }

    if (status) {
      status.value = 'ALL';
    }

    if (stage) {
      stage.value = 'ALL';
    }

    renderRecordTable();
  }

  function renderRecordTable() {
    const tbody =
      byId(
        'dashboardRecordTableBody'
      );

    const mobileGrid =
      byId(
        'mobileRecordGrid'
      );

    if (
      !tbody ||
      !mobileGrid
    ) {
      return;
    }

    const allRecords =
      state.records
        .filter(
          recordMatchesFilters
        )
        .sort(
          compareRecords
        );

    const mobileRecords =
      allRecords.slice(
        0,
        state.mobileRecordLimit
      );

    const isMobile =
      window.matchMedia(
        '(max-width: 760px)'
      ).matches;

    setText(
      'dashboardRecordTotal',
      allRecords.length +
      ' รายการ'
    );

    updateMobileRecordControls(
      allRecords.length,
      mobileRecords.length,
      isMobile
    );

    byId(
      'dashboardRecordEmpty'
    )?.classList.toggle(
      'is-hidden',
      allRecords.length > 0
    );

    byId(
      'mobileRecordEmpty'
    )?.classList.toggle(
      'is-hidden',
      allRecords.length > 0
    );

    renderDesktopRecordTable(
      tbody,
      allRecords
    );

    renderMobileRecordCards(
      mobileGrid,
      mobileRecords
    );
  }


  function updateMobileRecordControls(
    total,
    visible,
    isMobile
  ) {
    const remaining =
      Math.max(
        0,
        total - visible
      );

    const counter =
      byId(
        'mobileRecordCounter'
      );

    if (counter) {
      counter.textContent =
        'แสดง ' +
        visible +
        '/' +
        total;
    }

    const loadMore =
      byId(
        'mobileLoadMoreRecords'
      );

    if (!loadMore) {
      return;
    }

    loadMore.classList.toggle(
      'is-hidden',
      !isMobile ||
      remaining <= 0
    );

    loadMore.textContent =
      remaining > 0
        ? 'เพิ่มอีก ' +
          Math.min(
            12,
            remaining
          )
        : 'ครบแล้ว';
  }


  function getRecordPresentation(
    record
  ) {
    const recordId =
      String(
        record.recordId ||
        ''
      );

    const receiving =
      state.receivingByRecordId.get(
        recordId
      );

    const dimensions =
      extractRecordDimensions(
        record
      );

    const stageCode =
      receiving &&
      receiving.stageCode ||
      'ACTIVE';

    const stageLabel =
      receiving &&
      receiving.stageLabel ||
      'อยู่ในพื้นที่';

    const stageSeconds =
      receiving &&
      (
        receiving.stageCode ===
          'WAITING_RECEIVING' ||
        receiving.stageCode ===
          'WAITING_GATE_OUT'
      )
        ? Number(
            receiving.currentStageSeconds
          ) || 0
        : Number(
            record.durationSeconds
          ) || 0;

    return {
      recordId,
      dimensions,
      stageCode,
      stageLabel,
      stageSeconds
    };
  }


  function renderDesktopRecordTable(
    tbody,
    records
  ) {
    tbody.innerHTML = '';

    const fragment =
      document.createDocumentFragment();

    records.forEach(
      (record, index) => {
        const view =
          getRecordPresentation(
            record
          );

        const row =
          document.createElement(
            'tr'
          );

        row.dataset.status =
          record.statusCode ||
          'INCOMPLETE';

        row.innerHTML = `
          <td>${index + 1}</td>

          <td>
            <span class="record-main">
              <strong>
                ${escapeHtml(
                  view.dimensions.company
                )}
              </strong>

              <small class="record-appointment">
                นัดหมาย
                ${escapeHtml(
                  view.dimensions.appointment
                )}
              </small>
            </span>
          </td>

          <td>
            <strong>
              ${escapeHtml(
                view.dimensions.identifier
              )}
            </strong>
          </td>

          <td>
            ${escapeHtml(
              formatDashboardDisplayDateTime(
                record.timestampIn
              )
            )}
          </td>

          <td>
            <strong
              class="record-duration"
              data-live-record="${escapeHtml(
                view.recordId
              )}"
            >
              ${escapeHtml(
                formatDuration(
                  view.stageSeconds
                )
              )}
            </strong>
          </td>

          <td>
            <span
              class="status-badge"
              data-status="${escapeHtml(
                record.statusCode ||
                'INCOMPLETE'
              )}"
            >
              ${escapeHtml(
                getStatusLabel(
                  record.statusCode
                )
              )}
            </span>
          </td>

          <td>
            <span
              class="stage-badge"
              data-stage="${escapeHtml(
                view.stageCode
              )}"
            >
              ${escapeHtml(
                view.stageLabel
              )}
            </span>
          </td>
        `;

        fragment.appendChild(
          row
        );
      }
    );

    tbody.appendChild(
      fragment
    );
  }


  function renderMobileRecordCards(
    mobileGrid,
    records
  ) {
    mobileGrid.innerHTML = '';

    const fragment =
      document.createDocumentFragment();

    records.forEach(
      (record, index) => {
        const view =
          getRecordPresentation(
            record
          );

        const card =
          document.createElement(
            'article'
          );

        card.className =
          'mobile-active-card';

        card.dataset.mobileRecordId =
          view.recordId;

        card.dataset.status =
          record.statusCode ||
          'INCOMPLETE';

        card.setAttribute(
          'role',
          'button'
        );

        card.setAttribute(
          'tabindex',
          '0'
        );

        card.setAttribute(
          'aria-label',
          'ดูรายละเอียด ' +
          view.dimensions.company +
          ' เลขนัดหมาย ' +
          view.dimensions.appointment
        );

        card.innerHTML = `
          <header class="mobile-active-card__header">
            <div>
              <small>บริษัท / Vendor</small>

              <h3>
                ${escapeHtml(
                  view.dimensions.company
                )}
              </h3>
            </div>

            <span class="mobile-active-card__rank">
              ${index + 1}
            </span>
          </header>

          <section class="mobile-active-card__appointment">
            <span>เลขนัดหมาย</span>

            <strong>
              ${escapeHtml(
                view.dimensions.appointment
              )}
            </strong>
          </section>

          <section class="mobile-active-card__information">
            <div class="mobile-active-card__field mobile-active-card__field--plate">
              <span>ทะเบียนรถ / หมายเลขตู้</span>

              <strong>
                ${escapeHtml(
                  view.dimensions.identifier
                )}
              </strong>
            </div>

            <div class="mobile-active-card__field mobile-active-card__field--gate-in">
              <span>เวลาเข้า Gate In</span>

              <strong>
                ${escapeHtml(
                  record.timestampIn ||
                  '-'
                )}
              </strong>
            </div>

            <div class="mobile-active-card__field mobile-active-card__field--duration">
              <span>ระยะเวลา</span>

              <strong
                data-live-record="${escapeHtml(
                  view.recordId
                )}"
              >
                ${escapeHtml(
                  formatDuration(
                    view.stageSeconds
                  )
                )}
              </strong>
            </div>

            ${
              view.dimensions.driver
                ? `
                    <div class="mobile-active-card__field mobile-active-card__field--driver">
                      <span>ชื่อผู้ขับ</span>

                      <strong>
                        ${escapeHtml(
                          view.dimensions.driver
                        )}
                      </strong>
                    </div>
                  `
                : ''
            }
          </section>

          <footer class="mobile-active-card__footer">
            <span
              class="status-badge"
              data-status="${escapeHtml(
                record.statusCode ||
                'INCOMPLETE'
              )}"
            >
              ${escapeHtml(
                getStatusLabel(
                  record.statusCode
                )
              )}
            </span>

            <span
              class="stage-badge"
              data-stage="${escapeHtml(
                view.stageCode
              )}"
            >
              ${escapeHtml(
                view.stageLabel
              )}
            </span>

            <span class="mobile-active-card__hint">
              แตะเพื่อดูข้อมูลเต็ม
            </span>
          </footer>
        `;

        card.addEventListener(
          'keydown',
          (event) => {
            if (
              event.key === 'Enter' ||
              event.key === ' '
            ) {
              event.preventDefault();

              showMobileRecordDetails(
                view.recordId
              );
            }
          }
        );

        fragment.appendChild(
          card
        );
      }
    );

    mobileGrid.appendChild(
      fragment
    );
  }

  function recordMatchesFilters(record) {
    if (
      state.statusFilter !== 'ALL' &&
      record.statusCode !== state.statusFilter
    ) {
      return false;
    }

    const receiving =
      state.receivingByRecordId.get(
        String(record.recordId || '')
      );

    if (
      state.stageFilter !== 'ALL' &&
      (
        !receiving ||
        receiving.stageCode !== state.stageFilter
      )
    ) {
      return false;
    }

    if (!state.searchText) {
      return true;
    }

    const dimensions =
      extractRecordDimensions(record);

    return [
      dimensions.title,
      dimensions.company,
      dimensions.identifier,
      record.searchText || '',
      receiving && receiving.stageLabel || ''
    ]
      .join(' ')
      .toLowerCase()
      .includes(state.searchText);
  }

  function renderHourlyChart(silent) {
    const canvas = byId('hourlyMovementChart');

    if (!canvas) {
      return;
    }

    const hours = getHourlyRows();

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
      destroyChart('hourly');
      return;
    }

    const data = {
      labels: hours.map(getHourLabel),
      datasets: [
        {
          label: 'Gate In',
          data: hours.map(
            (hour) => Number(hour.in) || 0
          ),
          backgroundColor: COLORS.green,
          borderRadius: 3,
          barPercentage: .78,
          categoryPercentage: .78
        },
        {
          label: 'Gate Out จริง',
          data: hours.map(
            (hour) => Number(hour.outReal) || 0
          ),
          backgroundColor: COLORS.blue,
          borderRadius: 3,
          barPercentage: .78,
          categoryPercentage: .78
        },
        {
          label: 'ระบบเคลียร์อัตโนมัติ',
          data: hours.map(
            (hour) => Number(hour.outAuto) || 0
          ),
          backgroundColor: COLORS.purple,
          borderRadius: 3,
          barPercentage: .78,
          categoryPercentage: .78
        }
      ]
    };

    state.charts.hourly = upsertChart(
      state.charts.hourly,
      canvas,
      {
        type: 'bar',
        data: data,
        options: createCartesianOptions({
          silent: silent,
          stacked: false,
          legend: true,
          maxTicks: 12
        })
      }
    );
  }

  function renderStatusChart(silent) {
    const canvas =
      byId('statusDistributionChart');

    if (!canvas) {
      return;
    }

    const counts = countStatuses();

    const data = {
      labels: [
        'ปกติ',
        'เฝ้าระวัง',
        'เกินเวลา',
        'ข้อมูลไม่สมบูรณ์'
      ],
      datasets: [
        {
          data: [
            counts.NORMAL,
            counts.WARNING,
            counts.OVERDUE,
            counts.INCOMPLETE
          ],
          backgroundColor: [
            COLORS.green,
            COLORS.amber,
            COLORS.red,
            COLORS.purple
          ],
          borderColor: '#ffffff',
          borderWidth: 2,
          hoverOffset: 2
        }
      ]
    };

    state.charts.status = upsertChart(
      state.charts.status,
      canvas,
      {
        type: 'doughnut',
        data: data,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: silent
            ? false
            : {duration: 250},
          cutout: '62%',
          plugins: {
            legend: {
              position: 'right',
              labels: {
                usePointStyle: true,
                pointStyle: 'circle',
                boxWidth: 7,
                boxHeight: 7,
                padding: 8,
                color: COLORS.text,
                font: {
                  size: 8,
                  weight: '700'
                },
                generateLabels(chart) {
                  const safeLabels =
                    Array.isArray(
                      chart.data.labels
                    )
                      ? chart.data.labels
                      : [];

                  const dataset =
                    chart.data.datasets &&
                    chart.data.datasets[0]
                      ? chart.data.datasets[0]
                      : {};

                  const values =
                    Array.isArray(
                      dataset.data
                    )
                      ? dataset.data
                      : [];

                  const backgroundColors =
                    Array.isArray(
                      dataset.backgroundColor
                    )
                      ? dataset.backgroundColor
                      : [];

                  const borderColors =
                    Array.isArray(
                      dataset.borderColor
                    )
                      ? dataset.borderColor
                      : [];

                  const fallbackLabels = [
                    'ปกติ',
                    'เฝ้าระวัง',
                    'เกินเวลา',
                    'ข้อมูลไม่สมบูรณ์'
                  ];

                  const total =
                    values.reduce(
                      (sum, value) =>
                        sum +
                        (
                          Number(value) ||
                          0
                        ),
                      0
                    );

                  const itemCount =
                    Math.max(
                      safeLabels.length,
                      values.length,
                      fallbackLabels.length
                    );

                  return Array
                    .from({
                      length:
                        itemCount
                    })
                    .map(
                      (_, index) => {
                        const rawLabel =
                          safeLabels[index] ??
                          fallbackLabels[index] ??
                          'ไม่ทราบสถานะ';

                        const label =
                          String(
                            rawLabel ===
                              undefined ||
                            rawLabel ===
                              null ||
                            rawLabel ===
                              ''
                              ? (
                                  fallbackLabels[index] ||
                                  'ไม่ทราบสถานะ'
                                )
                              : rawLabel
                          );

                        const value =
                          Number(
                            values[index]
                          ) || 0;

                        const percent =
                          total > 0
                            ? (
                                value /
                                total *
                                100
                              ).toFixed(
                                1
                              )
                            : '0.0';

                        const fillColor =
                          backgroundColors[index] ||
                          COLORS.slate;

                        const strokeColor =
                          borderColors[index] ||
                          (
                            typeof dataset.borderColor ===
                              'string'
                              ? dataset.borderColor
                              : '#ffffff'
                          );

                        return {
                          text:
                            label +
                            ' ' +
                            value +
                            ' (' +
                            percent +
                            '%)',

                          fillStyle:
                            fillColor,

                          strokeStyle:
                            strokeColor,

                          lineWidth:
                            Number(
                              dataset.borderWidth
                            ) || 0,

                          hidden:
                            typeof chart
                              .getDataVisibility ===
                              'function'
                              ? !chart
                                  .getDataVisibility(
                                    index
                                  )
                              : false,

                          index:
                            index,

                          datasetIndex:
                            0,

                          pointStyle:
                            'circle'
                        };
                      }
                    );
                }
              }
            },
            tooltip: {
              callbacks: {
                label(context) {
                  const total =
                    context.dataset.data.reduce(
                      (sum, value) =>
                        sum + Number(value),
                      0
                    );

                  const value =
                    Number(context.raw) || 0;

                  const percent = total > 0
                    ? (
                        value / total * 100
                      ).toFixed(1)
                    : '0.0';

                  const fallbackLabels = [
                    'ปกติ',
                    'เฝ้าระวัง',
                    'เกินเวลา',
                    'ข้อมูลไม่สมบูรณ์'
                  ];

                  const safeLabel =
                    String(
                      context.label ||
                      fallbackLabels[
                        context.dataIndex
                      ] ||
                      'ไม่ทราบสถานะ'
                    );

                  return (
                    safeLabel +
                    ': ' +
                    value +
                    ' รายการ (' +
                    percent +
                    '%)'
                  );
                }
              }
            }
          }
        }
      }
    );
  }

  function renderActiveTrendChart(silent) {
    const canvas = byId('activeTrendChart');

    if (!canvas) {
      return;
    }

    const hours = getHourlyRows();

    const data = {
      labels: hours.map(getHourLabel),
      datasets: [
        {
          label: 'รายการ Active',
          data: deriveActiveTrend(
            hours,
            state.records.length
          ),
          borderColor: COLORS.blue,
          backgroundColor:
            'rgba(35, 105, 216, .14)',
          fill: true,
          tension: .32,
          pointRadius: 1.8,
          pointHoverRadius: 4,
          borderWidth: 2
        }
      ]
    };

    state.charts.activeTrend = upsertChart(
      state.charts.activeTrend,
      canvas,
      {
        type: 'line',
        data: data,
        options: createCartesianOptions({
          silent: silent,
          legend: false,
          maxTicks: 8
        })
      }
    );
  }

  function renderLongestWaitingChart(silent) {
    const canvas = byId('longestWaitingChart');

    if (!canvas) {
      return;
    }

    const groups = aggregateLongestWaiting();

    const data = {
      labels: groups.map(
        (item) => truncateText(item.label, 24)
      ),
      datasets: [
        {
          label: 'เวลารอสูงสุด',
          data: groups.map(
            (item) => Number(
              (item.seconds / 3600).toFixed(2)
            )
          ),
          backgroundColor: COLORS.blue,
          borderRadius: 4,
          barPercentage: .62
        }
      ]
    };

    const options = createCartesianOptions({
      silent: silent,
      legend: false,
      maxTicks: 6,
      horizontal: true
    });

    options.scales.x.ticks.callback =
      (value) => value + ' ชม.';

    options.plugins.tooltip = {
      callbacks: {
        label(context) {
          return (
            'เวลารอสูงสุด: ' +
            formatDuration(
              Number(context.raw) * 3600
            )
          );
        }
      }
    };

    state.charts.longestWaiting = upsertChart(
      state.charts.longestWaiting,
      canvas,
      {
        type: 'bar',
        data: data,
        options: options
      }
    );
  }

  function renderProcessFunnel() {
    const today =
      state.movement.today || {};

    const receivingSummary =
      state.receiving.summary || {};

    const gateIn =
      Number(
        today.in
      ) || 0;

    const receiving =
      Number(
        receivingSummary
          .receivingCompletedToday
      ) || 0;

    const gateOut =
      Number(
        today.outReal
      ) || 0;

    const missingReceiving =
      Number(
        receivingSummary
          .exitedWithoutReceivingToday
      ) || 0;

    const autoClose =
      Number(
        today.outAuto
      ) || 0;

    setText(
      'funnelGateIn',
      gateIn
    );

    setText(
      'funnelReceiving',
      receiving
    );

    setText(
      'funnelGateOut',
      gateOut
    );

    setText(
      'funnelMissingReceiving',
      missingReceiving
    );

    setText(
      'funnelAutoClose',
      autoClose
    );

    const percentOfGateIn =
      (value) =>
        gateIn > 0
          ? Math.round(
              Number(value) /
              gateIn *
              100
            )
          : 0;

    setText(
      'funnelGateInPercent',
      gateIn > 0
        ? '100%'
        : '0%'
    );

    setText(
      'funnelReceivingPercent',
      percentOfGateIn(
        receiving
      ) + '%'
    );

    setText(
      'funnelGateOutPercent',
      percentOfGateIn(
        gateOut
      ) + '%'
    );

    setText(
      'funnelMissingPercent',
      percentOfGateIn(
        missingReceiving
      ) + '%'
    );

    setText(
      'funnelAutoPercent',
      percentOfGateIn(
        autoClose
      ) + '%'
    );

    setText(
      'funnelCompletionRate',
      percentOfGateIn(
        gateOut
      ) + '%'
    );
  }

  function renderSystemSummary() {
    const selected = getSelectedMovement();

    const incomplete =
      state.records.filter(
        (record) =>
          record.statusCode === 'INCOMPLETE'
      ).length;

    const quality = state.records.length > 0
      ? Math.max(
          0,
          Math.round(
            (
              state.records.length -
              incomplete
            ) /
            state.records.length *
            100
          )
        )
      : 100;

    setText(
      'summaryGateIn',
      Number(selected.in) || 0
    );

    setText(
      'summaryGateOut',
      Number(selected.outReal) || 0
    );

    setText(
      'summaryActive',
      state.records.length
    );

    setText(
      'summaryDataQuality',
      quality + '%'
    );
  }

  function recalculateRecords() {
    const nowMs = getServerNow().getTime();
    const thresholds = getThresholds();

    state.records.forEach(
      (record) => {
        const timestampInMs =
          Number(record.timestampInEpochMs);

        if (
          !record.isCurrentlyInArea ||
          !Number.isFinite(timestampInMs)
        ) {
          record.durationSeconds = 0;
          record.statusCode = 'INCOMPLETE';
          return;
        }

        record.durationSeconds = Math.max(
          0,
          Math.floor(
            (nowMs - timestampInMs) / 1000
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
    const nowMs = getServerNow().getTime();

    document
      .querySelectorAll('[data-live-record]')
      .forEach(
        (element) => {
          const recordId = String(
            element.dataset.liveRecord || ''
          );

          const record = state.records.find(
            (item) =>
              String(item.recordId || '') ===
              recordId
          );

          if (!record) {
            return;
          }

          const receiving =
            state.receivingByRecordId.get(recordId);

          let startMs =
            Number(record.timestampInEpochMs);

          if (
            receiving &&
            receiving.stageCode ===
              'WAITING_GATE_OUT' &&
            receiving.receivingCompleteEpochMs
          ) {
            startMs = Number(
              receiving.receivingCompleteEpochMs
            );
          }

          const seconds =
            Number.isFinite(startMs)
              ? Math.max(
                  0,
                  Math.floor(
                    (nowMs - startMs) / 1000
                  )
                )
              : 0;

          element.textContent =
            formatDuration(seconds);
        }
      );
  }

  function getThresholds() {
    const thresholds =
      state.movement.thresholds || {};

    const warningMinutes =
      Number(thresholds.warningStartMinutes) ||
      Number(state.module.warningStartMinutes) ||
      45;

    const redMinutes =
      Number(thresholds.redStartMinutes) ||
      Number(state.module.redStartMinutes) ||
      60;

    const autoCloseHours =
      Number(thresholds.autoCloseHours) ||
      36;

    return {
      warningMinutes,
      redMinutes,
      autoCloseHours,
      warningSeconds: warningMinutes * 60,
      redSeconds: redMinutes * 60
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
        : state.movement.currentRound || {};
  }

  function getHourlyRows() {
    const hours = state.movement.hours || {};

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
        const code = String(
          record.statusCode || 'INCOMPLETE'
        ).toUpperCase();

        if (
          Object.prototype.hasOwnProperty.call(
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

  function statusPriority(code) {
    return {
      OVERDUE: 0,
      WARNING: 1,
      INCOMPLETE: 2,
      NORMAL: 3
    }[String(code || '')] ?? 9;
  }

  function compareRecords(left, right) {
    return (
      statusPriority(left.statusCode) -
      statusPriority(right.statusCode)
    ) || (
      Number(right.durationSeconds) -
      Number(left.durationSeconds)
    );
  }

  function extractRecordDimensions(record) {
    const fields =
      Array.isArray(record.fields)
        ? record.fields
        : [];

    const primary =
      String(
        record.primaryValue ||
        ''
      ).trim();

    const company =
      findFieldValue(
        fields,
        [
          'บริษัท',
          'ชื่อบริษัท',
          'vendor',
          'company',
          'ผู้รับบริการ',
          'ลูกค้า',
          'ผู้ขนส่ง',
          'หน่วยงาน'
        ]
      ) ||
      primary ||
      'ไม่ระบุบริษัท';

    const appointment =
      findFieldValue(
        fields,
        [
          'เลขนัดหมาย',
          'หมายเลขนัดหมาย',
          'นัดหมาย',
          'appointment',
          'booking',
          'เลข booking',
          'booking no',
          'เลขที่นัดหมาย'
        ]
      ) ||
      inferAppointmentNumber(
        fields,
        record
      );

    const identifier =
      findFieldValue(
        fields,
        [
          'ทะเบียน',
          'ทะเบียนรถ',
          'registration',
          'plate',
          'หมายเลขรถ',
          'เลขตู้',
          'container'
        ]
      ) ||
      '-';

    const driver =
      findFieldValue(
        fields,
        [
          'ชื่อคนขับ',
          'ชื่อผู้ขับ',
          'พนักงานขับรถ',
          'ผู้ขับ',
          'driver',
          'ชื่อ'
        ]
      );

    return {
      title:
        company,

      company:
        company,

      appointment:
        appointment || '-',

      identifier:
        identifier || '-',

      driver:
        driver || ''
    };
  }


  function inferAppointmentNumber(
    fields,
    record
  ) {
    const candidates =
      fields
        .filter(
          (field) =>
            field &&
            !field.primary
        )
        .map(
          (field) => ({
            label:
              normalizeText(
                field.label ||
                field.header ||
                field.name ||
                field.key ||
                ''
              ),

            value:
              String(
                field.value ??
                field.displayValue ??
                ''
              ).trim()
          })
        )
        .filter(
          (item) =>
            item.value &&
            /^\d{5,12}$/.test(
              item.value
            ) &&
            !item.label.includes(
              'โทร'
            ) &&
            !item.label.includes(
              'เบอร์'
            )
        );

    if (candidates.length > 0) {
      return candidates[0].value;
    }

    const sourceId =
      sourceRowIdentifier(
        record.recordId
      );

    return /^\d{5,12}$/.test(
      sourceId
    )
      ? sourceId
      : '';
  }

  function findFieldValue(fields, patterns) {
    const normalizedPatterns =
      patterns.map(normalizeText);

    for (const field of fields) {
      if (!field || field.primary) {
        continue;
      }

      const label = normalizeText(
        field.label ||
        field.header ||
        field.name ||
        field.key ||
        ''
      );

      const value = String(
        field.value ??
        field.displayValue ??
        ''
      ).trim();

      if (!value) {
        continue;
      }

      if (
        normalizedPatterns.some(
          (pattern) =>
            label.includes(pattern)
        )
      ) {
        return value;
      }
    }

    return '';
  }

  function firstSecondaryValue(fields) {
    const field = fields.find(
      (item) =>
        item &&
        !item.primary &&
        String(
          item.value ??
          item.displayValue ??
          ''
        ).trim()
    );

    return field
      ? String(
          field.value ??
          field.displayValue
        ).trim()
      : '';
  }

  function sourceRowIdentifier(recordId) {
    const text = String(recordId || '');
    const index = text.lastIndexOf(':');

    return index >= 0
      ? text.slice(index + 1)
      : text;
  }

  function aggregateLongestWaiting() {
    const groups = new Map();

    state.records.forEach(
      (record) => {
        const dimensions =
          extractRecordDimensions(record);

        const key =
          dimensions.company ||
          dimensions.title;

        const seconds =
          Number(record.durationSeconds) || 0;

        const current = groups.get(key);

        if (
          !current ||
          seconds > current.seconds
        ) {
          groups.set(
            key,
            {
              label: key,
              seconds: seconds
            }
          );
        }
      }
    );

    return Array.from(groups.values())
      .sort(
        (left, right) =>
          right.seconds - left.seconds
      )
      .slice(0, 5);
  }

  function deriveActiveTrend(
    hours,
    currentActive
  ) {
    if (
      !Array.isArray(hours) ||
      hours.length === 0
    ) {
      return [];
    }

    const netChanges = hours.map(
      (hour) =>
        (Number(hour.in) || 0) -
        (Number(hour.outReal) || 0) -
        (Number(hour.outAuto) || 0)
    );

    const totalNet = netChanges.reduce(
      (sum, value) => sum + value,
      0
    );

    let running = Math.max(
      0,
      Number(currentActive) - totalNet
    );

    return netChanges.map(
      (change) => {
        running = Math.max(
          0,
          running + change
        );

        return running;
      }
    );
  }

  function createCartesianOptions(options) {
    const config = options || {};
    const horizontal =
      config.horizontal === true;

    const indexAxis =
      horizontal ? 'y' : 'x';

    const valueAxis =
      horizontal ? 'x' : 'y';

    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: config.silent
        ? false
        : {duration: 220},
      indexAxis: indexAxis,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: config.legend !== false,
          position: 'bottom',
          labels: {
            usePointStyle: true,
            pointStyle: 'rectRounded',
            boxWidth: 7,
            boxHeight: 7,
            padding: 8,
            color: COLORS.text,
            font: {
              size: 7,
              weight: '700'
            }
          }
        },
        tooltip: {
          displayColors: true,
          bodyFont: {size: 9},
          titleFont: {size: 9}
        }
      },
      scales: {
        [indexAxis]: {
          stacked: config.stacked === true,
          grid: {
            display: horizontal,
            color: COLORS.grid
          },
          ticks: {
            color: COLORS.text,
            font: {size: 7},
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: config.maxTicks || 10
          },
          border: {display: false}
        },
        [valueAxis]: {
          stacked: config.stacked === true,
          beginAtZero: true,
          grid: {color: COLORS.grid},
          ticks: {
            color: COLORS.text,
            precision: 0,
            font: {size: 7}
          },
          border: {display: false}
        }
      }
    };
  }

  /************************************************************
   * ROUND 74 — Chart lifecycle guard
   *
   * แก้ปัญหา:
   * Canvas is already in use. Chart with ID '0'
   * must be destroyed before the canvas can be reused.
   *
   * สาเหตุ:
   * บางครั้ง DOM / CSS mobile layout / silent refresh ทำให้ state.charts
   * ไม่ตรงกับ Chart instance ที่ Chart.js ผูกอยู่กับ canvas จริง
   ************************************************************/

  function upsertChart(
    existingChart,
    canvas,
    config
  ) {
    if (
      !canvas ||
      typeof window.Chart === 'undefined'
    ) {
      return null;
    }

    const canvasChart =
      getChartOnCanvas(
        canvas
      );

    const reusableChart =
      existingChart &&
      existingChart.canvas === canvas &&
      existingChart.ctx
        ? existingChart
        : canvasChart;

    if (
      reusableChart &&
      reusableChart.canvas === canvas &&
      reusableChart.ctx
    ) {
      reusableChart.data =
        config.data;

      reusableChart.options =
        config.options;

      try {
        reusableChart.update(
          'none'
        );
      } catch (error) {
        safeDestroyChartInstance(
          reusableChart
        );

        return createFreshChart(
          canvas,
          config
        );
      }

      return reusableChart;
    }

    if (
      existingChart &&
      existingChart !== canvasChart
    ) {
      safeDestroyChartInstance(
        existingChart
      );
    }

    if (canvasChart) {
      safeDestroyChartInstance(
        canvasChart
      );
    }

    return createFreshChart(
      canvas,
      config
    );
  }


  function createFreshChart(
    canvas,
    config
  ) {
    const currentChart =
      getChartOnCanvas(
        canvas
      );

    if (currentChart) {
      safeDestroyChartInstance(
        currentChart
      );
    }

    return new Chart(
      canvas,
      config
    );
  }


  function getChartOnCanvas(
    canvas
  ) {
    if (
      !canvas ||
      typeof window.Chart === 'undefined' ||
      typeof window.Chart.getChart !== 'function'
    ) {
      return null;
    }

    try {
      return (
        window.Chart.getChart(
          canvas
        ) || null
      );
    } catch (error) {
      return null;
    }
  }


  function safeDestroyChartInstance(
    chart
  ) {
    if (!chart) {
      return;
    }

    try {
      if (
        typeof chart.destroy === 'function'
      ) {
        chart.destroy();
      }
    } catch (error) {
      console.warn(
        'ทำลาย Chart เดิมไม่สำเร็จ',
        error
      );
    }
  }


  function destroyChart(name) {
    const chart =
      state.charts[name];

    safeDestroyChartInstance(
      chart
    );

    state.charts[name] =
      null;

    const canvasIdMap = {
      hourly:
        'hourlyMovementChart',

      status:
        'statusDistributionChart',

      activeTrend:
        'activeTrendChart',

      longestWaiting:
        'longestWaitingChart'
    };

    const canvasId =
      canvasIdMap[name];

    if (canvasId) {
      const canvas =
        byId(
          canvasId
        );

      const canvasChart =
        getChartOnCanvas(
          canvas
        );

      safeDestroyChartInstance(
        canvasChart
      );
    }
  }

  function resizeCharts() {
    Object.values(state.charts)
      .forEach(
        (chart) => chart?.resize()
      );
  }

  function startClock() {
    updateClock();

    state.clockTimer = window.setInterval(
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

    const seconds = Math.max(
      10,
      Math.min(
        60,
        Number(state.module.refreshSeconds) ||
        Number(CONFIG.REFRESH_SECONDS) ||
        15
      )
    );

    state.refreshTimer = window.setTimeout(
      () => {
        if (
          document.visibilityState === 'visible'
        ) {
          void refreshDashboard({silent: true});
        } else {
          scheduleRefresh();
        }
      },
      seconds * 1000
    );
  }

  function buildStableSignature() {
    return JSON.stringify({
      module: {
        id:
          state.module.id ||
          state.module.moduleId,
        name: state.module.name,
        description:
          state.module.description,
        refreshSeconds:
          state.module.refreshSeconds
      },

      records: state.records.map(
        (record) => ({
          id: record.recordId,
          status: record.statusCode,
          timestampIn:
            record.timestampInEpochMs,
          timestampOut:
            record.timestampOutEpochMs,
          primary: record.primaryValue
        })
      ),

      movement: {
        thresholds:
          state.movement.thresholds || {},
        currentState:
          state.movement.currentState || {},
        today:
          stableMetric(
            state.movement.today
          ),
        rolling24:
          stableMetric(
            state.movement.rolling24
          ),
        todayHours:
          stableHours(
            state.movement.hours &&
            state.movement.hours.today
          ),
        rollingHours:
          stableHours(
            state.movement.hours &&
            state.movement.hours.rolling24
          )
      },

      receiving: {
        enabled:
          state.receiving.enabled,
        summary:
          state.receiving.summary,
        records: (
          state.receiving.records || []
        ).map(
          (record) => ({
            id: record.recordId,
            stage: record.stageCode,
            receiving:
              record.receivingCompleteEpochMs,
            out:
              record.timestampOutEpochMs
          })
        )
      }
    });
  }

  function stableMetric(metric) {
    const source =
      metric &&
      typeof metric === 'object'
        ? metric
        : {};

    return {
      in: Number(source.in) || 0,
      outReal: Number(source.outReal) || 0,
      outAuto: Number(source.outAuto) || 0,
      outTotal: Number(source.outTotal) || 0,
      movementTotal:
        Number(source.movementTotal) || 0,
      net: Number(source.net) || 0
    };
  }

  function stableHours(hours) {
    return (
      Array.isArray(hours)
        ? hours
        : []
    ).map(
      (hour) => ({
        label: getHourLabel(hour),
        in: Number(hour.in) || 0,
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
    const date = parseSystemDateTime(value);

    if (date) {
      state.serverOffsetMs =
        date.getTime() -
        Date.now();
    }
  }

  function formatDashboardDisplayDateTime(
    value
  ) {
    const text =
      String(value || '')
        .trim();

    if (!text) {
      return '-';
    }

    if (
      /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}$/.test(text)
    ) {
      return text;
    }

    const parsedBySystem =
      parseSystemDateTime(
        text
      );

    if (parsedBySystem) {
      return formatBangkokDateTime(
        parsedBySystem
      );
    }

    const nativeDate =
      new Date(text);

    if (
      !Number.isNaN(
        nativeDate.getTime()
      )
    ) {
      return formatBangkokDateTime(
        nativeDate
      );
    }

    const isoMatch =
      text.match(
        /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})/
      );

    if (isoMatch) {
      const date =
        new Date(
          isoMatch[1] + '-' +
          isoMatch[2] + '-' +
          isoMatch[3] + 'T' +
          isoMatch[4] + ':' +
          isoMatch[5] + ':' +
          isoMatch[6] + '+07:00'
        );

      if (
        !Number.isNaN(
          date.getTime()
        )
      ) {
        return formatBangkokDateTime(
          date
        );
      }
    }

    return text;
  }


  function parseSystemDateTime(value) {
    const text = String(value || '').trim();

    const match = text.match(
      /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/
    );

    if (!match) {
      return null;
    }

    const date = new Date(
      match[3] + '-' +
      match[2] + '-' +
      match[1] + 'T' +
      match[4] + ':' +
      match[5] + ':' +
      match[6] + '+07:00'
    );

    return Number.isNaN(date.getTime())
      ? null
      : date;
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
          timeZone: 'Asia/Bangkok',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
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
    const total = Math.max(
      0,
      Math.floor(Number(seconds) || 0)
    );

    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(
      (total % 3600) / 60
    );
    const remaining = total % 60;

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

  function getStatusLabel(code) {
    return {
      NORMAL: 'ปกติ',
      WARNING: 'เฝ้าระวัง',
      OVERDUE: 'เกินเวลา',
      INCOMPLETE: 'ข้อมูลไม่สมบูรณ์'
    }[String(code || '')] ||
      'ไม่ทราบสถานะ';
  }

  function getHourLabel(hour) {
    return String(
      hour.label ||
      hour.hourLabel ||
      hour.hour ||
      '--:00'
    );
  }

  function normalizeText(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function truncateText(value, maxLength) {
    const text = String(value || '');

    return text.length > maxLength
      ? text.slice(0, maxLength - 1) + '…'
      : text;
  }

  function setConnectionState(code, text) {
    const element = byId('dashboardConnection');

    if (element) {
      element.dataset.state = code;
      element.textContent = text;
    }
  }

  function setRefreshButtonLoading(loading) {
    const button = byId('dashboardRefreshButton');

    if (!button) {
      return;
    }

    button.disabled = loading;

    const label = button.querySelector('span');

    if (label) {
      label.textContent = loading
        ? 'กำลังอัปเดต'
        : 'รีเฟรช';
    }
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
        error && error.message ||
        title
      );
      return;
    }

    await window.Swal.fire({
      icon: 'error',
      title: title,
      text:
        error && error.message ||
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

  function getSessionRole(session) {
    const user =
      session &&
      session.user &&
      typeof session.user === 'object'
        ? session.user
        : session || {};

    return String(
      user.role ||
      'USER'
    )
      .trim()
      .toUpperCase();
  }

  function isDashboardAllowedRole(session) {
    const role =
      getSessionRole(session);

    return (
      role === 'USER' ||
      role === 'ADMIN'
    );
  }

  function redirectToInbound() {
    window.location.replace(
      String(
        CONFIG.INBOUND_URL ||
        '../inbound.html'
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

    const button =
      byId('dashboardFullscreenButton');

    if (label) {
      label.textContent =
        document.fullscreenElement
          ? 'ออกเต็มจอ'
          : 'เต็มจอ';
    }

    button?.setAttribute(
      'aria-pressed',
      String(
        Boolean(
          document.fullscreenElement
        )
      )
    );

    window.setTimeout(
      resizeCharts,
      80
    );
  }

  function focusRecordsPanel() {
    const panel =
      document.querySelector(
        '.records-panel'
      );

    if (
      panel &&
      window.innerWidth < 1180
    ) {
      panel.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  }

  function setText(id, value) {
    const element = byId(id);

    if (element) {
      element.textContent = String(
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
      ).searchParams.get('module') || ''
    ).trim();
  }

  function debounce(fn, wait) {
    let timer;

    return function (...args) {
      window.clearTimeout(timer);

      timer = window.setTimeout(
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

    Object.keys(state.charts)
      .forEach(destroyChart);
  }

})(window, document);
