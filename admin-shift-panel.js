/**
 * admin-shift-panel.js
 * ROUND 1 — Package Integrity Recovery
 *
 * หน้าที่:
 * - จัดการแท็บกะใน admin.html
 * - ใช้ Module จาก Admin Dashboard ก่อน ไม่โหลดซ้ำโดยไม่จำเป็น
 * - มี Timeout/Error Code และไม่ค้างที่ Loading
 */
(function (window, document) {
  'use strict';

  const BUILD_VERSION =
    '2026.07.17-round1-admin-shift-package-integrity';

  const state = {
    initialized: false,
    initializing: false,
    moduleId: '',
    modules: [],
    config: null,
    shifts: [],
    statistics: [],
    requestToken: 0
  };

  document.addEventListener('DOMContentLoaded', initialize);

  function initialize() {
    bindEvents();
    observePanel();

    const requestedTab = new URLSearchParams(
      window.location.search
    ).get('tab');

    if (requestedTab === 'shifts' || window.location.hash === '#shifts') {
      window.setTimeout(function () {
        document.querySelector('[data-admin-tab="shifts"]')?.click();
      }, 300);
    }
  }

  function bindEvents() {
    document.querySelector('[data-admin-tab="shifts"]')
      ?.addEventListener('click', function () {
        updateLocation();
        ensureInitialized();
      });

    byId('adminShiftModuleSelect')?.addEventListener('change', function (event) {
      state.moduleId = text(event.target.value);
      loadModuleData();
    });

    byId('adminShiftReloadButton')?.addEventListener('click', function () {
      loadModules(true);
    });

    byId('adminShiftAddButton')?.addEventListener('click', addShift);
    byId('adminShiftSaveButton')?.addEventListener('click', saveConfiguration);
    byId('adminShiftSetupButton')?.addEventListener('click', setupShiftSystem);
    byId('adminShiftSnapshotButton')?.addEventListener('click', runSnapshot);
    byId('adminShiftStatsRefreshButton')?.addEventListener('click', loadStatistics);
    byId('adminShiftMessageRetry')?.addEventListener('click', function () {
      state.initialized = false;
      state.initializing = false;
      ensureInitialized();
    });

    byId('adminShiftRows')?.addEventListener('input', updateShiftFromEvent);
    byId('adminShiftRows')?.addEventListener('change', updateShiftFromEvent);
    byId('adminShiftRows')?.addEventListener('click', removeShiftFromEvent);
  }

  async function ensureInitialized() {
    if (state.initialized || state.initializing) return;

    state.initializing = true;
    showMessage('กำลังเตรียมข้อมูล Module', 'LOADING', false);

    try {
      await waitForAdminReady();
      assertApi();
      await loadModules(false);
      state.initialized = true;
      hideMessage();
    } catch (error) {
      renderLoadFailure(error);
      showMessage(errorMessage(error), 'ERROR', true);
      await showError(error, 'โหลดระบบกะไม่สำเร็จ');
    } finally {
      state.initializing = false;
    }
  }

  function assertApi() {
    const API = window.VehicleAPI;
    const required = [
      'getAdminShiftConfig',
      'saveAdminShiftConfig',
      'setupAdminShiftSystem',
      'runAdminShiftSnapshots',
      'getAdminShiftStatistics'
    ];

    if (!API) {
      throw codedError('VEHICLE_API_MISSING', 'ไม่พบ VehicleAPI');
    }

    const missing = required.filter(function (name) {
      return typeof API[name] !== 'function';
    });

    if (missing.length) {
      throw codedError(
        'SHIFT_API_METHOD_MISSING',
        'api.js ขาดฟังก์ชัน: ' + missing.join(', ')
      );
    }
  }

  async function loadModules(forceReload) {
    const button = byId('adminShiftReloadButton');
    setButtonLoading(button, true, 'กำลังโหลด');

    try {
      let modules = forceReload ? [] : readModulesFromAdminPage();

      if (!modules.length && typeof window.VehicleAPI.getAdminDashboard === 'function') {
        try {
          const dashboard = await withTimeout(
            window.VehicleAPI.getAdminDashboard({auditLimit: 1}),
            20000,
            'ADMIN_DASHBOARD_TIMEOUT'
          );
          modules = Array.isArray(dashboard?.modules) ? dashboard.modules : [];
        } catch (error) {
          console.warn('[Admin Shift] dashboard module fallback failed', error);
        }
      }

      if (!modules.length && typeof window.VehicleAPI.getModules === 'function') {
        const data = await withTimeout(
          window.VehicleAPI.getModules(),
          15000,
          'MODULE_LIST_TIMEOUT'
        );
        modules = Array.isArray(data) ? data : data?.modules || [];
      }

      state.modules = normalizeModules(modules);
      renderModuleOptions();

      if (!state.modules.length) {
        throw codedError('SHIFT_MODULES_EMPTY', 'ไม่พบ Module สำหรับตั้งค่ากะ');
      }

      await loadModuleData();
    } finally {
      setButtonLoading(button, false);
    }
  }

  function readModulesFromAdminPage() {
    return Array.from(
      document.querySelectorAll('#adminModuleList [data-module-id]')
    ).map(function (card) {
      return {
        moduleId: text(card.dataset.moduleId),
        name: text(card.querySelector('h3')?.textContent) ||
          text(card.dataset.moduleId)
      };
    }).filter(function (item) {
      return item.moduleId;
    });
  }

  function normalizeModules(modules) {
    const map = new Map();

    (Array.isArray(modules) ? modules : []).forEach(function (module) {
      const moduleId = text(module?.moduleId || module?.id);
      if (!moduleId || map.has(moduleId)) return;
      map.set(moduleId, {
        moduleId: moduleId,
        name: text(module?.name || module?.moduleName) || moduleId
      });
    });

    return Array.from(map.values());
  }

  function renderModuleOptions() {
    const select = byId('adminShiftModuleSelect');
    if (!select) return;

    if (!state.modules.length) {
      select.innerHTML = '<option value="">ไม่พบ Module</option>';
      state.moduleId = '';
      return;
    }

    select.innerHTML = state.modules.map(function (module) {
      return '<option value="' + escapeHtml(module.moduleId) + '">' +
        escapeHtml(module.name) + ' (' + escapeHtml(module.moduleId) + ')' +
        '</option>';
    }).join('');

    if (!state.modules.some(function (item) {
      return item.moduleId === state.moduleId;
    })) {
      state.moduleId = state.modules[0].moduleId;
    }

    select.value = state.moduleId;
  }

  async function loadModuleData() {
    if (!state.moduleId) return;

    const token = ++state.requestToken;
    setConfigLoading(true);
    showMessage('กำลังโหลดการตั้งค่ากะ', 'LOADING', false);

    try {
      const results = await Promise.all([
        withTimeout(
          window.VehicleAPI.getAdminShiftConfig(state.moduleId),
          25000,
          'SHIFT_CONFIG_TIMEOUT'
        ),
        withTimeout(
          window.VehicleAPI.getAdminShiftStatistics({
            moduleId: state.moduleId,
            limit: 50
          }),
          25000,
          'SHIFT_STATISTICS_TIMEOUT'
        )
      ]);

      if (token !== state.requestToken) return;

      state.config = results[0] || {};
      state.shifts = Array.isArray(state.config.shifts)
        ? state.config.shifts.map(normalizeShift)
        : defaultShifts();
      state.statistics = Array.isArray(results[1]?.shiftSummaries)
        ? results[1].shiftSummaries
        : [];

      renderConfiguration();
      renderStatistics();
      hideMessage();
    } catch (error) {
      if (token === state.requestToken) {
        showMessage(errorMessage(error), 'ERROR', true);
        renderLoadFailure(error);
      }
      await showError(error, 'โหลดข้อมูลกะไม่สำเร็จ');
    } finally {
      if (token === state.requestToken) setConfigLoading(false);
    }
  }

  function normalizeShift(shift) {
    return {
      code: text(shift?.code).toUpperCase(),
      name: text(shift?.name),
      start: validTime(shift?.start) ? text(shift.start) : '00:00',
      end: validTime(shift?.end) ? text(shift.end) : '00:00',
      active: shift?.active !== false
    };
  }

  function renderConfiguration() {
    const config = state.config || {};
    setChecked('adminShiftEnabled', config.enabled === true);
    setValue('adminShiftTimezone', config.timezone || 'Asia/Bangkok');
    setValue('adminShiftBusinessStart', config.businessDayStart || '06:00');
    setValue('adminShiftEffectiveDate', dateToIso(config.effectiveFrom) || todayIso());
    setText('adminShiftVersion', config.version || 'DEFAULT');
    setText(
      'adminShiftUpdatedAt',
      [config.updatedAt || '-', config.updatedBy ? 'โดย ' + config.updatedBy : '']
        .filter(Boolean)
        .join(' ')
    );

    const badge = byId('adminShiftStatusBadge');
    if (badge) {
      badge.textContent = config.enabled === true ? 'เปิดใช้งาน' : 'ปิดใช้งาน';
      badge.dataset.status = config.enabled === true ? 'ENABLED' : 'DISABLED';
    }

    renderShiftRows();
  }

  function renderShiftRows() {
    const container = byId('adminShiftRows');
    if (!container) return;
    if (!state.shifts.length) state.shifts = defaultShifts();

    container.innerHTML = state.shifts.map(function (shift, index) {
      return [
        '<div class="admin-shift-row" data-shift-index="' + index + '">',
        shiftInput('รหัสกะ', 'code', shift.code, 'text', 8),
        shiftInput('ชื่อกะ', 'name', shift.name, 'text', 60),
        shiftInput('เวลาเริ่ม', 'start', shift.start, 'time'),
        shiftInput('เวลาสิ้นสุด', 'end', shift.end, 'time'),
        '<label class="admin-shift-active-toggle">',
        '<input type="checkbox" data-shift-field="active" ' +
          (shift.active ? 'checked' : '') + '>',
        '<span>ใช้งาน</span></label>',
        '<button class="admin-shift-remove" type="button" data-remove-shift="' +
          index + '" ' + (state.shifts.length <= 2 ? 'disabled' : '') + '>ลบ</button>',
        '</div>'
      ].join('');
    }).join('');

    updateValidation();
  }

  function shiftInput(label, field, value, type, maxlength) {
    return '<label class="admin-field"><span>' + escapeHtml(label) + '</span>' +
      '<input type="' + type + '" data-shift-field="' + field + '" ' +
      (maxlength ? 'maxlength="' + maxlength + '" ' : '') +
      'value="' + escapeHtml(value) + '"></label>';
  }

  function updateShiftFromEvent(event) {
    const input = event.target.closest('[data-shift-field]');
    const row = input?.closest('[data-shift-index]');
    const index = Number(row?.dataset.shiftIndex);
    const shift = state.shifts[index];
    if (!input || !shift) return;

    shift[input.dataset.shiftField] = input.type === 'checkbox'
      ? input.checked
      : input.value;
    updateValidation();
  }

  function removeShiftFromEvent(event) {
    const button = event.target.closest('[data-remove-shift]');
    if (!button || state.shifts.length <= 2) return;
    state.shifts.splice(Number(button.dataset.removeShift), 1);
    renderShiftRows();
  }

  function addShift() {
    if (state.shifts.length >= 4) {
      showError(codedError('SHIFT_LIMIT_REACHED', 'กำหนดได้ไม่เกิน 4 กะ'), 'เพิ่มกะไม่ได้');
      return;
    }

    const used = new Set(state.shifts.map(function (shift) {
      return text(shift.code).toUpperCase();
    }));
    const code = ['A', 'B', 'C', 'D'].find(function (item) {
      return !used.has(item);
    }) || 'S' + (state.shifts.length + 1);

    state.shifts.push({
      code: code,
      name: 'กะ ' + code,
      start: '00:00',
      end: '00:00',
      active: true
    });
    renderShiftRows();
  }

  function validateShifts(shifts) {
    if (shifts.length < 2 || shifts.length > 4) {
      return invalid('ต้องกำหนด 2–4 กะ');
    }

    const active = shifts.filter(function (shift) { return shift.active; });
    if (active.length < 2) return invalid('ต้องเปิดใช้งานอย่างน้อย 2 กะ');

    const codes = new Set();
    for (const shift of shifts) {
      const code = text(shift.code).toUpperCase();
      if (!code) return invalid('กรุณาระบุรหัสกะให้ครบ');
      if (codes.has(code)) return invalid('รหัสกะห้ามซ้ำกัน');
      codes.add(code);
      if (!text(shift.name)) return invalid('กรุณาระบุชื่อกะให้ครบ');
      if (!validTime(shift.start) || !validTime(shift.end)) {
        return invalid('เวลาเริ่มหรือเวลาสิ้นสุดไม่ถูกต้อง');
      }
      if (shift.start === shift.end) return invalid('เวลาเริ่มและสิ้นสุดห้ามเท่ากัน');
    }

    const occupied = new Array(1440).fill('');
    for (const shift of active) {
      let cursor = timeMinutes(shift.start);
      const end = timeMinutes(shift.end);
      let count = 0;
      while (cursor !== end && count < 1440) {
        if (occupied[cursor]) {
          return invalid('ช่วงกะ ' + shift.code + ' ทับกับกะ ' + occupied[cursor]);
        }
        occupied[cursor] = shift.code;
        cursor = (cursor + 1) % 1440;
        count += 1;
      }
    }

    const coverageMinutes = occupied.filter(Boolean).length;
    return {
      valid: true,
      coverageMinutes: coverageMinutes,
      coverageHours: coverageMinutes / 60,
      message: coverageMinutes === 1440
        ? 'ช่วงเวลาไม่ทับกันและครบ 24 ชั่วโมง'
        : 'ช่วงเวลาไม่ทับกัน แต่ยังมีช่วงว่าง'
    };
  }

  function invalid(message) {
    return {valid: false, coverageMinutes: 0, coverageHours: 0, message: message};
  }

  function updateValidation() {
    const result = validateShifts(state.shifts);
    setText(
      'adminShiftCoverage',
      result.coverageHours.toFixed(1) + ' ชั่วโมง' +
        (result.coverageMinutes === 1440 ? ' · ครบ 24 ชั่วโมง' : ' · ยังไม่ครบ 24 ชั่วโมง')
    );

    const status = byId('adminShiftValidationStatus');
    if (status) {
      status.textContent = result.message;
      status.dataset.status = result.valid
        ? (result.coverageMinutes === 1440 ? 'VALID' : 'WARNING')
        : 'ERROR';
    }

    setText(
      'adminShiftSaveHint',
      result.valid
        ? (result.coverageMinutes === 1440
          ? 'พร้อมบันทึกการตั้งค่ากะ'
          : 'บันทึกได้ แต่ช่วงว่างจะไม่ถูกจัดเข้ากะ')
        : result.message
    );

    return result;
  }

  async function saveConfiguration() {
    if (!state.moduleId) return;
    syncRowsFromDom();
    const validation = updateValidation();

    if (!validation.valid) {
      await showError(codedError('SHIFT_CONFIG_INVALID', validation.message), 'ยังบันทึกไม่ได้');
      return;
    }

    if (validation.coverageMinutes !== 1440) {
      const confirmation = await window.Swal.fire({
        icon: 'warning',
        title: 'ช่วงกะยังไม่ครบ 24 ชั่วโมง',
        text: 'ข้อมูลในช่วงเวลาว่างจะไม่ถูกระบุกะ ต้องการบันทึกต่อหรือไม่',
        showCancelButton: true,
        confirmButtonText: 'บันทึกต่อ',
        cancelButtonText: 'กลับไปแก้ไข',
        reverseButtons: true
      });
      if (!confirmation.isConfirmed) return;
    }

    const button = byId('adminShiftSaveButton');
    setButtonLoading(button, true, 'กำลังบันทึก');

    try {
      const result = await window.VehicleAPI.saveAdminShiftConfig(
        state.moduleId,
        {
          config: {
            enabled: byId('adminShiftEnabled')?.checked === true,
            timezone: text(byId('adminShiftTimezone')?.value) || 'Asia/Bangkok',
            businessDayStart: byId('adminShiftBusinessStart')?.value || '06:00',
            effectiveFrom: byId('adminShiftEffectiveDate')?.value || todayIso(),
            shifts: state.shifts.map(function (shift, index) {
              return {
                code: text(shift.code).toUpperCase(),
                name: text(shift.name),
                start: shift.start,
                end: shift.end,
                active: shift.active === true,
                order: index + 1
              };
            })
          }
        }
      );

      await window.Swal.fire({
        icon: 'success',
        title: 'บันทึกการตั้งค่ากะแล้ว',
        text: 'เวอร์ชัน ' + text(result?.version || '-'),
        confirmButtonText: 'รับทราบ'
      });
      await loadModuleData();
    } catch (error) {
      await showError(error, 'บันทึกการตั้งค่ากะไม่สำเร็จ');
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function setupShiftSystem() {
    const button = byId('adminShiftSetupButton');
    setButtonLoading(button, true, 'กำลังเตรียมชีท');
    try {
      const result = await window.VehicleAPI.setupAdminShiftSystem();
      await window.Swal.fire({
        icon: result?.success === false ? 'warning' : 'success',
        title: 'เตรียมระบบกะแล้ว',
        text: 'ตรวจสอบชีท ' + (Array.isArray(result?.sheets) ? result.sheets.length : 0) + ' รายการ',
        confirmButtonText: 'รับทราบ'
      });
      await loadModules(true);
    } catch (error) {
      await showError(error, 'เตรียมระบบกะไม่สำเร็จ');
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function runSnapshot() {
    if (!state.moduleId) return;

    const confirmation = await window.Swal.fire({
      icon: 'question',
      title: 'บันทึก Snapshot ตอนนี้',
      text: 'ประมวลผล Module ' + state.moduleId,
      showCancelButton: true,
      confirmButtonText: 'เริ่มประมวลผล',
      cancelButtonText: 'ยกเลิก'
    });
    if (!confirmation.isConfirmed) return;

    const button = byId('adminShiftSnapshotButton');
    setButtonLoading(button, true, 'กำลังประมวลผล');
    try {
      const result = await window.VehicleAPI.runAdminShiftSnapshots({
        moduleId: state.moduleId
      });
      await window.Swal.fire({
        icon: result?.success === false ? 'warning' : 'success',
        title: 'ประมวลผล Snapshot แล้ว',
        html: '<div class="admin-shift-result">' +
          metric('สรุปกะ', result?.shiftSnapshots) +
          metric('สรุปรายวัน', result?.dailySnapshots) +
          metric('รายชั่วโมง', result?.hourlyRows) +
          metric('ข้อยกเว้น', result?.exceptionRows) +
          '</div>',
        confirmButtonText: 'รับทราบ'
      });
      await loadStatistics();
    } catch (error) {
      await showError(error, 'สร้าง Snapshot ไม่สำเร็จ');
    } finally {
      setButtonLoading(button, false);
    }
  }

  function metric(label, value) {
    return '<span>' + escapeHtml(label) + '<strong>' + formatNumber(value) + '</strong></span>';
  }

  async function loadStatistics() {
    if (!state.moduleId) return;
    const button = byId('adminShiftStatsRefreshButton');
    setButtonLoading(button, true, 'กำลังโหลด');
    try {
      const data = await window.VehicleAPI.getAdminShiftStatistics({
        moduleId: state.moduleId,
        limit: 50
      });
      state.statistics = Array.isArray(data?.shiftSummaries)
        ? data.shiftSummaries
        : [];
      renderStatistics();
    } catch (error) {
      await showError(error, 'โหลดสถิติกะไม่สำเร็จ');
    } finally {
      setButtonLoading(button, false);
    }
  }

  function renderStatistics() {
    const rows = state.statistics || [];
    setText('adminShiftSnapshotCount', formatNumber(rows.length));
    setText('adminShiftFinalCount', formatNumber(rows.filter(function (row) {
      return text(row.SnapshotStatus).toUpperCase() === 'FINAL';
    }).length));
    setText('adminShiftLatestDate', rows.length ? displayDate(rows[0].BusinessDate) : '-');
    setText('adminShiftLatestCode', rows.length ? text(rows[0].ShiftCode) || '-' : '-');

    const body = byId('adminShiftStatsBody');
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="10">ยังไม่มี Snapshot ของ Module นี้</td></tr>';
      return;
    }

    body.innerHTML = rows.map(function (row) {
      const status = text(row.SnapshotStatus).toUpperCase() || '-';
      return '<tr>' +
        '<td>' + escapeHtml(displayDate(row.BusinessDate)) + '</td>' +
        '<td><strong>' + escapeHtml(row.ShiftCode || '-') + '</strong><small>' +
          escapeHtml(row.ShiftName || '') + '</small></td>' +
        '<td><span class="admin-shift-table-status" data-status="' +
          escapeHtml(status) + '">' + escapeHtml(statusLabel(status)) + '</span></td>' +
        '<td>' + formatNumber(row.GateIn) + '</td>' +
        '<td>' + formatNumber(row.GateOutActual) + '</td>' +
        '<td>' + formatNumber(row.AutoClose) + '</td>' +
        '<td>' + formatNumber(row.ClosingBalance) + '</td>' +
        '<td><strong class="' + (Number(row.OverdueAtEnd) > 0 ? 'admin-shift-danger-text' : '') + '">' +
          formatNumber(row.OverdueAtEnd) + '</strong></td>' +
        '<td>' + formatNumber(row.SLACompliancePercent) + '%</td>' +
        '<td>' + formatNumber(row.AverageDwellMinutes) + ' นาที</td>' +
        '</tr>';
    }).join('');
  }

  function syncRowsFromDom() {
    document.querySelectorAll('#adminShiftRows [data-shift-index]')
      .forEach(function (row) {
        const shift = state.shifts[Number(row.dataset.shiftIndex)];
        if (!shift) return;
        row.querySelectorAll('[data-shift-field]').forEach(function (input) {
          shift[input.dataset.shiftField] = input.type === 'checkbox'
            ? input.checked
            : input.value;
        });
      });
  }

  function setConfigLoading(loading) {
    if (loading) {
      const rows = byId('adminShiftRows');
      if (rows) rows.innerHTML = '<div class="admin-shift-loading"><span></span>กำลังโหลดการตั้งค่า</div>';
    }
    ['adminShiftSaveButton', 'adminShiftSnapshotButton', 'adminShiftStatsRefreshButton']
      .forEach(function (id) {
        const element = byId(id);
        if (element) element.disabled = loading;
      });
  }

  function renderLoadFailure(error) {
    const rows = byId('adminShiftRows');
    if (rows) {
      rows.innerHTML = '<div class="admin-shift-loading admin-shift-load-error">' +
        '<strong>ไม่สามารถโหลดการตั้งค่ากะได้</strong><span>' +
        escapeHtml(errorMessage(error)) + '</span></div>';
    }
  }

  function showMessage(message, status, retryVisible) {
    const box = byId('adminShiftMessage');
    if (!box) return;
    box.hidden = false;
    box.dataset.status = status || 'INFO';
    setText('adminShiftMessageText', message);
    const retry = byId('adminShiftMessageRetry');
    if (retry) retry.hidden = retryVisible !== true;
  }

  function hideMessage() {
    const box = byId('adminShiftMessage');
    if (box) box.hidden = true;
    const retry = byId('adminShiftMessageRetry');
    if (retry) retry.hidden = true;
  }

  function observePanel() {
    const panel = byId('adminPanelShifts');
    if (!panel) return;
    const check = function () {
      if (isVisible(panel)) ensureInitialized();
    };
    new MutationObserver(check).observe(panel, {
      attributes: true,
      attributeFilter: ['class', 'hidden', 'style']
    });
    window.setTimeout(check, 500);
  }

  async function waitForAdminReady() {
    const started = Date.now();
    while (Date.now() - started < 20000) {
      const loading = byId('adminPageLoading');
      const user = text(byId('adminCurrentUser')?.textContent);
      if ((!loading || !isVisible(loading)) && user && user !== 'กำลังโหลด...') return;
      await delay(150);
    }
    throw codedError('ADMIN_READY_TIMEOUT', 'หน้า Admin ยังตรวจสิทธิ์ไม่เสร็จ');
  }

  function isVisible(element) {
    if (!element || element.hidden || element.classList.contains('is-hidden')) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function updateLocation() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'shifts');
      url.hash = 'shifts';
      window.history.replaceState({}, '', url.toString());
    } catch (error) {
      console.warn('[Admin Shift] update URL failed', error);
    }
  }

  function defaultShifts() {
    return [
      {code: 'A', name: 'กะ A', start: '06:00', end: '14:00', active: true},
      {code: 'B', name: 'กะ B', start: '14:00', end: '22:00', active: true},
      {code: 'C', name: 'กะ C', start: '22:00', end: '06:00', active: true}
    ];
  }

  function validTime(value) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(text(value));
  }

  function timeMinutes(value) {
    const parts = text(value).split(':').map(Number);
    return parts[0] * 60 + parts[1];
  }

  function todayIso() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function dateToIso(value) {
    const source = text(value);
    let match = source.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (match) return match[3] + '-' + match[2] + '-' + match[1];
    match = source.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? match[1] + '-' + match[2] + '-' + match[3] : '';
  }

  function displayDate(value) {
    const source = text(value);
    const match = source.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? match[3] + '/' + match[2] + '/' + match[1] : source || '-';
  }

  function statusLabel(status) {
    if (status === 'FINAL') return 'ปิดกะแล้ว';
    if (status === 'PROVISIONAL') return 'ชั่วคราว';
    if (status === 'DRAFT') return 'ร่าง';
    return status || '-';
  }

  function setButtonLoading(button, loading, label) {
    if (!button) return;
    if (loading) {
      button.dataset.originalText = button.textContent;
      button.textContent = label || 'กำลังดำเนินการ';
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
      delete button.dataset.originalText;
    }
  }

  async function showError(error, title) {
    const code = text(error?.code || error?.apiCode);
    const message = errorMessage(error);
    if (window.Swal?.fire) {
      await window.Swal.fire({
        icon: 'error',
        title: title || 'เกิดข้อผิดพลาด',
        html: '<div>' + escapeHtml(message) + '</div>' +
          (code ? '<small>รหัส: ' + escapeHtml(code) + '</small>' : ''),
        confirmButtonText: 'รับทราบ'
      });
    } else {
      window.alert((title || 'เกิดข้อผิดพลาด') + '\n' + message + (code ? '\n' + code : ''));
    }
  }

  function withTimeout(promise, timeoutMs, code) {
    let timer;
    return Promise.race([
      Promise.resolve(promise),
      new Promise(function (_resolve, reject) {
        timer = window.setTimeout(function () {
          reject(codedError(code || 'REQUEST_TIMEOUT', 'การเชื่อมต่อใช้เวลานานเกินกำหนด'));
        }, timeoutMs);
      })
    ]).finally(function () {
      window.clearTimeout(timer);
    });
  }

  function codedError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function errorMessage(error) {
    return text(error?.message) || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
  }

  function formatNumber(value) {
    const number = Number(value);
    return Number.isFinite(number)
      ? new Intl.NumberFormat('th-TH', {maximumFractionDigits: 2}).format(number)
      : '0';
  }

  function byId(id) { return document.getElementById(id); }
  function setText(id, value) { const el = byId(id); if (el) el.textContent = value; }
  function setValue(id, value) { const el = byId(id); if (el) el.value = value; }
  function setChecked(id, value) { const el = byId(id); if (el) el.checked = value === true; }
  function delay(ms) { return new Promise(function (resolve) { window.setTimeout(resolve, ms); }); }
  function text(value) { return value === null || value === undefined ? '' : String(value).trim(); }
  function escapeHtml(value) {
    return text(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  window.AlertVendorAdminShift = Object.freeze({
    version: BUILD_VERSION,
    reload: function () { return loadModules(true); }
  });
})(window, document);
