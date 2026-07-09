/**
 * shift-admin.js
 * ROUND 56 — Standalone Shift Admin
 */
(function (window, document) {
  'use strict';

  const state = {
    modules: [],
    moduleId: '',
    shifts: []
  };

  document.addEventListener(
    'DOMContentLoaded',
    initialize
  );

  async function initialize() {
    try {
      const me =
        await window.VehicleAPI.me();

      const user =
        me?.user || me || {};

      if (
        String(user.role || '')
          .toUpperCase() !== 'ADMIN'
      ) {
        throw new Error(
          'หน้านี้ใช้ได้เฉพาะผู้ดูแลระบบ'
        );
      }

      document.getElementById(
        'shiftAdminUser'
      ).textContent =
        user.displayName ||
        user.username ||
        'ADMIN';

      document.getElementById(
        'shiftAdminEffective'
      ).value = todayIso();

      bindEvents();
      await loadModules();

    } catch (error) {
      showError(error);
    }
  }

  function bindEvents() {
    document.getElementById(
      'shiftAdminModule'
    ).addEventListener(
      'change',
      async (event) => {
        state.moduleId =
          event.target.value;

        await loadConfig();
        await loadStatistics();
      }
    );

    document.getElementById(
      'shiftAdminAddShift'
    ).addEventListener(
      'click',
      () => {
        if (
          state.shifts.length >= 4
        ) {
          showError(
            new Error(
              'กำหนดได้ไม่เกิน 4 กะ'
            )
          );

          return;
        }

        state.shifts.push({
          code:
            String.fromCharCode(
              65 + state.shifts.length
            ),
          name: 'กะใหม่',
          start: '00:00',
          end: '00:00',
          active: true
        });

        renderRows();
      }
    );

    document.getElementById(
      'shiftAdminSave'
    ).addEventListener(
      'click',
      saveConfig
    );

    document.getElementById(
      'shiftAdminSetup'
    ).addEventListener(
      'click',
      setupSystem
    );

    document.getElementById(
      'shiftAdminRunSnapshot'
    ).addEventListener(
      'click',
      runSnapshot
    );

    document.getElementById(
      'shiftAdminRefreshStats'
    ).addEventListener(
      'click',
      loadStatistics
    );
  }

  async function loadModules() {
    const data =
      await window.VehicleAPI.getModules();

    state.modules =
      Array.isArray(data)
        ? data
        : Array.isArray(data?.modules)
          ? data.modules
          : [];

    const select =
      document.getElementById(
        'shiftAdminModule'
      );

    select.innerHTML =
      state.modules.map((module) => `
        <option
          value="${escapeHtml(
            module.moduleId ||
            module.id
          )}"
        >
          ${escapeHtml(
            module.name ||
            module.moduleName ||
            module.moduleId
          )}
        </option>
      `).join('');

    state.moduleId =
      select.value || '';

    if (state.moduleId) {
      await loadConfig();
      await loadStatistics();
    }
  }

  async function loadConfig() {
    if (!state.moduleId) {
      return;
    }

    const config =
      await window.VehicleAPI
        .getAdminShiftConfig(
          state.moduleId
        );

    document.getElementById(
      'shiftAdminEnabled'
    ).checked =
      config.enabled === true;

    document.getElementById(
      'shiftAdminTimezone'
    ).value =
      config.timezone ||
      'Asia/Bangkok';

    document.getElementById(
      'shiftAdminBusinessStart'
    ).value =
      config.businessDayStart ||
      '06:00';

    state.shifts =
      Array.isArray(config.shifts)
        ? config.shifts.map(
            (shift) => ({
              code: shift.code,
              name: shift.name,
              start: shift.start,
              end: shift.end,
              active:
                shift.active !== false
            })
          )
        : [];

    renderRows();
  }

  function renderRows() {
    const container =
      document.getElementById(
        'shiftAdminRows'
      );

    container.innerHTML =
      state.shifts.map(
        (shift, index) => `
          <div
            class="shift-admin-row"
            data-shift-index="${index}"
          >
            <label>
              <span>รหัสกะ</span>

              <input
                data-field="code"
                value="${escapeHtml(
                  shift.code
                )}"
                maxlength="8"
              >
            </label>

            <label>
              <span>ชื่อกะ</span>

              <input
                data-field="name"
                value="${escapeHtml(
                  shift.name
                )}"
              >
            </label>

            <label>
              <span>เริ่ม</span>

              <input
                data-field="start"
                type="time"
                value="${escapeHtml(
                  shift.start
                )}"
              >
            </label>

            <label>
              <span>สิ้นสุด</span>

              <input
                data-field="end"
                type="time"
                value="${escapeHtml(
                  shift.end
                )}"
              >
            </label>

            <label class="shift-admin-active">
              <input
                data-field="active"
                type="checkbox"
                ${
                  shift.active
                    ? 'checked'
                    : ''
                }
              >

              <span>ใช้งาน</span>
            </label>

            <button
              type="button"
              data-remove-shift="${index}"
              ${
                state.shifts.length <= 2
                  ? 'disabled'
                  : ''
              }
            >
              ลบ
            </button>
          </div>
        `
      ).join('');

    container
      .querySelectorAll('[data-field]')
      .forEach((input) => {
        input.addEventListener(
          'input',
          syncRows
        );

        input.addEventListener(
          'change',
          syncRows
        );
      });

    container
      .querySelectorAll('[data-remove-shift]')
      .forEach((button) => {
        button.addEventListener(
          'click',
          () => {
            state.shifts.splice(
              Number(
                button.dataset.removeShift
              ),
              1
            );

            renderRows();
          }
        );
      });

    updateCoverage();
  }

  function syncRows() {
    document
      .querySelectorAll('.shift-admin-row')
      .forEach((row) => {
        const item =
          state.shifts[
            Number(row.dataset.shiftIndex)
          ];

        if (!item) {
          return;
        }

        row
          .querySelectorAll('[data-field]')
          .forEach((input) => {
            item[input.dataset.field] =
              input.type === 'checkbox'
                ? input.checked
                : input.value;
          });
      });

    updateCoverage();
  }

  function updateCoverage() {
    const occupied = new Set();

    state.shifts
      .filter((shift) => shift.active)
      .forEach((shift) => {
        const start =
          timeMinutes(shift.start);

        const end =
          timeMinutes(shift.end);

        let cursor = start;
        let count = 0;

        while (
          cursor !== end &&
          count < 1440
        ) {
          occupied.add(cursor);
          cursor = (cursor + 1) % 1440;
          count += 1;
        }
      });

    const element =
      document.getElementById(
        'shiftAdminCoverage'
      );

    element.textContent =
      `รวมช่วงเวลา ${(
        occupied.size / 60
      ).toFixed(1)} ชั่วโมง`;

    element.classList.toggle(
      'is-warning',
      occupied.size !== 1440
    );
  }

  async function saveConfig() {
    try {
      syncRows();

      const result =
        await window.VehicleAPI
          .saveAdminShiftConfig(
            state.moduleId,
            {
              config: {
                enabled:
                  document.getElementById(
                    'shiftAdminEnabled'
                  ).checked,

                timezone:
                  document.getElementById(
                    'shiftAdminTimezone'
                  ).value,

                businessDayStart:
                  document.getElementById(
                    'shiftAdminBusinessStart'
                  ).value,

                effectiveFrom:
                  document.getElementById(
                    'shiftAdminEffective'
                  ).value,

                shifts:
                  state.shifts.map(
                    (shift, index) => ({
                      ...shift,
                      order: index + 1
                    })
                  )
              }
            }
          );

      await window.Swal.fire({
        icon: 'success',
        title: 'บันทึกสำเร็จ',
        text:
          result.warning ||
          `เวอร์ชัน ${result.version}`,
        confirmButtonText: 'รับทราบ'
      });

      await loadConfig();

    } catch (error) {
      showError(error);
    }
  }

  async function setupSystem() {
    try {
      const result =
        await window.VehicleAPI
          .setupAdminShiftSystem();

      await window.Swal.fire({
        icon: 'success',
        title: 'เตรียมระบบกะสำเร็จ',
        text:
          `สร้าง/ตรวจสอบ ${
            result.sheets?.length || 0
          } ชีท`,
        confirmButtonText: 'รับทราบ'
      });

    } catch (error) {
      showError(error);
    }
  }

  async function runSnapshot() {
    try {
      const result =
        await window.VehicleAPI
          .runAdminShiftSnapshots({
            moduleId: state.moduleId
          });

      await window.Swal.fire({
        icon:
          result.success
            ? 'success'
            : 'warning',

        title:
          'ประมวลผล Snapshot แล้ว',

        html: `
          <div>
            สรุปกะ
            <strong>
              ${result.shiftSnapshots || 0}
            </strong>
            รายการ<br>

            สรุปรายวัน
            <strong>
              ${result.dailySnapshots || 0}
            </strong>
            รายการ<br>

            รายชั่วโมง
            <strong>
              ${result.hourlyRows || 0}
            </strong>
            แถว
          </div>
        `,

        confirmButtonText:
          'รับทราบ'
      });

      await loadStatistics();

    } catch (error) {
      showError(error);
    }
  }

  async function loadStatistics() {
    if (!state.moduleId) {
      return;
    }

    const data =
      await window.VehicleAPI
        .getAdminShiftStatistics({
          moduleId: state.moduleId,
          limit: 50
        });

    const rows =
      Array.isArray(data.shiftSummaries)
        ? data.shiftSummaries
        : [];

    const body =
      document.getElementById(
        'shiftAdminStatsBody'
      );

    body.innerHTML =
      rows.length
        ? rows.map((row) => `
            <tr>
              <td>${escapeHtml(
                display(row.BusinessDate)
              )}</td>

              <td>${escapeHtml(
                row.ShiftCode || '-'
              )}</td>

              <td>${escapeHtml(
                row.GateIn
              )}</td>

              <td>${escapeHtml(
                row.GateOutActual
              )}</td>

              <td>${escapeHtml(
                row.ClosingBalance
              )}</td>

              <td>${escapeHtml(
                row.SLACompliancePercent
              )}%</td>

              <td>
                ${escapeHtml(
                  row.AverageDwellMinutes
                )}
                นาที
              </td>

              <td>${escapeHtml(
                row.SnapshotStatus || '-'
              )}</td>
            </tr>
          `).join('')
        : `
            <tr>
              <td colspan="8">
                ยังไม่มีข้อมูล Snapshot
              </td>
            </tr>
          `;
  }

  function timeMinutes(value) {
    const parts =
      String(value || '00:00')
        .split(':');

    return (
      Number(parts[0]) * 60 +
      Number(parts[1])
    );
  }

  function todayIso() {
    const date = new Date();

    return [
      date.getFullYear(),
      String(date.getMonth() + 1)
        .padStart(2, '0'),
      String(date.getDate())
        .padStart(2, '0')
    ].join('-');
  }

  function display(value) {
    return String(value ?? '');
  }

  function showError(error) {
    window.Swal.fire({
      icon: 'error',
      title: 'เกิดข้อผิดพลาด',
      text:
        error?.message ||
        'ไม่สามารถดำเนินการได้',
      confirmButtonText: 'รับทราบ'
    });
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

})(window, document);
