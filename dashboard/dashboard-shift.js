/**
 * dashboard-shift.js
 * ROUND 57 — Executive Shift Comparison Dashboard
 */
(function (window, document) {
  'use strict';

  const API =
    window.DashboardAPI;

  const state = {
    moduleId:
      '',

    view:
      'LIVE',

    selectedDate:
      '',

    data:
      null,

    loading:
      false,

    requestToken:
      0,

    refreshTimer:
      null,

    charts: {
      flow:
        null,

      sla:
        null,

      history:
        null
    }
  };


  document.addEventListener(
    'DOMContentLoaded',
    initialize
  );


  function initialize() {
    state.moduleId =
      getModuleId();

    state.selectedDate =
      todayIso();

    const dateInput =
      byId(
        'dashboardShiftDate'
      );

    if (dateInput) {
      dateInput.value =
        state.selectedDate;
    }

    document.body.dataset
      .dashboardView =
        'LIVE';

    bindEvents();
  }


  function bindEvents() {
    document.addEventListener(
      'click',
      handleDashboardInfoClick
    );

    byId(
      'dashboardViewToolbar'
    )?.addEventListener(
      'click',
      (event) => {
        const button =
          event.target.closest(
            '[data-dashboard-view]'
          );

        if (!button) {
          return;
        }

        setView(
          button.dataset
            .dashboardView
        );
      }
    );

    byId(
      'dashboardShiftDate'
    )?.addEventListener(
      'change',
      (event) => {
        state.selectedDate =
          event.target.value ||
          todayIso();

        loadShiftDashboard();
      }
    );

    byId(
      'dashboardShiftPreviousDate'
    )?.addEventListener(
      'click',
      () => {
        changeDate(-1);
      }
    );

    byId(
      'dashboardShiftNextDate'
    )?.addEventListener(
      'click',
      () => {
        changeDate(1);
      }
    );

    byId(
      'dashboardShiftToday'
    )?.addEventListener(
      'click',
      () => {
        state.selectedDate =
          todayIso();

        syncDateInput();
        loadShiftDashboard();
      }
    );

    byId(
      'dashboardRefreshButton'
    )?.addEventListener(
      'click',
      () => {
        if (
          state.view !==
          'LIVE'
        ) {
          loadShiftDashboard(
            true
          );
        }
      }
    );

    window.addEventListener(
      'beforeunload',
      destroy
    );
  }


  const DASHBOARD_INFO = Object.freeze({
    SLA: {
      title:
        'เกณฑ์ SLA คืออะไร',

      body:
        'SLA คือเกณฑ์เวลาที่ Module กำหนดไว้สำหรับควบคุมระยะเวลารถหรือตู้อยู่ในพื้นที่ โดยใช้ค่า “เกินเวลา” จากการตั้งค่า Module เป็นเส้นตัดหลัก',

      formula:
        'อัตราผ่าน SLA = จำนวนรายการที่ใช้เวลาไม่ถึงเกณฑ์เกินเวลา ÷ จำนวนรายการที่ประเมินได้ × 100',

      source:
        'ที่มา: ค่าเกณฑ์เวลาของ Module และเวลาระหว่างเข้า–ออกจากข้อมูลต้นทาง'
    },

    P90: {
      title:
        'เวลา P90 คืออะไร',

      body:
        'P90 คือระยะเวลาที่ร้อยละ 90 ของรายการใช้เวลาไม่เกินค่านี้ ช่วยให้เห็นเวลาส่วนใหญ่ได้ชัดกว่าใช้ค่าเฉลี่ยเพียงอย่างเดียว',

      formula:
        'ตัวอย่าง P90 = 120 นาที หมายถึง 90% ของรายการใช้เวลาไม่เกิน 120 นาที และอีก 10% ใช้นานกว่านั้น',

      source:
        'ที่มา: ระยะเวลาเข้า–ออกของรายการที่ประเมินได้ในช่วงหรือกะที่เลือก'
    },

    AUTO_CLOSE: {
      title:
        'ปิดอัตโนมัติคืออะไร',

      body:
        'รายการที่ระบบปิดให้อัตโนมัติเมื่ออยู่เกินจำนวนชั่วโมงที่ Admin กำหนด ไม่ถือเป็นการสแกนเวลาออกจริง',

      formula:
        'ใช้แยกออกจาก “ออกจริง” เพื่อไม่ให้ตัวเลขประสิทธิภาพการปฏิบัติงานคลาดเคลื่อน',

      source:
        'ที่มา: การตั้งค่า Auto Close ส่วนกลางและบันทึกเหตุการณ์ปิดอัตโนมัติ'
    },

    SNAPSHOT: {
      title:
        'ข้อมูลสรุปหลังปิดกะหรือปิดวัน',

      body:
        'ระบบบันทึกค่าทางสถิติหลังช่วงกะหรือวันปฏิบัติงานสิ้นสุด เพื่อให้ข้อมูลย้อนหลังคงที่และเปิดดูได้รวดเร็ว',

      formula:
        'ใช้ Key ของ Module + วันปฏิบัติงาน + กะ จึงปรับปรุงแถวเดิมโดยไม่สร้างรายการซ้ำ',

      source:
        'ที่มา: ชีทสรุปกะ สรุปรายวัน สรุปรายชั่วโมง และข้อยกเว้นกะ'
    },

    BUSINESS_DATE: {
      title:
        'วันปฏิบัติงานคืออะไร',

      body:
        'วันปฏิบัติงานเริ่มตามเวลาที่ Admin กำหนด ไม่จำเป็นต้องเริ่มเวลา 00:00',

      formula:
        'ตัวอย่าง เริ่มวัน 06:00: วันที่ 03/07 หมายถึงช่วง 03/07 06:00 ถึง 04/07 06:00',

      source:
        'ที่มา: การตั้งค่ากะของแต่ละ Module'
    },

    DATA_QUALITY: {
      title:
        'คุณภาพข้อมูลคืออะไร',

      body:
        'สัดส่วนรายการที่มีข้อมูลเวลาและฟิลด์สำคัญครบพอสำหรับนำไปคำนวณ',

      formula:
        'คุณภาพข้อมูล = รายการที่ประเมินได้ครบ ÷ รายการที่ตรงเงื่อนไขทั้งหมด × 100',

      source:
        'ที่มา: แถวข้อมูลต้นทางของ Module ที่เลือก'
    },

    OPENING_BALANCE: {
      title:
        'คงค้างต้นช่วงคืออะไร',

      body:
        'รายการที่เข้าพื้นที่มาก่อนช่วงที่เลือกและยังไม่มีเวลาออกเมื่อช่วงนั้นเริ่มต้น',

      formula:
        'รายการเหล่านี้ถูกส่งต่อมาจากกะหรือวันก่อนหน้า',

      source:
        'ที่มา: เวลาเข้าและเวลาออกของข้อมูลต้นทาง'
    },

    CLOSING_BALANCE: {
      title:
        'คงค้างปลายช่วงคืออะไร',

      body:
        'รายการที่ยังอยู่ในพื้นที่เมื่อช่วง กะ หรือวันปฏิบัติงานสิ้นสุด',

      formula:
        'คงค้างปลายช่วงจะกลายเป็นคงค้างต้นช่วงของช่วงถัดไป',

      source:
        'ที่มา: เวลาเข้า เวลาออก และเวลาสิ้นสุดช่วงที่เลือก'
    },

    ACTUAL_OUT: {
      title:
        'ออกจริงคืออะไร',

      body:
        'รายการที่มีเวลาออกจากพื้นที่จริงในข้อมูลต้นทาง ไม่รวมรายการที่ระบบปิดให้อัตโนมัติ',

      formula:
        'ใช้เป็นตัวเลขหลักในการวัดความสำเร็จของกระบวนการออก',

      source:
        'ที่มา: Timestamp Out หรือฟิลด์เวลาออกจริงของ Module'
    }
  });


  function handleDashboardInfoClick(
    event
  ) {
    const button =
      event.target.closest(
        '[data-dashboard-info]'
      );

    if (!button) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    openDashboardInfo(
      button.dataset
        .dashboardInfo ||
      'ALL'
    );
  }


  function openDashboardInfo(
    key
  ) {
    if (
      !window.Swal ||
      typeof window.Swal.fire !==
        'function'
    ) {
      return;
    }

    const normalized =
      String(
        key ||
        'ALL'
      ).toUpperCase();

    if (normalized === 'ALL') {
      const items = [
        'SLA',
        'P90',
        'AUTO_CLOSE',
        'BUSINESS_DATE',
        'SNAPSHOT',
        'DATA_QUALITY',
        'OPENING_BALANCE',
        'CLOSING_BALANCE',
        'ACTUAL_OUT'
      ];

      window.Swal.fire({
        title:
          'คำอธิบายข้อมูล Dashboard',

        html: `
          <div class="dashboard-info-list">
            ${items
              .map(
                function (itemKey) {
                  const item =
                    DASHBOARD_INFO[
                      itemKey
                    ];

                  return `
                    <section>
                      <strong>
                        ${escapeHtml(
                          item.title
                        )}
                      </strong>

                      <p>
                        ${escapeHtml(
                          item.body
                        )}
                      </p>
                    </section>
                  `;
                }
              )
              .join('')}
          </div>
        `,

        confirmButtonText:
          'ปิด',

        width:
          'min(760px, calc(100vw - 16px))',

        customClass: {
          popup:
            'dashboard-info-popup'
        }
      });

      return;
    }

    const item =
      DASHBOARD_INFO[
        normalized
      ];

    if (!item) {
      return;
    }

    window.Swal.fire({
      title:
        item.title,

      html: `
        <div class="dashboard-info-detail">
          <p>
            ${escapeHtml(
              item.body
            )}
          </p>

          <section>
            <span>
              วิธีอ่านข้อมูล
            </span>

            <strong>
              ${escapeHtml(
                item.formula
              )}
            </strong>
          </section>

          <small>
            ${escapeHtml(
              item.source
            )}
          </small>
        </div>
      `,

      confirmButtonText:
        'ปิด',

      width:
        'min(620px, calc(100vw - 16px))',

      customClass: {
        popup:
          'dashboard-info-popup'
      }
    });
  }


  function infoButton(
    key,
    label
  ) {
    return `
      <button
        type="button"
        class="dashboard-info-button"
        data-dashboard-info="${escapeHtml(
          key
        )}"
        aria-label="${escapeHtml(
          label ||
          'คำอธิบายข้อมูล'
        )}"
      >
        i
      </button>
    `;
  }


  function labelWithInfo(
    label,
    key
  ) {
    return `
      <span class="dashboard-label-with-info">
        ${escapeHtml(
          label
        )}

        ${infoButton(
          key,
          'คำอธิบาย ' +
          label
        )}
      </span>
    `;
  }


  function setView(
    view
  ) {
    const next =
      String(
        view ||
        'LIVE'
      ).toUpperCase();

    state.view =
      [
        'LIVE',
        'SHIFT',
        'DAILY'
      ].includes(next)
        ? next
        : 'LIVE';

    document.body.dataset
      .dashboardView =
        state.view;

    document
      .querySelectorAll(
        '[data-dashboard-view]'
      )
      .forEach(
        (button) => {
          button.classList.toggle(
            'is-active',
            button.dataset
              .dashboardView ===
              state.view
          );
        }
      );

    const controls =
      byId(
        'dashboardShiftDateControls'
      );

    const workspace =
      byId(
        'dashboardShiftWorkspace'
      );

    if (controls) {
      controls.hidden =
        state.view ===
        'LIVE';
    }

    if (workspace) {
      workspace.hidden =
        state.view ===
        'LIVE';
    }

    if (
      state.view ===
      'LIVE'
    ) {
      stopRefreshTimer();
      return;
    }

    if (!state.data) {
      loadShiftDashboard();
    } else {
      render();
    }

    scheduleRefresh();
  }


  async function loadShiftDashboard(
    force
  ) {
    if (
      state.loading ||
      state.view ===
        'LIVE' ||
      !state.moduleId ||
      !API ||
      typeof API
        .getShiftDashboard !==
        'function'
    ) {
      return;
    }

    const token =
      ++state.requestToken;

    state.loading =
      true;

    renderLoading(
      force === true
        ? 'กำลังรีเฟรชข้อมูลตามกะ'
        : 'กำลังคำนวณข้อมูลตามกะ'
    );

    try {
      const data =
        await API
          .getShiftDashboard(
            state.moduleId,
            {
              date:
                state.selectedDate
            }
          );

      if (
        token !==
        state.requestToken
      ) {
        return;
      }

      state.data =
        data || null;

      render();

    } catch (error) {
      if (
        token !==
        state.requestToken
      ) {
        return;
      }

      renderError(
        error
      );

    } finally {
      if (
        token ===
        state.requestToken
      ) {
        state.loading =
          false;
      }

      scheduleRefresh();
    }
  }


  function render() {
    const workspace =
      byId(
        'dashboardShiftWorkspace'
      );

    if (
      !workspace ||
      !state.data
    ) {
      return;
    }

    destroyCharts();

    if (
      state.data.enabled !==
      true
    ) {
      workspace.innerHTML =
        disabledHtml();

      return;
    }

    workspace.innerHTML =
      state.view ===
        'DAILY'
        ? dailyHtml(
            state.data
          )
        : shiftHtml(
            state.data
          );

    if (
      state.view ===
      'DAILY'
    ) {
      renderHistoryChart(
        state.data
      );
    } else {
      renderFlowChart(
        state.data
      );

      renderSlaChart(
        state.data
      );
    }

    bindWorkspaceEvents();
  }


  function shiftHtml(
    data
  ) {
    const cards =
      Array.isArray(
        data.shifts
      )
        ? data.shifts
        : [];

    const daily =
      data.daily ||
      {};

    const dailyMetric =
      daily.metrics ||
      {};

    const executive =
      data.executive ||
      {};

    return `
      <header class="shift-executive-header">
        <div>
          <small>
            ผลงานตามกะ
          </small>

          <h2>
            ผลงานตามกะ
          </h2>

          <p>
            วันที่ปฏิบัติงาน
            <strong>
              ${escapeHtml(
                data.businessDate ||
                '-'
              )}
            </strong>
            ${infoButton(
              'BUSINESS_DATE',
              'คำอธิบายวันปฏิบัติงาน'
            )}
            · เวอร์ชันกะ
            <strong>
              ${escapeHtml(
                data.config
                  ?.version ||
                '-'
              )}
            </strong>
          </p>
        </div>

        <div class="shift-executive-badges">
          ${
            executive.currentShiftCode
              ? `
                  <span class="is-live">
                    กะปัจจุบัน
                    ${escapeHtml(
                      executive
                        .currentShiftCode
                    )}
                  </span>
                `
              : ''
          }

          ${
            executive.bestShiftCode
              ? `
                  <span class="is-best">
                    ผลงานดีที่สุด
                    ${escapeHtml(
                      executive
                        .bestShiftCode
                    )}
                  </span>
                `
              : ''
          }

          ${
            executive.attentionShiftCode
              ? `
                  <span class="is-attention">
                    ต้องติดตาม
                    ${escapeHtml(
                      executive
                        .attentionShiftCode
                    )}
                  </span>
                `
              : ''
          }
        </div>
      </header>

      <section class="shift-executive-kpis">
        ${executiveKpi(
          'เข้าทั้งวัน',
          dailyMetric.gateIn,
          'รายการ'
        )}

        ${executiveKpi(
          'ออกจริง',
          dailyMetric
            .gateOutActual,
          'รายการ'
        )}

        ${executiveKpi(
          'คงค้างล่าสุด',
          dailyMetric
            .closingBalance,
          'รายการ'
        )}

        ${executiveKpi(
          'เกิน SLA',
          dailyMetric
            .overdueAtEnd,
          'รายการ',
          Number(
            dailyMetric
              .overdueAtEnd
          ) > 0
            ? 'is-danger'
            : ''
        )}

        ${executiveKpi(
          labelWithInfo(
            'ผ่าน SLA',
            'SLA'
          ),
          formatPercent(
            dailyMetric
              .slaCompliancePercent
          ),
          '',
          slaTone(
            dailyMetric
              .slaCompliancePercent
          )
        )}

        ${executiveKpi(
          'เวลาเฉลี่ย',
          formatMinutes(
            dailyMetric
              .averageDwellMinutes
          ),
          ''
        )}
      </section>

      <section class="shift-comparison-grid">
        ${
          cards.length
            ? cards
                .map(
                  (card) =>
                    shiftCardHtml(
                      card,
                      executive
                    )
                )
                .join('')
            : emptyPanel(
                'ยังไม่มีข้อมูลกะ'
              )
        }
      </section>

      <section class="shift-dashboard-analysis">
        <article class="shift-analysis-panel">
          <header>
            <div>
              <small>
                ปริมาณงานแต่ละกะ
              </small>

              <h3>
                เข้าเทียบออกจริง
              </h3>
            </div>
          </header>

          <div class="shift-chart-wrap">
            <canvas
              id="shiftFlowComparisonChart"
            ></canvas>
          </div>
        </article>

        <article class="shift-analysis-panel">
          <header>
            <div>
              <small>
                ประสิทธิภาพตามเกณฑ์
              </small>

              <h3 class="dashboard-label-with-info">
                อัตราผ่าน SLA แต่ละกะ
                ${infoButton(
                  'SLA',
                  'คำอธิบาย SLA'
                )}
              </h3>
            </div>
          </header>

          <div class="shift-chart-wrap">
            <canvas
              id="shiftSlaComparisonChart"
            ></canvas>
          </div>
        </article>
      </section>

      <section class="shift-dashboard-lower">
        <article class="shift-analysis-panel">
          <header>
            <div>
              <small>
                ส่งต่องาน
              </small>

              <h3>
                การส่งต่องานระหว่างกะ
              </h3>
            </div>
          </header>

          <div class="shift-handover-flow">
            ${handoverHtml(
              data.handover
            )}
          </div>
        </article>

        <article class="shift-analysis-panel">
          <header>
            <div>
              <small>
                รายการผิดปกติ
              </small>

              <h3>
                รายการผิดปกติที่ต้องติดตาม
              </h3>
            </div>

            <span class="shift-panel-count">
              ${
                Array.isArray(
                  data.exceptions
                )
                  ? data.exceptions
                      .length
                  : 0
              }
              รายการ
            </span>
          </header>

          <div class="shift-exception-list">
            ${exceptionListHtml(
              data.exceptions
            )}
          </div>
        </article>
      </section>

      <footer class="shift-dashboard-footer">
        <span>
          อัปเดต
          ${escapeHtml(
            data.generatedAt ||
            '-'
          )}
        </span>

        <span>
          ${
            executive
              .comparisonMode ===
              'MATCHED_ELAPSED'
              ? 'กะปัจจุบันเปรียบเทียบกับช่วงเวลาที่ผ่านไปเท่ากันของวันก่อน'
              : 'เปรียบเทียบกับกะเดียวกันของวันปฏิบัติงานก่อนหน้า'
          }
        </span>
      </footer>
    `;
  }


  function dailyHtml(
    data
  ) {
    const daily =
      data.daily ||
      {};

    const metric =
      daily.metrics ||
      {};

    const history =
      dailyHistoryRows(
        data
      );

    return `
      <header class="shift-executive-header">
        <div>
          <small>
            สรุปปฏิบัติงานรายวัน
          </small>

          <h2>
            สรุปรายวัน
          </h2>

          <p>
            วันปฏิบัติงาน
            <strong>
              ${escapeHtml(
                data.businessDate ||
                '-'
              )}
            </strong>
            ${infoButton(
              'BUSINESS_DATE',
              'คำอธิบายวันปฏิบัติงาน'
            )}
            ·
            ${escapeHtml(
              daily.statusLabel ||
              '-'
            )}
          </p>
        </div>

        <div class="shift-executive-badges">
          ${
            daily.bestShiftCode
              ? `
                  <span class="is-best">
                    กะเด่น
                    ${escapeHtml(
                      daily.bestShiftCode
                    )}
                  </span>
                `
              : ''
          }

          ${
            daily.attentionShiftCode
              ? `
                  <span class="is-attention">
                    กะที่ต้องติดตาม
                    ${escapeHtml(
                      daily
                        .attentionShiftCode
                    )}
                  </span>
                `
              : ''
          }
        </div>
      </header>

      <section class="daily-summary-grid">
        ${dailyMetricHtml(
          'คงค้างต้นวัน',
          metric.openingBalance
        )}

        ${dailyMetricHtml(
          'เข้า',
          metric.gateIn
        )}

        ${dailyMetricHtml(
          'ออกจริง',
          metric.gateOutActual
        )}

        ${dailyMetricHtml(
          labelWithInfo(
            'ปิดอัตโนมัติ',
            'AUTO_CLOSE'
          ),
          metric.autoClose
        )}

        ${dailyMetricHtml(
          'คงค้างปลายวัน',
          metric.closingBalance
        )}

        ${dailyMetricHtml(
          'Peak Active',
          metric.peakActive
        )}

        ${dailyMetricHtml(
          'เกิน SLA ปลายวัน',
          metric.overdueAtEnd,
          Number(
            metric.overdueAtEnd
          ) > 0
            ? 'is-danger'
            : ''
        )}

        ${dailyMetricHtml(
          labelWithInfo(
            'ผ่าน SLA',
            'SLA'
          ),
          formatPercent(
            metric
              .slaCompliancePercent
          ),
          slaTone(
            metric
              .slaCompliancePercent
          )
        )}

        ${dailyMetricHtml(
          'เวลาเฉลี่ย',
          formatMinutes(
            metric
              .averageDwellMinutes
          )
        )}

        ${dailyMetricHtml(
          labelWithInfo(
            'เวลา P90',
            'P90'
          ),
          formatMinutes(
            metric
              .p90DwellMinutes
          )
        )}

        ${dailyMetricHtml(
          'คุณภาพข้อมูล',
          formatPercent(
            metric
              .dataCompletenessPercent
          )
        )}

        ${dailyMetricHtml(
          'ช่วงวันปฏิบัติงาน',
          `${shortDateTime(
            daily.businessDayStart
          )} – ${shortDateTime(
            daily.businessDayEnd
          )}`,
          'is-wide'
        )}
      </section>

      <section class="daily-dashboard-analysis">
        <article class="shift-analysis-panel">
          <header>
            <div>
              <small>
                แนวโน้มรายวัน
              </small>

              <h3>
                แนวโน้มเข้า ออกจริง และคงค้าง
              </h3>
            </div>
          </header>

          <div class="daily-history-chart-wrap">
            <canvas
              id="dailyShiftHistoryChart"
            ></canvas>
          </div>
        </article>

        <article class="shift-analysis-panel">
          <header>
            <div>
              <small>
                สถิติย้อนหลัง
              </small>

              <h3>
                สถิติย้อนหลังล่าสุด
              </h3>
            </div>

            <span class="shift-panel-count">
              ${history.length}
              วัน
            </span>
          </header>

          <div class="daily-history-table-wrap">
            ${dailyHistoryTable(
              history
            )}
          </div>
        </article>
      </section>

      <footer class="shift-dashboard-footer">
        <span>
          อัปเดต
          ${escapeHtml(
            data.generatedAt ||
            '-'
          )}
        </span>

        <span>
          สถิติหลังปิดวันมาจากข้อมูลสรุปที่ระบบบันทึกไว้
          ${infoButton(
            'SNAPSHOT',
            'คำอธิบายข้อมูลสรุป'
          )}
        </span>
      </footer>
    `;
  }


  function shiftCardHtml(
    card,
    executive
  ) {
    const metric =
      card.metrics ||
      {};

    const comparison =
      card.comparison ||
      {};

    const best =
      executive
        .bestShiftCode ===
      card.code;

    const attention =
      executive
        .attentionShiftCode ===
      card.code;

    return `
      <article
        class="shift-performance-card
          ${card.status ===
            'LIVE'
              ? 'is-live'
              : ''}
          ${best
            ? 'is-best'
            : ''}
          ${attention
            ? 'is-attention'
            : ''}"
        data-shift-code="${escapeHtml(
          card.code
        )}"
      >
        <header>
          <div class="shift-code-block">
            <strong>
              ${escapeHtml(
                card.code
              )}
            </strong>

            <div>
              <span>
                ${escapeHtml(
                  card.name
                )}
              </span>

              <small>
                ${escapeHtml(
                  card.start
                )}
                –
                ${escapeHtml(
                  card.end
                )}
              </small>
            </div>
          </div>

          <span
            class="shift-status-badge"
            data-status="${escapeHtml(
              card.status
            )}"
          >
            ${escapeHtml(
              card.statusLabel
            )}
          </span>
        </header>

        <div class="shift-card-flow">
          <div>
            ${labelWithInfo(
              'ต้นกะ',
              'OPENING_BALANCE'
            )}
            <strong>
              ${formatNumber(
                metric.openingBalance
              )}
            </strong>
          </div>

          <div>
            <span>เข้า</span>
            <strong>
              ${formatNumber(
                metric.gateIn
              )}
            </strong>
          </div>

          <div>
            <span>ออก</span>
            <strong>
              ${formatNumber(
                metric.gateOutActual
              )}
            </strong>
          </div>

          <div>
            ${labelWithInfo(
              'ปลายกะ',
              'CLOSING_BALANCE'
            )}
            <strong>
              ${formatNumber(
                metric.closingBalance
              )}
            </strong>
          </div>
        </div>

        <div class="shift-card-performance">
          <div>
            ${labelWithInfo(
              'SLA',
              'SLA'
            )}
            <strong class="${
              slaTone(
                metric
                  .slaCompliancePercent
              )
            }">
              ${formatPercent(
                metric
                  .slaCompliancePercent
              )}
            </strong>
          </div>

          <div>
            <span>เฉลี่ย</span>
            <strong>
              ${formatMinutes(
                metric
                  .averageDwellMinutes
              )}
            </strong>
          </div>

          <div>
            ${labelWithInfo(
              'P90',
              'P90'
            )}
            <strong>
              ${formatMinutes(
                metric
                  .p90DwellMinutes
              )}
            </strong>
          </div>

          <div>
            <span>เกิน SLA</span>
            <strong class="${
              Number(
                metric.overdueAtEnd
              ) > 0
                ? 'is-negative'
                : ''
            }">
              ${formatNumber(
                metric.overdueAtEnd
              )}
            </strong>
          </div>
        </div>

        <div class="shift-card-comparison">
          <span>
            ${
              comparison.mode ===
                'MATCHED_ELAPSED'
                ? `เทียบช่วง ${
                    formatNumber(
                      comparison.hours
                    )
                  } ชม. เท่ากัน`
                : 'เทียบกะเดียวกันวันก่อน'
            }
          </span>

          ${
            comparison.available
              ? `
                  <div>
                    ${deltaBadge(
                      'เข้า',
                      comparison
                        .delta
                        .gateIn,
                      false
                    )}

                    ${deltaBadge(
                      'คงค้าง',
                      comparison
                        .delta
                        .closingBalance,
                      true
                    )}

                    ${deltaBadge(
                      'SLA',
                      comparison
                        .delta
                        .slaCompliancePercent,
                      false,
                      '%'
                    )}
                  </div>
                `
              : `
                  <small>
                    ยังไม่มีข้อมูลวันก่อนสำหรับเปรียบเทียบ
                  </small>
                `
          }
        </div>

        <button
          type="button"
          class="shift-card-detail-button"
          data-open-shift-detail="${escapeHtml(
            card.code
          )}"
        >
          ดูรายละเอียดกะ
        </button>
      </article>
    `;
  }


  function handoverHtml(
    handover
  ) {
    const items =
      Array.isArray(
        handover
      )
        ? handover.filter(
            (item) =>
              item.toShift
          )
        : [];

    if (!items.length) {
      return emptyPanel(
        'ยังไม่มีข้อมูลส่งต่องาน'
      );
    }

    return items
      .map(
        (item) => `
          <div
            class="shift-handover-item
              ${
                item.reconciled
                  ? ''
                  : 'is-mismatch'
              }"
          >
            <div>
              <span>
                กะ
                ${escapeHtml(
                  item.fromShift
                )}
              </span>

              <strong>
                ${formatNumber(
                  item.closingBalance
                )}
              </strong>

              <small>
                คงค้างปลายกะ
              </small>
            </div>

            <i aria-hidden="true">
              →
            </i>

            <div>
              <span>
                กะ
                ${escapeHtml(
                  item.toShift
                )}
              </span>

              <strong>
                ${formatNumber(
                  item.nextOpeningBalance
                )}
              </strong>

              <small>
                รับต้นกะ
              </small>
            </div>

            <em>
              ${
                item.overdueAtEnd > 0
                  ? `เกิน SLA ส่งต่อ ${
                      formatNumber(
                        item.overdueAtEnd
                      )
                    }`
                  : 'ไม่มีรายการเกิน SLA ส่งต่อ'
              }
            </em>
          </div>
        `
      )
      .join('');
  }


  function exceptionListHtml(
    exceptions
  ) {
    const items =
      Array.isArray(
        exceptions
      )
        ? exceptions
        : [];

    if (!items.length) {
      return emptyPanel(
        'ไม่พบรายการผิดปกติ'
      );
    }

    return items
      .map(
        (item, index) => `
          <button
            type="button"
            class="shift-exception-item"
            data-exception-index="${index}"
          >
            <b>
              ${index + 1}
            </b>

            <div>
              <strong>
                ${escapeHtml(
                  item.company ||
                  'ไม่ระบุบริษัท'
                )}
              </strong>

              <span>
                กะ
                ${escapeHtml(
                  item.shiftCode ||
                  '-'
                )}
                · นัดหมาย
                ${escapeHtml(
                  item
                    .appointmentNumber ||
                  '-'
                )}
              </span>

              <small>
                ${escapeHtml(
                  exceptionLabel(
                    item.type
                  )
                )}
              </small>
            </div>

            <em>
              ${
                Number(
                  item.overdueMinutes
                ) > 0
                  ? `${formatNumber(
                      item.overdueMinutes
                    )} นาที`
                  : escapeHtml(
                      item.type ||
                      '-'
                    )
              }
            </em>
          </button>
        `
      )
      .join('');
  }


  function dailyHistoryRows(
    data
  ) {
    const history =
      Array.isArray(
        data &&
        data.history
      )
        ? data.history.slice()
        : [];

    const currentDate =
      String(
        data &&
        data.businessDate ||
        ''
      );

    const exists =
      history.some(
        (item) =>
          String(
            item.businessDate ||
            ''
          ) ===
          currentDate
      );

    if (
      !exists &&
      data &&
      data.daily &&
      data.daily.metrics
    ) {
      const metric =
        data.daily.metrics;

      history.unshift({
        businessDate:
          currentDate,

        gateIn:
          metric.gateIn,

        gateOutActual:
          metric.gateOutActual,

        autoClose:
          metric.autoClose,

        closingBalance:
          metric.closingBalance,

        overdue:
          metric.overdueAtEnd,

        averageDwellMinutes:
          metric.averageDwellMinutes,

        p90DwellMinutes:
          metric.p90DwellMinutes,

        slaCompliancePercent:
          metric.slaCompliancePercent,

        dataCompletenessPercent:
          metric.dataCompletenessPercent,

        bestShiftCode:
          data.daily
            .bestShiftCode,

        attentionShiftCode:
          data.daily
            .attentionShiftCode,

        status:
          data.daily.status
      });
    }

    return history;
  }


  function dailyHistoryTable(
    history
  ) {
    if (!history.length) {
      return emptyPanel(
        'ยังไม่มี ข้อมูลสรุปรายวัน'
      );
    }

    return `
      <table class="daily-history-table">
        <thead>
          <tr>
            <th>วันปฏิบัติงาน</th>
            <th>เข้า</th>
            <th>ออก</th>
            <th>คงค้าง</th>
            <th>SLA</th>
            <th>เฉลี่ย</th>
            <th>กะเด่น</th>
            <th>สถานะ</th>
          </tr>
        </thead>

        <tbody>
          ${history
            .map(
              (row) => `
                <tr>
                  <td>
                    ${escapeHtml(
                      row.businessDate
                    )}
                  </td>

                  <td>
                    ${formatNumber(
                      row.gateIn
                    )}
                  </td>

                  <td>
                    ${formatNumber(
                      row.gateOutActual
                    )}
                  </td>

                  <td>
                    ${formatNumber(
                      row.closingBalance
                    )}
                  </td>

                  <td>
                    <strong class="${
                      slaTone(
                        row
                          .slaCompliancePercent
                      )
                    }">
                      ${formatPercent(
                        row
                          .slaCompliancePercent
                      )}
                    </strong>
                  </td>

                  <td>
                    ${formatMinutes(
                      row
                        .averageDwellMinutes
                    )}
                  </td>

                  <td>
                    ${escapeHtml(
                      row.bestShiftCode ||
                      '-'
                    )}
                  </td>

                  <td>
                    ${escapeHtml(
                      row.status ||
                      '-'
                    )}
                  </td>
                </tr>
              `
            )
            .join('')}
        </tbody>
      </table>
    `;
  }


  function bindWorkspaceEvents() {
    byId(
      'dashboardShiftWorkspace'
    )
      ?.querySelectorAll(
        '[data-open-shift-detail]'
      )
      .forEach(
        (button) => {
          button.addEventListener(
            'click',
            () => {
              openShiftDetail(
                button.dataset
                  .openShiftDetail
              );
            }
          );
        }
      );

    byId(
      'dashboardShiftWorkspace'
    )
      ?.querySelectorAll(
        '[data-exception-index]'
      )
      .forEach(
        (button) => {
          button.addEventListener(
            'click',
            () => {
              openExceptionDetail(
                Number(
                  button.dataset
                    .exceptionIndex
                )
              );
            }
          );
        }
      );
  }


  function openShiftDetail(
    shiftCode
  ) {
    const card =
      (
        state.data
          ?.shifts ||
        []
      ).find(
        (item) =>
          item.code ===
          shiftCode
      );

    if (
      !card ||
      !window.Swal
    ) {
      return;
    }

    const metric =
      card.metrics ||
      {};

    const comparison =
      card.comparison ||
      {};

    window.Swal.fire({
      title:
        `กะ ${escapeHtml(
          card.code
        )} · ${escapeHtml(
          card.name
        )}`,

      html: `
        <div class="shift-detail-modal">
          <p>
            ${escapeHtml(
              card.rangeStart
            )}
            –
            ${escapeHtml(
              card.rangeEnd
            )}
          </p>

          <div>
            ${detailItem(
              'คงค้างต้นกะ',
              metric.openingBalance
            )}

            ${detailItem(
              'เข้า',
              metric.gateIn
            )}

            ${detailItem(
              'ออกจริง',
              metric.gateOutActual
            )}

            ${detailItem(
              'ปิดอัตโนมัติ',
              metric.autoClose
            )}

            ${detailItem(
              'คงค้างปลายกะ',
              metric.closingBalance
            )}

            ${detailItem(
              'Peak Active',
              metric.peakActive
            )}

            ${detailItem(
              'Peak Overdue',
              metric.peakOverdue
            )}

            ${detailItem(
              'เกิน SLA ปลายกะ',
              metric.overdueAtEnd
            )}

            ${detailItem(
              'ผ่าน SLA',
              formatPercent(
                metric
                  .slaCompliancePercent
              )
            )}

            ${detailItem(
              'เวลาเฉลี่ย',
              formatMinutes(
                metric
                  .averageDwellMinutes
              )
            )}

            ${detailItem(
              'P90',
              formatMinutes(
                metric
                  .p90DwellMinutes
              )
            )}

            ${detailItem(
              'เวลานานที่สุด',
              formatMinutes(
                metric
                  .maxDwellMinutes
              )
            )}
          </div>

          ${
            comparison.available
              ? `
                  <section>
                    <strong>
                      เปรียบเทียบวันก่อน
                    </strong>

                    <span>
                      เข้า
                      ${signed(
                        comparison
                          .delta
                          .gateIn
                      )}
                      · คงค้าง
                      ${signed(
                        comparison
                          .delta
                          .closingBalance
                      )}
                      · SLA
                      ${signed(
                        comparison
                          .delta
                          .slaCompliancePercent
                      )}%
                    </span>
                  </section>
                `
              : ''
          }
        </div>
      `,

      confirmButtonText:
        'ปิด',

      width:
        'min(620px, calc(100vw - 14px))',

      customClass: {
        popup:
          'shift-detail-popup'
      }
    });
  }


  function openExceptionDetail(
    index
  ) {
    const item =
      state.data
        ?.exceptions
        ?.[index];

    if (
      !item ||
      !window.Swal
    ) {
      return;
    }

    window.Swal.fire({
      title:
        'รายละเอียดรายการผิดปกติ',

      html: `
        <div class="shift-exception-detail">
          ${detailItem(
            'บริษัท / Vendor',
            item.company
          )}

          ${detailItem(
            'เลขนัดหมาย',
            item
              .appointmentNumber
          )}

          ${detailItem(
            'ทะเบียน / หมายเลขตู้',
            item.registration
          )}

          ${detailItem(
            'กะ',
            item.shiftCode
          )}

          ${detailItem(
            'ประเภท',
            exceptionLabel(
              item.type
            )
          )}

          ${detailItem(
            'เวลา เข้า',
            item.gateIn
          )}

          ${detailItem(
            'ระยะเวลา',
            formatMinutes(
              item.durationMinutes
            )
          )}

          ${detailItem(
            'เกิน SLA',
            formatMinutes(
              item.overdueMinutes
            )
          )}
        </div>
      `,

      confirmButtonText:
        'ปิด',

      width:
        'min(560px, calc(100vw - 14px))',

      customClass: {
        popup:
          'shift-detail-popup'
      }
    });
  }


  function renderFlowChart(
    data
  ) {
    if (
      typeof window.Chart ===
      'undefined'
    ) {
      return;
    }

    const canvas =
      byId(
        'shiftFlowComparisonChart'
      );

    if (!canvas) {
      return;
    }

    const cards =
      data.shifts || [];

    state.charts.flow =
      new window.Chart(
        canvas,
        {
          type:
            'bar',

          data: {
            labels:
              cards.map(
                (card) =>
                  `กะ ${card.code}`
              ),

            datasets: [
              {
                label:
                  'เข้า',

                data:
                  cards.map(
                    (card) =>
                      card.metrics
                        .gateIn
                  ),

                backgroundColor:
                  '#0f9d7a',

                borderRadius:
                  4
              },

              {
                label:
                  'ออกจริง',

                data:
                  cards.map(
                    (card) =>
                      card.metrics
                        .gateOutActual
                  ),

                backgroundColor:
                  '#2369d8',

                borderRadius:
                  4
              },

              {
                label:
                  'คงค้างปลายกะ',

                data:
                  cards.map(
                    (card) =>
                      card.metrics
                        .closingBalance
                  ),

                backgroundColor:
                  '#e88709',

                borderRadius:
                  4
              }
            ]
          },

          options:
            chartOptions(
              false
            )
        }
      );
  }


  function renderSlaChart(
    data
  ) {
    if (
      typeof window.Chart ===
      'undefined'
    ) {
      return;
    }

    const canvas =
      byId(
        'shiftSlaComparisonChart'
      );

    if (!canvas) {
      return;
    }

    const cards =
      data.shifts || [];

    state.charts.sla =
      new window.Chart(
        canvas,
        {
          type:
            'bar',

          data: {
            labels:
              cards.map(
                (card) =>
                  `กะ ${card.code}`
              ),

            datasets: [
              {
                label:
                  'ผ่าน SLA %',

                data:
                  cards.map(
                    (card) =>
                      card.metrics
                        .slaCompliancePercent
                  ),

                backgroundColor:
                  cards.map(
                    (card) =>
                      Number(
                        card.metrics
                          .slaCompliancePercent
                      ) >= 95
                        ? '#0f9d7a'
                        : Number(
                            card.metrics
                              .slaCompliancePercent
                          ) >= 90
                          ? '#e88709'
                          : '#e33434'
                  ),

                borderRadius:
                  4
              }
            ]
          },

          options: {
            ...chartOptions(
              true
            ),

            scales: {
              y: {
                beginAtZero:
                  true,

                max:
                  100,

                ticks: {
                  callback:
                    (value) =>
                      `${value}%`
                },

                grid: {
                  color:
                    '#e5edf2'
                }
              },

              x: {
                grid: {
                  display:
                    false
                }
              }
            }
          }
        }
      );
  }


  function renderHistoryChart(
    data
  ) {
    if (
      typeof window.Chart ===
      'undefined'
    ) {
      return;
    }

    const canvas =
      byId(
        'dailyShiftHistoryChart'
      );

    if (!canvas) {
      return;
    }

    const history =
      dailyHistoryRows(
        data
      )
        .slice(
          0,
          10
        )
        .reverse();

    state.charts.history =
      new window.Chart(
        canvas,
        {
          type:
            'line',

          data: {
            labels:
              history.map(
                (item) =>
                  item.businessDate
              ),

            datasets: [
              {
                label:
                  'เข้า',

                data:
                  history.map(
                    (item) =>
                      item.gateIn
                  ),

                borderColor:
                  '#0f9d7a',

                backgroundColor:
                  'rgba(15,157,122,.12)',

                tension:
                  .28,

                fill:
                  false
              },

              {
                label:
                  'ออกจริง',

                data:
                  history.map(
                    (item) =>
                      item.gateOutActual
                  ),

                borderColor:
                  '#2369d8',

                backgroundColor:
                  'rgba(35,105,216,.12)',

                tension:
                  .28,

                fill:
                  false
              },

              {
                label:
                  'คงค้าง',

                data:
                  history.map(
                    (item) =>
                      item.closingBalance
                  ),

                borderColor:
                  '#e88709',

                backgroundColor:
                  'rgba(232,135,9,.12)',

                tension:
                  .28,

                fill:
                  false
              }
            ]
          },

          options:
            chartOptions(
              false
            )
        }
      );
  }


  function chartOptions(
    compact
  ) {
    return {
      responsive:
        true,

      maintainAspectRatio:
        false,

      animation: {
        duration:
          280
      },

      interaction: {
        mode:
          'index',

        intersect:
          false
      },

      plugins: {
        legend: {
          position:
            'bottom',

          labels: {
            boxWidth:
              10,

            boxHeight:
              10,

            font: {
              size:
                compact
                  ? 9
                  : 10,

              weight:
                '700'
            }
          }
        },

        tooltip: {
          enabled:
            true
        }
      },

      scales: {
        y: {
          beginAtZero:
            true,

          grid: {
            color:
              '#e5edf2'
          },

          ticks: {
            precision:
              0
          }
        },

        x: {
          grid: {
            display:
              false
          }
        }
      }
    };
  }


  function destroyCharts() {
    Object.keys(
      state.charts
    ).forEach(
      (key) => {
        if (
          state.charts[key]
        ) {
          state.charts[key]
            .destroy();

          state.charts[key] =
            null;
        }
      }
    );
  }


  function renderLoading(
    message
  ) {
    const workspace =
      byId(
        'dashboardShiftWorkspace'
      );

    if (!workspace) {
      return;
    }

    workspace.innerHTML = `
      <div class="shift-dashboard-loading">
        <span></span>

        <strong>
          ${escapeHtml(
            message
          )}
        </strong>
      </div>
    `;
  }


  function renderError(
    error
  ) {
    const workspace =
      byId(
        'dashboardShiftWorkspace'
      );

    if (!workspace) {
      return;
    }

    workspace.innerHTML = `
      <div class="shift-dashboard-message is-error">
        <strong>
          โหลดข้อมูลตามกะไม่สำเร็จ
        </strong>

        <span>
          ${escapeHtml(
            error?.message ||
            'เกิดข้อผิดพลาด'
          )}
        </span>

        <button
          type="button"
          id="retryShiftDashboard"
        >
          ลองใหม่
        </button>
      </div>
    `;

    byId(
      'retryShiftDashboard'
    )?.addEventListener(
      'click',
      () => {
        loadShiftDashboard(
          true
        );
      }
    );
  }


  function disabledHtml() {
    return `
      <div class="shift-dashboard-message">
        <strong>
          Module นี้ยังไม่ได้เปิดการคำนวณตามกะ
        </strong>

        <span>
          ผู้ดูแลระบบสามารถเปิดใช้งานและกำหนดเวลากะจากหน้า Shift Admin
        </span>

        <a href="../shift-admin.html">
          เปิดหน้าตั้งค่ากะ
        </a>
      </div>
    `;
  }


  function executiveKpi(
    label,
    value,
    unit,
    className
  ) {
    return `
      <div class="${className || ''}">
        <span>
          ${
            String(
              label ||
              ''
            ).includes(
              'dashboard-label-with-info'
            )
              ? label
              : escapeHtml(
                  label
                )
          }
        </span>

        <strong>
          ${escapeHtml(
            String(
              value ??
              0
            )
          )}
        </strong>

        ${
          unit
            ? `
                <small>
                  ${escapeHtml(
                    unit
                  )}
                </small>
              `
            : ''
        }
      </div>
    `;
  }


  function dailyMetricHtml(
    label,
    value,
    className
  ) {
    return `
      <div class="${className || ''}">
        <span>
          ${
            String(
              label ||
              ''
            ).includes(
              'dashboard-label-with-info'
            )
              ? label
              : escapeHtml(
                  label
                )
          }
        </span>

        <strong>
          ${escapeHtml(
            String(
              value ??
              0
            )
          )}
        </strong>
      </div>
    `;
  }


  function deltaBadge(
    label,
    value,
    lowerIsBetter,
    suffix
  ) {
    const numeric =
      Number(value) || 0;

    const good =
      numeric === 0
        ? null
        : lowerIsBetter
          ? numeric < 0
          : numeric > 0;

    return `
      <span class="${
        good === null
          ? 'is-neutral'
          : good
            ? 'is-positive'
            : 'is-negative'
      }">
        ${escapeHtml(
          label
        )}
        ${signed(
          numeric
        )}${suffix || ''}
      </span>
    `;
  }


  function detailItem(
    label,
    value
  ) {
    return `
      <div>
        <span>
          ${escapeHtml(
            label
          )}
        </span>

        <strong>
          ${escapeHtml(
            String(
              value ??
              '-'
            )
          )}
        </strong>
      </div>
    `;
  }


  function exceptionLabel(
    type
  ) {
    const map = {
      OVERDUE:
        'เกิน SLA',
      AUTO_CLOSE:
        'ระบบ ปิดอัตโนมัติ',
      MISSING_RECEIVING:
        'ไม่มีข้อมูลรับสินค้าเสร็จ',
      INCOMPLETE_DATA:
        'ข้อมูลไม่สมบูรณ์',
      CARRY_OVER_OVERDUE:
        'เกิน SLA และส่งต่อกะ'
    };

    return (
      map[
        String(
          type ||
          ''
        ).toUpperCase()
      ] ||
      String(
        type ||
        'รายการผิดปกติ'
      )
    );
  }


  function slaTone(
    value
  ) {
    const numeric =
      Number(value);

    if (!Number.isFinite(numeric)) {
      return '';
    }

    if (numeric >= 95) {
      return 'is-positive';
    }

    if (numeric >= 90) {
      return 'is-warning';
    }

    return 'is-negative';
  }


  function formatNumber(
    value
  ) {
    const numeric =
      Number(value);

    if (!Number.isFinite(numeric)) {
      return '0';
    }

    return new Intl.NumberFormat(
      'th-TH',
      {
        maximumFractionDigits:
          2
      }
    ).format(numeric);
  }


  function formatPercent(
    value
  ) {
    return (
      formatNumber(
        value
      ) +
      '%'
    );
  }


  function formatMinutes(
    value
  ) {
    return (
      formatNumber(
        value
      ) +
      ' นาที'
    );
  }


  function signed(
    value
  ) {
    const numeric =
      Number(value) || 0;

    if (numeric > 0) {
      return (
        '+' +
        formatNumber(
          numeric
        )
      );
    }

    return formatNumber(
      numeric
    );
  }


  function shortDateTime(
    value
  ) {
    const text =
      String(
        value ||
        '-'
      );

    return text
      .replace(
        /:00$/,
        ''
      );
  }


  function emptyPanel(
    message
  ) {
    return `
      <div class="shift-empty-panel">
        ${escapeHtml(
          message
        )}
      </div>
    `;
  }


  function changeDate(
    days
  ) {
    const date =
      parseIsoDate(
        state.selectedDate
      );

    date.setDate(
      date.getDate() +
      days
    );

    const today =
      parseIsoDate(
        todayIso()
      );

    if (
      date.getTime() >
      today.getTime()
    ) {
      return;
    }

    state.selectedDate =
      isoFromDate(
        date
      );

    syncDateInput();
    loadShiftDashboard();
  }


  function syncDateInput() {
    const input =
      byId(
        'dashboardShiftDate'
      );

    if (input) {
      input.value =
        state.selectedDate;
    }
  }


  function scheduleRefresh() {
    stopRefreshTimer();

    if (
      state.view ===
      'LIVE'
    ) {
      return;
    }

    state.refreshTimer =
      window.setTimeout(
        () => {
          if (
            state.selectedDate ===
            todayIso()
          ) {
            loadShiftDashboard(
              true
            );
          } else {
            scheduleRefresh();
          }
        },
        120000
      );
  }


  function stopRefreshTimer() {
    if (
      state.refreshTimer
    ) {
      window.clearTimeout(
        state.refreshTimer
      );

      state.refreshTimer =
        null;
    }
  }


  function destroy() {
    stopRefreshTimer();
    destroyCharts();
  }


  function getModuleId() {
    return (
      new URLSearchParams(
        window.location.search
      ).get('module') ||
      new URLSearchParams(
        window.location.search
      ).get('id') ||
      ''
    ).trim();
  }


  function todayIso() {
    return isoFromDate(
      new Date()
    );
  }


  function parseIsoDate(
    value
  ) {
    const parts =
      String(
        value ||
        todayIso()
      ).split('-');

    return new Date(
      Number(parts[0]),
      Number(parts[1]) - 1,
      Number(parts[2])
    );
  }


  function isoFromDate(
    date
  ) {
    return [
      date.getFullYear(),
      String(
        date.getMonth() + 1
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
    ].join('-');
  }


  function byId(
    id
  ) {
    return document
      .getElementById(id);
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
