/**
 * module.js
 * หน้าแสดงสถานะรถ/ตู้สินค้าแบบ Dynamic
 *
 * ปรับปรุง:
 * - Auto Refresh แบบเงียบ ไม่แสดง Spinner/Toast
 * - ไม่ล้างหรือสร้างการ์ดใหม่เมื่อข้อมูลไม่เปลี่ยน
 * - รักษาตำแหน่ง Scroll เมื่อข้อมูลเปลี่ยน
 * - รองรับข้อมูลจำนวนมากและหน้าจอมือถือ
 * - คง Login, Calendar, Checkout และ SweetAlert เดิม
 * - Control Tower สรุปสถานการณ์คลังแบบ 24 ชั่วโมง
 * - Timeline รายชั่วโมง เลื่อนและแตะกรองได้บนมือถือ
 * - Progress Bar และสีการ์ดตามเกณฑ์ของแต่ละ Module
 * - เรียงรายการตามความเร่งด่วนและเวลาที่ใกล้เกณฑ์ที่สุด
 * - เคลียร์รายการออกจากหน้าจอตามค่ากลางของระบบ
 * - Movement Summary: เข้า ออก รวม สุทธิ รอบ 4 ชั่วโมง และวันนี้
 * - Timeline แบบ Focus Carousel แสดงเข้า ออก และสุทธิรายชั่วโมง
 * - แสดง Info เกณฑ์สีของแต่ละ Module จากค่าที่ Admin กำหนด
 */
