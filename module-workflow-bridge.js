/************************************************************
 * module-workflow-bridge.js
 * ROUND 05 — Hide receiving-completed cards + completed list
 *
 * โหลดหลัง api.js, receiving.js และ module.js
 ************************************************************/
(function (window, document) {
  'use strict';

  const API = window.VehicleAPI;
  const state = {
    moduleId: '',
    data: null,
    timer: null,
    refreshTimer: null,
    observer: null,
    loading: false
  };

  document.addEventListener('DOMContentLoaded', initialize);
  window.addEventListener('beforeunload', destroy);

  function initialize() {
    state.moduleId = getModuleId();

    if (!state.moduleId || !API || typeof API.getInboundWorkflowDashboard !== 'function') {
      return;
    }

    ensureToolbar();
    bindEvents();
    observeCards();
    refreshWorkflowState(true);

    state.refreshTimer = window.setInterval(function () {
      refreshWorkflowState(true);
    }, 30000);

    document.addEventListener('alertvendor:records-updated', function () {
      scheduleApply();
    });
  }

  function bindEvents() {
    document.addEventListener('click', function (event) {
      const button = event.target.closest('[data-workflow-list]');
      if (!button) return;

      openWorkflowList(button.dataset.workflowList || 'RECEIVING_COMPLETED');
    });
  }

  function ensureToolbar() {
    if (document.getElementById('moduleWorkflowStrip')) {
      return;
    }

    const container = document.querySelector('.module-container') || document.body;
    const strip = document.createElement('section');
    strip.id = 'moduleWorkflowStrip';
    strip.className = 'module-workflow-strip';
    strip.innerHTML = `
      <button type="button" class="module-workflow-button" data-workflow-list="DOCUMENT_SUBMITTED">
        รอรับสินค้า <strong id="workflowWaitingReceivingCount">0</strong>
      </button>
      <button type="button" class="module-workflow-button" data-workflow-list="RECEIVING_COMPLETED">
        เสร็จแล้ว <strong id="workflowReceivingCompletedCount">0</strong>
      </button>
      <button type="button" class="module-workflow-button" data-workflow-list="DOCUMENT_RETURNED">
        คืนเอกสาร <strong id="workflowDocumentReturnedCount">0</strong>
      </button>
    `;

    container.insertBefore(strip, container.firstChild);
  }

  async function refreshWorkflowState(silent) {
    if (state.loading) return;

    state.loading = true;

    try {
      const data = await API.getInboundWorkflowDashboard(state.moduleId, {limit: 80});
      state.data = normalizeDashboard(data);
      updateCounts();
      applyCardRules();
    } catch (error) {
      if (!silent) {
        console.warn('โหลด Workflow Dashboard ไม่สำเร็จ', error);
      }
    } finally {
      state.loading = false;
    }
  }

  function normalizeDashboard(data) {
    const source = data && data.data && typeof data.data === 'object'
      ? data.data
      : data || {};

    const items = Array.isArray(source.items) ? source.items : [];

    return {
      raw: source,
      items: items.map(function (item) {
        return {
          autoId: String(item.autoId || item.recordId || '').trim(),
          statusCode: String(item.statusCode || '').trim().toUpperCase(),
          statusName: String(item.statusName || '').trim(),
          receivingCompletedAt: String(item.receivingCompletedAt || '').trim(),
          documentReturnedAt: String(item.documentReturnedAt || '').trim(),
          updatedAt: String(item.updatedAt || '').trim(),
          updatedBy: String(item.updatedBy || '').trim()
        };
      }),
      summary: source.summary || {}
    };
  }

  function updateCounts() {
    const data = state.data || {items: []};

    setText('workflowWaitingReceivingCount', countStatus(data.items, 'DOCUMENT_SUBMITTED'));
    setText('workflowReceivingCompletedCount', countStatus(data.items, 'RECEIVING_COMPLETED'));
    setText('workflowDocumentReturnedCount', countStatus(data.items, 'DOCUMENT_RETURNED'));
  }

  function countStatus(items, status) {
    return items.filter(function (item) {
      return item.statusCode === status;
    }).length;
  }

  function applyCardRules() {
    const data = state.data;
    if (!data) return;

    const byAutoId = new Map();
    data.items.forEach(function (item) {
      if (item.autoId) byAutoId.set(item.autoId, item);
    });

    document.querySelectorAll('.vehicle-card[data-record-id]').forEach(function (card) {
      const recordId = String(card.dataset.recordId || '').trim();
      const item = findItemForCard(card, recordId, byAutoId);
      const status = item ? item.statusCode : '';

      const hide = status === 'RECEIVING_COMPLETED' || status === 'DOCUMENT_RETURNED';
      card.classList.toggle('workflow-hidden-after-receiving', hide);

      const completeButton = card.querySelector('[data-receiving-complete-record]');
      if (completeButton) {
        const ready = status === 'DOCUMENT_SUBMITTED';
        completeButton.disabled = !ready;
        completeButton.classList.toggle('is-disabled-by-workflow', !ready);

        if (!ready) {
          completeButton.title = 'ต้องให้ Inbound ยื่นเอกสารก่อน';
          ensureWaitDocumentNote(card, status);
        } else {
          completeButton.title = '';
          removeWaitDocumentNote(card);
        }
      }
    });
  }

  function findItemForCard(card, recordId, byAutoId) {
    if (byAutoId.has(recordId)) {
      return byAutoId.get(recordId);
    }

    const text = String(card.textContent || '').toUpperCase();
    let matched = null;

    byAutoId.forEach(function (item, autoId) {
      if (!matched && autoId && text.indexOf(String(autoId).toUpperCase()) >= 0) {
        matched = item;
      }
    });

    return matched;
  }

  function ensureWaitDocumentNote(card, status) {
    if (status === 'RECEIVING_COMPLETED' || status === 'DOCUMENT_RETURNED') return;
    if (card.querySelector('.workflow-wait-document-note')) return;

    const note = document.createElement('div');
    note.className = 'workflow-wait-document-note';
    note.textContent = status
      ? 'ระบบเอกสารยังไม่ถึงขั้นรับสินค้าเสร็จ'
      : 'รอ Inbound ยื่นเอกสารก่อน';

    card.appendChild(note);
  }

  function removeWaitDocumentNote(card) {
    card.querySelectorAll('.workflow-wait-document-note').forEach(function (node) {
      node.remove();
    });
  }

  function openWorkflowList(status) {
    const data = state.data || {items: []};
    const cleanStatus = String(status || 'RECEIVING_COMPLETED').toUpperCase();
    const title = cleanStatus === 'DOCUMENT_SUBMITTED'
      ? 'รายการรอรับสินค้าเสร็จ'
      : cleanStatus === 'DOCUMENT_RETURNED'
        ? 'รายการรับเอกสารคืนแล้ว'
        : 'รายการรับสินค้าเสร็จแล้ว';

    const items = data.items
      .filter(function (item) { return item.statusCode === cleanStatus; })
      .slice(0, 50);

    const html = `
      <article class="workflow-completed-panel">
        <header>
          <small>WORKFLOW LIST</small>
          <h2>${escapeHtml(title)} (${items.length})</h2>
        </header>
        <div class="workflow-completed-list">
          ${items.length ? items.map(workflowItemHtml).join('') : '<div class="empty-state">ไม่มีรายการในสถานะนี้</div>'}
        </div>
      </article>
    `;

    window.Swal.fire({
      title: '',
      html: html,
      showCloseButton: true,
      confirmButtonText: 'ปิด',
      width: 'min(720px, calc(100vw - 16px))',
      customClass: {
        popup: 'workflow-completed-popup',
        htmlContainer: 'workflow-completed-html'
      }
    });
  }

  function workflowItemHtml(item) {
    return `
      <article class="workflow-completed-item">
        <div>
          <strong>${escapeHtml(item.autoId || '-')}</strong>
          <span>${escapeHtml(item.statusName || item.statusCode || '-')}</span>
        </div>
        <small>${escapeHtml(item.receivingCompletedAt || item.documentReturnedAt || item.updatedAt || '-')}</small>
      </article>
    `;
  }

  function observeCards() {
    const list = document.getElementById('vehicleList');
    if (!list || typeof MutationObserver !== 'function') return;

    state.observer = new MutationObserver(scheduleApply);
    state.observer.observe(list, {childList: true, subtree: true});
  }

  function scheduleApply() {
    if (state.timer) window.clearTimeout(state.timer);
    state.timer = window.setTimeout(applyCardRules, 120);
  }

  function getModuleId() {
    const params = new URLSearchParams(window.location.search);
    return String(params.get('id') || params.get('module') || '').trim();
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function destroy() {
    if (state.timer) window.clearTimeout(state.timer);
    if (state.refreshTimer) window.clearInterval(state.refreshTimer);
    if (state.observer) state.observer.disconnect();
  }
})(window, document);
