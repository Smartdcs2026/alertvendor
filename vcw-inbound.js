/*
 * vcw-inbound.js
 * VCW-R08G Inbound DateTime Display Fix
 */
(function (window, document) {
  'use strict';

  const app = {
    version: 'VCW-R08G',
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
    lastAutoSavedAt: 0,
    scannerBuffer: '',
    scannerLastKeyAt: 0,
    scannerBufferTimer: null,
    focusLockTimer: null
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
    setupScannerBoxMode();
    renderEmptyTimeline();
    checkSession();
    updateAutoSaveStatus();
    updateScannerFocusStatus();
    updateButtons();

    if (!busy) {
      window.setTimeout(function () {
        focusEntryInput('busy-off');
      }, 120);
    }
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

    if ($('scannerFocusToggle')) {
      $('scannerFocusToggle').addEventListener('change', function () {
        updateScannerFocusStatus();
        focusEntryInput('toggle');
      });
    }

    if ($('focusEntryButton')) {
      $('focusEntryButton').addEventListener('click', function () {
        focusEntryInput('button');
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

        const cleanCode = extractEntryCodeFromScanText($('entryInput').value);
        $('entryInput').value = cleanCode;

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
    return extractEntryCodeFromScanText($('entryInput').value);
  }

  async function lookupEntry(method, options) {
    options = options || {};
    if (app.busy || app.autoSavePending || isSweetAlertOpen()) {
      toast('ระบบกำลังประมวลผลรายการก่อนหน้า กรุณารอสักครู่', 'error');
      return;
    }

    const entryCode = getEntryCode();
    $('entryInput').value = entryCode;

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
        showInlineSaveDone(actionLabel, entryCode);
        prepareNextScan('บันทึกสำเร็จ พร้อมรับคันถัดไป');
      }
    } finally {
      setBusy(false);
    }
  }


  function isAutoSaveEnabled() {
    return true;
  }

  function getAutoSaveDelaySeconds() {
    return 3;
  }

  function updateAutoSaveStatus() {
    const strip = $('inboundStatusStrip');
    if (strip) {
      strip.setAttribute('data-ready', 'true');
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

    app.autoSavePending = true;

    try {
      const confirmed = await showAutoConfirm(decision, entryCode, method);

      if (!confirmed) {
        toast('ยกเลิกการบันทึกอัตโนมัติ', 'error');
        return;
      }

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
        message: 'เตรียมบันทึกยื่นเอกสาร',
        nextStage: 'ยื่นเอกสาร Inbound',
        gateIn: gateIn,
        state: state
      };
    }

    if (submitted && !completed) {
      return {
        actionName: '',
        title: 'ยังรอรับสินค้าเสร็จ',
        message: 'ยื่นเอกสารแล้ว รอรับสินค้าเสร็จ',
        gateIn: gateIn,
        state: state
      };
    }

    if (completed && !returned) {
      return {
        actionName: 'return-document',
        actionLabel: 'บันทึกรับเอกสารคืน',
        title: 'ตรวจพบข้อมูลรถ',
        message: 'เตรียมบันทึกรับเอกสารคืน',
        nextStage: 'รับเอกสารคืน',
        gateIn: gateIn,
        state: state
      };
    }

    return {
      actionName: '',
      title: 'รายการนี้รับเอกสารคืนแล้ว',
      message: 'รับเอกสารคืนแล้ว รอ Gate Out',
      gateIn: gateIn,
      state: state
    };
  }

  async function showAutoConfirm(decision, entryCode, method) {
    const seconds = 3;
    const html = createAutoConfirmHtml(decision, entryCode, method, seconds);

    if (window.Swal) {
      await window.Swal.fire({
        title: decision.actionLabel || 'กำลังบันทึก',
        html: html,
        icon: 'info',
        timer: seconds * 1000,
        timerProgressBar: true,
        showConfirmButton: false,
        showCancelButton: false,
        allowOutsideClick: false,
        allowEscapeKey: false,
        customClass: {
          popup: 'vcw-swal-popup compact-swal'
        },
        didOpen: function () {
          window.Swal.showLoading();
        }
      });

      return true;
    }

    await delay(seconds * 1000);
    return true;
  }

  function createAutoConfirmHtml(decision, entryCode, method, seconds) {
    const gateIn = decision.gateIn || {};
    const state = decision.state || {};

    const rows = [
      ['Auto ID', entryCode],
      ['ทะเบียน', pick(gateIn, ['ทะเบียนรถ']) || state['ทะเบียนรถ'] || '-'],
      ['บริษัท', pick(gateIn, ['ชื่อบริษัท']) || state['ชื่อบริษัท'] || '-'],
      ['ขั้นตอน', decision.actionLabel || decision.nextStage || '-']
    ];

    return '' +
      '<div class="swal-compact-body">' +
        '<p class="swal-countdown-text">กำลังบันทึกใน <b>' + escapeHtml(seconds) + '</b> วินาที</p>' +
        '<div class="swal-compact-grid">' +
          rows.map(function (row) {
            return '<div class="swal-compact-row">' +
              '<span>' + escapeHtml(row[0]) + '</span>' +
              '<strong>' + escapeHtml(row[1]) + '</strong>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>';
  }

  async function showAutoNoAction(decision, entryCode) {
    if (window.Swal) {
      await window.Swal.fire({
        title: decision.title || 'ไม่ต้องบันทึก',
        text: decision.message || 'ไม่มีขั้นตอนที่ต้องบันทึก',
        icon: 'info',
        timer: 1600,
        timerProgressBar: true,
        showConfirmButton: false
      });
    } else {
      toast(decision.message || 'ไม่มีขั้นตอนที่ต้องบันทึก', 'error');
      await delay(1000);
    }

    logResponse('AUTO SAVE SKIPPED', {
      success: false,
      entryCode: entryCode,
      reason: decision.message || ''
    });
  }

  function showInlineSaveDone(actionLabel, entryCode) {
    const strip = $('inboundStatusStrip');

    if (strip) {
      strip.classList.add('save-done');
      strip.innerHTML =
        '<span class="status-dot"></span>' +
        '<strong>บันทึกสำเร็จ</strong>' +
        '<span>' +
        escapeHtml(actionLabel || 'บันทึก') +
        ' | ' +
        escapeHtml(entryCode || '') +
        '</span>';

      window.setTimeout(function () {
        strip.classList.remove('save-done');
        strip.innerHTML =
          '<span class="status-dot"></span>' +
          '<strong>Auto Save</strong>' +
          '<span>พร้อมรับรายการถัดไป</span>';
      }, 900);
    }
  }

  async function showAutoSuccess(actionLabel, entryCode) {
    // VCW-R08G: intentionally no SweetAlert here.
    // บันทึกสำเร็จแล้วให้กลับไปพร้อมรับคันถัดไปทันที
    showInlineSaveDone(actionLabel, entryCode);
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
      focusEntryInput('next-scan');
    }, 100);
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }



  /************************************************************
   * Scanner Box Focus Lock
   * รองรับกล่องอ่าน QR Code แบบ Keyboard Wedge
   ************************************************************/

  function setupScannerBoxMode() {
    document.addEventListener('pointerdown', handleScannerPointerFocus, true);
    document.addEventListener('touchstart', handleScannerPointerFocus, true);
    document.addEventListener('click', handleScannerClickFocus, true);
    document.addEventListener('keydown', handleGlobalScannerKeydown, true);

    $('entryInput').addEventListener('blur', function () {
      if (!isScannerFocusEnabled()) return;
      window.setTimeout(function () {
        if (!shouldKeepCurrentFocus()) {
          focusEntryInput('blur-return');
        }
      }, 180);
    });

    window.addEventListener('focus', function () {
      window.setTimeout(function () {
        focusEntryInput('window-focus');
      }, 120);
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        window.setTimeout(function () {
          focusEntryInput('visibility');
        }, 180);
      }
    });

    app.focusLockTimer = window.setInterval(function () {
      if (
        isScannerFocusEnabled() &&
        !app.busy &&
        !app.autoSavePending &&
        !isSweetAlertOpen() &&
        !shouldKeepCurrentFocus()
      ) {
        focusEntryInput('interval');
      }
    }, 1200);

    window.setTimeout(function () {
      focusEntryInput('initial');
    }, 300);
  }

  function isScannerFocusEnabled() {
    return true;
  }

  function updateScannerFocusStatus() {
    const strip = $('inboundStatusStrip');
    if (strip) {
      strip.setAttribute('data-scanner-ready', 'true');
    }
  }

  function focusEntryInput(reason) {
    if (!isScannerFocusEnabled()) return;
    if (isSweetAlertOpen()) return;

    const input = $('entryInput');
    if (!input || input.disabled) return;

    const active = document.activeElement;

    if (
      active === input ||
      shouldPreserveFocusElement(active)
    ) {
      return;
    }

    try {
      input.focus({
        preventScroll: true
      });
      const length = input.value.length;
      input.setSelectionRange(length, length);
      document.documentElement.setAttribute('data-scanner-focus', 'on');
      document.documentElement.setAttribute('data-scanner-focus-reason', String(reason || ''));
    } catch (error) {
      try {
        input.focus();
      } catch (innerError) {
        // ignore
      }
    }
  }

  function handleScannerPointerFocus(event) {
    if (!isScannerFocusEnabled()) return;
    if (isSweetAlertOpen()) return;

    const target = event.target;

    if (shouldPreserveFocusElement(target)) {
      return;
    }

    if (isInboundSurface(target)) {
      window.setTimeout(function () {
        focusEntryInput('pointer');
      }, 80);
    }
  }

  function handleScannerClickFocus(event) {
    if (!isScannerFocusEnabled()) return;
    if (isSweetAlertOpen()) return;

    const target = event.target;

    if (shouldPreserveFocusElement(target)) {
      return;
    }

    if (isInboundSurface(target)) {
      window.setTimeout(function () {
        focusEntryInput('click');
      }, 120);
    }
  }

  function handleGlobalScannerKeydown(event) {
    if (!isScannerFocusEnabled()) return;
    if (isSweetAlertOpen()) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const active = document.activeElement;

    if (active === $('entryInput')) {
      return;
    }

    if (shouldPreserveFocusElement(active)) {
      return;
    }

    if (app.busy || app.autoSavePending) {
      return;
    }

    if (event.key === 'Enter') {
      if (app.scannerBuffer) {
        event.preventDefault();
        commitScannerBuffer('enter');
      }

      return;
    }

    if (
      event.key &&
      event.key.length === 1
    ) {
      const now = Date.now();

      if (
        !app.scannerLastKeyAt ||
        now - app.scannerLastKeyAt > 160
      ) {
        app.scannerBuffer = '';
      }

      app.scannerLastKeyAt = now;
      app.scannerBuffer += event.key;

      if (app.scannerBuffer.length >= 3) {
        event.preventDefault();
      }

      if (app.scannerBufferTimer) {
        window.clearTimeout(app.scannerBufferTimer);
      }

      app.scannerBufferTimer = window.setTimeout(function () {
        if (app.scannerBuffer.length >= 6) {
          commitScannerBuffer('timer');
        } else {
          app.scannerBuffer = '';
        }
      }, 260);
    }
  }

  function commitScannerBuffer(trigger) {
    const raw = app.scannerBuffer;
    app.scannerBuffer = '';

    if (app.scannerBufferTimer) {
      window.clearTimeout(app.scannerBufferTimer);
      app.scannerBufferTimer = null;
    }

    const code = extractEntryCodeFromScanText(raw);

    if (!code || code.length < 3) {
      return;
    }

    if (app.busy || app.autoSavePending || isSweetAlertOpen()) {
      return;
    }

    $('entryInput').value = code;
    focusEntryInput('scanner-buffer');

    logResponse('SCANNER BOX INPUT', {
      success: true,
      trigger: trigger || '',
      entryCode: code
    });

    lookupEntry('SCANNER_BOX', {
      autoSave: isAutoSaveEnabled()
    });
  }

  function isSweetAlertOpen() {
    return Boolean(
      document.body.classList.contains('swal2-shown') ||
      document.querySelector('.swal2-container')
    );
  }

  function isInboundSurface(target) {
    if (!target || !target.closest) return false;

    return Boolean(
      target.closest('.app-shell') ||
      target.closest('.card') ||
      target.closest('.scanner-card') ||
      target.closest('.result-card') ||
      target.closest('.action-card')
    );
  }

  function shouldKeepCurrentFocus() {
    return shouldPreserveFocusElement(document.activeElement);
  }

  function shouldPreserveFocusElement(element) {
    if (!element || !element.closest) return false;

    if (element === document.body || element === document.documentElement) {
      return false;
    }

    if (element.closest('#entryInput')) {
      return false;
    }

    if (element.closest('.swal2-container')) {
      return true;
    }

    if (
      element.closest('#apiBaseInput') ||
      element.closest('#moduleInput') ||
      element.closest('#autoSaveDelayInput') ||
      element.closest('#noteInput') ||
      element.closest('#cancelReasonInput') ||
      element.closest('#cancelActionInput') ||
      element.closest('#autoSaveToggle') ||
      element.closest('#scannerFocusToggle')
    ) {
      return true;
    }

    const tagName =
      String(
        element.tagName || ''
      ).toUpperCase();

    if (
      tagName === 'TEXTAREA' ||
      tagName === 'SELECT'
    ) {
      return true;
    }

    if (
      tagName === 'INPUT' &&
      element.id !== 'entryInput'
    ) {
      return true;
    }

    if (
      element.isContentEditable
    ) {
      return true;
    }

    return false;
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
    data = normalizeWorkflowDateTimes(data);

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

          const code = extractEntryCodeFromScanText(decodedText);
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
    return extractEntryCodeFromScanText(value);
  }

  function extractEntryCodeFromScanText(value) {
    let text = String(value || '')
      .trim()
      .replace(/[\r\n\t]+/g, '')
      .replace(/^URL:/i, '')
      .trim();

    if (!text) return '';

    try {
      const parsedJson = JSON.parse(text);
      if (parsedJson && typeof parsedJson === 'object') {
        const jsonCode =
          parsedJson.entryCode ||
          parsedJson.autoId ||
          parsedJson.autoID ||
          parsedJson.auto_id ||
          parsedJson.code ||
          parsedJson.id;

        if (jsonCode) {
          return normalizeEntryCodeText(jsonCode);
        }
      }
    } catch (error) {
      // not json
    }

    try {
      const url = new URL(text);
      const urlCode =
        url.searchParams.get('entryCode') ||
        url.searchParams.get('entry_code') ||
        url.searchParams.get('autoId') ||
        url.searchParams.get('autoID') ||
        url.searchParams.get('auto_id') ||
        url.searchParams.get('code') ||
        url.searchParams.get('id') ||
        url.searchParams.get('q');

      if (urlCode) {
        return normalizeEntryCodeText(urlCode);
      }

      const pathParts =
        url.pathname
          .split('/')
          .map(function (part) {
            return normalizeEntryCodeText(part);
          })
          .filter(Boolean);

      if (pathParts.length) {
        return pathParts[pathParts.length - 1];
      }
    } catch (error) {
      // not url
    }

    const keyValueMatch =
      text.match(/(?:entryCode|entry_code|autoId|autoID|auto_id|code|id)\s*[:=]\s*([A-Za-z0-9._-]+)/i);

    if (keyValueMatch) {
      return normalizeEntryCodeText(keyValueMatch[1]);
    }

    const autoIdMatch =
      text.match(/[A-Za-z]{1,8}[0-9][A-Za-z0-9._-]{4,80}/);

    if (autoIdMatch) {
      return normalizeEntryCodeText(autoIdMatch[0]);
    }

    return normalizeEntryCodeText(text);
  }

  function normalizeEntryCodeText(value) {
    return String(value || '')
      .trim()
      .replace(/^[\s"'`]+|[\s"'`]+$/g, '')
      .replace(/[^\p{L}\p{N}._-]/gu, '')
      .slice(0, 120);
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

    if (!busy) {
      window.setTimeout(function () {
        focusEntryInput('busy-off');
      }, 120);
    }
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


  /************************************************************
   * DateTime Display Fix — VCW-R08G
   * แสดงวันที่เวลาเป็น dd/MM/yyyy HH:mm:ss / Asia/Bangkok
   ************************************************************/

  function formatVcwDateTime(value) {
    if (value === undefined || value === null || value === '') {
      return '';
    }

    const raw = String(value).trim();

    if (!raw) {
      return '';
    }

    if (/^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}$/.test(raw)) {
      return raw;
    }

    const localSlashMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (localSlashMatch) {
      return (
        localSlashMatch[1] + '/' +
        localSlashMatch[2] + '/' +
        localSlashMatch[3] + ' ' +
        localSlashMatch[4] + ':' +
        localSlashMatch[5] + ':' +
        (localSlashMatch[6] || '00')
      );
    }

    const parsed = new Date(raw);

    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Bangkok',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).format(parsed).replace(',', '');
    }

    return raw;
  }

  function isLikelyDateTimeLabel(label) {
    const text = String(label || '').toLowerCase();

    return (
      text.indexOf('เวลา') !== -1 ||
      text.indexOf('วันที่') !== -1 ||
      text.indexOf('timestamp') !== -1 ||
      text.indexOf('gate in') !== -1 ||
      text.indexOf('gate out') !== -1 ||
      text.indexOf('updated') !== -1 ||
      text.indexOf('อัปเดต') !== -1
    );
  }

  function normalizeWorkflowDateTimes(data) {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const output = Array.isArray(data) ? data.slice() : Object.assign({}, data);

    Object.keys(output).forEach(function (key) {
      if (isLikelyDateTimeLabel(key)) {
        output[key] = formatVcwDateTime(output[key]);
      }
    });

    ['gateIn', 'state', 'workflowState', 'record'].forEach(function (key) {
      if (output[key] && typeof output[key] === 'object') {
        output[key] = normalizeWorkflowDateTimes(output[key]);
      }
    });

    ['timeline', 'events', 'items', 'records'].forEach(function (key) {
      if (Array.isArray(output[key])) {
        output[key] = output[key].map(function (item) {
          return normalizeWorkflowDateTimes(item);
        });
      }
    });

    return output;
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
