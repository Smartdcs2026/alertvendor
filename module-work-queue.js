/************************************************************
 * module-work-queue.js
 * ROUND 06 PART 09.1 — Mobile Work Queue Cleanup
 *
 * เป้าหมาย:
 * - หน้า Module เป็น "หน้างาน" ไม่ใช่หน้ารวมทุกสถานะ
 * - ค่าเริ่มต้นแสดงเฉพาะงานที่ User/Admin ต้องทำตอนนี้
 * - งานที่รับสินค้าเสร็จแล้วถูกย้ายไป "ติดตาม"
 * - งานที่ยังรอ Inbound ยื่นเอกสาร แยกออกจากงานที่ต้องกด
 * - ไม่แตะ Backend / Scanner / Receiving Save Logic
 ************************************************************/
(function (window, document) {
  'use strict';

  const QUEUE_STORAGE_KEY =
    'alertvendor:module-work-queue-mode:v1';

  const state = {
    mode:
      readSavedMode() ||
      'ACTION',
    items: [],
    applyTimer: 0,
    observer: null
  };

  document.addEventListener(
    'DOMContentLoaded',
    initializeWorkQueue
  );

  window.addEventListener(
    'beforeunload',
    destroyWorkQueue
  );

  function initializeWorkQueue() {
    injectStyle();
    ensureQueueBar();
    bindEvents();

    pullWorkflowItems();
    scheduleApply(80);

    window.addEventListener(
      'alertvendor:workflow-guard-updated',
      (event) => {
        state.items =
          Array.isArray(event.detail && event.detail.items)
            ? event.detail.items
            : [];

        scheduleApply(60);
      }
    );

    document.addEventListener(
      'alertvendor:records-updated',
      () => scheduleApply(120)
    );

    observeCards();

    window.setTimeout(
      () => {
        pullWorkflowItems();
        scheduleApply(0);
      },
      900
    );
  }

  function bindEvents() {
    document.addEventListener(
      'click',
      (event) => {
        const button =
          event.target.closest &&
          event.target.closest('[data-work-queue-mode]');

        if (!button) return;

        event.preventDefault();

        setMode(
          button.dataset.workQueueMode ||
          'ACTION'
        );
      }
    );

    /*
     * เมื่อกดรับสินค้าเสร็จสำเร็จ receiving.js จะปรับ stage บนการ์ด
     * เราจึง re-apply อีกครั้งเพื่อย้ายการ์ดออกจากหน้างานหลัก
     */
    document.addEventListener(
      'click',
      (event) => {
        const button =
          event.target.closest &&
          event.target.closest('[data-receiving-complete-record]');

        if (!button) return;

        window.setTimeout(
          () => scheduleApply(0),
          900
        );

        window.setTimeout(
          () => scheduleApply(0),
          2500
        );
      },
      true
    );
  }

  function setMode(nextMode) {
    const clean =
      String(nextMode || 'ACTION')
        .toUpperCase();

    state.mode =
      [
        'ACTION',
        'WAIT_INBOUND',
        'TRACKING',
        'ALL'
      ].includes(clean)
        ? clean
        : 'ACTION';

    try {
      sessionStorage.setItem(
        QUEUE_STORAGE_KEY,
        state.mode
      );
    } catch (error) {}

    applyQueue();
  }

  function readSavedMode() {
    try {
      const value =
        sessionStorage.getItem(
          QUEUE_STORAGE_KEY
        );

      return value
        ? String(value).toUpperCase()
        : '';
    } catch (error) {
      return '';
    }
  }

  function pullWorkflowItems() {
    const guard =
      window.AlertVendorWorkflowGuard;

    if (
      guard &&
      typeof guard.getItems === 'function'
    ) {
      const items =
        guard.getItems();

      if (Array.isArray(items)) {
        state.items =
          items;
      }
    }
  }

  function ensureQueueBar() {
    if (
      document.getElementById(
        'moduleWorkQueueBar'
      )
    ) {
      return;
    }

    const anchor =
      document.getElementById('vehicleList') ||
      document.querySelector('.module-list') ||
      document.querySelector('.module-container') ||
      document.body;

    const bar =
      document.createElement('section');

    bar.id =
      'moduleWorkQueueBar';

    bar.className =
      'module-work-queue-bar';

    bar.innerHTML = `
      <div class="module-work-queue-title">
        <small>WORK QUEUE</small>
        <strong id="workQueueModeTitle">งานที่ต้องทำตอนนี้</strong>
        <span id="workQueueModeHint">แสดงเฉพาะรายการที่พร้อมให้กดรับสินค้าเสร็จ</span>
      </div>

      <div class="module-work-queue-actions" role="group" aria-label="ตัวกรองงาน">
        <button type="button" data-work-queue-mode="ACTION">
          ต้องทำ <strong id="workQueueActionCount">0</strong>
        </button>

        <button type="button" data-work-queue-mode="WAIT_INBOUND">
          รอ Inbound <strong id="workQueueWaitInboundCount">0</strong>
        </button>

        <button type="button" data-work-queue-mode="TRACKING">
          ติดตาม <strong id="workQueueTrackingCount">0</strong>
        </button>

        <button type="button" data-work-queue-mode="ALL">
          ทั้งหมด <strong id="workQueueAllCount">0</strong>
        </button>
      </div>
    `;

    if (
      anchor &&
      anchor.parentNode
    ) {
      anchor.parentNode.insertBefore(
        bar,
        anchor
      );
    } else {
      document.body.insertBefore(
        bar,
        document.body.firstChild
      );
    }
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
      new MutationObserver(
        () => scheduleApply(120)
      );

    state.observer.observe(
      target,
      {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          'data-workflow-guard',
          'data-workflow-auto-id',
          'class',
          'disabled'
        ]
      }
    );
  }

  function scheduleApply(delay) {
    window.clearTimeout(
      state.applyTimer
    );

    state.applyTimer =
      window.setTimeout(
        applyQueue,
        Number(delay) || 0
      );
  }

  function applyQueue() {
    pullWorkflowItems();

    const cards =
      Array.from(
        document.querySelectorAll(
          '.vehicle-card[data-record-id]'
        )
      );

    const counters = {
      ACTION: 0,
      WAIT_INBOUND: 0,
      TRACKING: 0,
      ALL: cards.length
    };

    cards.forEach((card) => {
      const group =
        getCardQueueGroup(card);

      counters[group] =
        (counters[group] || 0) + 1;

      const visible =
        state.mode === 'ALL' ||
        state.mode === group;

      card.classList.toggle(
        'module-work-queue-hidden',
        !visible
      );

      card.dataset.workQueueGroup =
        group;

      decorateCardQueueState(
        card,
        group
      );
    });

    updateQueueBar(counters);
    updateLegacyListCount(counters);
  }

  function getCardQueueGroup(card) {
    const status =
      getCardWorkflowStatus(card);

    const textValue =
      normalizeSearchText(
        card.textContent || ''
      );

    /*
     * ถ้า receiving.js ปรับการ์ดเป็นรับสินค้าเสร็จแล้ว
     * ให้ถือว่าเป็นงานติดตามทันที แม้ Workflow Dashboard ยัง refresh ไม่ทัน
     */
    if (
      status === 'RECEIVING_COMPLETED' ||
      status === 'DOCUMENT_RETURNED' ||
      status === 'GATE_OUT_COMPLETED' ||
      textValue.includes('รับสินค้าเสร็จ รอ GATE OUT') ||
      textValue.includes('รับสินค้าเสร็จ รอ INBOUND') ||
      textValue.includes('บันทึกแล้ว')
    ) {
      return 'TRACKING';
    }

    if (status === 'DOCUMENT_SUBMITTED') {
      return 'ACTION';
    }

    return 'WAIT_INBOUND';
  }

  function getCardWorkflowStatus(card) {
    const dataStatus =
      String(
        card.dataset.workflowGuard ||
        ''
      ).toUpperCase();

    if (
      dataStatus &&
      dataStatus !== 'UNKNOWN'
    ) {
      return dataStatus;
    }

    const item =
      findWorkflowItemForCard(card);

    if (item && item.statusCode) {
      return String(
        item.statusCode
      ).toUpperCase();
    }

    return '';
  }

  function findWorkflowItemForCard(card) {
    const autoId =
      normalizeSearchText(
        card.dataset.workflowAutoId ||
        ''
      );

    const recordId =
      normalizeSearchText(
        card.dataset.recordId ||
        ''
      );

    const cardText =
      normalizeSearchText(
        card.textContent ||
        ''
      );

    return state.items.find((item) => {
      const itemAutoId =
        normalizeSearchText(
          item.autoId ||
          ''
        );

      const appointment =
        normalizeSearchText(
          item.appointmentNumber ||
          ''
        );

      const registration =
        normalizeSearchText(
          item.registration ||
          ''
        );

      const phone =
        normalizeSearchText(
          item.phone ||
          ''
        );

      return (
        equals(itemAutoId, autoId) ||
        equals(itemAutoId, recordId) ||
        equals(appointment, recordId) ||
        equals(registration, recordId) ||
        (
          itemAutoId &&
          cardText.includes(itemAutoId)
        ) ||
        (
          appointment &&
          cardText.includes(appointment)
        ) ||
        (
          registration &&
          cardText.includes(registration)
        ) ||
        (
          phone &&
          cardText.includes(phone)
        )
      );
    }) || null;
  }

  function decorateCardQueueState(card, group) {
    let badge =
      card.querySelector(
        '.work-queue-card-badge'
      );

    if (!badge) {
      badge =
        document.createElement('div');

      badge.className =
        'work-queue-card-badge';

      const target =
        card.querySelector(
          '.receiving-card-stage'
        ) ||
        card;

      target.appendChild(
        badge
      );
    }

    if (group === 'ACTION') {
      badge.textContent =
        'งานที่ต้องทำ: กดรับสินค้าเสร็จ';
    } else if (group === 'WAIT_INBOUND') {
      badge.textContent =
        'รอ Inbound ยื่นเอกสารก่อน';
    } else {
      badge.textContent =
        'รับสินค้าเสร็จแล้ว: รอ Inbound / Gate Out';
    }

    badge.dataset.workQueueGroup =
      group;
  }

  function updateQueueBar(counters) {
    setText(
      'workQueueActionCount',
      counters.ACTION || 0
    );

    setText(
      'workQueueWaitInboundCount',
      counters.WAIT_INBOUND || 0
    );

    setText(
      'workQueueTrackingCount',
      counters.TRACKING || 0
    );

    setText(
      'workQueueAllCount',
      counters.ALL || 0
    );

    document
      .querySelectorAll(
        '[data-work-queue-mode]'
      )
      .forEach((button) => {
        const active =
          String(
            button.dataset.workQueueMode ||
            ''
          ).toUpperCase() === state.mode;

        button.classList.toggle(
          'is-active',
          active
        );

        button.setAttribute(
          'aria-pressed',
          active ? 'true' : 'false'
        );
      });

    const title =
      byId('workQueueModeTitle');

    const hint =
      byId('workQueueModeHint');

    if (title) {
      title.textContent =
        state.mode === 'ACTION'
          ? 'งานที่ต้องทำตอนนี้'
          : state.mode === 'WAIT_INBOUND'
            ? 'รายการที่รอ Inbound'
            : state.mode === 'TRACKING'
              ? 'รายการติดตามหลังรับสินค้า'
              : 'รายการทั้งหมด';
    }

    if (hint) {
      hint.textContent =
        state.mode === 'ACTION'
          ? 'แสดงเฉพาะรายการที่พร้อมให้กดรับสินค้าเสร็จ'
          : state.mode === 'WAIT_INBOUND'
            ? 'ยังไม่ใช่งานของ User/Admin จนกว่า Inbound จะยื่นเอกสาร'
            : state.mode === 'TRACKING'
              ? 'User/Admin ทำหน้าที่แล้ว เหลือ Inbound รับเอกสารคืนหรือรอ Gate Out'
              : 'ใช้ตรวจสอบภาพรวมเท่านั้น ไม่ใช่หน้างานหลัก';
    }
  }

  function updateLegacyListCount(counters) {
    const count =
      state.mode === 'ALL'
        ? counters.ALL
        : counters[state.mode] || 0;

    const candidates =
      [
        'recordCount',
        'moduleRecordCount',
        'listCount'
      ];

    candidates.forEach((id) => {
      const element =
        byId(id);

      if (element) {
        element.textContent =
          String(count);
      }
    });
  }

  function injectStyle() {
    if (
      document.getElementById(
        'moduleWorkQueueStyle'
      )
    ) {
      return;
    }

    const style =
      document.createElement('style');

    style.id =
      'moduleWorkQueueStyle';

    style.textContent = `
      .module-work-queue-bar {
        margin: 12px auto 10px;
        padding: 12px;
        width: min(100% - 20px, 1480px);
        border: 1px solid rgba(14, 116, 144, .14);
        border-radius: 18px;
        background: linear-gradient(135deg, #ffffff, #f0fdfa);
        box-shadow: 0 12px 34px rgba(15, 23, 42, .07);
        display: grid;
        grid-template-columns: minmax(220px, .9fr) minmax(0, 1.6fr);
        gap: 12px;
        align-items: center;
      }

      .module-work-queue-title small {
        display: block;
        color: #0891b2;
        font-weight: 900;
        letter-spacing: .08em;
        font-size: 11px;
      }

      .module-work-queue-title strong {
        display: block;
        color: #0f172a;
        font-size: 18px;
        font-weight: 950;
        line-height: 1.15;
      }

      .module-work-queue-title span {
        display: block;
        color: #64748b;
        font-size: 12px;
        font-weight: 700;
        margin-top: 3px;
      }

      .module-work-queue-actions {
        display: grid;
        grid-template-columns: repeat(4, minmax(110px, 1fr));
        gap: 8px;
      }

      .module-work-queue-actions button {
        border: 1px solid #cfe7ef;
        border-radius: 14px;
        background: #ffffff;
        color: #0f3d5e;
        min-height: 46px;
        font-weight: 900;
        cursor: pointer;
        box-shadow: 0 8px 18px rgba(15, 23, 42, .04);
      }

      .module-work-queue-actions button strong {
        display: inline-flex;
        min-width: 24px;
        height: 24px;
        align-items: center;
        justify-content: center;
        margin-left: 5px;
        padding: 0 7px;
        border-radius: 999px;
        background: #e0f2fe;
        color: #075985;
      }

      .module-work-queue-actions button.is-active {
        background: linear-gradient(135deg, #075985, #0891b2);
        color: #ffffff;
        border-color: transparent;
      }

      .module-work-queue-actions button.is-active strong {
        background: rgba(255,255,255,.2);
        color: #ffffff;
      }

      .module-work-queue-hidden {
        display: none !important;
      }

      .work-queue-card-badge {
        margin-top: 8px;
        padding: 8px 10px;
        border-radius: 12px;
        font-size: 12px;
        line-height: 1.25;
        font-weight: 900;
      }

      .work-queue-card-badge[data-work-queue-group="ACTION"] {
        background: #ecfdf5;
        color: #047857;
      }

      .work-queue-card-badge[data-work-queue-group="WAIT_INBOUND"] {
        background: #fff7ed;
        color: #9a3412;
      }

      .work-queue-card-badge[data-work-queue-group="TRACKING"] {
        background: #eff6ff;
        color: #1d4ed8;
      }

      @media (max-width: 760px) {
        .module-work-queue-bar {
          width: calc(100% - 16px);
          grid-template-columns: 1fr;
          padding: 10px;
          border-radius: 16px;
          position: sticky;
          top: 0;
          z-index: 15;
        }

        .module-work-queue-title strong {
          font-size: 16px;
        }

        .module-work-queue-actions {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .module-work-queue-actions button {
          min-height: 42px;
          font-size: 12px;
          padding: 6px 4px;
        }
      }
    `;

    document.head.appendChild(style);
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

  function equals(left, right) {
    return Boolean(
      left &&
      right &&
      left === right
    );
  }

  function setText(id, value) {
    const element =
      byId(id);

    if (element) {
      element.textContent =
        String(value);
    }
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function destroyWorkQueue() {
    if (state.applyTimer) {
      window.clearTimeout(
        state.applyTimer
      );
    }

    if (state.observer) {
      state.observer.disconnect();
    }
  }
})(window, document);
