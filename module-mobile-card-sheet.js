/************************************************************
 * module-mobile-card-sheet.js
 * ROUND 06 PART 09.1B — Mobile Compact Card + Detail Action Sheet
 *
 * เป้าหมาย:
 * - มือถือแสดง 2 การ์ดต่อแถว
 * - การ์ดย่อแสดงเฉพาะ Appt + บริษัท + สถานะ/เวลาค้าง
 * - กดการ์ดแล้วเปิดรายละเอียดเต็มและปุ่มตามสิทธิ์/เงื่อนไข
 * - ไม่แตะ Backend / Scanner / Workflow Save Logic
 ************************************************************/
(function (window, document) {
  'use strict';

  const MOBILE_QUERY =
    '(max-width: 760px)';

  const state = {
    observer: null,
    timer: 0,
    media:
      window.matchMedia
        ? window.matchMedia(MOBILE_QUERY)
        : null
  };

  document.addEventListener(
    'DOMContentLoaded',
    initializeMobileCards
  );

  window.addEventListener(
    'beforeunload',
    destroyMobileCards
  );

  function initializeMobileCards() {
    injectStyle();
    bindCardSheet();
    observeCards();
    scheduleEnhance(0);
    scheduleEnhance(500);
    scheduleEnhance(1500);

    window.addEventListener(
      'alertvendor:workflow-guard-updated',
      () => scheduleEnhance(40)
    );

    document.addEventListener(
      'alertvendor:records-updated',
      () => scheduleEnhance(80)
    );

    if (
      state.media &&
      typeof state.media.addEventListener === 'function'
    ) {
      state.media.addEventListener(
        'change',
        () => scheduleEnhance(0)
      );
    }
  }

  function bindCardSheet() {
    document.addEventListener(
      'click',
      (event) => {
        if (!isMobile()) return;

        const card =
          event.target.closest &&
          event.target.closest(
            '.vehicle-card[data-record-id]'
          );

        if (!card) return;

        if (
          event.target.closest(
            'button, a, input, select, textarea, [data-work-queue-mode]'
          )
        ) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        openMobileDetailSheet(card);
      },
      true
    );
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

    state.observer =
      new MutationObserver(
        () => scheduleEnhance(80)
      );

    state.observer.observe(
      target,
      {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          'data-status',
          'data-workflow-guard',
          'data-workflow-auto-id',
          'data-work-queue-group',
          'class',
          'disabled'
        ]
      }
    );
  }

  function scheduleEnhance(delay) {
    window.clearTimeout(
      state.timer
    );

    state.timer =
      window.setTimeout(
        enhanceVisibleCards,
        Number(delay) || 0
      );
  }

  function enhanceVisibleCards() {
    const cards =
      document.querySelectorAll(
        '.vehicle-card[data-record-id]'
      );

    cards.forEach(
      enhanceCard
    );
  }

  function enhanceCard(card) {
    if (!card) return;

    let shell =
      card.querySelector(
        '.mobile-compact-card'
      );

    const data =
      extractCardData(card);

    if (!shell) {
      shell =
        document.createElement('div');

      shell.className =
        'mobile-compact-card';

      card.insertBefore(
        shell,
        card.firstChild
      );
    }

    shell.innerHTML = `
      <div class="mobile-card-topline">
        <span class="mobile-card-rank">${escapeHtml(data.rank)}</span>
        <strong>${escapeHtml(data.timer)}</strong>
      </div>

      <div class="mobile-card-company">
        <span>บริษัท</span>
        <strong>${escapeHtml(data.company)}</strong>
      </div>

      <div class="mobile-card-appt">
        <span>APPT</span>
        <strong>${escapeHtml(data.appointment)}</strong>
      </div>

      <div class="mobile-card-status">
        <span>${escapeHtml(data.queueText)}</span>
      </div>
    `;

    card.dataset.mobileStatus =
      data.level;

    card.dataset.mobileActionState =
      data.actionState;
  }

  function extractCardData(card) {
    const title =
      text(
        card.querySelector(
          '.vehicle-card__title'
        )
      ) ||
      text(
        card.querySelector('h2')
      ) ||
      '-';

    const appointment =
      getFieldValue(
        card,
        [
          'เลขนัดหมาย',
          'หมายเลขนัดหมาย',
          'นัดหมาย',
          'APPT',
          'APPOINTMENT',
          'BOOKING'
        ]
      ) ||
      findAppointmentFromText(
        card.textContent
      ) ||
      '-';

    const status =
      text(
        card.querySelector(
          '.vehicle-status-badge'
        )
      ) ||
      card.dataset.workflowGuard ||
      '-';

    const timer =
      text(
        card.querySelector(
          '.vehicle-card__timer'
        )
      ) ||
      '--:--';

    const rank =
      text(
        card.querySelector(
          '.vehicle-card__rank'
        )
      ) ||
      status;

    const group =
      String(
        card.dataset.workQueueGroup ||
        ''
      ).toUpperCase();

    const queueText =
      group === 'ACTION'
        ? 'ต้องทำ'
        : group === 'WAIT_INBOUND'
          ? 'รอ Inbound'
          : group === 'TRACKING'
            ? 'ติดตาม'
            : status;

    const statusCode =
      String(
        card.dataset.status ||
        card.dataset.workflowGuard ||
        ''
      ).toUpperCase();

    const textValue =
      normalize(
        card.textContent
      );

    let level = 'NORMAL';

    if (
      statusCode.includes('OVERDUE') ||
      textValue.includes('เกินเวลา') ||
      textValue.includes('แดง')
    ) {
      level = 'OVERDUE';
    } else if (
      statusCode.includes('WARNING') ||
      statusCode.includes('NEAR') ||
      textValue.includes('ใกล้') ||
      textValue.includes('ส้ม')
    ) {
      level = 'WARNING';
    } else if (
      group === 'TRACKING' ||
      statusCode.includes('RECEIVING_COMPLETED') ||
      statusCode.includes('DOCUMENT_RETURNED')
    ) {
      level = 'TRACKING';
    } else if (group === 'WAIT_INBOUND') {
      level = 'WAIT';
    }

    const receiveButton =
      card.querySelector(
        '[data-receiving-complete-record]'
      );

    const checkoutButton =
      card.querySelector(
        '.button--checkout'
      );

    let actionState = 'PASSIVE';

    if (
      receiveButton &&
      receiveButton.disabled !== true &&
      receiveButton.getAttribute('aria-disabled') !== 'true'
    ) {
      actionState = 'RECEIVE';
    } else if (
      checkoutButton &&
      checkoutButton.disabled !== true
    ) {
      actionState = 'ADMIN_OUT';
    }

    return {
      company: title,
      appointment,
      status,
      timer,
      rank,
      queueText,
      level,
      actionState
    };
  }

  function openMobileDetailSheet(card) {
    const data =
      extractCardData(card);

    const fieldRows =
      buildFieldRows(card);

    const flowHtml =
      buildFlowHtml(card);

    const actionHtml =
      buildActionHtml(card);

    if (!window.Swal) {
      card.click();
      return;
    }

    window.Swal.fire({
      title: '',
      html: `
        <article class="mobile-detail-sheet" data-mobile-status="${escapeHtml(data.level)}">
          <header class="mobile-detail-header">
            <div>
              <small>บริษัท</small>
              <h2>${escapeHtml(data.company)}</h2>
            </div>

            <div class="mobile-detail-timer">
              <span>${escapeHtml(data.queueText)}</span>
              <strong>${escapeHtml(data.timer)}</strong>
            </div>
          </header>

          <section class="mobile-detail-appt">
            <span>เลขนัดหมาย / APPT</span>
            <strong>${escapeHtml(data.appointment)}</strong>
          </section>

          <section class="mobile-detail-status">
            <strong>${escapeHtml(data.status)}</strong>
            <span>${escapeHtml(text(card.querySelector('.vehicle-card__priority-text')) || 'แตะปุ่มตามขั้นตอนที่ระบบอนุญาต')}</span>
          </section>

          ${flowHtml}

          <section class="mobile-detail-fields">
            ${fieldRows}
          </section>

          <section class="mobile-detail-actions">
            ${actionHtml}
          </section>
        </article>
      `,
      width: 'min(94vw, 560px)',
      showConfirmButton: false,
      showCloseButton: true,
      customClass: {
        popup: 'mobile-detail-popup',
        htmlContainer: 'mobile-detail-html'
      },
      didOpen: () => bindSheetActions(card)
    });
  }

  function buildFlowHtml(card) {
    const flow =
      card.querySelector(
        '.receiving-card-stage'
      );

    if (!flow) {
      return '';
    }

    const clone =
      flow.cloneNode(true);

    clone
      .querySelectorAll(
        'button'
      )
      .forEach(
        (button) => button.remove()
      );

    return `
      <section class="mobile-detail-flow">
        ${clone.outerHTML}
      </section>
    `;
  }

  function buildFieldRows(card) {
    const rows = [];

    card
      .querySelectorAll(
        '.vehicle-field'
      )
      .forEach((field) => {
        const label =
          text(
            field.querySelector('span')
          );

        const value =
          text(
            field.querySelector('strong, a')
          );

        if (!label || !value) return;

        rows.push(
          `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
        );
      });

    const inTimeLabel =
      text(
        card.querySelector(
          '.vehicle-in-time span'
        )
      );

    const inTimeValue =
      text(
        card.querySelector(
          '.vehicle-in-time strong'
        )
      );

    if (inTimeValue) {
      rows.push(
        `<div><span>${escapeHtml(inTimeLabel || 'เวลาเข้าพื้นที่')}</span><strong>${escapeHtml(inTimeValue)}</strong></div>`
      );
    }

    return rows.length
      ? rows.join('')
      : '<div><span>รายละเอียด</span><strong>ไม่มีข้อมูลเพิ่มเติม</strong></div>';
  }

  function buildActionHtml(card) {
    const receiveButton =
      card.querySelector(
        '[data-receiving-complete-record]'
      );

    const checkoutButton =
      card.querySelector(
        '.button--checkout'
      );

    const copyButton =
      card.querySelector(
        '[data-receiving-copy-card]'
      );

    const parts = [];

    if (
      receiveButton &&
      receiveButton.disabled !== true &&
      receiveButton.getAttribute('aria-disabled') !== 'true'
    ) {
      parts.push(
        '<button type="button" class="mobile-action-primary" data-mobile-sheet-action="receive">บันทึกรับสินค้าเสร็จ</button>'
      );
    } else {
      const message =
        receiveButton
          ? (
              receiveButton.title ||
              'ยังไม่ถึงขั้นตอนที่ User/Admin ต้องบันทึก'
            )
          : 'ไม่มีปุ่มรับสินค้าในสถานะนี้';

      parts.push(
        '<div class="mobile-action-state">' +
        escapeHtml(message) +
        '</div>'
      );
    }

    if (
      checkoutButton &&
      checkoutButton.disabled !== true
    ) {
      parts.push(
        '<button type="button" class="mobile-action-admin" data-mobile-sheet-action="checkout">ADMIN: บันทึกออกพื้นที่</button>'
      );
    }

    if (copyButton) {
      parts.push(
        '<button type="button" class="mobile-action-secondary" data-mobile-sheet-action="copy">คัดลอกสถานะ</button>'
      );
    }

    return parts.join('');
  }

  function bindSheetActions(card) {
    const receive =
      document.querySelector(
        '[data-mobile-sheet-action="receive"]'
      );

    if (receive) {
      receive.addEventListener(
        'click',
        () => {
          const original =
            card.querySelector(
              '[data-receiving-complete-record]'
            );

          if (original) {
            window.Swal.close();
            window.setTimeout(
              () => original.click(),
              80
            );
          }
        }
      );
    }

    const checkout =
      document.querySelector(
        '[data-mobile-sheet-action="checkout"]'
      );

    if (checkout) {
      checkout.addEventListener(
        'click',
        () => {
          const original =
            card.querySelector(
              '.button--checkout'
            );

          if (original) {
            window.Swal.close();
            window.setTimeout(
              () => original.click(),
              80
            );
          }
        }
      );
    }

    const copy =
      document.querySelector(
        '[data-mobile-sheet-action="copy"]'
      );

    if (copy) {
      copy.addEventListener(
        'click',
        () => {
          const original =
            card.querySelector(
              '[data-receiving-copy-card]'
            );

          if (original) {
            original.click();
          }
        }
      );
    }
  }

  function getFieldValue(card, labels) {
    const wanted =
      labels.map(
        (item) => normalize(item)
      );

    const fields =
      Array.from(
        card.querySelectorAll(
          '.vehicle-field'
        )
      );

    for (
      let index = 0;
      index < fields.length;
      index += 1
    ) {
      const field =
        fields[index];

      const label =
        normalize(
          text(field.querySelector('span'))
        );

      if (
        wanted.some(
          (item) =>
            label === item ||
            label.includes(item) ||
            item.includes(label)
        )
      ) {
        const value =
          text(
            field.querySelector(
              'strong, a'
            )
          );

        if (value) return value;
      }
    }

    return '';
  }

  function findAppointmentFromText(value) {
    const textValue =
      String(value || '');

    const match =
      textValue.match(
        /(?:APPT|นัดหมาย|เลขนัดหมาย|หมายเลขนัดหมาย)\s*[:：]?\s*([A-Z0-9-]{5,})/i
      );

    if (match) {
      return match[1];
    }

    return '';
  }

  function isMobile() {
    return state.media
      ? state.media.matches
      : window.innerWidth <= 760;
  }

  function injectStyle() {
    if (
      document.getElementById(
        'moduleMobileCardSheetStyle'
      )
    ) {
      return;
    }

    const style =
      document.createElement('style');

    style.id =
      'moduleMobileCardSheetStyle';

    style.textContent = `
      .mobile-compact-card {
        display: none;
      }

      @media (max-width: 760px) {
        #vehicleList,
        .vehicle-grid,
        .vehicle-list {
          display: grid !important;
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          gap: 8px !important;
          align-items: stretch !important;
        }

        .vehicle-card.vehicle-card--professional {
          min-width: 0 !important;
          min-height: 136px !important;
          padding: 8px !important;
          border-radius: 16px !important;
          overflow: hidden !important;
          border: 1px solid rgba(15, 23, 42, .12) !important;
          box-shadow: 0 8px 18px rgba(15, 23, 42, .08) !important;
        }

        .vehicle-card[data-mobile-status="OVERDUE"] {
          border-color: rgba(239, 68, 68, .5) !important;
          background: linear-gradient(135deg, #fff1f2, #ffffff) !important;
        }

        .vehicle-card[data-mobile-status="WARNING"] {
          border-color: rgba(245, 158, 11, .55) !important;
          background: linear-gradient(135deg, #fffbeb, #ffffff) !important;
        }

        .vehicle-card[data-mobile-status="TRACKING"] {
          border-color: rgba(59, 130, 246, .42) !important;
          background: linear-gradient(135deg, #eff6ff, #ffffff) !important;
        }

        .vehicle-card[data-mobile-status="WAIT"] {
          border-color: rgba(249, 115, 22, .4) !important;
          background: linear-gradient(135deg, #fff7ed, #ffffff) !important;
        }

        .vehicle-card .mobile-compact-card {
          display: grid !important;
          gap: 6px !important;
          height: 100% !important;
        }

        .vehicle-card .vehicle-card__rail,
        .vehicle-card .vehicle-card__rank,
        .vehicle-card .vehicle-card__header,
        .vehicle-card .vehicle-progress,
        .vehicle-card .vehicle-card__priority-text,
        .vehicle-card .vehicle-detail-grid,
        .vehicle-card .vehicle-card__footer,
        .vehicle-card .receiving-card-stage,
        .vehicle-card .workflow-guard-note,
        .vehicle-card .work-queue-card-badge {
          display: none !important;
        }

        .mobile-card-topline {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          min-width: 0;
        }

        .mobile-card-topline span,
        .mobile-card-status span {
          display: inline-flex;
          align-items: center;
          max-width: 100%;
          min-height: 22px;
          padding: 3px 7px;
          border-radius: 999px;
          background: rgba(15, 23, 42, .07);
          color: #334155;
          font-size: 10px;
          line-height: 1;
          font-weight: 950;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .mobile-card-topline strong {
          color: #0f172a;
          font-size: clamp(13px, 3.4vw, 16px);
          line-height: 1;
          font-weight: 950;
          white-space: nowrap;
        }

        .mobile-card-company span,
        .mobile-card-appt span {
          display: block;
          color: #64748b;
          font-size: 10px;
          line-height: 1;
          font-weight: 900;
          letter-spacing: .02em;
        }

        .mobile-card-company strong {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          color: #0f172a;
          font-size: clamp(16px, 4.3vw, 20px);
          line-height: 1.05;
          font-weight: 950;
          word-break: break-word;
        }

        .mobile-card-appt {
          padding: 6px 7px;
          border-radius: 12px;
          background: rgba(14, 165, 233, .09);
          border: 1px solid rgba(14, 165, 233, .16);
        }

        .mobile-card-appt strong {
          display: block;
          color: #075985;
          font-size: clamp(18px, 5.4vw, 24px);
          line-height: 1;
          font-weight: 1000;
          letter-spacing: -.02em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .mobile-card-status {
          margin-top: auto;
        }

        .mobile-detail-popup {
          border-radius: 22px !important;
          padding: 0 !important;
        }

        .mobile-detail-html {
          margin: 0 !important;
          padding: 0 !important;
        }

        .mobile-detail-sheet {
          text-align: left;
          padding: 16px;
          display: grid;
          gap: 12px;
        }

        .mobile-detail-header {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 12px;
          align-items: start;
        }

        .mobile-detail-header small,
        .mobile-detail-appt span,
        .mobile-detail-fields span {
          color: #64748b;
          font-size: 12px;
          font-weight: 900;
        }

        .mobile-detail-header h2 {
          margin: 2px 0 0;
          color: #0f172a;
          font-size: 24px;
          line-height: 1.1;
          font-weight: 950;
        }

        .mobile-detail-timer {
          min-width: 92px;
          padding: 8px;
          border-radius: 14px;
          background: #f8fafc;
          text-align: center;
        }

        .mobile-detail-timer span {
          display: block;
          color: #64748b;
          font-size: 11px;
          font-weight: 900;
        }

        .mobile-detail-timer strong {
          display: block;
          color: #0f172a;
          font-size: 18px;
          font-weight: 950;
        }

        .mobile-detail-appt {
          padding: 10px 12px;
          border-radius: 16px;
          background: #e0f2fe;
          border: 1px solid #bae6fd;
        }

        .mobile-detail-appt strong {
          display: block;
          color: #075985;
          font-size: 30px;
          line-height: 1;
          font-weight: 1000;
        }

        .mobile-detail-status {
          padding: 10px 12px;
          border-radius: 16px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
        }

        .mobile-detail-status strong,
        .mobile-detail-status span {
          display: block;
        }

        .mobile-detail-status strong {
          color: #0f172a;
          font-size: 16px;
          font-weight: 950;
        }

        .mobile-detail-status span {
          margin-top: 2px;
          color: #64748b;
          font-size: 13px;
          font-weight: 700;
        }

        .mobile-detail-flow .receiving-card-stage {
          display: block !important;
        }

        .mobile-detail-fields {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        .mobile-detail-fields div {
          min-width: 0;
          padding: 9px;
          border-radius: 14px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
        }

        .mobile-detail-fields strong {
          display: block;
          margin-top: 3px;
          color: #0f172a;
          font-size: 15px;
          line-height: 1.2;
          font-weight: 900;
          word-break: break-word;
        }

        .mobile-detail-actions {
          display: grid;
          gap: 8px;
          position: sticky;
          bottom: 0;
          padding-top: 4px;
          background: linear-gradient(180deg, rgba(255,255,255,.86), #ffffff);
        }

        .mobile-detail-actions button,
        .mobile-action-state {
          width: 100%;
          min-height: 48px;
          border-radius: 14px;
          font-weight: 950;
          font-size: 15px;
        }

        .mobile-detail-actions button {
          border: 0;
          cursor: pointer;
        }

        .mobile-action-primary {
          background: linear-gradient(135deg, #047857, #10b981);
          color: #ffffff;
        }

        .mobile-action-admin {
          background: linear-gradient(135deg, #7c2d12, #ea580c);
          color: #ffffff;
        }

        .mobile-action-secondary {
          background: #e0f2fe;
          color: #075985;
        }

        .mobile-action-state {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 10px;
          background: #fff7ed;
          color: #9a3412;
          text-align: center;
        }
      }

      @media (max-width: 370px) {
        #vehicleList,
        .vehicle-grid,
        .vehicle-list {
          gap: 6px !important;
        }

        .vehicle-card.vehicle-card--professional {
          padding: 7px !important;
          min-height: 126px !important;
        }

        .mobile-card-company strong {
          font-size: 15px;
        }

        .mobile-card-appt strong {
          font-size: 18px;
        }

        .mobile-detail-fields {
          grid-template-columns: 1fr;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function text(node) {
    return String(
      node && node.textContent
        ? node.textContent
        : ''
    )
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalize(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
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

  function destroyMobileCards() {
    window.clearTimeout(
      state.timer
    );

    if (state.observer) {
      state.observer.disconnect();
    }
  }
})(window, document);
