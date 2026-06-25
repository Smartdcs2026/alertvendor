/*****************************************************************
 * module.js — ชุดปรับ Silent Refresh
 *
 * ใช้กับ module.js ปัจจุบัน
 * ให้แทนที่ส่วนต่าง ๆ ตามหัวข้อด้านล่าง
 *****************************************************************/


/*****************************************************************
 * 1) ใน const state เพิ่ม 2 บรรทัดนี้
 *
 * วางต่อจาก:
 * refreshInProgress: false,
 *****************************************************************/

recordsSignature: '',
hasLoadedRecords: false,


/*****************************************************************
 * 2) ใน initializePage()
 *
 * แทนที่คำสั่ง loadRecords เดิมด้วยชุดนี้
 *****************************************************************/

await loadRecords({
  silentError: false,
  showSuccessToast: false,
  forceRender: true
});


/*****************************************************************
 * 3) แทนที่ฟังก์ชัน bindEvents() เดิมทั้งฟังก์ชัน
 *
 * เวอร์ชันนี้ไม่มีปุ่มรีเฟรช และเมื่อกลับมาที่แท็บ
 * จะโหลดข้อมูลแบบเงียบ
 *****************************************************************/

function bindEvents() {
  const backButton =
    document.getElementById(
      'backButton'
    );

  const logoutButton =
    document.getElementById(
      'logoutButton'
    );

  const calendarButton =
    document.getElementById(
      'calendarButton'
    );

  const searchInput =
    document.getElementById(
      'searchInput'
    );

  const statusFilter =
    document.getElementById(
      'statusFilter'
    );

  backButton &&
    backButton.addEventListener(
      'click',
      redirectToDashboard
    );

  logoutButton &&
    logoutButton.addEventListener(
      'click',
      handleLogout
    );

  calendarButton &&
    calendarButton.addEventListener(
      'click',
      openCalendar
    );

  searchInput &&
    searchInput.addEventListener(
      'input',
      debounce(
        () => {
          state.searchText =
            String(
              searchInput.value || ''
            )
              .trim()
              .toLowerCase();

          applyFiltersAndRender();
        },
        180
      )
    );

  statusFilter &&
    statusFilter.addEventListener(
      'change',
      () => {
        state.statusFilter =
          String(
            statusFilter.value ||
            'ALL'
          ).toUpperCase();

        applyFiltersAndRender();
      }
    );

  document
    .querySelectorAll(
      '[data-summary-filter]'
    )
    .forEach(
      (button) => {
        button.addEventListener(
          'click',
          () => {
            const value =
              String(
                button.dataset
                  .summaryFilter ||
                'ALL'
              ).toUpperCase();

            state.statusFilter =
              value;

            if (statusFilter) {
              statusFilter.value =
                value;
            }

            applyFiltersAndRender();
          }
        );
      }
    );

  document.addEventListener(
    'visibilitychange',
    async () => {
      if (
        document.visibilityState ===
          'visible' &&
        !state.refreshInProgress &&
        state.hasLoadedRecords
      ) {
        await loadRecords({
          silentError: true,
          showSuccessToast: false,
          forceRender: false
        });
      }
    }
  );
}


/*****************************************************************
 * 4) แทนที่ฟังก์ชัน loadRecords(options) เดิมทั้งฟังก์ชัน
 *
 * หลักการ:
 * - ไม่มี Spinner ระหว่างรีเฟรช
 * - ไม่ล้างการ์ดเดิม
 * - Render ใหม่เฉพาะเมื่อข้อมูลจริงเปลี่ยน
 * - ไม่แสดง Toast ตอน Auto Refresh
 *****************************************************************/

