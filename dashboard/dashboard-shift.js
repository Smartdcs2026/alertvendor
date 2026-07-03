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
            SHIFT PERFORMANCE
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
          'Gate In ทั้งวัน',
          dailyMetric.gateIn,
          'รายการ'
        )}

        ${executiveKpi(
          'Gate Out จริง',
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
          'SLA ผ่านเกณฑ์',
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
                FLOW BY SHIFT
              </small>

              <h3>
                Gate In เทียบ Gate Out
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
                SLA PERFORMANCE
              </small>

              <h3>
                SLA ผ่านเกณฑ์ตามกะ
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
                SHIFT HANDOVER
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
                SHIFT EXCEPTIONS
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
            DAILY OPERATIONS SUMMARY
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
          'Gate In',
          metric.gateIn
        )}

        ${dailyMetricHtml(
          'Gate Out จริง',
          metric.gateOutActual
        )}

        ${dailyMetricHtml(
          'Auto Close',
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
          'SLA ผ่านเกณฑ์',
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
          'P90',
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
                DAILY TREND
              </small>

              <h3>
                แนวโน้ม Gate In, Gate Out และคงค้าง
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
                DAILY HISTORY
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
          สถิติ FINAL มาจาก Snapshot หลังจบวัน
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
            <span>ต้นกะ</span>
            <strong>
              ${formatNumber(
                metric.openingBalance
              )}
            </strong>
          </div>

          <div>
            <span>Gate In</span>
            <strong>
              ${formatNumber(
                metric.gateIn
              )}
            </strong>
          </div>

          <div>
            <span>Gate Out</span>
            <strong>
              ${formatNumber(
                metric.gateOutActual
              )}
            </strong>
          </div>

          <div>
            <span>ปลายกะ</span>
            <strong>
              ${formatNumber(
                metric.closingBalance
              )}
            </strong>
          </div>
        </div>

        <div class="shift-card-performance">
          <div>
            <span>SLA</span>
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
            <span>P90</span>
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
                      'Gate In',
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
        'ยังไม่มี Daily Snapshot'
      );
    }

    return `
      <table class="daily-history-table">
        <thead>
          <tr>
            <th>วันปฏิบัติงาน</th>
            <th>Gate In</th>
            <th>Gate Out</th>
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
              'Gate In',
              metric.gateIn
            )}

            ${detailItem(
              'Gate Out จริง',
              metric.gateOutActual
            )}

            ${detailItem(
              'Auto Close',
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
              'SLA ผ่านเกณฑ์',
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
                      Gate In
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
            'เวลา Gate In',
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
                  'Gate In',

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
                  'Gate Out จริง',

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
                  'SLA ผ่านเกณฑ์ %',

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
                  'Gate In',

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
                  'Gate Out จริง',

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
          ${escapeHtml(
            label
          )}
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
          ${escapeHtml(
            label
          )}
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
        'ระบบ Auto Close',
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
