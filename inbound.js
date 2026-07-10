/************************************************************
 * inbound.js
 * ROUND 06 PART 03 — Scanner Buffer Restore + SLA Progress Bar
 ************************************************************/
(function (window, document) {
  'use strict';

  const CONFIG = window.APP_CONFIG || {};
  const API = window.VehicleAPI;
  const DUPLICATE_BLOCK_MS = 45000;
  const HARD_BLOCK_AFTER_SAVE_MS = 120000;
  const INPUT_DEBOUNCE_MS = 450;
  const MIN_CODE_LENGTH = 6;
  const DASHBOARD_LIMIT = 100;
  const FOCUS_SUPPRESS_MS = 18000;
  const DASHBOARD_CACHE_PREFIX = 'ALERT_VENDOR_INBOUND_DASHBOARD_CACHE_V10_';
  const DASHBOARD_CACHE_MAX_ITEMS = 800;

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
    recentDuplicateNotices: new Map(),
    hardwareScanBuffer: '',
    hardwareScanTimer: 0,
    hardwareScannerBound: false,
    keyboardCaptureActive: false,
    scannerKeyBuffer: '',
    scannerKeyTimer: 0,
    scannerLastKeyAt: 0,
    audioContext: null,
    audioUnlocked: false,
    suppressFocusUntil: 0,
    cameraWanted: false,
    tablePage: 1,
    tablePageSize: 'AUTO',
    computedPageSize: 20,
    filteredTotal: 0,
    dashboardLoadedAt: '',
    dashboardCacheRestored: false,
    dashboardRequestToken: 0,
    slaSummary: {
      normal: 0,
      warning: 0,
      critical: 0
    }
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

      setConnection(role === 'ADMIN' ? 'ADMIN MODE' : 'INBOUND ONLINE', 'READY');
      setText('inboundUser', (user.displayName || user.username || '-') + ' · ' + role);

      await loadModules();
      restoreDashboardCache({silent: true});
      createScanner();
      await loadWorkflowDashboard(true, {cacheFirst: false});
      focusCodeInput();

      // คอมพิวเตอร์ที่เสียบเครื่องสแกนจะพร้อมรับรหัสทันที
      setScanMessage('พร้อมรับรหัสจากกล้อง / กล่องสแกน QR / การกรอกมือ', 'SUCCESS');

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
    byId('inboundRefreshButton')?.addEventListener('click', () => void loadWorkflowDashboard(false, {manual: true}));
    byId('inboundFullscreenButton')?.addEventListener('click', () => void toggleInboundFullscreen());
    byId('startCameraButton')?.addEventListener('click', () => void startCamera({silent: false}));
    byId('stopCameraButton')?.addEventListener('click', stopCamera);
    byId('clearCodeButton')?.addEventListener('click', () => {
      clearInput();
      clearCurrentResult();
      focusCodeInput(true);
    });
    byId('closeSelectedPanel')?.addEventListener('click', () => {
      const panel = byId('selectedRecordPanel');
      if (panel) panel.hidden = true;
      focusCodeInput(true);
    });

    byId('manualLookupForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const code = getEntryCode();
      if (code) {
        void processCode(code, {source: 'KEYBOARD_ENTER', rawText: code});
      } else {
        beep('warn');
        setScanMessage('กรุณากรอก Auto ID ก่อนค้นหา', 'WARN');
        focusCodeInput(true);
      }
    });

    const input = byId('entryCodeInput');
    if (input) {
      input.addEventListener('focus', unlockAudio);
      input.addEventListener('click', unlockAudio);
      input.addEventListener('keydown', (event) => {
        unlockAudio();

        /*
         * Round 06 Part 03:
         * กล่องสแกนแบบ Keyboard Wedge ให้ตัวอักษรลง input ตามปกติ
         * ส่วน document capture จะเก็บ buffer คู่ขนานไว้
         * Enter/Tab ใช้ buffer หรือค่าจาก input แล้วแต่ตัวไหนครบกว่า
         */
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          event.stopPropagation();

          window.clearTimeout(state.inputTimer);
          window.clearTimeout(state.scannerKeyTimer);

          window.setTimeout(() => {
            const code = normalizeCode(
              chooseBetterScanCode(
                state.scannerKeyBuffer,
                getEntryCode()
              )
            );

            clearScannerKeyBuffer();

            if (code) {
              setEntryCodeInput(code, {focus: true});
              void processCode(code, {
                source: event.key === 'Tab'
                  ? 'KEYBOARD_SCANNER_TAB'
                  : 'KEYBOARD_SCANNER_ENTER',
                rawText: code
              });
            }
          }, 0);
        }
      });

      input.addEventListener('input', () => {
        unlockAudio();

        window.clearTimeout(state.inputTimer);
        state.inputTimer = window.setTimeout(() => {
          const code = normalizeCode(
            chooseBetterScanCode(
              state.scannerKeyBuffer,
              getEntryCode()
            )
          );

          if (looksLikeCompleteCode(code)) {
            clearScannerKeyBuffer();
            setEntryCodeInput(code, {focus: true});
            void processCode(code, {source: 'KEYBOARD_SCAN_NATIVE_IDLE', rawText: code});
          }
        }, INPUT_DEBOUNCE_MS);
      });

      input.addEventListener('paste', () => {
        unlockAudio();
        window.setTimeout(() => {
          const code = getEntryCode();
          if (looksLikeCompleteCode(code)) {
            void processCode(code, {source: 'HARDWARE_SCANNER_PASTE', rawText: code});
          }
        }, 20);
      });
    }


    bindHardwareScannerCapture();

    byId('inboundModuleSelect')?.addEventListener('change', async (event) => {
      if (CONFIG.INBOUND_FORCE_CANONICAL_MODULE) {
        const canonical = findCanonicalInboundModule();
        if (canonical) {
          state.moduleId = canonical.moduleId;
          event.target.value = canonical.moduleId;
        }
        setScanMessage('หน้า Inbound ใช้แหล่งข้อมูลเดียวกับหน้างานจริงเท่านั้น', 'WARN');
        focusCodeInput(true);
        return;
      }

      state.moduleId = String(event.target.value || '').trim();
      clearCurrentResult();
      restoreDashboardCache({replace: true, silent: true});
      await loadWorkflowDashboard(false, {cacheFirst: false, moduleChanged: true});
      focusCodeInput(true);
    });

    const searchInput = byId('workflowSearchInput');
    searchInput?.addEventListener('focus', pauseScanFocus);
    searchInput?.addEventListener('input', (event) => {
      pauseScanFocus();
      state.dashboardQuery = String(event.target.value || '').trim().toLowerCase();
      resetWorkflowPage();
      renderWorkflowTable();
    });

    byId('workflowPageSizeSelect')?.addEventListener('change', (event) => {
      pauseScanFocus();
      state.tablePageSize = String(event.target.value || 'AUTO').toUpperCase();
      resetWorkflowPage();
      renderWorkflowTable();
    });

    byId('workflowPrevPage')?.addEventListener('click', () => {
      pauseScanFocus();
      state.tablePage = Math.max(1, state.tablePage - 1);
      renderWorkflowTable();
    });

    byId('workflowNextPage')?.addEventListener('click', () => {
      pauseScanFocus();
      const totalPages = getWorkflowTotalPages();
      state.tablePage = Math.min(totalPages, state.tablePage + 1);
      renderWorkflowTable();
    });

    document.querySelector('.status-strip')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-status-filter]');
      if (!button) return;
      state.statusFilter = String(button.dataset.statusFilter || 'ALL').toUpperCase();
      document.querySelectorAll('[data-status-filter]').forEach((item) => {
        item.classList.toggle('is-active', item === button);
      });
      resetWorkflowPage();
      renderWorkflowTable();
    });

    byId('workflowTableBody')?.addEventListener('click', (event) => {
      const row = event.target.closest('[data-auto-id]');
      if (!row) return;
      const autoId = row.dataset.autoId || '';
      const item = state.dashboardItems.find((entry) => entry.autoId === autoId);
      pauseScanFocus();
      if (item) {
        void openRecordDetailAlert(item);
      }
    });

    document.addEventListener('click', unlockAudio, {capture: true});
    document.addEventListener('pointerdown', handlePointerIntent, {capture: true});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        keepCameraStandby();
        focusCodeInput(false);
        refreshAutoPageSize();
        void loadWorkflowDashboard(true, {cacheFirst: false});
      }
    });

    window.addEventListener('resize', debounce(() => {
      refreshAutoPageSize();
      renderWorkflowTable();
    }, 140), {passive: true});

    document.addEventListener('fullscreenchange', syncFullscreenButton);
    document.addEventListener('webkitfullscreenchange', syncFullscreenButton);
    document.addEventListener('msfullscreenchange', syncFullscreenButton);
  }

  async function toggleInboundFullscreen() {
    const root = document.documentElement;

    try {
      const fullscreenElement =
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.msFullscreenElement ||
        null;

      if (fullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if (document.msExitFullscreen) document.msExitFullscreen();
        syncFullscreenButton();
        return;
      }

      if (root.requestFullscreen) await root.requestFullscreen();
      else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
      else if (root.msRequestFullscreen) root.msRequestFullscreen();
      else {
        await showAlert(
          'ไม่รองรับเต็มจอ',
          'เบราว์เซอร์นี้ไม่อนุญาตให้เปิดโหมดเต็มจอจากหน้าเว็บ',
          'info'
        );
        return;
      }

      syncFullscreenButton();
      window.setTimeout(() => {
        refreshAutoPageSize();
        renderWorkflowTable();
        focusCodeInput(false);
      }, 160);

    } catch (error) {
      await showAlert(
        'เปิดเต็มจอไม่สำเร็จ',
        errorMessage(error) || 'กรุณากดปุ่มอีกครั้ง หรือใช้ปุ่ม F11 ของคีย์บอร์ด',
        'warning'
      );
    }
  }

  function syncFullscreenButton() {
    const isFullscreen = Boolean(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.msFullscreenElement
    );

    document.body.classList.toggle('inbound-is-fullscreen', isFullscreen);

    const button = byId('inboundFullscreenButton');
    if (button) {
      button.textContent = isFullscreen ? 'ออกเต็มจอ' : 'เต็มจอ';
      button.title = isFullscreen ? 'ออกจากเต็มจอ' : 'เปิดเต็มจอ';
      button.setAttribute('aria-label', isFullscreen ? 'ออกจากเต็มจอ' : 'เปิดเต็มจอ');
    }
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
    const requested = String(params.get('module') || params.get('id') || '').trim();
    const canonical = findCanonicalInboundModule();

    /*
     * Hotfix 32:
     * หน้า Inbound ต้องใช้แหล่งข้อมูลเดียวกันทั้ง ADMIN และ INBOUND
     * จึงบังคับ default เป็นโมดูลหน้างานจริง ไม่ให้ ADMIN ไปเริ่มที่ Makro
     */
    if (CONFIG.INBOUND_FORCE_CANONICAL_MODULE && canonical) {
      state.moduleId = canonical.moduleId;
    } else if (requested && moduleExists(requested)) {
      state.moduleId = requested;
    } else if (CONFIG.INBOUND_DEFAULT_MODULE_ID && moduleExists(CONFIG.INBOUND_DEFAULT_MODULE_ID)) {
      state.moduleId = CONFIG.INBOUND_DEFAULT_MODULE_ID;
    } else if (canonical) {
      state.moduleId = canonical.moduleId;
    } else {
      state.moduleId = (state.modules[0] && state.modules[0].moduleId) || '';
    }

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

    if (CONFIG.INBOUND_FORCE_CANONICAL_MODULE) {
      select.disabled = true;
      select.title = 'ล็อกแหล่งข้อมูลเดียวกับหน้างาน Inbound';
    } else {
      select.disabled = false;
      select.title = '';
    }
  }

  function moduleExists(moduleId) {
    const id = String(moduleId || '').trim();
    return state.modules.some((module) => module.moduleId === id);
  }

  function findCanonicalInboundModule() {
    if (!state.modules.length) {
      return null;
    }

    const exactName =
      normalizeSearchText(CONFIG.INBOUND_CANONICAL_MODULE_NAME || '');

    if (exactName) {
      const exact = state.modules.find((module) => (
        normalizeSearchText(module.name) === exactName ||
        normalizeSearchText(module.moduleId) === exactName
      ));

      if (exact) return exact;
    }

    const keywords =
      Array.isArray(CONFIG.INBOUND_CANONICAL_MODULE_KEYWORDS)
        ? CONFIG.INBOUND_CANONICAL_MODULE_KEYWORDS
        : [];

    const cleanKeywords = keywords
      .map((keyword) => normalizeSearchText(keyword))
      .filter(Boolean);

    if (cleanKeywords.length) {
      const matched = state.modules.find((module) => {
        const haystack = normalizeSearchText(
          (module.name || '') + ' ' + (module.moduleId || '')
        );
        return cleanKeywords.every((keyword) => haystack.includes(keyword));
      });

      if (matched) return matched;
    }

    return state.modules[0] || null;
  }

  function normalizeSearchText(value) {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ');
  }

  function createScanner() {
    if (!window.InboundScanner) {
      setScannerStatus('ใช้เครื่องสแกนหรือกรอกรหัส', 'IDLE');
      return;
    }
    state.scanner = new window.InboundScanner({
      video: byId('inboundVideo'),
      scanIntervalMs: 70,
      pauseAfterScanMs: 250,
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
    state.cameraWanted = true;
    try {
      setScannerStatus('กำลังเปิดกล้อง', 'BUSY');
      await state.scanner.start();
      setScannerStatus('กล้องสแตนด์บายพร้อมสแกน', 'READY');
      if (!config.silent) setScanMessage('กล้องเปิดสแตนด์บายแล้ว วาง QR / Barcode ในกรอบ ระบบจะบันทึกให้อัตโนมัติ', 'SUCCESS');
    } catch (error) {
      state.cameraWanted = false;
      setScannerStatus('ใช้ช่องกรอกรหัสแทน', 'ERROR');
      if (!config.silent) {
        beep('warn');
        setScanMessage(errorMessage(error), 'WARN');
      }
    } finally {
      if (config.keepFocus !== false) focusCodeInput(true);
    }
  }

  function stopCamera() {
    state.cameraWanted = false;
    if (state.scanner) state.scanner.stop();
    setScannerStatus('ปิดกล้องแล้ว ใช้ช่องกรอกรหัสแทน', 'IDLE');
    focusCodeInput(true);
  }

  function keepCameraStandby() {
    if (!state.cameraWanted || !state.scanner) return;
    if (state.scanner.running) {
      setScannerStatus('กล้องสแตนด์บายพร้อมสแกน', 'READY');
      return;
    }
    window.setTimeout(() => {
      if (state.cameraWanted && state.scanner && !state.scanner.running) {
        void startCamera({silent: true, keepFocus: false});
      }
    }, 250);
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
      setScanMessage('กันสแกนซ้ำ ไม่ยิงข้อมูลซ้ำ: ' + cleanCode, 'WARN');
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
        method: 'MANUAL',
        lookupMethod: 'MANUAL',
        qrText: meta && meta.rawText ? meta.rawText : cleanCode,
        scanSource: source
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
      keepCameraStandby();
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
      method: 'MANUAL',
      scanSource: source || 'SCAN',
      note: 'บันทึกอัตโนมัติจากการสแกน Inbound'
    });
    const updated = normalizeLookup(result, lookup.record);
    state.currentLookup = updated;
    renderLookupResult(updated);
    upsertDashboardItemFromLookup(updated);
    renderDashboard();
    blockDuplicate(autoId, HARD_BLOCK_AFTER_SAVE_MS);

    if (result && (result.duplicateStage || result.noWrite)) {
      beep('duplicate');
      setScanMessage(result.message || 'รายการนี้ยื่นเอกสารแล้ว ระบบไม่บันทึกซ้ำ: ' + autoId, 'WARN');
    } else {
      beep('success');
      setScanMessage('บันทึกยื่นเอกสารแล้ว: ' + autoId, 'SUCCESS');
    }

    void loadWorkflowDashboard(true);
  }

  async function autoReturnDocument(lookup, source) {
    const autoId = lookup.record.autoId;
    setScanMessage('พบข้อมูล กำลังบันทึกรับเอกสารคืน: ' + autoId, 'BUSY');
    const result = await API.returnInboundDocument(state.moduleId, {
      entryCode: autoId,
      qrText: autoId,
      method: 'MANUAL',
      scanSource: source || 'SCAN',
      note: 'รับเอกสารคืนอัตโนมัติจากการสแกน Inbound'
    });
    const updated = normalizeLookup(result, lookup.record);
    state.currentLookup = updated;
    renderLookupResult(updated);
    upsertDashboardItemFromLookup(updated);
    renderDashboard();
    blockDuplicate(autoId, HARD_BLOCK_AFTER_SAVE_MS);

    if (result && (result.duplicateStage || result.noWrite)) {
      beep('duplicate');
      setScanMessage(result.message || 'รายการนี้รับเอกสารคืนแล้ว ระบบไม่บันทึกซ้ำ: ' + autoId, 'WARN');
    } else {
      beep('success');
      setScanMessage('บันทึกรับเอกสารคืนแล้ว: ' + autoId, 'SUCCESS');
    }

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
      return {type: 'NONE', level: 'WARN', message: 'รายการนี้ยื่นเอกสารแล้ว ไม่บันทึกซ้ำ · รอ User/Admin กดรับสินค้าเสร็จ: ' + record.autoId};
    }

    if (workflow.receivingCompletedAt && !workflow.documentReturnedAt && status === 'RECEIVING_COMPLETED') {
      return {type: 'RETURN_DOCUMENT', level: 'BUSY', message: 'บันทึกรับเอกสารคืน'};
    }

    if (workflow.documentReturnedAt || status === 'DOCUMENT_RETURNED') {
      return {type: 'NONE', level: 'SUCCESS', message: 'รายการนี้รับเอกสารคืนแล้ว ไม่บันทึกซ้ำ · รอ Gate Out: ' + record.autoId};
    }

    return {type: 'NONE', level: 'WARN', message: workflow.nextStepText || 'สถานะนี้ยังไม่พร้อมบันทึกขั้นตอนถัดไป'};
  }

  async function loadWorkflowDashboard(silent, options) {
    const config = options && typeof options === 'object' ? options : {};

    if (!state.moduleId || !API || typeof API.getInboundWorkflowDashboard !== 'function') {
      if (!state.dashboardItems.length) {
        restoreDashboardCache({silent: true});
      }
      renderDashboard();
      return;
    }

    if (config.cacheFirst !== false && !state.dashboardItems.length) {
      restoreDashboardCache({silent: true});
    }

    const requestToken = ++state.dashboardRequestToken;

    try {
      if (!silent) {
        setScanMessage('กำลังโหลดตารางสถานะจากฐานข้อมูล', 'BUSY');
      }

      const data = await API.getInboundWorkflowDashboard(state.moduleId, {
        limit: Number(DASHBOARD_LIMIT) || 100,
        cacheBust: Date.now()
      });

      if (requestToken !== state.dashboardRequestToken) {
        return;
      }

      const nextItems = normalizeDashboardItems(data);
      const hadLocalItems = state.dashboardItems.length > 0;

      if (nextItems.length > 0 || !hadLocalItems) {
        state.dashboardItems = nextItems;
        state.dashboardLoadedAt = formatBangkokDateTime(new Date());
        saveDashboardCache();
        renderDashboard();

        if (!silent) {
          setScanMessage('โหลดข้อมูลล่าสุดแล้ว ' + nextItems.length + ' รายการ', 'SUCCESS');
        }
      } else {
        /*
         * ถ้า Backend ตอบกลับว่าง แต่หน้าจอยังมี cache/local state อยู่
         * ห้ามล้างตารางทันที เพราะจะทำให้ผู้ใช้เข้าใจว่าข้อมูลหายหลัง Refresh
         * กรณีนี้ให้คงข้อมูลเดิมไว้ แล้วแจ้งเตือนแบบไม่รบกวน
         */
        renderDashboard();
        if (!silent) {
          setScanMessage('ไม่พบรายการใหม่จากฐานข้อมูล แต่คงข้อมูลล่าสุดบนหน้าจอไว้', 'WARN');
        }
      }
    } catch (error) {
      console.warn('workflow dashboard failed', error);

      if (!state.dashboardItems.length) {
        restoreDashboardCache({silent: true});
      }

      renderDashboard();

      if (!silent) {
        setScanMessage('โหลดตารางไม่สำเร็จ แต่ยังคงข้อมูลล่าสุดไว้: ' + errorMessage(error), 'WARN');
      }
    } finally {
      focusCodeInput(false);
    }
  }

  function restoreDashboardCache(options) {
    const config = options && typeof options === 'object' ? options : {};

    try {
      const key = dashboardCacheKey();
      if (!key) {
        return false;
      }

      const raw = window.localStorage.getItem(key);
      if (!raw) {
        if (config.replace === true) {
          state.dashboardItems = [];
          renderDashboard();
        }
        return false;
      }

      const cached = JSON.parse(raw);
      const items = Array.isArray(cached.items) ? cached.items : [];

      state.dashboardItems = items
        .map(normalizeDashboardItem)
        .filter((item) => item.autoId)
        .slice(0, DASHBOARD_CACHE_MAX_ITEMS)
        .sort((a, b) => dateToMs(b.updatedAt) - dateToMs(a.updatedAt));

      state.dashboardLoadedAt = String(cached.savedAt || '');
      state.dashboardCacheRestored = true;
      resetWorkflowPage();
      renderDashboard();

      if (!config.silent && state.dashboardItems.length) {
        setScanMessage('แสดงข้อมูลล่าสุดจากเครื่องก่อน แล้วกำลังตรวจฐานข้อมูลจริง', 'WARN');
      }

      return state.dashboardItems.length > 0;
    } catch (error) {
      console.warn('restore inbound dashboard cache failed', error);
      return false;
    }
  }

  function saveDashboardCache() {
    try {
      const key = dashboardCacheKey();
      if (!key) {
        return;
      }

      const items = state.dashboardItems
        .slice()
        .sort((a, b) => dateToMs(b.updatedAt) - dateToMs(a.updatedAt))
        .slice(0, DASHBOARD_CACHE_MAX_ITEMS);

      window.localStorage.setItem(
        key,
        JSON.stringify({
          version: 10,
          moduleId: state.moduleId,
          savedAt: formatBangkokDateTime(new Date()),
          items
        })
      );
    } catch (error) {
      console.warn('save inbound dashboard cache failed', error);
    }
  }

  function dashboardCacheKey() {
    const moduleId = String(state.moduleId || '').trim();
    if (!moduleId) {
      return '';
    }

    return DASHBOARD_CACHE_PREFIX + moduleId;
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
      driverName: composeDriverName(source, record),
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
    const firstName = text(rawRecord.firstName || rawRecord.name || rawRecord.driverFirstName || rawRecord['ชื่อ']);
    const lastName = text(rawRecord.lastName || rawRecord.surname || rawRecord.driverLastName || rawRecord['สกุล'] || rawRecord['นามสกุล']);
    const prefix = text(rawRecord.prefix || rawRecord.title || rawRecord['คำนำหน้า'] || rawRecord['คำนำหน้า ']);
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
        driverName: composeDriverName(rawRecord, null, [prefix, firstName, lastName].filter(Boolean).join(' '))
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

    refreshAutoPageSize();

    const filtered = getFilteredDashboardItems();
    state.filteredTotal = filtered.length;

    const pageSize = getWorkflowPageSize();
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

    if (state.tablePage > totalPages) state.tablePage = totalPages;
    if (state.tablePage < 1) state.tablePage = 1;

    const startIndex = (state.tablePage - 1) * pageSize;
    const pageItems = filtered.slice(startIndex, startIndex + pageSize);

    if (!pageItems.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="table-empty">ยังไม่มีข้อมูลตามเงื่อนไข</td></tr>';
      renderWorkflowPagination(0, 0, 0, 1, 1);
      return;
    }

    tbody.innerHTML = pageItems.map((item) => {
      const sla = calculateSlaState(item);
      return `
      <tr data-auto-id="${escapeHtml(item.autoId)}" data-sla="${escapeHtml(sla.level)}">
        <td><span class="workflow-cell-main">${escapeHtml(item.appointmentNumber || '-')}</span></td>
        <td><span class="workflow-cell-main">${escapeHtml(item.companyName || '-')}</span></td>
        <td><span class="workflow-cell-main">${escapeHtml(item.driverName || '-')}</span></td>
        <td><span class="workflow-cell-main">${escapeHtml(formatPlateWithProvince(item))}</span></td>
        <td><span class="workflow-cell-main">${escapeHtml(item.phone || '-')}</span></td>
        <td>
          <div class="sla-cell">
            <span class="status-pill" data-status="${escapeHtml(item.statusCode)}" data-sla="${escapeHtml(sla.level)}">
              ${escapeHtml(item.statusName || statusName(item.statusCode))}
            </span>
            ${sla.enabled ? `<span class="sla-mini-progress" data-sla="${escapeHtml(sla.level)}" title="${escapeHtml(sla.label + ' · ' + sla.elapsedText)}"><i style="width:${escapeHtml(String(sla.percent || 0))}%"></i></span>` : ''}
          </div>
        </td>
        <td><span class="workflow-cell-main">${escapeHtml(displayLatestTime(item) || '-')}</span></td>
        <td class="workflow-auto-id"><strong>${escapeHtml(item.autoId || '-')}</strong></td>
        <td><button type="button" class="icon-button" data-open-detail title="ดูรายละเอียด">ดู</button></td>
      </tr>`;
    }).join('');

    renderWorkflowPagination(
      startIndex + 1,
      startIndex + pageItems.length,
      filtered.length,
      state.tablePage,
      totalPages
    );
  }

  function getFilteredDashboardItems() {
    const query = state.dashboardQuery;

    return state.dashboardItems.filter((item) => {
      const statusOk =
        state.statusFilter === 'ALL' ||
        item.statusCode === state.statusFilter ||
        (state.statusFilter === 'CANCELLED' && item.cancelled);

      if (!statusOk) return false;
      if (!query) return true;

      return [
        item.autoId,
        item.appointmentNumber,
        item.companyName,
        item.driverName,
        item.registration,
        item.province,
        item.phone,
        item.statusName
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }

  function getWorkflowPageSize() {
    if (state.tablePageSize !== 'AUTO') {
      return clampInteger(state.tablePageSize, 5, 200, 20);
    }

    return clampInteger(state.computedPageSize, 8, 80, 20);
  }

  function getWorkflowTotalPages() {
    const pageSize = getWorkflowPageSize();
    const total = Number(state.filteredTotal) || getFilteredDashboardItems().length;
    return Math.max(1, Math.ceil(total / pageSize));
  }

  function refreshAutoPageSize() {
    if (state.tablePageSize !== 'AUTO') return;

    const wrap = byId('workflowTableWrap') || document.querySelector('.workflow-table-wrap');
    if (!wrap) return;

    const height = Math.max(0, Math.floor(wrap.getBoundingClientRect().height));
    if (!height) return;

    /*
     * หักความสูงหัวตารางออก แล้วคำนวณจากความสูงแถวจริงโดยประมาณ
     * เพื่อให้ตารางใช้พื้นที่เต็ม แต่ไม่วาดรายการเกินจอมากเกินไป
     */
    const headerHeight = 40;
    const rowHeight = window.innerWidth >= 861 ? 48 : 58;
    const nextSize = Math.floor((height - headerHeight) / rowHeight);

    state.computedPageSize = clampInteger(nextSize, 8, 80, 20);
  }

  function renderWorkflowPagination(from, to, total, page, totalPages) {
    const summary = byId('workflowTablePageSummary');
    const indicator = byId('workflowPageIndicator');
    const prev = byId('workflowPrevPage');
    const next = byId('workflowNextPage');

    if (summary) {
      if (!total) {
        summary.textContent = 'ไม่พบข้อมูลตามเงื่อนไข';
      } else {
        const sizeText = state.tablePageSize === 'AUTO'
          ? 'อัตโนมัติ ' + getWorkflowPageSize() + ' แถว/หน้า'
          : getWorkflowPageSize() + ' แถว/หน้า';

        summary.textContent = 'แสดง ' + from + '–' + to + ' จาก ' + total + ' รายการ · ' + sizeText;
      }
    }

    if (indicator) indicator.textContent = 'หน้า ' + page + ' / ' + totalPages;
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= totalPages;
  }

  function resetWorkflowPage() {
    state.tablePage = 1;
  }

  function upsertDashboardItemFromLookup(lookup) {
    const item = dashboardItemFromLookup(lookup);
    if (!item.autoId) return;
    resetWorkflowPage();
    state.dashboardItems = [item]
      .concat(state.dashboardItems.filter((entry) => entry.autoId !== item.autoId))
      .sort((a, b) => dateToMs(b.updatedAt) - dateToMs(a.updatedAt));
    saveDashboardCache();
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
        <strong>${escapeHtml(record.appointmentNumber || '-')} · ${escapeHtml(record.companyName || '-')}</strong>
        <span>${escapeHtml(record.driverName || '-')} · ${escapeHtml(formatPlate(record))}${record.province ? ' · ' + escapeHtml(record.province) : ''} · ${escapeHtml(record.phone || '-')}</span>
        <small>Auto ID: ${escapeHtml(record.autoId || '-')}</small>
      </div>
      <div class="result-grid">
        ${fieldHtml('เลขนัดหมาย', record.appointmentNumber || '-')}
        ${fieldHtml('ชื่อบริษัท', record.companyName || '-')}
        ${fieldHtml('ชื่อ พขร.', record.driverName || '-')}
        ${fieldHtml('ทะเบียน / จังหวัด', formatPlate(record) + (record.province ? ' · ' + record.province : ''))}
        ${fieldHtml('เบอร์โทร', record.phone || '-')}
        ${fieldHtml('Auto ID', record.autoId || '-')}
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

  async function openRecordDetailAlert(item) {
    if (!item) return;
    pauseScanFocus(24000);

    const html = buildRecordDetailHtml(item);

    if (!window.Swal || typeof window.Swal.fire !== 'function') {
      // fallback กรณี SweetAlert2 ยังไม่โหลด
      window.alert([
        'รายละเอียดรายการ',
        'เลขนัดหมาย: ' + (item.appointmentNumber || '-'),
        'บริษัท: ' + (item.companyName || '-'),
        'พขร.: ' + (item.driverName || '-'),
        'ทะเบียน: ' + (formatPlate(item) || '-') + (item.province ? ' ' + item.province : ''),
        'โทร: ' + (item.phone || '-'),
        'Auto ID: ' + (item.autoId || '-')
      ].join('\n'));
      return;
    }

    const canCancel = canCancelCurrentInboundStage(item);

    const result = await window.Swal.fire({
      title: '',
      html,
      icon: undefined,
      width: 'min(760px, calc(100vw - 24px))',
      padding: 0,
      heightAuto: false,
      showCloseButton: false,
      showDenyButton: canCancel,
      confirmButtonText: 'ปิด',
      denyButtonText: 'ยกเลิกสถานะล่าสุด',
      reverseButtons: true,
      customClass: {
        popup: 'inbound-detail-popup',
        actions: 'inbound-detail-actions',
        denyButton: 'inbound-detail-cancel-button'
      },
      didOpen: () => {
        pauseScanFocus(24000);
      },
      willClose: () => {
        window.setTimeout(() => {
          keepCameraStandby();
          focusCodeInput(false);
        }, 80);
      }
    });

    if (result && result.isDenied) {
      await openCancelCurrentStageDialog(item);
    }
  }

  function canCancelCurrentInboundStage(item) {
    if (!item || item.cancelled) return false;
    const status = String(item.statusCode || '').toUpperCase();

    /*
     * ให้ Inbound ยกเลิกเฉพาะสถานะที่ Inbound เป็นผู้บันทึก
     * - DOCUMENT_SUBMITTED: ยกเลิกการยื่นเอกสาร กลับไปรอยื่นเอกสาร
     * - DOCUMENT_RETURNED: ยกเลิกการรับเอกสารคืน กลับไปรอรับเอกสารคืน
     * ไม่ให้ Inbound ยกเลิก RECEIVING_COMPLETED เพราะเป็นงานของ User/Admin
     */
    return status === 'DOCUMENT_SUBMITTED' || status === 'DOCUMENT_RETURNED';
  }

  async function openCancelCurrentStageDialog(item) {
    if (!window.Swal || !item || !item.autoId) return;

    pauseScanFocus(30000);

    const stageText = item.statusName || statusName(item.statusCode) || 'สถานะล่าสุด';

    const result = await window.Swal.fire({
      title: 'ยกเลิกสถานะล่าสุด',
      html: `
        <div class="inbound-cancel-summary">
          <strong>${escapeHtml(item.appointmentNumber || '-')} · ${escapeHtml(item.companyName || '-')}</strong>
          <span>${escapeHtml(item.driverName || '-')} · ${escapeHtml(formatPlateWithProvince(item) || '-')}</span>
          <small>สถานะที่จะยกเลิก: ${escapeHtml(stageText)}</small>
        </div>
      `,
      input: 'textarea',
      inputLabel: 'เหตุผลการยกเลิก',
      inputPlaceholder: 'เช่น สแกนผิดคัน / คนขับนำ QR ผิด / บันทึกผิดขั้นตอน',
      inputAttributes: {
        maxlength: '300',
        autocapitalize: 'off',
        autocomplete: 'off'
      },
      showCancelButton: true,
      confirmButtonText: 'ยืนยันยกเลิก',
      cancelButtonText: 'กลับ',
      reverseButtons: true,
      customClass: {
        popup: 'inbound-cancel-popup'
      },
      preConfirm: (value) => {
        const reason = String(value || '').trim();
        if (reason.length < 5) {
          window.Swal.showValidationMessage('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร');
          return false;
        }
        return reason;
      }
    });

    if (!result || !result.isConfirmed) {
      focusCodeInput(false);
      return;
    }

    const reason = String(result.value || '').trim();

    try {
      if (!API || typeof API.cancelInboundWorkflow !== 'function') {
        throw createClientError(
          'CANCEL_API_NOT_READY',
          'ยังไม่พบ API สำหรับยกเลิกสถานะ กรุณาวางไฟล์ api.js และ InboundWorkflowCancelService.gs จากชุดนี้'
        );
      }

      setScanMessage('กำลังยกเลิกสถานะล่าสุด: ' + item.autoId, 'BUSY');

      const response = await API.cancelInboundWorkflow(state.moduleId, {
        entryCode: item.autoId,
        autoId: item.autoId,
        reason,
        statusCode: item.statusCode,
        cancelScope: 'CURRENT_INBOUND_STAGE'
      });

      const updated = normalizeLookup(response, item);
      state.currentLookup = updated;
      renderLookupResult(updated);
      upsertDashboardItemFromLookup(updated);
      renderDashboard();
      beep('success');
      setScanMessage('ยกเลิกสถานะล่าสุดแล้ว: ' + item.autoId, 'SUCCESS');
      await loadWorkflowDashboard(true);

      await window.Swal.fire({
        icon: 'success',
        title: 'ยกเลิกเรียบร้อย',
        text: 'ระบบบันทึกเหตุผลและปรับสถานะรายการแล้ว',
        confirmButtonText: 'รับทราบ'
      });
    } catch (error) {
      beep('error');
      setScanMessage(errorMessage(error), 'ERROR');
      await showAlert('ยกเลิกไม่สำเร็จ', errorMessage(error), 'error');
    } finally {
      keepCameraStandby();
      focusCodeInput(false);
    }
  }

  function buildRecordDetailHtml(item) {
    const plate = formatPlate(item) + (item.province ? ' · ' + item.province : '');
    const statusText = item.statusName || statusName(item.statusCode);

    return `
      <article class="inbound-detail-modal">
        <header class="inbound-detail-modal__header">
          <div>
            <small>INBOUND WORKFLOW DETAIL</small>
            <h2>${escapeHtml(item.appointmentNumber || '-')} · ${escapeHtml(item.companyName || '-')}</h2>
            <p>${escapeHtml(item.driverName || '-')} · ${escapeHtml(plate || '-')}</p>
          </div>
          <span class="inbound-detail-modal__status">${escapeHtml(statusText || '-')}</span>
        </header>

        <section class="inbound-detail-modal__primary">
          ${detailBox('เลขนัดหมาย', item.appointmentNumber)}
          ${detailBox('ชื่อบริษัท', item.companyName)}
          ${detailBox('ชื่อ พขร.', item.driverName)}
          ${detailBox('ทะเบียน / จังหวัด', plate)}
        </section>

        <section class="inbound-detail-modal__body">
          ${detailBox('เบอร์โทร', item.phone)}
          ${detailBox('Auto ID', item.autoId)}
          ${detailBox('ประเภทรถ', item.vehicleType)}
          ${detailBox('เวลาเข้า Gate In', item.gateInAt)}
          ${detailBox('ยื่นเอกสาร Inbound', item.documentSubmittedAt)}
          ${detailBox('รับสินค้าเสร็จ', item.receivingCompletedAt)}
          ${detailBox('รับเอกสารคืน', item.documentReturnedAt)}
          ${detailBox('Gate Out', item.gateOutAt)}
          ${detailBox('ขั้นตอนถัดไป', item.nextStepText)}
          ${detailBox('อัปเดตล่าสุด', item.updatedAt)}
          ${item.cancelled ? detailBox('เหตุผลยกเลิก', item.cancelReason) : ''}
        </section>
      </article>
    `;
  }

  function detailBox(label, value) {
    return `
      <div class="detail-box">
        <span>${escapeHtml(label || '')}</span>
        <strong>${escapeHtml(value || '-')}</strong>
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
      focusCodeInput(false);
    }, 20);
  }

  function clearInput() {
    clearScannerKeyBuffer();
    const input = byId('entryCodeInput');
    if (input) input.value = '';
  }

  function getEntryCode() {
    return normalizeCode(byId('entryCodeInput')?.value || '');
  }


  function bindHardwareScannerCapture() {
    if (state.hardwareScannerBound) return;
    state.hardwareScannerBound = true;

    /*
     * Round 06 Part 03:
     * ใช้ scanner buffer คู่ขนานกับ input เพื่อรองรับกล่องสแกนหลายรุ่น
     * - ถ้า focus อยู่ในช่อง Auto ID: ไม่ preventDefault ตัวอักษร แต่เก็บ buffer ไว้ด้วย
     * - ถ้า focus หลุดไปพื้นที่ว่าง: preventDefault แล้วเขียนลงช่อง Auto ID
     * - Enter/Tab จะ finalize รหัสทันที
     */
    document.addEventListener('keydown', (event) => {
      if (!isScannerKeyCandidate(event)) return;

      const input = byId('entryCodeInput');
      if (!input || input.disabled) return;
      if (isScannerBlockedTarget(document.activeElement, input)) return;

      unlockAudio();

      const key = String(event.key || '');
      const active = document.activeElement;
      const isInputFocused = active === input;
      const isTerminator = key === 'Enter' || key === 'Tab';

      if (isTerminator) {
        event.preventDefault();
        event.stopPropagation();

        const code = normalizeCode(
          chooseBetterScanCode(
            state.scannerKeyBuffer,
            input.value
          )
        );

        clearScannerKeyBuffer();

        if (code) {
          setEntryCodeInput(code, {focus: true});
          void processCode(code, {
            source: key === 'Tab'
              ? 'SCANNER_BUFFER_TAB'
              : 'SCANNER_BUFFER_ENTER',
            rawText: code
          });
        }

        return;
      }

      if (key.length === 1) {
        rememberScannerKey(key);

        if (!isInputFocused) {
          event.preventDefault();
          event.stopPropagation();
          setEntryCodeInput(state.scannerKeyBuffer, {focus: true});
        }

        window.clearTimeout(state.scannerKeyTimer);
        state.scannerKeyTimer = window.setTimeout(() => {
          const code = normalizeCode(
            chooseBetterScanCode(
              state.scannerKeyBuffer,
              input.value
            )
          );

          if (looksLikeCompleteCode(code)) {
            clearScannerKeyBuffer();
            setEntryCodeInput(code, {focus: true});
            void processCode(code, {
              source: 'SCANNER_BUFFER_IDLE',
              rawText: code
            });
          }
        }, INPUT_DEBOUNCE_MS);
      }
    }, true);

    document.addEventListener('paste', (event) => {
      const input = byId('entryCodeInput');
      if (!input || input.disabled) return;
      if (isScannerBlockedTarget(document.activeElement, input)) return;

      const text = String(
        event.clipboardData &&
        event.clipboardData.getData('text') ||
        ''
      ).trim();

      if (!text) return;

      const code = normalizeCode(text);
      if (!looksLikeCompleteCode(code)) return;

      event.preventDefault();
      event.stopPropagation();

      clearScannerKeyBuffer();
      setEntryCodeInput(code, {focus: true});
      void processCode(code, {
        source: 'SCANNER_BUFFER_PASTE',
        rawText: code
      });
    }, true);
  }

  function isScannerKeyCandidate(event) {
    if (!event || event.ctrlKey || event.altKey || event.metaKey) return false;
    if (event.isComposing) return false;

    const key = String(event.key || '');
    return key === 'Enter' || key === 'Tab' || key.length === 1;
  }

  function isScannerBlockedTarget(active, input) {
    if (!active) return false;
    if (active === input) return false;

    const tag = String(active.tagName || '').toUpperCase();
    if (active.closest && active.closest('.swal2-container')) return true;
    if (active.id === 'workflowSearchInput') return true;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;

    /*
     * อย่าแย่งข้อมูลจาก input อื่น แต่ถ้าเป็นปุ่ม/พื้นที่ว่างให้ scanner ใช้งานได้
     */
    if (tag === 'INPUT') return true;

    return false;
  }

  function rememberScannerKey(key) {
    const now = Date.now();

    /*
     * ถ้าห่างเกิน 800ms ให้ถือว่าเป็นการเริ่มยิงรหัสใหม่
     */
    if (now - state.scannerLastKeyAt > 800) {
      state.scannerKeyBuffer = '';
    }

    state.scannerLastKeyAt = now;
    state.scannerKeyBuffer += String(key || '');
  }

  function clearScannerKeyBuffer() {
    state.scannerKeyBuffer = '';
    state.hardwareScanBuffer = '';
    state.keyboardCaptureActive = false;
    window.clearTimeout(state.scannerKeyTimer);
    window.clearTimeout(state.hardwareScanTimer);
  }

  function chooseBetterScanCode(bufferValue, inputValue) {
    const buffer = normalizeCode(bufferValue || '');
    const input = normalizeCode(inputValue || '');

    if (buffer.length > input.length) return buffer;
    if (input.length > buffer.length) return input;
    return input || buffer;
  }

  function handlePointerIntent(event) {
    const target = event.target;
    if (!target) return;

    if (
      target.closest('.scanner-card') ||
      target.closest('#manualLookupForm') ||
      target.closest('#startCameraButton') ||
      target.closest('#stopCameraButton') ||
      target.closest('.swal2-container')
    ) {
      return;
    }

    pauseScanFocus();
  }

  function pauseScanFocus(durationMs) {
    state.suppressFocusUntil = Date.now() + (Number(durationMs) || FOCUS_SUPPRESS_MS);
  }

  function shouldFocusCodeInput(force) {
    if (force === true) return true;
    if (Date.now() < state.suppressFocusUntil) return false;

    const active = document.activeElement;
    if (!active) return true;
    if (active.id === 'workflowSearchInput') return false;
    if (active.tagName === 'SELECT') return false;
    if (active.closest && active.closest('.inbound-right')) return false;
    return true;
  }

  function focusCodeInput(force) {
    if (!shouldFocusCodeInput(force)) return;
    const input = byId('entryCodeInput');
    if (!input || input.disabled) return;

    try { input.focus({preventScroll: true}); } catch (error) { input.focus(); }

    /*
     * ห้าม select() อัตโนมัติ
     * เพราะกล่องสแกนยิงรหัสเร็วมาก ถ้า select แทรกกลางจังหวะจะทำให้ข้อมูลหายหรือไม่เข้า
     */
    try {
      const cursor = String(input.value || '').length;
      input.setSelectionRange(cursor, cursor);
    } catch (error) {}
  }

  function looksLikeCompleteCode(code) {
    const value = normalizeCode(code);
    if (value.length < MIN_CODE_LENGTH) return false;

    /*
     * Round 06 Part 02:
     * QR/Barcode จากหน้างานอาจเป็นได้ทั้ง Auto ID รูปแบบ SK...
     * หรือรหัสสั้น/เลขนัดหมายจาก Gate In
     * ห้ามล็อกไว้ที่ความยาว 12 ตัวอักษร เพราะจะทำให้กล่องสแกนบางชุดดูเหมือนไม่ทำงาน
     */
    if (/^SK\d{6,20}$/i.test(value)) return true;
    if (/^\d{6,20}$/.test(value)) return true;

    return /^[A-Z0-9_-]{6,40}$/i.test(value);
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
    const slaSummary = {
      normal: 0,
      warning: 0,
      critical: 0
    };

    list.forEach((item) => {
      const sla = calculateSlaState(item);
      if (!sla.enabled) return;
      if (sla.level === 'CRITICAL') slaSummary.critical += 1;
      else if (sla.level === 'WARNING') slaSummary.warning += 1;
      else slaSummary.normal += 1;
    });

    state.slaSummary = slaSummary;

    return {
      total: list.length,
      waitingReceiving: list.filter((item) => item.statusCode === 'DOCUMENT_SUBMITTED').length,
      receivingCompleted: list.filter((item) => item.statusCode === 'RECEIVING_COMPLETED').length,
      documentReturned: list.filter((item) => item.statusCode === 'DOCUMENT_RETURNED').length,
      cancelled: list.filter((item) => item.cancelled || item.statusCode === 'CANCELLED').length
    };
  }

  function calculateSlaState(item) {
    const statusCode = String(item && item.statusCode || '').trim().toUpperCase();
    const rules = CONFIG.INBOUND_SLA_RULES || {};
    const rule = rules[statusCode];

    if (!rule || item.cancelled) {
      return {
        enabled: false,
        level: 'NONE',
        label: '',
        elapsedMinutes: 0,
        elapsedText: '',
        percent: 0
      };
    }

    const baseTime =
      statusCode === 'DOCUMENT_SUBMITTED'
        ? item.documentSubmittedAt || item.updatedAt || item.gateInAt
        : statusCode === 'RECEIVING_COMPLETED'
          ? item.receivingCompletedAt || item.updatedAt
          : statusCode === 'DOCUMENT_RETURNED'
            ? item.documentReturnedAt || item.updatedAt
            : item.updatedAt;

    const startedAt = dateToMs(baseTime);
    if (!startedAt) {
      return {
        enabled: true,
        level: 'NORMAL',
        label: rule.label || 'อยู่ในขั้นตอน',
        elapsedMinutes: 0,
        elapsedText: '-',
        percent: 0
      };
    }

    const elapsedMinutes =
      Math.max(
        0,
        Math.floor((Date.now() - startedAt) / 60000)
      );

    const warningMinutes =
      Number(rule.warningMinutes) || 0;

    const criticalMinutes =
      Number(rule.criticalMinutes) || 0;

    let level = 'NORMAL';

    if (criticalMinutes && elapsedMinutes >= criticalMinutes) {
      level = 'CRITICAL';
    } else if (warningMinutes && elapsedMinutes >= warningMinutes) {
      level = 'WARNING';
    }

    const basePercent =
      criticalMinutes
        ? Math.min(100, Math.round((elapsedMinutes / criticalMinutes) * 100))
        : warningMinutes
          ? Math.min(100, Math.round((elapsedMinutes / warningMinutes) * 100))
          : 0;

    return {
      enabled: true,
      level,
      label:
        level === 'CRITICAL'
          ? 'เกินเวลา'
          : level === 'WARNING'
            ? 'ใกล้เกินเวลา'
            : rule.label || 'ปกติ',
      elapsedMinutes,
      elapsedText:
        elapsedMinutes >= 60
          ? Math.floor(elapsedMinutes / 60) + ' ชม. ' + (elapsedMinutes % 60) + ' นาที'
          : elapsedMinutes + ' นาที',
      percent:
        Math.max(4, basePercent)
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

  function formatPlateWithProvince(item) {
    const plate = formatPlate(item);
    const province = text(item && item.province);
    return [plate && plate !== '-' ? plate : '', province].filter(Boolean).join(' · ') || '-';
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
    try { window.localStorage.removeItem('alertvendor_access_token'); } catch (error) {}
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


  function clampInteger(value, minimum, maximum, fallback) {
    const number = Math.floor(Number(value));
    if (!Number.isFinite(number)) return fallback;
    return Math.min(Math.max(number, minimum), maximum);
  }

  function debounce(fn, delay) {
    let timer = 0;
    return function (...args) {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn.apply(this, args), Number(delay) || 120);
    };
  }

  function byId(id) { return document.getElementById(id); }
  function setText(id, value) { const el = byId(id); if (el) el.textContent = String(value ?? ''); }

  function composeDriverName(primary, secondary, fallback) {
    const first = primary && typeof primary === 'object' ? primary : {};
    const second = secondary && typeof secondary === 'object' ? secondary : {};

    const direct = text(
      first.driverName ||
      first.personName ||
      first.fullName ||
      first['ชื่อ พขร.'] ||
      first['ชื่อผู้ขับ'] ||
      first['ชื่อคนขับ'] ||
      second.driverName ||
      second.personName ||
      second.fullName ||
      second['ชื่อ พขร.'] ||
      second['ชื่อผู้ขับ'] ||
      second['ชื่อคนขับ']
    );

    if (direct) {
      return direct;
    }

    const prefix = text(
      first.prefix ||
      first.title ||
      first['คำนำหน้า'] ||
      first['คำนำหน้า '] ||
      second.prefix ||
      second.title ||
      second['คำนำหน้า'] ||
      second['คำนำหน้า ']
    );

    const firstName = text(
      first.firstName ||
      first.name ||
      first.driverFirstName ||
      first['ชื่อ'] ||
      second.firstName ||
      second.name ||
      second.driverFirstName ||
      second['ชื่อ']
    );

    const lastName = text(
      first.lastName ||
      first.surname ||
      first.driverLastName ||
      first['สกุล'] ||
      first['นามสกุล'] ||
      second.lastName ||
      second.surname ||
      second.driverLastName ||
      second['สกุล'] ||
      second['นามสกุล']
    );

    return text(
      [prefix, firstName, lastName].filter(Boolean).join(' ') ||
      fallback ||
      ''
    );
  }

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
