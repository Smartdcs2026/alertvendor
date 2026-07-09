/************************************************************
 * inbound.js
 * ROUND 05 HOTFIX 02 — Inbound Control Room + Fast Scan
 ************************************************************/
(function (window, document) {
  'use strict';

  const CONFIG = window.APP_CONFIG || {};
  const API = window.VehicleAPI;
  const SCAN_DUPLICATE_BLOCK_MS = 8000;
  const SCAN_PAUSE_AFTER_READ_MS = 2600;
  const KEYBOARD_SCAN_DEBOUNCE_MS = 230;

  const state = {
    clockTimer: null,
    scanner: null,
    session: null,
    modules: [],
    moduleId: '',
    currentLookup: null,
    loading: false,
    dashboard: null,
    dashboardItems: [],
    dashboardQuery: '',
    statusFilter: 'ALL',
    recentScanMap: new Map(),
    inFlightCodes: new Set(),
    manualInputTimer: null,
    audioContext: null,
    audioUnlocked: false
  };

  document.addEventListener('DOMContentLoaded', initialize);
  window.addEventListener('beforeunload', destroy);

  async function initialize() {
    startClock();
    bindEvents();
    setLoading(true);

    if (!API || typeof API.me !== 'function') {
      await showSystemError('เริ่มต้นระบบไม่สำเร็จ', 'ไม่พบ api.js หรือ VehicleAPI.me');
      setLoading(false);
      return;
    }

    try {
      const session = await API.me();

      if (!session || session.authenticated !== true) {
        redirectToLogin();
        return;
      }

      state.session = session;
      const user = session.user || {};
      const role = normalizeRole(user.role);

      if (role !== 'INBOUND' && role !== 'ADMIN') {
        await Swal.fire({
          icon: 'warning',
          title: 'ไม่มีสิทธิ์เข้าใช้งานห้อง Inbound',
          text: 'บัญชีนี้ไม่ใช่สิทธิ์ Inbound',
          confirmButtonText: 'กลับหน้าหลัก',
          allowOutsideClick: false
        });

        window.location.replace(CONFIG.DASHBOARD_URL || './index.html');
        return;
      }

      setConnection(role === 'ADMIN' ? 'ADMIN TEST MODE' : 'INBOUND ONLINE', 'READY');
      setText('inboundUser', (user.displayName || user.username || '-') + ' · ' + role);

      await loadModules();
      createScanner();
      await loadWorkflowDashboard(true);
      focusCodeInput();

    } catch (error) {
      if (isAuthError(error)) {
        redirectToLogin();
        return;
      }

      await showSystemError('เปิดหน้า Inbound ไม่สำเร็จ', errorMessage(error));
      setConnection('ระบบไม่พร้อม', 'ERROR');
    } finally {
      setLoading(false);
    }
  }

  function bindEvents() {
    byId('inboundLogoutButton')?.addEventListener('click', logout);
    byId('startCameraButton')?.addEventListener('click', startCamera);
    byId('stopCameraButton')?.addEventListener('click', stopCamera);
    byId('inboundRefreshButton')?.addEventListener('click', () => {
      void loadWorkflowDashboard(false);
      reloadCurrentLookup();
    });
    byId('submitDocumentButton')?.addEventListener('click', submitDocument);
    byId('returnDocumentButton')?.addEventListener('click', returnDocument);
    byId('clearResultButton')?.addEventListener('click', clearResult);
    byId('clearCodeButton')?.addEventListener('click', () => {
      clearCodeInput();
      setScanMessage('พร้อมสแกนรายการถัดไป', 'IDLE');
      focusCodeInput();
    });

    byId('manualLookupForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const code = getEntryCode();
      if (!code) {
        beep('warn');
        setScanMessage('กรุณากรอก Auto ID ก่อนตรวจสอบ', 'WARN');
        focusCodeInput();
        return;
      }
      void lookupCode(code, 'MANUAL', code, {source: 'FORM'});
    });

    const entryInput = byId('entryCodeInput');
    if (entryInput) {
      entryInput.addEventListener('focus', unlockAudio);
      entryInput.addEventListener('keydown', (event) => {
        unlockAudio();
        if (event.key === 'Enter') {
          event.preventDefault();
          const code = getEntryCode();
          if (code) {
            void lookupCode(code, 'SCAN', code, {source: 'KEYBOARD_ENTER'});
          }
        }
      });

      entryInput.addEventListener('input', () => {
        unlockAudio();
        if (state.manualInputTimer) {
          window.clearTimeout(state.manualInputTimer);
        }

        state.manualInputTimer = window.setTimeout(() => {
          const code = getEntryCode();
          if (code.length >= 8) {
            void lookupCode(code, 'SCAN', code, {source: 'KEYBOARD_IDLE'});
          }
        }, KEYBOARD_SCAN_DEBOUNCE_MS);
      });
    }

    byId('inboundModuleSelect')?.addEventListener('change', async (event) => {
      state.moduleId = String(event.target.value || '').trim();
      clearResult();
      await loadWorkflowDashboard(false);
      focusCodeInput();
    });

    byId('workflowSearchInput')?.addEventListener('input', (event) => {
      state.dashboardQuery = String(event.target.value || '').trim().toLowerCase();
      renderWorkflowTable();
    });

    document.querySelector('.top-status')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-status-filter]');
      if (!button) return;
      state.statusFilter = String(button.dataset.statusFilter || 'ALL').toUpperCase();
      document.querySelectorAll('[data-status-filter]').forEach((item) => {
        item.classList.toggle('is-active', item === button);
      });
      renderWorkflowTable();
    });

    byId('workflowTableBody')?.addEventListener('click', (event) => {
      const row = event.target.closest('[data-auto-id]');
      if (!row) return;
      const autoId = row.dataset.autoId || '';
      if (autoId) {
        void lookupCode(autoId, 'TABLE', autoId, {source: 'TABLE'});
      }
    });

    document.addEventListener('click', unlockAudio, {once: true, capture: true});

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        stopCamera();
      } else {
        focusCodeInput();
      }
    });
  }

  async function loadModules() {
    const select = byId('inboundModuleSelect');

    if (!API || typeof API.getModules !== 'function') {
      state.modules = [{moduleId: 'DEFAULT', name: 'Default Module'}];
      state.moduleId = 'DEFAULT';
      renderModuleSelect();
      return;
    }

    const data = await API.getModules();
    const modules = Array.isArray(data)
      ? data
      : Array.isArray(data && data.modules)
        ? data.modules
        : [];

    state.modules = modules
      .map((item) => ({
        moduleId: String(item.moduleId || item.id || '').trim(),
        name: String(item.name || item.moduleName || item.moduleId || item.id || '').trim(),
        status: String(item.status || '').trim()
      }))
      .filter((item) => item.moduleId);

    const urlModule = new URLSearchParams(window.location.search).get('module') ||
      new URLSearchParams(window.location.search).get('id') ||
      CONFIG.INBOUND_DEFAULT_MODULE_ID ||
      '';

    const matched = state.modules.find((item) => item.moduleId === urlModule);
    state.moduleId = matched
      ? matched.moduleId
      : state.modules[0]
        ? state.modules[0].moduleId
        : 'DEFAULT';

    if (!state.modules.length) {
      state.modules = [{moduleId: state.moduleId, name: state.moduleId}];
    }

    renderModuleSelect();

    if (select) {
      select.value = state.moduleId;
    }
  }

  function renderModuleSelect() {
    const select = byId('inboundModuleSelect');
    if (!select) return;

    select.innerHTML = state.modules.map((module) => `
      <option value="${escapeHtml(module.moduleId)}">
        ${escapeHtml(module.name || module.moduleId)}
      </option>
    `).join('');
  }

  function createScanner() {
    const video = byId('inboundVideo');

    if (!window.InboundScanner || !video) {
      setScannerStatus('ใช้ช่องกรอกรหัส', 'ERROR');
      return;
    }

    state.scanner = new window.InboundScanner({
      video,
      scanIntervalMs: 160,
      cooldownMs: SCAN_PAUSE_AFTER_READ_MS,
      onScan(rawText) {
        const code = normalizeEntryCode(rawText);
        if (!code) return;
        void lookupCode(code, 'SCAN', rawText, {source: 'CAMERA'});
      },
      onStatus(code, message) {
        setScannerStatus(message, code === 'CAMERA_READY' ? 'READY' : 'IDLE');
      },
      onError(error) {
        console.warn('Scanner detect error', error);
      }
    });

    if (!state.scanner.isCameraAvailable()) {
      setScannerStatus('ใช้ช่องกรอกรหัส', 'ERROR');
      setScanMessage('เครื่องนี้เปิดกล้องไม่ได้ ให้เสียบเครื่องสแกนหรือกรอกรหัสเอง', 'WARN');
    } else if (!state.scanner.isSupported()) {
      setScannerStatus('กล้องพร้อม แต่ต้องใช้ ZXing/BarcodeDetector', 'IDLE');
    }
  }

  async function startCamera() {
    unlockAudio();

    if (!state.scanner) {
      createScanner();
    }

    if (!state.scanner) {
      setScannerStatus('ใช้ช่องกรอกรหัส', 'ERROR');
      setScanMessage('ไม่พบระบบสแกน ให้กรอกรหัสเองหรือเสียบเครื่องสแกน QR', 'WARN');
      focusCodeInput();
      return;
    }

    try {
      await state.scanner.start();
      setScannerStatus('กล้องพร้อมสแกน', 'READY');
      setScanMessage('กล้องพร้อม วาง QR / Barcode ในกรอบ ระบบจะค้นหาให้อัตโนมัติ', 'SUCCESS');
      focusCodeInput();
    } catch (error) {
      setScannerStatus('ใช้ช่องกรอกรหัสแทน', 'ERROR');
      setScanMessage(errorMessage(error), 'WARN');
      beep('warn');
      focusCodeInput();
    }
  }

  function stopCamera() {
    if (state.scanner) {
      state.scanner.stop();
    }
    focusCodeInput();
  }

  async function lookupCode(code, method, rawText, options) {
    const cleanCode = normalizeEntryCode(code);
    const config = options && typeof options === 'object' ? options : {};

    if (!cleanCode) {
      beep('warn');
      setScanMessage('ไม่พบรหัสสำหรับค้นหา', 'WARN');
      focusCodeInput();
      return;
    }

    if (!state.moduleId) {
      beep('warn');
      setScanMessage('กรุณาเลือก Module ก่อนสแกน', 'WARN');
      focusCodeInput();
      return;
    }

    if (isDuplicateScanBlocked(cleanCode) && config.source !== 'TABLE') {
      beep('duplicate');
      setScanMessage('รหัสนี้เพิ่งถูกสแกนแล้ว ระบบกันการอ่านซ้ำ: ' + cleanCode, 'WARN');
      clearCodeInput();
      focusCodeInput();
      return;
    }

    if (state.inFlightCodes.has(cleanCode)) {
      return;
    }

    state.inFlightCodes.add(cleanCode);
    blockDuplicateScan(cleanCode);
    state.loading = true;

    if (state.scanner && typeof state.scanner.pause === 'function') {
      state.scanner.pause(SCAN_PAUSE_AFTER_READ_MS);
    }

    setScannerStatus('กำลังตรวจสอบรหัส', 'IDLE');
    setScanMessage('กำลังค้นหาข้อมูล ' + cleanCode, 'IDLE');
    setLookupBusy(true);

    try {
      beep('scan');

      const result = await API.lookupInboundWorkflow(
        state.moduleId,
        cleanCode,
        {
          method: method || 'SCAN',
          qrText: rawText || cleanCode
        }
      );

      state.currentLookup = normalizeLookupResult(result);
      renderLookupResult(state.currentLookup);
      upsertDashboardItemFromLookup(state.currentLookup);
      renderWorkflowDashboardState();
      beep('success');
      setScanMessage('พบข้อมูลและแสดงสถานะแล้ว: ' + cleanCode, 'SUCCESS');

    } catch (error) {
      state.currentLookup = null;
      renderLookupError(cleanCode, error);
      beep('error');
      setScanMessage(errorMessage(error), 'ERROR');
    } finally {
      state.inFlightCodes.delete(cleanCode);
      state.loading = false;
      setLookupBusy(false);
      clearCodeInput();
      focusCodeInput();
      setScannerStatus('พร้อมสแกนรายการถัดไป', state.scanner && state.scanner.running ? 'READY' : 'IDLE');
    }
  }

  async function submitDocument() {
    const lookup = state.currentLookup;

    if (!lookup || !lookup.record || !lookup.record.autoId) {
      beep('warn');
      setScanMessage('กรุณาตรวจสอบรหัสก่อนบันทึก', 'WARN');
      focusCodeInput();
      return;
    }

    if (!canSubmitDocument(lookup)) {
      beep('warn');
      setScanMessage(explainCannotSubmit(lookup), 'WARN');
      return;
    }

    const confirm = await Swal.fire({
      icon: undefined,
      title: '',
      html: buildConfirmHtml(lookup),
      showCancelButton: true,
      confirmButtonText: 'ยืนยันบันทึก',
      cancelButtonText: 'ยกเลิก',
      focusConfirm: false,
      customClass: {
        popup: 'inbound-swal-popup',
        htmlContainer: 'inbound-swal-html'
      }
    });

    if (!confirm.isConfirmed) {
      focusCodeInput();
      return;
    }

    state.loading = true;
    setLookupBusy(true);

    try {
      const result = await API.submitInboundDocument(
        state.moduleId,
        {
          entryCode: lookup.record.autoId,
          qrText: lookup.record.autoId,
          method: 'SCAN',
          note: 'บันทึกจากหน้า Inbound'
        }
      );

      state.currentLookup = normalizeLookupResult(result);
      renderLookupResult(state.currentLookup);
      upsertDashboardItemFromLookup(state.currentLookup);
      renderWorkflowDashboardState();
      beep('success');
      setScanMessage('บันทึกยื่นเอกสารแล้ว: ' + lookup.record.autoId, 'SUCCESS');

      await loadWorkflowDashboard(true);
      clearCodeInput();
      focusCodeInput();

    } catch (error) {
      beep('error');
      setScanMessage(errorMessage(error), 'ERROR');
      await showWorkflowError('บันทึกยื่นเอกสารไม่สำเร็จ', error);
    } finally {
      state.loading = false;
      setLookupBusy(false);
      focusCodeInput();
    }
  }

  async function returnDocument() {
    const lookup = state.currentLookup;

    if (!lookup || !lookup.record || !lookup.record.autoId) {
      beep('warn');
      setScanMessage('กรุณาตรวจสอบรหัสก่อนรับเอกสารคืน', 'WARN');
      focusCodeInput();
      return;
    }

    if (!canReturnDocument(lookup)) {
      beep('warn');
      setScanMessage(explainCannotReturn(lookup), 'WARN');
      return;
    }

    const confirm = await Swal.fire({
      icon: undefined,
      title: '',
      html: buildReturnConfirmHtml(lookup),
      showCancelButton: true,
      confirmButtonText: 'ยืนยันรับเอกสารคืน',
      cancelButtonText: 'ยกเลิก',
      focusConfirm: false,
      customClass: {
        popup: 'inbound-swal-popup',
        htmlContainer: 'inbound-swal-html'
      }
    });

    if (!confirm.isConfirmed) {
      focusCodeInput();
      return;
    }

    state.loading = true;
    setLookupBusy(true);

    try {
      const result = await API.returnInboundDocument(
        state.moduleId,
        {
          entryCode: lookup.record.autoId,
          qrText: lookup.record.autoId,
          method: 'SCAN',
          note: 'รับเอกสารคืนจากหน้า Inbound'
        }
      );

      state.currentLookup = normalizeLookupResult(result);
      renderLookupResult(state.currentLookup);
      upsertDashboardItemFromLookup(state.currentLookup);
      renderWorkflowDashboardState();
      beep('success');
      setScanMessage('บันทึกรับเอกสารคืนแล้ว: ' + lookup.record.autoId, 'SUCCESS');

      await loadWorkflowDashboard(true);
      clearCodeInput();
      focusCodeInput();

    } catch (error) {
      beep('error');
      setScanMessage(errorMessage(error), 'ERROR');
      await showWorkflowError('รับเอกสารคืนไม่สำเร็จ', error);
    } finally {
      state.loading = false;
      setLookupBusy(false);
      focusCodeInput();
    }
  }

  async function loadWorkflowDashboard(silent) {
    if (!state.moduleId || !API || typeof API.getInboundWorkflowDashboard !== 'function') {
      renderWorkflowDashboardState();
      return;
    }

    try {
      if (!silent) {
        setScanMessage('กำลังโหลดสถานะล่าสุด', 'IDLE');
      }

      const data = await API.getInboundWorkflowDashboard(state.moduleId, {limit: 300});
      state.dashboard = normalizeDashboard(data);
      state.dashboardItems = state.dashboard.items;
      renderWorkflowDashboardState();

      if (!silent) {
        setScanMessage('โหลดข้อมูลล่าสุดแล้ว', 'SUCCESS');
      }
    } catch (error) {
      console.warn('โหลด dashboard workflow ไม่สำเร็จ', error);
      setScanMessage('โหลดตารางสถานะไม่สำเร็จ: ' + errorMessage(error), 'WARN');
      renderWorkflowDashboardState();
    }
  }

  function normalizeDashboard(data) {
    const source = data && data.data && typeof data.data === 'object'
      ? data.data
      : data && typeof data === 'object'
        ? data
        : {};

    const allItems = []
      .concat(Array.isArray(source.items) ? source.items : [])
      .concat(Array.isArray(source.waitingReceiving) ? source.waitingReceiving : [])
      .concat(Array.isArray(source.receivingCompleted) ? source.receivingCompleted : [])
      .concat(Array.isArray(source.documentReturned) ? source.documentReturned : []);

    const byAutoId = new Map();
    allItems.forEach((item) => {
      const normalized = normalizeDashboardItem(item);
      if (!normalized.autoId) return;
      const existing = byAutoId.get(normalized.autoId);
      if (!existing || dateToMs(normalized.updatedAt) >= dateToMs(existing.updatedAt)) {
        byAutoId.set(normalized.autoId, normalized);
      }
    });

    const items = Array.from(byAutoId.values())
      .sort((left, right) => dateToMs(right.updatedAt) - dateToMs(left.updatedAt));

    return {
      summary: source.summary && typeof source.summary === 'object'
        ? source.summary
        : countDashboardSummary(items),
      items
    };
  }

  function normalizeDashboardItem(item) {
    const source = item && typeof item === 'object' ? item : {};
    const statusCode = String(source.statusCode || '').trim().toUpperCase();

    return {
      autoId: String(source.autoId || source.entryCode || source.recordId || '').trim(),
      statusCode,
      statusName: String(source.statusName || statusNameFromCode(statusCode) || '').trim(),
      nextStepText: String(source.nextStepText || '').trim(),
      updatedAt: String(source.updatedAt || source.updatedAtText || '').trim(),
      documentSubmittedAt: String(source.documentSubmittedAt || '').trim(),
      receivingCompletedAt: String(source.receivingCompletedAt || '').trim(),
      documentReturnedAt: String(source.documentReturnedAt || '').trim(),
      gateOutAt: String(source.gateOutAt || '').trim(),
      cancelled: source.cancelled === true || statusCode === 'CANCELLED',
      cancelReason: String(source.cancelReason || '').trim()
    };
  }

  function countDashboardSummary(items) {
    const list = Array.isArray(items) ? items : [];
    return {
      totalWorkflow: list.length,
      waitingReceiving: list.filter((item) => item.statusCode === 'DOCUMENT_SUBMITTED').length,
      receivingCompleted: list.filter((item) => item.statusCode === 'RECEIVING_COMPLETED').length,
      documentReturned: list.filter((item) => item.statusCode === 'DOCUMENT_RETURNED').length,
      cancelled: list.filter((item) => item.cancelled || item.statusCode === 'CANCELLED').length
    };
  }

  function renderWorkflowDashboardState() {
    const dashboard = state.dashboard || {summary: countDashboardSummary(state.dashboardItems), items: state.dashboardItems};
    const summary = dashboard.summary || countDashboardSummary(state.dashboardItems);

    setText('countTotalWorkflow', summary.totalWorkflow || state.dashboardItems.length || 0);
    setText('countWaitingReceiving', summary.waitingReceiving || 0);
    setText('countReceivingCompleted', summary.receivingCompleted || 0);
    setText('countDocumentReturned', summary.documentReturned || 0);
    setText('countCancelled', summary.cancelled || 0);

    renderWorkflowTable();
  }

  function renderWorkflowTable() {
    const body = byId('workflowTableBody');
    const count = byId('workflowTableCount');

    if (!body) return;

    const query = state.dashboardQuery;
    const statusFilter = state.statusFilter;

    const items = state.dashboardItems.filter((item) => {
      if (statusFilter !== 'ALL') {
        if (statusFilter === 'CANCELLED') {
          if (!item.cancelled && item.statusCode !== 'CANCELLED') return false;
        } else if (item.statusCode !== statusFilter) {
          return false;
        }
      }

      if (!query) return true;

      return [
        item.autoId,
        item.statusName,
        item.statusCode,
        item.updatedAt,
        item.nextStepText,
        item.cancelReason
      ].join(' ').toLowerCase().includes(query);
    });

    if (count) {
      count.textContent = items.length + ' รายการ';
    }

    if (!items.length) {
      body.innerHTML = '<tr><td colspan="4" class="empty-cell">ยังไม่มีรายการที่ตรงเงื่อนไข</td></tr>';
      return;
    }

    body.innerHTML = items.slice(0, 300).map((item) => `
      <tr data-auto-id="${escapeHtml(item.autoId)}">
        <td>
          <strong>${escapeHtml(item.autoId)}</strong>
          <small>${escapeHtml(item.nextStepText || '-')}</small>
        </td>
        <td>
          <span class="workflow-status-pill" data-status="${escapeHtml(item.statusCode)}">
            ${escapeHtml(item.statusName || statusNameFromCode(item.statusCode) || '-')}
          </span>
        </td>
        <td>
          ${escapeHtml(item.updatedAt || '-')}
        </td>
        <td>
          <button type="button" class="workflow-row-action" title="เปิดรายละเอียด" aria-label="เปิดรายละเอียด">
            ✎
          </button>
        </td>
      </tr>
    `).join('');
  }

  function upsertDashboardItemFromLookup(lookup) {
    const record = lookup && lookup.record ? lookup.record : {};
    const currentState = lookup && lookup.state ? lookup.state : {};
    const autoId = record.autoId || currentState.autoId || '';
    if (!autoId) return;

    const item = normalizeDashboardItem({
      autoId,
      statusCode: currentState.statusCode || '',
      statusName: currentState.statusName || '',
      nextStepText: currentState.nextStepText || '',
      updatedAt: currentState.updatedAt || currentState.updatedAtText || formatBangkokDateTime(new Date()),
      documentSubmittedAt: currentState.documentSubmittedAt || '',
      receivingCompletedAt: currentState.receivingCompletedAt || '',
      documentReturnedAt: currentState.documentReturnedAt || '',
      gateOutAt: currentState.gateOutAt || '',
      cancelled: currentState.cancelled === true,
      cancelReason: currentState.cancelReason || ''
    });

    state.dashboardItems = [item]
      .concat(state.dashboardItems.filter((existing) => existing.autoId !== autoId))
      .sort((left, right) => dateToMs(right.updatedAt) - dateToMs(left.updatedAt));

    state.dashboard = {
      summary: countDashboardSummary(state.dashboardItems),
      items: state.dashboardItems
    };
  }

  function renderLookupResult(lookup) {
    const panel = byId('lookupResultPanel');
    const body = byId('resultBody');
    const submitButton = byId('submitDocumentButton');
    const returnButton = byId('returnDocumentButton');

    if (!panel || !body) return;

    const record = lookup.record || {};
    const currentState = lookup.state || {};
    const statusName = currentState.statusName || '-';

    panel.hidden = false;
    setText('resultTitle', 'พบข้อมูลรถ/ตู้');
    setText('resultStatusBadge', statusName);

    body.innerHTML = `
      <div class="result-identity">
        <strong>${escapeHtml(record.autoId || '-')}</strong>
        <span>${escapeHtml(record.companyName || '-')} · ${escapeHtml(record.registration || '-')} · ${escapeHtml(record.vehicleType || '-')}</span>
      </div>

      <div class="result-grid">
        ${resultField('เลขนัดหมาย', record.appointmentNumber || '-')}
        ${resultField('เวลาเข้า Gate In', record.timestampIn || '-')}
        ${resultField('ยื่นเอกสาร', currentState.documentSubmittedAt || '-')}
        ${resultField('รับสินค้าเสร็จ', currentState.receivingCompletedAt || '-')}
        ${resultField('รับเอกสารคืน', currentState.documentReturnedAt || '-')}
        ${resultField('Gate Out', record.timestampOut || currentState.gateOutAt || '-')}
        ${resultField('ขั้นตอนถัดไป', currentState.nextStepText || '-')}
        ${resultField('ผู้แก้ไขล่าสุด', currentState.updatedBy || '-')}
      </div>
    `;

    if (submitButton) {
      submitButton.disabled = !canSubmitDocument(lookup);
      submitButton.textContent = canSubmitDocument(lookup)
        ? 'บันทึกยื่นเอกสาร'
        : buttonLabelByState(lookup);
    }

    if (returnButton) {
      returnButton.disabled = !canReturnDocument(lookup);
      returnButton.textContent = canReturnDocument(lookup)
        ? 'รับเอกสารคืน'
        : returnButtonLabelByState(lookup);
    }
  }

  function renderLookupError(code, error) {
    const panel = byId('lookupResultPanel');
    const body = byId('resultBody');
    const button = byId('submitDocumentButton');
    const returnButton = byId('returnDocumentButton');

    if (!panel || !body) return;

    panel.hidden = false;
    setText('resultTitle', 'ไม่พบหรือใช้รหัสนี้ไม่ได้');
    setText('resultStatusBadge', error && error.code ? error.code : 'ERROR');

    body.innerHTML = `
      <div class="result-identity">
        <strong>${escapeHtml(code || '-')}</strong>
        <span>${escapeHtml(errorMessage(error))}</span>
      </div>
    `;

    if (button) {
      button.disabled = true;
      button.textContent = 'บันทึกไม่ได้';
    }

    if (returnButton) {
      returnButton.disabled = true;
      returnButton.textContent = 'รับเอกสารคืนไม่ได้';
    }
  }

  function clearResult() {
    state.currentLookup = null;
    const panel = byId('lookupResultPanel');
    if (panel) panel.hidden = true;
    clearCodeInput();
    focusCodeInput();
  }

  function reloadCurrentLookup() {
    const code = state.currentLookup && state.currentLookup.record
      ? state.currentLookup.record.autoId
      : '';

    if (code) {
      void lookupCode(code, 'REFRESH', code, {source: 'REFRESH'});
    } else {
      focusCodeInput();
    }
  }

  function normalizeLookupResult(result) {
    const data = result && result.data && typeof result.data === 'object'
      ? result.data
      : result && typeof result === 'object'
        ? result
        : {};

    const record = data.record || data.vehicle || {};
    const currentState = data.state || data.workflowState || {};

    const autoId = String(
      record.autoId || record.autoID || record.entryCode || currentState.autoId || data.autoId || ''
    ).trim();

    return {
      success: data.success !== false,
      record: {
        autoId,
        timestampIn: String(record.timestampIn || record.gateInAt || record.timestamp || '').trim(),
        timestampOut: String(record.timestampOut || record.gateOutAt || '').trim(),
        appointmentNumber: String(record.appointmentNumber || record.appointment || record.booking || '').trim(),
        companyName: String(record.companyName || record.company || '').trim(),
        phone: String(record.phone || record.mobile || '').trim(),
        registration: String(record.registration || record.plate || record.vehiclePlate || '').trim(),
        province: String(record.province || '').trim(),
        vehicleType: String(record.vehicleType || record.type || '').trim(),
        driverName: String(record.driverName || record.fullName || '').trim()
      },
      state: {
        autoId,
        statusCode: String(currentState.statusCode || data.statusCode || '').trim().toUpperCase(),
        statusName: String(currentState.statusName || data.statusName || '').trim(),
        nextStepText: String(currentState.nextStepText || data.nextStepText || '').trim(),
        documentSubmittedAt: String(currentState.documentSubmittedAt || '').trim(),
        receivingCompletedAt: String(currentState.receivingCompletedAt || '').trim(),
        documentReturnedAt: String(currentState.documentReturnedAt || '').trim(),
        gateOutAt: String(currentState.gateOutAt || '').trim(),
        cancelled: currentState.cancelled === true,
        cancelReason: String(currentState.cancelReason || '').trim(),
        updatedAt: String(currentState.updatedAt || currentState.updatedAtText || '').trim(),
        updatedBy: String(currentState.updatedBy || '').trim()
      }
    };
  }

  function canSubmitDocument(lookup) {
    const record = lookup && lookup.record ? lookup.record : {};
    const currentState = lookup && lookup.state ? lookup.state : {};
    const status = String(currentState.statusCode || '').toUpperCase();

    if (!record.autoId) return false;
    if (record.timestampOut || currentState.gateOutAt) return false;
    if (currentState.cancelled) return false;
    if (currentState.documentSubmittedAt) return false;
    if (status === 'DOCUMENT_SUBMITTED' || status === 'RECEIVING_COMPLETED' || status === 'DOCUMENT_RETURNED') return false;

    return true;
  }

  function canReturnDocument(lookup) {
    const record = lookup && lookup.record ? lookup.record : {};
    const currentState = lookup && lookup.state ? lookup.state : {};
    const status = String(currentState.statusCode || '').toUpperCase();

    if (!record.autoId) return false;
    if (record.timestampOut || currentState.gateOutAt) return false;
    if (currentState.cancelled) return false;
    if (!currentState.documentSubmittedAt) return false;
    if (!currentState.receivingCompletedAt) return false;
    if (currentState.documentReturnedAt) return false;
    if (status !== 'RECEIVING_COMPLETED') return false;

    return true;
  }

  function explainCannotSubmit(lookup) {
    const record = lookup && lookup.record ? lookup.record : {};
    const currentState = lookup && lookup.state ? lookup.state : {};

    if (!record.autoId) return 'ไม่พบ Auto ID';
    if (record.timestampOut || currentState.gateOutAt) return 'รายการนี้มีเวลาออก Gate Out แล้ว';
    if (currentState.cancelled) return 'รายการนี้ถูกยกเลิกแล้ว: ' + (currentState.cancelReason || '-');
    if (currentState.documentSubmittedAt) return 'รายการนี้ยื่นเอกสารแล้วเมื่อ ' + currentState.documentSubmittedAt;

    return currentState.nextStepText || 'สถานะปัจจุบันไม่พร้อมสำหรับการยื่นเอกสาร';
  }

  function explainCannotReturn(lookup) {
    const record = lookup && lookup.record ? lookup.record : {};
    const currentState = lookup && lookup.state ? lookup.state : {};

    if (record.timestampOut || currentState.gateOutAt) return 'รายการนี้มีเวลาออก Gate Out แล้ว';
    if (currentState.cancelled) return 'รายการนี้ถูกยกเลิกแล้ว: ' + (currentState.cancelReason || '-');
    if (!currentState.documentSubmittedAt) return 'รายการนี้ยังไม่ได้ยื่นเอกสาร Inbound';
    if (!currentState.receivingCompletedAt) return 'ต้องให้ User/Admin กดรับสินค้าเสร็จก่อน จึงจะรับเอกสารคืนได้';
    if (currentState.documentReturnedAt) return 'รายการนี้รับเอกสารคืนแล้วเมื่อ ' + currentState.documentReturnedAt;

    return currentState.nextStepText || 'สถานะปัจจุบันไม่พร้อมสำหรับการรับเอกสารคืน';
  }

  function returnButtonLabelByState(lookup) {
    const currentState = lookup && lookup.state ? lookup.state : {};

    if (currentState.documentReturnedAt) return 'รับเอกสารคืนแล้ว';
    if (!currentState.receivingCompletedAt) return 'รอรับสินค้าเสร็จ';
    if (currentState.gateOutAt) return 'ออกคลังแล้ว';
    if (currentState.cancelled) return 'ถูกยกเลิกแล้ว';

    return 'รับเอกสารคืนไม่ได้';
  }

  function buttonLabelByState(lookup) {
    const currentState = lookup && lookup.state ? lookup.state : {};

    if (currentState.documentSubmittedAt) return 'ยื่นเอกสารแล้ว';
    if (currentState.gateOutAt) return 'ออกคลังแล้ว';
    if (currentState.cancelled) return 'ถูกยกเลิกแล้ว';

    return 'บันทึกไม่ได้';
  }

  function buildConfirmHtml(lookup) {
    const record = lookup.record || {};

    return `
      <article class="inbound-confirm-card">
        <header>
          <small>CONFIRM DOCUMENT SUBMIT</small>
          <h2>ยืนยันบันทึกยื่นเอกสาร</h2>
        </header>

        <dl>
          <dt>Auto ID</dt>
          <dd>${escapeHtml(record.autoId || '-')}</dd>
          <dt>บริษัท</dt>
          <dd>${escapeHtml(record.companyName || '-')}</dd>
          <dt>ทะเบียน</dt>
          <dd>${escapeHtml(record.registration || '-')}</dd>
          <dt>เวลาเข้า</dt>
          <dd>${escapeHtml(record.timestampIn || '-')}</dd>
        </dl>
      </article>
    `;
  }

  function buildReturnConfirmHtml(lookup) {
    const record = lookup.record || {};
    const currentState = lookup.state || {};

    return `
      <article class="inbound-confirm-card">
        <header>
          <small>CONFIRM DOCUMENT RETURN</small>
          <h2>ยืนยันรับเอกสารคืน</h2>
        </header>

        <dl>
          <dt>Auto ID</dt>
          <dd>${escapeHtml(record.autoId || '-')}</dd>
          <dt>บริษัท</dt>
          <dd>${escapeHtml(record.companyName || '-')}</dd>
          <dt>ทะเบียน</dt>
          <dd>${escapeHtml(record.registration || '-')}</dd>
          <dt>รับสินค้าเสร็จ</dt>
          <dd>${escapeHtml(currentState.receivingCompletedAt || '-')}</dd>
        </dl>
      </article>
    `;
  }

  function isDuplicateScanBlocked(code) {
    const until = state.recentScanMap.get(code) || 0;
    return Date.now() < until;
  }

  function blockDuplicateScan(code) {
    state.recentScanMap.set(code, Date.now() + SCAN_DUPLICATE_BLOCK_MS);

    window.setTimeout(() => {
      const until = state.recentScanMap.get(code) || 0;
      if (Date.now() >= until) {
        state.recentScanMap.delete(code);
      }
    }, SCAN_DUPLICATE_BLOCK_MS + 800);
  }

  function setScanMessage(text, stateName) {
    const element = byId('scanMessage');
    if (!element) return;
    element.textContent = String(text || '');
    element.dataset.state = stateName || 'IDLE';
  }

  function unlockAudio() {
    if (state.audioUnlocked) return;

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;

      state.audioContext = state.audioContext || new AudioContext();
      if (state.audioContext.state === 'suspended') {
        void state.audioContext.resume();
      }
      state.audioUnlocked = true;
    } catch (error) {
      // no-op
    }
  }

  function beep(type) {
    unlockAudio();

    const context = state.audioContext;
    if (!context) return;

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    const frequencies = {
      scan: 980,
      success: 1280,
      warn: 520,
      duplicate: 420,
      error: 260
    };

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequencies[type] || 880, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.17);
  }

  async function logout() {
    try {
      stopCamera();
      if (API && typeof API.logout === 'function') {
        await API.logout();
      }
    } catch (error) {
      console.warn('ออกจากระบบไม่สำเร็จ', error);
    }

    redirectToLogin();
  }

  function startClock() {
    updateClock();
    state.clockTimer = window.setInterval(updateClock, 1000);
  }

  function updateClock() {
    setText('inboundDateTime', formatBangkokDateTime(new Date()));
  }

  function setLoading(visible) {
    byId('inboundLoading')?.classList.toggle('is-hidden', visible !== true);
  }

  function setLookupBusy(busy) {
    ['submitDocumentButton', 'returnDocumentButton', 'clearResultButton', 'lookupCodeButton', 'inboundRefreshButton']
      .forEach((id) => {
        const element = byId(id);
        if (element) element.disabled = busy === true;
      });
  }

  function setConnection(text, stateName) {
    const element = byId('inboundConnection');
    if (!element) return;
    element.textContent = text;
    element.dataset.state = stateName || '';
  }

  function setScannerStatus(text, stateName) {
    const element = byId('scannerStatus');
    if (!element) return;
    element.textContent = text;
    element.dataset.state = stateName || 'IDLE';
  }

  function resultField(label, value) {
    return `
      <div class="result-field">
        <span>${escapeHtml(label)}</span>
        <strong title="${escapeHtml(value)}">${escapeHtml(value || '-')}</strong>
      </div>
    `;
  }

  function getEntryCode() {
    return normalizeEntryCode(byId('entryCodeInput')?.value || '');
  }

  function clearCodeInput() {
    setInputValue('entryCodeInput', '');
  }

  function focusCodeInput() {
    window.setTimeout(() => byId('entryCodeInput')?.focus(), 80);
  }

  function normalizeEntryCode(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, '')
      .toUpperCase();
  }

  function statusNameFromCode(code) {
    const value = String(code || '').toUpperCase();
    if (value === 'DOCUMENT_SUBMITTED') return 'ยื่นเอกสารแล้ว';
    if (value === 'RECEIVING_COMPLETED') return 'รับสินค้าเสร็จ';
    if (value === 'DOCUMENT_RETURNED') return 'รับเอกสารคืนแล้ว';
    if (value === 'GATE_OUT_COMPLETED') return 'ออกคลังแล้ว';
    if (value === 'CANCELLED') return 'ยกเลิก';
    if (value === 'GATE_IN_ONLY') return 'รอยื่นเอกสาร';
    return value || '-';
  }

  function dateToMs(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
    if (!match) return 0;
    return new Date(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6])
    ).getTime();
  }

  function formatBangkokDateTime(date) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Bangkok',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(date);

    const map = {};
    parts.forEach((part) => {
      map[part.type] = part.value;
    });

    return [map.day, map.month, map.year].join('/') + ' ' +
      [map.hour, map.minute, map.second].join(':');
  }

  function normalizeRole(value) {
    const role = String(value || 'USER').trim().toUpperCase();
    if (role === 'ADMIN') return 'ADMIN';
    if (role === 'INBOUND') return 'INBOUND';
    return 'USER';
  }

  function isAuthError(error) {
    return error && [
      'AUTH_REQUIRED',
      'INVALID_SESSION',
      'SESSION_EXPIRED',
      'INVALID_SESSION_SIGNATURE',
      'SESSION_VERSION_EXPIRED'
    ].includes(error.code);
  }

  async function showWorkflowError(title, error) {
    const code = error && error.code ? String(error.code) : '';
    const message = errorMessage(error);

    await Swal.fire({
      icon: 'warning',
      title,
      html: `
        <div class="inbound-confirm-card">
          <header>
            <small>${escapeHtml(code || 'WORKFLOW')}</small>
            <h2>${escapeHtml(message)}</h2>
          </header>
        </div>
      `,
      confirmButtonText: 'รับทราบ',
      customClass: {
        popup: 'inbound-swal-popup',
        htmlContainer: 'inbound-swal-html'
      }
    });
  }

  async function showSystemError(title, message) {
    if (window.Swal) {
      await Swal.fire({
        icon: 'error',
        title,
        text: message,
        confirmButtonText: 'ปิด',
        customClass: {
          popup: 'inbound-swal-popup'
        }
      });
      return;
    }

    alert(title + '\n' + message);
  }

  function errorMessage(error) {
    return error && error.message ? error.message : String(error || 'เกิดข้อผิดพลาด');
  }

  function redirectToLogin() {
    window.location.replace(CONFIG.LOGIN_URL || './login.html');
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const element = byId(id);
    if (element) element.textContent = String(value || '');
  }

  function setInputValue(id, value) {
    const element = byId(id);
    if (element) element.value = String(value || '');
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function destroy() {
    stopCamera();

    if (state.clockTimer) {
      window.clearInterval(state.clockTimer);
      state.clockTimer = null;
    }

    if (state.manualInputTimer) {
      window.clearTimeout(state.manualInputTimer);
      state.manualInputTimer = null;
    }
  }
})(window, document);