(function (window, document) {
  'use strict';

  const CONFIG = window.APP_CONFIG || {};
  const API = window.VehicleAPI;

  const OVERDUE_BADGE_ICON_URL =
    './icons/icon-192.png';

  const OVERDUE_BADGE_FAVICON_SIZE =
    64;

  const state = {
    moduleId: '',
    session: null,
    module: null,
    records: [],
    filteredRecords: [],
    searchText: '',
    statusFilter: 'ALL',
    serverOffsetMs: 0,
    clockTimer: null,
    durationTimer: null,
    refreshTimer: null,
    refreshInProgress: false,
    recordsSignature: '',
    hasLoadedRecords: false,
    movementSummary: null,
    movementSummarySignature: '',
    movementRefreshInProgress: false,
    movementLoaded: false,
    movementScope: 'CURRENT_ROUND',
    timelineMode: 'ROLLING_24',
    selectedTimelineStartMs: null,
    timelineFocusedStartMs: null,
    timelineShouldFocus: true,
    timelineScrollRaf: null,
    timelineSnapTimer: null,
    autoClosePersistTimer: null,
    lastAutoClosePersistAttemptMs: 0,
    cardNodes: new Map(),
    alertRunning: false,
    userInteracted: false,

    /*
     * เก็บรายการ Active ก่อนซ่อนรายการครบ Auto Close
     * เพื่อให้ badge ยังคงนับจนกว่า Backend จะบันทึก Timestamp Out จริง
     */
    badgeRecords: [],
    overdueBadgeCount: -1,
    baseDocumentTitle: document.title,
    badgeIconImage: null,
    badgeIconReady: false,

    destroyed: false
  };

  document.addEventListener('DOMContentLoaded', initializePage);
  window.addEventListener('beforeunload', destroyPage);
  document.addEventListener('pointerdown', markUserInteraction, { once: true });
  document.addEventListener('keydown', markUserInteraction, { once: true });

  async function initializePage() {
    initializeOverdueBadgeSystem();

    if (typeof window.Swal === 'undefined') {
      console.error('ไม่พบ SweetAlert2');
      return;
    }

    if (!API) {
      await Swal.fire({
        icon: 'error',
        title: 'เริ่มต้นระบบไม่สำเร็จ',
        text: 'ไม่พบไฟล์ api.js',
        confirmButtonText: 'ปิด'
      });
      return;
    }

    state.moduleId = getModuleIdFromUrl();

    if (!state.moduleId) {
      await Swal.fire({
        icon: 'error',
        title: 'ไม่พบโมดูล',
        text: 'URL ไม่ได้ระบุรหัสโมดูล',
        confirmButtonText: 'กลับหน้าหลัก',
        allowOutsideClick: false
      });
      redirectToDashboard();
      return;
    }

    bindEvents();
    startClock();
    showPageLoading(true);

    try {
      const session = await API.me();

      if (!session || !session.authenticated) {
        redirectToLogin();
        return;
      }

      state.session = session;

      if (
        session.user &&
        session.user.mustChangePassword
      ) {
        await Swal.fire({
          icon: 'warning',
          title: 'ต้องเปลี่ยนรหัสผ่าน',
          text: 'กรุณากลับไปหน้าหลักและเปลี่ยนรหัสผ่านก่อนใช้งาน',
          confirmButtonText: 'กลับหน้าหลัก',
          allowOutsideClick: false
        });

        redirectToDashboard();
        return;
      }

      renderSession();

      state.module = await API.getModule(state.moduleId);
      renderModuleHeader();

      await Promise.all([
        loadRecords({
          silentError: false,
          showSuccessToast: false,
          forceRender: true
        }),
        loadMovementSummary({
          silentError: true,
          forceRender: true
        })
      ]);

      startDurationTimer();
      startAutoRefresh();

    } catch (error) {
      if (isAuthenticationError(error)) {
        await showSessionExpired();
        return;
      }

      await showApiError(error, 'เปิดหน้าสถานะไม่สำเร็จ');

    } finally {
      showPageLoading(false);
    }
  }

  function bindEvents() {
    const backButton =
      document.getElementById(
        'backButton'
      );

    const logoutButton =
      document.getElementById(
        'logoutButton'
      );

    const calendarButton =
      document.getElementById(
        'calendarButton'
      );

    const thresholdInfoButton =
      document.getElementById(
        'thresholdInfoButton'
      );

    const searchInput =
      document.getElementById(
        'searchInput'
      );

    const statusFilter =
      document.getElementById(
        'statusFilter'
      );

    const movementScopeGroup =
      document.getElementById(
        'movementScopeGroup'
      );

    const timeline =
      document.getElementById(
        'hourlyTimeline'
      );

    const timelineModeGroup =
      document.getElementById(
        'timelineModeGroup'
      );

    const timelineApplyFilterButton =
      document.getElementById(
        'timelineApplyFilterButton'
      );

    const timelineClearButton =
      document.getElementById(
        'timelineClearButton'
      );

    backButton &&
      backButton.addEventListener(
        'click',
        redirectToDashboard
      );

    logoutButton &&
      logoutButton.addEventListener(
        'click',
        handleLogout
      );

    calendarButton &&
      calendarButton.addEventListener(
        'click',
        openCalendar
      );

    thresholdInfoButton &&
      thresholdInfoButton.addEventListener(
        'click',
        openThresholdInfo
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

            applyFiltersAndRender();
          },
          180
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

          applyFiltersAndRender();
        }
      );

    movementScopeGroup &&
      movementScopeGroup.addEventListener(
        'click',
        (event) => {
          const button =
            event.target.closest(
              '[data-movement-scope]'
            );

          if (!button) {
            return;
          }

          state.movementScope =
            String(
              button.dataset.movementScope ||
              'CURRENT_ROUND'
            ).toUpperCase();

          renderMovementOverview();
        }
      );

    document
      .querySelectorAll(
        '[data-summary-filter]'
      )
      .forEach(
        (button) => {
          button.addEventListener(
            'click',
            () => {
              const value =
                String(
                  button.dataset
                    .summaryFilter ||
                  'ALL'
                ).toUpperCase();

              state.statusFilter =
                value;

              if (statusFilter) {
                statusFilter.value =
                  value;
              }

              applyFiltersAndRender();
            }
          );
        }
      );

    timelineModeGroup &&
      timelineModeGroup.addEventListener(
        'click',
        (event) => {
          const button =
            event.target.closest(
              '[data-timeline-mode]'
            );

          if (!button) {
            return;
          }

          state.timelineMode =
            String(
              button.dataset.timelineMode ||
              'ROLLING_24'
            ).toUpperCase();

          state.selectedTimelineStartMs =
            null;

          state.timelineFocusedStartMs =
            null;

          state.timelineShouldFocus =
            true;

          renderTimeline();
          applyFiltersAndRender();
        }
      );

    timeline &&
      timeline.addEventListener(
        'click',
        (event) => {
          const button =
            event.target.closest(
              '[data-hour-start-ms]'
            );

          if (!button) {
            return;
          }

          const startMs =
            Number(
              button.dataset.hourStartMs
            );

          if (
            !Number.isFinite(startMs)
          ) {
            return;
          }

          state.timelineFocusedStartMs =
            startMs;

          button.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'center'
          });

          renderTimelineFocusPreviewFromElement(
            button
          );
        }
      );

    timeline &&
      timeline.addEventListener(
        'scroll',
        () => {
          scheduleTimelineCenterEffect(
            timeline
          );

          scheduleTimelineCenterSnap(
            timeline
          );
        },
        {
          passive: true
        }
      );

    timeline &&
      timeline.addEventListener(
        'pointerdown',
        () => {
          if (
            state.timelineSnapTimer
          ) {
            window.clearTimeout(
              state.timelineSnapTimer
            );

            state.timelineSnapTimer =
              null;
          }
        }
      );

    timelineApplyFilterButton &&
      timelineApplyFilterButton.addEventListener(
        'click',
        () => {
          if (
            !Number.isFinite(
              Number(
                state.timelineFocusedStartMs
              )
            )
          ) {
            return;
          }

          state.selectedTimelineStartMs =
            Number(
              state.timelineFocusedStartMs
            );

          renderTimeline();
          applyFiltersAndRender();
        }
      );

    timelineClearButton &&
      timelineClearButton.addEventListener(
        'click',
        () => {
          state.selectedTimelineStartMs =
            null;

          renderTimeline();
          applyFiltersAndRender();
        }
      );

    document.addEventListener(
      'visibilitychange',
      async () => {
        if (
          document.visibilityState ===
            'visible' &&
          !state.refreshInProgress &&
          !state.movementRefreshInProgress &&
          state.hasLoadedRecords
        ) {
          await Promise.all([
            loadRecords({
              silentError: true,
              showSuccessToast: false,
              forceRender: false
            }),
            loadMovementSummary({
              silentError: true,
              forceRender: false
            })
          ]);
        }
      }
    );
  }

  function markUserInteraction() {
    state.userInteracted = true;
  }



  async function loadMovementSummary(
    options
  ) {
    if (
      state.movementRefreshInProgress ||
      state.destroyed ||
      !API ||
      typeof API.getMovementSummary !==
        'function'
    ) {
      return;
    }

    const config =
      options &&
      typeof options === 'object'
        ? options
        : {};

    state.movementRefreshInProgress =
      true;

    try {
      const result =
        await API.getMovementSummary(
          state.moduleId,
          {
            mode: 'all'
          }
        );

      if (
        !result ||
        typeof result !== 'object'
      ) {
        throw new Error(
          'Movement Summary ส่งข้อมูลไม่ถูกต้อง'
        );
      }

      const signature =
        buildMovementSummarySignature(
          result
        );

      const changed =
        config.forceRender === true ||
        !state.movementLoaded ||
        signature !==
          state.movementSummarySignature;

      state.movementSummary =
        result;

      state.movementSummarySignature =
        signature;

      state.movementLoaded =
        true;

      if (
        result.generatedAt
      ) {
        updateServerOffset(
          result.generatedAt
        );
      }

      renderModuleThresholdInfo();
      renderMovementOverview();

      if (changed) {
        renderTimeline();
      }

    } catch (error) {
      console.warn(
        'Movement Summary ไม่พร้อม',
        error
      );

      renderMovementUnavailable();

      if (
        !config.silentError &&
        !isAuthenticationError(error)
      ) {
        await showApiError(
          error,
          'โหลดสรุปเข้า–ออกไม่สำเร็จ'
        );
      }

    } finally {
      state.movementRefreshInProgress =
        false;
    }
  }


  function buildMovementSummarySignature(
    result
  ) {
    return JSON.stringify({
      generatedAt:
        result.generatedAt || '',
      thresholds:
        result.thresholds || {},
      currentState:
        result.currentState || {},
      currentRound:
        result.currentRound || {},
      today:
        result.today || {},
      rolling24:
        result.rolling24 || {},
      hours:
        result.hours || {}
    });
  }
  async function loadRecords(options) {
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

    state.refreshInProgress =
      true;

    const vehicleList =
      document.getElementById(
        'vehicleList'
      );

    vehicleList &&
      vehicleList.setAttribute(
        'aria-busy',
        'true'
      );

    try {
      const result =
        await API.getRecords(
          state.moduleId,
          {
            mode: 'active',
            limit: 1000
          }
        );

      if (
        result &&
        result.module
      ) {
        state.module = {
          ...state.module,
          ...result.module
        };

        renderModuleHeader();
      }

      updateServerOffset(
        result &&
        result.generatedAt
      );

      const nextRecords =
        result &&
        Array.isArray(
          result.records
        )
          ? result.records
          : [];

      const previousSignature =
        state.recordsSignature;

      state.records =
        nextRecords;

      recalculateAllRecords();

      /*
       * สำเนารายการ Active ทั้งหมดหลังคำนวณสถานะ
       * รายการนี้ไม่ถูกตัดออกจาก badge จนกว่า API รอบใหม่
       * จะยืนยันว่ามี Timestamp Out แล้ว
       */
      state.badgeRecords =
        state.records.slice();

      updateOverdueBadgePresentation();

      const expiredCount =
        dropExpiredRecordsFromView();

      if (expiredCount > 0) {
        requestAutoClosePersistence();
      }

      const nextSignature =
        buildRecordsSignature(
          state.records
        );

      const mustRender =
        config.forceRender === true ||
        !state.hasLoadedRecords ||
        nextSignature !==
          previousSignature;

      state.recordsSignature =
        nextSignature;

      renderSummary();
      renderTimeline();

      if (mustRender) {
        const previousScrollY =
          window.scrollY;

        applyFiltersAndRender();

        if (
          state.hasLoadedRecords
        ) {
          window.requestAnimationFrame(
            () => {
              window.scrollTo({
                top: previousScrollY,
                behavior: 'auto'
              });
            }
          );
        }
      }

      setText(
        'lastUpdated',
        'ข้อมูลล่าสุด ' +
          (
            result &&
            result.generatedAt
              ? result.generatedAt
              : formatBangkokDateTime(
                  getCurrentServerDate()
                )
          )
      );

      state.hasLoadedRecords =
        true;

      if (
        config.showSuccessToast
      ) {
        showToast(
          'อัปเดตข้อมูลแล้ว',
          'success'
        );
      }

      checkOverdueAlerts();

    } catch (error) {
      if (
        isAuthenticationError(
          error
        )
      ) {
        await showSessionExpired();
        return;
      }

      if (!config.silentError) {
        await showApiError(
          error,
          'โหลดข้อมูลไม่สำเร็จ'
        );
      }

    } finally {
      state.refreshInProgress =
        false;

      vehicleList &&
        vehicleList.setAttribute(
          'aria-busy',
          'false'
        );
    }
  }

  function buildRecordsSignature(records) {
    const list =
      Array.isArray(records)
        ? records
        : [];

    return JSON.stringify(
      list.map(
        (record) => ({
          recordId:
            record.recordId || '',

          sourceRowNumber:
            Number(
              record.sourceRowNumber
            ) || 0,

          primaryValue:
            record.primaryValue || '',

          timestampIn:
            record.timestampIn || '',

          timestampInEpochMs:
            Number(
              record.timestampInEpochMs
            ) || 0,

          isCurrentlyInArea:
            Boolean(
              record.isCurrentlyInArea
            ),

          isIncomplete:
            Boolean(
              record.isIncomplete
            ),

          canCheckout:
            Boolean(
              record.canCheckout
            ),

          fields:
            Array.isArray(
              record.fields
            )
              ? record.fields.map(
                  (field) => ({
                    id:
                      field.id ||
                      field.fieldId ||
                      '',

                    label:
                      field.label || '',

                    value:
                      field.value || '',

                    type:
                      field.type || '',

                    primary:
                      Boolean(
                        field.primary
                      ),

                    order:
                      Number(
                        field.order
                      ) || 0
                  })
                )
              : []
        })
      )
    );
  }

  function recalculateAllRecords() {
    const nowMs = getCurrentServerTimeMs();

    state.records.forEach((record) => {
      updateRecordComputedState(record, nowMs);
    });
  }

  function updateRecordComputedState(record, nowMs) {
    if (
      !record ||
      !record.isCurrentlyInArea ||
      !Number.isFinite(
        Number(
          record.timestampInEpochMs
        )
      )
    ) {
      if (record) {
        record.statusCode =
          'INCOMPLETE';

        record.statusLabel =
          getStatusLabel(
            'INCOMPLETE'
          );

        record.priorityText =
          'ตรวจสอบข้อมูลเวลาเข้า';

        record.progressPercent =
          0;
      }

      return;
    }

    const durationSeconds =
      Math.max(
        0,
        Math.floor(
          (
            nowMs -
            Number(
              record.timestampInEpochMs
            )
          ) / 1000
        )
      );

    const thresholds =
      getModuleThresholds();

    const statusCode =
      calculateStatusCode(
        durationSeconds
      );

    const autoCloseRemainingSeconds =
      Math.max(
        0,
        thresholds.autoCloseSeconds -
        durationSeconds
      );

    record.durationSeconds =
      durationSeconds;

    record.durationDisplay =
      formatDurationSeconds(
        durationSeconds
      );

    record.statusCode =
      statusCode;

    record.statusLabel =
      getStatusLabel(
        statusCode
      );

    record.statusColor =
      getStatusColor(
        statusCode
      );

    record.isOverdue =
      statusCode === 'OVERDUE';

    record.isExpired36H =
      durationSeconds >=
      thresholds.autoCloseSeconds;

    record.autoCloseRemainingSeconds =
      autoCloseRemainingSeconds;

    record.isNearAutoClose =
      !record.isExpired36H &&
      autoCloseRemainingSeconds <=
        thresholds.nearAutoCloseSeconds;

    record.progressPercent =
      calculateProgressPercent(
        durationSeconds,
        thresholds
      );

    record.warningMarkerPercent =
      thresholds.redSeconds > 0
        ? Math.max(
            0,
            Math.min(
              100,
              (
                thresholds.warningSeconds /
                thresholds.redSeconds
              ) * 100
            )
          )
        : 0;

    record.priorityText =
      buildPriorityText(
        record,
        thresholds
      );

    record.priorityScore =
      calculatePriorityScore(
        record,
        thresholds
      );
  }

  function calculateStatusCode(durationSeconds) {
    if (!state.module) {
      return 'INCOMPLETE';
    }

    const thresholds =
      getModuleThresholds();

    if (
      Number(durationSeconds) >=
      thresholds.redSeconds
    ) {
      return 'OVERDUE';
    }

    if (
      Number(durationSeconds) >=
      thresholds.warningSeconds
    ) {
      return 'WARNING';
    }

    return 'NORMAL';
  }


  function getModuleThresholds() {
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
        Number(CONFIG.DEFAULT_AUTO_CLOSE_HOURS) ||
        36
      );

    const nearAutoCloseHours =
      Math.max(
        1,
        Number(
          movementThresholds.nearAutoCloseHours
        ) ||
        2
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
        autoCloseHours * 60 * 60,
      nearAutoCloseHours,
      nearAutoCloseSeconds:
        nearAutoCloseHours * 60 * 60
    };
  }


  function calculateProgressPercent(
    durationSeconds,
    thresholds
  ) {
    if (
      !thresholds ||
      thresholds.redSeconds <= 0
    ) {
      return 0;
    }

    return Math.max(
      0,
      Math.min(
        100,
        (
          Number(durationSeconds) /
          thresholds.redSeconds
        ) * 100
      )
    );
  }


  function buildPriorityText(
    record,
    thresholds
  ) {
    if (
      !record ||
      record.statusCode ===
        'INCOMPLETE'
    ) {
      return 'ตรวจสอบข้อมูล';
    }

    if (
      record.isNearAutoClose
    ) {
      return (
        'ระบบจะเคลียร์ใน ' +
        formatDurationSeconds(
          record.autoCloseRemainingSeconds
        )
      );
    }

    if (
      record.statusCode ===
      'OVERDUE'
    ) {
      return (
        'เกินเกณฑ์สีแดง ' +
        formatCompactDuration(
          record.durationSeconds -
          thresholds.redSeconds
        )
      );
    }

    if (
      record.statusCode ===
      'WARNING'
    ) {
      return (
        'เหลือ ' +
        formatCompactDuration(
          thresholds.redSeconds -
          record.durationSeconds
        ) +
        ' ก่อนเข้าสีแดง'
      );
    }

    return (
      'เหลือ ' +
      formatCompactDuration(
        thresholds.warningSeconds -
        record.durationSeconds
      ) +
      ' ก่อนเข้าสีส้ม'
    );
  }


  function calculatePriorityScore(
    record,
    thresholds
  ) {
    if (!record) {
      return 999999999;
    }

    if (
      record.isNearAutoClose
    ) {
      return (
        0 * 1000000000 +
        Math.max(
          0,
          record.autoCloseRemainingSeconds
        )
      );
    }

    if (
      record.statusCode ===
      'OVERDUE'
    ) {
      return (
        1 * 1000000000 -
        Math.max(
          0,
          record.durationSeconds
        )
      );
    }

    if (
      record.statusCode ===
      'WARNING'
    ) {
      return (
        2 * 1000000000 +
        Math.max(
          0,
          thresholds.redSeconds -
          record.durationSeconds
        )
      );
    }

    if (
      record.statusCode ===
      'NORMAL'
    ) {
      return (
        3 * 1000000000 +
        Math.max(
          0,
          thresholds.warningSeconds -
          record.durationSeconds
        )
      );
    }

    return 4 * 1000000000;
  }


  function formatCompactDuration(
    totalSeconds
  ) {
    const seconds =
      Math.max(
        0,
        Math.floor(
          Number(totalSeconds) || 0
        )
      );

    const hours =
      Math.floor(
        seconds / 3600
      );

    const minutes =
      Math.floor(
        (
          seconds % 3600
        ) / 60
      );

    if (hours > 0) {
      return (
        hours +
        ' ชม. ' +
        minutes +
        ' นาที'
      );
    }

    return (
      Math.max(
        1,
        minutes
      ) +
      ' นาที'
    );
  }


  function dropExpiredRecordsFromView() {
    const beforeCount =
      state.records.length;

    state.records =
      state.records.filter(
        (record) =>
          !record.isExpired36H
      );

    return (
      beforeCount -
      state.records.length
    );
  }


  function requestAutoClosePersistence() {
    const now =
      Date.now();

    if (
      now -
      state.lastAutoClosePersistAttemptMs <
      60000
    ) {
      return;
    }

    state.lastAutoClosePersistAttemptMs =
      now;

    if (
      state.autoClosePersistTimer
    ) {
      window.clearTimeout(
        state.autoClosePersistTimer
      );
    }

    state.autoClosePersistTimer =
      window.setTimeout(
        async () => {
          state.autoClosePersistTimer =
            null;

          if (
            state.refreshInProgress ||
            state.destroyed
          ) {
            return;
          }

          await Promise.all([
            loadRecords({
              silentError: true,
              showSuccessToast: false,
              forceRender: false
            }),
            loadMovementSummary({
              silentError: true,
              forceRender: false
            })
          ]);
        },
        600
      );
  }


  function renderSession() {
    const user =
      state.session && state.session.user
        ? state.session.user
        : {};

    setText(
      'userDisplayName',
      user.displayName ||
      user.username ||
      '-'
    );
  }

  function renderModuleHeader() {
    const module = state.module || {};

    setText(
      'moduleTitle',
      module.name ||
      state.moduleId
    );

    setText(
      'moduleDescription',
      module.description ||
      'ติดตามสถานะรถและตู้สินค้าในพื้นที่'
    );

    state.baseDocumentTitle =
      (
        module.name ||
        'สถานะรถ'
      ) +
      ' | ' +
      (
        CONFIG.APP_NAME ||
        'ระบบติดตามสถานะรถ'
      );

    updateOverdueBadgePresentation(
      true
    );

    const calendarButton =
      document.getElementById(
        'calendarButton'
      );

    if (calendarButton) {
      calendarButton.classList.toggle(
        'is-hidden',
        !module.calendarEnabled
      );
    }

    renderModuleThresholdInfo();
    updateAutoRefreshStatus();
  }



  function renderModuleThresholdInfo() {
    const container =
      document.getElementById(
        'moduleThresholdInfo'
      );

    if (!container) {
      return;
    }

    const thresholds =
      getModuleThresholds();

    const normalEnd =
      Math.max(
        thresholds.greenMinutes,
        thresholds.warningMinutes - 1
      );

    const warningEnd =
      Math.max(
        thresholds.warningMinutes,
        thresholds.redMinutes - 1
      );

    setText(
      'thresholdNormalText',
      thresholds.greenMinutes +
      '–' +
      normalEnd +
      ' นาที'
    );

    setText(
      'thresholdWarningText',
      thresholds.warningMinutes +
      '–' +
      warningEnd +
      ' นาที'
    );

    setText(
      'thresholdOverdueText',
      thresholds.redMinutes +
      ' นาทีขึ้นไป'
    );

    setText(
      'thresholdAutoCloseText',
      thresholds.autoCloseHours +
      ' ชั่วโมง'
    );

    setText(
      'controlNearAutoCloseLabel',
      'ใกล้ครบ ' +
      thresholds.autoCloseHours +
      ' ชม.'
    );

    setText(
      'timelineAutoCloseLegend',
      'ใกล้ครบ ' +
      thresholds.autoCloseHours +
      ' ชม.'
    );
  }


  async function openThresholdInfo() {
    const thresholds =
      getModuleThresholds();

    const normalEnd =
      Math.max(
        thresholds.greenMinutes,
        thresholds.warningMinutes - 1
      );

    const warningEnd =
      Math.max(
        thresholds.warningMinutes,
        thresholds.redMinutes - 1
      );

    await Swal.fire({
      icon: 'info',
      title: 'เกณฑ์สถานะของโมดูลนี้',
      html: `
        <div class="threshold-info-dialog">
          <div data-status="NORMAL">
            <span>ปกติ</span>
            <strong>${escapeHtml(String(thresholds.greenMinutes))}–${escapeHtml(String(normalEnd))} นาที</strong>
          </div>

          <div data-status="WARNING">
            <span>เฝ้าระวัง</span>
            <strong>${escapeHtml(String(thresholds.warningMinutes))}–${escapeHtml(String(warningEnd))} นาที</strong>
          </div>

          <div data-status="OVERDUE">
            <span>เกินเวลา</span>
            <strong>${escapeHtml(String(thresholds.redMinutes))} นาทีขึ้นไป</strong>
          </div>

          <div data-status="AUTO_CLOSE">
            <span>เคลียร์อัตโนมัติ</span>
            <strong>ครบ ${escapeHtml(String(thresholds.autoCloseHours))} ชั่วโมง</strong>
          </div>

          <p>
            ระบบเริ่มคำนวณจากเวลาเข้าพื้นที่ของแต่ละรายการ
            และใช้เกณฑ์ที่ผู้ดูแลกำหนดแยกตามแต่ละ Module
          </p>
        </div>
      `,
      confirmButtonText: 'ปิด'
    });
  }


  function renderMovementUnavailable() {
    const panel =
      document.getElementById(
        'movementOverview'
      );

    if (!panel) {
      return;
    }

    panel.dataset.state =
      'UNAVAILABLE';

    setText(
      'movementScopeTitle',
      'รอข้อมูลสรุปเข้า–ออก'
    );

    setText(
      'movementScopeTime',
      'ระบบ Active ยังใช้งานได้ตามปกติ'
    );

    setText(
      'movementAnalysisTitle',
      'Movement Summary ยังไม่พร้อม'
    );

    setText(
      'movementAnalysisMessage',
      'ตรวจสอบการติดตั้ง API รอบที่ 15'
    );
  }


  function renderMovementOverview() {
    const panel =
      document.getElementById(
        'movementOverview'
      );

    if (!panel) {
      return;
    }

    document
      .querySelectorAll(
        '[data-movement-scope]'
      )
      .forEach(
        (button) => {
          button.classList.toggle(
            'is-active',
            String(
              button.dataset.movementScope ||
              ''
            ).toUpperCase() ===
            state.movementScope
          );
        }
      );

    const summary =
      state.movementSummary;

    if (!summary) {
      renderMovementUnavailable();
      return;
    }

    const isToday =
      state.movementScope ===
      'TODAY';

    const metric =
      isToday
        ? summary.today
        : summary.currentRound;

    if (!metric) {
      renderMovementUnavailable();
      return;
    }

    const analysis =
      metric.analysis || {};

    panel.dataset.state =
      String(
        analysis.level ||
        'NORMAL'
      ).toUpperCase();

    setText(
      'movementScopeEyebrow',
      isToday
        ? 'TODAY MOVEMENT'
        : 'CURRENT 4-HOUR ROUND'
    );

    setText(
      'movementScopeTitle',
      isToday
        ? 'ภาพรวมวันนี้'
        : (
            metric.label ||
            'รอบปัจจุบัน'
          )
    );

    setText(
      'movementScopeTime',
      isToday
        ? (
            summary.today.date ||
            summary.selectedDate ||
            ''
          )
        : (
            metric.timeLabel ||
            ''
          )
    );

    const remainingWrap =
      document.getElementById(
        'movementRemainingWrap'
      );

    if (remainingWrap) {
      remainingWrap.classList.toggle(
        'is-hidden',
        isToday
      );
    }

    updateMovementCountdown();

    setText(
      'movementIn',
      String(
        Number(metric.in) || 0
      )
    );

    setText(
      'movementOutTotal',
      String(
        Number(metric.outTotal) || 0
      )
    );

    setText(
      'movementTotal',
      String(
        Number(metric.movementTotal) || 0
      )
    );

    setText(
      'movementNet',
      formatSignedNumber(
        metric.net
      )
    );

    setText(
      'movementOutReal',
      String(
        Number(metric.outReal) || 0
      )
    );

    setText(
      'movementOutAuto',
      String(
        Number(metric.outAuto) || 0
      )
    );

    const currentState =
      summary.currentState || {};

    setText(
      'movementActiveNow',
      String(
        Number(currentState.activeNow) ||
        state.records.length ||
        0
      )
    );

    setText(
      'movementOverdueNow',
      String(
        Number(currentState.overdue) ||
        0
      )
    );

    setText(
      'movementAnalysisTitle',
      analysis.title ||
      'กำลังประเมินสถานการณ์'
    );

    setText(
      'movementAnalysisMessage',
      analysis.message ||
      ''
    );

    renderMovementMiniChart();
  }


  function updateMovementCountdown() {
    const element =
      document.getElementById(
        'movementRemaining'
      );

    if (
      !element ||
      state.movementScope ===
        'TODAY'
    ) {
      return;
    }

    const metric =
      state.movementSummary &&
      state.movementSummary.currentRound;

    const endMs =
      Number(
        metric &&
        metric.endEpochMs
      );

    if (!Number.isFinite(endMs)) {
      element.textContent =
        '--:--:--';
      return;
    }

    const remainingSeconds =
      Math.max(
        0,
        Math.floor(
          (
            endMs -
            getCurrentServerTimeMs()
          ) / 1000
        )
      );

    element.textContent =
      formatDurationSeconds(
        remainingSeconds
      );
  }


  function renderMovementMiniChart() {
    const container =
      document.getElementById(
        'movementMiniChart'
      );

    if (!container) {
      return;
    }

    const hours =
      getMovementChartHours();

    if (
      !Array.isArray(hours) ||
      hours.length === 0
    ) {
      container.innerHTML = `
        <div class="movement-chart-empty">
          ยังไม่มีข้อมูลรายชั่วโมง
        </div>
      `;
      return;
    }

    const maximum =
      Math.max(
        1,
        ...hours.map(
          (hour) =>
            Math.max(
              Number(hour.in) || 0,
              Number(hour.outTotal) || 0
            )
        )
      );

    container.innerHTML =
      hours.map(
        (hour) => {
          const inValue =
            Number(hour.in) || 0;

          const outValue =
            Number(hour.outTotal) || 0;

          const inWidth =
            Math.max(
              inValue > 0 ? 7 : 0,
              Math.round(
                inValue /
                maximum *
                100
              )
            );

          const outWidth =
            Math.max(
              outValue > 0 ? 7 : 0,
              Math.round(
                outValue /
                maximum *
                100
              )
            );

          return `
            <div class="movement-chart-row">
              <strong>${escapeHtml(String(hour.label || '--'))}:00</strong>

              <div class="movement-chart-bars">
                <div>
                  <span>เข้า</span>
                  <i style="width:${inWidth}%"></i>
                  <b>${inValue}</b>
                </div>

                <div>
                  <span>ออก</span>
                  <i style="width:${outWidth}%"></i>
                  <b>${outValue}</b>
                </div>
              </div>

              <em>${escapeHtml(formatSignedNumber(hour.net))}</em>
            </div>
          `;
        }
      ).join('');
  }


  function getMovementChartHours() {
    const summary =
      state.movementSummary;

    if (
      !summary ||
      !summary.hours
    ) {
      return [];
    }

    const todayHours =
      Array.isArray(
        summary.hours.today
      )
        ? summary.hours.today
        : [];

    if (
      state.movementScope ===
      'TODAY'
    ) {
      return todayHours;
    }

    const round =
      summary.currentRound || {};

    const startMs =
      Number(round.startEpochMs);

    const endMs =
      Number(round.endEpochMs);

    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs)
    ) {
      return [];
    }

    return todayHours.filter(
      (hour) => {
        const hourStart =
          Number(
            hour.startEpochMs
          );

        return (
          hourStart >= startMs &&
          hourStart < endMs
        );
      }
    );
  }


  function formatSignedNumber(value) {
    const number =
      Number(value) || 0;

    return number > 0
      ? '+' + number
      : String(number);
  }
  function renderSummary() {
    const summary =
      buildLocalSummary(
        state.records
      );

    setText(
      'summaryTotal',
      String(summary.total)
    );

    setText(
      'summaryNormal',
      String(summary.normal)
    );

    setText(
      'summaryWarning',
      String(summary.warning)
    );

    setText(
      'summaryOverdue',
      String(summary.overdue)
    );

    setText(
      'summaryIncomplete',
      String(summary.incomplete)
    );

    setText(
      'controlTotal',
      String(summary.total)
    );

    setText(
      'controlNormal',
      String(summary.normal)
    );

    setText(
      'controlWarning',
      String(summary.warning)
    );

    setText(
      'controlOverdue',
      String(summary.overdue)
    );

    setText(
      'controlNearAutoClose',
      String(summary.nearAutoClose)
    );

    renderWarehouseSituation(
      summary
    );
  }

  function buildLocalSummary(records) {
    const list =
      Array.isArray(records)
        ? records
        : [];

    return {
      total:
        list.length,

      normal:
        list.filter(
          (record) =>
            record.statusCode ===
            'NORMAL'
        ).length,

      warning:
        list.filter(
          (record) =>
            record.statusCode ===
            'WARNING'
        ).length,

      overdue:
        list.filter(
          (record) =>
            record.statusCode ===
            'OVERDUE'
        ).length,

      incomplete:
        list.filter(
          (record) =>
            record.statusCode ===
              'INCOMPLETE' ||
            record.isIncomplete
        ).length,

      nearAutoClose:
        list.filter(
          (record) =>
            record.isNearAutoClose
        ).length
    };
  }

  function applyFiltersAndRender() {
    const searchText =
      state.searchText;

    const statusFilter =
      state.statusFilter;

    state.filteredRecords =
      state.records.filter(
        (record) => {
          if (
            statusFilter !== 'ALL' &&
            record.statusCode !==
              statusFilter
          ) {
            return false;
          }

          if (
            !recordMatchesTimeline(
              record
            )
          ) {
            return false;
          }

          if (!searchText) {
            return true;
          }

          const haystack =
            String(
              record.searchText ||
              [
                record.primaryValue,
                record.timestampIn,
                record.statusLabel,
                record.priorityText,
                ...(Array.isArray(record.fields)
                  ? record.fields.map(
                      (field) =>
                        field.value
                    )
                  : [])
              ]
                .filter(Boolean)
                .join(' ')
            ).toLowerCase();

          return haystack.includes(
            searchText
          );
        }
      );

    sortRecords(
      state.filteredRecords
    );

    renderVehicleCards(
      state.filteredRecords
    );

    setText(
      'resultCount',
      state.filteredRecords.length +
      ' รายการ'
    );

    updateActiveFilterText();
  }

  function sortRecords(records) {
    records.sort(
      (left, right) => {
        const leftScore =
          Number.isFinite(
            Number(
              left.priorityScore
            )
          )
            ? Number(
                left.priorityScore
              )
            : 999999999999;

        const rightScore =
          Number.isFinite(
            Number(
              right.priorityScore
            )
          )
            ? Number(
                right.priorityScore
              )
            : 999999999999;

        if (
          leftScore !==
          rightScore
        ) {
          return (
            leftScore -
            rightScore
          );
        }

        return (
          Number(
            left.timestampInEpochMs
          ) || 0
        ) - (
          Number(
            right.timestampInEpochMs
          ) || 0
        );
      }
    );
  }



  function renderWarehouseSituation(
    summary
  ) {
    const element =
      document.getElementById(
        'warehouseSituation'
      );

    if (!element) {
      return;
    }

    let stateCode =
      'NORMAL';

    let label =
      'สถานการณ์ปกติ';

    let message =
      'ยังไม่มีรายการที่ต้องเร่งดำเนินการ';

    if (
      summary.nearAutoClose > 0
    ) {
      stateCode =
        'AUTO_CLOSE';

      label =
        'มีรายการค้างนาน';

      message =
        summary.nearAutoClose +
        ' รายการใกล้ครบ ' +
        getModuleThresholds().autoCloseHours +
        ' ชั่วโมง';

    } else if (
      summary.overdue > 0
    ) {
      stateCode =
        'CRITICAL';

      label =
        'ต้องเร่งดำเนินการ';

      message =
        summary.overdue +
        ' รายการเกินเกณฑ์ของโมดูล';

    } else if (
      summary.warning > 0
    ) {
      stateCode =
        'WATCH';

      label =
        'ต้องติดตามใกล้ชิด';

      message =
        summary.warning +
        ' รายการใกล้เกินเวลา';

    } else if (
      summary.incomplete > 0
    ) {
      stateCode =
        'DATA';

      label =
        'ต้องตรวจสอบข้อมูล';

      message =
        summary.incomplete +
        ' รายการมีข้อมูลไม่สมบูรณ์';
    }

    element.dataset.state =
      stateCode;

    setText(
      'situationLabel',
      label
    );

    setText(
      'situationMessage',
      message
    );
  }


  function renderTimeline() {
    const container =
      document.getElementById(
        'hourlyTimeline'
      );

    if (!container) {
      return;
    }

    document
      .querySelectorAll(
        '[data-timeline-mode]'
      )
      .forEach(
        (button) => {
          button.classList.toggle(
            'is-active',
            String(
              button.dataset.timelineMode ||
              ''
            ).toUpperCase() ===
            state.timelineMode
          );
        }
      );

    const slots =
      buildTimelineSlots();

    container.innerHTML =
      slots.map(
        (slot) => {
          const selected =
            state.selectedTimelineStartMs ===
            slot.startMs;

          return `
            <button
              type="button"
              class="timeline-hour timeline-hour--movement${selected ? ' is-selected' : ''}${slot.isCurrent ? ' is-current' : ''}"
              data-hour-start-ms="${slot.startMs}"
              data-hour-end-ms="${slot.endMs}"
              data-hour-label="${escapeHtml(slot.fullLabel)}"
              data-in="${slot.in}"
              data-out="${slot.outTotal}"
              data-out-real="${slot.outReal}"
              data-out-auto="${slot.outAuto}"
              data-net="${slot.net}"
              data-movement-total="${slot.movementTotal}"
              data-status="${escapeHtml(slot.statusCode)}"
              aria-pressed="${selected ? 'true' : 'false'}"
            >
              <span class="timeline-hour__time">${escapeHtml(slot.label)}</span>

              <div class="timeline-hour__movement">
                <span>
                  <small>เข้า</small>
                  <strong>${slot.in}</strong>
                </span>

                <span>
                  <small>ออก</small>
                  <strong>${slot.outTotal}</strong>
                </span>
              </div>

              <div class="timeline-hour__net">
                สุทธิ
                <strong>${escapeHtml(formatSignedNumber(slot.net))}</strong>
              </div>

              <small class="timeline-hour__caption">${escapeHtml(slot.caption)}</small>
              <i aria-hidden="true"></i>
            </button>
          `;
        }
      ).join('');

    const clearButton =
      document.getElementById(
        'timelineClearButton'
      );

    if (clearButton) {
      clearButton.classList.toggle(
        'is-hidden',
        state.selectedTimelineStartMs ===
          null
      );
    }

    window.requestAnimationFrame(
      () => {
        updateTimelineCenterEffect(
          container
        );
      }
    );

    if (
      state.timelineShouldFocus
    ) {
      state.timelineShouldFocus =
        false;

      window.requestAnimationFrame(
        () => {
          const target =
            container.querySelector(
              '.timeline-hour.is-current'
            ) ||
            container.lastElementChild;

          target &&
            target.scrollIntoView({
              behavior: 'auto',
              block: 'nearest',
              inline: 'center'
            });

          window.requestAnimationFrame(
            () => {
              updateTimelineCenterEffect(
                container
              );
            }
          );
        }
      );
    }
  }


  function scheduleTimelineCenterEffect(
    container
  ) {
    if (
      state.timelineScrollRaf
    ) {
      window.cancelAnimationFrame(
        state.timelineScrollRaf
      );
    }

    state.timelineScrollRaf =
      window.requestAnimationFrame(
        () => {
          state.timelineScrollRaf =
            null;

          updateTimelineCenterEffect(
            container
          );
        }
      );
  }


  function updateTimelineCenterEffect(
    container
  ) {
    if (!container) {
      return;
    }

    const items =
      Array.from(
        container.querySelectorAll(
          '.timeline-hour'
        )
      );

    if (
      items.length === 0
    ) {
      return;
    }

    const containerRect =
      container.getBoundingClientRect();

    const centerX =
      containerRect.left +
      containerRect.width / 2;

    const maximumDistance =
      Math.max(
        1,
        containerRect.width * 0.46
      );

    let nearestItem =
      null;

    let nearestDistance =
      Number.POSITIVE_INFINITY;

    items.forEach(
      (item) => {
        const rect =
          item.getBoundingClientRect();

        const itemCenter =
          rect.left +
          rect.width / 2;

        const distance =
          Math.abs(
            itemCenter -
            centerX
          );

        const proximity =
          1 -
          Math.min(
            1,
            distance /
            maximumDistance
          );

        const eased =
          proximity *
          proximity;

        /*
         * High Contrast Carousel
         * การ์ดด้านข้างยังต้องอ่านได้ ไม่ย่อหรือจางมากเกินไป
         */
        const scale =
          0.72 +
          eased * 0.50;

        const opacity =
          0.58 +
          proximity * 0.42;

        const blur =
          Math.max(
            0,
            (
              1 - proximity
            ) * 0.20
          );

        const lift =
          eased * -10;

        item.style.setProperty(
          '--timeline-focus-scale',
          scale.toFixed(3)
        );

        item.style.setProperty(
          '--timeline-focus-opacity',
          opacity.toFixed(3)
        );

        item.style.setProperty(
          '--timeline-focus-blur',
          blur.toFixed(2) + 'px'
        );

        item.style.setProperty(
          '--timeline-focus-lift',
          lift.toFixed(1) + 'px'
        );

        item.style.zIndex =
          String(
            Math.round(
              proximity * 20
            )
          );

        item.classList.remove(
          'is-centered'
        );

        if (
          distance <
          nearestDistance
        ) {
          nearestDistance =
            distance;

          nearestItem =
            item;
        }
      }
    );

    if (nearestItem) {
      nearestItem.classList.add(
        'is-centered'
      );

      state.timelineFocusedStartMs =
        Number(
          nearestItem.dataset.hourStartMs
        );

      renderTimelineFocusPreviewFromElement(
        nearestItem
      );
    }
  }


  function renderTimelineFocusPreviewFromElement(
    element
  ) {
    if (!element) {
      return;
    }

    setText(
      'timelineFocusLabel',
      element.dataset.hourLabel ||
      '--:00–--:59'
    );

    setText(
      'timelineFocusIn',
      element.dataset.in ||
      '0'
    );

    setText(
      'timelineFocusOut',
      element.dataset.out ||
      '0'
    );

    setText(
      'timelineFocusNet',
      formatSignedNumber(
        element.dataset.net
      )
    );

    setText(
      'timelineFocusMovement',
      element.dataset.movementTotal ||
      '0'
    );

    setText(
      'timelineFocusOutDetail',
      'ออกจริง ' +
      (
        element.dataset.outReal ||
        '0'
      ) +
      ' • ระบบปิด ' +
      (
        element.dataset.outAuto ||
        '0'
      )
    );

    const preview =
      document.getElementById(
        'timelineFocusPreview'
      );

    if (preview) {
      preview.dataset.status =
        element.dataset.status ||
        'EMPTY';
    }

    const applyButton =
      document.getElementById(
        'timelineApplyFilterButton'
      );

    if (applyButton) {
      const focusedStart =
        Number(
          element.dataset.hourStartMs
        );

      applyButton.textContent =
        state.selectedTimelineStartMs ===
          focusedStart
          ? 'กำลังกรองชั่วโมงนี้'
          : 'กรองรายการชั่วโมงนี้';
    }
  }



  function scheduleTimelineCenterSnap(
    container
  ) {
    if (
      state.timelineSnapTimer
    ) {
      window.clearTimeout(
        state.timelineSnapTimer
      );
    }

    state.timelineSnapTimer =
      window.setTimeout(
        () => {
          state.timelineSnapTimer =
            null;

          if (
            !container ||
            state.destroyed ||
            container.scrollWidth <=
              container.clientWidth + 4
          ) {
            return;
          }

          const centered =
            container.querySelector(
              '.timeline-hour.is-centered'
            );

          centered &&
            centered.scrollIntoView({
              behavior: 'smooth',
              block: 'nearest',
              inline: 'center'
            });
        },
        135
      );
  }



  function buildTimelineSlots() {
    const summary =
      state.movementSummary;

    const movementHours =
      summary &&
      summary.hours
        ? (
            state.timelineMode ===
              'TODAY'
              ? summary.hours.today
              : summary.hours.rolling24
          )
        : null;

    if (
      Array.isArray(movementHours) &&
      movementHours.length > 0
    ) {
      const currentHourStart =
        getBangkokHourStartMs(
          getCurrentServerTimeMs()
        );

      return movementHours.map(
        (hour) => {
          const startMs =
            Number(
              hour.startEpochMs
            ) ||
            parseBangkokDateTime(
              hour.start
            )?.getTime() ||
            0;

          const endMs =
            Number(
              hour.endEpochMs
            ) ||
            (
              startMs +
              60 * 60 * 1000
            );

          const inValue =
            Number(hour.in) || 0;

          const outReal =
            Number(hour.outReal) || 0;

          const outAuto =
            Number(hour.outAuto) || 0;

          const outTotal =
            Number(hour.outTotal) ||
            outReal + outAuto;

          const movementTotal =
            Number(hour.movementTotal) ||
            inValue + outTotal;

          const net =
            Number(hour.net) ||
            inValue - outTotal;

          return {
            startMs,
            endMs,
            label:
              String(
                hour.label ||
                getBangkokDateParts(
                  startMs
                ).hour
              ).padStart(2, '0'),
            fullLabel:
              formatTimelineRange(
                startMs
              ),
            in: inValue,
            outReal,
            outAuto,
            outTotal,
            movementTotal,
            net,
            total: movementTotal,
            activeNow:
              Number(hour.activeNow) || 0,
            statusCode:
              String(
                hour.statusCode ||
                'EMPTY'
              ).toUpperCase(),
            isCurrent:
              startMs ===
              currentHourStart,
            caption:
              movementTotal > 0
                ? 'รวม ' +
                  movementTotal +
                  ' ครั้ง'
                : 'ไม่มีการเคลื่อนไหว'
          };
        }
      );
    }

    return buildFallbackTimelineSlots();
  }




  function buildFallbackTimelineSlots() {
    const nowMs =
      getCurrentServerTimeMs();

    const currentHourStart =
      getBangkokHourStartMs(
        nowMs
      );

    const slots = [];

    if (
      state.timelineMode ===
      'TODAY'
    ) {
      const dayStart =
        getBangkokDayStartMs(
          nowMs
        );

      for (
        let hour = 0;
        hour < 24;
        hour += 1
      ) {
        const startMs =
          dayStart +
          hour * 60 * 60 * 1000;

        slots.push(
          buildTimelineSlot(
            startMs,
            String(hour).padStart(
              2,
              '0'
            )
          )
        );
      }

    } else {
      for (
        let offset = 23;
        offset >= 0;
        offset -= 1
      ) {
        const startMs =
          currentHourStart -
          offset * 60 * 60 * 1000;

        slots.push(
          buildTimelineSlot(
            startMs,
            getBangkokDateParts(
              startMs
            ).hour
          )
        );
      }
    }

    return slots;
  }
  function buildTimelineSlot(
    startMs,
    label
  ) {
    const endMs =
      startMs +
      60 * 60 * 1000;

    const records =
      state.records.filter(
        (record) => {
          const timestamp =
            getRecordTimestampInMs(
              record
            );

          return (
            timestamp >= startMs &&
            timestamp < endMs
          );
        }
      );

    const summary =
      buildLocalSummary(records);

    let statusCode =
      'EMPTY';

    if (
      summary.nearAutoClose > 0
    ) {
      statusCode =
        'AUTO_CLOSE';

    } else if (
      summary.overdue > 0
    ) {
      statusCode =
        'OVERDUE';

    } else if (
      summary.warning > 0
    ) {
      statusCode =
        'WARNING';

    } else if (
      summary.normal > 0
    ) {
      statusCode =
        'NORMAL';

    } else if (
      summary.incomplete > 0
    ) {
      statusCode =
        'INCOMPLETE';
    }

    const currentHourStart =
      getBangkokHourStartMs(
        getCurrentServerTimeMs()
      );

    return {
      startMs,
      endMs,
      label,
      fullLabel:
        formatTimelineRange(
          startMs
        ),
      in: records.length,
      outReal: 0,
      outAuto: 0,
      outTotal: 0,
      movementTotal:
        records.length,
      net:
        records.length,
      total:
        records.length,
      activeNow:
        records.length,
      statusCode,
      isCurrent:
        startMs ===
        currentHourStart,
      caption:
        records.length > 0
          ? 'Active ' +
            records.length
          : 'ไม่มีรายการ'
    };
  }


  function recordMatchesTimeline(
    record
  ) {
    if (
      state.selectedTimelineStartMs ===
      null
    ) {
      return true;
    }

    const timestamp =
      getRecordTimestampInMs(
        record
      );

    return (
      timestamp >=
        state.selectedTimelineStartMs &&
      timestamp <
        state.selectedTimelineStartMs +
        60 * 60 * 1000
    );
  }


  function updateActiveFilterText() {
    const element =
      document.getElementById(
        'activeTimelineFilter'
      );

    if (!element) {
      return;
    }

    if (
      state.selectedTimelineStartMs ===
      null
    ) {
      element.textContent =
        'แสดงทุกชั่วโมง';

      return;
    }

    element.textContent =
      'กรองเวลาเข้า ' +
      formatTimelineRange(
        state.selectedTimelineStartMs
      );
  }


  function getRecordTimestampInMs(
    record
  ) {
    const epoch =
      Number(
        record &&
        record.timestampInEpochMs
      );

    if (
      Number.isFinite(epoch)
    ) {
      return epoch;
    }

    const parsed =
      parseBangkokDateTime(
        record &&
        record.timestampIn
      );

    return parsed
      ? parsed.getTime()
      : 0;
  }


  function getBangkokDateParts(
    timestampMs
  ) {
    const formatter =
      new Intl.DateTimeFormat(
        'en-GB',
        {
          timeZone:
            CONFIG.TIMEZONE ||
            'Asia/Bangkok',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23'
        }
      );

    const result = {};

    formatter
      .formatToParts(
        new Date(timestampMs)
      )
      .forEach(
        (part) => {
          result[part.type] =
            part.value;
        }
      );

    return result;
  }


  function getBangkokHourStartMs(
    timestampMs
  ) {
    const parts =
      getBangkokDateParts(
        timestampMs
      );

    return new Date(
      parts.year +
      '-' +
      parts.month +
      '-' +
      parts.day +
      'T' +
      parts.hour +
      ':00:00+07:00'
    ).getTime();
  }


  function getBangkokDayStartMs(
    timestampMs
  ) {
    const parts =
      getBangkokDateParts(
        timestampMs
      );

    return new Date(
      parts.year +
      '-' +
      parts.month +
      '-' +
      parts.day +
      'T00:00:00+07:00'
    ).getTime();
  }


  function formatTimelineHourLabel(
    timestampMs,
    current
  ) {
    const parts =
      getBangkokDateParts(
        timestampMs
      );

    return current
      ? 'ตอนนี้ ' +
        parts.hour
      : parts.hour;
  }


  function formatTimelineRange(
    startMs
  ) {
    const parts =
      getBangkokDateParts(
        startMs
      );

    return (
      parts.day +
      '/' +
      parts.month +
      ' ' +
      parts.hour +
      ':00–' +
      parts.hour +
      ':59'
    );
  }
  function renderVehicleCards(records) {
    const container =
      document.getElementById(
        'vehicleList'
      );

    const emptyState =
      document.getElementById(
        'vehicleEmpty'
      );

    if (!container) {
      return;
    }

    state.cardNodes.clear();
    container.innerHTML = '';

    if (
      !records ||
      records.length === 0
    ) {
      emptyState &&
        emptyState.classList.remove(
          'is-hidden'
        );

      return;
    }

    emptyState &&
      emptyState.classList.add(
        'is-hidden'
      );

    const fragment =
      document.createDocumentFragment();

    records.forEach(
      (record, index) => {
        const result =
          createVehicleCard(
            record,
            index
          );

        fragment.appendChild(
          result.element
        );

        state.cardNodes.set(
          record.recordId,
          result.nodes
        );
      }
    );

    container.appendChild(
      fragment
    );
  }



  function normalizeBooleanFlag(
    value
  ) {
    if (value === true) {
      return true;
    }

    const text =
      String(
        value === null ||
        value === undefined
          ? ''
          : value
      )
        .trim()
        .toUpperCase();

    return [
      'TRUE',
      '1',
      'YES',
      'Y',
      'ON'
    ].includes(text);
  }


  function isPrimaryField(
    field
  ) {
    if (!field) {
      return false;
    }

    return (
      normalizeBooleanFlag(
        field.primary
      ) ||
      normalizeBooleanFlag(
        field.isPrimary
      ) ||
      normalizeBooleanFlag(
        field.isPrimaryField
      ) ||
      String(
        field.role || ''
      ).trim().toUpperCase() ===
        'PRIMARY'
    );
  }


  function getPrimaryField(
    record
  ) {
    const fields =
      Array.isArray(
        record &&
        record.fields
      )
        ? record.fields
        : [];

    return (
      fields.find(
        (field) =>
          isPrimaryField(field)
      ) ||
      null
    );
  }


  function getPrimaryLabel(
    record
  ) {
    const primaryField =
      getPrimaryField(record);

    return String(
      record &&
      (
        record.primaryLabel ||
        record.primaryDisplayName
      ) ||
      primaryField &&
      (
        primaryField.label ||
        primaryField.displayName ||
        primaryField.name
      ) ||
      'ข้อมูลหลัก'
    ).trim();
  }


  function normalizeComparableText(
    value
  ) {
    return String(
      value === null ||
      value === undefined
        ? ''
        : value
    )
      .trim()
      .replace(
        /\s+/g,
        ' '
      )
      .toLowerCase();
  }


  function normalizeFieldLabel(
    value
  ) {
    return normalizeComparableText(
      value
    )
      .replace(
        /[\s_\-:]+/g,
        ''
      );
  }


  function isTimestampInField(
    field,
    record
  ) {
    const label =
      normalizeFieldLabel(
        field &&
        (
          field.label ||
          field.displayName ||
          field.name
        )
      );

    const value =
      normalizeComparableText(
        field &&
        field.value
      );

    const timestampIn =
      normalizeComparableText(
        record &&
        record.timestampIn
      );

    const aliases = [
      'เวลาเข้าพื้นที่',
      'เวลาเข้า',
      'timestampin',
      'intimestamp',
      'checkintime'
    ];

    return (
      aliases.includes(label) ||
      (
        timestampIn &&
        value === timestampIn &&
        (
          label.includes('เวลาเข้า') ||
          label.includes('timestampin')
        )
      )
    );
  }


  function getDisplayFields(
    record,
    options
  ) {
    const config =
      options &&
      typeof options === 'object'
        ? options
        : {};

    const fields =
      Array.isArray(
        record &&
        record.fields
      )
        ? record.fields
        : [];

    const primaryValue =
      normalizeComparableText(
        record &&
        record.primaryValue
      );

    const unique =
      new Set();

    return fields
      .filter(
        (field) => {
          if (
            !field ||
            !String(
              field.value || ''
            ).trim()
          ) {
            return false;
          }

          if (
            isPrimaryField(field)
          ) {
            return false;
          }

          const fieldValue =
            normalizeComparableText(
              field.value
            );

          /*
           * ป้องกันข้อมูลหลักกลับมาแสดงซ้ำ
           * แม้ Backend รุ่นเก่าจะไม่ได้ส่ง primary=true
           */
          if (
            primaryValue &&
            fieldValue ===
              primaryValue
          ) {
            return false;
          }

          if (
            config.excludeTimestampIn !==
              false &&
            isTimestampInField(
              field,
              record
            )
          ) {
            return false;
          }

          const label =
            String(
              field.label ||
              field.displayName ||
              field.name ||
              '-'
            ).trim();

          const uniqueKey =
            normalizeFieldLabel(label) +
            '|' +
            fieldValue;

          if (
            unique.has(
              uniqueKey
            )
          ) {
            return false;
          }

          unique.add(
            uniqueKey
          );

          return true;
        }
      )
      .sort(
        (left, right) =>
          Number(
            left.order ||
            left.position ||
            0
          ) -
          Number(
            right.order ||
            right.position ||
            0
          )
      );
  }
  function createVehicleCard(
    record,
    index
  ) {
    const article =
      document.createElement(
        'article'
      );

    article.className =
      'vehicle-card vehicle-card--professional';

    article.dataset.status =
      record.statusCode ||
      'INCOMPLETE';

    article.dataset.recordId =
      record.recordId || '';

    article.dataset.nearAutoClose =
      record.isNearAutoClose
        ? 'TRUE'
        : 'FALSE';

    article.tabIndex =
      0;

    article.setAttribute(
      'role',
      'button'
    );

    article.setAttribute(
      'aria-label',
      'ดูรายละเอียด ' +
      (
        record.primaryValue ||
        'รายการรถ'
      )
    );

    const statusRail =
      document.createElement(
        'div'
      );

    statusRail.className =
      'vehicle-card__rail';

    const rank =
      document.createElement(
        'span'
      );

    rank.className =
      'vehicle-card__rank';

    rank.textContent =
      index < 3
        ? 'เร่งด่วน ' +
          (index + 1)
        : 'ลำดับ ' +
          (index + 1);

    const header =
      document.createElement(
        'div'
      );

    header.className =
      'vehicle-card__header';

    const titleWrap =
      document.createElement(
        'div'
      );

    titleWrap.className =
      'vehicle-card__title-wrap';

    const primaryLabel =
      document.createElement(
        'span'
      );

    primaryLabel.className =
      'vehicle-card__primary-label';

    primaryLabel.textContent =
      getPrimaryLabel(record);

    const title =
      document.createElement(
        'h2'
      );

    title.className =
      'vehicle-card__title';

    title.textContent =
      record.primaryValue ||
      'ไม่พบข้อมูลหลัก';

    const statusLine =
      document.createElement(
        'div'
      );

    statusLine.className =
      'vehicle-card__status-line';

    const statusBadge =
      document.createElement(
        'span'
      );

    statusBadge.className =
      'vehicle-status-badge';

    statusBadge.dataset.status =
      record.statusCode ||
      'INCOMPLETE';

    statusBadge.textContent =
      record.statusLabel ||
      'ไม่ทราบสถานะ';

    const timer =
      document.createElement(
        'strong'
      );

    timer.className =
      'vehicle-card__timer';

    timer.textContent =
      record.durationDisplay ||
      '--:--:--';

    statusLine.appendChild(
      statusBadge
    );

    statusLine.appendChild(
      timer
    );

    titleWrap.appendChild(
      primaryLabel
    );

    titleWrap.appendChild(
      title
    );

    titleWrap.appendChild(
      statusLine
    );

    header.appendChild(
      titleWrap
    );

    const progress =
      document.createElement(
        'div'
      );

    progress.className =
      'vehicle-progress';

    const progressTrack =
      document.createElement(
        'div'
      );

    progressTrack.className =
      'vehicle-progress__track';

    const progressFill =
      document.createElement(
        'div'
      );

    progressFill.className =
      'vehicle-progress__fill';

    progressFill.style.width =
      Math.max(
        0,
        Math.min(
          100,
          Number(
            record.progressPercent
          ) || 0
        )
      ) + '%';

    const warningMarker =
      document.createElement(
        'span'
      );

    warningMarker.className =
      'vehicle-progress__marker';

    warningMarker.style.left =
      Math.max(
        0,
        Math.min(
          100,
          Number(
            record.warningMarkerPercent
          ) || 0
        )
      ) + '%';

    progressTrack.appendChild(
      progressFill
    );

    progressTrack.appendChild(
      warningMarker
    );

    const progressLabels =
      document.createElement(
        'div'
      );

    progressLabels.className =
      'vehicle-progress__labels';

    const thresholds =
      getModuleThresholds();

    progressLabels.innerHTML = `
      <span>0</span>
      <span>ส้ม ${escapeHtml(String(thresholds.warningMinutes))} นาที</span>
      <span>แดง ${escapeHtml(String(thresholds.redMinutes))} นาที</span>
    `;

    progress.appendChild(
      progressTrack
    );

    progress.appendChild(
      progressLabels
    );

    const priorityText =
      document.createElement(
        'p'
      );

    priorityText.className =
      'vehicle-card__priority-text';

    priorityText.textContent =
      record.priorityText ||
      'กำลังประเมินสถานะ';

    const detailGrid =
      document.createElement(
        'div'
      );

    detailGrid.className =
      'vehicle-detail-grid';

    getDisplayFields(
      record,
      {
        excludeTimestampIn: true
      }
    )
      .slice(0, 4)
      .forEach(
        (field) => {
          detailGrid.appendChild(
            createFieldElement(field)
          );
        }
      );

    const footer =
      document.createElement(
        'div'
      );

    footer.className =
      'vehicle-card__footer';

    const inTime =
      document.createElement(
        'div'
      );

    inTime.className =
      'vehicle-in-time';

    const inTimeLabel =
      document.createElement(
        'span'
      );

    inTimeLabel.textContent =
      'เวลาเข้าพื้นที่';

    const inTimeValue =
      document.createElement(
        'strong'
      );

    inTimeValue.textContent =
      record.timestampIn ||
      'ไม่พบข้อมูล';

    inTime.appendChild(
      inTimeLabel
    );

    inTime.appendChild(
      inTimeValue
    );

    footer.appendChild(
      inTime
    );

    if (
      record.canCheckout &&
      isAdmin()
    ) {
      const checkoutButton =
        document.createElement(
          'button'
        );

      checkoutButton.type =
        'button';

      checkoutButton.className =
        'button button--checkout';

      checkoutButton.textContent =
        'บันทึกออกพื้นที่';

      checkoutButton.addEventListener(
        'click',
        (event) => {
          event.stopPropagation();

          handleCheckout(
            record,
            checkoutButton
          );
        }
      );

      footer.appendChild(
        checkoutButton
      );
    }

    article.appendChild(
      statusRail
    );

    article.appendChild(
      rank
    );

    article.appendChild(
      header
    );

    article.appendChild(
      progress
    );

    article.appendChild(
      priorityText
    );

    if (
      detailGrid.childElementCount > 0
    ) {
      article.appendChild(
        detailGrid
      );
    }

    article.appendChild(
      footer
    );

    const openDetails =
      (event) => {
        if (
          event &&
          event.target.closest(
            'button, a, input, select'
          )
        ) {
          return;
        }

        openRecordDetail(
          record
        );
      };

    article.addEventListener(
      'click',
      openDetails
    );

    article.addEventListener(
      'keydown',
      (event) => {
        if (
          event.key === 'Enter' ||
          event.key === ' '
        ) {
          event.preventDefault();
          openRecordDetail(record);
        }
      }
    );

    return {
      element: article,
      nodes: {
        card: article,
        timer,
        statusBadge,
        progressFill,
        priorityText
      }
    };
  }

  function createFieldElement(field) {
    const item = document.createElement('div');
    item.className = 'vehicle-field';

    const label = document.createElement('span');
    label.textContent = field.label || '-';
    item.appendChild(label);

    if (field.type === 'PHONE') {
      const link = document.createElement('a');
      link.href =
        'tel:' +
        sanitizePhone(field.value);
      link.textContent = field.value;
      item.appendChild(link);
      return item;
    }

    const value = document.createElement('strong');
    value.textContent = field.value;
    item.appendChild(value);

    return item;
  }



  function openRecordDetail(record) {
    const primaryLabel =
      getPrimaryLabel(record);

    const fieldHtml =
      getDisplayFields(
        record,
        {
          excludeTimestampIn: true
        }
      )
        .map(
          (field) => `
            <div class="record-detail-row">
              <span>${escapeHtml(field.label || field.displayName || '-')}</span>
              <strong>${escapeHtml(field.value || '-')}</strong>
            </div>
          `
        )
        .join('');

    Swal.fire({
      width: 620,
      title:
        record.primaryValue ||
        'รายละเอียดรายการ',
      html: `
        <div class="record-primary-caption">
          ${escapeHtml(primaryLabel)}
        </div>

        <div class="record-detail-dialog" data-status="${escapeHtml(record.statusCode || 'INCOMPLETE')}">
          <div class="record-detail-summary">
            <span>${escapeHtml(record.statusLabel || '-')}</span>
            <strong>${escapeHtml(record.durationDisplay || '--:--:--')}</strong>
            <small>${escapeHtml(record.priorityText || '')}</small>
          </div>

          <div class="record-detail-row">
            <span>เวลาเข้าพื้นที่</span>
            <strong>${escapeHtml(record.timestampIn || '-')}</strong>
          </div>

          ${fieldHtml}
        </div>
      `,
      confirmButtonText: 'ปิด'
    });
  }

  /************************************************************
   * Dynamic Overdue App Badge
   *
   * ตัวเลข = รายการเกินเวลาสะสมทั้งหมดที่:
   * - ยังอยู่ในพื้นที่
   * - ยังไม่มี Timestamp Out
   * - ข้ามเกณฑ์ OVERDUE ของโมดูลแล้ว
   *
   * ไม่รีเซ็ตเมื่อเปลี่ยนชั่วโมง
   ************************************************************/

  function initializeOverdueBadgeSystem() {
    state.baseDocumentTitle =
      String(document.title || '')
        .replace(
          /^\(\d+\+?\)\s*/,
          ''
        )
        .trim() ||
      'สถานะรถ';

    const icon = new Image();

    icon.decoding = 'async';

    icon.addEventListener(
      'load',
      () => {
        state.badgeIconReady = true;
        updateDynamicFavicon(
          Math.max(
            0,
            Number(
              state.overdueBadgeCount
            ) || 0
          )
        );
      },
      {
        once: true
      }
    );

    icon.addEventListener(
      'error',
      () => {
        state.badgeIconReady = false;
      },
      {
        once: true
      }
    );

    icon.src =
      OVERDUE_BADGE_ICON_URL;

    state.badgeIconImage =
      icon;

    updateOverdueBadgePresentation(
      true
    );
  }


  function updateOverdueBadgePresentation(
    force
  ) {
    const count =
      calculateAccumulatedOverdueCount();

    if (
      force !== true &&
      count ===
        state.overdueBadgeCount
    ) {
      return;
    }

    state.overdueBadgeCount =
      count;

    updateVisibleOverdueBadge(
      count
    );

    updateDocumentTitleBadge(
      count
    );

    updateDynamicFavicon(
      count
    );

    void updateSystemAppBadge(
      count
    );
  }


  function calculateAccumulatedOverdueCount() {
    const records =
      Array.isArray(
        state.badgeRecords
      )
        ? state.badgeRecords
        : [];

    return records.filter(
      isAccumulatedOverdueRecord
    ).length;
  }


  function isAccumulatedOverdueRecord(
    record
  ) {
    if (!record) {
      return false;
    }

    if (
      record.isCurrentlyInArea !==
      true
    ) {
      return false;
    }

    if (
      recordHasTimestampOut(
        record
      )
    ) {
      return false;
    }

    return (
      record.statusCode ===
        'OVERDUE' ||
      record.isOverdue === true
    );
  }


  function recordHasTimestampOut(
    record
  ) {
    const directValues = [
      record.timestampOut,
      record.timestampOutDisplay,
      record.timestampOutEpochMs
    ];

    if (
      directValues.some(
        hasMeaningfulTimestampValue
      )
    ) {
      return true;
    }

    const fields =
      Array.isArray(
        record.fields
      )
        ? record.fields
        : [];

    return fields.some(
      (field) => {
        const label =
          String(
            field &&
            (
              field.label ||
              field.name ||
              field.id ||
              ''
            )
          )
            .trim()
            .toLowerCase();

        const isOutField =
          label ===
            'timestamp out' ||
          label.includes(
            'timestamp out'
          ) ||
          label.includes(
            'เวลาออก'
          );

        return (
          isOutField &&
          hasMeaningfulTimestampValue(
            field && field.value
          )
        );
      }
    );
  }


  function hasMeaningfulTimestampValue(
    value
  ) {
    if (
      value instanceof Date &&
      !Number.isNaN(
        value.getTime()
      )
    ) {
      return true;
    }

    if (
      typeof value ===
      'number'
    ) {
      return (
        Number.isFinite(value) &&
        value > 0
      );
    }

    const text =
      String(
        value === null ||
        value === undefined
          ? ''
          : value
      )
        .trim()
        .toLowerCase();

    if (!text) {
      return false;
    }

    return ![
      '-',
      '--',
      'null',
      'undefined',
      'ยังไม่มีข้อมูล',
      'ไม่มีข้อมูล'
    ].includes(text);
  }


  function updateVisibleOverdueBadge(
    count
  ) {
    const container =
      document.getElementById(
        'overdueAppBadge'
      );

    const countElement =
      document.getElementById(
        'overdueAppBadgeCount'
      );

    if (countElement) {
      countElement.textContent =
        count > 99
          ? '99+'
          : String(count);
    }

    if (container) {
      container.dataset.count =
        String(count);

      container.classList.toggle(
        'is-zero',
        count <= 0
      );

      container.setAttribute(
        'aria-label',
        count > 0
          ? (
              'มีตู้เกินเวลาสะสม ' +
              count +
              ' ตู้ที่ยังไม่มีเวลาออก'
            )
          : 'ไม่มีตู้เกินเวลาค้าง'
      );
    }
  }


  function updateDocumentTitleBadge(
    count
  ) {
    const baseTitle =
      String(
        state.baseDocumentTitle ||
        document.title ||
        'สถานะรถ'
      )
        .replace(
          /^\(\d+\+?\)\s*/,
          ''
        )
        .trim();

    document.title =
      count > 0
        ? (
            '(' +
            (
              count > 99
                ? '99+'
                : count
            ) +
            ') ' +
            baseTitle
          )
        : baseTitle;
  }


  async function updateSystemAppBadge(
    count
  ) {
    try {
      if (
        count > 0 &&
        typeof navigator.setAppBadge ===
          'function'
      ) {
        await navigator.setAppBadge(
          count
        );

        return;
      }

      if (
        count <= 0 &&
        typeof navigator.clearAppBadge ===
          'function'
      ) {
        await navigator.clearAppBadge();
      }

    } catch (error) {
      /*
       * บาง Browser ไม่รองรับหรือจำกัดสิทธิ์
       * ระบบยังคงแสดง favicon และชื่อแท็บได้
       */
      console.debug(
        'App Badge ไม่พร้อม',
        error
      );
    }
  }


  function ensureDynamicFaviconLink() {
    let link =
      document.getElementById(
        'dynamicFavicon'
      );

    if (!link) {
      link =
        document.createElement(
          'link'
        );

      link.id =
        'dynamicFavicon';

      link.rel =
        'icon';

      link.type =
        'image/png';

      document.head.appendChild(
        link
      );
    }

    return link;
  }


  function updateDynamicFavicon(
    count
  ) {
    const size =
      OVERDUE_BADGE_FAVICON_SIZE;

    const canvas =
      document.createElement(
        'canvas'
      );

    canvas.width =
      size;

    canvas.height =
      size;

    const context =
      canvas.getContext(
        '2d'
      );

    if (!context) {
      return;
    }

    context.clearRect(
      0,
      0,
      size,
      size
    );

    if (
      state.badgeIconReady &&
      state.badgeIconImage
    ) {
      context.drawImage(
        state.badgeIconImage,
        0,
        0,
        size,
        size
      );

    } else {
      drawFallbackBadgeIcon(
        context,
        size
      );
    }

    if (count > 0) {
      drawFaviconBadge(
        context,
        size,
        count
      );
    }

    const link =
      ensureDynamicFaviconLink();

    link.href =
      canvas.toDataURL(
        'image/png'
      );
  }


  function drawFallbackBadgeIcon(
    context,
    size
  ) {
    const radius =
      12;

    const gradient =
      context.createLinearGradient(
        0,
        0,
        size,
        size
      );

    gradient.addColorStop(
      0,
      '#0b2f46'
    );

    gradient.addColorStop(
      1,
      '#0f766e'
    );

    context.fillStyle =
      gradient;

    context.beginPath();

    context.roundRect(
      0,
      0,
      size,
      size,
      radius
    );

    context.fill();

    context.fillStyle =
      '#ffffff';

    context.font =
      '800 21px Arial';

    context.textAlign =
      'center';

    context.textBaseline =
      'middle';

    context.fillText(
      'DC',
      size / 2,
      size / 2 + 1
    );
  }


  function drawFaviconBadge(
    context,
    size,
    count
  ) {
    const label =
      count > 99
        ? '99+'
        : String(count);

    const wide =
      label.length >= 3;

    const centerX =
      wide
        ? size - 17
        : size - 14;

    const centerY =
      14;

    const radiusX =
      wide
        ? 17
        : 13;

    const radiusY =
      13;

    context.save();

    context.shadowColor =
      'rgba(127, 29, 29, 0.42)';

    context.shadowBlur =
      4;

    context.fillStyle =
      '#ef2b2d';

    context.beginPath();

    context.ellipse(
      centerX,
      centerY,
      radiusX,
      radiusY,
      0,
      0,
      Math.PI * 2
    );

    context.fill();

    context.shadowBlur =
      0;

    context.lineWidth =
      2;

    context.strokeStyle =
      '#ffffff';

    context.stroke();

    context.fillStyle =
      '#ffffff';

    context.font =
      wide
        ? '800 10px Arial'
        : '800 15px Arial';

    context.textAlign =
      'center';

    context.textBaseline =
      'middle';

    context.fillText(
      label,
      centerX,
      centerY + 0.5
    );

    context.restore();
  }


  function clearOverdueBadgePresentation() {
    state.badgeRecords =
      [];

    state.overdueBadgeCount =
      0;

    updateVisibleOverdueBadge(
      0
    );

    updateDocumentTitleBadge(
      0
    );

    updateDynamicFavicon(
      0
    );

    void updateSystemAppBadge(
      0
    );
  }


  function startClock() {
    updateClock();

    state.clockTimer = window.setInterval(
      updateClock,
      1000
    );
  }

  function updateClock() {
    setText(
      'currentDateTime',
      formatBangkokDateTime(
        getCurrentServerDate()
      )
    );
  }

  function startDurationTimer() {
    if (state.durationTimer) {
      window.clearInterval(state.durationTimer);
    }

    state.durationTimer = window.setInterval(
      tickDurations,
      1000
    );
  }

  function tickDurations() {
    if (
      state.destroyed ||
      document.visibilityState !==
        'visible'
    ) {
      return;
    }

    const nowMs =
      getCurrentServerTimeMs();

    updateMovementCountdown();

    let statusChanged =
      false;

    let nearAutoCloseChanged =
      false;

    const expiredRecordIds =
      [];

    state.records.forEach(
      (record) => {
        const previousStatus =
          record.statusCode;

        const previousNearAutoClose =
          Boolean(
            record.isNearAutoClose
          );

        updateRecordComputedState(
          record,
          nowMs
        );

        if (
          record.isExpired36H
        ) {
          expiredRecordIds.push(
            record.recordId
          );

          return;
        }

        const nodes =
          state.cardNodes.get(
            record.recordId
          );

        if (nodes) {
          nodes.timer.textContent =
            record.durationDisplay ||
            '--:--:--';

          nodes.priorityText.textContent =
            record.priorityText ||
            '';

          nodes.progressFill.style.width =
            Math.max(
              0,
              Math.min(
                100,
                Number(
                  record.progressPercent
                ) || 0
              )
            ) + '%';

          nodes.card.dataset.nearAutoClose =
            record.isNearAutoClose
              ? 'TRUE'
              : 'FALSE';

          if (
            previousStatus !==
            record.statusCode
          ) {
            nodes.card.dataset.status =
              record.statusCode;

            nodes.statusBadge.dataset.status =
              record.statusCode;

            nodes.statusBadge.textContent =
              record.statusLabel;

            statusChanged =
              true;
          }
        }

        if (
          previousNearAutoClose !==
          Boolean(
            record.isNearAutoClose
          )
        ) {
          nearAutoCloseChanged =
            true;
        }
      }
    );

    /*
     * อัปเดต badge ทุกครั้งที่สถานะของรายการข้ามเกณฑ์
     * แต่จะวาด favicon ใหม่เฉพาะเมื่อจำนวนเปลี่ยน
     */
    updateOverdueBadgePresentation();

    if (
      expiredRecordIds.length > 0
    ) {
      const expiredSet =
        new Set(
          expiredRecordIds
        );

      state.records =
        state.records.filter(
          (record) =>
            !expiredSet.has(
              record.recordId
            )
        );

      state.recordsSignature =
        buildRecordsSignature(
          state.records
        );

      requestAutoClosePersistence();
    }

    if (
      statusChanged ||
      nearAutoCloseChanged ||
      expiredRecordIds.length > 0
    ) {
      renderSummary();
      renderTimeline();
      applyFiltersAndRender();
      checkOverdueAlerts();
    }

    const seconds =
      Math.floor(
        nowMs / 1000
      );

    if (
      seconds % 60 === 0
    ) {
      renderTimeline();
    }
  }

  function startAutoRefresh() {
    if (state.refreshTimer) {
      window.clearInterval(
        state.refreshTimer
      );
    }

    const seconds = Math.max(
      10,
      Number(
        state.module &&
        state.module.refreshSeconds
      ) || 30
    );

    state.refreshTimer =
      window.setInterval(
        async () => {
          if (
            state.destroyed ||
            document.visibilityState !==
              'visible' ||
            state.refreshInProgress ||
            state.movementRefreshInProgress
          ) {
            return;
          }

          await Promise.all([
            loadRecords({
              silentError: true,
              showSuccessToast: false,
              forceRender: false
            }),
            loadMovementSummary({
              silentError: true,
              forceRender: false
            })
          ]);
        },
        seconds * 1000
      );

    updateAutoRefreshStatus();
  }

  function updateAutoRefreshStatus() {
    const element =
      document.getElementById(
        'autoRefreshStatus'
      );

    if (element) {
      element.classList.add(
        'is-hidden'
      );
    }
  }

  async function checkOverdueAlerts() {
    if (
      state.alertRunning ||
      !state.module ||
      !state.module.alertEnabled
    ) {
      return;
    }

    const now = Date.now();

    const repeatMs = Math.max(
      1,
      Number(
        state.module.alertRepeatMinutes ||
        10
      )
    ) * 60 * 1000;

    const overdueRecords =
      state.records.filter((record) => {
        if (
          record.statusCode !== 'OVERDUE'
        ) {
          return false;
        }

        const key =
          getAlertStorageKey(
            record.recordId
          );

        const lastShown =
          Number(
            sessionStorage.getItem(key) ||
            0
          );

        return (
          now -
          lastShown >=
          repeatMs
        );
      });

    if (overdueRecords.length === 0) {
      return;
    }

    state.alertRunning = true;

    overdueRecords.forEach((record) => {
      sessionStorage.setItem(
        getAlertStorageKey(record.recordId),
        String(now)
      );
    });

    notifyDevice();

    const html = document.createElement('div');
    html.className = 'overdue-alert-list';

    overdueRecords
      .slice(0, 5)
      .forEach((record) => {
        const item = document.createElement('div');
        item.className = 'overdue-alert-item';

        const title = document.createElement('strong');
        title.textContent =
          record.primaryValue ||
          'ไม่พบข้อมูลหลัก';

        const detail = document.createElement('span');
        detail.textContent =
          'เข้า ' +
          (
            record.timestampIn ||
            '-'
          ) +
          ' • ' +
          (
            record.durationDisplay ||
            '-'
          );

        item.appendChild(title);
        item.appendChild(detail);
        html.appendChild(item);
      });

    if (overdueRecords.length > 5) {
      const more = document.createElement('div');
      more.className = 'overdue-alert-more';
      more.textContent =
        'และอีก ' +
        (
          overdueRecords.length -
          5
        ) +
        ' รายการ';

      html.appendChild(more);
    }

    await Swal.fire({
      icon: 'warning',
      title: 'พบรถอยู่ในพื้นที่เกินกำหนด',
      html,
      confirmButtonText: 'รับทราบ',
      allowOutsideClick: false
    });

    state.alertRunning = false;
  }

  function getAlertStorageKey(recordId) {
    return (
      'vehicle-overdue:' +
      state.moduleId +
      ':' +
      recordId
    );
  }

  function notifyDevice() {
    if (
      state.module &&
      state.module.vibrationEnabled &&
      navigator.vibrate
    ) {
      navigator.vibrate([250, 100, 250]);
    }

    if (
      state.module &&
      state.module.soundEnabled &&
      state.userInteracted
    ) {
      playAlertSound();
    }
  }

  function playAlertSound() {
    try {
      const AudioContext =
        window.AudioContext ||
        window.webkitAudioContext;

      if (!AudioContext) {
        return;
      }

      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.value = 880;

      gain.gain.setValueAtTime(
        0.0001,
        context.currentTime
      );

      gain.gain.exponentialRampToValueAtTime(
        0.18,
        context.currentTime + 0.02
      );

      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        context.currentTime + 0.35
      );

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.36);

      oscillator.addEventListener('ended', () => {
        context.close().catch(() => null);
      });

    } catch (error) {
      console.warn(
        'ไม่สามารถเล่นเสียงแจ้งเตือนได้',
        error
      );
    }
  }

  async function handleCheckout(record, button) {
    if (!isAdmin()) {
      await Swal.fire({
        icon: 'error',
        title: 'ไม่มีสิทธิ์',
        text: 'เฉพาะผู้ดูแลระบบเท่านั้นที่บันทึกเวลาออกได้',
        confirmButtonText: 'ตกลง'
      });
      return;
    }

    setButtonLoading(
      button,
      true,
      'กำลังตรวจสอบ...'
    );

    showLoading(
      'กำลังตรวจสอบข้อมูล',
      'ระบบกำลังตรวจสอบข้อมูลล่าสุดก่อนบันทึก'
    );

    try {
      const payload =
        buildCheckoutPayload(record);

      const preview =
        await API.previewCheckout(
          state.moduleId,
          payload
        );

      Swal.close();

      const confirmation =
        await Swal.fire({
          icon: 'question',
          title: 'ยืนยันออกจากพื้นที่',
          html: createCheckoutPreviewHtml(
            preview.record ||
            record
          ),
          showCancelButton: true,
          confirmButtonText: 'ยืนยันบันทึกออก',
          cancelButtonText: 'ยกเลิก',
          reverseButtons: true,
          allowOutsideClick: false
        });

      if (!confirmation.isConfirmed) {
        return;
      }

      showLoading(
        'กำลังบันทึกเวลาออก',
        'กรุณาอย่าปิดหน้านี้'
      );

      const result =
        await API.checkout(
          state.moduleId,
          payload
        );

      Swal.close();

      await Swal.fire({
        icon: 'success',
        title: 'บันทึกออกจากพื้นที่แล้ว',
        html: `
          <div class="checkout-success-detail">
            <div>
              <span>เวลาออก</span>
              <strong>${escapeHtml(result.timestampOut || '-')}</strong>
            </div>

            <div>
              <span>ระยะเวลา</span>
              <strong>${escapeHtml(result.durationDisplay || '-')}</strong>
            </div>
          </div>
        `,
        confirmButtonText: 'ตกลง'
      });

      await Promise.all([
        loadRecords({
          silentError: false,
          showSuccessToast: false,
          forceRender: true
        }),
        loadMovementSummary({
          silentError: true,
          forceRender: true
        })
      ]);

    } catch (error) {
      Swal.close();

      await showApiError(
        error,
        'บันทึกเวลาออกไม่สำเร็จ'
      );

      if (
        [
          'ALREADY_CHECKED_OUT',
          'RECORD_CHANGED',
          'RECORD_NO_LONGER_MATCHES'
        ].includes(
          error && error.code
        )
      ) {
        await Promise.all([
          loadRecords({
            silentError: true,
            showSuccessToast: false,
            forceRender: true
          }),
          loadMovementSummary({
            silentError: true,
            forceRender: true
          })
        ]);
      }

    } finally {
      setButtonLoading(button, false);
    }
  }

  function buildCheckoutPayload(record) {
    return {
      recordId: record.recordId,
      sourceRowNumber: record.sourceRowNumber,
      expectedTimestampIn: record.timestampIn,
      expectedTimestampInEpochMs:
        record.timestampInEpochMs,
      expectedPrimaryValue:
        record.primaryValue
    };
  }

  function createCheckoutPreviewHtml(record) {
    const fields = Array.isArray(record.fields)
      ? record.fields
          .filter((field) => field.value)
          .slice(0, 4)
      : [];

    const fieldHtml =
      fields
        .map(
          (field) => `
            <div class="checkout-preview-row">
              <span>${escapeHtml(field.label || '-')}</span>
              <strong>${escapeHtml(field.value || '-')}</strong>
            </div>
          `
        )
        .join('');

    return `
      <div class="checkout-preview">
        <div class="checkout-preview-primary">
          ${escapeHtml(record.primaryValue || '-')}
        </div>

        ${fieldHtml}

        <div class="checkout-preview-row">
          <span>เวลาเข้า</span>
          <strong>${escapeHtml(record.timestampIn || '-')}</strong>
        </div>

        <div class="checkout-preview-row">
          <span>ระยะเวลาปัจจุบัน</span>
          <strong>${escapeHtml(record.durationDisplay || '-')}</strong>
        </div>
      </div>
    `;
  }

  async function openCalendar() {
    if (
      !state.module ||
      !state.module.calendarEnabled
    ) {
      await Swal.fire({
        icon: 'info',
        title: 'ปฏิทินถูกปิดใช้งาน',
        confirmButtonText: 'ตกลง'
      });
      return;
    }

    const now = getCurrentServerDate();

    let selectedMonth =
      Number(
        formatInBangkok(now, 'M')
      );

    let selectedYear =
      Number(
        formatInBangkok(now, 'yyyy')
      );

    await Swal.fire({
      width: 760,
      title: 'ปฏิทินข้อมูลรถ',
      html: `
        <div id="calendarModal" class="calendar-modal">
          <div class="calendar-toolbar">
            <button id="calendarPrev" type="button">‹</button>
            <strong id="calendarMonthLabel">กำลังโหลด...</strong>
            <button id="calendarNext" type="button">›</button>
          </div>

          <div class="calendar-weekdays">
            <span>อา.</span>
            <span>จ.</span>
            <span>อ.</span>
            <span>พ.</span>
            <span>พฤ.</span>
            <span>ศ.</span>
            <span>ส.</span>
          </div>

          <div id="calendarGrid" class="calendar-grid"></div>

          <div class="calendar-legend">
            <span data-severity="GREEN">ปกติ</span>
            <span data-severity="ORANGE">ใกล้เกินเวลา</span>
            <span data-severity="RED">เกินเวลา</span>
            <span data-severity="GRAY">ข้อมูลไม่สมบูรณ์</span>
          </div>
        </div>
      `,
      showConfirmButton: true,
      confirmButtonText: 'ปิด',
      showCancelButton: true,
      cancelButtonText: 'วันนี้',
      reverseButtons: true,
      didOpen: () => {
        const prevButton =
          document.getElementById('calendarPrev');

        const nextButton =
          document.getElementById('calendarNext');

        prevButton && prevButton.addEventListener(
          'click',
          async () => {
            selectedMonth -= 1;

            if (selectedMonth < 1) {
              selectedMonth = 12;
              selectedYear -= 1;
            }

            await renderCalendarMonth(
              selectedMonth,
              selectedYear
            );
          }
        );

        nextButton && nextButton.addEventListener(
          'click',
          async () => {
            selectedMonth += 1;

            if (selectedMonth > 12) {
              selectedMonth = 1;
              selectedYear += 1;
            }

            await renderCalendarMonth(
              selectedMonth,
              selectedYear
            );
          }
        );

        renderCalendarMonth(
          selectedMonth,
          selectedYear
        );
      }
    }).then(async (result) => {
      if (
        result.dismiss ===
        Swal.DismissReason.cancel
      ) {
        await openDailySummary(
          formatBangkokDateOnly(now)
        );
      }
    });
  }

  async function renderCalendarMonth(month, year) {
    const label =
      document.getElementById('calendarMonthLabel');

    const grid =
      document.getElementById('calendarGrid');

    if (!label || !grid) {
      return;
    }

    label.textContent =
      getThaiMonthName(month) +
      ' ' +
      year;

    grid.innerHTML =
      '<div class="calendar-loading">กำลังโหลดข้อมูล...</div>';

    try {
      const result =
        await API.getCalendar(
          state.moduleId,
          month,
          year
        );

      const dayMap = new Map();

      (
        Array.isArray(result.days)
          ? result.days
          : []
      ).forEach((day) => {
        dayMap.set(day.date, day);
      });

      grid.innerHTML = '';

      const firstDay =
        new Date(
          Date.UTC(
            year,
            month - 1,
            1
          )
        ).getUTCDay();

      const daysInMonth =
        new Date(
          Date.UTC(
            year,
            month,
            0
          )
        ).getUTCDate();

      for (
        let blank = 0;
        blank < firstDay;
        blank += 1
      ) {
        const empty =
          document.createElement('span');

        empty.className =
          'calendar-day calendar-day--empty';

        grid.appendChild(empty);
      }

      for (
        let dayNumber = 1;
        dayNumber <= daysInMonth;
        dayNumber += 1
      ) {
        const dateKey =
          pad2(dayNumber) +
          '/' +
          pad2(month) +
          '/' +
          year;

        const data =
          dayMap.get(dateKey);

        const button =
          document.createElement('button');

        button.type = 'button';
        button.className = 'calendar-day';
        button.dataset.severity =
          data
            ? data.severity
            : 'NONE';

        if (
          dateKey ===
          formatBangkokDateOnly(
            getCurrentServerDate()
          )
        ) {
          button.classList.add(
            'calendar-day--today'
          );
        }

        const number =
          document.createElement('strong');

        number.textContent =
          String(dayNumber);

        const count =
          document.createElement('span');

        count.textContent =
          data
            ? data.totalRecords +
              ' คัน'
            : '';

        button.appendChild(number);
        button.appendChild(count);

        if (data) {
          button.addEventListener(
            'click',
            () => {
              Swal.close();
              openDailySummary(dateKey);
            }
          );
        } else {
          button.disabled = true;
        }

        grid.appendChild(button);
      }

    } catch (error) {
      grid.innerHTML = '';

      const errorBox =
        document.createElement('div');

      errorBox.className =
        'calendar-loading calendar-loading--error';

      errorBox.textContent =
        buildErrorMessage(error);

      grid.appendChild(errorBox);
    }
  }

  async function openDailySummary(date) {
    showLoading(
      'กำลังโหลดข้อมูลรายวัน',
      'วันที่ ' + date
    );

    try {
      const result =
        await API.getDailySummary(
          state.moduleId,
          date
        );

      Swal.close();

      await Swal.fire({
        width: 900,
        title:
          'ข้อมูลประจำวันที่ ' +
          date,
        html:
          createDailySummaryHtml(
            result
          ),
        confirmButtonText: 'ปิด'
      });

    } catch (error) {
      Swal.close();

      await showApiError(
        error,
        'โหลดข้อมูลรายวันไม่สำเร็จ'
      );
    }
  }

  function createDailySummaryHtml(result) {
    const summary =
      result && result.summary
        ? result.summary
        : {};

    const records =
      Array.isArray(
        result && result.records
      )
        ? result.records
        : [];

    const summaryItems = [
      ['เข้าพื้นที่ทั้งหมด', summary.totalRecords || 0, 'คัน'],
      ['ออกแล้ว', summary.exitedRecords || 0, 'คัน'],
      ['ยังอยู่', summary.activeRecords || 0, 'คัน'],
      ['เกินเวลา', summary.overdueRecords || 0, 'คัน'],
      ['ข้อมูลไม่สมบูรณ์', summary.incompleteRecords || 0, 'คัน'],
      ['เวลาเฉลี่ย', getDurationDisplay(summary.averageDuration), ''],
      ['เวลาน้อยที่สุด', getDurationDisplay(summary.minimumDuration), ''],
      ['เวลามากที่สุด', getDurationDisplay(summary.maximumDuration), ''],
      ['เวลารวม', getDurationDisplay(summary.totalDuration), '']
    ];

    const summaryHtml =
      summaryItems
        .map(
          ([label, value, unit]) => `
            <div class="daily-summary-item">
              <span>${escapeHtml(label)}</span>
              <strong>
                ${escapeHtml(String(value))}
                ${unit ? `<small>${escapeHtml(unit)}</small>` : ''}
              </strong>
            </div>
          `
        )
        .join('');

    const recordsHtml =
      records.length === 0
        ? `
          <div class="daily-empty">
            ไม่พบรายการในวันที่เลือก
          </div>
        `
        : records
            .map(
              (record) => `
                <article class="daily-record">
                  <div class="daily-record__head">
                    <strong>${escapeHtml(record.primaryValue || '-')}</strong>
                    <span data-status="${escapeHtml(record.statusCode || 'INCOMPLETE')}">
                      ${escapeHtml(record.statusLabel || '-')}
                    </span>
                  </div>

                  <div class="daily-record__times">
                    <span>
                      เข้า:
                      <strong>${escapeHtml(record.timestampIn || '-')}</strong>
                    </span>

                    <span>
                      ออก:
                      <strong>${escapeHtml(record.timestampOut || 'ยังไม่มีข้อมูล')}</strong>
                    </span>

                    <span>
                      ระยะเวลา:
                      <strong>${escapeHtml(record.durationDisplay || '-')}</strong>
                    </span>
                  </div>
                </article>
              `
            )
            .join('');

    return `
      <div class="daily-summary">
        <div class="daily-summary-grid">
          ${summaryHtml}
        </div>

        <div class="daily-record-list">
          ${recordsHtml}
        </div>
      </div>
    `;
  }

  function getDurationDisplay(value) {
    if (
      value &&
      typeof value === 'object'
    ) {
      return value.display || '-';
    }

    return value || '-';
  }

  async function handleLogout() {
    const confirmation =
      await Swal.fire({
        icon: 'question',
        title: 'ออกจากระบบ?',
        text: 'ยืนยันการออกจากระบบ',
        showCancelButton: true,
        confirmButtonText: 'ออกจากระบบ',
        cancelButtonText: 'ยกเลิก',
        reverseButtons: true
      });

    if (!confirmation.isConfirmed) {
      return;
    }

    showLoading(
      'กำลังออกจากระบบ',
      'กรุณารอสักครู่'
    );

    try {
      await API.logout();
    } catch (error) {
      console.warn(
        'Logout ไม่สำเร็จ',
        error
      );
    } finally {
      Swal.close();
    }

    clearOverdueBadgePresentation();
    redirectToLogin();
  }

  async function showSessionExpired() {
    await Swal.fire({
      icon: 'warning',
      title: 'Session หมดอายุ',
      text: 'กรุณาเข้าสู่ระบบใหม่',
      confirmButtonText: 'ไปหน้าเข้าสู่ระบบ',
      allowOutsideClick: false
    });

    clearOverdueBadgePresentation();
    redirectToLogin();
  }

  function isAdmin() {
    return Boolean(
      state.session &&
      state.session.user &&
      state.session.user.role === 'ADMIN'
    );
  }

  function updateServerOffset(generatedAt) {
    const serverDate =
      parseBangkokDateTime(
        generatedAt
      );

    if (!serverDate) {
      state.serverOffsetMs = 0;
      return;
    }

    state.serverOffsetMs =
      serverDate.getTime() -
      Date.now();
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

  function parseBangkokDateTime(value) {
    const text =
      String(value || '').trim();

    const match =
      text.match(
        /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/
      );

    if (!match) {
      return null;
    }

    const iso =
      match[3] +
      '-' +
      match[2] +
      '-' +
      match[1] +
      'T' +
      match[4] +
      ':' +
      match[5] +
      ':' +
      match[6] +
      '+07:00';

    const date = new Date(iso);

    return Number.isNaN(
      date.getTime()
    )
      ? null
      : date;
  }

  function formatBangkokDateTime(date) {
    const formatter =
      new Intl.DateTimeFormat(
        'en-GB',
        {
          timeZone:
            CONFIG.TIMEZONE ||
            'Asia/Bangkok',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23'
        }
      );

    const parts = {};

    formatter
      .formatToParts(date)
      .forEach((part) => {
        parts[part.type] =
          part.value;
      });

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

  function formatBangkokDateOnly(date) {
    return new Intl.DateTimeFormat(
      'en-GB',
      {
        timeZone:
          CONFIG.TIMEZONE ||
          'Asia/Bangkok',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }
    ).format(date);
  }

  function formatInBangkok(date, part) {
    const options = {
      timeZone:
        CONFIG.TIMEZONE ||
        'Asia/Bangkok'
    };

    if (part === 'M') {
      options.month = 'numeric';
    } else if (part === 'yyyy') {
      options.year = 'numeric';
    }

    return new Intl.DateTimeFormat(
      'en-US',
      options
    ).format(date);
  }

  function formatDurationSeconds(totalSeconds) {
    const seconds = Math.max(
      0,
      Math.floor(
        Number(totalSeconds) || 0
      )
    );

    const hours =
      Math.floor(seconds / 3600);

    const minutes =
      Math.floor(
        (
          seconds % 3600
        ) / 60
      );

    const remaining =
      seconds % 60;

    return (
      String(hours).padStart(2, '0') +
      ':' +
      String(minutes).padStart(2, '0') +
      ':' +
      String(remaining).padStart(2, '0')
    );
  }

  function getStatusLabel(statusCode) {
    const labels = {
      NORMAL: 'ปกติ',
      WARNING: 'ใกล้เกินเวลา',
      OVERDUE: 'เกินเวลา',
      INCOMPLETE: 'ข้อมูลไม่สมบูรณ์'
    };

    return (
      labels[statusCode] ||
      'ไม่ทราบสถานะ'
    );
  }

  function getStatusColor(statusCode) {
    const colors = {
      NORMAL: 'GREEN',
      WARNING: 'ORANGE',
      OVERDUE: 'RED',
      INCOMPLETE: 'GRAY'
    };

    return (
      colors[statusCode] ||
      'GRAY'
    );
  }

  function showPageLoading(show) {
    const element =
      document.getElementById('pageLoading');

    element &&
      element.classList.toggle(
        'is-hidden',
        !show
      );
  }

  function showVehicleLoading(show) {
    const element =
      document.getElementById('vehicleLoading');

    element &&
      element.classList.toggle(
        'is-hidden',
        !show
      );
  }

  function setButtonLoading(button, loading, text) {
    if (!button) {
      return;
    }

    if (loading) {
      if (!button.dataset.originalText) {
        button.dataset.originalText =
          button.textContent;
      }

      button.disabled = true;
      button.textContent =
        text ||
        'กำลังดำเนินการ...';

      return;
    }

    button.disabled = false;

    if (button.dataset.originalText) {
      button.textContent =
        button.dataset.originalText;
    }
  }

  function showLoading(title, text) {
    Swal.fire({
      title,
      text: text || '',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });
  }

  function showToast(message, icon) {
    return Swal.fire({
      toast: true,
      position: 'top-end',
      icon: icon || 'success',
      title: message,
      showConfirmButton: false,
      timer: 1800,
      timerProgressBar: true
    });
  }

  function showApiError(error, title) {
    return Swal.fire({
      icon: 'error',
      title:
        title ||
        'เกิดข้อผิดพลาด',
      html:
        buildErrorHtml(error),
      confirmButtonText: 'ตกลง'
    });
  }

  function buildErrorHtml(error) {
    const requestId =
      error && error.requestId
        ? String(error.requestId)
        : '';

    return `
      <div class="swal-error-content">
        <div>
          ${escapeHtml(buildErrorMessage(error))}
        </div>

        ${
          requestId
            ? `
              <div class="request-id">
                รหัสอ้างอิง: ${escapeHtml(requestId)}
              </div>
            `
            : ''
        }
      </div>
    `;
  }

  function buildErrorMessage(error) {
    if (!error) {
      return 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    }

    const messages = {
      AUTH_REQUIRED:
        'กรุณาเข้าสู่ระบบ',
      SESSION_EXPIRED:
        'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่',
      ORIGIN_NOT_ALLOWED:
        'โดเมนเว็บไซต์ยังไม่ได้รับอนุญาตใน Cloudflare',
      ALREADY_CHECKED_OUT:
        'รายการนี้ถูกบันทึกออกจากพื้นที่แล้ว',
      RECORD_CHANGED:
        'ข้อมูลรายการเปลี่ยนแปลงแล้ว กรุณารีเฟรชข้อมูล',
      RECORD_NO_LONGER_MATCHES:
        'รายการนี้ไม่ตรงกับเงื่อนไขของโมดูลแล้ว',
      CHECKOUT_BUSY:
        'ระบบกำลังบันทึกรายการอื่น กรุณาลองใหม่',
      INCOMPLETE_RECORD:
        'ข้อมูลรายการไม่สมบูรณ์ จึงยังบันทึกออกไม่ได้',
      REQUEST_TIMEOUT:
        'ระบบใช้เวลาตอบกลับนานเกินกำหนด',
      NETWORK_ERROR:
        'ไม่สามารถเชื่อมต่อระบบได้ กรุณาตรวจสอบอินเทอร์เน็ต'
    };

    return (
      messages[error.code] ||
      error.message ||
      'เกิดข้อผิดพลาดจากระบบ'
    );
  }

  function isAuthenticationError(error) {
    return Boolean(
      error &&
      (
        error.status === 401 ||
        [
          'AUTH_REQUIRED',
          'SESSION_EXPIRED',
          'INVALID_SESSION',
          'INVALID_SESSION_SIGNATURE',
          'SESSION_VERSION_EXPIRED'
        ].includes(error.code)
      )
    );
  }

  function setText(id, value) {
    const element =
      document.getElementById(id);

    if (element) {
      element.textContent = value;
    }
  }

  function sanitizePhone(value) {
    return String(value || '')
      .replace(/[^0-9+]/g, '');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function debounce(callback, delay) {
    let timeoutId = null;

    return function (...args) {
      window.clearTimeout(timeoutId);

      timeoutId = window.setTimeout(
        () => {
          callback.apply(this, args);
        },
        delay
      );
    };
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function getThaiMonthName(month) {
    const names = [
      '',
      'มกราคม',
      'กุมภาพันธ์',
      'มีนาคม',
      'เมษายน',
      'พฤษภาคม',
      'มิถุนายน',
      'กรกฎาคม',
      'สิงหาคม',
      'กันยายน',
      'ตุลาคม',
      'พฤศจิกายน',
      'ธันวาคม'
    ];

    return names[Number(month)] || '';
  }

  function getModuleIdFromUrl() {
    const url =
      new URL(window.location.href);

    return String(
      url.searchParams.get('id') ||
      ''
    ).trim();
  }

  function redirectToDashboard() {
    window.location.href =
      CONFIG.DASHBOARD_URL ||
      './index.html';
  }

  function redirectToLogin() {
    window.location.replace(
      CONFIG.LOGIN_URL ||
      './login.html'
    );
  }

  function destroyPage() {
    state.destroyed = true;

    [
      state.clockTimer,
      state.durationTimer,
      state.refreshTimer,
      state.autoClosePersistTimer,
      state.timelineSnapTimer
    ].forEach((timer) => {
      if (timer) {
        window.clearInterval(timer);
      }
    });
  }

})(window, document);
