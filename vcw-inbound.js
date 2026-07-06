/*
 * vcw-inbound.js
 * VCW-R08C Inbound Workflow Page - Auto Save 3 Seconds
 */
(function (window, document) {
  'use strict';

  const app = {
    version: 'VCW-R08C',
    busy: false,
    user: null,
    latest: null,
    lastLookupMethod: 'MANUAL',
    geo: null,
    scanner: null,
    scannerRunning: false,
    lastScanAt: 0,
    autoSavePending: false,
    lastAutoEntryCode: '',
    lastAutoSavedAt: 0
  };

  const steps = [
    {
      no: 1,
      title: 'ยื่นเอกสาร Inbound',
      stateKey: 'เวลายื่นเอกสาร',
      stageAfter: 'RECEIVING_PENDING',
      actionCode: 'SUBMIT_DOCUMENT'
    },
    {
      no: 2,
      title: 'รับสินค้าเสร็จ',
      stateKey: 'เวลารับสินค้าเสร็จ',
      stageAfter: 'DOC_RETURN_PENDING',
      actionCode: 'COMPLETE_RECEIVING'
    },
    {
      no: 3,
      title: 'รับเอกสารคืน',
      stateKey: 'เวลารับเอกสารคืน',
      stageAfter: 'GATE_OUT_PENDING',
      actionCode: 'RETURN_DOCUMENT'
    },
    {
      no: 4,
      title: 'Gate Out / ปิดงาน',
      stateKey: 'เวลา Gate Out',
      stageAfter: 'COMPLETED',
      actionCode: 'SYNC_GATE_OUT'
    }
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function init() {
    bindEvents();
    renderEmptyTimeline();
    checkSession();
    updateAutoSaveStatus();
    updateButtons();
  }

  function bindEvents() {
    $('lookupButton').addEventListener('click', function () {
      lookupEntry('MANUAL', {
        autoSave: isAutoSaveEnabled()
      });
    });

    $('stateButton').addEventListener('click', function () {
      loadState();
    });

    $('refreshButton').addEventListener('click', function () {
      if (getEntryCode()) loadState();
    });

    $('startScanButton').addEventListener('click', startScanner);
    $('stopScanButton').addEventListener('click', stopScanner);
    $('geoButton').addEventListener('click', captureGeo);
    $('clearLogButton').addEventListener('click', function () {
      $('logOutput').textContent = 'ล้าง Log แล้ว';
    });

    if ($('autoSaveToggle')) {
      $('autoSaveToggle').addEventListener('change', updateAutoSaveStatus);
    }

    if ($('autoSaveDelayInput')) {
      $('autoSaveDelayInput').addEventListener('change', function () {
        $('autoSaveDelayInput').value = String(getAutoSaveDelaySeconds());
        updateAutoSaveStatus();
      });
    }

    $('submitDocumentButton').addEventListener('click', function () {
      runAction('submit-document');
    });

    $('completeReceivingButton').addEventListener('click', function () {
      runAction('complete-receiving');
    });

    $('returnDocumentButton').addEventListener('click', function () {
      runAction('return-document');
    });

    $('cancelEventButton').addEventListener('click', cancelEvent);

    $('entryInput').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        lookupEntry('MANUAL', {
          autoSave: isAutoSaveEnabled()
        });
      }
    });
  }

  async function checkSession() {
    if (!window.VCWWorkflowAPI) {
      setSession(false, 'ไม่พบ vcw-workflow-api.js', 'กรุณาอัปโหลดไฟล์ vcw-workflow-api.js จาก R07B ก่อน');
      return;
    }

    $('apiVersionBadge').textContent = window.VCWWorkflowAPI.version || app.version;
    log('กำลังตรวจสอบ /api/auth/me ...');

    const response = await window.VCWWorkflowAPI.me(getApiBase());
    logResponse('AUTH ME', response);

    if (!response.success) {
      setSession(false, 'ยังไม่ได้ Login', response.message || 'กรุณา Login ในระบบก่อนใช้งาน');
      updateButtons();
      return;
    }

    const user = normalizeUser(response.data);
    app.user = user;

    setSession(
      true,
      user.displayName || user.username || 'ผู้ใช้งาน',
      'Role: ' + (user.role || 'USER') + ' | Username: ' + (user.username || '-')
    );

    updateButtons();
  }

  function normalizeUser(data) {
    const source = data && data.user ? data.user : data || {};
    return {
      username: String(source.username || '').trim(),
      displayName: String(source.displayName || source.name || '').trim(),
      role: String(source.role || 'USER').trim().toUpperCase(),
      mustChangePassword: Boolean(source.mustChangePassword)
    };
  }

  function setSession(ok, title, detail) {
    $('sessionTitle').textContent = title;
    $('sessionDetail').textContent = detail;
    $('sessionBadge').textContent = ok ? 'READY' : 'LOGIN REQUIRED';
    $('sessionBadge').className = 'badge ' + (ok ? 'badge-ok' : 'badge-danger');
  }

  function getApiBase() {
    return String($('apiBaseInput').value || '').trim();
  }

  function getModuleId() {
    return String($('moduleInput').value || 'vendors').trim() || 'vendors';
  }

  function getEntryCode() {
    return String($('entryInput').value || '').trim();
  }

  async function lookupEntry(method, options) {
    options = options || {};
    const entryCode = getEntryCode();
    if (!entryCode) {
      toast('กรุณาระบุ Auto ID หรือสแกน QR ก่อน', 'error');
      $('entryInput').focus();
      return;
    }

    setBusy(true);
    app.lastLookupMethod = method || 'MANUAL';

    try {
      const response = await window.VCWWorkflowAPI.lookup(getModuleId(), entryCode, getApiBase());
      logResponse('LOOKUP', response);

      if (!response.success) {
        toast(response.message || 'ค้นหาไม่สำเร็จ', 'error');
        return;
      }

      app.latest = unwrapWorkflowData(response.data);
      renderWorkflow(app.latest);
      toast('ค้นหาข้อมูลสำเร็จ', 'success');

      if (options.autoSave !== false && isAutoSaveEnabled()) {
        await scheduleAutoSaveAfterLookup(method || 'MANUAL');
      }
    } finally {
      setBusy(false);
    }
  }

  async function loadState() {
    const entryCode = getEntryCode();
    if (!entryCode) {
      toast('กรุณาระบุ Auto ID ก่อน', 'error');
      return;
    }

    setBusy(true);
    try {
      const response = await window.VCWWorkflowAPI.state(getModuleId(), entryCode, getApiBase());
      logResponse('STATE', response);

      if (!response.success) {
        toast(response.message || 'ตรวจสถานะไม่สำเร็จ', 'error');
        return;
      }

      const statePayload = unwrapWorkflowData(response.data);
      app.latest = mergeLatestState(app.latest, statePayload);
      renderWorkflow(app.latest);
      toast('ตรวจสถานะสำเร็จ', 'success');
    } finally {
      setBusy(false);
    }
  }

  async function runAction(actionName, options) {
    options = options || {};
    const entryCode = getEntryCode();
    if (!entryCode) {
      toast('กรุณาค้นหารายการก่อนบันทึก', 'error');
      return;
    }

    const actionLabel = getActionLabel(actionName);
    if (!options.skipConfirm) {
      if (!window.confirm('ยืนยัน ' + actionLabel + ' สำหรับ Auto ID: ' + entryCode + ' ?')) {
        return;
      }
    }

    const payload = createStagePayload(actionName, entryCode);

    setBusy(true);
    try {
      let response;
      if (actionName === 'submit-document') {
        response = await window.VCWWorkflowAPI.submitDocument(getModuleId(), payload, getApiBase());
      } else if (actionName === 'complete-receiving') {
        response = await window.VCWWorkflowAPI.completeReceiving(getModuleId(), payload, getApiBase());
      } else if (actionName === 'return-document') {
        response = await window.VCWWorkflowAPI.returnDocument(getModuleId(), payload, getApiBase());
      }

      logResponse(actionName.toUpperCase(), response);

      if (!response || !response.success) {
        toast(response && response.message ? response.message : 'บันทึกไม่สำเร็จ', 'error');
        return;
      }

      const result = unwrapWorkflowData(response.data);
      if (result && result.state) {
        app.latest = mergeLatestState(app.latest, { state: result.state });
        renderWorkflow(app.latest);
      }

      toast(actionLabel + ' สำเร็จ', 'success');

      if (options.autoSave) {
        await showAutoSuccess(actionLabel, entryCode);
        prepareNextScan('บันทึกสำเร็จ พร้อมรับคันถัดไป');
      }
    } finally {
      setBusy(false);
    }
  }


  function isAutoSaveEnabled() {
    const toggle = $('autoSaveToggle');
    return toggle ? Boolean(toggle.checked) : true;
  }

  function getAutoSaveDelaySeconds() {
    const input = $('autoSaveDelayInput');
    const raw = input ? Number(input.value || 3) : 3;
    if (!Number.isFinite(raw)) return 3;
    return Math.max(1, Math.min(10, Math.floor(raw)));
  }

  function updateAutoSaveStatus() {
    const el = $('autoSaveStatus');
    const box = $('autoSaveBox');

    if (!el) return;

    if (isAutoSaveEnabled()) {
      const seconds = getAutoSaveDelaySeconds();
      el.textContent =
        'เปิดอยู่: สแกน QR หรือกด Enter หลังกรอกรหัส ระบบจะยืนยัน ' +
        seconds +
        ' วินาที แล้วบันทึกอัตโนมัติ';
      if (box) box.classList.remove('auto-off');
    } else {
      el.textContent =
        'ปิดอยู่: ระบบจะค้นหาข้อมูลเท่านั้น ต้องกดปุ่มบันทึกเอง';
      if (box) box.classList.add('auto-off');
    }
  }

  async function scheduleAutoSaveAfterLookup(method) {
    if (app.autoSavePending) {
      toast('มีรายการกำลังรอยืนยันอยู่ กรุณารอสักครู่', 'error');
      return;
    }

    const entryCode = getEntryCode();

    if (!entryCode || !app.latest) {
      return;
    }

    const decision = getNextInboundAutoAction(app.latest);

    if (!decision.actionName) {
      await showAutoNoAction(decision, entryCode);
      prepareNextScan(decision.message || 'พร้อมรับคันถัดไป');
      return;
    }

    const now = Date.now();
    if (
      app.lastAutoEntryCode === entryCode &&
      now - app.lastAutoSavedAt < 5000
    ) {
      toast('รายการนี้เพิ่งบันทึกไปแล้ว ระบบป้องกันการยิงซ้ำ', 'error');
      prepareNextScan('ป้องกันการบันทึกซ้ำ พร้อมรับคันถัดไป');
      return;
    }

    const confirmed = await showAutoConfirm(decision, entryCode, method);

    if (!confirmed) {
      toast('ยกเลิกการบันทึกอัตโนมัติ', 'error');
      return;
    }

    app.autoSavePending = true;

    try {
      await runAction(decision.actionName, {
        skipConfirm: true,
        autoSave: true
      });

      app.lastAutoEntryCode = entryCode;
      app.lastAutoSavedAt = Date.now();

    } finally {
      app.autoSavePending = false;
    }
  }

  function getNextInboundAutoAction(data) {
    const role = app.user ? String(app.user.role || '').toUpperCase() : '';
    const state = data && data.state ? data.state : {};
    const gateIn = data && data.gateIn ? data.gateIn : {};

    if (!hasRole(role, ['ADMIN', 'INBOUND'])) {
      return {
        actionName: '',
        title: 'ไม่มีสิทธิ์บันทึกฝั่ง Inbound',
        message: 'หน้านี้อนุญาตเฉพาะ ADMIN หรือ INBOUND เท่านั้น'
      };
    }

    if (isClosed(state)) {
      return {
        actionName: '',
        title: 'รายการนี้ปิดงานแล้ว',
        message: 'รายการนี้ปิดงานแล้ว ไม่ต้องบันทึกซ้ำ'
      };
    }

    const submitted = Boolean(String(state['เวลายื่นเอกสาร'] || '').trim());
    const completed = Boolean(String(state['เวลารับสินค้าเสร็จ'] || '').trim());
    const returned = Boolean(String(state['เวลารับเอกสารคืน'] || '').trim());

    if (!submitted) {
      return {
        actionName: 'submit-document',
        actionLabel: 'บันทึกยื่นเอกสาร',
        title: 'ตรวจพบข้อมูลรถ',
        message: 'กำลังบันทึก “ยื่นเอกสาร” อัตโนมัติ',
        nextStage: 'ยื่นเอกสาร Inbound',
        gateIn: gateIn,
        state: state
      };
    }

    if (submitted && !completed) {
      return {
        actionName: '',
        title: 'ยังรอรับสินค้าเสร็จ',
        message: 'รายการนี้ยื่นเอกสารแล้ว แต่ยังไม่มีเวลารับสินค้าเสร็จ จึงยังรับเอกสารคืนไม่ได้',
        gateIn: gateIn,
        state: state
      };
    }

    if (completed && !returned) {
      return {
        actionName: 'return-document',
        actionLabel: 'บันทึกรับเอกสารคืน',
        title: 'ตรวจพบข้อมูลรถ',
        message: 'กำลังบันทึก “รับเอกสารคืน” อัตโนมัติ',
        nextStage: 'รับเอกสารคืน',
        gateIn: gateIn,
        state: state
      };
    }

    return {
      actionName: '',
      title: 'รายการนี้รับเอกสารคืนแล้ว',
      message: 'รายการนี้บันทึกรับเอกสารคืนแล้ว รอ Gate Out / ปิดงาน',
      gateIn: gateIn,
      state: state
    };
  }

  async function showAutoConfirm(decision, entryCode, method) {
    const seconds = getAutoSaveDelaySeconds();
    const html = createAutoConfirmHtml(decision, entryCode, method, seconds);

    if (window.Swal) {
      const result = await window.Swal.fire({
        title: decision.title || 'ตรวจพบข้อมูล',
        html: html,
        icon: 'info',
        timer: seconds * 1000,
        timerProgressBar: true,
        showCancelButton: true,
        showConfirmButton: true,
        confirmButtonText: 'บันทึกทันที',
        cancelButtonText: 'ยกเลิก',
        allowOutsideClick: false,
        allowEscapeKey: false,
        reverseButtons: true,
        customClass: {
          popup: 'vcw-swal-popup'
        }
      });

      if (result.dismiss === window.Swal.DismissReason.cancel) {
        return false;
      }

      return result.isConfirmed || result.dismiss === window.Swal.DismissReason.timer;
    }

    toast(
      (decision.message || 'กำลังบันทึกอัตโนมัติ') +
      ' ใน ' +
      seconds +
      ' วินาที',
      'success'
    );

    await delay(seconds * 1000);
    return true;
  }

  function createAutoConfirmHtml(decision, entryCode, method, seconds) {
    const gateIn = decision.gateIn || {};
    const state = decision.state || {};

    const rows = [
      ['Auto ID', entryCode],
      ['วิธีอ่านข้อมูล', method === 'QR' ? 'สแกน QR' : 'กรอก/ยิงรหัสด้วยมือ'],
      ['ขั้นตอนที่จะบันทึก', decision.actionLabel || decision.nextStage || '-'],
      ['เลขนัดหมาย', pick(gateIn, ['เลขนัดหมาย']) || state['เลขนัดหมาย'] || '-'],
      ['ทะเบียนรถ', pick(gateIn, ['ทะเบียนรถ']) || state['ทะเบียนรถ'] || '-'],
      ['ชื่อบริษัท', pick(gateIn, ['ชื่อบริษัท']) || state['ชื่อบริษัท'] || '-']
    ];

    return '' +
      '<div style="text-align:left">' +
        '<p style="margin:0 0 10px;color:#475569;font-weight:700">' +
          escapeHtml(decision.message || '') +
          ' ใน <b>' + escapeHtml(seconds) + '</b> วินาที' +
        '</p>' +
        '<div style="display:grid;gap:8px;margin-top:10px">' +
          rows.map(function (row) {
            return '<div style="display:grid;grid-template-columns:115px 1fr;gap:8px;border:1px solid #e2e8f0;border-radius:12px;padding:8px 10px;background:#f8fafc">' +
              '<span style="color:#64748b;font-size:12px;font-weight:800">' + escapeHtml(row[0]) + '</span>' +
              '<strong style="color:#0f172a;word-break:break-word">' + escapeHtml(row[1]) + '</strong>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<p style="margin:12px 0 0;color:#b45309;font-size:13px;font-weight:800">' +
          'ถ้าสแกนผิดคัน ให้กด “ยกเลิก” ก่อนครบเวลา' +
        '</p>' +
      '</div>';
  }

  async function showAutoNoAction(decision, entryCode) {
    if (window.Swal) {
      await window.Swal.fire({
        title: decision.title || 'ยังไม่ต้องบันทึก',
        text: decision.message || 'ยังไม่มีขั้นตอนที่ต้องบันทึกอัตโนมัติ',
        icon: 'warning',
        timer: 2800,
        timerProgressBar: true,
        showConfirmButton: false
      });
    } else {
      toast(decision.message || 'ยังไม่มีขั้นตอนที่ต้องบันทึก', 'error');
      await delay(1800);
    }

    logResponse('AUTO SAVE SKIPPED', {
      success: false,
      entryCode: entryCode,
      reason: decision.message || ''
    });
  }

  async function showAutoSuccess(actionLabel, entryCode) {
    if (window.Swal) {
      await window.Swal.fire({
        title: 'บันทึกสำเร็จ',
        text: actionLabel + ' | Auto ID: ' + entryCode,
        icon: 'success',
        timer: 1300,
        timerProgressBar: true,
        showConfirmButton: false
      });
    }
  }

  function prepareNextScan(message) {
    $('entryInput').value = '';

    if ($('noteInput')) {
      $('noteInput').value = '';
    }

    app.latest = null;
    app.lastLookupMethod = 'MANUAL';

    $('recordTitle').textContent = 'พร้อมสแกนคันถัดไป';
    $('workflowStageBadge').textContent = 'READY';
    $('workflowStageBadge').className = 'badge badge-ok';
    $('vehicleSummary').classList.add('empty');
    $('vehicleSummary').innerHTML =
      '<p>' +
      escapeHtml(message || 'พร้อมรับ QR / Auto ID คันถัดไป') +
      '</p>';

    renderEmptyTimeline();
    updateButtons();

    window.setTimeout(function () {
      $('entryInput').focus();
    }, 100);
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }


  function createStagePayload(actionName, entryCode) {
    return {
      entryCode: entryCode,
      qrText: entryCode,
      lookupMethod: app.lastLookupMethod || 'MANUAL',
      note: String($('noteInput').value || '').trim(),
      latitude: app.geo ? app.geo.latitude : '',
      longitude: app.geo ? app.geo.longitude : '',
      clientRequestId: createClientRequestId(actionName)
    };
  }

  async function cancelEvent() {
    const entryCode = getEntryCode();
    const reason = String($('cancelReasonInput').value || '').trim();
    const actionCode = String($('cancelActionInput').value || '').trim();

    if (!entryCode) {
      toast('กรุณาระบุ Auto ID ก่อน', 'error');
      return;
    }

    if (!reason) {
      toast('กรุณาระบุเหตุผลการยกเลิก', 'error');
      $('cancelReasonInput').focus();
      return;
    }

    if (!window.confirm('ยืนยันยกเลิก Event ของ Auto ID: ' + entryCode + ' ?')) {
      return;
    }

    setBusy(true);
    try {
      const response = await window.VCWWorkflowAPI.cancelEvent(getModuleId(), {
        entryCode: entryCode,
        qrText: entryCode,
        actionCode: actionCode,
        reason: reason,
        note: 'ยกเลิกจากหน้า inbound.html R08',
        clientRequestId: createClientRequestId('cancel-event')
      }, getApiBase());

      logResponse('CANCEL EVENT', response);

      if (!response.success) {
        toast(response.message || 'ยกเลิกไม่สำเร็จ', 'error');
        return;
      }

      const result = unwrapWorkflowData(response.data);
      if (result && result.state) {
        app.latest = mergeLatestState(app.latest, { state: result.state });
        renderWorkflow(app.latest);
      } else {
        await loadState();
      }

      $('cancelReasonInput').value = '';
      toast('ยกเลิก Event สำเร็จ', 'success');
    } finally {
      setBusy(false);
    }
  }

  function unwrapWorkflowData(data) {
    if (!data) return {};
    if (data.result && typeof data.result === 'object') return data.result;
    return data;
  }

  function mergeLatestState(current, incoming) {
    const base = current && typeof current === 'object' ? current : {};
    const next = incoming && typeof incoming === 'object' ? incoming : {};
    return {
      ...base,
      ...next,
      gateIn: next.gateIn || base.gateIn,
      state: next.state || base.state
    };
  }

  function renderWorkflow(data) {
    const source = data || {};
    const gateIn = source.gateIn || {};
    const state = source.state || {};
    const entryCode = source.entryCode || state['รหัสเข้าพื้นที่'] || gateIn['Auto ID'] || getEntryCode();

    $('recordTitle').textContent = entryCode || 'ไม่พบ Auto ID';
    $('workflowStageBadge').textContent = state['ขั้นตอนปัจจุบัน'] || 'FOUND';
    $('workflowStageBadge').className = 'badge ' + (isClosed(state) ? 'badge-ok' : 'badge-wait');

    $('vehicleSummary').classList.remove('empty');
    $('vehicleSummary').innerHTML = createSummaryHtml(gateIn, state, entryCode);
    renderTimeline(state);
    updateButtons();
  }

  function createSummaryHtml(gateIn, state, entryCode) {
    const items = [
      ['Auto ID', entryCode],
      ['เวลาเข้า Gate In', pick(gateIn, ['Timestamp', 'เวลาเข้า Gate In', 'เวลาเข้า']) || state['เวลาเข้า Gate In'] || '-'],
      ['เลขนัดหมาย', pick(gateIn, ['เลขนัดหมาย']) || state['เลขนัดหมาย'] || '-'],
      ['ทะเบียนรถ', pick(gateIn, ['ทะเบียนรถ']) || state['ทะเบียนรถ'] || '-'],
      ['ชื่อบริษัท', pick(gateIn, ['ชื่อบริษัท']) || state['ชื่อบริษัท'] || '-'],
      ['แถวต้นทาง', pick(gateIn, ['แถวต้นทาง']) || state['แถวต้นทาง'] || '-'],
      ['ขั้นตอนปัจจุบัน', state['ขั้นตอนปัจจุบัน'] || '-'],
      ['อัปเดตล่าสุด', state['อัปเดตล่าสุด'] || '-']
    ];

    return '<div class="summary-grid">' + items.map(function (item) {
      return '<div class="summary-item"><small>' + escapeHtml(item[0]) + '</small><strong>' + escapeHtml(item[1]) + '</strong></div>';
    }).join('') + '</div>';
  }

  function renderEmptyTimeline() {
    $('workflowTimeline').innerHTML = steps.map(function (step) {
      return '<div class="step"><div class="step-dot">' + step.no + '</div><div><div class="step-title">' + escapeHtml(step.title) + '</div><div class="step-time">รอข้อมูล</div></div><span class="badge badge-wait">WAIT</span></div>';
    }).join('');
  }

  function renderTimeline(state) {
    const currentStage = String(state['ขั้นตอนปัจจุบัน'] || '').trim();

    $('workflowTimeline').innerHTML = steps.map(function (step) {
      const time = String(state[step.stateKey] || '').trim();
      const done = Boolean(time);
      const current = !done && currentStage === stageBeforeAction(step.actionCode);
      const classes = ['step'];
      if (done) classes.push('done');
      if (current) classes.push('current');

      return '<div class="' + classes.join(' ') + '">' +
        '<div class="step-dot">' + (done ? '✓' : step.no) + '</div>' +
        '<div><div class="step-title">' + escapeHtml(step.title) + '</div>' +
        '<div class="step-time">' + escapeHtml(time || (current ? 'ขั้นตอนปัจจุบัน' : 'ยังไม่บันทึก')) + '</div></div>' +
        '<span class="badge ' + (done ? 'badge-ok' : current ? 'badge-wait' : '') + '">' + (done ? 'DONE' : current ? 'NOW' : 'WAIT') + '</span>' +
        '</div>';
    }).join('');
  }

  function stageBeforeAction(actionCode) {
    if (actionCode === 'SUBMIT_DOCUMENT') return 'DOC_SUBMIT_PENDING';
    if (actionCode === 'COMPLETE_RECEIVING') return 'RECEIVING_PENDING';
    if (actionCode === 'RETURN_DOCUMENT') return 'DOC_RETURN_PENDING';
    return '';
  }

  function updateButtons() {
    const role = app.user ? app.user.role : '';
    const state = app.latest && app.latest.state ? app.latest.state : {};
    const hasRecord = Boolean(getEntryCode());
    const closed = isClosed(state);

    const submitted = Boolean(String(state['เวลายื่นเอกสาร'] || '').trim());
    const completed = Boolean(String(state['เวลารับสินค้าเสร็จ'] || '').trim());
    const returned = Boolean(String(state['เวลารับเอกสารคืน'] || '').trim());

    setButtonEnabled('submitDocumentButton', hasRecord && !closed && !submitted && hasRole(role, ['ADMIN', 'INBOUND']));
    setButtonEnabled('completeReceivingButton', hasRecord && !closed && submitted && !completed && hasRole(role, ['ADMIN', 'USER']));
    setButtonEnabled('returnDocumentButton', hasRecord && !closed && completed && !returned && hasRole(role, ['ADMIN', 'INBOUND']));
    setButtonEnabled('cancelEventButton', hasRecord && !closed && hasRole(role, ['ADMIN', 'INBOUND']));
  }

  function setButtonEnabled(id, enabled) {
    const el = $(id);
    if (el) el.disabled = app.busy || !enabled;
  }

  function hasRole(role, allowed) {
    return allowed.indexOf(String(role || '').toUpperCase()) !== -1;
  }

  function isClosed(state) {
    const closed = String(state['ปิดงานแล้ว'] || '').trim();
    const stage = String(state['ขั้นตอนปัจจุบัน'] || '').trim();
    return closed === 'ใช่' || closed.toLowerCase() === 'true' || stage === 'COMPLETED';
  }

  async function startScanner() {
    if (!window.Html5Qrcode) {
      toast('ยังโหลดไลบรารีสแกน QR ไม่สำเร็จ ให้ใช้ช่องกรอก Auto ID ก่อน', 'error');
      return;
    }

    if (app.scannerRunning) return;

    try {
      app.scanner = app.scanner || new window.Html5Qrcode('qrReader');
      await app.scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: function (viewfinderWidth, viewfinderHeight) {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const size = Math.max(180, Math.floor(minEdge * 0.72));
            return { width: size, height: size };
          }
        },
        function (decodedText) {
          const now = Date.now();
          if (now - app.lastScanAt < 1500) return;
          app.lastScanAt = now;

          const code = cleanQrText(decodedText);
          if (!code) return;

          $('entryInput').value = code;
          toast('อ่าน QR สำเร็จ: ' + code, 'success');
          stopScanner().finally(function () {
            lookupEntry('QR', {
              autoSave: isAutoSaveEnabled()
            });
          });
        }
      );

      app.scannerRunning = true;
      $('scanHint').textContent = 'กำลังเปิดกล้องสแกน QR';
    } catch (error) {
      toast('เปิดกล้องไม่สำเร็จ: ' + (error && error.message ? error.message : error), 'error');
    }
  }

  async function stopScanner() {
    if (!app.scanner || !app.scannerRunning) return;

    try {
      await app.scanner.stop();
    } catch (error) {
      // ignore
    }

    app.scannerRunning = false;
    $('scanHint').textContent = 'ปิดกล้องแล้ว สามารถเปิดใหม่ได้เมื่อต้องการสแกน';
  }

  function cleanQrText(value) {
    const text = String(value || '').trim();
    if (!text) return '';

    try {
      const url = new URL(text);
      return url.searchParams.get('entryCode') ||
        url.searchParams.get('autoId') ||
        url.searchParams.get('code') ||
        url.searchParams.get('q') ||
        text;
    } catch (error) {
      return text.replace(/^URL:/i, '').trim();
    }
  }

  function captureGeo() {
    if (!navigator.geolocation) {
      toast('อุปกรณ์นี้ไม่รองรับ GPS', 'error');
      return;
    }

    $('geoText').textContent = 'กำลังดึงพิกัด...';

    navigator.geolocation.getCurrentPosition(function (position) {
      app.geo = {
        latitude: Number(position.coords.latitude).toFixed(6),
        longitude: Number(position.coords.longitude).toFixed(6),
        accuracy: Math.round(position.coords.accuracy || 0)
      };

      $('geoText').textContent = app.geo.latitude + ', ' + app.geo.longitude + ' ±' + app.geo.accuracy + 'm';
      toast('ดึงพิกัดสำเร็จ', 'success');
    }, function (error) {
      app.geo = null;
      $('geoText').textContent = 'ดึงพิกัดไม่สำเร็จ';
      toast(error.message || 'ไม่สามารถดึงพิกัดได้', 'error');
    }, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 30000
    });
  }

  function setBusy(busy) {
    app.busy = busy;
    ['lookupButton', 'stateButton', 'refreshButton', 'startScanButton', 'stopScanButton', 'geoButton'].forEach(function (id) {
      const el = $(id);
      if (el) el.disabled = busy;
    });
    updateButtons();
  }

  function createClientRequestId(actionName) {
    return [
      'WEB',
      app.version,
      String(actionName || 'ACTION').toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
      Date.now(),
      Math.random().toString(36).slice(2, 8).toUpperCase()
    ].join('-');
  }

  function getActionLabel(actionName) {
    if (actionName === 'submit-document') return 'บันทึกยื่นเอกสาร';
    if (actionName === 'complete-receiving') return 'บันทึกรับสินค้าเสร็จ';
    if (actionName === 'return-document') return 'บันทึกรับเอกสารคืน';
    return actionName;
  }

  function pick(object, keys) {
    const source = object || {};
    for (let index = 0; index < keys.length; index += 1) {
      const value = source[keys[index]];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return String(value);
      }
    }
    return '';
  }

  function log(message) {
    $('logOutput').textContent = String(message || '');
  }

  function logResponse(title, response) {
    $('logOutput').textContent = title + '\n' + JSON.stringify(response, null, 2);
  }

  function toast(message, type) {
    const old = document.querySelector('.toast');
    if (old) old.remove();

    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = message;
    document.body.appendChild(el);

    window.setTimeout(function () {
      el.remove();
    }, 3600);
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  document.addEventListener('DOMContentLoaded', init);
})(window, document);
