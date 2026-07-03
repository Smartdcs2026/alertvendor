/**
 * admin-shift-panel.js
 * ROUND 58 — Integrated Shift Management in admin.html
 */
(function (window, document) {
  'use strict';

  const state = {
    initialized:
      false,

    initializing:
      false,

    moduleId:
      '',

    modules:
      [],

    config:
      null,

    shifts:
      [],

    statistics:
      [],

    requestToken:
      0
  };


  document.addEventListener(
    'DOMContentLoaded',
    initialize
  );


  function initialize() {
    bindStaticEvents();
    observeShiftPanelVisibility();

    const requestedTab =
      new URLSearchParams(
        window.location.search
      ).get(
        'tab'
      );

    if (
      requestedTab ===
        'shifts' ||
      window.location.hash ===
        '#shifts'
    ) {
      window.setTimeout(
        function () {
          document
            .querySelector(
              '[data-admin-tab="shifts"]'
            )
            ?.click();
        },
        350
      );
    }
  }


  function bindStaticEvents() {
    document
      .querySelector(
        '[data-admin-tab="shifts"]'
      )
      ?.addEventListener(
        'click',
        function () {
          updateLocation();

          ensureInitialized();
        }
      );

    byId(
      'adminShiftModuleSelect'
    )?.addEventListener(
      'change',
      async function (event) {
        state.moduleId =
          String(
            event.target.value ||
            ''
          ).trim();

        await loadModuleData();
      }
    );

    byId(
      'adminShiftReloadButton'
    )?.addEventListener(
      'click',
      loadModuleData
    );

    byId(
      'adminShiftAddButton'
    )?.addEventListener(
      'click',
      addShift
    );

    byId(
      'adminShiftSaveButton'
    )?.addEventListener(
      'click',
      saveConfiguration
    );

    byId(
      'adminShiftSetupButton'
    )?.addEventListener(
      'click',
      setupShiftSystem
    );

    byId(
      'adminShiftSnapshotButton'
    )?.addEventListener(
      'click',
      runSnapshot
    );

    byId(
      'adminShiftStatsRefreshButton'
    )?.addEventListener(
      'click',
      loadStatistics
    );

    byId(
      'adminShiftRows'
    )?.addEventListener(
      'input',
      handleShiftRowsChange
    );

    byId(
      'adminShiftRows'
    )?.addEventListener(
      'change',
      handleShiftRowsChange
    );

    byId(
      'adminShiftRows'
    )?.addEventListener(
      'click',
      handleShiftRowsClick
    );

    byId(
      'adminShiftMessageRetry'
    )?.addEventListener(
      'click',
      function () {
        state.initialized =
          false;

        state.initializing =
          false;

        ensureInitialized();
      }
    );
  }


  async function ensureInitialized() {
    if (
      state.initialized ||
      state.initializing
    ) {
      return;
    }

    state.initializing =
      true;

    showPanelMessage(
      'กำลังเตรียมข้อมูล Module จากหน้า Admin',
      'LOADING',
      false
    );

    try {
      await waitForAdminReady();

      assertApi();

      await loadModules();

      state.initialized =
        true;

      hidePanelMessage();

    } catch (error) {
      showPanelMessage(
        errorMessage(
          error
        ),
        'ERROR',
        true
      );

      renderModuleLoadFailure(
        error
      );

      await showError(
        error,
        'โหลดระบบกะไม่สำเร็จ'
      );

    } finally {
      state.initializing =
        false;

      setButtonLoading(
        byId(
          'adminShiftReloadButton'
        ),
        false
      );
    }
  }

  function assertApi() {
    const API =
      window.VehicleAPI;

    if (!API) {
      throw new Error(
        'ไม่พบ VehicleAPI กรุณาตรวจสอบไฟล์ api.js'
      );
    }

    const shiftMethods = [
      'getAdminShiftConfig',
      'saveAdminShiftConfig',
      'setupAdminShiftSystem',
      'runAdminShiftSnapshots',
      'getAdminShiftStatistics'
    ];

    const missing =
      shiftMethods.filter(
        function (method) {
          return (
            typeof API[method] !==
              'function'
          );
        }
      );

    if (missing.length) {
      throw new Error(
        'api.js ยังขาดฟังก์ชันระบบกะ: ' +
        missing.join(', ')
      );
    }

    if (
      typeof API.getAdminDashboard !==
        'function' &&
      typeof API.getModules !==
        'function'
    ) {
      throw new Error(
        'ไม่พบฟังก์ชันสำหรับอ่านรายการ Module'
      );
    }
  }

  async function loadModules() {
    const reloadButton =
      byId(
        'adminShiftReloadButton'
      );

    setButtonLoading(
      reloadButton,
      true,
      'กำลังโหลด'
    );

    const select =
      byId(
        'adminShiftModuleSelect'
      );

    try {
      if (select) {
        select.innerHTML = `
          <option value="">
            กำลังอ่าน Module จากหน้า Admin...
          </option>
        `;
      }

      let modules =
        readModulesFromAdminPage();

      if (!modules.length) {
        modules =
          await loadModulesFromAdminApi();
      }

      if (!modules.length) {
        modules =
          await loadModulesFromPublicApi();
      }

      state.modules =
        normalizeModules(
          modules
        );

      if (!select) {
        return;
      }

      if (!state.modules.length) {
        select.innerHTML = `
          <option value="">
            ไม่พบ Module
          </option>
        `;

        throw new Error(
          'หน้า Admin ไม่พบรายการ Module ที่สามารถตั้งค่ากะได้'
        );
      }

      select.innerHTML =
        state.modules
          .map(
            function (module) {
              return `
                <option
                  value="${escapeHtml(
                    module.moduleId
                  )}"
                >
                  ${escapeHtml(
                    module.name
                  )}
                  (${escapeHtml(
                    module.moduleId
                  )})
                </option>
              `;
            }
          )
          .join('');

      state.moduleId =
        state.moduleId &&
        state.modules.some(
          function (module) {
            return (
              module.moduleId ===
              state.moduleId
            );
          }
        )
          ? state.moduleId
          : state.modules[0]
              .moduleId;

      select.value =
        state.moduleId;

      showPanelMessage(
        'พบ ' +
        state.modules.length +
        ' Module กำลังโหลดการตั้งค่ากะ',
        'LOADING',
        false
      );

      await withTimeout(
        loadModuleData(),
        30000,
        'โหลดการตั้งค่ากะใช้เวลานานเกินกำหนด'
      );

    } finally {
      setButtonLoading(
        reloadButton,
        false
      );
    }
  }


  function readModulesFromAdminPage() {
    const cards =
      Array.from(
        document.querySelectorAll(
          '#adminModuleList .admin-module-card[data-module-id]'
        )
      );

    return cards
      .map(
        function (card) {
          const moduleId =
            String(
              card.dataset
                .moduleId ||
              ''
            ).trim();

          const name =
            String(
              card.querySelector(
                'h3'
              )?.textContent ||
              moduleId
            ).trim();

          return {
            moduleId:
              moduleId,

            name:
              name
          };
        }
      )
      .filter(
        function (module) {
          return module.moduleId;
        }
      );
  }


  async function loadModulesFromAdminApi() {
    const API =
      window.VehicleAPI;

    if (
      typeof API.getAdminDashboard !==
      'function'
    ) {
      return [];
    }

    try {
      const dashboard =
        await withTimeout(
          API.getAdminDashboard({
            auditLimit:
              1
          }),
          20000,
          'Admin Dashboard ไม่ตอบกลับ'
        );

      return Array.isArray(
        dashboard &&
        dashboard.modules
      )
        ? dashboard.modules
        : [];

    } catch (error) {
      console.warn(
        '[Shift Admin] getAdminDashboard failed',
        error
      );

      return [];
    }
  }


  async function loadModulesFromPublicApi() {
    const API =
      window.VehicleAPI;

    if (
      typeof API.getModules !==
      'function'
    ) {
      return [];
    }

    try {
      const data =
        await withTimeout(
          API.getModules(),
          15000,
          'รายการ Module ไม่ตอบกลับ'
        );

      return Array.isArray(data)
        ? data
        : Array.isArray(
            data &&
            data.modules
          )
          ? data.modules
          : [];

    } catch (error) {
      console.warn(
        '[Shift Admin] getModules failed',
        error
      );

      return [];
    }
  }


  function normalizeModules(
    modules
  ) {
    const map =
      new Map();

    (
      Array.isArray(modules)
        ? modules
        : []
    ).forEach(
      function (module) {
        if (!module) {
          return;
        }

        const moduleId =
          String(
            module.moduleId ||
            module.id ||
            ''
          ).trim();

        if (!moduleId) {
          return;
        }

        if (
          !map.has(
            moduleId
          )
        ) {
          map.set(
            moduleId,
            {
              moduleId:
                moduleId,

              name:
                String(
                  module.name ||
                  module.moduleName ||
                  moduleId
                ).trim()
            }
          );
        }
      }
    );

    return Array.from(
      map.values()
    );
  }

  async function loadModuleData() {
    if (!state.moduleId) {
      return;
    }

    const token =
      ++state.requestToken;

    setConfigLoading(
      true
    );

    try {
      const results =
        await Promise.all([
          withTimeout(
            window.VehicleAPI
              .getAdminShiftConfig(
                state.moduleId
              ),
            25000,
            'โหลดการตั้งค่ากะไม่สำเร็จภายในเวลาที่กำหนด'
          ),

          withTimeout(
            window.VehicleAPI
              .getAdminShiftStatistics({
                moduleId:
                  state.moduleId,

                limit:
                  50
              }),
            25000,
            'โหลดสถิติกะไม่สำเร็จภายในเวลาที่กำหนด'
          )
        ]);

      if (
        token !==
        state.requestToken
      ) {
        return;
      }

      state.config =
        results[0] ||
        {};

      state.shifts =
        Array.isArray(
          state.config.shifts
        )
          ? state.config.shifts.map(
              function (shift) {
                return {
                  code:
                    String(
                      shift.code ||
                      ''
                    ),

                  name:
                    String(
                      shift.name ||
                      ''
                    ),

                  start:
                    String(
                      shift.start ||
                      '00:00'
                    ),

                  end:
                    String(
                      shift.end ||
                      '00:00'
                    ),

                  active:
                    shift.active !==
                      false
                };
              }
            )
          : defaultShifts();

      state.statistics =
        Array.isArray(
          results[1] &&
          results[1]
            .shiftSummaries
        )
          ? results[1]
              .shiftSummaries
          : [];

      renderConfiguration();
      renderStatistics();

      hidePanelMessage();

    } catch (error) {
      showPanelMessage(
        errorMessage(
          error
        ),
        'ERROR'
      );

      await showError(
        error,
        'โหลดข้อมูลกะไม่สำเร็จ'
      );

    } finally {
      if (
        token ===
        state.requestToken
      ) {
        setConfigLoading(
          false
        );
      }
    }
  }


  function renderConfiguration() {
    const config =
      state.config ||
      {};

    const enabled =
      config.enabled ===
      true;

    setChecked(
      'adminShiftEnabled',
      enabled
    );

    setValue(
      'adminShiftTimezone',
      config.timezone ||
      'Asia/Bangkok'
    );

    setValue(
      'adminShiftBusinessStart',
      config.businessDayStart ||
      '06:00'
    );

    setValue(
      'adminShiftEffectiveDate',
      dateToIso(
        config.effectiveFrom
      ) ||
      todayIso()
    );

    setText(
      'adminShiftVersion',
      config.version ||
      'DEFAULT'
    );

    setText(
      'adminShiftUpdatedAt',
      [
        config.updatedAt ||
          '-',

        config.updatedBy
          ? 'โดย ' +
            config.updatedBy
          : ''
      ]
        .filter(Boolean)
        .join(' ')
    );

    const status =
      byId(
        'adminShiftStatusBadge'
      );

    if (status) {
      status.textContent =
        enabled
          ? 'เปิดใช้งาน'
          : 'ปิดใช้งาน';

      status.dataset.status =
        enabled
          ? 'ENABLED'
          : 'DISABLED';
    }

    renderShiftRows();
  }


  function renderShiftRows() {
    const container =
      byId(
        'adminShiftRows'
      );

    if (!container) {
      return;
    }

    if (!state.shifts.length) {
      state.shifts =
        defaultShifts();
    }

    container.innerHTML =
      state.shifts
        .map(
          function (
            shift,
            index
          ) {
            return `
              <div
                class="admin-shift-row"
                data-shift-index="${index}"
              >
                <label class="admin-field">
                  <span>
                    รหัสกะ
                  </span>

                  <input
                    type="text"
                    maxlength="8"
                    data-shift-field="code"
                    value="${escapeHtml(
                      shift.code
                    )}"
                  >
                </label>

                <label class="admin-field">
                  <span>
                    ชื่อกะ
                  </span>

                  <input
                    type="text"
                    maxlength="60"
                    data-shift-field="name"
                    value="${escapeHtml(
                      shift.name
                    )}"
                  >
                </label>

                <label class="admin-field">
                  <span>
                    เวลาเริ่ม
                  </span>

                  <input
                    type="time"
                    data-shift-field="start"
                    value="${escapeHtml(
                      shift.start
                    )}"
                  >
                </label>

                <label class="admin-field">
                  <span>
                    เวลาสิ้นสุด
                  </span>

                  <input
                    type="time"
                    data-shift-field="end"
                    value="${escapeHtml(
                      shift.end
                    )}"
                  >
                </label>

                <label class="admin-shift-active-toggle">
                  <input
                    type="checkbox"
                    data-shift-field="active"
                    ${
                      shift.active
                        ? 'checked'
                        : ''
                    }
                  >

                  <span>
                    ใช้งาน
                  </span>
                </label>

                <button
                  class="admin-shift-remove"
                  type="button"
                  data-remove-shift="${index}"
                  ${
                    state.shifts.length <=
                    2
                      ? 'disabled'
                      : ''
                  }
                >
                  ลบ
                </button>
              </div>
            `;
          }
        )
        .join('');

    updateValidation();
  }


  function handleShiftRowsChange(
    event
  ) {
    const input =
      event.target.closest(
        '[data-shift-field]'
      );

    if (!input) {
      return;
    }

    const row =
      input.closest(
        '[data-shift-index]'
      );

    const index =
      Number(
        row &&
        row.dataset
          .shiftIndex
      );

    const shift =
      state.shifts[index];

    if (!shift) {
      return;
    }

    const field =
      input.dataset
        .shiftField;

    shift[field] =
      input.type ===
        'checkbox'
        ? input.checked
        : input.value;

    updateValidation();
  }


  function handleShiftRowsClick(
    event
  ) {
    const button =
      event.target.closest(
        '[data-remove-shift]'
      );

    if (!button) {
      return;
    }

    const index =
      Number(
        button.dataset
          .removeShift
      );

    if (
      state.shifts.length <=
      2
    ) {
      return;
    }

    state.shifts.splice(
      index,
      1
    );

    renderShiftRows();
  }


  function addShift() {
    if (
      state.shifts.length >=
      4
    ) {
      showError(
        new Error(
          'กำหนดได้ไม่เกิน 4 กะ'
        ),
        'ไม่สามารถเพิ่มกะได้'
      );

      return;
    }

    const usedCodes =
      new Set(
        state.shifts.map(
          function (shift) {
            return String(
              shift.code ||
              ''
            ).toUpperCase();
          }
        )
      );

    const code =
      [
        'A',
        'B',
        'C',
        'D'
      ].find(
        function (item) {
          return !usedCodes.has(
            item
          );
        }
      ) ||
      'S' +
      (
        state.shifts.length +
        1
      );

    state.shifts.push({
      code:
        code,

      name:
        'กะ ' +
        code,

      start:
        '00:00',

      end:
        '00:00',

      active:
        true
    });

    renderShiftRows();
  }


  function updateValidation() {
    const result =
      validateShifts(
        state.shifts
      );

    setText(
      'adminShiftCoverage',
      result.coverageHours
        .toFixed(1) +
      ' ชั่วโมง' +
      (
        result.coverageMinutes ===
          1440
          ? ' · ครบ 24 ชั่วโมง'
          : ' · ยังไม่ครบ 24 ชั่วโมง'
      )
    );

    const element =
      byId(
        'adminShiftValidationStatus'
      );

    if (element) {
      element.textContent =
        result.message;

      element.dataset.status =
        result.valid
          ? (
              result.coverageMinutes ===
                1440
                ? 'VALID'
                : 'WARNING'
            )
          : 'ERROR';
    }

    const hint =
      byId(
        'adminShiftSaveHint'
      );

    if (hint) {
      hint.textContent =
        result.valid
          ? (
              result.coverageMinutes ===
                1440
                ? 'ช่วงกะต่อเนื่องครบ 24 ชั่วโมง พร้อมบันทึก'
                : 'บันทึกได้ แต่มีช่วงเวลาที่ไม่ถูกกำหนดเป็นกะ'
            )
          : result.message;
    }

    return result;
  }


  function validateShifts(
    shifts
  ) {
    const active =
      shifts.filter(
        function (shift) {
          return shift.active;
        }
      );

    if (
      shifts.length < 2 ||
      shifts.length > 4
    ) {
      return invalidValidation(
        'ต้องกำหนดทั้งหมด 2–4 กะ'
      );
    }

    if (
      active.length < 2
    ) {
      return invalidValidation(
        'ต้องมีกะที่เปิดใช้งานอย่างน้อย 2 กะ'
      );
    }

    const codes =
      new Set();

    for (
      let index = 0;
      index < shifts.length;
      index += 1
    ) {
      const shift =
        shifts[index];

      const code =
        String(
          shift.code ||
          ''
        )
          .trim()
          .toUpperCase();

      if (!code) {
        return invalidValidation(
          'กรุณาระบุรหัสกะให้ครบ'
        );
      }

      if (
        codes.has(
          code
        )
      ) {
        return invalidValidation(
          'รหัสกะห้ามซ้ำกัน'
        );
      }

      codes.add(code);

      if (
        !String(
          shift.name ||
          ''
        ).trim()
      ) {
        return invalidValidation(
          'กรุณาระบุชื่อกะให้ครบ'
        );
      }

      if (
        !validTime(
          shift.start
        ) ||
        !validTime(
          shift.end
        )
      ) {
        return invalidValidation(
          'เวลาเริ่มหรือเวลาสิ้นสุดไม่ถูกต้อง'
        );
      }

      if (
        shift.start ===
        shift.end
      ) {
        return invalidValidation(
          'เวลาเริ่มและเวลาสิ้นสุดกะห้ามเท่ากัน'
        );
      }
    }

    const occupied =
      new Array(
        1440
      ).fill('');

    for (
      let index = 0;
      index < active.length;
      index += 1
    ) {
      const shift =
        active[index];

      const start =
        timeMinutes(
          shift.start
        );

      const end =
        timeMinutes(
          shift.end
        );

      let cursor =
        start;

      let count =
        0;

      while (
        cursor !==
          end &&
        count <
          1440
      ) {
        if (
          occupied[cursor]
        ) {
          return invalidValidation(
            'ช่วงเวลาของกะ ' +
            shift.code +
            ' ทับกับกะ ' +
            occupied[cursor]
          );
        }

        occupied[cursor] =
          shift.code;

        cursor =
          (
            cursor +
            1
          ) %
          1440;

        count += 1;
      }
    }

    const coverageMinutes =
      occupied.filter(
        Boolean
      ).length;

    return {
      valid:
        true,

      coverageMinutes:
        coverageMinutes,

      coverageHours:
        coverageMinutes /
        60,

      message:
        coverageMinutes ===
          1440
          ? 'ช่วงเวลาไม่ทับกันและครบ 24 ชั่วโมง'
          : 'ช่วงเวลาไม่ทับกัน แต่ยังมีช่วงว่าง'
    };
  }


  function invalidValidation(
    message
  ) {
    return {
      valid:
        false,

      coverageMinutes:
        0,

      coverageHours:
        0,

      message:
        message
    };
  }


  async function saveConfiguration() {
    if (!state.moduleId) {
      return;
    }

    syncRowsFromDom();

    const validation =
      updateValidation();

    if (!validation.valid) {
      await showError(
        new Error(
          validation.message
        ),
        'ยังบันทึกไม่ได้'
      );

      return;
    }

    if (
      validation.coverageMinutes !==
      1440
    ) {
      const confirm =
        await window.Swal.fire({
          icon:
            'warning',

          title:
            'ช่วงกะยังไม่ครบ 24 ชั่วโมง',

          text:
            'ระบบจะไม่สามารถระบุกะให้ข้อมูลที่เกิดในช่วงเวลาว่างได้ ต้องการบันทึกต่อหรือไม่',

          showCancelButton:
            true,

          confirmButtonText:
            'บันทึกต่อ',

          cancelButtonText:
            'กลับไปแก้ไข',

          reverseButtons:
            true
        });

      if (!confirm.isConfirmed) {
        return;
      }
    }

    const button =
      byId(
        'adminShiftSaveButton'
      );

    setButtonLoading(
      button,
      true,
      'กำลังบันทึก'
    );

    try {
      const result =
        await window.VehicleAPI
          .saveAdminShiftConfig(
            state.moduleId,
            {
              config: {
                enabled:
                  byId(
                    'adminShiftEnabled'
                  )?.checked ===
                  true,

                timezone:
                  byId(
                    'adminShiftTimezone'
                  )?.value ||
                  'Asia/Bangkok',

                businessDayStart:
                  byId(
                    'adminShiftBusinessStart'
                  )?.value ||
                  '06:00',

                effectiveFrom:
                  byId(
                    'adminShiftEffectiveDate'
                  )?.value ||
                  todayIso(),

                shifts:
                  state.shifts.map(
                    function (
                      shift,
                      index
                    ) {
                      return {
                        code:
                          String(
                            shift.code ||
                            ''
                          )
                            .trim()
                            .toUpperCase(),

                        name:
                          String(
                            shift.name ||
                            ''
                          ).trim(),

                        start:
                          shift.start,

                        end:
                          shift.end,

                        active:
                          shift.active ===
                            true,

                        order:
                          index + 1
                      };
                    }
                  )
              }
            }
          );

      await window.Swal.fire({
        icon:
          'success',

        title:
          'บันทึกการตั้งค่ากะแล้ว',

        html: `
          <div>
            Module
            <strong>
              ${escapeHtml(
                state.moduleId
              )}
            </strong>
            <br>

            เวอร์ชัน
            <strong>
              ${escapeHtml(
                result.version ||
                '-'
              )}
            </strong>
          </div>
        `,

        confirmButtonText:
          'รับทราบ'
      });

      await loadModuleData();

    } catch (error) {
      await showError(
        error,
        'บันทึกการตั้งค่ากะไม่สำเร็จ'
      );

    } finally {
      setButtonLoading(
        button,
        false
      );
    }
  }


  async function setupShiftSystem() {
    const button =
      byId(
        'adminShiftSetupButton'
      );

    setButtonLoading(
      button,
      true,
      'กำลังเตรียมชีท'
    );

    try {
      const result =
        await window.VehicleAPI
          .setupAdminShiftSystem();

      await window.Swal.fire({
        icon:
          'success',

        title:
          'เตรียมระบบกะสำเร็จ',

        text:
          'ตรวจสอบหรือสร้างชีทแล้ว ' +
          (
            Array.isArray(
              result.sheets
            )
              ? result.sheets.length
              : 0
          ) +
          ' ชีท',

        confirmButtonText:
          'รับทราบ'
      });

      await loadModules();

    } catch (error) {
      await showError(
        error,
        'เตรียมระบบกะไม่สำเร็จ'
      );

    } finally {
      setButtonLoading(
        button,
        false
      );
    }
  }


  async function runSnapshot() {
    if (!state.moduleId) {
      return;
    }

    const confirm =
      await window.Swal.fire({
        icon:
          'question',

        title:
          'บันทึก Snapshot ตอนนี้',

        text:
          'ระบบจะตรวจสอบกะที่ถึงเวลาปิดและบันทึกสถิติของ Module ' +
          state.moduleId,

        showCancelButton:
          true,

        confirmButtonText:
          'เริ่มประมวลผล',

        cancelButtonText:
          'ยกเลิก'
      });

    if (!confirm.isConfirmed) {
      return;
    }

    const button =
      byId(
        'adminShiftSnapshotButton'
      );

    setButtonLoading(
      button,
      true,
      'กำลังประมวลผล'
    );

    try {
      const result =
        await window.VehicleAPI
          .runAdminShiftSnapshots({
            moduleId:
              state.moduleId
          });

      await window.Swal.fire({
        icon:
          result.success
            ? 'success'
            : 'warning',

        title:
          'ประมวลผล Snapshot แล้ว',

        html: `
          <div class="admin-shift-result">
            <span>
              สรุปกะ
              <strong>
                ${formatNumber(
                  result.shiftSnapshots
                )}
              </strong>
            </span>

            <span>
              สรุปรายวัน
              <strong>
                ${formatNumber(
                  result.dailySnapshots
                )}
              </strong>
            </span>

            <span>
              รายชั่วโมง
              <strong>
                ${formatNumber(
                  result.hourlyRows
                )}
              </strong>
            </span>

            <span>
              ข้อยกเว้น
              <strong>
                ${formatNumber(
                  result.exceptionRows
                )}
              </strong>
            </span>
          </div>
        `,

        confirmButtonText:
          'รับทราบ'
      });

      await loadStatistics();

    } catch (error) {
      await showError(
        error,
        'สร้าง Snapshot ไม่สำเร็จ'
      );

    } finally {
      setButtonLoading(
        button,
        false
      );
    }
  }


  async function loadStatistics() {
    if (!state.moduleId) {
      return;
    }

    const button =
      byId(
        'adminShiftStatsRefreshButton'
      );

    setButtonLoading(
      button,
      true,
      'กำลังโหลด'
    );

    try {
      const data =
        await window.VehicleAPI
          .getAdminShiftStatistics({
            moduleId:
              state.moduleId,

            limit:
              50
          });

      state.statistics =
        Array.isArray(
          data &&
          data.shiftSummaries
        )
          ? data.shiftSummaries
          : [];

      renderStatistics();

    } catch (error) {
      await showError(
        error,
        'โหลดสถิติกะไม่สำเร็จ'
      );

    } finally {
      setButtonLoading(
        button,
        false
      );
    }
  }


  function renderStatistics() {
    const rows =
      state.statistics ||
      [];

    setText(
      'adminShiftSnapshotCount',
      formatNumber(
        rows.length
      )
    );

    setText(
      'adminShiftFinalCount',
      formatNumber(
        rows.filter(
          function (row) {
            return (
              String(
                row.SnapshotStatus ||
                ''
              ).toUpperCase() ===
              'FINAL'
            );
          }
        ).length
      )
    );

    setText(
      'adminShiftLatestDate',
      rows.length
        ? displayDate(
            rows[0]
              .BusinessDate
          )
        : '-'
    );

    setText(
      'adminShiftLatestCode',
      rows.length
        ? String(
            rows[0]
              .ShiftCode ||
            '-'
          )
        : '-'
    );

    const body =
      byId(
        'adminShiftStatsBody'
      );

    if (!body) {
      return;
    }

    if (!rows.length) {
      body.innerHTML = `
        <tr>
          <td colspan="10">
            ยังไม่มี Snapshot ของ Module นี้
          </td>
        </tr>
      `;

      return;
    }

    body.innerHTML =
      rows
        .map(
          function (row) {
            const status =
              String(
                row.SnapshotStatus ||
                '-'
              ).toUpperCase();

            return `
              <tr>
                <td>
                  ${escapeHtml(
                    displayDate(
                      row.BusinessDate
                    )
                  )}
                </td>

                <td>
                  <strong>
                    ${escapeHtml(
                      row.ShiftCode ||
                      '-'
                    )}
                  </strong>

                  <small>
                    ${escapeHtml(
                      row.ShiftName ||
                      ''
                    )}
                  </small>
                </td>

                <td>
                  <span
                    class="admin-shift-table-status"
                    data-status="${escapeHtml(
                      status
                    )}"
                  >
                    ${escapeHtml(
                      statusLabel(
                        status
                      )
                    )}
                  </span>
                </td>

                <td>
                  ${formatNumber(
                    row.GateIn
                  )}
                </td>

                <td>
                  ${formatNumber(
                    row.GateOutActual
                  )}
                </td>

                <td>
                  ${formatNumber(
                    row.AutoClose
                  )}
                </td>

                <td>
                  ${formatNumber(
                    row.ClosingBalance
                  )}
                </td>

                <td>
                  <strong class="${
                    Number(
                      row.OverdueAtEnd
                    ) > 0
                      ? 'admin-shift-danger-text'
                      : ''
                  }">
                    ${formatNumber(
                      row.OverdueAtEnd
                    )}
                  </strong>
                </td>

                <td>
                  ${formatNumber(
                    row.SLACompliancePercent
                  )}%
                </td>

                <td>
                  ${formatNumber(
                    row.AverageDwellMinutes
                  )}
                  นาที
                </td>
              </tr>
            `;
          }
        )
        .join('');
  }


  function syncRowsFromDom() {
    document
      .querySelectorAll(
        '#adminShiftRows [data-shift-index]'
      )
      .forEach(
        function (row) {
          const index =
            Number(
              row.dataset
                .shiftIndex
            );

          const shift =
            state.shifts[index];

          if (!shift) {
            return;
          }

          row
            .querySelectorAll(
              '[data-shift-field]'
            )
            .forEach(
              function (input) {
                const field =
                  input.dataset
                    .shiftField;

                shift[field] =
                  input.type ===
                    'checkbox'
                    ? input.checked
                    : input.value;
              }
            );
        }
      );
  }


  function setConfigLoading(
    loading
  ) {
    const container =
      byId(
        'adminShiftRows'
      );

    if (
      loading &&
      container
    ) {
      container.innerHTML = `
        <div class="admin-shift-loading">
          <span></span>
          กำลังโหลดการตั้งค่าของ Module
        </div>
      `;
    }

    [
      'adminShiftSaveButton',
      'adminShiftSnapshotButton',
      'adminShiftStatsRefreshButton'
    ].forEach(
      function (id) {
        const element =
          byId(id);

        if (element) {
          element.disabled =
            loading;
        }
      }
    );
  }


  function showPanelMessage(
    message,
    status,
    retryVisible
  ) {
    const element =
      byId(
        'adminShiftMessage'
      );

    const text =
      byId(
        'adminShiftMessageText'
      );

    const retry =
      byId(
        'adminShiftMessageRetry'
      );

    if (!element) {
      return;
    }

    element.hidden =
      false;

    if (text) {
      text.textContent =
        message;
    } else {
      element.textContent =
        message;
    }

    element.dataset.status =
      status ||
      'INFO';

    if (retry) {
      retry.hidden =
        retryVisible !==
        true;
    }
  }


  function hidePanelMessage() {
    const element =
      byId(
        'adminShiftMessage'
      );

    const retry =
      byId(
        'adminShiftMessageRetry'
      );

    if (element) {
      element.hidden =
        true;
    }

    if (retry) {
      retry.hidden =
        true;
    }
  }


  function renderModuleLoadFailure(
    error
  ) {
    const select =
      byId(
        'adminShiftModuleSelect'
      );

    if (select) {
      select.innerHTML = `
        <option value="">
          โหลด Module ไม่สำเร็จ
        </option>
      `;
    }

    const rows =
      byId(
        'adminShiftRows'
      );

    if (rows) {
      rows.innerHTML = `
        <div class="admin-shift-loading admin-shift-load-error">
          <strong>
            ไม่สามารถโหลดการตั้งค่ากะได้
          </strong>

          <span>
            ${escapeHtml(
              errorMessage(
                error
              )
            )}
          </span>
        </div>
      `;
    }
  }


  function observeShiftPanelVisibility() {
    const panel =
      byId(
        'adminPanelShifts'
      );

    if (!panel) {
      return;
    }

    const check =
      function () {
        if (
          isElementVisible(
            panel
          )
        ) {
          ensureInitialized();
        }
      };

    const observer =
      new MutationObserver(
        check
      );

    observer.observe(
      panel,
      {
        attributes:
          true,

        attributeFilter: [
          'class',
          'hidden',
          'style'
        ]
      }
    );

    window.setTimeout(
      check,
      500
    );
  }


  async function waitForAdminReady() {
    const startedAt =
      Date.now();

    while (
      Date.now() -
      startedAt <
      20000
    ) {
      const loading =
        byId(
          'adminPageLoading'
        );

      const userText =
        String(
          byId(
            'adminCurrentUser'
          )?.textContent ||
          ''
        ).trim();

      const loadingHidden =
        !loading ||
        !isElementVisible(
          loading
        );

      const userReady =
        userText &&
        userText !==
          'กำลังโหลด...';

      if (
        loadingHidden &&
        userReady
      ) {
        return;
      }

      await delay(
        150
      );
    }

    throw new Error(
      'หน้า Admin ยังโหลดสิทธิ์ผู้ดูแลระบบไม่เสร็จ'
    );
  }


  function isElementVisible(
    element
  ) {
    if (!element) {
      return false;
    }

    if (
      element.hidden ||
      element.classList
        .contains(
          'is-hidden'
        )
    ) {
      return false;
    }

    const style =
      window.getComputedStyle(
        element
      );

    return (
      style.display !==
        'none' &&
      style.visibility !==
        'hidden'
    );
  }


  function withTimeout(
    promise,
    timeoutMs,
    message
  ) {
    return Promise.race([
      Promise.resolve(
        promise
      ),

      new Promise(
        function (
          _resolve,
          reject
        ) {
          window.setTimeout(
            function () {
              reject(
                new Error(
                  message ||
                  'การเชื่อมต่อใช้เวลานานเกินกำหนด'
                )
              );
            },
            timeoutMs
          );
        }
      )
    ]);
  }


  function delay(
    milliseconds
  ) {
    return new Promise(
      function (resolve) {
        window.setTimeout(
          resolve,
          milliseconds
        );
      }
    );
  }

  function updateLocation() {
    try {
      const url =
        new URL(
          window.location.href
        );

      url.searchParams.set(
        'tab',
        'shifts'
      );

      url.hash =
        'shifts';

      window.history
        .replaceState(
          {},
          '',
          url
        );
    } catch (_) {
      // ไม่กระทบการทำงานหลัก
    }
  }


  function defaultShifts() {
    return [
      {
        code:
          'A',

        name:
          'กะ A',

        start:
          '06:00',

        end:
          '14:00',

        active:
          true
      },

      {
        code:
          'B',

        name:
          'กะ B',

        start:
          '14:00',

        end:
          '22:00',

        active:
          true
      },

      {
        code:
          'C',

        name:
          'กะ C',

        start:
          '22:00',

        end:
          '06:00',

        active:
          true
      }
    ];
  }


  function validTime(
    value
  ) {
    return /^([01]\d|2[0-3]):[0-5]\d$/
      .test(
        String(
          value ||
          ''
        )
      );
  }


  function timeMinutes(
    value
  ) {
    const parts =
      String(
        value ||
        '00:00'
      ).split(
        ':'
      );

    return (
      Number(
        parts[0]
      ) *
        60 +
      Number(
        parts[1]
      )
    );
  }


  function dateToIso(
    value
  ) {
    const text =
      String(
        value ||
        ''
      ).trim();

    let match =
      text.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
      );

    if (match) {
      return [
        match[3],
        String(
          match[2]
        ).padStart(
          2,
          '0'
        ),
        String(
          match[1]
        ).padStart(
          2,
          '0'
        )
      ].join(
        '-'
      );
    }

    match =
      text.match(
        /^(\d{4})-(\d{2})-(\d{2})$/
      );

    return match
      ? text
      : '';
  }


  function todayIso() {
    const date =
      new Date();

    return [
      date.getFullYear(),
      String(
        date.getMonth() +
        1
      ).padStart(
        2,
        '0'
      ),
      String(
        date.getDate()
      ).padStart(
        2,
        '0'
      )
    ].join(
      '-'
    );
  }


  function displayDate(
    value
  ) {
    if (
      value instanceof Date &&
      !isNaN(
        value.getTime()
      )
    ) {
      return new Intl.DateTimeFormat(
        'th-TH',
        {
          day:
            '2-digit',

          month:
            '2-digit',

          year:
            'numeric'
        }
      ).format(
        value
      );
    }

    return String(
      value ||
      '-'
    );
  }


  function statusLabel(
    status
  ) {
    const map = {
      FINAL:
        'ปิดกะแล้ว',

      PROVISIONAL:
        'สรุปเบื้องต้น',

      CALCULATED:
        'คำนวณแล้ว',

      RECALCULATED:
        'คำนวณใหม่'
    };

    return (
      map[status] ||
      status ||
      '-'
    );
  }


  function setButtonLoading(
    button,
    loading,
    label
  ) {
    if (!button) {
      return;
    }

    if (loading) {
      if (
        !button.dataset
          .originalText
      ) {
        button.dataset
          .originalText =
            button.textContent
              .trim();
      }

      button.disabled =
        true;

      button.textContent =
        label ||
        'กำลังดำเนินการ';

      return;
    }

    button.disabled =
      false;

    if (
      button.dataset
        .originalText
    ) {
      button.textContent =
        button.dataset
          .originalText;
    }
  }


  async function showError(
    error,
    title
  ) {
    if (
      window.Swal &&
      typeof window.Swal.fire ===
        'function'
    ) {
      await window.Swal.fire({
        icon:
          'error',

        title:
          title ||
          'เกิดข้อผิดพลาด',

        text:
          errorMessage(
            error
          ),

        confirmButtonText:
          'รับทราบ'
      });

      return;
    }

    window.alert(
      (
        title ||
        'เกิดข้อผิดพลาด'
      ) +
      '\n' +
      errorMessage(
        error
      )
    );
  }


  function errorMessage(
    error
  ) {
    return (
      error &&
      error.message
        ? error.message
        : String(
            error ||
            'ไม่สามารถดำเนินการได้'
          )
    );
  }


  function formatNumber(
    value
  ) {
    const numeric =
      Number(
        value
      );

    return Number.isFinite(
      numeric
    )
      ? new Intl.NumberFormat(
          'th-TH',
          {
            maximumFractionDigits:
              2
          }
        ).format(
          numeric
        )
      : '0';
  }


  function setText(
    id,
    value
  ) {
    const element =
      byId(id);

    if (element) {
      element.textContent =
        String(
          value ??
          ''
        );
    }
  }


  function setValue(
    id,
    value
  ) {
    const element =
      byId(id);

    if (element) {
      element.value =
        String(
          value ??
          ''
        );
    }
  }


  function setChecked(
    id,
    checked
  ) {
    const element =
      byId(id);

    if (element) {
      element.checked =
        checked ===
        true;
    }
  }


  function byId(
    id
  ) {
    return document
      .getElementById(
        id
      );
  }


  function escapeHtml(
    value
  ) {
    return String(
      value ??
      ''
    )
      .replace(
        /&/g,
        '&amp;'
      )
      .replace(
        /</g,
        '&lt;'
      )
      .replace(
        />/g,
        '&gt;'
      )
      .replace(
        /"/g,
        '&quot;'
      )
      .replace(
        /'/g,
        '&#039;'
      );
  }

})(window, document);