async function loadRecords(
  options
) {
  if (
    state.refreshInProgress ||
    state.destroyed
  ) {
    return;
  }

  const config =
    options &&
    typeof options === 'object'
      ? options
      : {};

  state.refreshInProgress =
    true;

  const vehicleList =
    document.getElementById(
      'vehicleList'
    );

  vehicleList &&
    vehicleList.setAttribute(
      'aria-busy',
      'true'
    );

  try {
    const result =
      await API.getRecords(
        state.moduleId,
        {
          mode:
            'active',

          limit:
            1000
        }
      );

    if (
      result &&
      result.module
    ) {
      state.module = {
        ...state.module,
        ...result.module
      };

      renderModuleHeader();
    }

    updateServerOffset(
      result &&
      result.generatedAt
    );

    const nextRecords =
      result &&
      Array.isArray(
        result.records
      )
        ? result.records
        : [];

    const previousSignature =
      state.recordsSignature;

    state.records =
      nextRecords;

    recalculateAllRecords();

    const nextSignature =
      buildRecordsSignature(
        state.records
      );

    const mustRender =
      config.forceRender === true ||
      !state.hasLoadedRecords ||
      nextSignature !==
        previousSignature;

    state.recordsSignature =
      nextSignature;

    renderSummary();

    /*
     * ไม่ Render ซ้ำถ้าข้อมูลเดิม
     * จึงไม่มีอาการกระพริบหรือ Scroll กระโดดทุก 30 วินาที
     */
    if (mustRender) {
      const previousScrollY =
        window.scrollY;

      applyFiltersAndRender();

      if (
        state.hasLoadedRecords
      ) {
        window.requestAnimationFrame(
          () => {
            window.scrollTo({
              top:
                previousScrollY,

              behavior:
                'auto'
            });
          }
        );
      }
    }

    state.hasLoadedRecords =
      true;

    setText(
      'lastUpdated',
      'ข้อมูลล่าสุด ' +
        (
          result &&
          result.generatedAt
            ? result.generatedAt
            : formatBangkokDateTime(
                getCurrentServerDate()
              )
        )
    );

    /*
     * เก็บไว้รองรับคำสั่งแบบ Manual ในอนาคต
     * แต่ Auto Refresh จะส่งค่า false เสมอ
     */
    if (
      config.showSuccessToast
    ) {
      showToast(
        'อัปเดตข้อมูลแล้ว',
        'success'
      );
    }

    checkOverdueAlerts();

  } catch (error) {
    if (
      isAuthenticationError(
        error
      )
    ) {
      await showSessionExpired();
      return;
    }

    /*
     * การเปิดหน้าครั้งแรกยังแจ้ง Error
     * แต่ Auto Refresh ผิดพลาดชั่วคราวจะไม่รบกวนผู้ใช้
     */
    if (
      !config.silentError
    ) {
      await showApiError(
        error,
        'โหลดข้อมูลไม่สำเร็จ'
      );
    }

  } finally {
    state.refreshInProgress =
      false;

    vehicleList &&
      vehicleList.setAttribute(
        'aria-busy',
        'false'
      );
  }
}


/*****************************************************************
 * 5) เพิ่มฟังก์ชันนี้ต่อจาก loadRecords()
 *
 * ใช้ตรวจว่าข้อมูลจริงเปลี่ยนหรือไม่
 * ไม่รวม Duration ที่เดินทุกวินาที
 *****************************************************************/

function buildRecordsSignature(
  records
) {
  const list =
    Array.isArray(records)
      ? records
      : [];

  return JSON.stringify(
    list.map(
      (record) => ({
        recordId:
          record.recordId || '',

        primaryValue:
          record.primaryValue || '',

        timestampIn:
          record.timestampIn || '',

        timestampInEpochMs:
          Number(
            record.timestampInEpochMs
          ) || 0,

        isCurrentlyInArea:
          Boolean(
            record.isCurrentlyInArea
          ),

        isIncomplete:
          Boolean(
            record.isIncomplete
          ),

        canCheckout:
          Boolean(
            record.canCheckout
          ),

        fields:
          Array.isArray(
            record.fields
          )
            ? record.fields.map(
                (field) => ({
                  id:
                    field.id ||
                    field.fieldId ||
                    '',

                  label:
                    field.label || '',

                  value:
                    field.value || '',

                  type:
                    field.type || '',

                  order:
                    Number(
                      field.order
                    ) || 0
                })
              )
            : []
      })
    )
  );
}


/*****************************************************************
 * 6) แทนที่ฟังก์ชัน startAutoRefresh() เดิมทั้งฟังก์ชัน
 *****************************************************************/

function startAutoRefresh() {
  if (
    state.refreshTimer
  ) {
    window.clearInterval(
      state.refreshTimer
    );
  }

  const seconds =
    Math.max(
      10,
      Number(
        state.module &&
        state.module
          .refreshSeconds
      ) || 30
    );

  state.refreshTimer =
    window.setInterval(
      async () => {
        if (
          state.destroyed ||
          document.visibilityState !==
            'visible' ||
          state.refreshInProgress
        ) {
          return;
        }

        await loadRecords({
          silentError:
            true,

          showSuccessToast:
            false,

          forceRender:
            false
        });
      },
      seconds * 1000
    );

  updateAutoRefreshStatus();
}


/*****************************************************************
 * 7) แทนที่ฟังก์ชัน updateAutoRefreshStatus() เดิม
 *
 * ไม่แสดงข้อความรีเฟรชแก่ User/Admin
 *****************************************************************/

function updateAutoRefreshStatus() {
  const element =
    document.getElementById(
      'autoRefreshStatus'
    );

  if (element) {
    element.classList.add(
      'is-hidden'
    );
  }
}
