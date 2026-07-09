/************************************************************
 * inbound.js
 * ROUND 05 HOTFIX 03 — Fast scan + auto stage save
 ************************************************************/
(function (window, document) {
  'use strict';

  const CONFIG = window.APP_CONFIG || {};
  const API = window.VehicleAPI;
  const DUPLICATE_BLOCK_MS = 15000;
  const HARD_BLOCK_AFTER_SAVE_MS = 22000;
  const INPUT_DEBOUNCE_MS = 90;
  const MIN_CODE_LENGTH = 8;
  const DASHBOARD_LIMIT = 500;

  const state = {
    session: null,
    moduleId: '',
    modules: [],
    scanner: null,
    clockTimer: 0,
    inputTimer: 0,
    loading: false,
    currentLookup: null,
    dashboardItems: [],
    dashboardQuery: '',
    statusFilter: 'ALL',
    inFlightCodes: new Set(),
    recentCodes: new Map(),
    audioContext: null,
    audioUnlocked: false
  };

  document.addEventListener('DOMContentLoaded', initialize);
  window.addEventListener('beforeunload', destroy);

  async function initialize() {
    startClock();
    bindEvents();
    showLoading(true);

    try {
      if (!API || typeof API.me !== 'function') {
        throw createClientError('API_NOT_READY', 'ไม่พบ api.js หรือ VehicleAPI.me');
      }

      const session = await API.me();
      if (!session || session.authenticated !== true) {
        redirectToLogin();
        return;
      }

      state.session = session;
      const user = session.user || {};
      const role = normalizeRole(user.role);

      if (role !== 'INBOUND' && role !== 'ADMIN') {
        await showAlert('ไม่มีสิทธิ์เข้าใช้งานห้อง Inbound', 'บัญชีนี้ไม่ใช่สิทธิ์ INBOUND', 'warning');
        window.location.replace(CONFIG.DASHBOARD_URL || './index.html');
        return;
      }

      setConnection(role === 'ADMIN' ? 'ADMIN TEST MODE' : 'INBOUND ONLINE', 'READY');
      setText('inboundUser', (user.displayName || user.username || '-') + ' · ' + role);

      await loadModules();
      createScanner();
      await loadWorkflowDashboard(true);
      focusCodeInput();

      // คอมพิวเตอร์ที่เสียบเครื่องสแกนจะพร้อมรับรหัสทันที
      setScanMessage('พร้อมรับรหัส สแกนแล้วระบบจะค้นหาและบันทึกขั้นตอนให้อัตโนมัติ', 'SUCCESS');

      // พยายามเปิดกล้องแบบเงียบ หาก Browser ไม่ยอมก็ยังใช้ช่องกรอก/เครื่องสแกนได้
      window.setTimeout(() => {
        if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;
        void startCamera({silent: true});
      }, 600);
    } catch (error) {
      setConnection('ระบบไม่พร้อม', 'ERROR');
      setScanMessage(errorMessage(error), 'ERROR');
      await showAlert('เปิดหน้า Inbound ไม่สำเร็จ', errorMessage(error), 'error');
    } finally {
      showLoading(false);
    }
  }

  function bindEvents() {
    byId('inboundLogoutButton')?.addEventListener('click', logout);
    byId('inboundRefreshButton')?.addEventListener('click', () => void loadWorkflowDashboard(false));
    byId('startCameraButton')?.addEventListener('click', () => void startCamera({silent: false}));
    byId('stopCameraButton')?.addEventListener('click', stopCamera);
    byId('clearCodeButton')?.addEventListener('click', () => {
      clearInput();
      clearCurrentResult();
      focusCodeInput();
    });
    byId('closeSelectedPanel')?.addEventListener('click', () => {
      const panel = byId('selectedRecordPanel');
      if (panel) panel.hidden = true;
      focusCodeInput();
    });

    byId('manualLookupForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const code = getEntryCode();
      if (code) {
        void processCode(code, {source: 'KEYBOARD_ENTER', rawText: code});
      } else {
        beep('warn');
        setScanMessage('กรุณากรอก Auto ID ก่อนค้นหา', 'WARN');
        focusCodeInput();
      }
    });

    const input = byId('entryCodeInput');
    if (input) {
      input.addEventListener('focus', unlockAudio);
      input.addEventListener('click', unlockAudio);
      input.addEventListener('keydown', (event) => {
        unlockAudio();
        if (event.key === 'Enter') {
          event.preventDefault();
          const code = getEntryCode();
          if (code) void processCode(code, {source: 'KEYBOARD_ENTER', rawText: code});
        }
      });
      input.addEventListener('input', () => {
        unlockAudio();
        window.clearTimeout(state.inputTimer);
        state.inputTimer = window.setTimeout(() => {
          const code = getEntryCode();
          if (looksLikeCompleteCode(code)) {
            void processCode(code, {source: 'KEYBOARD_SCAN', rawText: code});
          }
        }, INPUT_DEBOUNCE_MS);
      });
    }

    byId('inboundModuleSelect')?.addEventListener('change', async (event) => {
      state.moduleId = String(event.target.value || '').trim();
      clearCurrentResult();
      await loadWorkflowDashboard(false);
      focusCodeInput();
    });

    byId('workflowSearchInput')?.addEventListener('input', (event) => {
      state.dashboardQuery = String(event.target.value || '').trim().toLowerCase();
      renderWorkflowTable();
    });

    document.querySelector('.status-strip')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-status-filter]');
      if (!button) return;
      state.statusFilter = String(button.dataset.statusFilter || 'ALL').toUpperCase();
      document.querySelectorAll('[data-status-filter]').forEach((item) => {
        item.classList.toggle('is-active', item === button);
      });
      renderWorkflowTable();
      focusCodeInput();
    });

    byId('workflowTableBody')?.addEventListener('click', (event) => {
      const row = event.target.closest('[data-auto-id]');
      if (!row) return;
      const autoId = row.dataset.autoId || '';
      const item = state.dashboardItems.find((entry) => entry.autoId === autoId);
      if (item) renderSelectedRecord(item);
      if (event.target.closest('[data-open-detail]')) return;
      focusCodeInput();
    });

    document.addEventListener('click', unlockAudio, {capture: true});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') stopCamera();
      if (document.visibilityState === 'visible') focusCodeInput();
    });
  }

  async function loadModules() {
    if (!API || typeof API.getModules !== 'function') {
      state.modules = [{moduleId: 'DEFAULT', name: 'Default Module'}];
      state.moduleId = 'DEFAULT';
      renderModuleSelect();
      return;
    }

    const data = await API.getModules();
    const list = Array.isArray(data) ? data : Array.isArray(data && data.modules) ? data.modules : [];
    state.modules = list
      .map((item) => ({
        moduleId: String(item.moduleId || item.id || '').trim(),
        name: String(item.name || item.moduleName || item.moduleId || item.id || '').trim(),
        status: String(item.status || '').trim()
      }))
      .filter((item) => item.moduleId);

    const params = new URLSearchParams(window.location.search);
    const selected = params.get('module') || params.get('id') || CONFIG.INBOUND_DEFAULT_MODULE_ID || (state.modules[0] && state.modules[0].moduleId) || '';
    state.moduleId = selected;
    renderModuleSelect();
  }

  function renderModuleSelect() {
    const select = byId('inboundModuleSelect');
    if (!select) return;
    if (!state.modules.length) {
      select.innerHTML = '<option value="">ไม่พบ Module</option>';
      return;
    }
    select.innerHTML = state.modules.map((module) => `
      <option value="${escapeHtml(module.moduleId)}" ${module.moduleId === state.moduleId ? 'selected' : ''}>
        ${escapeHtml(module.name || module.moduleId)}
      </option>
    `).join('');
    if (!state.moduleId) state.moduleId = select.value;
  }

  function createScanner() {
    if (!window.InboundScanner) {
      setScannerStatus('ใช้เครื่องสแกนหรือกรอกรหัส', 'IDLE');
      return;
    }
    state.scanner = new window.InboundScanner({
      video: byId('inboundVideo'),
      scanIntervalMs: 90,
      pauseAfterScanMs: 900,
      sameCodeBlockMs: DUPLICATE_BLOCK_MS,
      onScan: (text, meta) => {
        beep('scan');
        void processCode(text, meta || {source: 'CAMERA'});
      },
      onStatus: (stateCode, message) => {
        if (stateCode === 'READY') setScannerStatus(message || 'กล้องพร้อม', 'READY');
        else if (stateCode === 'DUPLICATE') setScannerStatus(message || 'กันสแกนซ้ำ', 'BUSY');
        else setScannerStatus(message || 'พร้อมรับรหัส', 'IDLE');
      },
      onError: (error) => {
        setScannerStatus('ใช้ช่องกรอกรหัสแทน', 'ERROR');
        setScanMessage(errorMessage(error), 'WARN');
      }
    });
  }

  async function startCamera(options) {
    const config = options && typeof options === 'object' ? options : {};
    unlockAudio();
    if (!state.scanner) createScanner();
    if (!state.scanner) return;
    try {
      setScannerStatus('กำลังเปิดกล้อง', 'BUSY');
      await state.scanner.start();
      setScannerStatus('กล้องพร้อมสแกน', 'READY');
      if (!config.silent) setScanMessage('กล้องพร้อม วาง QR / Barcode ในกรอบ ระบบจะบันทึกให้อัตโนมัติ', 'SUCCESS');
    } catch (error) {
      setScannerStatus('ใช้ช่องกรอกรหัสแทน', 'ERROR');
      if (!config.silent) {
        beep('warn');
        setScanMessage(errorMessage(error), 'WARN');
      }
    } finally {
      focusCodeInput();
    }
  }

  function stopCamera() {
    if (state.scanner) state.scanner.stop();
    setScannerStatus('พร้อมรับรหัสจากช่องกรอก', 'IDLE');
    focusCodeInput();
  }

  async function processCode(rawCode, meta) {
    const cleanCode = normalizeCode(rawCode);
    const source = meta && meta.source ? String(meta.source) : 'SCAN';

    if (!cleanCode) {
      beep('warn');
      setScanMessage('อ่านรหัสไม่ได้ กรุณาสแกนใหม่', 'WARN');
      resetForNextScan();
      return;
    }

    if (!state.moduleId) {
      beep('warn');
      setScanMessage('กรุณาเลือก Module ก่อนสแกน', 'WARN');
      resetForNextScan();
      return;
    }

    if (isDuplicateBlocked(cleanCode)) {
      beep('duplicate');
      setScanMessage('กันการสแกนซ้ำ: ' + cleanCode, 'WARN');
      resetForNextScan();
      return;
    }

    if (state.inFlightCodes.has(cleanCode)) return;

    state.inFlightCodes.add(cleanCode);
    blockDuplicate(cleanCode, DUPLICATE_BLOCK_MS);
    if (state.scanner && typeof state.scanner.pause === 'function') state.scanner.pause(1000);

    setScannerStatus('กำลังตรวจสอบ', 'BUSY');
    setScanMessage('กำลังค้นหาและตรวจสถานะ ' + cleanCode, 'BUSY');
    clearInput();

    try {
      beep('scan');
      const lookupRaw = await API.lookupInboundWorkflow(state.moduleId, cleanCode, {
        method: source,
        qrText: meta && meta.rawText ? meta.rawText : cleanCode
      });

      const lookup = normalizeLookup(lookupRaw);
      state.currentLookup = lookup;
      renderLookupResult(lookup);
      upsertDashboardItemFromLookup(lookup);
      renderDashboard();

      const action = getAutoAction(lookup);
      if (action.type === 'SUBMIT_DOCUMENT') {
        await autoSubmitDocument(lookup, source);
      } else if (action.type === 'RETURN_DOCUMENT') {
        await autoReturnDocument(lookup, source);
      } else {
        beep(action.level === 'WARN' ? 'warn' : 'success');
        setScanMessage(action.message, action.level || 'SUCCESS');
        blockDuplicate(cleanCode, HARD_BLOCK_AFTER_SAVE_MS);
      }
    } catch (error) {
      beep('error');
      renderLookupError(cleanCode, error);
      setScanMessage(errorMessage(error), 'ERROR');
    } finally {
      state.inFlightCodes.delete(cleanCode);
      setScannerStatus('พร้อมสแกนรายการถัดไป', state.scanner && state.scanner.running ? 'READY' : 'IDLE');
      resetForNextScan();
    }
  }

  async function autoSubmitDocument(lookup, source) {
    const autoId = lookup.record.autoId;
    setScanMessage('พบข้อมูล กำลังบันทึกยื่นเอกสาร: ' + autoId, 'BUSY');
    const result = await API.submitInboundDocument(state.moduleId, {
      entryCode: autoId,
      qrText: autoId,
      method: source || 'SCAN',
      note: 'บันทึกอัตโนมัติจากการสแกน Inbound'
    });
    const updated = normalizeLookup(result, lookup.record);
    state.currentLookup = updated;
    renderLookupResult(updated);
    upsertDashboardItemFromLookup(updated);
    renderDashboard();
    blockDuplicate(autoId, HARD_BLOCK_AFTER_SAVE_MS);
    beep('success');
    setScanMessage('บันทึกยื่นเอกสารแล้ว: ' + autoId, 'SUCCESS');
    void loadWorkflowDashboard(true);
  }

  async function autoReturnDocument(lookup, source) {
    const autoId = lookup.record.autoId;
    setScanMessage('พบข้อมูล กำลังบันทึกรับเอกสารคืน: ' + autoId, 'BUSY');
    const result = await API.returnInboundDocument(state.moduleId, {
      entryCode: autoId,
      qrText: autoId,
      method: source || 'SCAN',
      note: 'รับเอกสารคืนอัตโนมัติจากการสแกน Inbound'
    });
    const updated = normalizeLookup(result, lookup.record);
    state.currentLookup = updated;
    renderLookupResult(updated);
    upsertDashboardItemFromLookup(updated);
    renderDashboard();
    blockDuplicate(autoId, HARD_BLOCK_AFTER_SAVE_MS);
    beep('success');
    setScanMessage('บันทึกรับเอกสารคืนแล้ว: ' + autoId, 'SUCCESS');
    void loadWorkflowDashboard(true);
  }

  function getAutoAction(lookup) {
    const record = lookup && lookup.record ? lookup.record : {};
    const workflow = lookup && lookup.state ? lookup.state : {};
    const status = String(workflow.statusCode || '').toUpperCase();

    if (!record.autoId) return {type: 'NONE', level: 'WARN', message: 'ไม่พบ Auto ID'};
    if (record.timestampOut || workflow.gateOutAt) return {type: 'NONE', level: 'WARN', message: 'รายการนี้มีเวลาออกคลังแล้ว: ' + record.autoId};
    if (workflow.cancelled || status === 'CANCELLED') return {type: 'NONE', level: 'WARN', message: 'รายการนี้ถูกยกเลิกแล้ว: ' + (workflow.cancelReason || record.autoId)};

    if (!workflow.documentSubmittedAt && !['DOCUMENT_SUBMITTED', 'RECEIVING_COMPLETED', 'DOCUMENT_RETURNED'].includes(status)) {
      return {type: 'SUBMIT_DOCUMENT', level: 'BUSY', message: 'บันทึกยื่นเอกสาร'};
    }

    if (workflow.documentSubmittedAt && !workflow.receivingCompletedAt) {
      return {type: 'NONE', level: 'WARN', message: 'รายการนี้ยื่นเอกสารแล้ว รอ User/Admin กดรับสินค้าเสร็จ: ' + record.autoId};
    }

    if (workflow.receivingCompletedAt && !workflow.documentReturnedAt && status === 'RECEIVING_COMPLETED') {
      return {type: 'RETURN_DOCUMENT', level: 'BUSY', message: 'บันทึกรับเอกสารคืน'};
    }

    if (workflow.documentReturnedAt || status === 'DOCUMENT_RETURNED') {
      return {type: 'NONE', level: 'SUCCESS', message: 'รายการนี้รับเอกสารคืนแล้ว รอ Gate Out: ' + record.autoId};
    }

    return {type: 'NONE', level: 'WARN', message: workflow.nextStepText || 'สถานะนี้ยังไม่พร้อมบันทึกขั้นตอนถัดไป'};
  }

  async function loadWorkflowDashboard(silent) {
    if (!state.moduleId || !API || typeof API.getInboundWorkflowDashboard !== 'function') {
      renderDashboard();
      return;
    }
    try {
      if (!silent) setScanMessage('กำลังโหลดตารางสถานะ', 'BUSY');
      const data = await API.getInboundWorkflowDashboard(state.moduleId, {limit: DASHBOARD_LIMIT});
      state.dashboardItems = normalizeDashboardItems(data);
      renderDashboard();
      if (!silent) setScanMessage('โหลดข้อมูลล่าสุดแล้ว', 'SUCCESS');
    } catch (error) {
      console.warn('workflow dashboard failed', error);
      renderDashboard();
      if (!silent) setScanMessage('โหลดตารางไม่สำเร็จ: ' + errorMessage(error), 'WARN');
    } finally {
      focusCodeInput();
    }
  }

  function normalizeDashboardItems(data) {
    const source = data && data.data && typeof data.data === 'object' ? data.data : data && typeof data === 'object' ? data : {};
    const list = []
      .concat(Array.isArray(source.items) ? source.items : [])
      .concat(Array.isArray(source.waitingReceiving) ? source.waitingReceiving : [])
      .concat(Array.isArray(source.receivingCompleted) ? source.receivingCompleted : [])
      .concat(Array.isArray(source.documentReturned) ? source.documentReturned : []);
    const map = new Map();
    list.forEach((item) => {
      const normalized = normalizeDashboardItem(item);
      if (!normalized.autoId) return;
      const existing = map.get(normalized.autoId);
      if (!existing || dateToMs(normalized.updatedAt) >= dateToMs(existing.updatedAt)) map.set(normalized.autoId, normalized);
    });
    return Array.from(map.values()).sort((a, b) => dateToMs(b.updatedAt) - dateToMs(a.updatedAt));
  }

  function normalizeDashboardItem(item) {
    const source = item && typeof item === 'object' ? item : {};
    const statusCode = String(source.statusCode || source.status || '').trim().toUpperCase();
    const record = source.record || source.vehicle || source.sourceRecord || {};
    return {
      autoId: text(source.autoId || source.entryCode || source.recordId || record.autoId),
      statusCode,
      statusName: text(source.statusName || statusName(statusCode)),
      nextStepText: text(source.nextStepText),
      appointmentNumber: text(source.appointmentNumber || source.appointment || record.appointmentNumber || record.appointment),
      companyName: text(source.companyName || source.company || record.companyName || record.company),
      driverName: text(source.driverName || source.fullName || record.driverName || record.fullName),
      registration: text(source.registration || source.plate || record.registration || record.plate),
      province: text(source.province || record.province),
      phone: text(source.phone || source.mobile || record.phone || record.mobile),
      vehicleType: text(source.vehicleType || record.vehicleType),
      gateInAt: text(source.gateInAt || source.timestampIn || record.timestampIn),
      documentSubmittedAt: text(source.documentSubmittedAt),
      receivingCompletedAt: text(source.receivingCompletedAt),
      documentReturnedAt: text(source.documentReturnedAt),
      gateOutAt: text(source.gateOutAt || source.timestampOut || record.timestampOut),
      updatedAt: text(source.updatedAt || source.updatedAtText || source.generatedAt),
      updatedBy: text(source.updatedBy),
      cancelled: source.cancelled === true || statusCode === 'CANCELLED',
      cancelReason: text(source.cancelReason)
    };
  }

  function normalizeLookup(result, fallbackRecord) {
    const data = result && result.data && typeof result.data === 'object' ? result.data : result && typeof result === 'object' ? result : {};
    const rawRecord = data.record || data.vehicle || data.sourceRecord || fallbackRecord || {};
    const rawState = data.state || data.workflowState || data.currentState || {};
    const autoId = text(rawRecord.autoId || rawRecord.autoID || rawRecord.entryCode || rawState.autoId || data.autoId || data.entryCode);
    const firstName = text(rawRecord.firstName || rawRecord.name || rawRecord.driverFirstName);
    const lastName = text(rawRecord.lastName || rawRecord.surname || rawRecord.driverLastName);
    const prefix = text(rawRecord.prefix || rawRecord.title);
    return {
      success: data.success !== false,
      record: {
        autoId,
        timestampIn: text(rawRecord.timestampIn || rawRecord.gateInAt || rawRecord.timestamp),
        timestampOut: text(rawRecord.timestampOut || rawRecord.gateOutAt),
        appointmentNumber: text(rawRecord.appointmentNumber || rawRecord.appointment || rawRecord.booking),
        companyName: text(rawRecord.companyName || rawRecord.company),
        phone: text(rawRecord.phone || rawRecord.mobile || rawRecord.tel),
        registration: text(rawRecord.registration || rawRecord.plate || rawRecord.vehiclePlate),
        province: text(rawRecord.province),
        vehicleType: text(rawRecord.vehicleType || rawRecord.type),
        driverName: text(rawRecord.driverName || rawRecord.fullName || [prefix, firstName, lastName].filter(Boolean).join(' '))
      },
      state: {
        autoId,
        statusCode: text(rawState.statusCode || data.statusCode).toUpperCase(),
        statusName: text(rawState.statusName || data.statusName),
        nextStepText: text(rawState.nextStepText || data.nextStepText),
        documentSubmittedAt: text(rawState.documentSubmittedAt || rawState.documentSubmittedAtText),
        receivingCompletedAt: text(rawState.receivingCompletedAt || rawState.receivingCompletedAtText),
        documentReturnedAt: text(rawState.documentReturnedAt || rawState.documentReturnedAtText),
        gateOutAt: text(rawState.gateOutAt || rawState.gateOutAtText),
        updatedAt: text(rawState.updatedAt || rawState.updatedAtText),
        updatedBy: text(rawState.updatedBy),
        cancelled: rawState.cancelled === true || text(rawState.statusCode).toUpperCase() === 'CANCELLED',
        cancelReason: text(rawState.cancelReason)
      }
    };
  }

  function renderDashboard() {
    const counts = countSummary(state.dashboardItems);
    setText('countTotalWorkflow', counts.total);
    setText('countWaitingReceiving', counts.waitingReceiving);
    setText('countReceivingCompleted', counts.receivingCompleted);
    setText('countDocumentReturned', counts.documentReturned);
    setText('countCancelled', counts.cancelled);
    renderWorkflowTable();
  }

  function renderWorkflowTable() {
    const tbody = byId('workflowTableBody');
    if (!tbody) return;
    const query = state.dashboardQuery;
    const filtered = state.dashboardItems.filter((item) => {
      const statusOk = state.statusFilter === 'ALL' || item.statusCode === state.statusFilter || (state.statusFilter === 'CANCELLED' && item.cancelled);
      if (!statusOk) return false;
      if (!query) return true;
      return [item.autoId, item.appointmentNumber, item.companyName, item.driverName, item.registration, item.province, item.phone, item.statusName]
        .join(' ').toLowerCase().includes(query);
    }).slice(0, 300);

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="table-empty">ยังไม่มีข้อมูลตามเงื่อนไข</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map((item) => `
      <tr data-auto-id="${escapeHtml(item.autoId)}">
        <td><span class="status-pill" data-status="${escapeHtml(item.statusCode)}">${escapeHtml(item.statusName || statusName(item.statusCode))}</span></td>
        <td><strong>${escapeHtml(item.autoId || '-')}</strong><span>${escapeHtml(item.vehicleType || '')}</span></td>
        <td>${escapeHtml(item.appointmentNumber || '-')}</td>
        <td><strong>${escapeHtml(item.companyName || '-')}</strong></td>
        <td>${escapeHtml(item.driverName || '-')}</td>
        <td><strong>${escapeHtml(formatPlate(item))}</strong><span>${escapeHtml(item.province || '')}</span></td>
        <td>${escapeHtml(item.phone || '-')}</td>
        <td><strong>${escapeHtml(displayLatestTime(item) || '-')}</strong><span>${escapeHtml(item.nextStepText || '')}</span></td>
        <td><button type="button" class="icon-button" data-open-detail title="ดูรายละเอียด">✎</button></td>
      </tr>
    `).join('');
  }

  function upsertDashboardItemFromLookup(lookup) {
    const item = dashboardItemFromLookup(lookup);
    if (!item.autoId) return;
    state.dashboardItems = [item]
      .concat(state.dashboardItems.filter((entry) => entry.autoId !== item.autoId))
      .sort((a, b) => dateToMs(b.updatedAt) - dateToMs(a.updatedAt));
  }

  function dashboardItemFromLookup(lookup) {
    const record = lookup && lookup.record ? lookup.record : {};
    const workflow = lookup && lookup.state ? lookup.state : {};
    const statusCode = text(workflow.statusCode).toUpperCase();
    return {
      autoId: text(record.autoId || workflow.autoId),
      statusCode,
      statusName: text(workflow.statusName || statusName(statusCode)),
      nextStepText: text(workflow.nextStepText),
      appointmentNumber: text(record.appointmentNumber),
      companyName: text(record.companyName),
      driverName: text(record.driverName),
      registration: text(record.registration),
      province: text(record.province),
      phone: text(record.phone),
      vehicleType: text(record.vehicleType),
      gateInAt: text(record.timestampIn),
      documentSubmittedAt: text(workflow.documentSubmittedAt),
      receivingCompletedAt: text(workflow.receivingCompletedAt),
      documentReturnedAt: text(workflow.documentReturnedAt),
      gateOutAt: text(record.timestampOut || workflow.gateOutAt),
      updatedAt: text(workflow.updatedAt || formatBangkokDateTime(new Date())),
      updatedBy: text(workflow.updatedBy),
      cancelled: workflow.cancelled === true || statusCode === 'CANCELLED',
      cancelReason: text(workflow.cancelReason)
    };
  }

  function renderLookupResult(lookup) {
    const panel = byId('lookupResultPanel');
    const body = byId('resultBody');
    if (!panel || !body) return;
    const record = lookup.record || {};
    const workflow = lookup.state || {};
    const status = workflow.statusName || statusName(workflow.statusCode) || '-';
    panel.hidden = false;
    setText('resultTitle', 'ผลการสแกนล่าสุด');
    setText('resultStatusBadge', status);
    body.innerHTML = `
      <div class="result-identity">
        <strong>${escapeHtml(record.autoId || '-')}</strong>
        <span>${escapeHtml(record.companyName || '-')} · ${escapeHtml(formatPlate(record))} · ${escapeHtml(record.driverName || '-')}</span>
      </div>
      <div class="result-grid">
        ${fieldHtml('เลขนัดหมาย', record.appointmentNumber || '-')}
        ${fieldHtml('เบอร์โทร', record.phone || '-')}
        ${fieldHtml('ชื่อ พขร.', record.driverName || '-')}
        ${fieldHtml('ทะเบียน / จังหวัด', formatPlate(record) + (record.province ? ' · ' + record.province : ''))}
        ${fieldHtml('เวลาเข้า Gate In', record.timestampIn || '-')}
        ${fieldHtml('ยื่นเอกสาร', workflow.documentSubmittedAt || '-')}
        ${fieldHtml('รับสินค้าเสร็จ', workflow.receivingCompletedAt || '-')}
        ${fieldHtml('รับเอกสารคืน', workflow.documentReturnedAt || '-')}
        ${fieldHtml('ขั้นตอนถัดไป', workflow.nextStepText || '-')}
        ${fieldHtml('อัปเดตล่าสุด', workflow.updatedAt || '-')}
      </div>
    `;
  }

  function renderLookupError(code, error) {
    const panel = byId('lookupResultPanel');
    const body = byId('resultBody');
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
  }

  function renderSelectedRecord(item) {
    const panel = byId('selectedRecordPanel');
    const body = byId('selectedRecordBody');
    if (!panel || !body) return;
    panel.hidden = false;
    body.innerHTML = `
      <div class="selected-grid">
        ${selectedField('Auto ID', item.autoId)}
        ${selectedField('สถานะ', item.statusName || statusName(item.statusCode))}
        ${selectedField('เลขนัดหมาย', item.appointmentNumber)}
        ${selectedField('ชื่อบริษัท', item.companyName)}
        ${selectedField('ชื่อ พขร.', item.driverName)}
        ${selectedField('ทะเบียน / จังหวัด', formatPlate(item) + (item.province ? ' · ' + item.province : ''))}
        ${selectedField('เบอร์โทร', item.phone)}
        ${selectedField('เวลาเข้า Gate In', item.gateInAt)}
        ${selectedField('ยื่นเอกสาร', item.documentSubmittedAt)}
        ${selectedField('รับสินค้าเสร็จ', item.receivingCompletedAt)}
        ${selectedField('รับเอกสารคืน', item.documentReturnedAt)}
        ${selectedField('Gate Out', item.gateOutAt)}
        ${selectedField('ขั้นตอนถัดไป', item.nextStepText)}
        ${selectedField('อัปเดตล่าสุด', item.updatedAt)}
      </div>
    `;
  }

  function clearCurrentResult() {
    state.currentLookup = null;
    const panel = byId('lookupResultPanel');
    if (panel) panel.hidden = true;
  }

  function resetForNextScan() {
    window.setTimeout(() => {
      clearInput();
      focusCodeInput();
    }, 20);
  }

  function clearInput() {
    const input = byId('entryCodeInput');
    if (input) input.value = '';
  }

  function getEntryCode() {
    return normalizeCode(byId('entryCodeInput')?.value || '');
  }

  function focusCodeInput() {
    const input = byId('entryCodeInput');
    if (!input) return;
    try { input.focus({preventScroll: true}); } catch (error) { input.focus(); }
    try { input.select(); } catch (error) {}
  }

  function looksLikeCompleteCode(code) {
    const value = normalizeCode(code);
    if (value.length < MIN_CODE_LENGTH) return false;
    if (/^SK\d{8,14}$/i.test(value)) return true;
    return value.length >= 10 && /^[A-Z0-9_-]+$/i.test(value);
  }

  function normalizeCode(value) {
    return String(value || '')
      .trim()
      .replace(/^https?:\/\/[^?]+\?/i, '')
      .replace(/^.*(?:autoId|entryCode|code)=/i, '')
      .split(/[&#\s]/)[0]
      .trim()
      .toUpperCase();
  }

  function isDuplicateBlocked(code) {
    const until = state.recentCodes.get(code) || 0;
    return Date.now() < until;
  }

  function blockDuplicate(code, ms) {
    state.recentCodes.set(code, Date.now() + (Number(ms) || DUPLICATE_BLOCK_MS));
    if (state.scanner && typeof state.scanner.blockText === 'function') {
      state.scanner.blockText(code, Number(ms) || DUPLICATE_BLOCK_MS);
    }
    cleanupDuplicateMap();
  }

  function cleanupDuplicateMap() {
    const now = Date.now();
    state.recentCodes.forEach((until, code) => {
      if (until < now) state.recentCodes.delete(code);
    });
  }

  function countSummary(items) {
    const list = Array.isArray(items) ? items : [];
    return {
      total: list.length,
      waitingReceiving: list.filter((item) => item.statusCode === 'DOCUMENT_SUBMITTED').length,
      receivingCompleted: list.filter((item) => item.statusCode === 'RECEIVING_COMPLETED').length,
      documentReturned: list.filter((item) => item.statusCode === 'DOCUMENT_RETURNED').length,
      cancelled: list.filter((item) => item.cancelled || item.statusCode === 'CANCELLED').length
    };
  }

  function displayLatestTime(item) {
    return item.documentReturnedAt || item.receivingCompletedAt || item.documentSubmittedAt || item.gateInAt || item.updatedAt || '';
  }

  function statusName(code) {
    const value = String(code || '').toUpperCase();
    if (value === 'DOCUMENT_SUBMITTED') return 'รอรับสินค้า';
    if (value === 'RECEIVING_COMPLETED') return 'รอรับเอกสารคืน';
    if (value === 'DOCUMENT_RETURNED') return 'คืนเอกสารแล้ว';
    if (value === 'GATE_OUT_COMPLETED') return 'ออกคลังแล้ว';
    if (value === 'CANCELLED') return 'ยกเลิก';
    if (value === 'GATE_IN_ONLY') return 'รอยื่นเอกสาร';
    return value || 'รอยื่นเอกสาร';
  }

  function formatPlate(item) {
    return text(item.registration || item.plate || '-');
  }

  function fieldHtml(label, value) {
    return `<div class="result-field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '-')}</strong></div>`;
  }

  function selectedField(label, value) {
    return `<div class="selected-field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '-')}</strong></div>`;
  }

  function setLookupBusy(isBusy) {
    const input = byId('entryCodeInput');
    const button = byId('lookupCodeButton');
    if (input) input.disabled = Boolean(isBusy);
    if (button) button.disabled = Boolean(isBusy);
  }

  function setScanMessage(message, mode) {
    const element = byId('scanMessage');
    if (!element) return;
    element.textContent = message || '';
    element.dataset.state = mode || 'IDLE';
  }

  function setScannerStatus(message, mode) {
    const element = byId('scannerStatus');
    if (!element) return;
    element.textContent = message || '';
    element.dataset.state = mode || 'IDLE';
  }

  function setConnection(message, mode) {
    const element = byId('inboundConnection');
    if (!element) return;
    element.textContent = message || '';
    element.dataset.state = mode || 'LOADING';
  }

  function showLoading(show) {
    byId('inboundLoading')?.classList.toggle('is-hidden', !show);
  }

  function startClock() {
    updateClock();
    state.clockTimer = window.setInterval(updateClock, 1000);
  }

  function updateClock() {
    setText('inboundDateTime', formatBangkokDateTime(new Date()));
  }

  function formatBangkokDateTime(date) {
    const value = date instanceof Date ? date : new Date(date);
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Bangkok',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    }).formatToParts(value).reduce((acc, item) => {
      acc[item.type] = item.value;
      return acc;
    }, {});
    return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
  }

  function dateToMs(value) {
    if (!value) return 0;
    const textValue = String(value).trim();
    const match = textValue.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
    if (match) {
      return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6])).getTime();
    }
    const ms = Date.parse(textValue);
    return Number.isFinite(ms) ? ms : 0;
  }

  function unlockAudio() {
    if (state.audioUnlocked) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      state.audioContext = state.audioContext || new AudioContext();
      if (state.audioContext.state === 'suspended') state.audioContext.resume();
      state.audioUnlocked = true;
    } catch (error) {}
  }

  function beep(type) {
    try {
      unlockAudio();
      const ctx = state.audioContext;
      if (!ctx) return;
      const now = ctx.currentTime;
      const volume = type === 'error' ? 0.62 : type === 'success' ? 0.58 : type === 'scan' ? 0.52 : 0.42;
      const freqs = type === 'success' ? [880, 1175] : type === 'error' ? [260, 180] : type === 'duplicate' ? [420] : type === 'warn' ? [520, 420] : [980];
      freqs.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        const start = now + index * 0.08;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.095);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.11);
      });
    } catch (error) {}
  }

  async function logout() {
    try {
      if (API && typeof API.logout === 'function') await API.logout();
    } catch (error) {}
    try { window.sessionStorage.removeItem('alertvendor_access_token'); } catch (error) {}
    redirectToLogin();
  }

  function redirectToLogin() {
    window.location.replace(CONFIG.LOGIN_URL || './login.html');
  }

  function destroy() {
    window.clearInterval(state.clockTimer);
    window.clearTimeout(state.inputTimer);
    stopCamera();
  }

  function normalizeRole(value) {
    const role = String(value || '').trim().toUpperCase();
    if (role === 'ADMIN') return 'ADMIN';
    if (role === 'INBOUND') return 'INBOUND';
    return 'USER';
  }

  function showAlert(title, message, icon) {
    if (window.Swal) {
      return window.Swal.fire({title, text: message, icon: icon || 'info', confirmButtonText: 'ตกลง'});
    }
    window.alert(title + '\n' + message);
    return Promise.resolve();
  }

  function byId(id) { return document.getElementById(id); }
  function setText(id, value) { const el = byId(id); if (el) el.textContent = String(value ?? ''); }
  function text(value) { return value === null || value === undefined ? '' : String(value).trim(); }
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function errorMessage(error) {
    return String(error && (error.message || error.details && error.details.message) || error || 'เกิดข้อผิดพลาด');
  }
  function createClientError(code, message) {
    const error = new Error(message || code);
    error.code = code;
    return error;
  }
})(window, document);
