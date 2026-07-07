/*
 * vcw-production-check.js
 * VCW-R14C Auth-aware Final Production Check
 */
(function (window, document) {
  'use strict';

  const BUILD = 'VCW-R14C';
  const DEFAULT_MODULE = 'vendors';

  function $(id) {
    return document.getElementById(id);
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  ready(init);

  async function init() {
    if (!window.VCWWorkflowAPI && !window.VCWWorkflowApi) return;
    if (!shouldRender()) return;

    renderShell();
    await runCheck();
  }

  function shouldRender() {
    const href = String(location.href || '').toLowerCase();
    const path = String(location.pathname || '').toLowerCase();

    return (
      path.includes('admin') ||
      path.includes('dashboard') ||
      href.includes('tab=dashboard') ||
      href.includes('tab=modules') ||
      href.includes('tab=shifts')
    );
  }

  function resolveModuleId() {
    const url = new URL(location.href);
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

  function renderShell() {
    if ($('vcwProductionCheckCard')) return;

    const section = document.createElement('section');
    section.id = 'vcwProductionCheckCard';
    section.className = 'vcw-prod-card';
    section.innerHTML = ''
      + '<div class="vcw-prod-head">'
      + '  <div>'
      + '    <p>Production</p>'
      + '    <h2>Final Readiness Check</h2>'
      + '  </div>'
      + '  <span>' + BUILD + '</span>'
      + '</div>'
      + '<div class="vcw-prod-toolbar">'
      + '  <label>Module<input id="vcwProdModuleId" value="' + escapeHtml(resolveModuleId()) + '"></label>'
      + '  <button id="vcwProdRunCheck" type="button">Run Check</button>'
      + '</div>'
      + '<div id="vcwProdHealth" class="vcw-prod-health">กำลังตรวจสอบ...</div>'
      + '<div class="vcw-prod-grid">'
      + itemHtml('auth', 'Login / Session')
      + itemHtml('token', 'Token')
      + itemHtml('api', 'Workflow API')
      + itemHtml('dashboard', 'Dashboard')
      + itemHtml('sla', 'SLA Alerts')
      + itemHtml('autosync', 'Auto Sync')
      + itemHtml('report', 'Report / Export')
      + '</div>'
      + '<pre id="vcwProdOutput">-</pre>';

    const host = findHost();

    if (host === document.body) {
      document.body.insertBefore(section, document.body.firstChild);
    } else {
      host.insertBefore(section, host.firstChild);
    }

    $('vcwProdRunCheck').addEventListener('click', runCheck);
  }

  function itemHtml(key, label) {
    return ''
      + '<div class="vcw-prod-item" data-key="' + key + '">'
      + '  <span>' + escapeHtml(label) + '</span>'
      + '  <strong id="vcwProd_' + key + '">WAIT</strong>'
      + '</div>';
  }

  async function runCheck() {
    const api = window.VCWWorkflowAPI || window.VCWWorkflowApi;
    const moduleId = String($('vcwProdModuleId').value || DEFAULT_MODULE).trim() || DEFAULT_MODULE;

    setHealth('กำลังตรวจสอบ Production...', '');

    const detail = {
      build: BUILD,
      moduleId: moduleId,
      checkedAt: new Date().toISOString(),
      apiVersion: api && api.version ? api.version : '',
      tokenInfo: api && typeof api.getTokenInfo === 'function' ? api.getTokenInfo() : null,
      results: {}
    };

    if (!api) {
      setItem('api', 'FAIL', false);
      setHealth('ไม่พบ vcw-workflow-api.js', 'bad');
      $('vcwProdOutput').textContent = JSON.stringify(detail, null, 2);
      return;
    }

    setItem('api', 'OK', true);

    const hasToken = Boolean(detail.tokenInfo && detail.tokenInfo.hasToken);
    setItem('token', hasToken ? 'OK' : 'NO TOKEN', hasToken);

    if (!hasToken) {
      setItem('auth', 'FAIL', false);
      setItem('dashboard', 'SKIP', false);
      setItem('sla', 'SKIP', false);
      setItem('autosync', 'SKIP', false);
      setItem('report', 'SKIP', false);
      setHealth('ไม่พบ Token ใน browser storage — กรุณา Logout/Login ใหม่', 'bad');
      $('vcwProdOutput').textContent = JSON.stringify(detail, null, 2);
      return;
    }

    const me = await api.me();
    detail.results.me = me;

    if (!me || me.success !== true) {
      setItem('auth', 'FAIL', false);
      setItem('dashboard', 'SKIP', false);
      setItem('sla', 'SKIP', false);
      setItem('autosync', 'SKIP', false);
      setItem('report', 'SKIP', false);
      setHealth('Session ไม่ผ่าน: ' + ((me && me.message) || 'AUTH_REQUIRED'), 'bad');
      $('vcwProdOutput').textContent = JSON.stringify(detail, null, 2);
      return;
    }

    setItem('auth', 'OK', true);

    const checks = {
      dashboard: false,
      sla: false,
      autosync: true,
      report: true
    };

    try {
      const dash = await api.workflowDashboard(moduleId, { limit: 5 });
      detail.results.dashboard = dash;
      checks.dashboard = Boolean(dash && dash.success);
      setItem('dashboard', checks.dashboard ? 'OK' : 'FAIL', checks.dashboard);
    } catch (error) {
      detail.results.dashboardError = error.message || String(error);
      setItem('dashboard', 'FAIL', false);
    }

    try {
      const sla = await api.slaAlerts(moduleId, { limit: 5 });
      detail.results.sla = sla;
      checks.sla = Boolean(sla && sla.success);
      setItem('sla', checks.sla ? 'OK' : 'FAIL', checks.sla);
    } catch (error) {
      detail.results.slaError = error.message || String(error);
      setItem('sla', 'FAIL', false);
    }

    try {
      if (typeof api.autoGateOutStatus === 'function') {
        const auto = await api.autoGateOutStatus(moduleId);
        detail.results.autoSync = auto;
        checks.autosync = Boolean(auto && auto.success);
        setItem('autosync', checks.autosync ? 'OK' : 'CHECK', checks.autosync);
      } else {
        setItem('autosync', 'N/A', true);
      }
    } catch (error) {
      checks.autosync = false;
      detail.results.autoSyncError = error.message || String(error);
      setItem('autosync', 'CHECK', false);
    }

    try {
      if (typeof api.workflowReport === 'function') {
        const report = await api.workflowReport(moduleId, {
          date: todayIso(),
          limit: 10
        });
        detail.results.report = report;
        checks.report = Boolean(report && report.success);
        setItem('report', checks.report ? 'OK' : 'FAIL', checks.report);
      } else {
        setItem('report', 'N/A', true);
      }
    } catch (error) {
      checks.report = false;
      detail.results.reportError = error.message || String(error);
      setItem('report', 'FAIL', false);
    }

    const pass = Object.keys(checks).every(function (key) {
      return checks[key] === true;
    });

    setHealth(pass ? 'Production Check ผ่าน' : 'ยังมีจุดต้องตรวจ', pass ? 'ok' : 'warn');
    $('vcwProdOutput').textContent = JSON.stringify(detail, null, 2);
  }

  function setItem(key, text, ok) {
    const el = $('vcwProd_' + key);
    if (!el) return;
    el.textContent = text;
    el.className = ok ? 'ok' : 'warn';
  }

  function setHealth(text, status) {
    const el = $('vcwProdHealth');
    if (!el) return;
    el.textContent = text;
    el.className = 'vcw-prod-health ' + (status || '');
  }

  function todayIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})(window, document);
