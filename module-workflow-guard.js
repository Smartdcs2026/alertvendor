/************************************************************
 * module-workflow-guard.js
 * ROUND 06 PART 09 — Core Workflow Guard + Auto ID Bridge
 *
 * เป้าหมาย:
 * - ไม่แตะ receiving.js เดิมที่ใช้งานได้
 * - เพิ่มชั้นป้องกันไม่ให้ User/Admin กด "บันทึกรับสินค้าเสร็จ"
 *   ก่อน Inbound ยื่นเอกสาร
 * - ใช้สถานะจาก Inbound Workflow เป็นตัวตัดสินขั้นตอน
 ************************************************************/
(function (window, document) {
  'use strict';

  const API = window.VehicleAPI;
  const REFRESH_MS = 10000;
  const SAFE_LIMIT = 100;

  const state = {
    moduleId: '',
    items: [],
    loading: false,
    timer: 0,
    observer: null,
    lastLoadedAt: 0
  };

  document.addEventListener('DOMContentLoaded', initialize);
  window.addEventListener('beforeunload', destroy);

  function initialize() {
    state.moduleId = getModuleId();

    if (
      !state.moduleId ||
      !API ||
      typeof API.getInboundWorkflowDashboard !== 'function'
    ) {
      return;
    }

    injectStyle();
    bindEvents();
    observeCards();

    void refreshWorkflowGuard(true);

    state.timer = window.setInterval(
      () => void refreshWorkflowGuard(true),
      REFRESH_MS
    );

    document.addEventListener(
      'alertvendor:records-updated',
      () => void refreshWorkflowGuard(true)
    );

    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'visible') {
          void refreshWorkflowGuard(true);
        }
      }
    );
  }

  function bindEvents() {
    /*
     * ใช้ capture phase เพื่อกันปุ่มรับสินค้าเสร็จก่อน receiving.js ทำงาน
     */
    document.addEventListener(
      'click',
      function (event) {
        const button =
          event.target.closest &&
          event.target.closest('[data-receiving-complete-record]');

        if (!button) return;

        const card =
          button.closest('.vehicle-card[data-record-id]') ||
          button.closest('[data-record-id]');

        const guard =
          evaluateCardGuard(card);

        if (guard.ready) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        flashBlockedButton(button);
        showBlockedMessage(guard);

      },
      true
    );
  }

  async function refreshWorkflowGuard(silent) {
    if (state.loading) return;

    state.loading = true;

    try {
      const data =
        await API.getInboundWorkflowDashboard(
          state.moduleId,
          {
            limit: SAFE_LIMIT,
            cacheBust: Date.now()
          }
        );

      state.items =
        normalizeDashboardItems(data);

      state.lastLoadedAt =
        Date.now();

      applyCardGuards();

    } catch (error) {
      if (!silent) {
        console.warn(
          'โหลด Workflow Guard ไม่สำเร็จ',
          error
        );
      }

      /*
       * ถ้าโหลดข้อมูลไม่ได้ จะใช้ข้อมูลล่าสุดที่มีอยู่
       * ไม่ปล่อยให้ปุ่มรับสินค้าเสร็จเปิดมั่ว
       */
      applyCardGuards();

    } finally {
      state.loading = false;
    }
  }

  function applyCardGuards() {
    const cards =
      document.querySelectorAll(
        '.vehicle-card[data-record-id]'
      );

    cards.forEach((card) => {
      const guard =
        evaluateCardGuard(card);

      const workflowItem =
        findWorkflowItemForCard(card);

      const workflowAutoId =
        workflowItem &&
        workflowItem.autoId
          ? workflowItem.autoId
          : '';

      card.dataset.workflowGuard =
        guard.status || 'UNKNOWN';

      card.dataset.vendorStage =
        guard.stage || 'UNKNOWN';

      card.dataset.vendorStageLabel =
        guard.label || '';

      card.dataset.workflowAutoId =
        workflowAutoId;

      card.dataset.workflowAppointment =
        workflowItem &&
        workflowItem.appointmentNumber
          ? workflowItem.appointmentNumber
          : '';

      card.dataset.workflowRegistration =
        workflowItem &&
        workflowItem.registration
          ? workflowItem.registration
          : '';

      const button =
        card.querySelector(
          '[data-receiving-complete-record]'
        );

      if (button) {
        button.dataset.workflowAutoId =
          workflowAutoId;

        button.dataset.workflowAppointment =
          card.dataset.workflowAppointment || '';

        button.dataset.workflowRegistration =
          card.dataset.workflowRegistration || '';

        button.disabled =
          !guard.ready;

        button.classList.toggle(
          'is-disabled-by-workflow',
          !guard.ready
        );

        button.setAttribute(
          'aria-disabled',
          guard.ready ? 'false' : 'true'
        );

        button.title =
          guard.ready
            ? 'บันทึกตรวจรับเสร็จ'
            : guard.message;
      }

      updateGuardNote(card, guard);
    });
  }


  function hasGateOutEvidence(card) {
    if (!card) {
      return false;
    }

    const directFlag =
      String(
        card.dataset.hasTimestampOut ||
        ''
      ).toLowerCase();

    if (directFlag === 'true') {
      return true;
    }

    const timestampOut =
      text(
        card.dataset.timestampOut ||
        ''
      );

    if (
      timestampOut &&
      ![
        '-',
        '--',
        'null',
        'undefined',
        'ยังไม่มีข้อมูล',
        'ไม่มีข้อมูล'
      ].includes(
        timestampOut.toLowerCase()
      )
    ) {
      return true;
    }

    const inArea =
      String(
        card.dataset.isCurrentlyInArea ||
        ''
      ).toLowerCase();

    return inArea === 'false';
  }


  function getVendorStageMeta(
    status,
    hasGateOut
  ) {
    if (hasGateOut) {
      return {
        key: 'CLOSED',
        label: 'ปิดงานแล้ว',
        message: 'ปิดงานแล้ว: มี Timestamp Out / ออก Gate Out แล้ว'
      };
    }

    if (status === 'DOCUMENT_SUBMITTED') {
      return {
        key: 'READY_TO_RECEIVE',
        label: 'รอตรวจรับสินค้า',
        message: 'Inbound บันทึกรับเอกสารแล้ว พร้อมบันทึกตรวจรับเสร็จ'
      };
    }

    if (status === 'RECEIVING_COMPLETED') {
      return {
        key: 'WAIT_DOCUMENT_RETURN',
        label: 'รอรับเอกสารคืน',
        message: 'ตรวจรับเสร็จแล้ว: รอรับเอกสารคืนที่ห้อง Inbound'
      };
    }

    if (status === 'DOCUMENT_RETURNED') {
      return {
        key: 'WAIT_GATE_OUT',
        label: 'รอออก Gate Out',
        message: 'รับเอกสารคืนแล้ว: รอออก Gate Out'
      };
    }

    if (status === 'GATE_OUT_COMPLETED') {
      return {
        key: 'CLOSED',
        label: 'ปิดงานแล้ว',
        message: 'ปิดงานแล้ว: ออก Gate Out แล้ว'
      };
    }

    if (status === 'CANCELLED') {
      return {
        key: 'CANCELLED',
        label: 'ยกเลิก',
        message: 'รายการนี้ถูกยกเลิกแล้ว'
      };
    }

    return {
      key: 'WAIT_DOCUMENT_SUBMIT',
      label: 'รอยื่นก่อนรับ',
      message: 'รอยื่นก่อนรับ: รอคนขับยื่นเอกสารที่ห้อง Inbound ก่อนตรวจรับ'
    };
  }



  function evaluateCardGuard(card) {
    if (!card) {
      return {
        ready: false,
        status: 'UNKNOWN',
        stage: 'UNKNOWN',
        label: 'ไม่พบข้อมูล',
        message: 'ไม่พบข้อมูลการ์ด'
      };
    }

    const hasGateOut =
      hasGateOutEvidence(card);

    if (hasGateOut) {
      const meta =
        getVendorStageMeta(
          'GATE_OUT_COMPLETED',
          true
        );

      return {
        ready: false,
        status: 'GATE_OUT_COMPLETED',
        stage: meta.key,
        label: meta.label,
        message: meta.message
      };
    }

    const item =
      findWorkflowItemForCard(card);

    if (!item) {
      const meta =
        getVendorStageMeta(
          'WAITING_DOCUMENT',
          false
        );

      return {
        ready: false,
        status: 'WAITING_DOCUMENT',
        stage: meta.key,
        label: meta.label,
        message: meta.message
      };
    }

    const status =
      String(item.statusCode || '').toUpperCase();

    const meta =
      getVendorStageMeta(
        status,
        false
      );

    return {
      ready:
        status === 'DOCUMENT_SUBMITTED',
      status:
        status || 'WAITING_DOCUMENT',
      stage:
        meta.key,
      label:
        meta.label,
      message:
        meta.message
    };
  }

  function updateGuardNote(card, guard) {
    if (!card) return;

    let note =
      card.querySelector(
        '.workflow-guard-note'
      );

    if (!note) {
      note =
        document.createElement('div');

      note.className =
        'workflow-guard-note';

      const target =
        card.querySelector(
          '.receiving-card-stage'
        ) ||
        card;

      target.appendChild(note);
    }

    card.classList.toggle(
      'workflow-guard-blocked',
      !guard.ready
    );

    card.classList.toggle(
      'workflow-guard-ready',
      guard.ready
    );

    card.classList.toggle(
      'workflow-guard-closed',
      guard.stage === 'CLOSED'
    );

    note.dataset.vendorStage =
      guard.stage || 'UNKNOWN';

    note.innerHTML =
      '<strong>' +
      escapeHtml(guard.label || 'ขั้นตอน') +
      '</strong>' +
      '<span>' +
      escapeHtml(
        guard.message ||
        'รอยื่นก่อนรับ: รอคนขับยื่นเอกสารที่ห้อง Inbound ก่อนตรวจรับ'
      ) +
      '</span>';
  }

  function findWorkflowItemForCard(card) {
    const recordId =
      String(
        card.dataset.recordId ||
        ''
      ).trim();

    const textValue =
      normalizeSearchText(
        card.textContent ||
        ''
      );

    const byRecordId =
      state.items.find((item) => {
        return (
          equalsToken(item.autoId, recordId) ||
          equalsToken(item.appointmentNumber, recordId) ||
          equalsToken(item.registration, recordId)
        );
      });

    if (byRecordId) return byRecordId;

    return state.items.find((item) => {
      return (
        containsToken(textValue, item.autoId) ||
        containsToken(textValue, item.appointmentNumber) ||
        containsToken(textValue, item.registration) ||
        containsToken(textValue, item.phone)
      );
    }) || null;
  }

  function normalizeDashboardItems(data) {
    const source =
      data &&
      data.data &&
      typeof data.data === 'object'
        ? data.data
        : data &&
          typeof data === 'object'
          ? data
          : {};

    const list =
      []
        .concat(
          Array.isArray(source.items)
            ? source.items
            : []
        )
        .concat(
          Array.isArray(source.waitingReceiving)
            ? source.waitingReceiving
            : []
        )
        .concat(
          Array.isArray(source.receivingCompleted)
            ? source.receivingCompleted
            : []
        )
        .concat(
          Array.isArray(source.documentReturned)
            ? source.documentReturned
            : []
        );

    const map =
      new Map();

    list.forEach((item) => {
      const normalized =
        normalizeWorkflowItem(item);

      const key =
        normalized.autoId ||
        normalized.appointmentNumber;

      if (!key) return;

      const existing =
        map.get(key);

      if (
        !existing ||
        dateToMs(normalized.updatedAt) >=
          dateToMs(existing.updatedAt)
      ) {
        map.set(key, normalized);
      }
    });

    return Array.from(map.values());
  }

  function normalizeWorkflowItem(item) {
    const source =
      item &&
      typeof item === 'object'
        ? item
        : {};

    const record =
      source.record ||
      source.vehicle ||
      source.sourceRecord ||
      {};

    return {
      autoId:
        text(
          source.autoId ||
          source.entryCode ||
          source.recordId ||
          record.autoId ||
          record.entryCode
        ),
      appointmentNumber:
        text(
          source.appointmentNumber ||
          source.appointment ||
          record.appointmentNumber ||
          record.appointment ||
          record.booking
        ),
      registration:
        text(
          source.registration ||
          source.plate ||
          record.registration ||
          record.plate
        ),
      phone:
        text(
          source.phone ||
          source.mobile ||
          record.phone ||
          record.mobile
        ),
      statusCode:
        text(
          source.statusCode ||
          source.status
        ).toUpperCase(),
      statusName:
        text(
          source.statusName
        ),
      updatedAt:
        text(
          source.updatedAt ||
          source.updatedAtText ||
          source.generatedAt
        )
    };
  }

  function flashBlockedButton(button) {
    if (!button) return;

    button.classList.add(
      'workflow-guard-shake'
    );

    window.setTimeout(
      () => button.classList.remove(
        'workflow-guard-shake'
      ),
      450
    );
  }

  function showBlockedMessage(guard) {
    const message =
      guard &&
      guard.message ||
      'รอยื่นก่อนรับ: รอคนขับยื่นเอกสารที่ห้อง Inbound ก่อนตรวจรับ';

    if (window.Swal) {
      window.Swal.fire({
        icon: 'info',
        title: 'ยังบันทึกรับสินค้าไม่ได้',
        text: message,
        confirmButtonText: 'รับทราบ'
      });

      return;
    }

    window.alert(message);
  }

  function observeCards() {
    const target =
      document.getElementById('vehicleList') ||
      document.body;

    if (
      !target ||
      typeof MutationObserver !== 'function'
    ) {
      return;
    }

    state.observer =
      new MutationObserver(() => {
        window.clearTimeout(
          state.applyTimer
        );

        state.applyTimer =
          window.setTimeout(
            applyCardGuards,
            120
          );
      });

    state.observer.observe(
      target,
      {
        childList: true,
        subtree: true
      }
    );
  }

  function injectStyle() {
    if (
      document.getElementById(
        'workflowGuardStyle'
      )
    ) {
      return;
    }

    const style =
      document.createElement('style');

    style.id =
      'workflowGuardStyle';

    style.textContent = `
      .workflow-guard-note {
        margin-top: 8px;
        padding: 8px 10px;
        border-radius: 12px;
        background: #fff7ed;
        color: #9a3412;
        font-size: 12px;
        font-weight: 800;
        line-height: 1.25;
      }

      .workflow-guard-blocked [data-receiving-complete-record],
      [data-receiving-complete-record].is-disabled-by-workflow {
        opacity: .58 !important;
        filter: grayscale(.15);
        cursor: not-allowed !important;
      }

      .workflow-guard-shake {
        animation: workflowGuardShake .38s ease-in-out;
      }

      @keyframes workflowGuardShake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-3px); }
        50% { transform: translateX(3px); }
        75% { transform: translateX(-2px); }
      }
    `;

    document.head.appendChild(style);
  }

  function getModuleId() {
    const params =
      new URLSearchParams(
        window.location.search
      );

    return String(
      params.get('id') ||
      params.get('module') ||
      ''
    ).trim();
  }

  function equalsToken(left, right) {
    const a =
      normalizeSearchText(left);

    const b =
      normalizeSearchText(right);

    return Boolean(a && b && a === b);
  }

  function containsToken(haystack, value) {
    const token =
      normalizeSearchText(value);

    return Boolean(
      haystack &&
      token &&
      haystack.includes(token)
    );
  }

  function normalizeSearchText(value) {
    return String(
      value === undefined ||
      value === null
        ? ''
        : value
    )
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ');
  }

  function dateToMs(value) {
    if (!value) return 0;

    const textValue =
      String(value).trim();

    const match =
      textValue.match(
        /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/
      );

    if (match) {
      return new Date(
        Number(match[3]),
        Number(match[2]) - 1,
        Number(match[1]),
        Number(match[4]),
        Number(match[5]),
        Number(match[6])
      ).getTime();
    }

    const ms =
      Date.parse(textValue);

    return Number.isFinite(ms)
      ? ms
      : 0;
  }

  function escapeHtml(value) {
    return String(
      value === undefined ||
      value === null
        ? ''
        : value
    )
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }


  function text(value) {
    return String(
      value === undefined ||
      value === null
        ? ''
        : value
    ).trim();
  }

  window.AlertVendorWorkflowGuard = {
    refresh:
      () => refreshWorkflowGuard(false),

    getAutoIdForRecord:
      (recordId) => {
        const identity =
          getIdentityForRecord(recordId);

        return identity.autoId || '';
      },

    getIdentityForRecord:
      getIdentityForRecord
  };

  function getIdentityForRecord(recordId) {
    const clean =
      normalizeSearchText(recordId);

    if (!clean) {
      return {
        autoId: '',
        appointmentNumber: '',
        registration: '',
        statusCode: ''
      };
    }

    const direct =
      state.items.find((item) => {
        return (
          equalsToken(item.autoId, clean) ||
          equalsToken(item.appointmentNumber, clean) ||
          equalsToken(item.registration, clean) ||
          equalsToken(item.phone, clean)
        );
      });

    const item =
      direct ||
      state.items.find((entry) => {
        const textValue =
          normalizeSearchText(
            [
              entry.autoId,
              entry.appointmentNumber,
              entry.registration,
              entry.phone
            ].join(' ')
          );

        return textValue.includes(clean);
      }) ||
      null;

    if (!item) {
      return {
        autoId: '',
        appointmentNumber: '',
        registration: '',
        statusCode: ''
      };
    }

    return {
      autoId:
        item.autoId || '',
      appointmentNumber:
        item.appointmentNumber || '',
      registration:
        item.registration || '',
      statusCode:
        item.statusCode || ''
    };
  }

  function destroy() {
    if (state.timer) {
      window.clearInterval(state.timer);
    }

    if (state.applyTimer) {
      window.clearTimeout(state.applyTimer);
    }

    if (state.observer) {
      state.observer.disconnect();
    }
  }
})(window, document);
