/************************************************************
 * inbound.js
 * ROUND 05 — Inbound Scanner + Submit/Return Document
 ************************************************************/
(function (window, document) {
  'use strict';

  const CONFIG = window.APP_CONFIG || {};
  const API = window.VehicleAPI;

  const state = {
    clockTimer: null,
    scanner: null,
    session: null,
    modules: [],
    moduleId: '',
    currentLookup: null,
    loading: false,
    recent: [],
    recentQuery: ''
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
      renderRecent();

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
    byId('inboundRefreshButton')?.addEventListener('click', () => reloadCurrentLookup());
    byId('submitDocumentButton')?.addEventListener('click', submitDocument);
    byId('returnDocumentButton')?.addEventListener('click', returnDocument);
    byId('clearResultButton')?.addEventListener('click', clearResult);

    byId('manualLookupForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const code = getEntryCode();
      if (!code) {
        showToast('warning', 'กรุณากรอก Auto ID');
        focusCodeInput();
        return;
      }
      void lookupCode(code, 'MANUAL');
    });

    byId('inboundModuleSelect')?.addEventListener('change', (event) => {
      state.moduleId = String(event.target.value || '').trim();
      clearResult();
      renderRecent();
    });

    byId('recentSearchInput')?.addEventListener('input', (event) => {
      state.recentQuery = String(event.target.value || '').trim().toLowerCase();
      renderRecent();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        stopCamera();
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
      scanIntervalMs: 220,
      cooldownMs: 1800,
      onScan(rawText) {
        const code = normalizeEntryCode(rawText);

        if (!code) {
          return;
        }

        setInputValue('entryCodeInput', code);
        void lookupCode(code, 'SCAN', rawText);
      },
      onStatus(code, message) {
        setScannerStatus(message, code === 'CAMERA_READY' ? 'READY' : 'IDLE');
      },
      onError(error) {
        console.warn('Scanner detect error', error);
      }
    });

    if (!state.scanner.isSupported()) {
      setScannerStatus('เครื่องนี้ให้กรอกรหัสเอง', 'ERROR');
    }
  }

  async function startCamera() {
    if (!state.scanner) {
      createScanner();
    }

    if (!state.scanner) {
      await showSystemError('เปิดกล้องไม่ได้', 'ไม่พบระบบสแกน กรุณากรอกรหัสเอง');
      return;
    }

    try {
      await state.scanner.start();
      setScannerStatus('กล้องพร้อมสแกน', 'READY');
    } catch (error) {
      setScannerStatus('ใช้ช่องกรอกรหัสแทน', 'ERROR');
      await Swal.fire({
        icon: 'warning',
        title: 'เปิดกล้องไม่ได้',
        text: errorMessage(error),
        confirmButtonText: 'กรอกรหัสเอง',
        customClass: {
          popup: 'inbound-swal-popup'
        }
      });
      focusCodeInput();
    }
  }

  function stopCamera() {
    if (state.scanner) {
      state.scanner.stop();
    }
  }

  async function lookupCode(code, method, rawText) {
    const cleanCode = normalizeEntryCode(code);

    if (!cleanCode) {
      showToast('warning', 'ไม่พบรหัสสำหรับค้นหา');
      return;
    }

    if (!state.moduleId) {
      showToast('warning', 'กรุณาเลือก Module ก่อน');
      return;
    }

    if (state.loading) {
      return;
    }

    state.loading = true;
    setScannerStatus('กำลังตรวจสอบรหัส', 'IDLE');
    setLookupBusy(true);

    try {
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
      addRecent('LOOKUP', state.currentLookup);

      if (method === 'SCAN') {
        showToast('success', 'ตรวจพบรหัส ' + cleanCode);
      }

    } catch (error) {
      state.currentLookup = null;
      renderLookupError(cleanCode, error);
      await showWorkflowError('ตรวจสอบรหัสไม่สำเร็จ', error);
    } finally {
      state.loading = false;
      setLookupBusy(false);
      setScannerStatus('พร้อมสแกนรายการถัดไป', state.scanner && state.scanner.running ? 'READY' : 'IDLE');
    }
  }

  async function submitDocument() {
    const lookup = state.currentLookup;

    if (!lookup || !lookup.record || !lookup.record.autoId) {
      showToast('warning', 'กรุณาตรวจสอบรหัสก่อนบันทึก');
      return;
    }

    if (!canSubmitDocument(lookup)) {
      await Swal.fire({
        icon: 'warning',
        title: 'ยังบันทึกยื่นเอกสารไม่ได้',
        text: explainCannotSubmit(lookup),
        confirmButtonText: 'รับทราบ',
        customClass: {
          popup: 'inbound-swal-popup'
        }
      });
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
      addRecent('SUBMIT_DOCUMENT', state.currentLookup);

      await Swal.fire({
        icon: 'success',
        title: 'บันทึกยื่นเอกสารแล้ว',
        text: lookup.record.autoId,
        timer: 1300,
        showConfirmButton: false,
        customClass: {
          popup: 'inbound-swal-popup'
        }
      });

      clearCodeInput();
      focusCodeInput();

    } catch (error) {
      await showWorkflowError('บันทึกยื่นเอกสารไม่สำเร็จ', error);
    } finally {
      state.loading = false;
      setLookupBusy(false);
    }
  }


  async function returnDocument() {
    const lookup = state.currentLookup;

    if (!lookup || !lookup.record || !lookup.record.autoId) {
      showToast('warning', 'กรุณาตรวจสอบรหัสก่อนบันทึก');
      return;
    }

    if (!canReturnDocument(lookup)) {
      await Swal.fire({
        icon: 'warning',
        title: 'ยังรับเอกสารคืนไม่ได้',
        text: explainCannotReturn(lookup),
        confirmButtonText: 'รับทราบ',
        customClass: {
          popup: 'inbound-swal-popup'
        }
      });
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
          note: 'บันทึกรับเอกสารคืนจากหน้า Inbound'
        }
      );

      state.currentLookup = normalizeLookupResult(result);
      renderLookupResult(state.currentLookup);
      addRecent('RETURN_DOCUMENT', state.currentLookup);

      await Swal.fire({
        icon: 'success',
        title: 'บันทึกรับเอกสารคืนแล้ว',
        text: lookup.record.autoId,
        timer: 1300,
        showConfirmButton: false,
        customClass: {
          popup: 'inbound-swal-popup'
        }
      });

      clearCodeInput();
      focusCodeInput();

    } catch (error) {
      await showWorkflowError('บันทึกรับเอกสารคืนไม่สำเร็จ', error);
    } finally {
      state.loading = false;
      setLookupBusy(false);
    }
  }

  function renderLookupResult(lookup) {
    const panel = byId('lookupResultPanel');
    const body = byId('resultBody');
    const submitButton = byId('submitDocumentButton');
    const returnButton = byId('returnDocumentButton');

    if (!panel || !body) return;

    const record = lookup.record || {};
    const currentState = lookup.state || {};

    panel.hidden = false;
    setText('resultTitle', record.autoId ? 'พบข้อมูลรถ/ตู้' : 'ผลการตรวจสอบ');
    setText('resultStatusBadge', currentState.statusName || currentState.nextStepText || '-');

    body.innerHTML = `
      <div class="result-identity">
        <strong>${escapeHtml(record.autoId || '-')}</strong>
        <span>${escapeHtml(record.companyName || '-')} · ${escapeHtml(record.registration || '-')}</span>
      </div>

      <div class="result-grid">
        ${resultField('เวลาเข้า', record.timestampIn || '-')}
        ${resultField('เลขนัดหมาย', record.appointmentNumber || '-')}
        ${resultField('ชื่อผู้ขับ', record.personName || '-')}
        ${resultField('ประเภทรถ', record.vehicleType || '-')}
        ${resultField('จังหวัด', record.province || '-')}
        ${resultField('สถานะ', currentState.statusName || '-')}
        ${resultField('ยื่นเอกสาร', currentState.documentSubmittedAt || '-')}
        ${resultField('รับสินค้าเสร็จ', currentState.receivingCompletedAt || '-')}
        ${resultField('รับเอกสารคืน', currentState.documentReturnedAt || '-')}
        ${resultField('ขั้นตอนถัดไป', currentState.nextStepText || '-')}
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
        ? 'บันทึกรับเอกสารคืน'
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
      : getEntryCode();

    if (code) {
      void lookupCode(code, 'MANUAL');
    } else {
      void loadModules();
    }
  }

  function normalizeLookupResult(result) {
    const data = result && result.data && typeof result.data === 'object'
      ? result.data
      : result || {};

    const record = data.record || data.vehicle || {};
    const currentState = data.state || data.workflowState || {};

    return {
      raw: data,
      module: data.module || {},
      record: {
        autoId: String(record.autoId || record.entryCode || record.recordId || '').trim(),
        timestampIn: String(record.timestampIn || record.gateInAt || '').trim(),
        timestampOut: String(record.timestampOut || record.gateOutAt || '').trim(),
        duration: String(record.duration || '').trim(),
        personName: String(record.personName || record.driverName || '').trim(),
        appointmentNumber: String(record.appointmentNumber || record.appointment || '').trim(),
        companyName: String(record.companyName || record.company || '').trim(),
        phone: String(record.phone || '').trim(),
        registration: String(record.registration || record.plate || record.vehicleRegistration || '').trim(),
        province: String(record.province || '').trim(),
        vehicleType: String(record.vehicleType || '').trim(),
        sourceRowNumber: record.sourceRowNumber || ''
      },
      state: {
        statusCode: String(currentState.statusCode || currentState.currentStatus || '').trim(),
        statusName: String(currentState.statusName || currentState.currentStatusName || '').trim(),
        nextStepText: String(currentState.nextStepText || currentState.nextActionText || '').trim(),
        gateInAt: String(currentState.gateInAt || '').trim(),
        documentSubmittedAt: String(currentState.documentSubmittedAt || '').trim(),
        receivingCompletedAt: String(currentState.receivingCompletedAt || '').trim(),
        documentReturnedAt: String(currentState.documentReturnedAt || '').trim(),
        gateOutAt: String(currentState.gateOutAt || '').trim(),
        cancelled: currentState.cancelled === true,
        cancelReason: String(currentState.cancelReason || '').trim(),
        durations: currentState.durations || {}
      },
      nextAction: data.nextAction || {},
      message: String(data.message || '').trim()
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

    return !status || status === 'GATE_IN_ONLY';
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

    return status === 'RECEIVING_COMPLETED';
  }

  function explainCannotSubmit(lookup) {
    const record = lookup && lookup.record ? lookup.record : {};
    const currentState = lookup && lookup.state ? lookup.state : {};

    if (record.timestampOut || currentState.gateOutAt) {
      return 'รายการนี้มีเวลาออก Gate Out แล้ว ไม่สามารถยื่นเอกสารได้';
    }

    if (currentState.cancelled) {
      return 'รายการนี้ถูกยกเลิกแล้ว: ' + (currentState.cancelReason || '-');
    }

    if (currentState.documentSubmittedAt) {
      return 'รายการนี้ยื่นเอกสารแล้วเมื่อ ' + currentState.documentSubmittedAt;
    }

    return currentState.nextStepText || 'สถานะปัจจุบันไม่พร้อมสำหรับการยื่นเอกสาร';
  }


  function explainCannotReturn(lookup) {
    const record = lookup && lookup.record ? lookup.record : {};
    const currentState = lookup && lookup.state ? lookup.state : {};

    if (record.timestampOut || currentState.gateOutAt) {
      return 'รายการนี้มีเวลาออก Gate Out แล้ว ไม่สามารถรับเอกสารคืนได้';
    }

    if (currentState.cancelled) {
      return 'รายการนี้ถูกยกเลิกแล้ว: ' + (currentState.cancelReason || '-');
    }

    if (!currentState.documentSubmittedAt) {
      return 'รายการนี้ยังไม่ได้ยื่นเอกสาร Inbound';
    }

    if (!currentState.receivingCompletedAt) {
      return 'ต้องให้ User/Admin กดรับสินค้าเสร็จก่อน จึงจะรับเอกสารคืนได้';
    }

    if (currentState.documentReturnedAt) {
      return 'รายการนี้รับเอกสารคืนแล้วเมื่อ ' + currentState.documentReturnedAt;
    }

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

  function addRecent(type, lookup) {
    const record = lookup && lookup.record ? lookup.record : {};
    const currentState = lookup && lookup.state ? lookup.state : {};

    if (!record.autoId) return;

    const item = {
      type,
      autoId: record.autoId,
      companyName: record.companyName || '',
      registration: record.registration || '',
      appointmentNumber: record.appointmentNumber || '',
      statusName: currentState.statusName || '',
      createdAt: formatBangkokDateTime(new Date())
    };

    state.recent = [item]
      .concat(
        state.recent.filter((existing) => existing.autoId !== item.autoId || existing.type !== item.type)
      )
      .slice(0, 10);

    renderRecent();
  }

  function renderRecent() {
    const list = byId('recentList');
    const count = byId('recentCount');

    if (!list) return;

    const query = state.recentQuery;
    const items = state.recent.filter((item) => {
      if (!query) return true;
      return [
        item.autoId,
        item.companyName,
        item.registration,
        item.appointmentNumber,
        item.statusName
      ].join(' ').toLowerCase().includes(query);
    });

    if (count) {
      count.textContent = items.length + ' รายการ';
    }

    if (!items.length) {
      list.innerHTML = '<div class="empty-state">ยังไม่มีรายการที่ตรงเงื่อนไข</div>';
      return;
    }

    list.innerHTML = items.map((item) => `
      <article class="recent-item">
        <div class="recent-item__top">
          <strong>${escapeHtml(item.autoId)}</strong>
          <em>${escapeHtml(recentTypeLabel(item.type))}</em>
        </div>
        <span>${escapeHtml(item.companyName || '-')} · ${escapeHtml(item.registration || '-')}</span>
        <span>${escapeHtml(item.createdAt)} · ${escapeHtml(item.statusName || '-')}</span>
      </article>
    `).join('');
  }


  function recentTypeLabel(type) {
    const value = String(type || '').toUpperCase();

    if (value === 'SUBMIT_DOCUMENT') return 'ยื่นเอกสาร';
    if (value === 'RETURN_DOCUMENT') return 'รับเอกสารคืน';

    return 'ตรวจสอบ';
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
    ['submitDocumentButton', 'returnDocumentButton', 'clearResultButton', 'startCameraButton', 'inboundRefreshButton']
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

  function showToast(icon, title) {
    if (!window.Swal) return;
    Swal.fire({
      toast: true,
      position: 'top',
      icon,
      title,
      timer: 1400,
      showConfirmButton: false
    });
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
  }
})(window, document);
