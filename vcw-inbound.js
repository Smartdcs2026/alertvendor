/*
 * vcw-inbound.js
 * VCW-R08 Inbound Workflow Page
 */
(function (window, document) {
  'use strict';

  const app = {
    version: 'VCW-R08',
    busy: false,
    user: null,
    latest: null,
    lastLookupMethod: 'MANUAL',
    geo: null,
    scanner: null,
    scannerRunning: false,
    lastScanAt: 0
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
    updateButtons();
  }

  function bindEvents() {
    $('lookupButton').addEventListener('click', function () {
      lookupEntry('MANUAL');
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
        lookupEntry('MANUAL');
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

  async function lookupEntry(method) {
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

  async function runAction(actionName) {
    const entryCode = getEntryCode();
    if (!entryCode) {
      toast('กรุณาค้นหารายการก่อนบันทึก', 'error');
      return;
    }

    const actionLabel = getActionLabel(actionName);
    if (!window.confirm('ยืนยัน ' + actionLabel + ' สำหรับ Auto ID: ' + entryCode + ' ?')) {
      return;
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
    } finally {
      setBusy(false);
    }
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
            lookupEntry('QR');
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
