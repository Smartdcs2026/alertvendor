/**
 * dashboard.js
 * Dashboard Live แบบอ่านอย่างเดียว
 *
 * ไม่ใช้คำสั่ง POST/PUT/DELETE
 * ไม่แก้ไขข้อมูลระบบเดิม
 */
(function (
  window,
  document
) {
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
      null,

    records:
      [],

    movementSummary:
      null,

    period:
      'ROLLING_24',

    searchText:
      '',

    statusFilter:
      'ALL',

    serverOffsetMs:
      0,

    refreshInProgress:
      false,

    refreshTimer:
      null,

    clockTimer:
      null,

    charts: {
      hourly:
        null,

      status:
        null,

      duration:
        null,

      overdue:
        null
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
      if (
        typeof window.Swal ===
          'undefined'
      ) {
        throw new Error(
          'ไม่พบ SweetAlert2'
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

      if (!API) {
        throw new Error(
          'ไม่พบ dashboard-api.js'
        );
      }

      state.moduleId =
        getModuleIdFromUrl();

      if (!state.moduleId) {
        await Swal.fire({
          icon:
            'error',

          title:
            'ไม่พบรหัสโมดูล',

          text:
            'กรุณาเปิด Dashboard จากหน้าสถานะของ Module',

          confirmButtonText:
            'กลับหน้าหลัก'
        });

        window.location.replace(
          '../index.html'
        );

        return;
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

      renderSession();

      await refreshDashboard({
        showError:
          true,

        silent:
          false
      });

      startAutoRefresh();

    } catch (error) {
      if (
        isAuthenticationError(
          error
        )
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
    const backButton =
      document.getElementById(
        'dashboardBackButton'
      );

    const refreshButton =
      document.getElementById(
        'dashboardRefreshButton'
      );

    const fullscreenButton =
      document.getElementById(
        'dashboardFullscreenButton'
      );

    const periodGroup =
      document.getElementById(
        'dashboardPeriodGroup'
      );

    const searchInput =
      document.getElementById(
        'dashboardSearchInput'
      );

    const statusFilter =
      document.getElementById(
        'dashboardStatusFilter'
      );

    backButton &&
      backButton.addEventListener(
        'click',
        goBackToModule
      );

    refreshButton &&
      refreshButton.addEventListener(
        'click',
        async () => {
          await refreshDashboard({
            showError:
              true,

            silent:
              false
          });
        }
      );

    fullscreenButton &&
      fullscreenButton.addEventListener(
        'click',
        toggleDashboardFullscreen
      );

    document.addEventListener(
      'fullscreenchange',
      syncFullscreenButton
    );

    window.addEventListener(
      'resize',
      debounce(
        resizeDashboardCharts,
        120
      )
    );

    periodGroup &&
      periodGroup.addEventListener(
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

          periodGroup
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

          renderMovementKpis();
          renderHourlyChart();
        }
      );

    searchInput &&
      searchInput.addEventListener(
        'input',
        debounce(
          () => {
            state.searchText =
              String(
                searchInput.value || ''
              )
                .trim()
                .toLowerCase();

            renderRecordTable();
          },
          160
        )
      );

    statusFilter &&
      statusFilter.addEventListener(
        'change',
        () => {
          state.statusFilter =
            String(
              statusFilter.value ||
              'ALL'
            ).toUpperCase();

          renderRecordTable();
        }
      );

    document.addEventListener(
      'visibilitychange',
      async () => {
        if (
          document.visibilityState ===
            'visible'
        ) {
          await refreshDashboard({
            showError:
              false,

            silent:
              true
          });
        }
      }
    );
  }

  async function refreshDashboard(
    options
  ) {
    if (
      state.refreshInProgress
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

    /*
     * การอัปเดตอัตโนมัติทำงานเงียบ:
     * - ไม่เปลี่ยนข้อความเชื่อมต่อ
     * - ไม่เปลี่ยนข้อความปุ่ม
     * - ไม่เปิด Loading
     * - ไม่แสดง Toast หรือ Alert
     */
    if (!silent) {
      setConnectionState(
        'LOADING',
        'กำลังอัปเดต'
      );

      setRefreshButtonLoading(
        true
      );
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
          )
        ]);

      state.module =
        results[0] || {};

      const recordsResult =
        results[1] || {};

      state.movementSummary =
        results[2] || {};

      if (
        recordsResult.module &&
        typeof recordsResult.module ===
          'object'
      ) {
        state.module = {
          ...state.module,
          ...recordsResult.module
        };
      }

      state.records =
        Array.isArray(
          recordsResult.records
        )
          ? recordsResult.records
          : [];

      updateServerOffset(
        recordsResult.generatedAt ||
        state.movementSummary.generatedAt
      );

      recalculateRecords();

      renderDashboard({
        silent
      });

      const generatedAt =
        recordsResult.generatedAt ||
        state.movementSummary.generatedAt ||
        formatBangkokDateTime(
          getCurrentServerDate()
        );

      /*
       * อัปเดตเวลาแบบเงียบ ไม่แสดงสถานะกำลังโหลด
       */
      setText(
        'dashboardLastUpdated',
        'ข้อมูลล่าสุด ' +
        generatedAt
      );

      if (!silent) {
        setConnectionState(
          'ONLINE',
          'เชื่อมต่อแล้ว'
        );
      }

    } catch (error) {
      if (
        isAuthenticationError(
          error
        )
      ) {
        redirectToLogin();
        return;
      }

      if (!silent) {
        setConnectionState(
          'ERROR',
          'เชื่อมต่อไม่สำเร็จ'
        );
      }

      if (
        config.showError &&
        !silent
      ) {
        await showError(
          error,
          'โหลดข้อมูล Dashboard ไม่สำเร็จ'
        );

      } else {
        console.warn(
          'Dashboard background refresh ไม่สำเร็จ',
          error
        );
      }

    } finally {
      state.refreshInProgress =
        false;

      if (!silent) {
        setRefreshButtonLoading(
          false
        );
      }
    }
  }

  function renderDashboard(
    options
  ) {
    const config =
      options &&
      typeof options === 'object'
        ? options
        : {};

    const silent =
      config.silent === true;

    renderModuleHeader();
    renderThresholds();
    renderMovementKpis();
    renderStatusKpis();
    renderHourlyChart(silent);
    renderStatusChart(silent);
    renderDurationChart(silent);
    renderTopOverdueChart(silent);
    renderRecordTable();
  }

  function renderSession() {
    const user =
      state.session &&
      state.session.user
        ? state.session.user
        : {};

    setText(
      'dashboardUserName',
      user.displayName ||
      user.username ||
      '-'
    );
  }

  function renderModuleHeader() {
    const module =
      state.module || {};

    setText(
      'dashboardModuleTitle',
      (
        module.name ||
        state.moduleId
      ) +
      ' Dashboard'
    );

    setText(
      'dashboardModuleDescription',
      module.description ||
      'วิเคราะห์สถานะรถและตู้สินค้าในพื้นที่'
    );

    document.title =
      (
        module.name ||
        'Dashboard'
      ) +
      ' | Vehicle Control Tower';
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
      ' ชั่วโมง'
    );
  }

  function renderMovementKpis() {
    const summary =
      state.movementSummary || {};

    const metric =
      state.period === 'TODAY'
        ? summary.today
        : summary.rolling24;

    const fallback =
      summary.currentRound || {};

    const selected =
      metric &&
      typeof metric === 'object'
        ? metric
        : fallback;

    setText(
      'kpiIn',
      formatInteger(
        selected.in
      )
    );

    setText(
      'kpiOut',
      formatInteger(
        selected.outTotal
      )
    );

    setText(
      'hourlyChartPeriodLabel',
      state.period === 'TODAY'
        ? 'วันนี้'
        : 'ย้อนหลัง 24 ชั่วโมง'
    );
  }

  function renderStatusKpis() {
    const counts =
      countStatuses();

    setText(
      'kpiActive',
      String(
        state.records.length
      )
    );

    setText(
      'kpiNormal',
      String(
        counts.NORMAL
      )
    );

    setText(
      'kpiWarning',
      String(
        counts.WARNING
      )
    );

    setText(
      'kpiOverdue',
      String(
        counts.OVERDUE
      )
    );

    const durations =
      state.records
        .map(
          (record) =>
            Number(
              record.durationSeconds
            ) || 0
        )
        .filter(
          (value) =>
            value >= 0
        );

    const average =
      durations.length
        ? durations.reduce(
            (sum, value) =>
              sum + value,
            0
          ) /
          durations.length
        : 0;

    const maximum =
      durations.length
        ? Math.max(
            ...durations
          )
        : 0;

    setText(
      'kpiAverageDuration',
      formatDurationCompact(
        average
      )
    );

    setText(
      'kpiMaximumDuration',
      formatDurationCompact(
        maximum
      )
    );
  }

  function recalculateRecords() {
    const nowMs =
      getCurrentServerTimeMs();

    const thresholds =
      getThresholds();

    state.records.forEach(
      (record) => {
        if (!record) {
          return;
        }

        const timestampInMs =
          Number(
            record.timestampInEpochMs
          );

        if (
          !record.isCurrentlyInArea ||
          !Number.isFinite(
            timestampInMs
          ) ||
          timestampInMs <= 0
        ) {
          record.durationSeconds =
            0;

          record.statusCode =
            'INCOMPLETE';

          return;
        }

        const durationSeconds =
          Math.max(
            0,
            Math.floor(
              (
                nowMs -
                timestampInMs
              ) / 1000
            )
          );

        record.durationSeconds =
          durationSeconds;

        record.statusCode =
          durationSeconds >=
            thresholds.redSeconds
            ? 'OVERDUE'
            : durationSeconds >=
                thresholds.warningSeconds
              ? 'WARNING'
              : 'NORMAL';

        record.overdueSeconds =
          Math.max(
            0,
            durationSeconds -
            thresholds.redSeconds
          );
      }
    );
  }

  function getThresholds() {
    const module =
      state.module || {};

    const movementThresholds =
      state.movementSummary &&
      state.movementSummary.thresholds
        ? state.movementSummary.thresholds
        : {};

    const greenMinutes =
      Math.max(
        0,
        Number(
          movementThresholds.greenStartMinutes
        ) ||
        Number(
          module.greenStartMinutes
        ) ||
        0
      );

    const warningMinutes =
      Math.max(
        greenMinutes,
        Number(
          movementThresholds.warningStartMinutes
        ) ||
        Number(
          module.warningStartMinutes
        ) ||
        45
      );

    const redMinutes =
      Math.max(
        warningMinutes + 1,
        Number(
          movementThresholds.redStartMinutes
        ) ||
        Number(
          module.redStartMinutes
        ) ||
        60
      );

    const autoCloseHours =
      Math.max(
        1,
        Number(
          movementThresholds.autoCloseHours
        ) ||
        36
      );

    return {
      greenMinutes,
      warningMinutes,
      redMinutes,

      warningSeconds:
        warningMinutes * 60,

      redSeconds:
        redMinutes * 60,

      autoCloseHours,

      autoCloseSeconds:
        autoCloseHours *
        60 *
        60
    };
  }

  function countStatuses() {
    const result = {
      NORMAL:
        0,

      WARNING:
        0,

      OVERDUE:
        0,

      INCOMPLETE:
        0
    };

    state.records.forEach(
      (record) => {
        const code =
          String(
            record &&
            record.statusCode ||
            'INCOMPLETE'
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

  function renderHourlyChart(
    silent
  ) {
    const canvas =
      document.getElementById(
        'hourlyMovementChart'
      );

    const empty =
      document.getElementById(
        'hourlyMovementEmpty'
      );

    if (!canvas) {
      return;
    }

    const hours =
      getHourlyRows();

    const isEmpty =
      hours.length === 0;

    empty &&
      empty.classList.toggle(
        'is-hidden',
        !isEmpty
      );

    canvas.classList.toggle(
      'is-hidden',
      isEmpty
    );

    if (isEmpty) {
      destroyChart(
        'hourly'
      );

      return;
    }

    const labels =
      hours.map(
        (hour) =>
          getHourLabel(
            hour
          )
      );

    const inData =
      hours.map(
        (hour) =>
          Number(
            hour.in
          ) || 0
      );

    const outData =
      hours.map(
        (hour) =>
          Number(
            hour.outTotal
          ) || 0
      );

    if (
      state.charts.hourly
    ) {
      state.charts.hourly.data.labels =
        labels;

      state.charts.hourly.data.datasets[0].data =
        inData;

      state.charts.hourly.data.datasets[1].data =
        outData;

      state.charts.hourly.update(
        silent
          ? 'none'
          : 'active'
      );

      return;
    }

    state.charts.hourly =
      new Chart(
        canvas,
        {
          type:
            'line',

          data: {
            labels,

            datasets: [
              {
                label:
                  'เข้า',

                data:
                  inData,

                borderColor:
                  '#16a34a',

                backgroundColor:
                  'rgba(22,163,74,.10)',

                borderWidth:
                  2.4,

                tension:
                  0.28,

                fill:
                  true,

                pointRadius:
                  1.6,

                pointHoverRadius:
                  4
              },
              {
                label:
                  'ออก',

                data:
                  outData,

                borderColor:
                  '#2563eb',

                backgroundColor:
                  'rgba(37,99,235,.08)',

                borderWidth:
                  2.4,

                tension:
                  0.28,

                fill:
                  true,

                pointRadius:
                  1.6,

                pointHoverRadius:
                  4
              }
            ]
          },

          options:
            buildCommonChartOptions({
              beginAtZero:
                true,

              integerTicks:
                true,

              animation:
                false,

              maxTicksLimit:
                12
            })
        }
      );
  }

  function getHourlyRows() {
    const summary =
      state.movementSummary || {};

    const modeKey =
      state.period === 'TODAY'
        ? 'today'
        : 'rolling24';

    const candidates = [
      summary.hours &&
      summary.hours[
        modeKey
      ],

      summary[
        modeKey
      ] &&
      summary[
        modeKey
      ].hours,

      summary[
        modeKey
      ] &&
      summary[
        modeKey
      ].hourly,

      Array.isArray(
        summary.hours
      )
        ? summary.hours
        : null
    ];

    for (
      const candidate of
      candidates
    ) {
      if (
        Array.isArray(
          candidate
        )
      ) {
        return candidate;
      }

      if (
        candidate &&
        typeof candidate ===
          'object'
      ) {
        return Object.values(
          candidate
        );
      }
    }

    return [];
  }

  function getHourLabel(
    hour
  ) {
    const direct =
      hour &&
      (
        hour.label ||
        hour.hourLabel ||
        hour.timeLabel
      );

    if (direct) {
      const text =
        String(direct);

      return /:/.test(text)
        ? text
        : text + ':00';
    }

    const epochMs =
      Number(
        hour &&
        (
          hour.startEpochMs ||
          hour.hourStartEpochMs
        )
      );

    if (
      Number.isFinite(
        epochMs
      )
    ) {
      return new Intl.DateTimeFormat(
        'th-TH',
        {
          timeZone:
            CONFIG.TIMEZONE ||
            'Asia/Bangkok',

          hour:
            '2-digit',

          minute:
            '2-digit',

          hourCycle:
            'h23'
        }
      ).format(
        new Date(epochMs)
      );
    }

    return '--:--';
  }

  function renderStatusChart(
    silent
  ) {
    const canvas =
      document.getElementById(
        'statusChart'
      );

    if (!canvas) {
      return;
    }

    const counts =
      countStatuses();

    const values = [
      counts.NORMAL,
      counts.WARNING,
      counts.OVERDUE,
      counts.INCOMPLETE
    ];

    if (
      state.charts.status
    ) {
      state.charts.status.data.datasets[0].data =
        values;

      state.charts.status.update(
        silent
          ? 'none'
          : 'active'
      );

      return;
    }

    state.charts.status =
      new Chart(
        canvas,
        {
          type:
            'doughnut',

          data: {
            labels: [
              'ปกติ',
              'เฝ้าระวัง',
              'เกินเวลา',
              'ข้อมูลไม่สมบูรณ์'
            ],

            datasets: [
              {
                data:
                  values,

                backgroundColor: [
                  '#16a34a',
                  '#f59e0b',
                  '#dc2626',
                  '#94a3b8'
                ],

                borderColor:
                  '#ffffff',

                borderWidth:
                  3,

                hoverOffset:
                  5
              }
            ]
          },

          options: {
            responsive:
              true,

            maintainAspectRatio:
              false,

            animation:
              false,

            cutout:
              '70%',

            plugins: {
              legend: {
                position:
                  'bottom',

                labels: {
                  usePointStyle:
                    true,

                  boxWidth:
                    8,

                  padding:
                    11,

                  font: {
                    size:
                      10
                  }
                }
              },

              tooltip: {
                displayColors:
                  true
              }
            }
          }
        }
      );
  }

  function renderDurationChart(
    silent
  ) {
    const canvas =
      document.getElementById(
        'durationChart'
      );

    if (!canvas) {
      return;
    }

    const buckets = [
      {
        label:
          '0–30 นาที',

        min:
          0,

        max:
          30 * 60,

        count:
          0
      },
      {
        label:
          '31–60 นาที',

        min:
          30 * 60,

        max:
          60 * 60,

        count:
          0
      },
      {
        label:
          '1–2 ชม.',

        min:
          60 * 60,

        max:
          2 * 60 * 60,

        count:
          0
      },
      {
        label:
          '2–4 ชม.',

        min:
          2 * 60 * 60,

        max:
          4 * 60 * 60,

        count:
          0
      },
      {
        label:
          '4–8 ชม.',

        min:
          4 * 60 * 60,

        max:
          8 * 60 * 60,

        count:
          0
      },
      {
        label:
          'เกิน 8 ชม.',

        min:
          8 * 60 * 60,

        max:
          Infinity,

        count:
          0
      }
    ];

    state.records.forEach(
      (record) => {
        const duration =
          Number(
            record.durationSeconds
          ) || 0;

        const bucket =
          buckets.find(
            (item) =>
              duration >= item.min &&
              duration <
                item.max
          );

        if (bucket) {
          bucket.count += 1;
        }
      }
    );

    const labels =
      buckets.map(
        (item) =>
          item.label
      );

    const values =
      buckets.map(
        (item) =>
          item.count
      );

    if (
      state.charts.duration
    ) {
      state.charts.duration.data.labels =
        labels;

      state.charts.duration.data.datasets[0].data =
        values;

      state.charts.duration.update(
        silent
          ? 'none'
          : 'active'
      );

      return;
    }

    state.charts.duration =
      new Chart(
        canvas,
        {
          type:
            'bar',

          data: {
            labels,

            datasets: [
              {
                label:
                  'จำนวนตู้',

                data:
                  values,

                backgroundColor: [
                  '#0ea5e9',
                  '#22c55e',
                  '#84cc16',
                  '#f59e0b',
                  '#f97316',
                  '#dc2626'
                ],

                borderRadius:
                  6,

                borderSkipped:
                  false,

                maxBarThickness:
                  34
              }
            ]
          },

          options:
            buildCommonChartOptions({
              beginAtZero:
                true,

              integerTicks:
                true,

              showLegend:
                false,

              animation:
                false,

              maxTicksLimit:
                6
            })
        }
      );
  }

  function renderTopOverdueChart(
    silent
  ) {
    const canvas =
      document.getElementById(
        'topOverdueChart'
      );

    const empty =
      document.getElementById(
        'topOverdueEmpty'
      );

    if (!canvas) {
      return;
    }

    const overdue =
      state.records
        .filter(
          (record) =>
            record.statusCode ===
            'OVERDUE'
        )
        .sort(
          (left, right) =>
            Number(
              right.overdueSeconds
            ) -
            Number(
              left.overdueSeconds
            )
        )
        .slice(
          0,
          8
        );

    setText(
      'topOverdueCount',
      overdue.length +
      ' รายการ'
    );

    const isEmpty =
      overdue.length === 0;

    empty &&
      empty.classList.toggle(
        'is-hidden',
        !isEmpty
      );

    canvas.classList.toggle(
      'is-hidden',
      isEmpty
    );

    if (isEmpty) {
      destroyChart(
        'overdue'
      );

      return;
    }

    const labels =
      overdue.map(
        (record) =>
          getRecordTitle(
            record
          )
      );

    const values =
      overdue.map(
        (record) =>
          Math.round(
            Number(
              record.overdueSeconds
            ) / 60
          )
      );

    if (
      state.charts.overdue
    ) {
      state.charts.overdue.data.labels =
        labels;

      state.charts.overdue.data.datasets[0].data =
        values;

      state.charts.overdue.update(
        silent
          ? 'none'
          : 'active'
      );

      return;
    }

    state.charts.overdue =
      new Chart(
        canvas,
        {
          type:
            'bar',

          data: {
            labels,

            datasets: [
              {
                label:
                  'เกินเกณฑ์แล้ว',

                data:
                  values,

                backgroundColor:
                  '#dc2626',

                borderRadius:
                  6,

                borderSkipped:
                  false,

                maxBarThickness:
                  22
              }
            ]
          },

          options:
            buildCommonChartOptions({
              indexAxis:
                'y',

              beginAtZero:
                true,

              integerTicks:
                true,

              showLegend:
                false,

              animation:
                false,

              valueSuffix:
                ' นาที',

              maxTicksLimit:
                6
            })
        }
      );
  }

  function buildCommonChartOptions(
    options
  ) {
    const config =
      options &&
      typeof options === 'object'
        ? options
        : {};

    const isHorizontal =
      config.indexAxis ===
      'y';

    return {
      responsive:
        true,

      maintainAspectRatio:
        false,

      animation:
        config.animation ===
        false
          ? false
          : {
              duration:
                240
            },

      normalized:
        true,

      resizeDelay:
        100,

      indexAxis:
        config.indexAxis ||
        'x',

      layout: {
        padding: {
          top:
            2,

          right:
            4,

          bottom:
            0,

          left:
            2
        }
      },

      interaction: {
        mode:
          'index',

        intersect:
          false
      },

      plugins: {
        legend: {
          display:
            config.showLegend !==
            false,

          position:
            'bottom',

          labels: {
            usePointStyle:
              true,

            boxWidth:
              8,

            padding:
              12,

            font: {
              size:
                10
            }
          }
        },

        tooltip: {
          displayColors:
            true,

          callbacks: {
            label:
              (context) => {
                const value =
                  context.parsed &&
                  typeof context.parsed ===
                    'object'
                    ? (
                        isHorizontal
                          ? context.parsed.x
                          : context.parsed.y
                      )
                    : context.parsed;

                return (
                  context.dataset.label +
                  ': ' +
                  value +
                  (
                    config.valueSuffix ||
                    ''
                  )
                );
              }
          }
        }
      },

      scales: {
        x: {
          beginAtZero:
            config.beginAtZero ===
            true,

          border: {
            display:
              false
          },

          grid: {
            display:
              isHorizontal,

            color:
              'rgba(148,163,184,.14)'
          },

          ticks: {
            autoSkip:
              true,

            maxRotation:
              0,

            minRotation:
              0,

            maxTicksLimit:
              Number(
                config.maxTicksLimit
              ) || 10,

            precision:
              config.integerTicks
                ? 0
                : undefined,

            font: {
              size:
                9
            },

            color:
              '#718493'
          }
        },

        y: {
          beginAtZero:
            config.beginAtZero ===
            true,

          border: {
            display:
              false
          },

          grid: {
            display:
              !isHorizontal,

            color:
              'rgba(148,163,184,.14)'
          },

          ticks: {
            autoSkip:
              true,

            maxTicksLimit:
              Number(
                config.maxTicksLimit
              ) || 8,

            precision:
              config.integerTicks
                ? 0
                : undefined,

            font: {
              size:
                9
            },

            color:
              '#718493'
          }
        }
      }
    };
  }

  function renderRecordTable() {
    const tbody =
      document.getElementById(
        'dashboardRecordTableBody'
      );

    const empty =
      document.getElementById(
        'dashboardRecordEmpty'
      );

    if (!tbody) {
      return;
    }

    const records =
      state.records
        .filter(
          (record) => {
            if (
              state.statusFilter !==
                'ALL' &&
              record.statusCode !==
                state.statusFilter
            ) {
              return false;
            }

            if (!state.searchText) {
              return true;
            }

            return getRecordSearchText(
              record
            ).includes(
              state.searchText
            );
          }
        )
        .sort(
          compareRecords
        );

    tbody.innerHTML =
      '';

    empty &&
      empty.classList.toggle(
        'is-hidden',
        records.length > 0
      );

    if (
      records.length === 0
    ) {
      return;
    }

    const fragment =
      document.createDocumentFragment();

    records.forEach(
      (record) => {
        const row =
          document.createElement(
            'tr'
          );

        row.dataset.status =
          record.statusCode ||
          'INCOMPLETE';

        const titleCell =
          document.createElement(
            'td'
          );

        titleCell.dataset.label =
          'ตู้/รายการ';

        titleCell.innerHTML = `
          <strong>${escapeHtml(getRecordTitle(record))}</strong>
          <small>${escapeHtml(getRecordSecondary(record))}</small>
        `;

        const detailCell =
          document.createElement(
            'td'
          );

        detailCell.dataset.label =
          'ข้อมูลประกอบ';

        detailCell.textContent =
          getRecordDetails(
            record
          );

        const inCell =
          document.createElement(
            'td'
          );

        inCell.dataset.label =
          'เวลาเข้า';

        inCell.textContent =
          record.timestampIn ||
          '-';

        const durationCell =
          document.createElement(
            'td'
          );

        durationCell.dataset.label =
          'ระยะเวลา';

        durationCell.textContent =
          formatDurationCompact(
            record.durationSeconds
          );

        const statusCell =
          document.createElement(
            'td'
          );

        statusCell.dataset.label =
          'สถานะ';

        statusCell.innerHTML = `
          <span
            class="dashboard-status-badge"
            data-status="${escapeHtml(record.statusCode || 'INCOMPLETE')}"
          >
            ${escapeHtml(getStatusLabel(record.statusCode))}
          </span>
        `;

        row.appendChild(
          titleCell
        );

        row.appendChild(
          detailCell
        );

        row.appendChild(
          inCell
        );

        row.appendChild(
          durationCell
        );

        row.appendChild(
          statusCell
        );

        fragment.appendChild(
          row
        );
      }
    );

    tbody.appendChild(
      fragment
    );
  }

  function compareRecords(
    left,
    right
  ) {
    const order = {
      OVERDUE:
        0,

      WARNING:
        1,

      INCOMPLETE:
        2,

      NORMAL:
        3
    };

    const leftOrder =
      order[
        left.statusCode
      ] ?? 9;

    const rightOrder =
      order[
        right.statusCode
      ] ?? 9;

    if (
      leftOrder !==
      rightOrder
    ) {
      return (
        leftOrder -
        rightOrder
      );
    }

    return (
      Number(
        right.durationSeconds
      ) -
      Number(
        left.durationSeconds
      )
    );
  }

  function getRecordTitle(
    record
  ) {
    return String(
      record &&
      (
        record.primaryValue ||
        record.vehiclePlate ||
        record.containerId ||
        record.recordId
      ) ||
      'ไม่ระบุรายการ'
    );
  }

  function getRecordSecondary(
    record
  ) {
    const plate =
      getFieldValue(
        record,
        [
          'ทะเบียน',
          'ทะเบียนรถ',
          'vehicle plate',
          'plate'
        ]
      );

    const company =
      getFieldValue(
        record,
        [
          'บริษัท',
          'vendor',
          'company',
          'ผู้ขนส่ง'
        ]
      );

    return [
      plate,
      company
    ]
      .filter(Boolean)
      .join(' · ') ||
      'ไม่มีข้อมูลประกอบ';
  }

  function getRecordDetails(
    record
  ) {
    const fields =
      Array.isArray(
        record &&
        record.fields
      )
        ? record.fields
        : [];

    return fields
      .filter(
        (field) =>
          field &&
          !field.primary &&
          field.value
      )
      .slice(
        0,
        4
      )
      .map(
        (field) =>
          String(
            field.label || ''
          ) +
          ': ' +
          String(
            field.value || ''
          )
      )
      .join(' | ') ||
      '-';
  }

  function getFieldValue(
    record,
    labels
  ) {
    const fields =
      Array.isArray(
        record &&
        record.fields
      )
        ? record.fields
        : [];

    const normalizedLabels =
      labels.map(
        (label) =>
          String(label)
            .trim()
            .toLowerCase()
      );

    const field =
      fields.find(
        (item) => {
          const label =
            String(
              item &&
              item.label ||
              ''
            )
              .trim()
              .toLowerCase();

          return normalizedLabels.some(
            (expected) =>
              label === expected ||
              label.includes(
                expected
              )
          );
        }
      );

    return field
      ? String(
          field.value || ''
        )
      : '';
  }

  function getRecordSearchText(
    record
  ) {
    const fields =
      Array.isArray(
        record &&
        record.fields
      )
        ? record.fields
        : [];

    return [
      record.recordId,
      record.primaryValue,
      record.timestampIn,
      ...fields.flatMap(
        (field) => [
          field.label,
          field.value
        ]
      )
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  function getStatusLabel(
    code
  ) {
    const labels = {
      NORMAL:
        'ปกติ',

      WARNING:
        'เฝ้าระวัง',

      OVERDUE:
        'เกินเวลา',

      INCOMPLETE:
        'ข้อมูลไม่สมบูรณ์'
    };

    return (
      labels[
        String(
          code || ''
        ).toUpperCase()
      ] ||
      'ไม่ทราบสถานะ'
    );
  }

  function updateServerOffset(
    generatedAt
  ) {
    const parsedMs =
      parseDateTimeToMs(
        generatedAt
      );

    if (
      Number.isFinite(
        parsedMs
      )
    ) {
      state.serverOffsetMs =
        parsedMs -
        Date.now();
    }
  }

  function parseDateTimeToMs(
    value
  ) {
    if (!value) {
      return NaN;
    }

    if (
      typeof value === 'number'
    ) {
      return value;
    }

    const text =
      String(value).trim();

    const direct =
      Date.parse(text);

    if (
      Number.isFinite(
        direct
      )
    ) {
      return direct;
    }

    const match =
      text.match(
        /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/
      );

    if (!match) {
      return NaN;
    }

    return Date.UTC(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1]),
      Number(match[4]) - 7,
      Number(match[5]),
      Number(match[6])
    );
  }

  function getCurrentServerTimeMs() {
    return (
      Date.now() +
      state.serverOffsetMs
    );
  }

  function getCurrentServerDate() {
    return new Date(
      getCurrentServerTimeMs()
    );
  }

  function formatBangkokDateTime(
    date
  ) {
    const formatter =
      new Intl.DateTimeFormat(
        'en-GB',
        {
          timeZone:
            CONFIG.TIMEZONE ||
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

          hourCycle:
            'h23'
        }
      );

    const parts = {};

    formatter
      .formatToParts(date)
      .forEach(
        (part) => {
          parts[part.type] =
            part.value;
        }
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

  function formatDurationCompact(
    totalSeconds
  ) {
    const seconds =
      Math.max(
        0,
        Math.floor(
          Number(
            totalSeconds
          ) || 0
        )
      );

    const days =
      Math.floor(
        seconds / 86400
      );

    const hours =
      Math.floor(
        (
          seconds % 86400
        ) / 3600
      );

    const minutes =
      Math.floor(
        (
          seconds % 3600
        ) / 60
      );

    if (days > 0) {
      return (
        days +
        ' วัน ' +
        hours +
        ' ชม.'
      );
    }

    if (hours > 0) {
      return (
        hours +
        ' ชม. ' +
        minutes +
        ' นาที'
      );
    }

    return (
      minutes +
      ' นาที'
    );
  }

  function formatInteger(
    value
  ) {
    return String(
      Math.max(
        0,
        Math.floor(
          Number(value) || 0
        )
      )
    );
  }

  function startClock() {
    updateClock();

    state.clockTimer =
      window.setInterval(
        updateClock,
        1000
      );
  }

  function updateClock() {
    setText(
      'dashboardCurrentDateTime',
      formatBangkokDateTime(
        new Date()
      )
    );
  }

  function startAutoRefresh() {
    if (
      state.refreshTimer
    ) {
      window.clearInterval(
        state.refreshTimer
      );
    }

    state.refreshTimer =
      window.setInterval(
        () => {
          refreshDashboard({
            showError:
              false,

            silent:
              true
          });
        },
        Math.max(
          20,
          Number(
            CONFIG.REFRESH_SECONDS
          ) || 60
        ) * 1000
      );
  }

  function destroyDashboard() {
    if (
      state.refreshTimer
    ) {
      window.clearInterval(
        state.refreshTimer
      );
    }

    if (
      state.clockTimer
    ) {
      window.clearInterval(
        state.clockTimer
      );
    }

    Object.keys(
      state.charts
    ).forEach(
      destroyChart
    );
  }

  function destroyChart(
    key
  ) {
    const chart =
      state.charts[
        key
      ];

    if (
      chart &&
      typeof chart.destroy ===
        'function'
    ) {
      chart.destroy();
    }

    state.charts[
      key
    ] =
      null;
  }

  async function toggleDashboardFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.warn(
        'ไม่สามารถเปิดโหมดเต็มจอได้',
        error
      );
    }
  }

  function syncFullscreenButton() {
    const button =
      document.getElementById(
        'dashboardFullscreenButton'
      );

    if (!button) {
      return;
    }

    const isFullscreen =
      Boolean(
        document.fullscreenElement
      );

    button.setAttribute(
      'aria-pressed',
      isFullscreen
        ? 'true'
        : 'false'
    );

    const label =
      button.querySelector(
        '[data-fullscreen-label]'
      );

    if (label) {
      label.textContent =
        isFullscreen
          ? 'ออกจากเต็มจอ'
          : 'เต็มจอ';
    }

    document.body.dataset.fullscreen =
      isFullscreen
        ? 'TRUE'
        : 'FALSE';

    window.setTimeout(
      resizeDashboardCharts,
      80
    );
  }

  function resizeDashboardCharts() {
    Object.values(
      state.charts
    ).forEach(
      (chart) => {
        if (
          chart &&
          typeof chart.resize ===
            'function'
        ) {
          chart.resize();
        }
      }
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

  function getModuleIdFromUrl() {
    const params =
      new URLSearchParams(
        window.location.search
      );

    return String(
      params.get('module') ||
      params.get('id') ||
      ''
    ).trim();
  }

  function redirectToLogin() {
    window.location.replace(
      String(
        CONFIG.LOGIN_URL ||
        '../login.html'
      )
    );
  }

  function isAuthenticationError(
    error
  ) {
    return Boolean(
      error &&
      (
        Number(
          error.status
        ) === 401 ||
        [
          'AUTH_REQUIRED',
          'SESSION_EXPIRED',
          'INVALID_SESSION',
          'INVALID_SESSION_SIGNATURE',
          'SESSION_VERSION_EXPIRED'
        ].includes(
          error.code
        )
      )
    );
  }

  function setConnectionState(
    stateCode,
    text
  ) {
    const element =
      document.getElementById(
        'dashboardConnection'
      );

    if (!element) {
      return;
    }

    element.dataset.state =
      stateCode;

    element.textContent =
      text;
  }

  function setRefreshButtonLoading(
    loading
  ) {
    const button =
      document.getElementById(
        'dashboardRefreshButton'
      );

    if (!button) {
      return;
    }

    button.disabled =
      loading;

    button.textContent =
      loading
        ? 'กำลังอัปเดต...'
        : 'รีเฟรช';
  }

  function showLoading(
    show
  ) {
    const loading =
      document.getElementById(
        'dashboardLoading'
      );

    if (!loading) {
      return;
    }

    loading.classList.toggle(
      'is-hidden',
      !show
    );
  }

  async function showError(
    error,
    title
  ) {
    const requestId =
      error &&
      error.requestId
        ? String(
            error.requestId
          )
        : '';

    await Swal.fire({
      icon:
        'error',

      title:
        title ||
        'เกิดข้อผิดพลาด',

      html: `
        <div class="dashboard-error-dialog">
          <div>
            ${escapeHtml(
              error &&
              error.message
                ? error.message
                : String(error)
            )}
          </div>

          ${
            requestId
              ? `
                <small>
                  รหัสอ้างอิง:
                  ${escapeHtml(requestId)}
                </small>
              `
              : ''
          }
        </div>
      `,

      confirmButtonText:
        'ปิด'
    });
  }

  function setText(
    id,
    value
  ) {
    const element =
      document.getElementById(
        id
      );

    if (element) {
      element.textContent =
        value;
    }
  }

  function debounce(
    callback,
    waitMs
  ) {
    let timer =
      null;

    return function (
      ...args
    ) {
      window.clearTimeout(
        timer
      );

      timer =
        window.setTimeout(
          () => {
            callback.apply(
              this,
              args
            );
          },
          waitMs
        );
    };
  }

  function escapeHtml(
    value
  ) {
    return String(
      value || ''
    )
      .replace(
        /&/g,
        '&amp;'
      )
      .replace(
        /</g,
        '&lt;'
      )
      .replace(
        />/g,
        '&gt;'
      )
      .replace(
        /"/g,
        '&quot;'
      )
      .replace(
        /'/g,
        '&#039;'
      );
  }
})(window, document);
