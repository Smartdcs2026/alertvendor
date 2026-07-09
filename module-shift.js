/**
 * module-shift.js
 * ROUND 56 — Movement Scope + Shift UI
 */
(function (window, document) {
  'use strict';

  const state = {
    moduleId: '',
    config: null,
    activeScope: 'ROLLING_4H',
    selectedDate: '',
    selectedShift: '',
    requestToken: 0
  };

  function open() {
    state.moduleId = (
      new URLSearchParams(
        window.location.search
      ).get('id') || ''
    ).trim();

    state.selectedDate = todayIso();

    window.Swal.fire({
      icon: undefined,
      title: '',
      html: buildShellHtml(),
      showConfirmButton: true,
      confirmButtonText: 'ปิด',
      showCloseButton: true,
      allowOutsideClick: true,
      heightAuto: false,
      width: 'min(900px, calc(100vw - 10px))',
      padding: '0',
      customClass: {
        popup: 'shift-movement-popup',
        title: 'shift-movement-hidden',
        icon: 'shift-movement-hidden',
        htmlContainer: 'shift-movement-html',
        actions: 'shift-movement-actions',
        confirmButton: 'shift-movement-confirm',
        closeButton: 'shift-movement-close'
      },
      didOpen: (popup) => {
        bindShell(popup);
        loadInitial(popup);
      }
    });
  }

  function buildShellHtml() {
    return `
      <article class="shift-movement">
        <header class="shift-movement__header">
          <div>
            <small>VEHICLE MOVEMENT</small>
            <h2>การเคลื่อนไหวรถ/ตู้</h2>
            <p>เลือกช่วงข้อมูลที่ต้องการตรวจสอบ</p>
          </div>

          <span id="shiftMovementModuleName">
            กำลังโหลด...
          </span>
        </header>

        <nav class="shift-movement__tabs">
          <button
            type="button"
            class="is-active"
            data-shift-scope="ROLLING_4H"
          >
            4 ชั่วโมงล่าสุด
          </button>

          <button
            type="button"
            data-shift-scope="TODAY"
          >
            วันนี้
          </button>

          <button
            type="button"
            data-shift-scope="CURRENT_SHIFT"
            data-shift-required
          >
            กะปัจจุบัน
          </button>

          <button
            type="button"
            data-shift-scope="SHIFT"
            data-shift-required
          >
            เลือกกะ
          </button>
        </nav>

        <section
          class="shift-movement__selector"
          data-shift-selector
          hidden
        >
          <label>
            <span>วันที่ปฏิบัติงาน</span>
            <input
              type="date"
              id="shiftMovementDate"
              value="${escapeHtml(state.selectedDate)}"
            >
          </label>

          <label>
            <span>กะ</span>
            <select id="shiftMovementCode">
              <option value="">กำลังโหลด...</option>
            </select>
          </label>

          <button
            type="button"
            id="shiftMovementApply"
          >
            แสดงข้อมูล
          </button>
        </section>

        <section
          id="shiftMovementContent"
          class="shift-movement__content"
        >
          ${loadingHtml()}
        </section>
      </article>
    `;
  }

  async function loadInitial(popup) {
    try {
      state.config =
        await window.VehicleAPI.getShiftConfig(
          state.moduleId
        );

      renderConfig(popup);

      state.activeScope =
        state.config &&
        state.config.enabled
          ? 'CURRENT_SHIFT'
          : 'ROLLING_4H';

      activateScopeButton(
        popup,
        state.activeScope
      );

      await loadScope(popup);
    } catch (error) {
      renderError(popup, error);
    }
  }

  function bindShell(popup) {
    popup
      .querySelectorAll('[data-shift-scope]')
      .forEach((button) => {
        button.addEventListener(
          'click',
          async () => {
            if (button.disabled) {
              return;
            }

            state.activeScope =
              button.dataset.shiftScope;

            activateScopeButton(
              popup,
              state.activeScope
            );

            const selector =
              popup.querySelector(
                '[data-shift-selector]'
              );

            selector.hidden =
              state.activeScope !== 'SHIFT';

            if (
              state.activeScope !== 'SHIFT'
            ) {
              await loadScope(popup);
            }
          }
        );
      });

    popup
      .querySelector('#shiftMovementApply')
      ?.addEventListener(
        'click',
        async () => {
          state.selectedDate =
            popup.querySelector(
              '#shiftMovementDate'
            )?.value || todayIso();

          state.selectedShift =
            popup.querySelector(
              '#shiftMovementCode'
            )?.value || '';

          await loadScope(popup);
        }
      );
  }

  function renderConfig(popup) {
    const config = state.config || {};

    const name =
      popup.querySelector(
        '#shiftMovementModuleName'
      );

    if (name) {
      name.textContent =
        config.enabled
          ? `ระบบกะ: เปิด · ${config.version || '-'}`
          : 'ระบบกะ: ปิด';
    }

    popup
      .querySelectorAll('[data-shift-required]')
      .forEach((button) => {
        button.disabled =
          config.enabled !== true;
        button.hidden =
          config.enabled !== true;
      });

    const select =
      popup.querySelector(
        '#shiftMovementCode'
      );

    const shifts =
      Array.isArray(config.shifts)
        ? config.shifts.filter(
            (item) => item.active !== false
          )
        : [];

    if (select) {
      select.innerHTML =
        shifts.map((item) => `
          <option value="${escapeHtml(item.code)}">
            ${escapeHtml(item.name)}
            ${escapeHtml(item.start)}–${escapeHtml(item.end)}
          </option>
        `).join('');
    }

    state.selectedShift =
      shifts[0]
        ? shifts[0].code
        : '';
  }

  function activateScopeButton(
    popup,
    scope
  ) {
    popup
      .querySelectorAll('[data-shift-scope]')
      .forEach((button) => {
        button.classList.toggle(
          'is-active',
          button.dataset.shiftScope === scope
        );
      });
  }

  async function loadScope(popup) {
    const token = ++state.requestToken;

    const content =
      popup.querySelector(
        '#shiftMovementContent'
      );

    if (!content) {
      return;
    }

    content.innerHTML = loadingHtml();

    try {
      const data =
        await window.VehicleAPI.getMovementScope(
          state.moduleId,
          {
            scope: state.activeScope,
            date: state.selectedDate,
            shift: state.selectedShift
          }
        );

      if (token !== state.requestToken) {
        return;
      }

      content.innerHTML =
        renderScopeHtml(data);
    } catch (error) {
      if (token !== state.requestToken) {
        return;
      }

      renderError(popup, error);
    }
  }

  function renderScopeHtml(data) {
    const metric = data?.metrics || {};
    const range = data?.range || {};
    const hours = Array.isArray(data?.hours)
      ? data.hours
      : [];

    const title =
      range.shiftCode
        ? `${range.shiftName || 'กะ'} (${range.shiftCode})`
        : scopeLabel(data?.scope);

    return `
      <section class="shift-movement__scope-head">
        <div>
          <small>${escapeHtml(title)}</small>

          <strong>
            ${escapeHtml(range.startAt || '-')}
            –
            ${escapeHtml(
              range.effectiveEndAt ||
              range.endAt ||
              '-'
            )}
          </strong>
        </div>

        <span class="${
          range.completed
            ? 'is-complete'
            : 'is-live'
        }">
          ${
            range.completed
              ? 'จบช่วงแล้ว'
              : 'กำลังดำเนินการ'
          }
        </span>
      </section>

      <section class="shift-movement__metrics">
        ${metricHtml(
          'คงค้างต้นช่วง',
          metric.openingBalance
        )}

        ${metricHtml(
          'Gate In',
          metric.gateIn
        )}

        ${metricHtml(
          'Gate Out จริง',
          metric.gateOutActual
        )}

        ${metricHtml(
          'Auto Close',
          metric.autoClose
        )}

        ${metricHtml(
          'คงค้างท้ายช่วง',
          metric.closingBalance
        )}

        ${metricHtml(
          'เกิน SLA ปลายช่วง',
          metric.overdueAtEnd,
          'is-danger'
        )}
      </section>

      <section class="shift-movement__performance">
        ${performanceHtml(
          'SLA ผ่านเกณฑ์',
          percent(metric.slaCompliancePercent)
        )}

        ${performanceHtml(
          'เวลาเฉลี่ย',
          minutes(metric.averageDwellMinutes)
        )}

        ${performanceHtml(
          'P90',
          minutes(metric.p90DwellMinutes)
        )}

        ${performanceHtml(
          'เวลานานที่สุด',
          minutes(metric.maxDwellMinutes)
        )}

        ${performanceHtml(
          'Peak Active',
          number(metric.peakActive)
        )}

        ${performanceHtml(
          'คุณภาพข้อมูล',
          percent(metric.dataCompletenessPercent)
        )}
      </section>

      <section class="shift-movement__chart">
        <header>
          <strong>การเคลื่อนไหวรายชั่วโมง</strong>
          <span>${hours.length} ช่วง</span>
        </header>

        <div class="shift-movement__chart-body">
          ${
            hours.length
              ? hours.map(hourHtml).join('')
              : `
                  <div class="shift-movement__empty">
                    ยังไม่มีข้อมูลรายชั่วโมง
                  </div>
                `
          }
        </div>
      </section>
    `;
  }

  function hourHtml(hour) {
    const maximum = Math.max(
      1,
      Number(hour.gateIn) || 0,
      Number(hour.gateOutActual) || 0,
      Number(hour.activeAtEnd) || 0
    );

    return `
      <div class="shift-hour-row">
        <strong>
          ${escapeHtml(hour.label || '-')}
        </strong>

        <div class="shift-hour-bars">
          <span>
            <small>เข้า</small>

            <i
              style="width:${barWidth(
                hour.gateIn,
                maximum
              )}%"
            ></i>

            <b>${number(hour.gateIn)}</b>
          </span>

          <span>
            <small>ออก</small>

            <i
              style="width:${barWidth(
                hour.gateOutActual,
                maximum
              )}%"
            ></i>

            <b>${number(hour.gateOutActual)}</b>
          </span>
        </div>

        <em>
          คงค้าง ${number(hour.activeAtEnd)}
        </em>
      </div>
    `;
  }

  function metricHtml(
    label,
    value,
    className
  ) {
    return `
      <div class="${className || ''}">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(number(value))}</strong>
      </div>
    `;
  }

  function performanceHtml(
    label,
    value
  ) {
    return `
      <div>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `;
  }

  function renderError(popup, error) {
    const content =
      popup.querySelector(
        '#shiftMovementContent'
      );

    if (content) {
      content.innerHTML = `
        <div class="shift-movement__error">
          <strong>ไม่สามารถโหลดข้อมูลได้</strong>

          <span>
            ${escapeHtml(
              error?.message ||
              'เกิดข้อผิดพลาด'
            )}
          </span>
        </div>
      `;
    }
  }

  function loadingHtml() {
    return `
      <div class="shift-movement__loading">
        <span></span>
        <strong>กำลังคำนวณข้อมูล...</strong>
      </div>
    `;
  }

  function scopeLabel(scope) {
    const map = {
      ROLLING_4H: '4 ชั่วโมงล่าสุด',
      TODAY: 'วันนี้',
      CURRENT_SHIFT: 'กะปัจจุบัน',
      SHIFT: 'กะที่เลือก',
      BUSINESS_DAY: 'วันปฏิบัติงาน'
    };

    return map[String(scope || '').toUpperCase()]
      || 'การเคลื่อนไหว';
  }

  function todayIso() {
    const now = new Date();

    return [
      now.getFullYear(),
      String(now.getMonth() + 1)
        .padStart(2, '0'),
      String(now.getDate())
        .padStart(2, '0')
    ].join('-');
  }

  function barWidth(value, maximum) {
    return Math.max(
      0,
      Math.min(
        100,
        (Number(value) || 0) /
          maximum *
          100
      )
    );
  }

  function number(value) {
    const numeric = Number(value);

    return Number.isFinite(numeric)
      ? new Intl.NumberFormat(
          'th-TH',
          {
            maximumFractionDigits: 2
          }
        ).format(numeric)
      : String(value ?? '-');
  }

  function percent(value) {
    return `${number(value)}%`;
  }

  function minutes(value) {
    return `${number(value)} นาที`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  window.ModuleShiftUI = {
    open
  };

})(window, document);
