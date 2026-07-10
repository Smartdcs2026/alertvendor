/************************************************************
 * module-work-queue.js
 * ROUND 06 PART 09.1G — Stable Queue Render No Flicker
 *
 * เป้าหมาย:
 * - หน้า Module เป็น "หน้างาน" ไม่ใช่หน้ารวมทุกสถานะ
 * - ค่าเริ่มต้นแสดงเฉพาะงานที่ User/Admin ต้องทำตอนนี้
 * - งานที่รับสินค้าเสร็จแล้วถูกย้ายไป "ติดตาม"
 * - งานที่ยังรอคนขับยื่นเอกสารที่ห้อง Inbound แยกออกจากงานที่ต้องกด
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
    observer: null,
    bootTimer: 0,
    bootStartedAt: 0,
    lastCardCount: -1,
    lastItemCount: -1,
    guardReady: false,
    queueCountsReady: false,
    queueLoading: false,
    lastQueueSignature: '',
    lastVisibleSignature: ''
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

    /*
     * Round 06 Part 09.1A:
     * หน้า Module โหลดหลายไฟล์และการ์ดถูกสร้างทีหลัง
     * จึงต้อง Boot แบบ retry สั้น ๆ ไม่รอให้ผู้ใช้กดปุ่มก่อน
     */
    observeCards();
    requestGuardRefresh();

    pullWorkflowItems();
    scheduleApply(0);
    startBootSync();

    window.addEventListener(
      'alertvendor:workflow-guard-updated',
      (event) => {
        state.guardReady =
          true;

        state.items =
          Array.isArray(event.detail && event.detail.items)
            ? event.detail.items
            : [];

        scheduleApply(0);
      }
    );

    document.addEventListener(
      'alertvendor:records-updated',
      () => {
        requestGuardRefresh();
        scheduleApply(80);
      }
    );

    window.setTimeout(
      () => {
        requestGuardRefresh();
        pullWorkflowItems();
        scheduleApply(0);
      },
      350
    );

    window.setTimeout(
      () => {
        requestGuardRefresh();
        pullWorkflowItems();
        scheduleApply(0);
      },
      1200
    );
  }

  function startBootSync() {
    state.bootStartedAt =
      Date.now();

    state.queueCountsReady =
      false;

    setQueueLoading(
      true
    );

    window.clearInterval(
      state.bootTimer
    );

    state.bootTimer =
      window.setInterval(
        () => {
          pullWorkflowItems();
          scheduleApply(0);

          const cardCount =
            document.querySelectorAll(
              '.vehicle-card[data-record-id]'
            ).length;

          const itemCount =
            state.items.length;

          const stable =
            cardCount > 0 &&
            cardCount === state.lastCardCount &&
            itemCount === state.lastItemCount;

          state.lastCardCount =
            cardCount;

          state.lastItemCount =
            itemCount;

          const waitedMs =
            Date.now() - state.bootStartedAt;

          /*
           * ไม่ปล่อยตัวเลขขึ้น ๆ ลง ๆ ตอนเปิดหน้า
           * รอให้ guard พร้อมหรือรอช่วงสั้น ๆ ก่อนค่อยแสดงตัวเลขครั้งแรก
           */
          if (
            (
              state.guardReady &&
              stable
            ) ||
            waitedMs > 2500 ||
            (
              cardCount === 0 &&
              waitedMs > 1200
            )
          ) {
            state.queueCountsReady =
              true;

            setQueueLoading(
              false
            );

            scheduleApply(0);

            window.clearInterval(
              state.bootTimer
            );

            state.bootTimer = 0;
          }
        },
        350
      );
  }

  function requestGuardRefresh() {
    const guard =
      window.AlertVendorWorkflowGuard;

    if (
      guard &&
      typeof guard.refresh === 'function'
    ) {
      try {
        guard.refresh();
      } catch (error) {
        console.debug(
          'Workflow Guard refresh ยังไม่พร้อม',
          error
        );
      }
    }
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
        <span id="workQueueModeHint">เอกสารถูกยื่นแล้ว และรอคลังรับสินค้าให้เสร็จ</span>
      </div>

      <div class="module-work-queue-actions" role="group" aria-label="ตัวกรองงาน">
        <button type="button" data-work-queue-mode="ACTION">
          รอคลังรับ <strong id="workQueueActionCount">...</strong>
        </button>

        <button type="button" data-work-queue-mode="WAIT_INBOUND">
          รอยื่นเอกสาร <strong id="workQueueWaitInboundCount">...</strong>
        </button>

        <button type="button" data-work-queue-mode="TRACKING">
          ติดตาม <strong id="workQueueTrackingCount">...</strong>
        </button>

        <button type="button" data-work-queue-mode="ALL">
          ทั้งหมด <strong id="workQueueAllCount">...</strong>
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
      document.querySelector('.module-container') ||
      document.body;

    if (
      !target ||
      typeof MutationObserver !== 'function'
    ) {
      return;
    }

    if (state.observer) {
      state.observer.disconnect();
    }

    state.observer =
      new MutationObserver(
        () => {
          pullWorkflowItems();
          scheduleApply(60);
        }
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
          'data-status',
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

    const visibleParts = [];

    cards.forEach((card) => {
      const group =
        getCardQueueGroup(card);

      counters[group] =
        (counters[group] || 0) + 1;

      const visible =
        state.mode === 'ALL' ||
        state.mode === group;

      visibleParts.push(
        String(card.dataset.recordId || '') +
        ':' +
        group +
        ':' +
        (visible ? '1' : '0')
      );

      if (
        card.classList.contains(
          'module-work-queue-hidden'
        ) === visible
      ) {
        card.classList.toggle(
          'module-work-queue-hidden',
          !visible
        );
      }

      if (
        card.dataset.workQueueGroup !==
        group
      ) {
        card.dataset.workQueueGroup =
          group;
      }

      decorateCardQueueState(
        card,
        group
      );
    });

    const visibleSignature =
      visibleParts.join('|');

    if (
      state.lastVisibleSignature !==
      visibleSignature
    ) {
      state.lastVisibleSignature =
        visibleSignature;

      window.dispatchEvent(
        new CustomEvent(
          'alertvendor:work-queue-rendered',
          {
            detail: {
              mode: state.mode,
              counters
            }
          }
        )
      );
    }

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

    const completeButton =
      card.querySelector(
        '[data-receiving-complete-record]'
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

    /*
     * Fallback ตอนเปิดหน้าใหม่:
     * บางครั้ง guard/dashboard ยังโหลดไม่เสร็จ แต่การ์ดถูกวาดแล้ว
     * ให้ใช้ปุ่มและข้อความบนการ์ดช่วยจัดหมวดก่อน เพื่อไม่ให้ตัวเลขเป็น 0
     * แล้ว guard จะปรับความถูกต้องซ้ำทันทีเมื่อข้อมูลมาครบ
     */
    if (
      completeButton &&
      completeButton.disabled !== true &&
      completeButton.getAttribute('aria-disabled') !== 'true'
    ) {
      return 'ACTION';
    }

    if (
      textValue.includes('รอรับสินค้าเสร็จ') &&
      !textValue.includes('รอ INBOUND')
    ) {
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

    let textValue =
      'รับสินค้าเสร็จแล้ว: รอรับเอกสารคืนหรือ Gate Out';

    if (group === 'ACTION') {
      textValue =
        'รอคลังรับสินค้าเสร็จ';
    } else if (group === 'WAIT_INBOUND') {
      textValue =
        'รอคนขับยื่นเอกสารที่ห้อง Inbound';
    }

    if (
      badge.textContent !==
      textValue
    ) {
      badge.textContent =
        textValue;
    }

    if (
      badge.dataset.workQueueGroup !==
      group
    ) {
      badge.dataset.workQueueGroup =
        group;
    }
  }

  function updateQueueBar(counters) {
    if (
      state.queueCountsReady !== true
    ) {
      setQueueLoading(
        true
      );

      return;
    }

    const signature =
      [
        state.mode,
        counters.ACTION || 0,
        counters.WAIT_INBOUND || 0,
        counters.TRACKING || 0,
        counters.ALL || 0
      ].join('|');

    if (
      state.lastQueueSignature ===
      signature &&
      state.queueLoading !== true
    ) {
      return;
    }

    state.lastQueueSignature =
      signature;

    setQueueLoading(
      false
    );

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

        if (
          button.classList.contains(
            'is-active'
          ) !== active
        ) {
          button.classList.toggle(
            'is-active',
            active
          );
        }

        const aria =
          active ? 'true' : 'false';

        if (
          button.getAttribute(
            'aria-pressed'
          ) !== aria
        ) {
          button.setAttribute(
            'aria-pressed',
            aria
          );
        }
      });

    const title =
      byId('workQueueModeTitle');

    const hint =
      byId('workQueueModeHint');

    const titleText =
      state.mode === 'ACTION'
        ? 'รอคลังรับสินค้า'
        : state.mode === 'WAIT_INBOUND'
          ? 'รอยื่นเอกสารที่ Inbound'
          : state.mode === 'TRACKING'
            ? 'ติดตามหลังรับสินค้า'
            : 'รายการทั้งหมด';

    const hintText =
      state.mode === 'ACTION'
        ? 'คนขับยื่นเอกสารแล้ว เหลือรอคลังรับสินค้าให้เสร็จ'
        : state.mode === 'WAIT_INBOUND'
          ? 'รถ/ตู้เข้าพื้นที่แล้ว แต่ยังไม่พบการยื่นเอกสารที่ห้อง Inbound'
          : state.mode === 'TRACKING'
            ? 'คลังรับสินค้าเสร็จแล้ว เหลือรับเอกสารคืนที่ Inbound หรือออก Gate Out'
            : 'ภาพรวมทุกขั้นตอนของรายการที่ยังเกี่ยวข้อง';

    if (
      title &&
      title.textContent !== titleText
    ) {
      title.textContent =
        titleText;
    }

    if (
      hint &&
      hint.textContent !== hintText
    ) {
      hint.textContent =
        hintText;
    }
  }

  function setQueueLoading(isLoading) {
    const next =
      Boolean(isLoading);

    if (
      state.queueLoading ===
      next
    ) {
      return;
    }

    state.queueLoading =
      next;

    const bar =
      byId('moduleWorkQueueBar');

    if (bar) {
      bar.classList.toggle(
        'is-counts-loading',
        next
      );
    }

    if (!next) {
      return;
    }

    [
      'workQueueActionCount',
      'workQueueWaitInboundCount',
      'workQueueTrackingCount',
      'workQueueAllCount'
    ].forEach((id) => {
      const element =
        byId(id);

      if (
        element &&
        element.textContent !== '...'
      ) {
        element.textContent =
          '...';
      }
    });

    const title =
      byId('workQueueModeTitle');

    const hint =
      byId('workQueueModeHint');

    if (
      title &&
      title.textContent !==
        'กำลังจัดคิวงาน'
    ) {
      title.textContent =
        'กำลังจัดคิวงาน';
    }

    if (
      hint &&
      hint.textContent !==
        'รอข้อมูล Workflow ให้ครบก่อนแสดงตัวเลข เพื่อไม่ให้ตัวเลขกระพริบ'
    ) {
      hint.textContent =
        'รอข้อมูล Workflow ให้ครบก่อนแสดงตัวเลข เพื่อไม่ให้ตัวเลขกระพริบ';
    }
  }

  function updateLegacyListCount(counters) {
    if (
      state.queueCountsReady !== true
    ) {
      return;
    }

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

      .module-work-queue-bar.is-counts-loading
      .module-work-queue-actions strong {
        min-width: 34px;
        color: transparent;
        position: relative;
      }

      .module-work-queue-bar.is-counts-loading
      .module-work-queue-actions strong::after {
        content: "";
        position: absolute;
        inset: 7px;
        border-radius: 999px;
        background: rgba(14, 165, 233, .22);
        animation: workQueuePulse 1s ease-in-out infinite;
      }

      @keyframes workQueuePulse {
        0%, 100% { opacity: .35; }
        50% { opacity: 1; }
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

    if (state.bootTimer) {
      window.clearInterval(
        state.bootTimer
      );
    }

    if (state.observer) {
      state.observer.disconnect();
    }
  }
})(window, document);
