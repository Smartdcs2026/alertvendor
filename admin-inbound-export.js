/**
 * admin-inbound-export.js
 * ROUND 06 PART 07 — Admin-only Inbound Export
 *
 * ข้อมูล Inbound เป็นข้อมูลสำคัญ
 * จึงแยก Export ออกจากหน้า Inbound และให้ใช้งานได้เฉพาะ Admin
 */
(function (window, document) {
  'use strict';

  const CONFIG = window.APP_CONFIG || {};
  const API = window.VehicleAPI;
  const EXPORT_LIMIT = 100;

  const state = {
    session: null,
    modules: [],
    moduleId: '',
    items: [],
    loading: false
  };

  document.addEventListener('DOMContentLoaded', initializeAdminInboundExport);

  async function initializeAdminInboundExport() {
    bindEvents();

    try {
      if (!API || typeof API.me !== 'function') return;

      const session = await API.me();
      state.session = session;

      if (!isAdmin(session)) {
        hideExportTab();
        return;
      }

      await loadModules();
      await loadInboundExportData({silent: true});

    } catch (error) {
      console.warn('init admin inbound export failed', error);
    }
  }

  function bindEvents() {
    byId('adminInboundExportRefreshButton')?.addEventListener('click', () => loadInboundExportData({silent: false}));
    byId('adminInboundExportButton')?.addEventListener('click', exportCsv);

    byId('adminInboundExportModuleSelect')?.addEventListener('change', async (event) => {
      state.moduleId = String(event.target.value || '').trim();
      await loadInboundExportData({silent: false});
    });

    byId('adminInboundExportStatusFilter')?.addEventListener('change', renderPreview);
    byId('adminInboundExportSearchInput')?.addEventListener('input', debounce(renderPreview, 180));
  }

  function hideExportTab() {
    document.querySelector('[data-admin-tab="exports"]')?.classList.add('is-hidden');
    byId('adminPanelExports')?.classList.add('is-hidden');
  }

  async function loadModules() {
    if (!API || typeof API.getModules !== 'function') {
      setSummary('ไม่พบ API สำหรับโหลด Module');
      return;
    }

    const data = await API.getModules();
    const list = Array.isArray(data) ? data : Array.isArray(data && data.modules) ? data.modules : [];

    state.modules = list
      .map((item) => ({
        moduleId: text(item.moduleId || item.id),
        name: text(item.name || item.moduleName || item.moduleId || item.id)
      }))
      .filter((item) => item.moduleId);

    const canonical = findCanonicalInboundModule();
    state.moduleId = canonical ? canonical.moduleId : state.modules[0] && state.modules[0].moduleId || '';

    renderModuleSelect();
  }

  function renderModuleSelect() {
    const select = byId('adminInboundExportModuleSelect');
    if (!select) return;

    if (!state.modules.length) {
      select.innerHTML = '<option value="">ไม่พบ Module</option>';
      return;
    }

    select.innerHTML = state.modules.map((module) => (
      '<option value="' + escapeHtml(module.moduleId) + '"' +
      (module.moduleId === state.moduleId ? ' selected' : '') +
      '>' + escapeHtml(module.name || module.moduleId) + '</option>'
    )).join('');
  }

  async function loadInboundExportData(options) {
    const config = options && typeof options === 'object' ? options : {};
    if (!state.moduleId) {
      setSummary('กรุณาเลือกแหล่งข้อมูล Inbound');
      return;
    }

    if (!API || typeof API.getInboundWorkflowDashboard !== 'function') {
      setSummary('ไม่พบ API สำหรับโหลด Inbound Workflow');
      return;
    }

    state.loading = true;
    setSummary('กำลังโหลดข้อมูล Inbound...');

    try {
      const data = await API.getInboundWorkflowDashboard(state.moduleId, {
        limit: EXPORT_LIMIT,
        cacheBust: Date.now()
      });

      state.items = normalizeDashboardItems(data);
      renderPreview();

      if (!config.silent) {
        toast('โหลดข้อมูลแล้ว ' + state.items.length + ' รายการ', 'success');
      }

    } catch (error) {
      console.error('load inbound export failed', error);
      setSummary('โหลดข้อมูลไม่สำเร็จ: ' + errorMessage(error));

    } finally {
      state.loading = false;
    }
  }

  function renderPreview() {
    const items = getFilteredItems();
    const preview = byId('adminInboundExportPreview');

    setSummary(
      'พร้อมส่งออก ' + items.length + ' รายการ' +
      (state.items.length ? ' จากข้อมูลที่โหลด ' + state.items.length + ' รายการ' : '') +
      ' · จำกัดครั้งละ ' + EXPORT_LIMIT + ' รายการ'
    );

    if (!preview) return;

    if (!items.length) {
      preview.innerHTML = '<div class="empty-state"><strong>ไม่พบข้อมูลตามเงื่อนไข</strong></div>';
      return;
    }

    preview.innerHTML = items.slice(0, 20).map((item) => (
      '<div class="admin-export-row">' +
        '<strong>' + escapeHtml(item.autoId || '-') + '</strong>' +
        '<span>' + escapeHtml(item.companyName || '-') + '</span>' +
        '<span>' + escapeHtml(item.driverName || '-') + '</span>' +
        '<small>' + escapeHtml((item.statusName || statusName(item.statusCode)) + ' · ' + (displayLatestTime(item) || '-')) + '</small>' +
      '</div>'
    )).join('');
  }

  function exportCsv() {
    const items = getFilteredItems();

    if (!items.length) {
      toast('ไม่มีข้อมูลสำหรับส่งออก', 'warning');
      return;
    }

    const rows = buildRows(items);
    const csv = toCsv(rows);
    const fileName = 'admin-inbound-export-' + formatFileDateTime(new Date()) + '.csv';

    downloadTextFile(fileName, '\ufeff' + csv, 'text/csv;charset=utf-8');
    toast('ส่งออก CSV แล้ว ' + items.length + ' รายการ', 'success');
  }

  function buildRows(items) {
    const header = [
      'ลำดับ',
      'Auto ID',
      'เลขนัดหมาย',
      'บริษัท',
      'พนักงานขับรถ',
      'ทะเบียน/จังหวัด',
      'เบอร์โทร',
      'สถานะ',
      'เวลายื่นเอกสาร',
      'เวลารับสินค้าเสร็จ',
      'เวลารับเอกสารคืน',
      'เวลา Gate In',
      'เวลา Gate Out',
      'อัปเดตล่าสุด',
      'ผู้ดำเนินการล่าสุด',
      'เหตุผลยกเลิก'
    ];

    return [header].concat(items.map((item, index) => [
      index + 1,
      item.autoId || '',
      item.appointmentNumber || '',
      item.companyName || '',
      item.driverName || '',
      formatPlateWithProvince(item),
      item.phone || '',
      item.statusName || statusName(item.statusCode),
      item.documentSubmittedAt || '',
      item.receivingCompletedAt || '',
      item.documentReturnedAt || '',
      item.gateInAt || '',
      item.gateOutAt || '',
      item.updatedAt || '',
      item.updatedBy || '',
      item.cancelReason || ''
    ]));
  }

  function getFilteredItems() {
    const status = String(byId('adminInboundExportStatusFilter')?.value || 'ALL').toUpperCase();
    const query = String(byId('adminInboundExportSearchInput')?.value || '').trim().toLowerCase();

    return state.items.filter((item) => {
      if (
        status !== 'ALL' &&
        item.statusCode !== status &&
        !(status === 'CANCELLED' && item.cancelled)
      ) {
        return false;
      }

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
      ].join(' ').toLowerCase().includes(query);
    });
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
      if (!existing || dateToMs(normalized.updatedAt) >= dateToMs(existing.updatedAt)) {
        map.set(normalized.autoId, normalized);
      }
    });

    return Array.from(map.values()).sort((a, b) => dateToMs(b.updatedAt) - dateToMs(a.updatedAt));
  }

  function normalizeDashboardItem(item) {
    const source = item && typeof item === 'object' ? item : {};
    const record = source.record || source.vehicle || source.sourceRecord || {};
    const statusCode = text(source.statusCode || source.status || '').toUpperCase();

    return {
      autoId: text(source.autoId || source.entryCode || source.recordId || record.autoId),
      statusCode,
      statusName: text(source.statusName || statusName(statusCode)),
      appointmentNumber: text(source.appointmentNumber || source.appointment || record.appointmentNumber || record.appointment),
      companyName: text(source.companyName || source.company || record.companyName || record.company),
      driverName: composeDriverName(source, record),
      registration: text(source.registration || source.plate || record.registration || record.plate),
      province: text(source.province || record.province),
      phone: text(source.phone || source.mobile || record.phone || record.mobile),
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

  function findCanonicalInboundModule() {
    const exactName = normalizeSearchText(CONFIG.INBOUND_CANONICAL_MODULE_NAME || '');

    if (exactName) {
      const exact = state.modules.find((module) => (
        normalizeSearchText(module.name) === exactName ||
        normalizeSearchText(module.moduleId) === exactName
      ));

      if (exact) return exact;
    }

    const keywords = Array.isArray(CONFIG.INBOUND_CANONICAL_MODULE_KEYWORDS)
      ? CONFIG.INBOUND_CANONICAL_MODULE_KEYWORDS
      : [];

    const cleanKeywords = keywords.map((item) => normalizeSearchText(item)).filter(Boolean);

    if (cleanKeywords.length) {
      const found = state.modules.find((module) => {
        const haystack = normalizeSearchText((module.name || '') + ' ' + (module.moduleId || ''));
        return cleanKeywords.every((keyword) => haystack.includes(keyword));
      });

      if (found) return found;
    }

    return state.modules[0] || null;
  }

  function normalizeSearchText(value) {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
  }

  function isAdmin(session) {
    return String(session && session.user && session.user.role || '').toUpperCase() === 'ADMIN';
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

  function displayLatestTime(item) {
    return item.documentReturnedAt || item.receivingCompletedAt || item.documentSubmittedAt || item.gateInAt || item.updatedAt || '';
  }

  function formatPlateWithProvince(item) {
    return [item.registration, item.province].filter(Boolean).join(' · ') || '-';
  }

  function composeDriverName(primary, secondary) {
    const first = primary && typeof primary === 'object' ? primary : {};
    const second = secondary && typeof secondary === 'object' ? secondary : {};
    const direct = text(first.driverName || first.personName || first.fullName || second.driverName || second.personName || second.fullName);
    if (direct) return direct;
    return [first.prefix || second.prefix, first.firstName || first.name || second.firstName || second.name, first.lastName || second.lastName].map(text).filter(Boolean).join(' ');
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

  function toCsv(rows) {
    return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  }

  function csvCell(value) {
    const textValue = String(value === undefined || value === null ? '' : value).replace(/\r?\n/g, ' ').trim();
    return '"' + textValue.replace(/"/g, '""') + '"';
  }

  function downloadTextFile(fileName, content, mimeType) {
    const blob = new Blob([content], {type: mimeType || 'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function formatFileDateTime(date) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Bangkok',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(date).reduce((acc, item) => {
      acc[item.type] = item.value;
      return acc;
    }, {});

    return parts.year + parts.month + parts.day + '-' + parts.hour + parts.minute + parts.second;
  }

  function setSummary(textValue) {
    const element = byId('adminInboundExportSummary');
    if (element) element.textContent = textValue || '';
  }

  function toast(message, icon) {
    if (window.Swal) {
      return window.Swal.fire({
        toast: true,
        position: 'top-end',
        timer: 2200,
        showConfirmButton: false,
        icon: icon || 'info',
        title: message
      });
    }

    window.alert(message);
    return Promise.resolve();
  }

  function errorMessage(error) {
    return error && (error.message || error.code) || 'เกิดข้อผิดพลาด';
  }

  function text(value) {
    return String(value === undefined || value === null ? '' : value).trim();
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function debounce(fn, delay) {
    let timer = 0;
    return function () {
      const args = arguments;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn.apply(this, args), Number(delay) || 180);
    };
  }

  function byId(id) {
    return document.getElementById(id);
  }
})(window, document);
