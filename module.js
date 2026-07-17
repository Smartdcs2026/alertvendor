/**
 * module.js
 * ROUND 3 — Mobile-first Responsive + Adaptive Revision Polling
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
 * - Production R17: Action Sheet CSS + Shift Handover Accuracy
 * - Production R19: OPERATIONAL ALERT เปิด/ปิดรายผู้ใช้และรายโมดูล
 * - Production R23: ย้ายตัวควบคุมแจ้งเตือนไป Footer โดยไม่ลอยทับเนื้อหา
 * - ROUND 3: Revision-only polling แบบ adaptive, หยุดเมื่อซ่อน Tab และไม่ refresh เต็มระหว่างการ์ดกำลัง Commit
 */
(function (window, document) {
  'use strict';

  const CONFIG = window.APP_CONFIG || {};
  const API = window.VehicleAPI;

  const OPERATIONAL_ALERT_STORAGE_PREFIX =
    'alertvendor:operational-alert:v1';

  const OVERDUE_BADGE_ICON_URL =
    './icons/icon-192.png';

  const OVERDUE_BADGE_FAVICON_SIZE =
    64;

  const OPERATIONAL_BOARD_CACHE_PREFIX =
    'alertvendor:module-board:phase3a';
  const OPERATIONAL_BOARD_CACHE_MAX_AGE_MS =
    15 * 60 * 1000;
  const OPERATIONAL_BOARD_STALE_AFTER_MS =
    90 * 1000;


  const REVISION_POLL_MIN_MS = 8000;
  const REVISION_POLL_MAX_MS = 60000;
  const REVISION_POLL_RESUME_MS = 350;

  const state = {
    moduleId: '',
    session: null,
    module: null,
    records: [],
    filteredRecords: [],
    operationalBoard: null,
    boardHealth: 'LOADING',
    boardError: null,
    lastBoardSuccessAt: 0,
    usingCachedBoard: false,
    operationalStageFilter: 'ALL',
    shiftFilter: 'ALL',
    sortMode: 'LONGEST',
    mobileWorkspace: 'LIST',
    searchText: '',
    statusFilter: 'ALL',
    serverOffsetMs: 0,
    clockTimer: null,
    durationTimer: null,
    refreshTimer: null,
    refreshInProgress: false,
    handoverInProgress: false,
    recordsSignature: '',
    hasLoadedRecords: false,
    movementSummary: null,
    movementSummarySignature: '',
    movementRefreshInProgress: false,
    movementLoaded: false,
    dataRevision: '',
    rulesRevision: '',
    revisionCheckInProgress: false,
    revisionPollDelayMs: REVISION_POLL_MIN_MS,
    revisionPollFailures: 0,
    revisionPollLastAt: 0,
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
    serverAlertCheckInProgress: false,
    lastServerAlertCheckAt: 0,
    lastServerAlertDeliveryEpochMs: 0,
    userInteracted: false,
    operationalAlertEnabled: true,
    operationalAlertStorageKey: '',

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

  /*
   * Controller กลางสำหรับ module.js และ module-operations.js
   * ปิดเฉพาะ OPERATIONAL ALERT อัตโนมัติ ไม่กระทบ Error,
   * การยืนยันบันทึก หรือ SweetAlert สำคัญประเภทอื่น
   */
  window.AlertVendorOperationalAlert = {
    isEnabled:
      () => isOperationalAlertEnabled(),

    setEnabled:
      (enabled) =>
        setOperationalAlertEnabled(
          enabled,
          {
            persist: true,
            emit: true
          }
        ),

    toggle:
      () =>
        setOperationalAlertEnabled(
          !isOperationalAlertEnabled(),
          {
            persist: true,
            emit: true
          }
        ),

    syncUi:
      () => syncOperationalAlertToggle()
  };

  /*
   * ใช้ delegated click แบบ capture เพื่อให้ปุ่มทำงานได้แน่นอน
   * แม้สคริปต์ส่วนอื่นจะหยุด event bubbling หรือมีการจัด DOM ใหม่
   */
  document.addEventListener(
    'click',
    handleOperationalAlertToggleClick,
    true
  );

  document.addEventListener('DOMContentLoaded', initializePage);
  window.addEventListener('beforeunload', destroyPage);
  document.addEventListener('pointerdown', markUserInteraction, { once: true });
  document.addEventListener('keydown', markUserInteraction, { once: true });

  async function initializePage() {
    if (document.body) {
      document.body.dataset.operationalBoardBuild =
        '2026.07.13-r18-workflow-wording-accuracy';
      document.body.dataset.shiftHandoverBuild =
        '2026.07.13-r18-workflow-wording-accuracy';
      document.body.dataset.operationalAlertBuild =
        '2026.07.13-r24-footer-alert-visual-polish';
    }

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
    setMobileWorkspace('LIST');
    startClock();
    showPageLoading(true);

    try {
      const session = await API.me();

      if (!session || !session.authenticated) {
        redirectToLogin();
        return;
      }

      state.session = session;
      initializeOperationalAlertPreference();

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

      await loadRecords({
        silentError: false,
        showSuccessToast: false,
        forceRender: true
      });

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

    const focusStatusGroup =
      document.getElementById(
        'criticalStatusFilters'
      );

    const sortSelect =
      document.getElementById(
        'focusSortSelect'
      );

    const mobileWorkspaceTabs =
      document.getElementById(
        'mobileWorkspaceTabs'
      );

    const mobileConflictFilter =
      document.getElementById(
        'mobileConflictFilter'
      );

    const operationalStageGroup =
      document.getElementById(
        'operationalStageFilters'
      );

    const operationalShiftGroup =
      document.getElementById(
        'operationalShiftFilters'
      );

    const operationalResetButton =
      document.getElementById(
        'operationalResetFilters'
      );

    const operationalRefreshButton =
      document.getElementById(
        'operationalBoardRefresh'
      );

    const shiftHandoverAddNoteButton =
      document.getElementById(
        'shiftHandoverAddNote'
      );

    const shiftHandoverAcknowledgeButton =
      document.getElementById(
        'shiftHandoverAcknowledge'
      );

    const shiftHandoverRefreshButton =
      document.getElementById(
        'shiftHandoverRefresh'
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

          syncCriticalStatusUi();
          applyFiltersAndRender();
        }
      );

    focusStatusGroup &&
      focusStatusGroup.addEventListener(
        'click',
        (event) => {
          const button =
            event.target.closest(
              '[data-focus-status]'
            );

          if (!button) {
            return;
          }

          clearQuickFilterContext({
            keepStatus: true
          });

          state.statusFilter =
            String(
              button.dataset.focusStatus ||
              'ALL'
            ).toUpperCase();

          if (statusFilter) {
            statusFilter.value =
              state.statusFilter;
          }

          syncCriticalStatusUi();
          setMobileWorkspace('LIST', {
            scroll: isMobileViewport()
          });
          applyFiltersAndRender();
        }
      );

    sortSelect &&
      sortSelect.addEventListener(
        'change',
        () => {
          state.sortMode =
            String(
              sortSelect.value ||
              'LONGEST'
            ).toUpperCase();

          applyFiltersAndRender();
        }
      );

    mobileWorkspaceTabs &&
      mobileWorkspaceTabs.addEventListener(
        'click',
        (event) => {
          const button =
            event.target.closest(
              '[data-mobile-workspace]'
            );

          if (!button) {
            return;
          }

          setMobileWorkspace(
            button.dataset.mobileWorkspace ||
            'LIST',
            {
              scroll: true
            }
          );
        }
      );

    mobileConflictFilter &&
      mobileConflictFilter.addEventListener(
        'click',
        () => {
          const nextConflictState =
            state.operationalStageFilter ===
              'DATA_CONFLICT'
              ? 'ALL'
              : 'DATA_CONFLICT';

          clearQuickFilterContext();
          state.operationalStageFilter =
            nextConflictState;

          syncOperationalFilterUi();
          syncCriticalStatusUi();
          setMobileWorkspace('LIST', {
            scroll: isMobileViewport()
          });
          applyFiltersAndRender();
        }
      );

    operationalStageGroup &&
      operationalStageGroup.addEventListener(
        'click',
        (event) => {
          const button =
            event.target.closest(
              '[data-operational-stage]'
            );

          if (!button) {
            return;
          }

          clearQuickFilterContext({
            keepStage: true
          });

          state.operationalStageFilter =
            String(
              button.dataset.operationalStage ||
              'ALL'
            ).toUpperCase();

          syncOperationalFilterUi();
          syncCriticalStatusUi();
          if (isMobileViewport()) {
            setMobileWorkspace('LIST', {
              scroll: true
            });
          }
          applyFiltersAndRender();
        }
      );

    operationalShiftGroup &&
      operationalShiftGroup.addEventListener(
        'click',
        (event) => {
          const button =
            event.target.closest(
              '[data-operational-shift]'
            );

          if (!button) {
            return;
          }

          clearQuickFilterContext({
            keepShift: true
          });

          state.shiftFilter =
            String(
              button.dataset.operationalShift ||
              'ALL'
            ).toUpperCase();

          syncOperationalFilterUi();
          if (isMobileViewport()) {
            setMobileWorkspace('LIST', {
              scroll: true
            });
          }
          applyFiltersAndRender();
        }
      );

    operationalResetButton &&
      operationalResetButton.addEventListener(
        'click',
        () => {
          clearQuickFilterContext();
          syncOperationalFilterUi();
          syncCriticalStatusUi();
          if (isMobileViewport()) {
            setMobileWorkspace('LIST', {
              scroll: true
            });
          }
          applyFiltersAndRender();
        }
      );

    operationalRefreshButton &&
      operationalRefreshButton.addEventListener(
        'click',
        () => void loadRecords({
          silentError: false,
          showSuccessToast: true,
          forceRender: true,
          forceRefresh: true
        })
      );

    shiftHandoverAddNoteButton &&
      shiftHandoverAddNoteButton.addEventListener(
        'click',
        () => void handleShiftHandoverAction(
          'ADD_NOTE'
        )
      );

    shiftHandoverAcknowledgeButton &&
      shiftHandoverAcknowledgeButton.addEventListener(
        'click',
        () => void handleShiftHandoverAction(
          'ACKNOWLEDGE'
        )
      );

    shiftHandoverRefreshButton &&
      shiftHandoverRefreshButton.addEventListener(
        'click',
        () => void handleShiftHandoverAction(
          'REFRESH_SNAPSHOT'
        )
      );

    document.addEventListener(
      'alertvendor:refresh-operational-board',
      () => void loadRecords({
        silentError: true,
        showSuccessToast: false,
        forceRender: true,
        forceRefresh: true
      })
    );

    document
      .querySelector('[data-operational-scroll]')
      ?.addEventListener(
        'click',
        () => {
          document
            .getElementById('operationalBoardPanel')
            ?.scrollIntoView({
              behavior: 'smooth',
              block: 'start'
            });
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

              syncCriticalStatusUi();
              setMobileWorkspace('LIST', {
                scroll: isMobileViewport()
              });
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
      () => {
        if (document.visibilityState !== 'visible') {
          stopAutoRefresh();
          return;
        }

        state.revisionPollFailures = 0;
        state.revisionPollDelayMs = REVISION_POLL_MIN_MS;

        if (
          !state.refreshInProgress &&
          !state.movementRefreshInProgress &&
          state.hasLoadedRecords &&
          navigator.onLine
        ) {
          scheduleNextRevisionCheck(REVISION_POLL_RESUME_MS);
        }
      }
    );

    window.addEventListener(
      'online',
      () => {
        state.revisionPollFailures = 0;
        state.revisionPollDelayMs = REVISION_POLL_MIN_MS;

        if (!state.destroyed) {
          scheduleNextRevisionCheck(REVISION_POLL_RESUME_MS);
        }
      }
    );

    window.addEventListener(
      'offline',
      () => {
        stopAutoRefresh();

        if (state.hasLoadedRecords) {
          state.boardHealth = 'STALE';
          state.usingCachedBoard = true;
          renderModuleSnapshotState();
        }
      }
    );
  }

  function clearQuickFilterContext(options) {
    const config =
      options &&
      typeof options === 'object'
        ? options
        : {};

    if (config.keepStatus !== true) {
      state.statusFilter = 'ALL';
      const statusSelect =
        document.getElementById(
          'statusFilter'
        );
      if (statusSelect) {
        statusSelect.value = 'ALL';
      }
    }

    if (config.keepStage !== true) {
      state.operationalStageFilter = 'ALL';
    }

    if (config.keepShift !== true) {
      state.shiftFilter = 'ALL';
    }

    state.selectedTimelineStartMs = null;
    state.searchText = '';

    const searchInput =
      document.getElementById(
        'searchInput'
      );
    if (searchInput) {
      searchInput.value = '';
    }
  }

  function isMobileViewport() {
    return window.matchMedia(
      '(max-width: 767px)'
    ).matches;
  }

  function setMobileWorkspace(
    workspace,
    options
  ) {
    const allowed = [
      'LIST',
      'STAGES',
      'SHIFTS',
      'HANDOVER'
    ];
    const next =
      allowed.includes(
        String(workspace || '').toUpperCase()
      )
        ? String(workspace).toUpperCase()
        : 'LIST';

    state.mobileWorkspace = next;

    if (document.body) {
      document.body.dataset.mobileWorkspace =
        next;
    }

    document
      .querySelectorAll(
        '[data-mobile-workspace]'
      )
      .forEach((button) => {
        const active =
          String(
            button.dataset.mobileWorkspace ||
            ''
          ).toUpperCase() === next;

        button.classList.toggle(
          'is-active',
          active
        );
        button.setAttribute(
          'aria-pressed',
          active ? 'true' : 'false'
        );
      });

    const config =
      options &&
      typeof options === 'object'
        ? options
        : {};

    if (
      config.scroll === true &&
      isMobileViewport()
    ) {
      const target =
        next === 'LIST'
          ? document.getElementById(
              'vehicleList'
            )
          : document.getElementById(
              'operationalBoardPanel'
            );

      window.requestAnimationFrame(
        () => target?.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        })
      );
    }
  }

  function syncCriticalStatusUi() {
    document
      .querySelectorAll(
        '[data-focus-status]'
      )
      .forEach((button) => {
        const active =
          String(
            button.dataset.focusStatus ||
            'ALL'
          ).toUpperCase() ===
          String(
            state.statusFilter ||
            'ALL'
          ).toUpperCase();

        button.classList.toggle(
          'is-active',
          active
        );
        button.setAttribute(
          'aria-pressed',
          active ? 'true' : 'false'
        );
      });

    const conflictButton =
      document.getElementById(
        'mobileConflictFilter'
      );

    if (conflictButton) {
      const active =
        state.operationalStageFilter ===
        'DATA_CONFLICT';
      conflictButton.classList.toggle(
        'is-active',
        active
      );
      conflictButton.setAttribute(
        'aria-pressed',
        active ? 'true' : 'false'
      );
    }
  }

  function markUserInteraction() {
    state.userInteracted = true;
  }



  function applyEmbeddedMovementSnapshot(board) {
    const movement =
      board &&
      board.dashboard &&
      board.dashboard.movement &&
      typeof board.dashboard.movement === 'object'
        ? board.dashboard.movement
        : null;

    if (!movement) {
      return false;
    }

    const signature = buildMovementSummarySignature(movement);
    const changed =
      !state.movementLoaded ||
      signature !== state.movementSummarySignature;

    state.movementSummary = movement;
    state.movementSummarySignature = signature;
    state.movementLoaded = true;
    state.movementRefreshInProgress = false;

    renderModuleThresholdInfo();
    renderMovementOverview();

    if (changed) {
      renderTimeline();
    }

    return true;
  }

  async function loadMovementSummary(
    options
  ) {
    if (
      applyEmbeddedMovementSnapshot(state.operationalBoard)
    ) {
      return;
    }

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

    if (
      config.background === true &&
      hasActiveCardWrite()
    ) {
      scheduleNextRevisionCheck(REVISION_POLL_MIN_MS);
      return;
    }

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
      let result;

      if (
        !API ||
        typeof API.getOperationalBoard !==
          'function'
      ) {
        const missingError =
          new Error(
            'ไม่พบ Operational Board API'
          );
        missingError.code =
          'OPERATIONAL_BOARD_API_MISSING';
        throw missingError;
      }

      try {
        result =
          await API.getOperationalBoard(
            state.moduleId,
            {
              limit: 1500,
              forceRefresh:
                config.forceRefresh === true
            }
          );

        assertOperationalBoardResult(
          result
        );

        state.operationalBoard =
          result;
        state.boardError = null;
        state.lastBoardSuccessAt =
          Date.now();
        state.usingCachedBoard =
          false;
        state.boardHealth =
          result.integrity &&
          result.integrity.success === false
            ? 'INTEGRITY_ERROR'
            : 'LIVE';

        if (
          state.boardHealth === 'LIVE'
        ) {
          saveOperationalBoardSnapshot(
            result
          );
        }

      } catch (boardError) {
        const cachedBoard =
          readOperationalBoardSnapshot();

        state.boardError =
          boardError;

        if (!cachedBoard) {
          state.operationalBoard =
            null;
          state.boardHealth =
            'BLOCKED';
          state.usingCachedBoard =
            false;
          renderModuleSnapshotState();
          throw boardError;
        }

        result = cachedBoard;
        state.operationalBoard =
          cachedBoard;
        state.boardHealth =
          'STALE';
        state.usingCachedBoard =
          true;

        console.warn(
          'Operational Board โหลดไม่สำเร็จ ใช้ Snapshot ล่าสุดแบบอ่านอย่างเดียว',
          boardError
        );
      }

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

      state.dataRevision = String(
        result && result.dataRevision || ''
      );
      state.rulesRevision = String(
        result && result.rulesRevision || ''
      );
      applyEmbeddedMovementSnapshot(result);

      const nextRecords =
        result &&
        Array.isArray(
          result.records
        )
          ? result.records.map(
              normalizeOperationalRecord
            )
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
      renderOperationalBoard();
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
        (
          state.boardHealth === 'LIVE'
            ? 'ข้อมูลล่าสุด '
            : state.boardHealth === 'INTEGRITY_ERROR'
              ? 'ข้อมูลล่าสุด แต่พบความไม่สมดุล '
              : 'Snapshot สำรอง '
        ) +
          (
            result &&
            result.generatedAt
              ? result.generatedAt
              : formatBangkokDateTime(
                  getCurrentServerDate()
                )
          )
      );

      renderModuleSnapshotState();

      state.hasLoadedRecords =
        true;

      document.dispatchEvent(
        new CustomEvent(
          'alertvendor:records-updated',
          {
            detail: {
              moduleId: state.moduleId,
              generatedAt:
                result && result.generatedAt || '',
              records: state.records,
              operationalBoard:
                state.operationalBoard
            }
          }
        )
      );

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

  function assertOperationalBoardResult(result) {
    if (
      !result ||
      typeof result !== 'object' ||
      !Array.isArray(result.records)
    ) {
      const error = new Error(
        'Operational Board ส่งข้อมูลไม่สมบูรณ์'
      );
      error.code = 'OPERATIONAL_BOARD_INVALID_RESPONSE';
      throw error;
    }
  }

  function operationalBoardStorageKey() {
    const username = String(
      state.session &&
      state.session.user &&
      state.session.user.username ||
      state.session &&
      state.session.username ||
      'anonymous'
    ).trim().toLowerCase();

    return [
      OPERATIONAL_BOARD_CACHE_PREFIX,
      username,
      String(state.moduleId || '').trim().toLowerCase()
    ].join(':');
  }

  function saveOperationalBoardSnapshot(board) {
    try {
      window.sessionStorage.setItem(
        operationalBoardStorageKey(),
        JSON.stringify({
          savedAt: Date.now(),
          board: board
        })
      );
    } catch (error) {
      console.warn(
        'บันทึก Operational Board Snapshot ไม่สำเร็จ',
        error
      );
    }
  }

  function readOperationalBoardSnapshot() {
    try {
      const raw = window.sessionStorage.getItem(
        operationalBoardStorageKey()
      );

      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);
      const ageMs = Date.now() - Number(parsed.savedAt || 0);
      const board = parsed.board;

      if (
        ageMs < 0 ||
        ageMs > OPERATIONAL_BOARD_CACHE_MAX_AGE_MS ||
        !board ||
        !Array.isArray(board.records) ||
        !board.integrity ||
        board.integrity.success !== true
      ) {
        window.sessionStorage.removeItem(
          operationalBoardStorageKey()
        );
        return null;
      }

      board.__clientSnapshotSavedAt = Number(parsed.savedAt || 0);
      return board;
    } catch (error) {
      console.warn(
        'อ่าน Operational Board Snapshot ไม่สำเร็จ',
        error
      );
      return null;
    }
  }

  function renderModuleSnapshotState() {
    const panel = document.getElementById(
      'moduleSnapshotState'
    );
    const title = document.getElementById(
      'moduleSnapshotTitle'
    );
    const detail = document.getElementById(
      'moduleSnapshotDetail'
    );
    const retryButton = document.getElementById(
      'moduleSnapshotRetry'
    );

    if (!panel) {
      return;
    }

    const generatedAt = String(
      state.operationalBoard &&
      state.operationalBoard.generatedAt ||
      ''
    );
    const ageMs = state.lastBoardSuccessAt
      ? Date.now() - state.lastBoardSuccessAt
      : Number.MAX_SAFE_INTEGER;

    let status = state.boardHealth;

    if (
      status === 'LIVE' &&
      ageMs > OPERATIONAL_BOARD_STALE_AFTER_MS
    ) {
      status = 'STALE';
    }

    panel.dataset.state = status;
    document.body.dataset.boardHealth = status;

    const map = {
      LOADING: {
        title: 'กำลังตรวจสอบข้อมูล',
        detail: 'กำลังยืนยันข้อมูลล่าสุดจากระบบ',
        retry: false
      },
      LIVE: {
        title: 'ข้อมูลพร้อมใช้งาน',
        detail: generatedAt
          ? 'อัปเดตล่าสุด ' + generatedAt
          : 'ข้อมูลล่าสุดพร้อมใช้งาน',
        retry: false
      },
      STALE: {
        title: 'กำลังใช้ข้อมูลล่าสุดที่มี',
        detail: generatedAt
          ? 'ข้อมูลล่าสุดที่ยืนยันได้ ' + generatedAt + ' · ปิดปุ่มบันทึกชั่วคราว'
          : 'เครือข่ายไม่พร้อม · ปิดปุ่มบันทึกชั่วคราว',
        retry: true
      },
      INTEGRITY_ERROR: {
        title: 'พบข้อมูลไม่สมดุล',
        detail: 'ระบบปิดปุ่มบันทึกเพื่อป้องกันการเปลี่ยนสถานะผิดคัน ให้ Admin ตรวจสอบ',
        retry: true
      },
      BLOCKED: {
        title: 'ไม่สามารถยืนยันสถานะรถได้',
        detail: 'ยังยืนยันข้อมูลล่าสุดไม่ได้ ระบบจึงปิดการบันทึกเพื่อป้องกันข้อมูลผิดพลาด',
        retry: true
      }
    };

    const info = map[status] || map.BLOCKED;
    const accessibleSummary = [info.title, info.detail]
      .filter(Boolean)
      .join(' — ');

    if (title) title.textContent = info.title;
    if (detail) detail.textContent = info.detail;

    panel.setAttribute('aria-label', accessibleSummary);
    panel.setAttribute('title', accessibleSummary);
    bindCompactSnapshotStatus_(panel);

    if (status === 'LIVE') {
      panel.classList.remove('is-open');
      panel.setAttribute('aria-expanded', 'false');
    }

    if (retryButton) {
      retryButton.hidden = !info.retry;
      retryButton.disabled = state.refreshInProgress;
      retryButton.onclick = info.retry
        ? () => void loadRecords({
            silentError: false,
            showSuccessToast: true,
            forceRender: true,
            forceRefresh: true
          })
        : null;
    }

    document.dispatchEvent(
      new CustomEvent(
        'alertvendor:module-board-health',
        {
          detail: {
            state: status,
            writable: status === 'LIVE',
            generatedAt: generatedAt,
            errorCode: String(
              state.boardError &&
              state.boardError.code ||
              ''
            )
          }
        }
      )
    );
  }

  function bindCompactSnapshotStatus_(panel) {
    if (!panel || panel.dataset.compactStatusBound === 'TRUE') {
      return;
    }

    panel.dataset.compactStatusBound = 'TRUE';

    const setOpen = (open) => {
      panel.classList.toggle('is-open', open);
      panel.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    panel.addEventListener('click', (event) => {
      const target = event.target;

      if (
        target &&
        typeof target.closest === 'function' &&
        target.closest('button')
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setOpen(!panel.classList.contains('is-open'));
    });

    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setOpen(!panel.classList.contains('is-open'));
      } else if (event.key === 'Escape') {
        setOpen(false);
        panel.blur();
      }
    });

    document.addEventListener('click', (event) => {
      if (!panel.contains(event.target)) {
        setOpen(false);
      }
    });
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

          operationalStage:
            record.operationalStage || '',

          statusCode:
            record.statusCode || '',

          statusStartedAtEpochMs:
            Number(record.statusStartedAtEpochMs) || 0,

          stageRuleKey:
            record.stageSla && record.stageSla.ruleKey || '',

          stageRulesRevision:
            record.stageSla && record.stageSla.rulesRevision || '',

          dataHealthCode:
            record.dataHealthCode || '',

          receivingCompleteAt:
            record.receivingCompleteAt || '',

          workflowStatusCode:
            record.workflowStatusCode || '',

          entryShiftCode:
            record.entryShiftCode || '',

          ownerShiftCode:
            record.ownerShiftCode || '',

          carryOver:
            Boolean(record.carryOver),

          canCompleteReceiving:
            Boolean(record.canCompleteReceiving),

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
      !Number.isFinite(Number(record.timestampInEpochMs))
    ) {
      if (record) {
        record.statusCode = 'INCOMPLETE';
        record.statusLabel = getStatusLabel('INCOMPLETE');
        record.priorityText = 'ตรวจสอบข้อมูลเวลาเข้า';
        record.progressPercent = 0;
      }
      return;
    }

    const totalDurationSeconds = Math.max(
      0,
      Math.floor(
        (nowMs - Number(record.timestampInEpochMs)) / 1000
      )
    );
    const stageThresholds = getRecordStageThresholds(record, nowMs);
    const autoCloseThresholds = getModuleThresholds();
    const autoCloseRemainingSeconds = Math.max(
      0,
      autoCloseThresholds.autoCloseSeconds - totalDurationSeconds
    );

    record.durationSeconds = totalDurationSeconds;
    record.durationDisplay = formatDurationSeconds(totalDurationSeconds);
    record.statusElapsedSeconds = stageThresholds.elapsedSeconds;
    record.statusCode = stageThresholds.statusCode;
    record.statusLabel = getStatusLabel(stageThresholds.statusCode);
    record.statusColor = getStatusColor(stageThresholds.statusCode);
    record.isOverdue = stageThresholds.statusCode === 'OVERDUE';
    record.isExpired36H =
      totalDurationSeconds >= autoCloseThresholds.autoCloseSeconds;
    record.autoCloseRemainingSeconds = autoCloseRemainingSeconds;
    record.isNearAutoClose =
      !record.isExpired36H &&
      autoCloseRemainingSeconds <= autoCloseThresholds.nearAutoCloseSeconds;
    record.progressPercent = calculateProgressPercent(
      stageThresholds.elapsedSeconds,
      stageThresholds
    );
    record.warningMarkerPercent =
      stageThresholds.redSeconds > 0
        ? Math.max(
            0,
            Math.min(
              100,
              (stageThresholds.warningSeconds /
                stageThresholds.redSeconds) * 100
            )
          )
        : 0;
    record.priorityText = buildPriorityText(record, stageThresholds);
    record.priorityScore = calculatePriorityScore(record, stageThresholds);
  }

  function getRecordStageThresholds(record, nowMs) {
    const stageSla =
      record &&
      record.stageSla &&
      typeof record.stageSla === 'object'
        ? record.stageSla
        : {};
    const configured = stageSla.configured === true;
    const startedAtEpochMs = Number(
      stageSla.startedAtEpochMs ||
      record.statusStartedAtEpochMs
    );
    const warningMinutes = Number(stageSla.warningMinutes);
    const redMinutes = Number(stageSla.redMinutes);

    if (
      !configured ||
      !Number.isFinite(startedAtEpochMs) ||
      !Number.isFinite(warningMinutes) ||
      !Number.isFinite(redMinutes) ||
      redMinutes <= warningMinutes
    ) {
      return {
        configured: false,
        elapsedSeconds: 0,
        warningSeconds: 0,
        redSeconds: 0,
        statusCode: 'INCOMPLETE'
      };
    }

    const elapsedSeconds = Math.max(
      0,
      Math.floor((Number(nowMs) - startedAtEpochMs) / 1000)
    );
    const warningSeconds = warningMinutes * 60;
    const redSeconds = redMinutes * 60;

    return {
      configured: true,
      elapsedSeconds,
      warningSeconds,
      redSeconds,
      warningMinutes,
      redMinutes,
      statusCode:
        elapsedSeconds >= redSeconds
          ? 'OVERDUE'
          : elapsedSeconds >= warningSeconds
            ? 'WARNING'
            : 'NORMAL'
    };
  }



  function getModuleThresholds() {
    const module =
      state.module || {};

    const movementThresholds =
      state.movementSummary &&
      state.movementSummary.thresholds
        ? state.movementSummary.thresholds
        : {};

    const greenMinutes = 0;
    const warningMinutes = 0;
    const redMinutes = 1;

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
          Number(record.statusElapsedSeconds || 0) -
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
          Number(record.statusElapsedSeconds || 0)
        ) +
        ' ก่อนเข้าสีแดง'
      );
    }

    return (
      'เหลือ ' +
      formatCompactDuration(
        thresholds.warningSeconds -
        Number(record.statusElapsedSeconds || 0)
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
          Number(record.statusElapsedSeconds || 0)
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
          Number(record.statusElapsedSeconds || 0)
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

          await loadRecords({
              silentError: true,
              showSuccessToast: false,
              forceRender: false
            });
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
    const container = document.getElementById('moduleThresholdInfo');
    if (!container) return;

    const autoClose = getModuleThresholds();
    const effectiveSla =
      state.operationalBoard &&
      state.operationalBoard.effectiveSla ||
      {};
    const coverage = effectiveSla.coverage || {};

    setText('thresholdNormalText', 'ตามขั้นตอน');
    setText(
      'thresholdWarningText',
      Number(coverage.configuredCount) + '/' +
      Number(coverage.totalCount || 4) + ' กฎ'
    );
    setText('thresholdOverdueText', 'Admin กำหนด');
    setText('thresholdAutoCloseText', autoClose.autoCloseHours + ' ชั่วโมง');
    setText('controlNearAutoCloseLabel', 'ใกล้ครบ ' + autoClose.autoCloseHours + ' ชม.');
    setText('timelineAutoCloseLegend', 'ใกล้ครบ ' + autoClose.autoCloseHours + ' ชม.');
  }


  async function openThresholdInfo() {
    const effectiveSla =
      state.operationalBoard &&
      state.operationalBoard.effectiveSla ||
      {};
    const rules = Array.isArray(effectiveSla.rules)
      ? effectiveSla.rules
      : [];
    const autoClose = getModuleThresholds();
    const rows = rules.map((rule) => `
      <div data-status="${rule.configured ? 'NORMAL' : 'INCOMPLETE'}">
        <span>${escapeHtml(rule.label || rule.key || '-')}</span>
        <strong>${rule.configured
            ? escapeHtml(String(rule.warningMinutes)) +
              ' / ' +
              escapeHtml(String(rule.redMinutes)) +
              ' นาที'
            : 'ยังไม่ตั้งค่า'}
        </strong>
      </div>
    `);

    await Swal.fire({
      icon: 'info',
      title: 'เกณฑ์ SLA รายขั้นตอนจาก Admin',
      html: `
        <div class="threshold-info-dialog">
          ${rows.join('') || '<p>ยังไม่พบเกณฑ์ SLA</p>'}
          <div data-status="AUTO_CLOSE">
            <span>เคลียร์อัตโนมัติ</span>
            <strong>ครบ ${escapeHtml(String(autoClose.autoCloseHours))} ชั่วโมง</strong>
          </div>
          <p>
            สีของรถคำนวณจากเวลาที่เริ่มขั้นตอนปัจจุบัน ไม่ใช่เวลารวมตั้งแต่ Gate In
            · Rules Revision ${escapeHtml(state.rulesRevision || '-')}
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
      'focusCountAll',
      String(summary.total)
    );
    setText(
      'focusCountNormal',
      String(summary.normal)
    );
    setText(
      'focusCountWarning',
      String(summary.warning)
    );
    setText(
      'focusCountOverdue',
      String(summary.overdue)
    );
    setText(
      'mobileTabListCount',
      String(summary.total)
    );

    syncCriticalStatusUi();

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
            !recordMatchesOperationalStage(
              record
            )
          ) {
            return false;
          }

          if (
            !recordMatchesShiftFilter(
              record
            )
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
    syncCriticalStatusUi();
  }


  function normalizeOperationalRecord(record) {
    const item =
      record &&
      typeof record === 'object'
        ? record
        : {};

    if (!item.operationalStage) {
      item.operationalStage =
        item.receivingCompleteAt
          ? 'WAITING_DOCUMENT_RETURN'
          : 'WAITING_INBOUND_DOCUMENT';
    }

    if (!item.operationalStageLabel) {
      item.operationalStageLabel =
        getOperationalStageMeta(
          item.operationalStage
        ).label;
    }

    if (!Number.isFinite(
      Number(item.operationalStageOrder)
    )) {
      item.operationalStageOrder =
        getOperationalStageMeta(
          item.operationalStage
        ).order;
    }

    item.entryShift =
      item.entryShift &&
      typeof item.entryShift === 'object'
        ? item.entryShift
        : null;

    item.ownerShift =
      item.ownerShift &&
      typeof item.ownerShift === 'object'
        ? item.ownerShift
        : null;

    item.entryShiftCode =
      item.entryShiftCode ||
      item.entryShift &&
      item.entryShift.code ||
      '';

    item.ownerShiftCode =
      item.ownerShiftCode ||
      item.ownerShift &&
      item.ownerShift.code ||
      '';

    return item;
  }

  function recordMatchesOperationalStage(record) {
    const filter =
      String(
        state.operationalStageFilter ||
        'ALL'
      ).toUpperCase();

    return (
      filter === 'ALL' ||
      String(
        record.operationalStage || ''
      ).toUpperCase() === filter
    );
  }

  function recordMatchesShiftFilter(record) {
    const filter =
      String(
        state.shiftFilter ||
        'ALL'
      ).toUpperCase();

    if (filter === 'ALL') {
      return true;
    }

    if (filter === 'CURRENT') {
      const currentCode =
        state.operationalBoard &&
        state.operationalBoard.currentShift
          ? String(
              state.operationalBoard
                .currentShift.code || ''
            ).toUpperCase()
          : '';

      return Boolean(
        currentCode &&
        String(
          record.ownerShiftCode || ''
        ).toUpperCase() ===
          currentCode
      );
    }

    if (filter === 'CARRY_OVER') {
      return record.carryOver === true;
    }

    if (filter === 'UNSCHEDULED') {
      return !record.entryShiftCode;
    }

    return String(
      record.entryShiftCode || ''
    ).toUpperCase() === filter;
  }

  function getOperationalStageMeta(code) {
    const key =
      String(code || '').toUpperCase();

    const map = {
      WAITING_INBOUND_DOCUMENT: {
        label: 'รอ พขร.ยื่นเอกสาร',
        shortLabel: 'รอ พขร.ยื่นเอกสาร',
        description: 'รอ พขร.นำเอกสารไปยื่นที่ห้อง Inbound',
        order: 10
      },
      WAITING_RECEIVING: {
        label: 'รอรับสินค้าเสร็จ',
        shortLabel: 'รอรับสินค้า',
        description: 'พขร.ยื่นเอกสารแล้ว พร้อมบันทึกรับสินค้าเสร็จ',
        order: 20
      },
      WAITING_DOCUMENT_RETURN: {
        label: 'พขร.รอรับเอกสารคืน',
        shortLabel: 'พขร.รอเอกสารคืน',
        description: 'รับสินค้าเสร็จแล้ว พขร.รอรับเอกสารคืนจากห้อง Inbound',
        order: 30
      },
      WAITING_GATE_OUT: {
        label: 'รอ Gate Out',
        shortLabel: 'รอ Gate Out',
        description: 'พขร.รับเอกสารคืนแล้ว รอสแกน Gate Out จริง',
        order: 40
      },
      DATA_CONFLICT: {
        label: 'ข้อมูลขัดแย้ง',
        shortLabel: 'ข้อมูลขัดแย้ง',
        description: 'ให้ Admin ตรวจสอบข้อมูลที่ไม่สอดคล้องกัน',
        order: 90
      }
    };

    return map[key] || map.DATA_CONFLICT;
  }

  function renderOperationalBoard() {
    renderModuleSnapshotState();

    const board =
      state.operationalBoard || {};
    /*
     * จำนวนบนตัวกรองต้องคำนวณจาก Array เดียวกับที่ใช้วาดการ์ด
     * ห้ามใช้ Summary จาก Snapshot หาก state.records ถูกตัดรายการ Auto Close แล้ว
     */
    const summary =
      buildOperationalSummary(
        state.records
      );
    const stageCounts =
      summary.stages || {};

    setText(
      'operationalCountAll',
      String(summary.activeTotal || 0)
    );

    [
      'WAITING_INBOUND_DOCUMENT',
      'WAITING_RECEIVING',
      'WAITING_DOCUMENT_RETURN',
      'WAITING_GATE_OUT',
      'DATA_CONFLICT'
    ].forEach((code) => {
      const suffix =
        code
          .split('_')
          .map(
            (part) =>
              part.charAt(0) +
              part.slice(1).toLowerCase()
          )
          .join('');
      const countText =
        String(
          Number(stageCounts[code]) || 0
        );

      setText(
        'operationalCount' + suffix,
        countText
      );

      setText(
        'focusOperationalCount' + suffix,
        countText
      );
    });

    setText(
      'operationalCarryOverCount',
      String(summary.carryOver || 0)
    );
    setText(
      'mobileCriticalConflictCount',
      String(
        Number(stageCounts.DATA_CONFLICT) ||
        0
      )
    );
    setText(
      'mobileTabStageCount',
      String(
        (Number(stageCounts.WAITING_RECEIVING) || 0) +
        (Number(stageCounts.DATA_CONFLICT) || 0)
      )
    );
    setText(
      'mobileTabShiftCount',
      String(summary.carryOver || 0)
    );

    syncCriticalStatusUi();

    const currentShift =
      board.currentShift || null;

    setText(
      'operationalCurrentShift',
      currentShift
        ? 'กะปัจจุบัน ' +
          currentShift.code +
          ' · ' +
          currentShift.start +
          '–' +
          currentShift.end
        : 'ยังไม่ได้เปิดระบบกะหรือเวลาปัจจุบันไม่อยู่ในช่วงกะ'
    );

    setText(
      'operationalSnapshotTime',
      board.generatedAt
        ? 'Snapshot ' +
          board.generatedAt
        : 'กำลังใช้ข้อมูลรายการปัจจุบัน'
    );

    const integrityNode =
      document.getElementById(
        'operationalIntegrity'
      );
    const integrity =
      board.integrity || null;

    if (integrityNode) {
      const integrityOk =
        integrity &&
        integrity.success === true;
      const staleMode =
        state.boardHealth === 'STALE';
      const blockedMode =
        state.boardHealth === 'BLOCKED';

      integrityNode.dataset.state =
        staleMode
          ? 'FALLBACK'
          : blockedMode
            ? 'ERROR'
            : integrityOk
              ? 'OK'
              : 'ERROR';

      integrityNode.textContent =
        staleMode
          ? 'Snapshot สำรอง · ปิดการบันทึกชั่วคราว'
          : blockedMode
            ? 'ไม่พบ Snapshot ที่เชื่อถือได้'
            : integrityOk
              ? 'ข้อมูลครบถ้วน · 1 รายการต่อ 1 สถานะ'
              : 'พบข้อมูลไม่สมดุล · ปิดการบันทึกเพื่อความปลอดภัย';
    }

    renderOperationalShiftFilters();
    renderOperationalShiftSummaries();
    renderShiftHandover();
    syncOperationalFilterUi();
  }

  function buildOperationalSummary(records) {
    const list =
      Array.isArray(records)
        ? records
        : [];
    const stages = {
      WAITING_INBOUND_DOCUMENT: 0,
      WAITING_RECEIVING: 0,
      WAITING_DOCUMENT_RETURN: 0,
      WAITING_GATE_OUT: 0,
      DATA_CONFLICT: 0
    };

    list.forEach((record) => {
      const code =
        String(
          record.operationalStage ||
          'DATA_CONFLICT'
        ).toUpperCase();

      if (stages[code] === undefined) {
        stages.DATA_CONFLICT += 1;
      } else {
        stages[code] += 1;
      }
    });

    return {
      activeTotal: list.length,
      stages,
      carryOver:
        list.filter(
          (record) =>
            record.carryOver === true
        ).length
    };
  }

  function renderOperationalShiftFilters() {
    const container =
      document.getElementById(
        'operationalShiftFilters'
      );

    if (!container) {
      return;
    }

    const board =
      state.operationalBoard || {};
    const config =
      board.shiftConfig || {};
    const shifts =
      config.enabled === true &&
      Array.isArray(config.shifts)
        ? config.shifts
        : [];
    const counts = {};

    state.records.forEach((record) => {
      const code =
        String(
          record.entryShiftCode ||
          'UNSCHEDULED'
        ).toUpperCase();

      counts[code] =
        (counts[code] || 0) + 1;
    });

    const buttons = [
      {
        code: 'ALL',
        label: 'ทุกกะ',
        count: state.records.length
      },
      {
        code: 'CURRENT',
        label: 'กะปัจจุบัน',
        count:
          board.currentShift
            ? state.records.filter(
                (record) =>
                  String(
                    record.ownerShiftCode || ''
                  ).toUpperCase() ===
                  String(
                    board.currentShift.code || ''
                  ).toUpperCase()
              ).length
            : 0
      },
      ...shifts.map((shift) => ({
        code:
          String(
            shift.code || ''
          ).toUpperCase(),
        label:
          'กะ ' +
          String(
            shift.code || ''
          ).toUpperCase(),
        title:
          String(shift.name || '') +
          ' ' +
          String(shift.start || '') +
          '–' +
          String(shift.end || ''),
        count:
          counts[
            String(
              shift.code || ''
            ).toUpperCase()
          ] || 0
      })),
      {
        code: 'CARRY_OVER',
        label: 'ค้างข้ามกะ',
        count:
          state.records.filter(
            (record) =>
              record.carryOver === true
          ).length
      }
    ];

    if (
      state.records.some(
        (record) =>
          !record.entryShiftCode
      )
    ) {
      buttons.push({
        code: 'UNSCHEDULED',
        label: 'ไม่ทราบกะ',
        count: counts.UNSCHEDULED || 0
      });
    }

    container.innerHTML = '';

    buttons.forEach((item) => {
      const button =
        document.createElement(
          'button'
        );

      button.type = 'button';
      button.dataset.operationalShift =
        item.code;
      button.title = item.title || item.label;
      button.innerHTML =
        '<span>' +
        escapeHtml(item.label) +
        '</span><strong>' +
        escapeHtml(String(item.count)) +
        '</strong>';

      container.appendChild(button);
    });
  }

  function renderOperationalShiftSummaries() {
    const container =
      document.getElementById(
        'operationalShiftSummaryGrid'
      );

    if (!container) {
      return;
    }

    const summaries =
      state.operationalBoard &&
      Array.isArray(
        state.operationalBoard
          .shiftSummaries
      )
        ? state.operationalBoard
            .shiftSummaries
        : [];

    container.innerHTML = '';

    if (summaries.length === 0) {
      const empty =
        document.createElement(
          'div'
        );
      empty.className =
        'operational-shift-empty';
      empty.textContent =
        'ยังไม่ได้เปิดระบบกะสำหรับ Module นี้';
      container.appendChild(empty);
      return;
    }

    summaries.forEach((summary) => {
      const card =
        document.createElement(
          'article'
        );
      card.className =
        'operational-shift-card' +
        (
          summary.isCurrent
            ? ' is-current'
            : ''
        );

      const stage =
        summary.stages || {};

      card.innerHTML = `
        <header>
          <div>
            <small>${summary.isCurrent ? 'กะปัจจุบัน' : 'กะปฏิบัติงาน'}</small>
            <strong>กะ ${escapeHtml(summary.code || '-')} · ${escapeHtml(summary.name || '')}</strong>
          </div>
          <span>${escapeHtml(summary.start || '')}–${escapeHtml(summary.end || '')}</span>
        </header>
        <div class="operational-shift-card__metrics">
          <div><span>คงค้างต้นกะ</span><strong>${Number(summary.openingBalance) || 0}</strong></div>
          <div><span>Gate In</span><strong>${Number(summary.gateIn) || 0}</strong></div>
          <div><span>Gate Out จริง</span><strong>${Number(summary.gateOutActual) || 0}</strong></div>
          <div><span>Auto Close</span><strong>${Number(summary.autoClose) || 0}</strong></div>
          <div><span>คงค้างปลายกะ</span><strong>${Number(summary.closingBalance) || 0}</strong></div>
          <div><span>Active จากกะนี้</span><strong>${Number(summary.activeFromShift) || 0}</strong></div>
        </div>
        <div class="operational-shift-card__stages">
          <span>รอ พขร.ยื่น ${Number(stage.WAITING_INBOUND_DOCUMENT) || 0}</span>
          <span>รอรับ ${Number(stage.WAITING_RECEIVING) || 0}</span>
          <span>พขร.รอคืน ${Number(stage.WAITING_DOCUMENT_RETURN) || 0}</span>
          <span>รอออก ${Number(stage.WAITING_GATE_OUT) || 0}</span>
          <span>ขัดแย้ง ${Number(stage.DATA_CONFLICT) || 0}</span>
        </div>
      `;

      container.appendChild(card);
    });
  }

  function renderShiftHandover() {
    const panel =
      document.getElementById(
        'shiftHandoverPanel'
      );

    if (!panel) {
      return;
    }

    const board =
      state.operationalBoard || {};
    const handover =
      board.handover &&
      typeof board.handover === 'object'
        ? board.handover
        : {
            enabled: false,
            status: 'NOT_AVAILABLE',
            statusLabel:
              'ยังไม่พบข้อมูลส่งมอบอัตโนมัติ'
          };

    const status =
      String(
        handover.status ||
        'NOT_AVAILABLE'
      ).toUpperCase();
    const fromShift =
      handover.fromShift || {};
    const rawToShift =
      handover.toShift || {};
    const currentShift =
      board.currentShift || {};
    const activeShiftCount =
      board.shiftConfig &&
      Array.isArray(
        board.shiftConfig.shifts
      )
        ? board.shiftConfig.shifts
          .filter((shift) =>
            shift.active !== false
          ).length
        : 0;
    const fromCode =
      normalizeShiftCode(
        fromShift.code
      );
    const toCode =
      normalizeShiftCode(
        rawToShift.code
      );
    const sameShiftConflict = Boolean(
      activeShiftCount > 1 &&
      fromCode &&
      toCode &&
      fromCode === toCode
    );
    const pairValid =
      handover.pairValid !== false &&
      !sameShiftConflict;
    const toShift =
      pairValid
        ? rawToShift
        : currentShift;
    const effectiveStatus =
      pairValid
        ? status
        : 'PAIR_INVALID';

    panel.dataset.status =
      effectiveStatus;

    setText(
      'shiftHandoverStatus',
      pairValid
        ? handover.statusLabel || status
        : 'พบ Snapshot กะไม่ถูกต้อง · รอระบบซ่อมอัตโนมัติ'
    );
    setText(
      'mobileTabHandoverState',
      !pairValid
        ? '!'
        : handover.acknowledged === true
          ? '✓'
          : [
              'AUTO_FINALIZED',
              'ACKNOWLEDGED'
            ].includes(status)
            ? '!'
            : '–'
    );

    setText(
      'shiftHandoverFrom',
      fromShift.code
        ? formatShiftTitle(
            fromShift,
            fromShift.code
          )
        : '-'
    );

    setText(
      'shiftHandoverTo',
      toShift.code
        ? formatShiftTitle(
            toShift,
            toShift.code
          )
        : '-'
    );

    setText(
      'shiftHandoverUpdatedAt',
      handover.updatedAt ||
      handover.finalizedAt ||
      handover.draftAt ||
      handover.generatedAt ||
      '-'
    );

    const metricsNode =
      document.getElementById(
        'shiftHandoverMetrics'
      );

    const summary =
      handover.summary || {};
    const metrics =
      summary.metrics || {};

    if (metricsNode) {
      const metricItems = [
        ['คงค้างส่งต่อ', metrics.activeTotal],
        ['รอ พขร.ยื่นเอกสาร', metrics.waitingInboundDocument],
        ['รอรับสินค้า', metrics.waitingReceiving],
        ['พขร.รอเอกสารคืน', metrics.waitingDocumentReturn],
        ['รอ Gate Out', metrics.waitingGateOut],
        ['ข้อมูลขัดแย้ง', metrics.dataConflict],
        ['เกินเวลา', metrics.overdueAtEnd],
        ['ค้างข้ามกะ', metrics.carryOver]
      ];

      metricsNode.innerHTML =
        metricItems
          .map((item) => `
            <div>
              <span>${escapeHtml(item[0])}</span>
              <strong>${Number(item[1]) || 0}</strong>
            </div>
          `)
          .join('');
    }

    const noteParts = [];

    if (!pairValid) {
      noteParts.push(
        handover.pairWarning ||
        'Snapshot เดิมระบุกะส่งมอบและกะรับมอบเป็นกะเดียวกัน ระบบจะไม่ให้รับทราบรายการนี้'
      );
    }

    if (handover.note) {
      noteParts.push(
        'หมายเหตุส่งมอบ: ' +
        handover.note
      );
    }

    if (handover.acknowledged) {
      noteParts.push(
        'รับทราบโดย ' +
        (
          handover.acknowledgedBy ||
          '-'
        ) +
        (
          handover.acknowledgedAt
            ? ' · ' +
              handover.acknowledgedAt
            : ''
        )
      );

      if (handover.acknowledgementNote) {
        noteParts.push(
          'หมายเหตุรับมอบ: ' +
          handover.acknowledgementNote
        );
      }
    }

    setText(
      'shiftHandoverNote',
      noteParts.length
        ? noteParts.join(' | ')
        : 'ระบบส่งมอบอัตโนมัติ ผู้ใช้สามารถเพิ่มหมายเหตุได้โดยไม่กระทบงานหลัก'
    );

    const hasSnapshot = Boolean(
      handover.snapshotKey &&
      pairValid
    );
    const enabled =
      handover.enabled !== false;
    const finalized =
      pairValid &&
      [
        'AUTO_FINALIZED',
        'ACKNOWLEDGED'
      ].includes(status);

    const addNoteButton =
      document.getElementById(
        'shiftHandoverAddNote'
      );
    const acknowledgeButton =
      document.getElementById(
        'shiftHandoverAcknowledge'
      );
    const refreshButton =
      document.getElementById(
        'shiftHandoverRefresh'
      );

    if (addNoteButton) {
      addNoteButton.disabled =
        state.handoverInProgress ||
        !enabled ||
        !hasSnapshot;
    }

    if (acknowledgeButton) {
      acknowledgeButton.hidden =
        handover.acknowledged === true &&
        pairValid;
      acknowledgeButton.disabled =
        state.handoverInProgress ||
        !enabled ||
        !hasSnapshot ||
        !finalized;
      acknowledgeButton.title =
        !pairValid
          ? 'Snapshot กะไม่ถูกต้อง ระบบไม่อนุญาตให้รับทราบ'
          : !finalized
            ? 'รอระบบปิด Snapshot ส่งมอบอัตโนมัติก่อน'
            : 'บันทึกว่ากะปัจจุบันเปิดดูและรับทราบงานแล้ว';
    }

    if (refreshButton) {
      refreshButton.hidden =
        !isAdmin();
      refreshButton.disabled =
        state.handoverInProgress ||
        !enabled;
    }
  }


  async function handleShiftHandoverAction(
    action
  ) {
    if (
      state.handoverInProgress ||
      !API ||
      typeof API.updateShiftHandover !==
        'function'
    ) {
      return;
    }

    const handover =
      state.operationalBoard &&
      state.operationalBoard.handover ||
      {};

    const cleanAction =
      String(action || '')
        .trim()
        .toUpperCase();

    let note = '';

    if (cleanAction === 'ADD_NOTE') {
      const result =
        await Swal.fire({
          icon: 'info',
          title: 'หมายเหตุส่งมอบงาน',
          input: 'textarea',
          inputValue:
            handover.note || '',
          inputPlaceholder:
            'ระบุข้อมูลที่กะถัดไปควรทราบ',
          inputAttributes: {
            maxlength: '1000'
          },
          showCancelButton: true,
          confirmButtonText: 'บันทึกหมายเหตุ',
          cancelButtonText: 'ยกเลิก',
          reverseButtons: true
        });

      if (!result.isConfirmed) {
        return;
      }

      note =
        String(
          result.value || ''
        ).trim();
    }

    if (cleanAction === 'ACKNOWLEDGE') {
      const result =
        await Swal.fire({
          icon: 'question',
          title: 'รับทราบงานจากกะก่อน',
          text:
            'การรับทราบเป็นหลักฐานการเปิดดูเท่านั้น ไม่บล็อกการทำงานหลัก',
          input: 'textarea',
          inputPlaceholder:
            'หมายเหตุรับมอบ (ไม่บังคับ)',
          inputAttributes: {
            maxlength: '1000'
          },
          showCancelButton: true,
          confirmButtonText: 'รับทราบงาน',
          cancelButtonText: 'ยกเลิก',
          reverseButtons: true
        });

      if (!result.isConfirmed) {
        return;
      }

      note =
        String(
          result.value || ''
        ).trim();
    }

    if (cleanAction === 'REFRESH_SNAPSHOT') {
      const result =
        await Swal.fire({
          icon: 'warning',
          title: 'สร้าง Snapshot ใหม่',
          text:
            'ระบบจะคำนวณสถานะล่าสุดและอัปเดต Snapshot ส่งมอบของกะที่เกี่ยวข้อง',
          showCancelButton: true,
          confirmButtonText: 'สร้าง Snapshot',
          cancelButtonText: 'ยกเลิก',
          reverseButtons: true
        });

      if (!result.isConfirmed) {
        return;
      }
    }

    state.handoverInProgress = true;
    renderShiftHandover();

    try {
      const updated =
        await API.updateShiftHandover(
          state.moduleId,
          cleanAction,
          {
            snapshotKey:
              handover.snapshotKey || '',
            note: note
          }
        );

      if (
        state.operationalBoard &&
        updated
      ) {
        state.operationalBoard.handover =
          updated;
      }

      await Swal.fire({
        icon: 'success',
        title:
          cleanAction === 'ACKNOWLEDGE'
            ? 'รับทราบงานแล้ว'
            : cleanAction === 'ADD_NOTE'
              ? 'บันทึกหมายเหตุแล้ว'
              : 'อัปเดต Snapshot แล้ว',
        confirmButtonText: 'ตกลง',
        timer: 1300,
        timerProgressBar: true
      });

      await loadRecords({
        silentError: true,
        showSuccessToast: false,
        forceRender: true,
        forceRefresh: true
      });

    } catch (error) {
      await showApiError(
        error,
        'ดำเนินการส่งมอบงานไม่สำเร็จ'
      );

    } finally {
      state.handoverInProgress = false;
      renderShiftHandover();
    }
  }


  function syncOperationalFilterUi() {
    document
      .querySelectorAll(
        '[data-operational-stage]'
      )
      .forEach((button) => {
        const active =
          String(
            button.dataset
              .operationalStage ||
            'ALL'
          ).toUpperCase() ===
          String(
            state.operationalStageFilter ||
            'ALL'
          ).toUpperCase();

        button.classList.toggle(
          'is-active',
          active
        );
        button.setAttribute(
          'aria-pressed',
          active ? 'true' : 'false'
        );
      });

    document
      .querySelectorAll(
        '[data-operational-shift]'
      )
      .forEach((button) => {
        const active =
          String(
            button.dataset
              .operationalShift ||
            'ALL'
          ).toUpperCase() ===
          String(
            state.shiftFilter ||
            'ALL'
          ).toUpperCase();

        button.classList.toggle(
          'is-active',
          active
        );
        button.setAttribute(
          'aria-pressed',
          active ? 'true' : 'false'
        );
      });
  }

  function createOperationalStageBlock(record) {
    const meta =
      getOperationalStageMeta(
        record.operationalStage
      );
    const section =
      document.createElement(
        'section'
      );

    section.className =
      'vehicle-operational-stage';
    section.dataset.stage =
      record.operationalStage ||
      'DATA_CONFLICT';

    const heading =
      document.createElement('div');
    heading.className =
      'vehicle-operational-stage__heading';

    const title =
      document.createElement('strong');
    title.textContent =
      record.operationalStageLabel ||
      meta.label;

    const health =
      document.createElement('span');
    health.className =
      'vehicle-operational-health';
    health.dataset.health =
      record.dataHealthCode || 'OK';
    health.textContent =
      record.dataHealthLabel ||
      'ข้อมูลสอดคล้อง';

    heading.appendChild(title);
    heading.appendChild(health);

    const description =
      document.createElement('p');
    description.textContent =
      record.operationalStageDescription ||
      meta.description;

    const timeline =
      document.createElement('div');
    timeline.className =
      'vehicle-operational-stage__timeline';

    const stageTimes = [
      ['Gate In', record.timestampIn],
      ['พขร.ยื่นเอกสาร', record.documentSubmittedAt],
      ['รับสินค้าเสร็จ', record.receivingCompleteAt],
      ['พขร.รับเอกสารคืน', record.documentReturnedAt]
    ];

    stageTimes.forEach((item) => {
      const node =
        document.createElement('div');
      node.className =
        item[1]
          ? 'is-complete'
          : 'is-pending';
      node.innerHTML =
        '<span>' +
        escapeHtml(item[0]) +
        '</span><strong>' +
        escapeHtml(item[1] || '--:--:--') +
        '</strong>';
      timeline.appendChild(node);
    });

    const shifts =
      document.createElement('div');
    shifts.className =
      'vehicle-operational-stage__shifts';
    const currentShiftCode =
      record.currentShiftCode ||
      record.responsibleShiftCode ||
      record.ownerShiftCode ||
      '';

    shifts.innerHTML = `
      <span>กะที่รถเข้า <strong>${escapeHtml(record.entryShiftCode || '-')}</strong></span>
      <span>กะปัจจุบัน <strong>${escapeHtml(currentShiftCode || '-')}</strong></span>
      ${record.carryOver ? `<span class="is-carry">ส่งต่อ ${escapeHtml(record.entryShiftCode || '-')} → ${escapeHtml(currentShiftCode || '-')} <strong>${Number(record.carryOverShiftCount) || 1} ช่วงกะ</strong></span>` : ''}
    `;

    section.appendChild(heading);
    section.appendChild(description);
    section.appendChild(timeline);
    section.appendChild(shifts);

    if (
      record.receivingEnabled !== false
    ) {
      const actions =
        document.createElement('div');
      actions.className =
        'vehicle-operational-stage__actions';

      const button =
        document.createElement('button');
      button.type = 'button';
      button.className =
        'receiving-complete-button';
      button.dataset.recordId =
        record.recordId || '';
      button.dataset.canonicalRecordId =
        record.canonicalRecordId || '';
      button.dataset.sourceRowNumber =
        String(
          Number(record.sourceRowNumber) || 0
        );
      button.dataset.expectedTimestampIn =
        record.timestampIn || '';
      button.dataset.expectedTimestampInEpochMs =
        String(
          Number(record.timestampInEpochMs) || 0
        );
      button.dataset.expectedPrimaryValue =
        record.primaryValue || '';
      button.dataset.entryCode =
        record.autoId ||
        record.sourceAutoId ||
        '';
      button.dataset.operationalStage =
        record.operationalStage || '';
      button.dataset.canComplete =
        record.canCompleteReceiving
          ? 'TRUE'
          : 'FALSE';
      button.disabled =
        record.canCompleteReceiving !== true;
      button.setAttribute(
        'aria-disabled',
        button.disabled
          ? 'true'
          : 'false'
      );
      button.textContent =
        record.canCompleteReceiving
          ? 'บันทึกรับสินค้าเสร็จ'
          : meta.shortLabel;
      button.title =
        record.canCompleteReceiving
          ? 'บันทึกเวลารับสินค้าเสร็จ'
          : (
              record.operationalStageDescription ||
              meta.description
            );

      actions.appendChild(button);
      section.appendChild(actions);
    }

    return section;
  }

  function sortRecords(records) {
    const mode =
      String(
        state.sortMode ||
        'LONGEST'
      ).toUpperCase();

    records.sort(
      (left, right) => {
        if (mode === 'LONGEST') {
          const durationDelta =
            (Number(right.durationSeconds) || 0) -
            (Number(left.durationSeconds) || 0);

          if (durationDelta !== 0) {
            return durationDelta;
          }

          return (
            Number(left.timestampInEpochMs) || 0
          ) - (
            Number(right.timestampInEpochMs) || 0
          );
        }

        if (mode === 'NEWEST') {
          return (
            Number(right.timestampInEpochMs) || 0
          ) - (
            Number(left.timestampInEpochMs) || 0
          );
        }

        if (mode === 'APPOINTMENT') {
          return String(
            getPriorityIdentity(left)
              .appointmentNumber ||
            left.primaryValue ||
            ''
          ).localeCompare(
            String(
              getPriorityIdentity(right)
                .appointmentNumber ||
              right.primaryValue ||
              ''
            ),
            'th',
            {
              numeric: true,
              sensitivity: 'base'
            }
          );
        }

        if (mode === 'COMPANY') {
          return String(
            getPriorityIdentity(left)
              .companyName ||
            ''
          ).localeCompare(
            String(
              getPriorityIdentity(right)
                .companyName ||
              ''
            ),
            'th',
            {
              numeric: true,
              sensitivity: 'base'
            }
          );
        }

        const leftConflict =
          left.operationalStage ===
            'DATA_CONFLICT'
            ? 0
            : 1;
        const rightConflict =
          right.operationalStage ===
            'DATA_CONFLICT'
            ? 0
            : 1;

        if (leftConflict !== rightConflict) {
          return leftConflict - rightConflict;
        }

        const leftScore =
          Number.isFinite(
            Number(left.priorityScore)
          )
            ? Number(left.priorityScore)
            : 999999999999;
        const rightScore =
          Number.isFinite(
            Number(right.priorityScore)
          )
            ? Number(right.priorityScore)
            : 999999999999;

        if (leftScore !== rightScore) {
          return leftScore - rightScore;
        }

        const leftOperationalOrder =
          Number(left.operationalStageOrder) ||
          50;
        const rightOperationalOrder =
          Number(right.operationalStageOrder) ||
          50;

        if (
          leftOperationalOrder !==
          rightOperationalOrder
        ) {
          return leftOperationalOrder -
            rightOperationalOrder;
        }

        return (
          Number(left.timestampInEpochMs) || 0
        ) - (
          Number(right.timestampInEpochMs) || 0
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


  function isAppointmentFieldLabel(value) {
    const label =
      normalizeFieldLabel(value);

    return (
      label.includes('เลขนัดหมาย') ||
      label.includes('หมายเลขนัดหมาย') ||
      label.includes('appointment') ||
      label.includes('bookingnumber') ||
      label === 'booking'
    );
  }


  function isCompanyFieldLabel(value) {
    const label =
      normalizeFieldLabel(value);

    return (
      label.includes('บริษัท') ||
      label.includes('company') ||
      label.includes('vendor') ||
      label.includes('supplier')
    );
  }


  function getPriorityIdentity(record) {
    const data =
      record &&
      typeof record === 'object'
        ? record
        : {};

    const result = {
      appointmentNumber:
        String(
          data.appointmentNumber ||
          data.appointment ||
          ''
        ).trim(),
      companyName:
        String(
          data.companyName ||
          data.company ||
          ''
        ).trim()
    };

    const fields =
      Array.isArray(data.fields)
        ? data.fields
        : [];

    fields.forEach((field) => {
      const label =
        field &&
        (
          field.label ||
          field.displayName ||
          field.name
        );
      const value =
        String(
          field && field.value ||
          ''
        ).trim();

      if (!value) {
        return;
      }

      if (
        !result.appointmentNumber &&
        isAppointmentFieldLabel(label)
      ) {
        result.appointmentNumber =
          value;
      }

      if (
        !result.companyName &&
        isCompanyFieldLabel(label)
      ) {
        result.companyName =
          value;
      }
    });

    const primaryLabel =
      getPrimaryLabel(data);
    const primaryValue =
      String(
        data.primaryValue || ''
      ).trim();

    if (
      !result.appointmentNumber &&
      primaryValue &&
      isAppointmentFieldLabel(
        primaryLabel
      )
    ) {
      result.appointmentNumber =
        primaryValue;
    }

    if (
      !result.companyName &&
      primaryValue &&
      isCompanyFieldLabel(
        primaryLabel
      )
    ) {
      result.companyName =
        primaryValue;
    }

    return result;
  }


  function isPriorityIdentityField(
    field,
    identity
  ) {
    const label =
      field &&
      (
        field.label ||
        field.displayName ||
        field.name
      );
    const value =
      normalizeComparableText(
        field && field.value
      );

    return (
      isAppointmentFieldLabel(label) ||
      isCompanyFieldLabel(label) ||
      (
        identity.appointmentNumber &&
        value ===
          normalizeComparableText(
            identity.appointmentNumber
          )
      ) ||
      (
        identity.companyName &&
        value ===
          normalizeComparableText(
            identity.companyName
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

    const priorityIdentity =
      getPriorityIdentity(record);

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

          if (
            isPriorityIdentityField(
              field,
              priorityIdentity
            )
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
    const priorityIdentity =
      getPriorityIdentity(record);

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

    article.dataset.canonicalRecordId =
      record.canonicalRecordId || '';

    article.dataset.operationalStage =
      record.operationalStage ||
      'DATA_CONFLICT';

    article.dataset.entryShift =
      record.entryShiftCode || '';

    article.dataset.ownerShift =
      record.ownerShiftCode || '';

    article.dataset.carryOver =
      record.carryOver
        ? 'TRUE'
        : 'FALSE';

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
        priorityIdentity.appointmentNumber ||
        priorityIdentity.companyName ||
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
      priorityIdentity.appointmentNumber
        ? 'เลขนัดหมาย'
        : getPrimaryLabel(record);

    const title =
      document.createElement(
        'h2'
      );

    title.className =
      'vehicle-card__title vehicle-card__appointment';

    title.textContent =
      priorityIdentity.appointmentNumber ||
      record.primaryValue ||
      'ไม่พบเลขนัดหมาย';

    const companyLabel =
      document.createElement(
        'span'
      );
    companyLabel.className =
      'vehicle-card__company-label';
    companyLabel.textContent =
      'บริษัท';

    const company =
      document.createElement(
        'p'
      );
    company.className =
      'vehicle-card__company';
    company.textContent =
      priorityIdentity.companyName ||
      'ไม่พบชื่อบริษัท';

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
      companyLabel
    );

    titleWrap.appendChild(
      company
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
      getRecordStageThresholds(
        record,
        getCurrentServerTimeMs()
      );

    progressLabels.innerHTML = thresholds.configured
      ? `
          <span>เริ่มขั้นตอน</span>
          <span>เฝ้าระวัง ${escapeHtml(String(thresholds.warningMinutes))} นาที</span>
          <span>เกินเวลา ${escapeHtml(String(thresholds.redMinutes))} นาที</span>
        `
      : `
          <span>เริ่มขั้นตอน</span>
          <span>ยังไม่ตั้งเกณฑ์</span>
          <span>ตรวจสอบใน Admin</span>
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

    const operationalBlock =
      createOperationalStageBlock(
        record
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

    if (operationalBlock) {
      article.appendChild(
        operationalBlock
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



  function normalizeShiftCode(value) {
    return String(value || '')
      .trim()
      .replace(/^กะ\s*/i, '')
      .trim()
      .toUpperCase();
  }

  function formatShiftTitle(
    shift,
    fallbackCode
  ) {
    const data =
      shift && typeof shift === 'object'
        ? shift
        : {};
    const code = normalizeShiftCode(
      data.code ||
      data.shiftCode ||
      fallbackCode ||
      ''
    );
    const rawName = String(
      data.name ||
      data.shiftName ||
      ''
    ).trim();
    const normalizedName =
      normalizeShiftCode(rawName);
    const meaningfulName =
      rawName &&
      normalizedName !== code
        ? rawName
        : '';

    if (!code) {
      return '-';
    }

    return (
      'กะ ' + code +
      (
        meaningfulName
          ? ' · ' + meaningfulName
          : ''
      )
    );
  }

  function formatShiftWindow(shift) {
    const data =
      shift && typeof shift === 'object'
        ? shift
        : {};
    const start = String(
      data.start || ''
    ).trim();
    const end = String(
      data.end || ''
    ).trim();
    const businessDate = String(
      data.businessDate || ''
    ).trim();
    const parts = [];

    if (start || end) {
      parts.push(
        (start || '--:--') +
        '–' +
        (end || '--:--')
      );
    }

    if (businessDate) {
      parts.push(
        'วันปฏิบัติงาน ' +
        businessDate
      );
    }

    return parts.join(' · ') ||
      'ไม่พบช่วงเวลากะ';
  }

  function buildRecordShiftPresentation(record) {
    const board =
      state.operationalBoard || {};
    const entryShift =
      record.entryShift &&
      typeof record.entryShift === 'object'
        ? record.entryShift
        : {};
    const currentShift =
      record.currentShift &&
      typeof record.currentShift === 'object'
        ? record.currentShift
        : record.responsibleShift &&
          typeof record.responsibleShift === 'object'
          ? record.responsibleShift
          : board.currentShift &&
            typeof board.currentShift === 'object'
            ? board.currentShift
            : record.ownerShift &&
              typeof record.ownerShift === 'object'
              ? record.ownerShift
              : {};
    const entryCode = normalizeShiftCode(
      entryShift.code ||
      record.entryShiftCode ||
      ''
    );
    const currentCode = normalizeShiftCode(
      currentShift.code ||
      record.currentShiftCode ||
      record.responsibleShiftCode ||
      record.ownerShiftCode ||
      ''
    );
    const transitionCount = Math.max(
      0,
      Number(
        record.carryOverShiftCount
      ) || 0
    );
    const carryOver = Boolean(
      record.carryOver ||
      (
        entryCode &&
        currentCode &&
        entryCode !== currentCode
      )
    );

    let transitionText =
      'ยังไม่สามารถระบุการส่งต่องานได้';
    let transitionDetail =
      'ตรวจสอบการตั้งค่ากะในหน้า Admin';

    if (entryCode && currentCode) {
      if (carryOver) {
        transitionText =
          'กะ ' + entryCode +
          ' → กะ ' + currentCode;
        transitionDetail =
          Math.max(1, transitionCount) +
          ' ช่วงกะ';
      } else {
        transitionText =
          'อยู่ภายในกะ ' +
          currentCode +
          ' เดียวกัน';
        transitionDetail =
          'ยังไม่ผ่านจุดเปลี่ยนกะ';
      }
    }

    return {
      entryTitle:
        formatShiftTitle(
          entryShift,
          entryCode
        ),
      entryWindow:
        formatShiftWindow(
          entryShift
        ),
      currentTitle:
        formatShiftTitle(
          currentShift,
          currentCode
        ),
      currentWindow:
        formatShiftWindow(
          currentShift
        ),
      transitionText:
        transitionText,
      transitionDetail:
        transitionDetail,
      carryOver:
        carryOver
    };
  }

  function buildRecordTimeline(record) {
    const hasDocument = Boolean(
      record.documentSubmittedAt
    );
    const hasReceiving = Boolean(
      record.receivingCompleteAt ||
      record.workflowReceivingCompletedAt
    );
    const hasReturn = Boolean(
      record.documentReturnedAt
    );

    return [
      {
        label: 'Gate In',
        value:
          record.timestampIn ||
          'ไม่พบเวลา Gate In',
        state:
          record.timestampIn
            ? 'complete'
            : 'pending'
      },
      {
        label: 'พขร.ยื่นเอกสาร',
        value:
          record.documentSubmittedAt ||
          'รอดำเนินการ',
        state:
          hasDocument
            ? 'complete'
            : 'pending'
      },
      {
        label: 'รับสินค้าเสร็จ',
        value:
          record.receivingCompleteAt ||
          record.workflowReceivingCompletedAt ||
          (
            hasDocument
              ? 'รอดำเนินการ'
              : 'ยังไม่พร้อมดำเนินการ'
          ),
        state:
          hasReceiving
            ? 'complete'
            : hasDocument
              ? 'pending'
              : 'blocked'
      },
      {
        label: 'พขร.รับเอกสารคืน',
        value:
          record.documentReturnedAt ||
          (
            hasReceiving
              ? 'รอดำเนินการ'
              : 'ยังไม่พร้อมดำเนินการ'
          ),
        state:
          hasReturn
            ? 'complete'
            : hasReceiving
              ? 'pending'
              : 'blocked'
      }
    ];
  }

  function openRecordDetail(record) {
    const identity =
      getPriorityIdentity(record);
    const stageMeta =
      getOperationalStageMeta(
        record.operationalStage
      );
    const appointment =
      identity.appointmentNumber ||
      record.primaryValue ||
      'ไม่พบเลขนัดหมาย';
    const company =
      identity.companyName ||
      'ไม่พบชื่อบริษัท';
    const shiftPresentation =
      buildRecordShiftPresentation(
        record
      );

    const fields =
      getDisplayFields(
        record,
        {
          excludeTimestampIn: true
        }
      ).filter((field) => {
        const label =
          normalizeFieldLabel(
            field.label ||
            field.displayName ||
            ''
          );
        return ![
          'เลขนัดหมาย',
          'หมายเลขนัดหมาย',
          'appointment',
          'บริษัท',
          'ชื่อบริษัท',
          'company'
        ].includes(label);
      });

    const fieldHtml =
      fields
        .map(
          (field) => `
            <div class="record-action-row">
              <span>${escapeHtml(field.label || field.displayName || '-')}</span>
              <strong>${escapeHtml(field.value || '-')}</strong>
            </div>
          `
        )
        .join('');

    const timelineHtml =
      buildRecordTimeline(record)
        .map((item, index) => `
          <div class="record-action-timeline__item is-${escapeHtml(item.state)}">
            <b class="record-action-timeline__index">${index + 1}</b>
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
          </div>
        `)
        .join('');

    let disabledReceivingLabel =
      stageMeta.shortLabel;

    if (
      record.operationalStage ===
      'WAITING_INBOUND_DOCUMENT'
    ) {
      disabledReceivingLabel =
        'รอ พขร.ยื่นเอกสารก่อน';
    } else if (
      record.operationalStage ===
      'DATA_CONFLICT'
    ) {
      disabledReceivingLabel =
        'ข้อมูลขัดแย้ง — ติดต่อ Admin';
    }

    const receivingButton =
      record.receivingEnabled === false
        ? ''
        : `
          <button
            type="button"
            class="record-action-primary receiving-complete-button"
            data-record-id="${escapeHtml(record.recordId || '')}"
            data-canonical-record-id="${escapeHtml(record.canonicalRecordId || '')}"
            data-source-row-number="${Number(record.sourceRowNumber) || 0}"
            data-expected-timestamp-in="${escapeHtml(record.timestampIn || '')}"
            data-expected-timestamp-in-epoch-ms="${Number(record.timestampInEpochMs) || 0}"
            data-expected-primary-value="${escapeHtml(record.primaryValue || '')}"
            data-entry-code="${escapeHtml(record.autoId || record.sourceAutoId || '')}"
            data-operational-stage="${escapeHtml(record.operationalStage || '')}"
            data-can-complete="${record.canCompleteReceiving ? 'TRUE' : 'FALSE'}"
            ${record.canCompleteReceiving ? '' : 'disabled aria-disabled="true"'}
            title="${escapeHtml(record.operationalStageDescription || stageMeta.description)}"
          >
            ${escapeHtml(
              record.canCompleteReceiving
                ? 'บันทึกรับสินค้าเสร็จ'
                : disabledReceivingLabel
            )}
          </button>
        `;

    const checkoutButton =
      record.canCheckout &&
      isAdmin()
        ? `
          <button
            id="recordDetailCheckoutButton"
            type="button"
            class="record-action-secondary"
          >
            บันทึกออกพื้นที่
          </button>
        `
        : '';

    Swal.fire({
      width: 760,
      position:
        isMobileViewport()
          ? 'bottom'
          : 'center',
      title: '',
      html: `
        <article class="record-action-sheet" data-status="${escapeHtml(record.statusCode || 'INCOMPLETE')}">
          <header class="record-action-sheet__identity">
            <div>
              <span>เลขนัดหมาย</span>
              <strong>${escapeHtml(appointment)}</strong>
            </div>
            <div>
              <span>บริษัท</span>
              <h2>${escapeHtml(company)}</h2>
            </div>
          </header>

          <div class="record-action-sheet__status">
            <span data-status="${escapeHtml(record.statusCode || 'INCOMPLETE')}">${escapeHtml(record.statusLabel || '-')}</span>
            <strong>${escapeHtml(record.durationDisplay || '--:--:--')}</strong>
          </div>

          <section class="record-action-sheet__stage">
            <div>
              <span>ขั้นตอนปัจจุบัน</span>
              <strong>${escapeHtml(record.operationalStageLabel || stageMeta.label)}</strong>
            </div>
            <p>${escapeHtml(record.operationalStageDescription || stageMeta.description)}</p>
          </section>

          <section class="record-action-timeline">
            ${timelineHtml}
          </section>

          <section class="record-action-shifts">
            <div class="record-action-shift-card">
              <span>กะที่รถเข้า</span>
              <strong>${escapeHtml(shiftPresentation.entryTitle)}</strong>
              <small>${escapeHtml(shiftPresentation.entryWindow)}</small>
            </div>
            <div class="record-action-shift-card is-current">
              <span>กะปัจจุบัน</span>
              <strong>${escapeHtml(shiftPresentation.currentTitle)}</strong>
              <small>${escapeHtml(shiftPresentation.currentWindow)}</small>
            </div>
            <div class="record-action-shift-card is-handover">
              <span>การส่งต่องาน</span>
              <strong>${escapeHtml(shiftPresentation.transitionText)}</strong>
              <small>${escapeHtml(shiftPresentation.transitionDetail)}</small>
            </div>
          </section>

          <section class="record-action-details">
            <div class="record-action-row">
              <span>เวลาเข้าพื้นที่</span>
              <strong>${escapeHtml(record.timestampIn || '-')}</strong>
            </div>
            ${fieldHtml}
          </section>

          <footer class="record-action-sheet__actions">
            ${receivingButton}
            ${checkoutButton}
          </footer>
        </article>
      `,
      showConfirmButton: true,
      confirmButtonText: 'ปิด',
      showCloseButton: true,
      heightAuto: false,
      customClass: {
        popup: 'record-action-popup',
        htmlContainer: 'record-action-html',
        actions: 'record-action-close-actions',
        confirmButton: 'record-action-close-button'
      },
      didOpen: (popup) => {
        const checkout =
          popup.querySelector(
            '#recordDetailCheckoutButton'
          );

        checkout?.addEventListener(
          'click',
          async () => {
            Swal.close();
            await handleCheckout(
              record,
              checkout
            );
          }
        );
      }
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

  function handleOperationalAlertToggleClick(event) {
    const target =
      event && event.target &&
      typeof event.target.closest === 'function'
        ? event.target.closest(
            '#operationalAlertToggle'
          )
        : null;

    if (!target) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (
      window.AlertVendorOperationalAlert &&
      typeof window.AlertVendorOperationalAlert.toggle ===
        'function'
    ) {
      window.AlertVendorOperationalAlert.toggle();
    }
  }


  function initializeOperationalAlertPreference() {
    state.operationalAlertStorageKey =
      buildOperationalAlertStorageKey();

    let enabled = true;

    try {
      const stored =
        window.localStorage.getItem(
          state.operationalAlertStorageKey
        );

      if (stored !== null) {
        enabled =
          stored !== '0' &&
          stored !== 'false' &&
          stored !== 'OFF';
      }
    } catch (error) {
      enabled = true;
    }

    setOperationalAlertEnabled(
      enabled,
      {
        persist: false,
        emit: true,
        forceEmit: true
      }
    );
  }

  function buildOperationalAlertStorageKey() {
    const user =
      state.session &&
      state.session.user
        ? state.session.user
        : {};

    const rawUserKey =
      user.id ||
      user.userId ||
      user.username ||
      user.email ||
      user.displayName ||
      'anonymous';

    const safeUserKey =
      String(rawUserKey)
        .trim()
        .toLowerCase()
        .replace(
          /[^a-z0-9ก-๙@._-]+/gi,
          '_'
        ) ||
      'anonymous';

    return [
      OPERATIONAL_ALERT_STORAGE_PREFIX,
      state.moduleId || 'unknown-module',
      safeUserKey
    ].join(':');
  }

  function isOperationalAlertEnabled() {
    return state.operationalAlertEnabled !== false;
  }

  function setOperationalAlertEnabled(
    enabled,
    options = {}
  ) {
    const nextEnabled =
      enabled !== false;

    const changed =
      state.operationalAlertEnabled !==
      nextEnabled;

    state.operationalAlertEnabled =
      nextEnabled;

    if (
      options.persist !== false &&
      state.operationalAlertStorageKey
    ) {
      try {
        window.localStorage.setItem(
          state.operationalAlertStorageKey,
          nextEnabled ? '1' : '0'
        );
      } catch (error) {
        // Browser may block localStorage in privacy mode.
      }
    }

    syncOperationalAlertToggle();

    if (
      options.emit !== false &&
      (
        changed ||
        options.forceEmit === true
      )
    ) {
      document.dispatchEvent(
        new CustomEvent(
          'alertvendor:operational-alert-changed',
          {
            detail: {
              enabled: nextEnabled,
              moduleId: state.moduleId
            }
          }
        )
      );
    }
  }

  function syncOperationalAlertToggle() {
    const button =
      document.getElementById(
        'operationalAlertToggle'
      );

    const status =
      document.getElementById(
        'operationalAlertToggleStatus'
      );

    const icon =
      document.getElementById(
        'operationalAlertToggleIcon'
      );

    const enabled =
      isOperationalAlertEnabled();

    if (button) {
      button.classList.toggle(
        'is-enabled',
        enabled
      );

      button.classList.toggle(
        'is-disabled',
        !enabled
      );

      button.setAttribute(
        'aria-checked',
        enabled ? 'true' : 'false'
      );

      button.dataset.state =
        enabled ? 'ON' : 'OFF';

      button.disabled = false;

      button.setAttribute(
        'aria-label',
        enabled
          ? 'ปิดการแจ้งเตือนอัตโนมัติ'
          : 'เปิดการแจ้งเตือนอัตโนมัติ'
      );

      button.title =
        enabled
          ? 'การแจ้งเตือนเปิดอยู่ — กดเพื่อปิด'
          : 'การแจ้งเตือนปิดอยู่ — กดเพื่อเปิด';
    }

    if (icon) {
      icon.textContent =
        enabled ? '🔔' : '🔕';
    }

    if (status) {
      status.textContent =
        enabled ? 'เปิด' : 'ปิด';

      status.setAttribute(
        'aria-hidden',
        'true'
      );
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();

    state.revisionPollFailures = 0;
    state.revisionPollDelayMs = REVISION_POLL_MIN_MS;

    if (
      document.visibilityState === 'visible' &&
      navigator.onLine &&
      !state.destroyed
    ) {
      scheduleNextRevisionCheck(REVISION_POLL_MIN_MS);
    }

    updateAutoRefreshStatus();
  }

  function stopAutoRefresh() {
    if (state.refreshTimer) {
      window.clearTimeout(state.refreshTimer);
      state.refreshTimer = null;
    }
  }

  function scheduleNextRevisionCheck(delayMs) {
    stopAutoRefresh();

    if (
      state.destroyed ||
      document.visibilityState !== 'visible' ||
      !navigator.onLine
    ) {
      return;
    }

    const delay = Math.max(
      250,
      Number(delayMs) || state.revisionPollDelayMs || REVISION_POLL_MIN_MS
    );

    state.refreshTimer = window.setTimeout(
      () => {
        state.refreshTimer = null;
        void checkOperationalBoardRevision();
      },
      delay
    );
  }

  function hasActiveCardWrite() {
    return Boolean(
      document.querySelector(
        '.vehicle-card[data-receiving-save-state], .vehicle-card[aria-busy="true"]'
      )
    );
  }

  function resetRevisionBackoff() {
    state.revisionPollFailures = 0;
    state.revisionPollDelayMs = REVISION_POLL_MIN_MS;
  }

  function increaseRevisionBackoff() {
    state.revisionPollFailures = Math.min(
      6,
      Number(state.revisionPollFailures || 0) + 1
    );

    state.revisionPollDelayMs = Math.min(
      REVISION_POLL_MAX_MS,
      REVISION_POLL_MIN_MS * Math.pow(2, state.revisionPollFailures)
    );
  }

  async function checkOperationalBoardRevision() {
    if (
      state.revisionCheckInProgress ||
      state.refreshInProgress ||
      state.destroyed ||
      !navigator.onLine ||
      document.visibilityState !== 'visible'
    ) {
      scheduleNextRevisionCheck(state.revisionPollDelayMs);
      return;
    }

    state.revisionCheckInProgress = true;
    state.revisionPollLastAt = Date.now();

    try {
      const revision = await API.getOperationalBoard(
        state.moduleId,
        {
          revisionOnly: true,
          knownRevision: state.dataRevision || ''
        }
      );

      resetRevisionBackoff();

      if (
        revision &&
        revision.unchanged === true
      ) {
        return;
      }

      /*
       * ห้ามโหลด Full Snapshot ทับการ์ดที่กำลัง Commit/Verify อยู่
       * การ์ดอื่นยังใช้งานต่อได้ และจะตรวจ Revision ใหม่ในรอบถัดไป
       */
      if (hasActiveCardWrite()) {
        scheduleNextRevisionCheck(REVISION_POLL_MIN_MS);
        return;
      }

      await loadRecords({
        silentError: true,
        showSuccessToast: false,
        forceRender: false,
        forceRefresh: true,
        background: true
      });
    } catch (error) {
      increaseRevisionBackoff();
      console.warn(
        'ตรวจ Board Revision ไม่สำเร็จ จะลองใหม่แบบ Adaptive Backoff',
        error
      );
    } finally {
      state.revisionCheckInProgress = false;

      if (!state.destroyed) {
        scheduleNextRevisionCheck(state.revisionPollDelayMs);
      }
    }
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
    if (state.alertRunning || state.serverAlertCheckInProgress || !state.module || !state.module.alertEnabled || !isOperationalAlertEnabled()) return;
    const now = Date.now();
    if (now - state.lastServerAlertCheckAt < 15000) return;
    state.lastServerAlertCheckAt = now;
    state.serverAlertCheckInProgress = true;
    try {
      const result = await API.getInboundWorkflowSlaAlerts(state.moduleId, {
        limit: 50,
        sinceEpochMs: state.lastServerAlertDeliveryEpochMs,
        evaluate: true
      });
      const deliveries = result && Array.isArray(result.deliveries) ? result.deliveries : [];
      if (Number(result && result.latestDeliveryEpochMs) > state.lastServerAlertDeliveryEpochMs) {
        state.lastServerAlertDeliveryEpochMs = Number(result.latestDeliveryEpochMs);
      }
      const overdueDeliveries = deliveries.filter((row) => String(row['ระดับ'] || '').toUpperCase() === 'OVERDUE');
      if (!overdueDeliveries.length) return;
      const active = result && Array.isArray(result.activeAlerts) ? result.activeAlerts : [];
      const keys = new Set(overdueDeliveries.map((row) => String(row['รหัสแจ้งเตือน'] || '')));
      const alerts = active.filter((row) => keys.has(String(row['รหัสแจ้งเตือน'] || ''))).slice(0, 8);
      state.alertRunning = true;
      notifyDevice();
      const html = document.createElement('div'); html.className = 'overdue-alert-list';
      (alerts.length ? alerts : overdueDeliveries).slice(0, 8).forEach((row) => {
        const item = document.createElement('div'); item.className = 'overdue-alert-item';
        const title = document.createElement('strong'); title.textContent = row['บริษัท'] || row['ข้อความ'] || 'พบรายการเกินเวลา';
        const detail = document.createElement('span'); detail.textContent = [row['ชื่อขั้นตอน'] || row['ขั้นตอน'] || '', row['เลขนัดหมาย'] ? ('นัดหมาย ' + row['เลขนัดหมาย']) : '', row['เวลาค้าง (วินาที)'] ? ('ค้าง ' + Math.floor(Number(row['เวลาค้าง (วินาที)']) / 60) + ' นาที') : ''].filter(Boolean).join(' • ');
        item.appendChild(title); item.appendChild(detail); html.appendChild(item);
      });
      await Swal.fire({ icon: 'warning', title: 'Alert Engine พบงานเกินเวลา', html, confirmButtonText: 'รับทราบ', allowOutsideClick: false });
    } catch (error) {
      console.warn('โหลด Server Alert ไม่สำเร็จ ใช้ Local Fallback', error);
      await checkOverdueAlertsLocalFallback();
    } finally {
      state.serverAlertCheckInProgress = false;
      state.alertRunning = false;
    }
  }

  async function checkOverdueAlertsLocalFallback() {
    const now = Date.now();
    const overdueRecords = state.records.filter((record) => {
      if (record.statusCode !== 'OVERDUE') return false;
      const repeatMinutes = Math.max(1, Number(record.stageSla && record.stageSla.repeatMinutes) || 10);
      const key = getAlertStorageKey(record.recordId);
      const lastShown = Number(sessionStorage.getItem(key) || 0);
      return now - lastShown >= repeatMinutes * 60 * 1000;
    });
    if (!overdueRecords.length) return;
    overdueRecords.forEach((record) => sessionStorage.setItem(getAlertStorageKey(record.recordId), String(now)));
    notifyDevice();
    const html = document.createElement('div'); html.className = 'overdue-alert-list';
    overdueRecords.slice(0, 5).forEach((record) => {
      const item = document.createElement('div'); item.className = 'overdue-alert-item';
      const title = document.createElement('strong'); title.textContent = record.primaryValue || record.companyName || 'ไม่พบข้อมูลหลัก';
      const detail = document.createElement('span'); detail.textContent = (record.operationalStageLabel || '') + ' • ' + (record.statusLabel || 'เกินเวลา');
      item.appendChild(title); item.appendChild(detail); html.appendChild(item);
    });
    await Swal.fire({ icon: 'warning', title: 'พบงานเกินเวลา', html, confirmButtonText: 'รับทราบ', allowOutsideClick: false });
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

      await loadRecords({
          silentError: false,
          showSuccessToast: false,
          forceRender: true
        });

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
        await loadRecords({
            silentError: true,
            showSuccessToast: false,
            forceRender: true
          });
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


  window.VehicleModule = Object.freeze({
    refreshOperationalBoard(
      forceRefresh
    ) {
      return loadRecords({
        silentError: true,
        showSuccessToast: false,
        forceRender: true,
        forceRefresh:
          forceRefresh !== false
      });
    },

    getRecord(recordId) {
      return state.records.find(
        (record) =>
          String(record.recordId || '') ===
          String(recordId || '')
      ) || null;
    },

    getOperationalBoard() {
      return state.operationalBoard;
    },

    getBoardState() {
      const health = String(
        document.body.dataset.boardHealth ||
        state.boardHealth ||
        'BLOCKED'
      ).toUpperCase();

      return {
        health,
        writable: health === 'LIVE',
        generatedAt:
          state.operationalBoard &&
          state.operationalBoard.generatedAt ||
          '',
        integrity:
          state.operationalBoard &&
          state.operationalBoard.integrity ||
          null
      };
    }
  });

  function destroyPage() {
    state.destroyed = true;
    stopAutoRefresh();

    [
      state.clockTimer,
      state.durationTimer,
      state.autoClosePersistTimer,
      state.timelineSnapTimer
    ].forEach((timer) => {
      if (timer) {
        window.clearInterval(timer);
      }
    });
  }

})(window, document);
