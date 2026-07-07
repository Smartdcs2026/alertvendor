/*
 * vcw-gateout-sync-professional.js
 * VCW-R10B Professional Gate Out Sync UI
 *
 * ใช้ฝังเป็นการ์ดจริงในหน้า Admin/Dashboard
 * ไม่ใช่ Floating Debug Panel
 */
(function (window, document) {
  'use strict';

  const BUILD = 'VCW-R10B';
  const DEFAULT_MODULE = 'vendors';

  const state = {
    user: null,
    moduleId: DEFAULT_MODULE,
    limit: 30,
    busy: false,
    lastPreview: null
  };

  function $(id) {
    return document.getElementById(id);
  }

  function initWhenReady() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      init();
    }
  }

  async function init() {
    if (!shouldRenderOnThisPage()) return;
    if (!window.VCWWorkflowAPI) return;

    try {
      const me = await window.VCWWorkflowAPI.me();
      const user = me && me.success && me.data ? (me.data.user || me.data) : null;
      const role = String(user && user.role || '').toUpperCase();

      if (role !== 'ADMIN') return;

      state.user = user;
      state.moduleId = resolveModuleId();
      renderCard();
      await preview();

    } catch (error) {
      // เงียบไว้ ไม่ให้รบกวนหน้า Production
    }
  }

  function shouldRenderOnThisPage() {
    const path = String(window.location.pathname || '').toLowerCase();
    const href = String(window.location.href || '').toLowerCase();

    return (
      path.includes('admin') ||
      path.includes('dashboard') ||
      href.includes('tab=dashboard') ||
      href.includes('tab=modules') ||
      href.includes('tab=shifts')
    );
  }

  function resolveModuleId() {
    const url = new URL(window.location.href);
    return (
      url.searchParams.get('module') ||
      url.searchParams.get('moduleId') ||
      window.VCW_ACTIVE_MODULE ||
      DEFAULT_MODULE
    );
  }

  function findHost() {
    return (
      document.querySelector('[data-vcw-dashboard]') ||
      document.querySelector('#dashboard') ||
      document.querySelector('#adminDashboard') ||
      document.querySelector('.dashboard-grid') ||
      document.querySelector('.admin-dashboard') ||
      document.querySelector('main') ||
      document.body
    );
  }

  function renderCard() {
    if ($('vcwGateOutSyncCard')) return;

    const host = findHost();
    const section = document.createElement('section');
    section.id = 'vcwGateOutSyncCard';
    section.className = 'vcw-gateout-card';
    section.innerHTML = ''
      + '<div class="vcw-gateout-card__head">'
      + '  <div>'
      + '    <p class="vcw-gateout-eyebrow">Workflow Control</p>'
      + '    <h2>Gate Out Sync</h2>'
      + '  </div>'
      + '  <span class="vcw-gateout-version">' + BUILD + '</span>'
      + '</div>'
      + '<div class="vcw-gateout-toolbar">'
      + '  <label>Module<input id="vcwGateOutModuleId" value="' + escapeHtml(state.moduleId) + '"></label>'
      + '  <label>Limit<input id="vcwGateOutLimitInput" type="number" min="1" max="100" value="30"></label>'
      + '  <button id="vcwGateOutPreviewButton" class="secondary" type="button">Preview</button>'
      + '  <button id="vcwGateOutRunButton" class="primary" type="button">Run Sync</button>'
      + '</div>'
      + '<div class="vcw-gateout-metrics">'
      + metricHtml('scanned', 'ตรวจสอบ', '0')
      + metricHtml('ready', 'พร้อม Sync', '0')
      + metricHtml('synced', 'Sync แล้ว', '0')
      + metricHtml('notReady', 'ยังไม่พร้อม', '0')
      + metricHtml('errors', 'Error', '0')
      + '</div>'
      + '<div class="vcw-gateout-status" id="vcwGateOutStatus">พร้อมใช้งาน</div>'
      + '<div class="vcw-gateout-table-wrap">'
      + '  <table class="vcw-gateout-table">'
      + '    <thead><tr>'
      + '      <th>Auto ID</th>'
      + '      <th>ทะเบียน</th>'
      + '      <th>บริษัท</th>'
      + '      <th>Gate Out</th>'
      + '      <th>Duration</th>'
      + '      <th>สถานะ</th>'
      + '    </tr></thead>'
      + '    <tbody id="vcwGateOutRows"><tr><td colspan="6">กำลังโหลด...</td></tr></tbody>'
      + '  </table>'
      + '</div>';

    if (host === document.body) {
      document.body.insertBefore(section, document.body.firstChild);
    } else {
      host.insertBefore(section, host.firstChild);
    }

    $('vcwGateOutPreviewButton').addEventListener('click', preview);
    $('vcwGateOutRunButton').addEventListener('click', confirmRun);
  }

  function metricHtml(key, label, value) {
    return ''
      + '<div class="vcw-gateout-metric" data-metric="' + key + '">'
      + '  <span>' + escapeHtml(label) + '</span>'
      + '  <strong id="vcwMetric_' + key + '">' + escapeHtml(value) + '</strong>'
      + '</div>';
  }

  async function preview() {
    if (state.busy) return;

    state.moduleId = String($('vcwGateOutModuleId').value || DEFAULT_MODULE).trim() || DEFAULT_MODULE;
    state.limit = normalizeLimit($('vcwGateOutLimitInput').value);

    setBusy(true, 'กำลัง Preview Gate Out...');
    try {
      const result = await window.VCWWorkflowAPI.previewGateOutBatch(state.moduleId, { limit: state.limit });
      if (!result.success) {
        showStatus('Preview ไม่สำเร็จ: ' + result.message, true);
        renderRows([]);
        return;
      }

      const data = unwrapData(result.data);
      state.lastPreview = data;
      updateSummary(data);
      renderRows(data.items || []);
      showStatus('Preview สำเร็จ');

    } finally {
      setBusy(false);
    }
  }

  async function confirmRun() {
    if (state.busy) return;

    const ready = state.lastPreview ? Number(state.lastPreview.ready || 0) : 0;

    if (ready <= 0) {
      showStatus('ยังไม่มีรายการพร้อม Sync', true);
      return;
    }

    const ok = await askRunConfirm(ready);
    if (!ok) return;

    await runSync();
  }

  async function runSync() {
    state.moduleId = String($('vcwGateOutModuleId').value || DEFAULT_MODULE).trim() || DEFAULT_MODULE;
    state.limit = normalizeLimit($('vcwGateOutLimitInput').value);

    setBusy(true, 'กำลัง Run Sync Gate Out...');
    try {
      const result = await window.VCWWorkflowAPI.runGateOutBatch(state.moduleId, { limit: state.limit });
      if (!result.success) {
        showStatus('Run Sync ไม่สำเร็จ: ' + result.message, true);
        return;
      }

      const data = unwrapData(result.data);
      state.lastPreview = data;
      updateSummary(data);
      renderRows(data.items || []);
      showStatus('Run Sync สำเร็จ');

    } finally {
      setBusy(false);
    }
  }

  function unwrapData(data) {
    if (data && data.data && typeof data.data === 'object') {
      return data.data;
    }
    return data || {};
  }

  function updateSummary(data) {
    ['scanned', 'ready', 'synced', 'notReady', 'errors'].forEach(function (key) {
      const el = $('vcwMetric_' + key);
      if (el) el.textContent = String(Number(data && data[key] || 0));
    });
  }

  function renderRows(items) {
    const tbody = $('vcwGateOutRows');
    if (!tbody) return;

    if (!items || !items.length) {
      tbody.innerHTML = '<tr><td colspan="6">ยังไม่มีรายการที่ต้อง Sync</td></tr>';
      return;
    }

    tbody.innerHTML = items.slice(0, 30).map(function (item) {
      const status = item.success ? (item.action || 'READY') : (item.code || 'NOT_READY');
      return ''
        + '<tr>'
        + '<td><strong>' + escapeHtml(item.entryCode || '-') + '</strong></td>'
        + '<td>' + escapeHtml(item.plate || '-') + '</td>'
        + '<td>' + escapeHtml(item.company || '-') + '</td>'
        + '<td>' + escapeHtml(item.gateOutAt || '-') + '</td>'
        + '<td>' + escapeHtml(formatDurationForUi(item.duration || '', item.durationSeconds || 0)) + '</td>'
        + '<td><span class="vcw-gateout-chip ' + (item.success ? 'ok' : 'wait') + '">' + escapeHtml(status) + '</span></td>'
        + '</tr>';
    }).join('');
  }

  function formatDurationForUi(duration, seconds) {
    if (duration && /^\\d{2,}:\\d{2}:\\d{2}$/.test(String(duration))) {
      return duration;
    }

    const total = Number(seconds || 0);
    if (total > 0) {
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
    }

    return duration || '-';
  }

  function pad2(value) {
    return String(Math.floor(Number(value) || 0)).padStart(2, '0');
  }

  function setBusy(busy, message) {
    state.busy = Boolean(busy);
    ['vcwGateOutPreviewButton', 'vcwGateOutRunButton'].forEach(function (id) {
      const el = $(id);
      if (el) el.disabled = state.busy;
    });

    if (message) showStatus(message);
  }

  function showStatus(message, isError) {
    const el = $('vcwGateOutStatus');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('is-error', Boolean(isError));
  }

  async function askRunConfirm(ready) {
    const text = 'ยืนยัน Run Sync Gate Out จำนวน ' + ready + ' รายการ?';

    if (window.Swal) {
      const result = await window.Swal.fire({
        icon: 'question',
        title: 'ยืนยัน Sync Gate Out',
        text: text,
        showCancelButton: true,
        confirmButtonText: 'Run Sync',
        cancelButtonText: 'ยกเลิก',
        reverseButtons: true
      });
      return result.isConfirmed === true;
    }

    return window.confirm(text);
  }

  function normalizeLimit(value) {
    const number = Number(value || 30);
    if (!Number.isInteger(number)) return 30;
    return Math.max(1, Math.min(100, number));
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  initWhenReady();
})(window, document);
