/**
 * module-operations.js
 * ROUND 44 — Operational Alert and Card Identity
 */
(function (window, document) {
  'use strict';

  const state = { observer: null, swalTimer: null };

  document.addEventListener('DOMContentLoaded', initialize);
  window.addEventListener('beforeunload', destroy);

  function initialize() {
    annotateVehicleCards();
    observeVehicleList();
    patchSweetAlertWhenReady();
  }

  function observeVehicleList() {
    const list = document.getElementById('vehicleList');
    if (!list) return;
    state.observer = new MutationObserver(debounce(annotateVehicleCards, 80));
    state.observer.observe(list, { childList: true, subtree: true });
  }

  function annotateVehicleCards() {
    document.querySelectorAll('.vehicle-card[data-record-id]').forEach((card) => {
      card.querySelectorAll('.vehicle-field').forEach((field) => {
        const label = normalize(text(field.querySelector('span')));
        let role = 'OTHER';
        if (matches(label, ['เลขนัดหมาย','หมายเลขนัดหมาย','นัดหมาย','appointment','booking'])) {
          role = 'APPOINTMENT';
        } else if (matches(label, ['ทะเบียน','ทะเบียนรถ','registration','plate','เลขตู้','container'])) {
          role = 'REGISTRATION';
        } else if (matches(label, ['ชื่อ','driver','คนขับ','ผู้ขับ'])) {
          role = 'DRIVER';
        }
        field.dataset.operationalRole = role;
      });
    });
  }

  function patchSweetAlertWhenReady() {
    if (!window.Swal || typeof window.Swal.fire !== 'function') {
      state.swalTimer = window.setTimeout(patchSweetAlertWhenReady, 120);
      return;
    }
    if (window.Swal.fire.__round44Patched) return;

    const original = window.Swal.fire.bind(window.Swal);
    const wrapped = function (...args) {
      const options = args[0];
      const marker = options && typeof options === 'object'
        ? String(options.title || '') + ' ' + String(options.text || '') + ' ' + String(options.html || '')
        : '';
      if (marker.includes('เกินเวลา') && collectOverdueRecords().length > 0) {
        return original(enhanceOverdueAlert(options || {}));
      }
      return original(...args);
    };
    wrapped.__round44Patched = true;
    window.Swal.fire = wrapped;
  }

  function enhanceOverdueAlert(source) {
    const records = collectOverdueRecords();
    const oldDidOpen = source.didOpen;
    return {
      ...source,
      icon: undefined,
      title: 'รถ/ตู้เกินเวลา — ต้องติดตาม',
      html: buildOverdueHtml(records),
      confirmButtonText: 'รับทราบ',
      customClass: {
        ...(source.customClass || {}),
        popup: 'overdue-command-popup',
        htmlContainer: 'overdue-command-html',
        confirmButton: 'overdue-command-confirm'
      },
      didOpen: (popup) => {
        if (typeof oldDidOpen === 'function') oldDidOpen(popup);
        popup.querySelectorAll('[data-overdue-scroll-record]').forEach((button) => {
          button.addEventListener('click', () => {
            const id = button.dataset.overdueScrollRecord;
            window.Swal.close();
            window.setTimeout(() => scrollToRecord(id), 80);
          });
        });
      }
    };
  }

  function collectOverdueRecords() {
    return Array.from(document.querySelectorAll('.vehicle-card[data-status="OVERDUE"][data-record-id]'))
      .map((card) => {
        const fields = Array.from(card.querySelectorAll('.vehicle-field'));
        return {
          recordId: String(card.dataset.recordId || ''),
          company: text(card.querySelector('.vehicle-card__title')) || text(card.querySelector('.vehicle-card__header strong')) || 'ไม่ระบุบริษัท',
          appointment: findField(fields, ['เลขนัดหมาย','หมายเลขนัดหมาย','นัดหมาย','appointment','booking']) || '-',
          registration: findField(fields, ['ทะเบียน','ทะเบียนรถ','registration','plate','เลขตู้','container']) || '-',
          gateIn: text(card.querySelector('.vehicle-in-time strong')) || '-',
          duration: text(card.querySelector('.vehicle-card__timer')) || '-',
          stage: text(card.querySelector('.receiving-card-stage__head strong')) || 'อยู่ในพื้นที่'
        };
      })
      .sort((a,b) => durationSeconds(b.duration) - durationSeconds(a.duration));
  }

  function buildOverdueHtml(records) {
    const visible = records.slice(0, 6);
    return `
      <div class="overdue-command-dialog">
        <header class="overdue-command-summary">
          <div><small>EXECUTIVE ALERT</small><strong>${records.length} รายการเกิน SLA</strong></div>
          <span>เรียงเวลาคงค้างสูงสุด</span>
        </header>
        <div class="overdue-command-list">
          ${visible.map((record,index) => `
            <button type="button" class="overdue-command-item" data-overdue-scroll-record="${escapeHtml(record.recordId)}">
              <span class="overdue-command-rank">${index+1}</span>
              <span class="overdue-command-main">
                <strong>${escapeHtml(record.company)}</strong>
                <span><b>เลขนัดหมาย</b> ${escapeHtml(record.appointment)}</span>
                <span><b>ทะเบียน</b> ${escapeHtml(record.registration)}</span>
              </span>
              <span class="overdue-command-time"><strong>${escapeHtml(record.duration)}</strong><small>${escapeHtml(record.stage)}</small></span>
              <span class="overdue-command-gate">Gate In <strong>${escapeHtml(record.gateIn)}</strong></span>
            </button>
          `).join('')}
        </div>
        ${records.length > visible.length ? `<p class="overdue-command-more">และอีก ${records.length-visible.length} รายการ</p>` : ''}
        <p class="overdue-command-note">แตะรายการเพื่อไปยังการ์ดรถ/ตู้</p>
      </div>`;
  }

  function findField(fields, patterns) {
    const targets = patterns.map(normalize);
    for (const field of fields) {
      const label = normalize(text(field.querySelector('span')));
      if (targets.some((target) => label.includes(target))) {
        return text(field.querySelector('strong, a')) || '-';
      }
    }
    return '';
  }

  function scrollToRecord(id) {
    const card = Array.from(document.querySelectorAll('.vehicle-card[data-record-id]'))
      .find((item) => String(item.dataset.recordId || '') === String(id || ''));
    if (!card) return;
    card.classList.remove('is-receiving-filter-hidden');
    card.removeAttribute('aria-hidden');
    card.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    card.classList.add('receiving-highlight');
    setTimeout(() => card.classList.remove('receiving-highlight'), 1800);
  }

  function text(el) { return String(el && el.textContent || '').trim(); }
  function normalize(v) { return String(v || '').trim().toLowerCase().replace(/[\s_\-:]+/g,''); }
  function matches(value, patterns) { return patterns.map(normalize).some((p) => value.includes(p)); }
  function durationSeconds(v) { const p=String(v||'').split(':').map(Number); return p.length===3&&p.every(Number.isFinite)?p[0]*3600+p[1]*60+p[2]:0; }
  function escapeHtml(v) { return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
  function debounce(fn,delay) { let t=null; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>{t=null;fn(...args)},delay); }; }
  function destroy() { if (state.observer) state.observer.disconnect(); if (state.swalTimer) clearTimeout(state.swalTimer); }
})(window, document);
