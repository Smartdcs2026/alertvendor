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
 */
(function (window, document) {
  'use strict';

  const CONFIG = window.APP_CONFIG || {};
  const API = window.VehicleAPI;

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
    cardNodes: new Map(),
    alertRunning: false,
    userInteracted: false,
    destroyed: false
  };

  document.addEventListener('DOMContentLoaded', initializePage);
  window.addEventListener('beforeunload', destroyPage);
  document.addEventListener('pointerdown', markUserInteraction, { once: true });
  document.addEventListener('keydown', markUserInteraction, { once: true });

  async function initializePage() {
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

    const searchInput =
      document.getElementById(
        'searchInput'
      );

    const statusFilter =
      document.getElementById(
        'statusFilter'
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

    document.addEventListener(
      'visibilitychange',
      async () => {
        if (
          document.visibilityState ===
            'visible' &&
          !state.refreshInProgress &&
          state.hasLoadedRecords
        ) {
          await loadRecords({
            silentError: true,
            showSuccessToast: false,
            forceRender: false
          });
        }
      }
    );
  }

  function markUserInteraction() {
    state.userInteracted = true;
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
      }

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
      !Number.isFinite(Number(record.timestampInEpochMs))
    ) {
      return;
    }

    const durationSeconds = Math.max(
      0,
      Math.floor(
        (
          nowMs -
          Number(record.timestampInEpochMs)
        ) / 1000
      )
    );

    const statusCode = calculateStatusCode(durationSeconds);

    record.durationSeconds = durationSeconds;
    record.durationDisplay = formatDurationSeconds(durationSeconds);
    record.statusCode = statusCode;
    record.statusLabel = getStatusLabel(statusCode);
    record.statusColor = getStatusColor(statusCode);
    record.isOverdue = statusCode === 'OVERDUE';
  }

  function calculateStatusCode(durationSeconds) {
    if (!state.module) {
      return 'INCOMPLETE';
    }

    const minutes = Number(durationSeconds) / 60;

    if (
      minutes >=
      Number(state.module.redStartMinutes || 60)
    ) {
      return 'OVERDUE';
    }

    if (
      minutes >=
      Number(state.module.warningStartMinutes || 45)
    ) {
      return 'WARNING';
    }

    return 'NORMAL';
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

    document.title =
      (
        module.name ||
        'สถานะรถ'
      ) +
      ' | ' +
      (
        CONFIG.APP_NAME ||
        'ระบบติดตามสถานะรถ'
      );

    const calendarButton =
      document.getElementById('calendarButton');

    if (calendarButton) {
      calendarButton.classList.toggle(
        'is-hidden',
        !module.calendarEnabled
      );
    }

    updateAutoRefreshStatus();
  }

  function renderSummary() {
    const summary = buildLocalSummary(state.records);

    setText('summaryTotal', String(summary.total));
    setText('summaryNormal', String(summary.normal));
    setText('summaryWarning', String(summary.warning));
    setText('summaryOverdue', String(summary.overdue));
    setText('summaryIncomplete', String(summary.incomplete));
  }

  function buildLocalSummary(records) {
    const list = Array.isArray(records)
      ? records
      : [];

    return {
      total: list.length,
      normal: list.filter(
        (record) => record.statusCode === 'NORMAL'
      ).length,
      warning: list.filter(
        (record) => record.statusCode === 'WARNING'
      ).length,
      overdue: list.filter(
        (record) => record.statusCode === 'OVERDUE'
      ).length,
      incomplete: list.filter(
        (record) =>
          record.statusCode === 'INCOMPLETE' ||
          record.isIncomplete
      ).length
    };
  }

  function applyFiltersAndRender() {
    const searchText = state.searchText;
    const statusFilter = state.statusFilter;

    state.filteredRecords = state.records.filter((record) => {
      if (
        statusFilter !== 'ALL' &&
        record.statusCode !== statusFilter
      ) {
        return false;
      }

      if (!searchText) {
        return true;
      }

      const haystack = String(
        record.searchText ||
        [
          record.primaryValue,
          record.timestampIn,
          record.statusLabel
        ]
          .filter(Boolean)
          .join(' ')
      ).toLowerCase();

      return haystack.includes(searchText);
    });

    sortRecords(state.filteredRecords);
    renderVehicleCards(state.filteredRecords);

    setText(
      'resultCount',
      state.filteredRecords.length +
      ' รายการ'
    );
  }

  function sortRecords(records) {
    const severity = {
      OVERDUE: 1,
      WARNING: 2,
      NORMAL: 3,
      INCOMPLETE: 4
    };

    records.sort((left, right) => {
      const leftSeverity =
        severity[left.statusCode] || 99;

      const rightSeverity =
        severity[right.statusCode] || 99;

      if (leftSeverity !== rightSeverity) {
        return leftSeverity - rightSeverity;
      }

      return (
        Number(right.durationSeconds) || 0
      ) - (
        Number(left.durationSeconds) || 0
      );
    });
  }

  function renderVehicleCards(records) {
    const container = document.getElementById('vehicleList');
    const emptyState = document.getElementById('vehicleEmpty');

    if (!container) {
      return;
    }

    state.cardNodes.clear();
    container.innerHTML = '';

    if (!records || records.length === 0) {
      emptyState &&
        emptyState.classList.remove('is-hidden');

      return;
    }

    emptyState &&
      emptyState.classList.add('is-hidden');

    const fragment = document.createDocumentFragment();

    records.forEach((record) => {
      const result = createVehicleCard(record);

      fragment.appendChild(result.element);

      state.cardNodes.set(
        record.recordId,
        result.nodes
      );
    });

    container.appendChild(fragment);
  }

  function createVehicleCard(record) {
    const article = document.createElement('article');
    article.className = 'vehicle-card';
    article.dataset.status =
      record.statusCode || 'INCOMPLETE';
    article.dataset.recordId =
      record.recordId || '';

    const statusRail = document.createElement('div');
    statusRail.className = 'vehicle-card__rail';

    const header = document.createElement('div');
    header.className = 'vehicle-card__header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'vehicle-card__title-wrap';

    const title = document.createElement('h2');
    title.className = 'vehicle-card__title';
    title.textContent =
      record.primaryValue ||
      'ไม่พบข้อมูลหลัก';

    const statusBadge = document.createElement('span');
    statusBadge.className = 'vehicle-status-badge';
    statusBadge.dataset.status =
      record.statusCode || 'INCOMPLETE';
    statusBadge.textContent =
      record.statusLabel || 'ไม่ทราบสถานะ';

    titleWrap.appendChild(title);
    titleWrap.appendChild(statusBadge);

    const timerWrap = document.createElement('div');
    timerWrap.className = 'vehicle-card__timer-wrap';

    const timerLabel = document.createElement('span');
    timerLabel.textContent = 'อยู่ในพื้นที่';

    const timer = document.createElement('strong');
    timer.className = 'vehicle-card__timer';
    timer.textContent =
      record.durationDisplay ||
      '--:--:--';

    timerWrap.appendChild(timerLabel);
    timerWrap.appendChild(timer);

    header.appendChild(titleWrap);
    header.appendChild(timerWrap);

    const detailGrid = document.createElement('div');
    detailGrid.className = 'vehicle-detail-grid';

    const fields = Array.isArray(record.fields)
      ? record.fields
      : [];

    fields
      .filter(
        (field) =>
          !field.primary &&
          field.value
      )
      .sort(
        (left, right) =>
          Number(left.order || 0) -
          Number(right.order || 0)
      )
      .forEach((field) => {
        detailGrid.appendChild(
          createFieldElement(field)
        );
      });

    const footer = document.createElement('div');
    footer.className = 'vehicle-card__footer';

    const inTime = document.createElement('div');
    inTime.className = 'vehicle-in-time';

    const inTimeLabel = document.createElement('span');
    inTimeLabel.textContent = 'เวลาเข้าพื้นที่';

    const inTimeValue = document.createElement('strong');
    inTimeValue.textContent =
      record.timestampIn ||
      'ไม่พบข้อมูล';

    inTime.appendChild(inTimeLabel);
    inTime.appendChild(inTimeValue);
    footer.appendChild(inTime);

    if (
      record.canCheckout &&
      isAdmin()
    ) {
      const checkoutButton = document.createElement('button');
      checkoutButton.type = 'button';
      checkoutButton.className = 'button button--checkout';
      checkoutButton.textContent = 'บันทึกออกพื้นที่';

      checkoutButton.addEventListener(
        'click',
        () => handleCheckout(
          record,
          checkoutButton
        )
      );

      footer.appendChild(checkoutButton);
    }

    article.appendChild(statusRail);
    article.appendChild(header);

    if (detailGrid.childElementCount > 0) {
      article.appendChild(detailGrid);
    }

    article.appendChild(footer);

    return {
      element: article,
      nodes: {
        card: article,
        timer,
        statusBadge
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
      document.visibilityState !== 'visible'
    ) {
      return;
    }

    const nowMs = getCurrentServerTimeMs();
    let statusChanged = false;

    state.records.forEach((record) => {
      const previousStatus =
        record.statusCode;

      updateRecordComputedState(
        record,
        nowMs
      );

      const nodes =
        state.cardNodes.get(
          record.recordId
        );

      if (nodes) {
        nodes.timer.textContent =
          record.durationDisplay ||
          '--:--:--';

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

          statusChanged = true;
        }
      }
    });

    if (statusChanged) {
      renderSummary();
      applyFiltersAndRender();
      checkOverdueAlerts();
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
            state.refreshInProgress
          ) {
            return;
          }

          await loadRecords({
            silentError: true,
            showSuccessToast: false,
            forceRender: false
          });
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
      state.refreshTimer
    ].forEach((timer) => {
      if (timer) {
        window.clearInterval(timer);
      }
    });
  }

})(window, document);
