/************************************************************
 * module-mobile-card-sheet-v2.js
 * ROUND 06 PART 09.1I — Receiving Wording
 *
 * แก้เฉพาะ:
 * - มือถือขึ้นการ์ดเปล่า
 * - บังคับให้ compact card มีข้อมูลจริงก่อนซ่อน DOM เดิม
 * - ใช้ชื่อไฟล์ใหม่เพื่อกัน cache
 ************************************************************/
(function (window, document) {
  'use strict';

  const MOBILE_MAX_WIDTH =
    760;

  const state = {
    timer: 0,
    bootTimer: 0,
    observer: null,
    lastViewportMobile: null
  };

  document.addEventListener(
    'DOMContentLoaded',
    init
  );

  window.addEventListener(
    'load',
    () => scheduleHydrate(0)
  );

  window.addEventListener(
    'beforeunload',
    () => {
      window.clearTimeout(state.timer);
      window.clearInterval(state.bootTimer);
      if (state.observer) {
        state.observer.disconnect();
      }
    }
  );

  window.addEventListener(
    'resize',
    () => {
      const mobile =
        isMobile();

      if (
        state.lastViewportMobile !==
        mobile
      ) {
        scheduleHydrate(80);
      }
    }
  );

  function init() {
    injectStyle();
    bindCardClick();
    observe();
    startBootHydration();
    scheduleHydrate(0);
    scheduleHydrate(120);
    scheduleHydrate(400);
    scheduleHydrate(1200);

    window.addEventListener(
      'alertvendor:workflow-guard-updated',
      () => scheduleHydrate(40)
    );

    document.addEventListener(
      'alertvendor:records-updated',
      () => scheduleHydrate(80)
    );
  }

  function isMobile() {
    return window.innerWidth <= MOBILE_MAX_WIDTH;
  }

  function startBootHydration() {
    let count = 0;

    window.clearInterval(
      state.bootTimer
    );

    state.bootTimer =
      window.setInterval(
        () => {
          count += 1;
          hydrateCards();

          if (count >= 12) {
            window.clearInterval(
              state.bootTimer
            );
            state.bootTimer = 0;
          }
        },
        500
      );
  }

  function observe() {
    if (
      typeof MutationObserver !== 'function'
    ) {
      return;
    }

    if (state.observer) {
      state.observer.disconnect();
    }

    state.observer =
      new MutationObserver(
        () => scheduleHydrate(120)
      );

    state.observer.observe(
      document.body,
      {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          'class',
          'data-status',
          'data-workflow-guard',
          'data-work-queue-group',
          'disabled'
        ]
      }
    );
  }

  function scheduleHydrate(delay) {
    window.clearTimeout(
      state.timer
    );

    state.timer =
      window.setTimeout(
        hydrateCards,
        Number(delay) || 0
      );
  }



  function ensureMobileBodyClass() {
    document.body.classList.toggle(
      'mobile-compact-cards-active',
      isMobile()
    );
  }

  function hydrateCards() {
    const mobile =
      isMobile();

    if (
      state.lastViewportMobile !==
      mobile
    ) {
      state.lastViewportMobile =
        mobile;

      ensureMobileBodyClass();
    }

    const cards =
      Array.from(
        document.querySelectorAll(
          '.vehicle-card'
        )
      );

    cards.forEach(
      (card) => {
        if (!mobile) {
          if (
            card.dataset.mobileReady
          ) {
            card.removeAttribute(
              'data-mobile-ready'
            );
            card.removeAttribute(
              'data-mobile-status'
            );
            card.removeAttribute(
              'data-mobile-signature'
            );
          }

          return;
        }

        hydrateOneCard(card);
      }
    );
  }

  function hydrateOneCard(card) {
    const data =
      extractCardData(card);

    const signature =
      [
        data.company,
        data.appointment,
        data.time,
        data.badge,
        data.queue,
        data.level
      ].join('|');

    let shell =
      card.querySelector(
        ':scope > .mobile-compact-card'
      );

    if (
      shell &&
      card.dataset.mobileSignature ===
        signature &&
      card.dataset.mobileReady ===
        'true'
    ) {
      return;
    }

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

    const html = `
      <div class="mobile-v2-top">
        <span>${escapeHtml(data.badge)}</span>
        <strong>${escapeHtml(data.time)}</strong>
      </div>

      <div class="mobile-v2-company">
        <small>บริษัท</small>
        <strong>${escapeHtml(data.company)}</strong>
      </div>

      <div class="mobile-v2-appt">
        <small>APPT</small>
        <strong>${escapeHtml(data.appointment)}</strong>
      </div>

      <div class="mobile-v2-status">
        ${escapeHtml(data.queue)}
      </div>
    `;

    if (
      shell.innerHTML !== html
    ) {
      shell.innerHTML =
        html;
    }

    if (
      shell.getAttribute(
        'aria-hidden'
      ) !== 'true'
    ) {
      shell.setAttribute(
        'aria-hidden',
        'true'
      );
    }

    card.dataset.mobileReady =
      'true';

    card.dataset.mobileStatus =
      data.level;

    card.dataset.mobileCompany =
      data.company;

    card.dataset.mobileAppointment =
      data.appointment;

    card.dataset.mobileSignature =
      signature;
  }

  function extractCardData(card) {
    const title =
      getText(
        card.querySelector(
          '.vehicle-card__title'
        )
      ) ||
      getText(
        card.querySelector('h2')
      ) ||
      cleanLabel(
        card.getAttribute('aria-label') ||
        ''
      ) ||
      '-';

    const appointment =
      findFieldValue(
        card,
        [
          'เลขนัดหมาย',
          'หมายเลขนัดหมาย',
          'นัดหมาย',
          'APPT',
          'APPOINTMENT'
        ]
      ) ||
      findAppointmentFromText(
        card.textContent || ''
      ) ||
      '-';

    const time =
      getText(
        card.querySelector(
          '.vehicle-card__timer'
        )
      ) ||
      '--:--';

    const badge =
      getText(
        card.querySelector(
          '.vehicle-card__rank'
        )
      ) ||
      getText(
        card.querySelector(
          '.vehicle-status-badge'
        )
      ) ||
      'รายการ';

    const group =
      String(
        card.dataset.workQueueGroup ||
        ''
      ).toUpperCase();

    const queue =
      group === 'ACTION'
        ? 'ต้องทำ'
        : group === 'WAIT_INBOUND'
          ? 'รอยื่นเอกสาร'
          : group === 'TRACKING'
            ? 'ติดตาม'
            : (
                getText(
                  card.querySelector(
                    '.vehicle-status-badge'
                  )
                ) ||
                'รายละเอียด'
              );

    const allText =
      normalize(
        card.textContent || ''
      );

    const statusCode =
      normalize(
        card.dataset.status ||
        card.dataset.workflowGuard ||
        ''
      );

    let level =
      'NORMAL';

    if (
      statusCode.includes('OVERDUE') ||
      allText.includes('เกินเวลา') ||
      allText.includes('แดง')
    ) {
      level = 'OVERDUE';
    } else if (
      statusCode.includes('WARNING') ||
      allText.includes('ใกล้') ||
      allText.includes('ส้ม')
    ) {
      level = 'WARNING';
    } else if (
      group === 'TRACKING' ||
      statusCode.includes('RECEIVING_COMPLETED') ||
      statusCode.includes('DOCUMENT_RETURNED')
    ) {
      level = 'TRACKING';
    } else if (
      group === 'WAIT_INBOUND'
    ) {
      level = 'WAIT';
    }

    return {
      company: title,
      appointment,
      time,
      badge,
      queue,
      level
    };
  }

  function bindCardClick() {
    document.addEventListener(
      'click',
      (event) => {
        if (!isMobile()) return;

        const card =
          event.target.closest &&
          event.target.closest(
            '.vehicle-card'
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

        openSheet(card);
      },
      true
    );
  }

  function openSheet(card) {
    if (!window.Swal) {
      return;
    }

    const data =
      extractCardData(card);

    const fields =
      buildFieldRows(card);

    const flow =
      buildFlow(card);

    const actions =
      buildActions(card);

    window.Swal.fire({
      title: '',
      html: `
        <article class="mobile-v2-sheet" data-mobile-status="${escapeHtml(data.level)}">
          <header class="mobile-v2-sheet-head">
            <div>
              <small>บริษัท</small>
              <h2>${escapeHtml(data.company)}</h2>
            </div>
            <div>
              <span>${escapeHtml(data.queue)}</span>
              <strong>${escapeHtml(data.time)}</strong>
            </div>
          </header>

          <section class="mobile-v2-sheet-appt">
            <span>เลขนัดหมาย / APPT</span>
            <strong>${escapeHtml(data.appointment)}</strong>
          </section>

          ${flow}

          <section class="mobile-v2-fields">
            ${fields}
          </section>

          <section class="mobile-v2-actions">
            ${actions}
          </section>
        </article>
      `,
      width: 'min(94vw, 560px)',
      showConfirmButton: false,
      showCloseButton: true,
      customClass: {
        popup: 'mobile-v2-popup',
        htmlContainer: 'mobile-v2-html'
      },
      didOpen: () => bindSheetActions(card)
    });
  }

  function buildFlow(card) {
    const flow =
      card.querySelector(
        '.receiving-card-stage'
      );

    if (!flow) return '';

    const clone =
      flow.cloneNode(true);

    clone
      .querySelectorAll('button')
      .forEach(
        (button) => button.remove()
      );

    return `
      <section class="mobile-v2-flow">
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
      .forEach(
        (field) => {
          const label =
            getText(
              field.querySelector('span')
            );

          const value =
            getText(
              field.querySelector('strong, a')
            );

          if (!label || !value) return;

          rows.push(
            `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
          );
        }
      );

    const inTime =
      getText(
        card.querySelector(
          '.vehicle-in-time strong'
        )
      );

    if (inTime) {
      rows.push(
        `<div><span>เวลาเข้าพื้นที่</span><strong>${escapeHtml(inTime)}</strong></div>`
      );
    }

    return rows.join('') ||
      '<div><span>รายละเอียด</span><strong>ไม่มีข้อมูลเพิ่มเติม</strong></div>';
  }

  function buildActions(card) {
    const receive =
      card.querySelector(
        '[data-receiving-complete-record]'
      );

    const checkout =
      card.querySelector(
        '.button--checkout'
      );

    const copy =
      card.querySelector(
        '[data-receiving-copy-card]'
      );

    const group =
      String(
        card.dataset.workQueueGroup ||
        ''
      ).toUpperCase();

    const receiveAllowed =
      group === 'ACTION' &&
      receive &&
      receive.disabled !== true &&
      receive.getAttribute('aria-disabled') !== 'true' &&
      receive.getAttribute('data-workflow-queue-locked') !== 'true';

    const out = [];

    if (receiveAllowed) {
      out.push(
        '<button type="button" class="mobile-v2-primary" data-mobile-v2-action="receive">บันทึกตรวจรับเสร็จ</button>'
      );
    } else {
      let passiveText =
        'สถานะนี้ยังไม่มีปุ่มหลักที่ต้องกด';

      if (group === 'WAIT_INBOUND') {
        passiveText =
          'ยังไม่ถึงขั้นตอนตรวจรับ: รอคนขับยื่นเอกสารที่ห้อง Inbound ก่อน';
      } else if (group === 'TRACKING') {
        passiveText =
          'ตรวจรับสินค้าเสร็จแล้ว: รอรับเอกสารคืนที่ Inbound หรือออก Gate Out';
      }

      out.push(
        '<div class="mobile-v2-state">' +
        escapeHtml(passiveText) +
        '</div>'
      );
    }

    if (
      checkout &&
      checkout.disabled !== true
    ) {
      out.push(
        '<button type="button" class="mobile-v2-admin" data-mobile-v2-action="checkout">ADMIN: บันทึกออกพื้นที่</button>'
      );
    }

    if (copy) {
      out.push(
        '<button type="button" class="mobile-v2-secondary" data-mobile-v2-action="copy">คัดลอกสถานะ</button>'
      );
    }

    return out.join('');
  }

  function bindSheetActions(card) {
    bindAction(
      'receive',
      card,
      '[data-receiving-complete-record]'
    );

    bindAction(
      'checkout',
      card,
      '.button--checkout'
    );

    bindAction(
      'copy',
      card,
      '[data-receiving-copy-card]',
      false
    );
  }

  function bindAction(
    name,
    card,
    selector,
    closeBeforeClick
  ) {
    const sheetButton =
      document.querySelector(
        `[data-mobile-v2-action="${name}"]`
      );

    if (!sheetButton) return;

    sheetButton.addEventListener(
      'click',
      () => {
        const original =
          card.querySelector(selector);

        if (!original) return;

        if (closeBeforeClick !== false) {
          window.Swal.close();
          window.setTimeout(
            () => original.click(),
            80
          );
        } else {
          original.click();
        }
      }
    );
  }

  function findFieldValue(card, labels) {
    const wanted =
      labels.map(
        normalize
      );

    const fields =
      Array.from(
        card.querySelectorAll(
          '.vehicle-field'
        )
      );

    for (
      const field of fields
    ) {
      const label =
        normalize(
          getText(
            field.querySelector('span')
          )
        );

      if (
        wanted.some(
          (target) =>
            label === target ||
            label.includes(target) ||
            target.includes(label)
        )
      ) {
        const value =
          getText(
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
    const match =
      String(value || '').match(
        /(?:APPT|นัดหมาย|เลขนัดหมาย|หมายเลขนัดหมาย)\s*[:：]?\s*([A-Z0-9-]{5,})/i
      );

    return match
      ? match[1]
      : '';
  }

  function cleanLabel(value) {
    return String(value || '')
      .replace(/^ดูรายละเอียด\s*/i, '')
      .trim();
  }

  function getText(node) {
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

  function injectStyle() {
    if (
      document.getElementById(
        'moduleMobileCardV2Style'
      )
    ) {
      return;
    }

    const style =
      document.createElement('style');

    style.id =
      'moduleMobileCardV2Style';

    style.textContent = `
      .mobile-compact-card {
        display: none;
      }

      @media (max-width: 900px) {
        #vehicleList,
        .vehicle-grid,
        .vehicle-list {
          display: grid !important;
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          gap: 8px !important;
          align-items: stretch !important;
        }

        .vehicle-card {
          min-width: 0 !important;
          min-height: 142px !important;
          border-radius: 16px !important;
          padding: 8px !important;
          overflow: hidden !important;
          box-shadow: 0 8px 20px rgba(15, 23, 42, .08) !important;
          background: #ffffff !important;
        }

        .vehicle-card[data-mobile-status="OVERDUE"] {
          border-color: rgba(239, 68, 68, .55) !important;
          background: linear-gradient(135deg, #fff1f2, #ffffff) !important;
        }

        .vehicle-card[data-mobile-status="WARNING"] {
          border-color: rgba(245, 158, 11, .58) !important;
          background: linear-gradient(135deg, #fffbeb, #ffffff) !important;
        }

        .vehicle-card[data-mobile-status="TRACKING"] {
          border-color: rgba(59, 130, 246, .44) !important;
          background: linear-gradient(135deg, #eff6ff, #ffffff) !important;
        }

        .vehicle-card[data-mobile-status="WAIT"] {
          border-color: rgba(249, 115, 22, .44) !important;
          background: linear-gradient(135deg, #fff7ed, #ffffff) !important;
        }

        body.mobile-compact-cards-active
        .vehicle-card[data-mobile-ready="true"] > :not(.mobile-compact-card) {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
        }

        body.mobile-compact-cards-active
        .vehicle-card[data-mobile-ready="true"] > .mobile-compact-card {
          display: grid !important;
          visibility: visible !important;
          opacity: 1 !important;
          gap: 7px !important;
          height: 100% !important;
          min-height: 118px !important;
        }

        body.mobile-compact-cards-active
        .vehicle-card[data-mobile-ready="true"] > .mobile-compact-card,
        body.mobile-compact-cards-active
        .vehicle-card[data-mobile-ready="true"] > .mobile-compact-card * {
          box-sizing: border-box !important;
          visibility: visible !important;
          opacity: 1 !important;
        }

        .mobile-v2-top {
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          gap: 5px !important;
          min-width: 0 !important;
        }

        .mobile-v2-top span,
        .mobile-v2-status {
          max-width: 100% !important;
          overflow: hidden !important;
          border-radius: 999px !important;
          padding: 4px 7px !important;
          background: rgba(15, 23, 42, .08) !important;
          color: #334155 !important;
          font-size: 10px !important;
          line-height: 1.1 !important;
          font-weight: 950 !important;
          text-overflow: ellipsis !important;
          white-space: nowrap !important;
        }

        .mobile-v2-top strong {
          color: #0f172a !important;
          font-size: clamp(13px, 3.6vw, 16px) !important;
          line-height: 1 !important;
          font-weight: 1000 !important;
          white-space: nowrap !important;
        }

        .mobile-v2-company small,
        .mobile-v2-appt small {
          display: block !important;
          color: #64748b !important;
          font-size: 10px !important;
          line-height: 1 !important;
          font-weight: 950 !important;
        }

        .mobile-v2-company strong {
          display: -webkit-box !important;
          -webkit-line-clamp: 2 !important;
          -webkit-box-orient: vertical !important;
          overflow: hidden !important;
          color: #0f172a !important;
          font-size: clamp(17px, 4.5vw, 21px) !important;
          line-height: 1.08 !important;
          font-weight: 1000 !important;
          word-break: break-word !important;
        }

        .mobile-v2-appt {
          border-radius: 13px !important;
          border: 1px solid rgba(14, 165, 233, .18) !important;
          padding: 7px !important;
          background: rgba(14, 165, 233, .09) !important;
        }

        .mobile-v2-appt strong {
          display: block !important;
          overflow: hidden !important;
          color: #075985 !important;
          font-size: clamp(19px, 5.6vw, 25px) !important;
          line-height: 1 !important;
          font-weight: 1000 !important;
          letter-spacing: -.02em !important;
          text-overflow: ellipsis !important;
          white-space: nowrap !important;
        }

        .mobile-v2-status {
          margin-top: auto !important;
          text-align: center !important;
        }

        body.mobile-compact-cards-active
        .vehicle-card[data-mobile-ready="true"]
        .vehicle-card__rail,
        body.mobile-compact-cards-active
        .vehicle-card[data-mobile-ready="true"]
        .vehicle-card__rank,
        body.mobile-compact-cards-active
        .vehicle-card[data-mobile-ready="true"]
        .vehicle-card__header,
        body.mobile-compact-cards-active
        .vehicle-card[data-mobile-ready="true"]
        .vehicle-progress,
        body.mobile-compact-cards-active
        .vehicle-card[data-mobile-ready="true"]
        .vehicle-card__priority-text,
        body.mobile-compact-cards-active
        .vehicle-card[data-mobile-ready="true"]
        .vehicle-detail-grid,
        body.mobile-compact-cards-active
        .vehicle-card[data-mobile-ready="true"]
        .vehicle-card__footer,
        body.mobile-compact-cards-active
        .vehicle-card[data-mobile-ready="true"]
        .receiving-card-stage,
        body.mobile-compact-cards-active
        .vehicle-card[data-mobile-ready="true"]
        .workflow-guard-note,
        body.mobile-compact-cards-active
        .vehicle-card[data-mobile-ready="true"]
        .work-queue-card-badge {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
        }

        .mobile-v2-popup {
          border-radius: 22px !important;
          padding: 0 !important;
        }

        .mobile-v2-html {
          margin: 0 !important;
          padding: 0 !important;
        }

        .mobile-v2-sheet {
          display: grid;
          gap: 12px;
          padding: 16px;
          text-align: left;
        }

        .mobile-v2-sheet-head {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 12px;
          align-items: start;
        }

        .mobile-v2-sheet-head small,
        .mobile-v2-sheet-appt span,
        .mobile-v2-fields span {
          color: #64748b;
          font-size: 12px;
          font-weight: 900;
        }

        .mobile-v2-sheet-head h2 {
          margin: 2px 0 0;
          color: #0f172a;
          font-size: 24px;
          line-height: 1.08;
          font-weight: 1000;
        }

        .mobile-v2-sheet-head > div:last-child {
          min-width: 94px;
          border-radius: 14px;
          padding: 8px;
          background: #f8fafc;
          text-align: center;
        }

        .mobile-v2-sheet-head span {
          display: block;
          color: #64748b;
          font-size: 11px;
          font-weight: 900;
        }

        .mobile-v2-sheet-head strong {
          display: block;
          color: #0f172a;
          font-size: 18px;
          font-weight: 1000;
        }

        .mobile-v2-sheet-appt {
          border-radius: 16px;
          border: 1px solid #bae6fd;
          padding: 11px 12px;
          background: #e0f2fe;
        }

        .mobile-v2-sheet-appt strong {
          display: block;
          color: #075985;
          font-size: 31px;
          line-height: 1;
          font-weight: 1000;
        }

        .mobile-v2-flow .receiving-card-stage {
          display: block !important;
          visibility: visible !important;
          opacity: 1 !important;
        }

        .mobile-v2-fields {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        .mobile-v2-fields div {
          min-width: 0;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          padding: 9px;
          background: #ffffff;
        }

        .mobile-v2-fields strong {
          display: block;
          margin-top: 3px;
          color: #0f172a;
          font-size: 15px;
          line-height: 1.18;
          font-weight: 950;
          word-break: break-word;
        }

        .mobile-v2-actions {
          display: grid;
          gap: 8px;
          position: sticky;
          bottom: 0;
          padding-top: 4px;
          background: linear-gradient(180deg, rgba(255,255,255,.9), #ffffff);
        }

        .mobile-v2-actions button,
        .mobile-v2-state {
          width: 100%;
          min-height: 48px;
          border-radius: 14px;
          font-size: 15px;
          font-weight: 950;
        }

        .mobile-v2-actions button {
          border: 0;
        }

        .mobile-v2-primary {
          color: #ffffff;
          background: linear-gradient(135deg, #047857, #10b981);
        }

        .mobile-v2-admin {
          color: #ffffff;
          background: linear-gradient(135deg, #7c2d12, #ea580c);
        }

        .mobile-v2-secondary {
          color: #075985;
          background: #e0f2fe;
        }

        .mobile-v2-state {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 10px;
          color: #9a3412;
          background: #fff7ed;
          text-align: center;
        }
      }

      @media (max-width: 370px) {
        .vehicle-card {
          min-height: 132px !important;
          padding: 7px !important;
        }

        .mobile-v2-company strong {
          font-size: 15px !important;
        }

        .mobile-v2-appt strong {
          font-size: 18px !important;
        }

        .mobile-v2-fields {
          grid-template-columns: 1fr;
        }
      }
    `;

    document.head.appendChild(
      style
    );
  }
})(window, document);
