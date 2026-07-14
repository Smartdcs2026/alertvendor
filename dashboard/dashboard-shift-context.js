/**
 * dashboard-shift-context.js
 * PHASE 4D HOTFIX 3 — Daily Fullscreen Executive Balance
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

    followCurrentBusinessDate:
      true,

    data:
      null,

    loading:
      false,

    requestToken:
      0,

    refreshTimer:
      null,

    layoutTimer:
      null,

    resizeObserver:
      null,

    charts: {
      flow:
        null,

      sla:
        null,

      history:
        null,

      processShare:
        null,

      processSla:
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
      normalizeBusinessDateValue(
        todayIso()
      );

    const dateInput =
      byId(
        'dashboardShiftDate'
      );

    if (dateInput) {
      dateInput.value =
        state.selectedDate;

      dateInput.max =
        todayIso();
    }

    document.body.dataset
      .dashboardView =
        'LIVE';

    bindEvents();
    bindLayoutObservers();
    syncViewportMetrics();
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
      'dashboardShiftCalendarButton'
    )?.addEventListener(
      'click',
      openHistoricalCalendar
    );

    byId(
      'dashboardShiftDate'
    )?.addEventListener(
      'change',
      (event) => {
        state.selectedDate =
          normalizeBusinessDateValue(
            event.target.value ||
            todayIso()
          );

        state.followCurrentBusinessDate =
          false;

        state.data =
          null;

        if (
          state.view ===
          'LIVE'
        ) {
          setView(
            'DAILY'
          );

          return;
        }

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
        state.followCurrentBusinessDate =
          true;

        state.selectedDate =
          todayIso();

        state.data =
          null;

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

    document.addEventListener(
      'click',
      (event) => {
        const metricButton =
          event.target.closest(
            '[data-metric-info]'
          );

        if (metricButton) {
          openMetricInformation(
            metricButton.dataset
              .metricInfo,
            metricButton.dataset
              .shiftCode ||
              ''
          );

          return;
        }

        const button =
          event.target.closest(
            '[data-dashboard-info]'
          );

        if (button) {
          openDashboardInfo(
            button.dataset
              .dashboardInfo
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
        'DAILY',
        'PROCESS'
      ].includes(next)
        ? next
        : 'LIVE';

    document.body.dataset
      .dashboardView =
        state.view;

    document.dispatchEvent(
      new CustomEvent(
        'dashboard:view-changed',
        {
          detail: {
            view:
              state.view
          }
        }
      )
    );

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
        false;

      controls.dataset.mode =
        state.view ===
          'LIVE'
          ? 'HISTORY'
          : state.view;
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
    scheduleLayoutRefresh();
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

    const loadingMessage =
      force === true
        ? 'กำลังอัปเดตข้อมูลล่าสุด'
        : state.view === 'PROCESS'
          ? 'กำลังวิเคราะห์วงจรรถและเอกสาร'
          : state.view === 'DAILY'
            ? 'กำลังสรุปข้อมูลรายวัน'
            : 'กำลังวิเคราะห์ข้อมูลตามกะ';

    if (state.data) {
      setWorkspaceBusy(
        true,
        loadingMessage
      );
    } else {
      renderLoading(
        loadingMessage
      );
    }

    try {
      const data =
        await API
          .getShiftDashboard(
            state.moduleId,
            state.followCurrentBusinessDate
              ? {}
              : {
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

      if (
        state.followCurrentBusinessDate &&
        data &&
        data.businessDate
      ) {
        state.selectedDate =
          normalizeBusinessDateValue(
            data.businessDate
          );

        syncDateInput();
      }

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

        setWorkspaceBusy(
          false
        );
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
      state.view === 'DAILY'
        ? dailyHtml(
            state.data
          )
        : state.view === 'PROCESS'
          ? processHtml(
              state.data
            )
          : shiftHtml(
              state.data
            );

    if (
      state.view === 'DAILY'
    ) {
      renderHistoryChart(
        state.data
      );
    } else if (
      state.view === 'PROCESS'
    ) {
      renderProcessCharts(
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
    scheduleLayoutRefresh();

    document.dispatchEvent(
      new CustomEvent(
        'dashboard:content-ready',
        {
          detail: {
            view:
              state.view,
            businessDate:
              state.selectedDate
          }
        }
      )
    );
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

    const metric =
      daily.metrics ||
      {};

    const executive =
      data.executive ||
      {};

    const method =
      data.methodology ||
      {};

    const referenceCount =
      cards.reduce(
        (maximum, card) =>
          Math.max(
            maximum,
            Number(
              card.context &&
              card.context
                .historicalSampleCount
            ) || 0
          ),
        0
      );

    return `
      <header class="shift-executive-header">
        <div>
          <small>
            การวิเคราะห์ตามบริบทภาระงาน
          </small>

          <div class="shift-title-line">
            <h2>
              ผลงานตามกะ
            </h2>

            <button
              type="button"
              class="dashboard-info-button"
              data-dashboard-info="shift"
              aria-label="อธิบายการวิเคราะห์ตามกะ"
            >
              i
            </button>
          </div>

          <p>
            วันปฏิบัติงาน
            <strong>
              ${escapeHtml(
                data.businessDate ||
                '-'
              )}
            </strong>

            · เกณฑ์รายคัน
            <strong>
              ${formatNumber(
                method.redMinutes
              )}
              นาที
            </strong>

            · อ้างอิงย้อนหลังสูงสุด
            <strong>
              ${formatNumber(
                referenceCount
              )}
              กะ
            </strong>
          </p>

          <div class="shift-methodology-note">
            ไม่ใช้เปอร์เซ็นต์เป้าหมายตายตัว
            · พิจารณาจำนวนจริง ภาระงาน คงค้าง และช่วงข้อมูลย้อนหลังร่วมกัน
          </div>
        </div>

        <div class="shift-executive-badges">
          ${
            executive.currentShiftCode
              ? `
                  <span class="is-live">
                    กะปัจจุบัน
                    ${escapeHtml(
                      executive.currentShiftCode
                    )}
                  </span>
                `
              : ''
          }

          ${
            executive.highestWorkloadShiftCode
              ? `
                  <span class="is-workload">
                    ภาระงานสูงสุด
                    ${escapeHtml(
                      executive
                        .highestWorkloadShiftCode
                    )}
                  </span>
                `
              : ''
          }

          ${
            executive.backlogReductionShiftCode
              ? `
                  <span class="is-best">
                    ลดคงค้างมากสุด
                    ${escapeHtml(
                      executive
                        .backlogReductionShiftCode
                    )}
                  </span>
                `
              : ''
          }

          ${
            executive.highWaitShiftCode
              ? `
                  <span class="is-attention">
                    เวลารอสูงสุด
                    ${escapeHtml(
                      executive
                        .highWaitShiftCode
                    )}
                  </span>
                `
              : ''
          }
        </div>
      </header>

      <section class="shift-executive-kpis">
        ${executiveKpi(
          'เข้าพื้นที่',
          metric.gateIn,
          'รายการ',
          '',
          'gateIn'
        )}

        ${executiveKpi(
          'ออกจริง',
          metric.gateOutActual,
          'รายการ',
          '',
          'gateOut'
        )}

        ${executiveKpi(
          'คงค้างเปลี่ยนแปลง',
          signed(
            metricBacklogChange(
              metric
            )
          ),
          'รายการ',
          Number(
            metricBacklogChange(
              metric
            )
          ) > 0
            ? 'is-danger'
            : '',
          'backlogChange'
        )}

        ${executiveKpi(
          'เกินเกณฑ์',
          `${metricOverCount(
            metric
          )} / ${metricEvaluated(
            metric
          )}`,
          `${formatPercent(
            metricOverPercent(
              metric
            )
          )} ของฐานคำนวณ`,
          metricOverCount(
            metric
          ) > 0
            ? 'is-danger'
            : '',
          'overThreshold'
        )}

        ${executiveKpi(
          'ค่ากลางเวลา',
          formatMinutes(
            metricMedian(
              metric
            )
          ),
          '',
          '',
          'median'
        )}

        ${executiveKpi(
          'เวลาส่วนใหญ่',
          formatMinutes(
            metric
              .p90DwellMinutes
          ),
          '',
          '',
          'p90'
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
                      executive,
                      data
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
                ปริมาณและการไหล
              </small>

              <div class="shift-panel-title-line">
                <h3>
                  เข้า ออก และคงค้างแยกตามกะ
                </h3>

                <button
                  type="button"
                  class="dashboard-info-button is-small"
                  data-metric-info="flow"
                  aria-label="อธิบายการไหลของรถ"
                >
                  i
                </button>
              </div>
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
                ฐานการคำนวณเวลา
              </small>

              <div class="shift-panel-title-line">
                <h3>
                  จำนวนภายในและเกินเกณฑ์
                </h3>

                <button
                  type="button"
                  class="dashboard-info-button is-small"
                  data-metric-info="overThreshold"
                  aria-label="อธิบายจำนวนเกินเกณฑ์"
                >
                  i
                </button>
              </div>
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
                งานค้างข้ามกะ
              </small>

              <div class="shift-panel-title-line">
                <h3>
                  การส่งต่องานระหว่างกะ
                </h3>

                <button
                  type="button"
                  class="dashboard-info-button is-small"
                  data-metric-info="handover"
                  aria-label="อธิบายการส่งต่องาน"
                >
                  i
                </button>
              </div>
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
                ข้อยกเว้นที่ควรตรวจสอบ
              </small>

              <h3>
                รายการที่ต้องติดตาม
              </h3>
            </div>

            <div class="shift-panel-actions">
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

              ${
                Array.isArray(
                  data.exceptions
                ) &&
                data.exceptions.length > 5
                  ? `
                      <button
                        type="button"
                        class="shift-view-all-button"
                        data-view-all-exceptions
                      >
                        ดูทั้งหมด
                      </button>
                    `
                  : ''
              }
            </div>
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
            dashboardDisplayDateTime(
              data.generatedAt
            )
          )}
        </span>

        <span>
          ${
            executive
              .comparisonMode ===
              'MATCHED_ELAPSED'
              ? 'กะปัจจุบันเทียบกับช่วงเวลาที่ผ่านไปเท่ากันของวันก่อน'
              : 'กะที่จบแล้วเทียบกับกะเดียวกันของวันก่อน'
          }
        </span>
      </footer>
    `;
  }


  function processHtml(
    data
  ) {
    const process =
      data &&
      data.processAnalytics &&
      typeof data.processAnalytics ===
        'object'
        ? data.processAnalytics
        : null;

    if (
      !process ||
      process.available !== true
    ) {
      return `
        <div class="shift-dashboard-message is-error">
          <strong>
            ยังไม่สามารถแสดงประสิทธิภาพกระบวนการ
          </strong>

          <span>
            ${escapeHtml(
              process &&
              process.message ||
              'Backend ยังไม่มี Process Analytics'
            )}
          </span>
        </div>
      `;
    }

    const overall =
      process.overall ||
      {};

    const funnel =
      process.funnel ||
      {};

    const stages =
      Array.isArray(
        process.stages
      )
        ? process.stages
        : [];

    const rules =
      process.rules ||
      {};

    const coverage =
      process.coverage ||
      {};

    return `
      <header class="process-executive-header">
        <div>
          <small>
            PROCESS CONTROL TOWER
          </small>

          <div class="shift-title-line">
            <h2>
              ประสิทธิภาพวงจรรถและเอกสาร
            </h2>
          </div>

          <p>
            รถที่ Gate In ในวันปฏิบัติงาน
            <strong>
              ${escapeHtml(
                process.businessDate ||
                data.businessDate ||
                '-'
              )}
            </strong>
            ·
            ${escapeHtml(
              process.range &&
              process.range.startAt ||
              '-'
            )}
            –
            ${escapeHtml(
              process.range &&
              process.range.endAt ||
              '-'
            )}
          </p>
        </div>

        <div class="process-config-badges">
          <span data-state="ADMIN">
            เกณฑ์จาก Admin
          </span>

          <span
            data-state="${
              rules.complete === true
                ? 'READY'
                : 'WARNING'
            }"
          >
            ${
              rules.complete === true
                ? 'ตั้งค่าครบ 4 ช่วง'
                : `ขาดเกณฑ์ ${formatNumber(
                    rules.missingRuleCount
                  )} ช่วง`
            }
          </span>

          <span data-state="QUALITY">
            Data ${formatPercent(
              overall.dataCompletenessPercent
            )}
          </span>

          <span
            data-state="${
              Number(
                coverage.workflowMissingCount
              ) > 0
                ? 'WARNING'
                : 'READY'
            }"
            title="ต้นทาง Gate In เทียบกับข้อมูล Workflow"
          >
            ต้นทาง ${formatNumber(
              coverage.sourceRecordCount
            )}
            · Workflow ${formatNumber(
              coverage.workflowMatchedCount
            )}
          </span>
        </div>
      </header>

      <section class="process-kpi-grid">
        ${processKpiHtml(
          'รถเข้า',
          process.recordCount,
          'รายการ',
          ''
        )}

        ${processKpiHtml(
          'ปิดวงจร',
          overall.completedLifecycleCount,
          `Gate Out จริง ${formatNumber(
            overall.actualGateOutCount
          )}`,
          ''
        )}

        ${processKpiHtml(
          'SLA ผ่าน',
          overall.slaCompliancePercent === null
            ? '-'
            : formatPercent(
                overall.slaCompliancePercent
              ),
          `${formatNumber(
            overall.slaEvaluatedCount
          )} จุดประเมิน`,
          Number(
            overall.slaCriticalCount
          ) > 0
            ? 'is-warning'
            : ''
        )}

        ${processKpiHtml(
          'P90 รวมจริง',
          formatMinutes(
            overall.p90LifecycleMinutes
          ),
          'ไม่รวม Auto Close',
          ''
        )}

        ${processKpiHtml(
          'คอขวด',
          overall.bottleneckStageLabel ||
          '-',
          formatMinutes(
            overall.bottleneckP90Minutes
          ),
          'is-focus'
        )}

        ${processKpiHtml(
          'ยังไม่ปิดวงจร',
          overall.openLifecycleCount,
          `ข้อมูลไม่ครบ ${formatNumber(
            overall.incompleteRecordCount
          )}`,
          Number(
            overall.openLifecycleCount
          ) > 0
            ? 'is-danger'
            : ''
        )}
      </section>

      <section class="process-stage-grid">
        ${
          stages.length
            ? stages
                .map(
                  processStageCardHtml
                )
                .join('')
            : emptyPanel(
                'ยังไม่มีข้อมูลช่วงกระบวนการ'
              )
        }
      </section>

      <section class="process-analysis-grid">
        <article class="shift-analysis-panel process-time-panel">
          <header>
            <div>
              <small>
                TIME COMPOSITION
              </small>

              <h3>
                สัดส่วนเวลาเฉลี่ยในแต่ละช่วง
              </h3>
            </div>
          </header>

          <div class="process-chart-wrap">
            <canvas id="processTimeShareChart"></canvas>
          </div>
        </article>

        <article class="shift-analysis-panel process-sla-panel">
          <header>
            <div>
              <small>
                ADMIN SLA CONTROL
              </small>

              <h3>
                ภายในเกณฑ์ เฝ้าระวัง และเกินเวลา
              </h3>
            </div>
          </header>

          <div class="process-chart-wrap">
            <canvas id="processSlaChart"></canvas>
          </div>
        </article>

        <article class="shift-analysis-panel process-funnel-panel">
          <header>
            <div>
              <small>
                LIFECYCLE FUNNEL
              </small>

              <h3>
                ความครบถ้วนของวงจรรถและเอกสาร
              </h3>
            </div>
          </header>

          <div class="process-lifecycle-funnel">
            ${processFunnelHtml(
              funnel
            )}
          </div>
        </article>

        <article class="shift-analysis-panel process-exception-panel">
          <header>
            <div>
              <small>
                BOTTLENECK EXCEPTIONS
              </small>

              <h3>
                รายการที่เกินเงื่อนไขสูงสุด
              </h3>
            </div>

            <span class="shift-panel-count">
              ${formatNumber(
                Array.isArray(
                  process.exceptions
                )
                  ? process.exceptions.length
                  : 0
              )}
              รายการ
            </span>
          </header>

          <div class="process-exception-list">
            ${processExceptionListHtml(
              process.exceptions
            )}
          </div>
        </article>
      </section>

      <footer class="shift-dashboard-footer">
        <span>
          อัปเดต
          ${escapeHtml(
            dashboardDisplayDateTime(
              process.generatedAt ||
              data.generatedAt
            )
          )}
        </span>

        <span>
          เกณฑ์อ้างอิงจากชีท
          ${escapeHtml(
            rules.sourceSheet ||
            'กฎเวลาแจ้งเตือนงานเอกสาร'
          )}
          เท่านั้น
        </span>
      </footer>
    `;
  }


  function processKpiHtml(
    label,
    value,
    note,
    className
  ) {
    return `
      <article class="process-kpi ${escapeHtml(
        className ||
        ''
      )}">
        <span>
          ${escapeHtml(label)}
        </span>

        <strong>
          ${escapeHtml(
            value ??
            '-'
          )}
        </strong>

        <small>
          ${escapeHtml(
            note ||
            ''
          )}
        </small>
      </article>
    `;
  }


  function processStageCardHtml(
    stage
  ) {
    const item =
      stage ||
      {};

    const rule =
      item.rule ||
      {};

    const ruleText =
      rule.configured === true
        ? `เหลือง ${formatMinutes(
            rule.warningMinutes
          )} · แดง ${formatMinutes(
            rule.redMinutes
          )}`
        : 'ยังไม่ตั้งเกณฑ์ใน Admin';

    return `
      <article
        class="process-stage-card"
        data-rule-state="${
          rule.configured === true
            ? 'READY'
            : 'MISSING'
        }"
      >
        <header>
          <span>
            ${escapeHtml(
              item.shortLabel ||
              item.label ||
              '-'
            )}
          </span>

          <em>
            ${escapeHtml(
              rule.source === 'MODULE'
                ? 'Module'
                : rule.source === 'DEFAULT'
                  ? 'Default'
                  : 'ไม่มีเกณฑ์'
            )}
          </em>
        </header>

        <div class="process-stage-card__metrics">
          <div>
            <span>เฉลี่ย</span>
            <strong>${formatMinutes(
              item.averageMinutes
            )}</strong>
          </div>

          <div>
            <span>P90</span>
            <strong>${formatMinutes(
              item.p90Minutes
            )}</strong>
          </div>

          <div>
            <span>เกินแดง</span>
            <strong>${formatNumber(
              item.criticalCount
            )} / ${formatNumber(
              item.evaluatedCount
            )}</strong>
          </div>
        </div>

        <footer>
          <span>
            ${escapeHtml(ruleText)}
          </span>

          <strong>
            ${formatPercent(
              item.averageSharePercent
            )}
            ของเวลาเฉลี่ย
          </strong>
        </footer>
      </article>
    `;
  }


  function processFunnelHtml(
    funnel
  ) {
    const data =
      funnel ||
      {};

    const base =
      Math.max(
        1,
        Number(
          data.gateIn
        ) ||
        0
      );

    const steps = [
      ['Gate In', data.gateIn],
      ['ยื่นเอกสาร', data.documentSubmitted],
      ['รับสินค้าเสร็จ', data.receivingCompleted],
      ['รับเอกสารคืน', data.documentReturned],
      ['Gate Out จริง', data.gateOutActual]
    ];

    return `
      <div class="process-funnel-steps">
        ${steps.map(
          function (step, index) {
            const count =
              Number(
                step[1]
              ) ||
              0;

            const percent =
              Math.max(
                7,
                Math.min(
                  100,
                  (
                    count /
                    base
                  ) *
                  100
                )
              );

            return `
              <div class="process-funnel-step">
                <span>
                  ${escapeHtml(step[0])}
                </span>

                <i style="width:${escapeHtml(
                  String(percent)
                )}%"></i>

                <strong>
                  ${formatNumber(count)}
                </strong>
              </div>
            `;
          }
        ).join('')}
      </div>

      <div class="process-funnel-summary">
        <span>
          Auto Close
          <strong>${formatNumber(
            data.autoClose
          )}</strong>
        </span>

        <span>
          ยังเปิดอยู่
          <strong>${formatNumber(
            data.open
          )}</strong>
        </span>

        <span>
          ยกเลิก
          <strong>${formatNumber(
            data.cancelled
          )}</strong>
        </span>
      </div>
    `;
  }


  function processExceptionListHtml(
    exceptions
  ) {
    const rows =
      Array.isArray(exceptions)
        ? exceptions
        : [];

    if (!rows.length) {
      return `
        <div class="shift-empty-state">
          ไม่พบรายการเกินเกณฑ์แดง
        </div>
      `;
    }

    return rows
      .slice(0, 10)
      .map(
        function (item, index) {
          return `
            <article class="process-exception-item">
              <b>${index + 1}</b>

              <div>
                <strong>
                  ${escapeHtml(
                    item.company ||
                    item.appointmentNumber ||
                    item.autoId ||
                    '-'
                  )}
                </strong>

                <span>
                  ${escapeHtml(
                    item.stageLabel ||
                    '-'
                  )}
                  ·
                  ${escapeHtml(
                    item.registration ||
                    item.autoId ||
                    '-'
                  )}
                </span>
              </div>

              <div class="process-exception-time">
                <strong>
                  ${formatMinutes(
                    item.elapsedMinutes
                  )}
                </strong>

                <span>
                  เกิน ${formatMinutes(
                    item.overMinutes
                  )}
                </span>
              </div>
            </article>
          `;
        }
      )
      .join('');
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

    const context =
      daily.context ||
      {};

    const executive =
      data.executive ||
      {};

    const history =
      dailyHistoryRows(
        data
      );

    const workload =
      context.workload ||
      {};

    return `
      <header class="shift-executive-header">
        <div>
          <small>
            สรุปตามวันปฏิบัติงาน
          </small>

          <div class="shift-title-line">
            <h2>
              สรุปรายวัน
            </h2>

            <button
              type="button"
              class="dashboard-info-button"
              data-dashboard-info="daily"
              aria-label="อธิบายข้อมูลรายวัน"
            >
              i
            </button>
          </div>

          <p>
            ${escapeHtml(
              dashboardDisplayDateTime(
                daily.businessDayStart
              )
            )}
            –
            ${escapeHtml(
              dashboardDisplayDateTime(
                daily.businessDayEnd
              )
            )}

            ${
              isCrossDayWindow(
                daily.businessDayStart,
                daily.businessDayEnd
              )
                ? `
                    <em class="shift-cross-day-badge is-business-day">
                      วันปฏิบัติงานข้ามวัน
                    </em>
                  `
                : ''
            }

            ·
            <strong>
              ${escapeHtml(
                daily.statusLabel ||
                '-'
              )}
            </strong>
          </p>

          <div class="shift-methodology-note">
            ${
              daily.status === 'LIVE'
                ? 'ข้อมูลระหว่างวันยังไม่ใช้ตัดสินระดับภาระงาน จนกว่าจะจบวันปฏิบัติงาน'
                : `${escapeHtml(
                    workload.label ||
                    'รอข้อมูลอ้างอิง'
                  )} · อ้างอิงวันย้อนหลัง ${
                    formatNumber(
                      context
                        .historicalSampleCount
                    )
                  } วัน`
            }
          </div>
        </div>

        <div class="shift-executive-badges">
          <span class="${
            daily.status === 'LIVE'
              ? 'is-live'
              : 'is-neutral'
          }">
            ${escapeHtml(
              daily.statusLabel ||
              daily.status ||
              '-'
            )}
          </span>

          ${
            executive.highestWorkloadShiftCode
              ? `
                  <span class="is-workload">
                    ภาระงานสูงสุด
                    ${escapeHtml(
                      executive
                        .highestWorkloadShiftCode
                    )}
                  </span>
                `
              : ''
          }

          ${
            executive.backlogReductionShiftCode
              ? `
                  <span class="is-best">
                    ลดคงค้างมากสุด
                    ${escapeHtml(
                      executive
                        .backlogReductionShiftCode
                    )}
                  </span>
                `
              : ''
          }

          ${
            executive.highWaitShiftCode
              ? `
                  <span class="is-attention">
                    เวลารอสูงสุด
                    ${escapeHtml(
                      executive
                        .highWaitShiftCode
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
          metric.openingBalance,
          '',
          'openingBalance'
        )}

        ${dailyMetricHtml(
          'เข้าพื้นที่',
          metric.gateIn,
          '',
          'gateIn'
        )}

        ${dailyMetricHtml(
          'ออกจริง',
          metric.gateOutActual,
          '',
          'gateOut'
        )}

        ${dailyMetricHtml(
          'ปิดอัตโนมัติ',
          metric.autoClose,
          '',
          'autoClose'
        )}

        ${dailyMetricHtml(
          'คงค้างปลายวัน',
          metric.closingBalance,
          '',
          'closingBalance'
        )}

        ${dailyMetricHtml(
          'คงค้างเปลี่ยนแปลง',
          signed(
            metricBacklogChange(
              metric
            )
          ),
          Number(
            metricBacklogChange(
              metric
            )
          ) > 0
            ? 'is-danger'
            : '',
          'backlogChange'
        )}

        ${dailyMetricHtml(
          'สูงสุดในพื้นที่',
          metric.peakActive,
          '',
          'peakActive'
        )}

        ${dailyMetricHtml(
          'เกินเกณฑ์',
          `${metricOverCount(
            metric
          )} / ${metricEvaluated(
            metric
          )}`,
          metricOverCount(
            metric
          ) > 0
            ? 'is-danger'
            : '',
          'overThreshold',
          formatPercent(
            metricOverPercent(
              metric
            )
          )
        )}

        ${dailyMetricHtml(
          'ค่ากลางเวลา',
          formatMinutes(
            metricMedian(
              metric
            )
          ),
          '',
          'median'
        )}

        ${dailyMetricHtml(
          'เวลาเฉลี่ย',
          formatMinutes(
            metric
              .averageDwellMinutes
          ),
          '',
          'average'
        )}

        ${dailyMetricHtml(
          'เวลาส่วนใหญ่',
          formatMinutes(
            metric
              .p90DwellMinutes
          ),
          '',
          'p90'
        )}

        ${dailyMetricHtml(
          'ความครบถ้วนข้อมูล',
          formatPercent(
            metric
              .dataCompletenessPercent
          ),
          '',
          'dataCompleteness'
        )}
      </section>

      <section class="daily-dashboard-analysis">
        <article class="shift-analysis-panel daily-trend-panel">
          <header>
            <div>
              <small>
                แนวโน้มย้อนหลัง
              </small>

              <div class="shift-panel-title-line">
                <h3>
                  เข้า ออก และคงค้าง
                </h3>

                <button
                  type="button"
                  class="dashboard-info-button is-small"
                  data-dashboard-info="dailyTrend"
                  aria-label="อธิบายแนวโน้มรายวัน"
                >
                  i
                </button>
              </div>
            </div>
          </header>

          <div class="daily-history-chart-wrap">
            <canvas
              id="dailyShiftHistoryChart"
            ></canvas>
          </div>
        </article>

        <article class="shift-analysis-panel daily-history-panel">
          <header>
            <div>
              <small>
                ข้อมูลย้อนหลัง
              </small>

              <h3>
                รายละเอียดรายวัน
              </h3>
            </div>

            <span class="shift-panel-count">
              ${history.length}
              วัน
            </span>
          </header>

          <div class="daily-history-table-wrap">
            ${dailyHistoryTable(
              history.slice(
                0,
                14
              )
            )}
          </div>
        </article>

        <article class="daily-insight-panel">
          <header>
            <small>
              สรุปสำหรับผู้บริหาร
            </small>

            <h3>
              ประเด็นสำคัญวันนี้
            </h3>
          </header>

          ${dailyInsightItem(
            'กะภาระงานสูงสุด',
            executive
              .highestWorkloadShiftCode ||
            '-',
            'ปริมาณรถเข้าหรือค่าประมาณสูงสุด'
          )}

          ${dailyInsightItem(
            'กะลดคงค้างมากสุด',
            executive
              .backlogReductionShiftCode ||
            '-',
            'เปรียบเทียบปลายกะกับต้นกะ'
          )}

          ${dailyInsightItem(
            'กะเวลารอสูงสุด',
            executive
              .highWaitShiftCode ||
            '-',
            'พิจารณาจากเวลาส่วนใหญ่'
          )}

          ${dailyInsightItem(
            'ฐานอ้างอิงใกล้เคียง',
            context.similarSampleCount
              ? `${formatNumber(
                  context
                    .similarSampleCount
                )} วัน`
              : daily.status === 'LIVE'
                ? 'รอปิดวัน'
                : 'ข้อมูลยังน้อย',
            'ไม่ใช้เป้าหมายเปอร์เซ็นต์ตายตัว'
          )}

          ${dailyInsightItem(
            'เกินเกณฑ์',
            `${metricOverCount(
              metric
            )} จาก ${metricEvaluated(
              metric
            )}`,
            `${formatPercent(
              metricOverPercent(
                metric
              )
            )} ของฐานคำนวณ`
          )}

          ${dailyInsightItem(
            'สถานะข้อมูล',
            daily.statusLabel ||
            daily.status ||
            '-',
            `ความครบถ้วน ${formatPercent(
              metric
                .dataCompletenessPercent
            )}`
          )}
        </article>
      </section>

      <footer class="shift-dashboard-footer">
        <span>
          อัปเดต
          ${escapeHtml(
            dashboardDisplayDateTime(
              data.generatedAt
            )
          )}
        </span>

        <span>
          FINAL คือ Snapshot หลังจบวัน
          · LIVE คือข้อมูลระหว่างวัน
        </span>
      </footer>
    `;
  }

  function shiftCardHtml(
    card,
    executive,
    data
  ) {
    const metric =
      card.metrics ||
      {};

    const comparison =
      card.comparison ||
      {};

    const context =
      card.context ||
      {};

    const workload =
      context.workload ||
      {};

    const signal =
      context.signals &&
      context.signals.p90Dwell
        ? context.signals.p90Dwell
        : null;

    return `
      <article
        class="shift-performance-card
          ${
            card.status === 'LIVE'
              ? 'is-live'
              : ''
          }
          ${
            signal &&
            (
              signal.status === 'HIGH' ||
              signal.status === 'ABOVE'
            )
              ? 'is-attention'
              : ''
          }"
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

              <small
                title="${escapeHtml(
                  shiftRangeTitle(
                    card
                  )
                )}"
              >
                ${escapeHtml(
                  card.start
                )}
                –
                ${escapeHtml(
                  card.end
                )}

                ${
                  card.crossesMidnight ===
                    true
                    ? `
                        <em class="shift-cross-day-badge">
                          ข้ามวัน
                        </em>
                      `
                    : ''
                }
              </small>
            </div>
          </div>

          <div class="shift-card-header-actions">
            <button
              type="button"
              class="dashboard-info-button is-small"
              data-metric-info="shiftCard"
              data-shift-code="${escapeHtml(
                card.code
              )}"
              aria-label="อธิบายข้อมูลกะ"
            >
              i
            </button>

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
          </div>
        </header>

        <div class="shift-card-flow">
          ${shiftCardMetric(
            'ต้นกะ',
            metric.openingBalance
          )}

          ${shiftCardMetric(
            'เข้าพื้นที่',
            metric.gateIn
          )}

          ${shiftCardMetric(
            'ออกจริง',
            metric.gateOutActual
          )}

          ${shiftCardMetric(
            'ปลายกะ',
            metric.closingBalance
          )}
        </div>

        <div class="shift-card-performance">
          ${shiftCardMetric(
            'คงค้างเปลี่ยน',
            signed(
              metricBacklogChange(
                metric
              )
            ),
            Number(
              metricBacklogChange(
                metric
              )
            ) > 0
              ? 'is-negative'
              : 'is-positive'
          )}

          ${shiftCardMetric(
            'ค่ากลาง',
            formatMinutes(
              metricMedian(
                metric
              )
            )
          )}

          ${shiftCardMetric(
            'เฉลี่ย',
            formatMinutes(
              metric
                .averageDwellMinutes
            )
          )}

          ${shiftCardMetric(
            'เวลาส่วนใหญ่',
            formatMinutes(
              metric
                .p90DwellMinutes
            ),
            signal &&
            (
              signal.status === 'HIGH' ||
              signal.status === 'ABOVE'
            )
              ? 'is-negative'
              : ''
          )}
        </div>

        <div class="shift-context-row">
          <div>
            <span>
              ระดับภาระงาน
            </span>

            <strong data-level="${escapeHtml(
              workload.level ||
              'INSUFFICIENT'
            )}">
              ${escapeHtml(
                workload.label ||
                'ข้อมูลอ้างอิงยังน้อย'
              )}
            </strong>

            <small>
              ${
                workload.preliminary
                  ? `ประมาณการจาก ${
                      formatNumber(
                        workload.elapsedHours
                      )
                    } ชม. แรก`
                  : `อ้างอิง ${
                      formatNumber(
                        context
                          .historicalSampleCount
                      )
                    } กะ`
              }
            </small>
          </div>

          <div>
            <span>
              เกินเกณฑ์
            </span>

            <strong class="${
              metricOverCount(
                metric
              ) > 0
                ? 'is-negative'
                : ''
            }">
              ${metricOverCount(
                metric
              )}
              /
              ${metricEvaluated(
                metric
              )}
            </strong>

            <small>
              ${formatPercent(
                metricOverPercent(
                  metric
                )
              )}
              ของฐานคำนวณ
            </small>
          </div>

          <div>
            <span>
              เทียบภาระใกล้เคียง
            </span>

            <strong data-signal="${
              signal
                ? escapeHtml(
                    signal.status
                  )
                : 'INSUFFICIENT'
            }">
              ${
                signal
                  ? escapeHtml(
                      signal.label
                    )
                  : 'ข้อมูลยังไม่พอ'
              }
            </strong>

            <small>
              ใช้
              ${formatNumber(
                context
                  .similarSampleCount
              )}
              กะอ้างอิง
            </small>
          </div>
        </div>

        <div class="shift-card-comparison">
          <span>
            ${
              comparison.mode ===
                'MATCHED_ELAPSED'
                ? `เทียบ ${
                    formatNumber(
                      comparison.hours
                    )
                  } ชม. เท่ากันกับวันก่อน`
                : 'เทียบกะเดียวกันของวันก่อน'
            }
          </span>

          ${
            comparison.available
              ? `
                  <div class="shift-compare-line">
                    <span>
                      รถเข้า
                      <strong>
                        ${signed(
                          comparison
                            .delta
                            .gateIn
                        )}
                      </strong>
                    </span>

                    <span>
                      คงค้าง
                      <strong class="${
                        Number(
                          comparison
                            .delta
                            .closingBalance
                        ) <= 0
                          ? 'is-positive'
                          : 'is-negative'
                      }">
                        ${signed(
                          comparison
                            .delta
                            .closingBalance
                        )}
                      </strong>
                    </span>

                    <span>
                      เวลาเฉลี่ย
                      <strong class="${
                        Number(
                          comparison
                            .delta
                            .averageDwellMinutes
                        ) <= 0
                          ? 'is-positive'
                          : 'is-negative'
                      }">
                        ${signed(
                          comparison
                            .delta
                            .averageDwellMinutes
                        )}
                        นาที
                      </strong>
                    </span>
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
                ปลายกะ
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
      .slice(
        0,
        5
      )
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

        medianDwellMinutes:
          metricMedian(
            metric
          ),

        overThresholdRecords:
          metricOverCount(
            metric
          ),

        overThresholdPercent:
          metricOverPercent(
            metric
          ),

        evaluatedRecords:
          metricEvaluated(
            metric
          ),

        backlogChange:
          metricBacklogChange(
            metric
          ),

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
        'ยังไม่มี Snapshot รายวัน'
      );
    }

    return `
      <table class="daily-history-table">
        <thead>
          <tr>
            <th>วันปฏิบัติงาน</th>
            <th>เข้า</th>
            <th>ออกจริง</th>
            <th>ปลายวัน</th>
            <th>เกินเกณฑ์</th>
            <th>ค่ากลาง</th>
            <th>เฉลี่ย</th>
            <th>สถานะ</th>
          </tr>
        </thead>

        <tbody>
          ${history
            .map(
              (row) => {
                const over =
                  row.overThresholdRecords !==
                    undefined
                    ? Number(
                        row
                          .overThresholdRecords
                      ) || 0
                    : Math.max(
                        0,
                        Math.round(
                          (
                            Number(
                              row.evaluatedRecords
                            ) || 0
                          ) *
                          (
                            1 -
                            (
                              Number(
                                row
                                  .slaCompliancePercent
                              ) || 100
                            ) /
                            100
                          )
                        )
                      );

                const evaluated =
                  Number(
                    row.evaluatedRecords
                  ) ||
                  Math.max(
                    0,
                    Number(
                      row.gateOutActual
                    ) +
                    Number(
                      row.autoClose
                    ) +
                    Number(
                      row.closingBalance
                    )
                  );

                return `
                  <tr>
                    <td>
                      ${escapeHtml(
                        dashboardDisplayDateTime(
                        row.businessDate
                      )
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
                        over > 0
                          ? 'is-negative'
                          : ''
                      }">
                        ${formatNumber(
                          over
                        )}
                        /
                        ${formatNumber(
                          evaluated
                        )}
                      </strong>
                    </td>

                    <td>
                      ${formatMinutes(
                        row
                          .medianDwellMinutes
                      )}
                    </td>

                    <td>
                      ${formatMinutes(
                        row
                          .averageDwellMinutes
                      )}
                    </td>

                    <td>
                      ${escapeHtml(
                        historyStatusLabel(
                          row.status
                        )
                      )}
                    </td>
                  </tr>
                `;
              }
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

    byId(
      'dashboardShiftWorkspace'
    )
      ?.querySelector(
        '[data-view-all-exceptions]'
      )
      ?.addEventListener(
        'click',
        openAllExceptions
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
              dashboardDisplayDateTime(
                card.rangeStart
              )
            )}
            –
            ${escapeHtml(
              dashboardDisplayDateTime(
                card.rangeEnd
              )
            )}
          </p>

          <div>
            ${detailItem(
              'ต้นกะ',
              metric.openingBalance
            )}

            ${detailItem(
              'เข้าพื้นที่',
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
              'คงค้าง',
              metric.closingBalance
            )}

            ${detailItem(
              'สูงสุดในพื้นที่',
              metric.peakActive
            )}

            ${detailItem(
              'เกินเกณฑ์สูงสุด',
              metric.peakOverdue
            )}

            ${detailItem(
              'เกินเกณฑ์ปลายกะ',
              metric.overdueAtEnd
            )}

            ${detailItem(
              'ผ่านเกณฑ์',
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
              'เวลาส่วนใหญ่',
              formatMinutes(
                metric
                  .p90DwellMinutes
              )
            )}

            ${detailItem(
              'นานที่สุด',
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


  function openAllExceptions() {
    const items =
      Array.isArray(
        state.data &&
        state.data.exceptions
      )
        ? state.data.exceptions
        : [];

    if (
      !items.length ||
      !window.Swal
    ) {
      return;
    }

    window.Swal.fire({
      title:
        'รายการที่ต้องติดตามทั้งหมด',

      html: `
        <div class="shift-all-exceptions">
          ${items
            .map(
              (item, index) => `
                <button
                  type="button"
                  data-all-exception-index="${index}"
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
                      นัดหมาย
                      ${escapeHtml(
                        item.appointmentNumber ||
                        '-'
                      )}
                      · กะ
                      ${escapeHtml(
                        item.shiftCode ||
                        '-'
                      )}
                    </span>
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
                            exceptionLabel(
                              item.type
                            )
                          )
                    }
                  </em>
                </button>
              `
            )
            .join('')}
        </div>
      `,

      confirmButtonText:
        'ปิด',

      width:
        'min(760px, calc(100vw - 18px))',

      didOpen:
        (popup) => {
          popup
            .querySelectorAll(
              '[data-all-exception-index]'
            )
            .forEach(
              (button) => {
                button.addEventListener(
                  'click',
                  () => {
                    const index =
                      Number(
                        button.dataset
                          .allExceptionIndex
                      );

                    window.Swal.close();

                    window.setTimeout(
                      () => {
                        openExceptionDetail(
                          index
                        );
                      },
                      120
                    );
                  }
                );
              }
            );
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
            dashboardDisplayDateTime(
              item.gateIn
            )
          )}

          ${detailItem(
            'ระยะเวลา',
            formatMinutes(
              item.durationMinutes
            )
          )}

          ${detailItem(
            'เกินเกณฑ์',
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


  function openDashboardInfo(
    key
  ) {
    openMetricInformation(
      key ||
      'overview',
      ''
    );
  }


  function openMetricInformation(
    key,
    shiftCode
  ) {
    if (
      !window.Swal ||
      typeof window.Swal.fire !==
        'function'
    ) {
      return;
    }

    const data =
      state.data ||
      {};

    const card =
      shiftCode
        ? (
            data.shifts ||
            []
          ).find(
            (item) =>
              item.code ===
              shiftCode
          )
        : null;

    const metric =
      card
        ? card.metrics ||
          {}
        : data.daily &&
          data.daily.metrics
          ? data.daily.metrics
          : {};

    const context =
      card
        ? card.context ||
          {}
        : data.daily &&
          data.daily.context
          ? data.daily.context
          : {};

    const definition =
      metricDefinition(
        key,
        metric,
        context,
        card,
        data
      );

    window.Swal.fire({
      title:
        definition.title,

      html: `
        <div class="metric-info-center">
          ${metricContextHeader(
            data,
            card,
            context
          )}

          ${metricInfoSection(
            'ความหมาย',
            definition.meaning
          )}

          ${metricInfoSection(
            'วิธีคำนวณ',
            definition.formula,
            'is-formula'
          )}

          ${metricInfoSection(
            'ตัวอย่างจากข้อมูลที่เลือก',
            definition.example
          )}

          ${metricInfoSection(
            'วิธีแปลผล',
            definition.interpretation
          )}

          ${metricInfoSection(
            'แหล่งข้อมูล',
            definition.source
          )}

          ${metricInfoSection(
            'ข้อจำกัดและข้อควรระวัง',
            definition.limitations,
            'is-warning'
          )}
        </div>
      `,

      confirmButtonText:
        'เข้าใจแล้ว',

      width:
        'min(840px, calc(100vw - 16px))',

      customClass: {
        popup:
          'metric-info-popup'
      }
    });
  }


  function metricDefinition(
    key,
    metric,
    context,
    card,
    data
  ) {
    const method =
      data.methodology ||
      {};

    const redMinutes =
      Number(
        method.redMinutes
      ) || 60;

    const over =
      metricOverCount(
        metric
      );

    const evaluated =
      metricEvaluated(
        metric
      );

    const overPercent =
      metricOverPercent(
        metric
      );

    const backlog =
      metricBacklogChange(
        metric
      );

    const workload =
      context.workload ||
      {};

    const common = {
      overview: {
        title:
          'หลักการอ่าน Dashboard',
        meaning:
          'Dashboard นี้ไม่ใช้เปอร์เซ็นต์เป้าหมายตายตัว เพราะจำนวนรถ งานค้าง ประเภทสินค้า และช่วงเวลาที่รถเข้ามาแตกต่างกันในแต่ละกะและแต่ละวัน',
        formula:
          'ใช้จำนวนจริง + สัดส่วนที่มีฐานคำนวณ + การเปลี่ยนคงค้าง + ค่ากลาง/ค่าเฉลี่ย/เวลาส่วนใหญ่ + ข้อมูลย้อนหลังที่มีภาระงานใกล้เคียงกัน',
        example:
          `เกินเกณฑ์ ${over} จาก ${evaluated} รายการ (${formatPercent(
            overPercent
          )}) เป็นข้อมูลสถานการณ์ ไม่ใช่คะแนนผลงาน`,
        interpretation:
          'พิจารณาหลายตัวชี้วัดร่วมกัน และแยกปัจจัยที่กะควบคุมได้ออกจากปัจจัยภายนอก',
        source:
          'เวลาเข้าพื้นที่ เวลาออกจริง สถานะปิดอัตโนมัติ การตั้งค่ากะ และ Snapshot ย้อนหลัง',
        limitations:
          'ปัจจัยภายนอก เช่น รถเข้ากระจุกตัว ประเภทสินค้า ช่องรับสินค้า และเหตุขัดข้อง อาจทำให้เวลาเพิ่มขึ้นโดยไม่ใช่สิ่งที่กะควบคุมได้'
      },

      shift: {
        title:
          'วิธีวิเคราะห์ผลงานตามกะ',
        meaning:
          'สรุปปริมาณงาน การไหล คงค้าง เวลา และรายการเกินเกณฑ์ของแต่ละกะ โดยแยกงานที่รับต่อจากกะก่อนออกจากงานที่เข้ามาใหม่',
        formula:
          'คงค้างเปลี่ยนแปลง = คงค้างปลายกะ − คงค้างต้นกะ\nผลต่างการไหล = ออกจริง + ปิดอัตโนมัติ − เข้าพื้นที่',
        example:
          card
            ? `กะ ${card.code}: ต้นกะ ${metric.openingBalance || 0} + เข้า ${metric.gateIn || 0} − ออกจริง ${metric.gateOutActual || 0} − ปิดอัตโนมัติ ${metric.autoClose || 0} = ปลายกะ ${metric.closingBalance || 0}`
            : 'เลือกการ์ดกะเพื่อดูตัวอย่างจากกะนั้น',
        interpretation:
          'คงค้างลดลงแสดงว่ากะช่วยระบายงานเดิม แต่ยังต้องดูเวลารอและรายการเกินเกณฑ์ประกอบ',
        source:
          'Gate In, Gate Out, Auto Close และสถานะ Active ณ ต้นและปลายกะ',
        limitations:
          'กะปัจจุบันยังไม่จบ ข้อมูลและระดับภาระงานจึงเป็นค่าระหว่างกะหรือค่าประมาณเบื้องต้น'
      },

      daily: {
        title:
          'วิธีสรุปรายวัน',
        meaning:
          'วันปฏิบัติงานเป็นช่วง 24 ชั่วโมงตามเวลาที่ Admin กำหนด เช่น 06:00 ถึง 06:00 ของวันถัดไป',
        formula:
          'คงค้างปลายวัน = คงค้างต้นวัน + เข้าพื้นที่ − ออกจริง − ปิดอัตโนมัติ ± รายการแก้ไขข้อมูล',
        example:
          `ต้นวัน ${metric.openingBalance || 0} + เข้า ${metric.gateIn || 0} − ออกจริง ${metric.gateOutActual || 0} − ปิดอัตโนมัติ ${metric.autoClose || 0} = ปลายวัน ${metric.closingBalance || 0}`,
        interpretation:
          'ใช้ดูภาระงานทั้งวัน การระบายออก และการสะสมคงค้าง',
        source:
          'ผลรวมของทุกกะในวันปฏิบัติงาน และ Daily Snapshot เมื่อปิดวันแล้ว',
        limitations:
          'ข้อมูล LIVE ระหว่างวันยังไม่ควรเปรียบเทียบตรงกับวัน FINAL ที่ครบ 24 ชั่วโมง'
      },

      gateIn: {
        title:
          'เข้าพื้นที่',
        meaning:
          'จำนวนรายการที่มีเวลา Gate In อยู่ภายในกะหรือวันปฏิบัติงานที่เลือก',
        formula:
          'นับรายการที่ Gate In ≥ เวลาเริ่มช่วง และ Gate In < เวลาสิ้นสุดช่วง',
        example:
          `พบรายการเข้าพื้นที่ ${formatNumber(
            metric.gateIn
          )} รายการ`,
        interpretation:
          'เป็นตัวบอกปริมาณงาน ไม่ใช่คะแนนประสิทธิภาพ เพราะปริมาณรถไม่สามารถควบคุมได้ทั้งหมด',
        source:
          'Timestamp In ของฐานข้อมูล Module',
        limitations:
          'รถเข้ากระจุกตัวอาจสร้างภาระสูงกว่าจำนวนรวมที่เท่ากันแต่กระจายตลอดช่วง'
      },

      gateOut: {
        title:
          'ออกจริง',
        meaning:
          'จำนวนรายการที่มี Gate Out จริงในช่วงที่เลือก โดยแยกจากรายการปิดอัตโนมัติ',
        formula:
          'นับ Timestamp Out ที่อยู่ในช่วง และตรวจว่าไม่ใช่ Auto Close',
        example:
          `ออกจริง ${formatNumber(
            metric.gateOutActual
          )} รายการ · ปิดอัตโนมัติ ${formatNumber(
            metric.autoClose
          )} รายการ`,
        interpretation:
          'ควรดูร่วมกับรถเข้าและคงค้างต้นช่วง เพื่อทราบว่าระบายงานได้มากเพียงใด',
        source:
          'Timestamp Out และดัชนี Auto Close',
        limitations:
          'หากไม่ได้บันทึก Gate Out ระบบอาจปิดอัตโนมัติภายหลัง จึงไม่ควรนับเป็นออกจริง'
      },

      openingBalance: {
        title:
          'คงค้างต้นช่วง',
        meaning:
          'รถหรือตู้ที่เข้าก่อนเวลาเริ่มกะหรือวัน และยังไม่ออกเมื่อช่วงเริ่มต้น',
        formula:
          'Gate In < เวลาเริ่มช่วง และ Gate Out ว่างหรือ Gate Out ≥ เวลาเริ่มช่วง',
        example:
          `คงค้างต้นช่วง ${formatNumber(
            metric.openingBalance
          )} รายการ`,
        interpretation:
          'เป็นภาระที่รับต่อมาจากช่วงก่อน ไม่ควรถือว่าเป็นรถเข้าของกะปัจจุบัน',
        source:
          'เวลา Gate In และ Gate Out ของรายการทั้งหมด',
        limitations:
          'Gate Out ที่บันทึกล่าช้าอาจทำให้คงค้างต้นช่วงสูงกว่าความเป็นจริง'
      },

      closingBalance: {
        title:
          'คงค้างปลายช่วง',
        meaning:
          'รถหรือตู้ที่ยังอยู่ในพื้นที่เมื่อสิ้นสุดกะ วัน หรือ ณ เวลาปัจจุบัน',
        formula:
          'ต้นช่วง + เข้า − ออกจริง − ปิดอัตโนมัติ ± การแก้ไขข้อมูล',
        example:
          `${formatNumber(
            metric.openingBalance
          )} + ${formatNumber(
            metric.gateIn
          )} − ${formatNumber(
            metric.gateOutActual
          )} − ${formatNumber(
            metric.autoClose
          )} = ${formatNumber(
            metric.closingBalance
          )}`,
        interpretation:
          'ปลายช่วงลดลงหมายถึงงานค้างถูกระบายออก แต่ต้องดูรายการเกินเกณฑ์และคุณภาพข้อมูลประกอบ',
        source:
          'สถานะ Active ณ เวลาสิ้นสุดช่วง',
        limitations:
          'ไม่สามารถบอกสาเหตุของการค้างได้เอง ต้องตรวจบริษัท ขั้นตอนรับสินค้า และข้อยกเว้นเพิ่มเติม'
      },

      backlogChange: {
        title:
          'คงค้างเปลี่ยนแปลง',
        meaning:
          'แสดงว่าระหว่างช่วงที่เลือก จำนวนรถค้างเพิ่มขึ้นหรือลดลงเท่าไร',
        formula:
          'คงค้างเปลี่ยนแปลง = คงค้างปลายช่วง − คงค้างต้นช่วง',
        example:
          `${formatNumber(
            metric.closingBalance
          )} − ${formatNumber(
            metric.openingBalance
          )} = ${signed(
            backlog
          )} รายการ`,
        interpretation:
          backlog > 0
            ? 'ค่าบวกหมายถึงคงค้างเพิ่มขึ้น ควรตรวจว่ารถเข้ากระจุกตัวหรือการระบายช้าลง'
            : backlog < 0
              ? 'ค่าลบหมายถึงสามารถลดงานค้างจากต้นช่วงได้'
              : 'คงค้างต้นและปลายช่วงเท่ากัน',
        source:
          'คงค้างต้นช่วงและคงค้างปลายช่วง',
        limitations:
          'ไม่ควรใช้ค่าเดียวตัดสินกะ เพราะกะที่รับรถเข้ามากอาจมีคงค้างเพิ่มแม้ทำงานได้ตามสภาพภาระ'
      },

      overThreshold: {
        title:
          'รายการเกินเกณฑ์เวลา',
        meaning:
          `จำนวนรายการที่อยู่ในพื้นที่ตั้งแต่ ${redMinutes} นาทีขึ้นไป เกณฑ์นี้ใช้จำแนกสถานะรายคัน ไม่ใช่เป้าหมายของทั้งกะ`,
        formula:
          'สัดส่วนเกินเกณฑ์ = จำนวนเกินเกณฑ์ ÷ จำนวนรายการที่เข้าเกณฑ์คำนวณ × 100',
        example:
          `${over} ÷ ${evaluated || 0} × 100 = ${formatPercent(
            overPercent
          )}`,
        interpretation:
          'ต้องอ่านจำนวนจริงและสัดส่วนพร้อมกัน เช่น 2 จาก 5 ต่างจาก 20 จาก 50 แม้เปอร์เซ็นต์ใกล้กัน',
        source:
          'ระยะเวลาตั้งแต่ Gate In ถึง Gate Out หรือถึงเวลาสิ้นสุดช่วงสำหรับรถที่ยังอยู่',
        limitations:
          'สัดส่วนนี้ไม่ใช่คะแนนผ่าน/ไม่ผ่าน และได้รับผลจากชนิดสินค้า รถค้างเดิม การเข้ากระจุกตัว และข้อจำกัดพื้นที่'
      },

      median: {
        title:
          'ค่ากลางเวลา (Median)',
        meaning:
          'ค่าที่แบ่งรายการออกเป็นสองส่วนใกล้เคียงกัน ครึ่งหนึ่งใช้เวลาไม่เกินค่านี้',
        formula:
          'เรียงระยะเวลาจากน้อยไปมาก แล้วเลือกค่ากลางของชุดข้อมูล',
        example:
          `ค่ากลางเวลาปัจจุบัน ${formatMinutes(
            metricMedian(
              metric
            )
          )}`,
        interpretation:
          'เหมาะสำหรับดูเวลาของรายการทั่วไป เพราะได้รับผลจากรายการค้างนานผิดปกติน้อยกว่าค่าเฉลี่ย',
        source:
          'ระยะเวลาของรายการที่ถูกนำเข้าเกณฑ์คำนวณ',
        limitations:
          'Snapshot เก่าที่สร้างก่อนรอบนี้อาจยังไม่มี Median จนกว่าจะคำนวณ Snapshot ใหม่'
      },

      average: {
        title:
          'เวลาเฉลี่ย',
        meaning:
          'ผลรวมระยะเวลาของรายการทั้งหมด หารด้วยจำนวนรายการที่เข้าเกณฑ์คำนวณ',
        formula:
          'เวลาเฉลี่ย = ผลรวมระยะเวลา ÷ จำนวนรายการที่ประเมิน',
        example:
          `เวลาเฉลี่ย ${formatMinutes(
            metric.averageDwellMinutes
          )} จากฐาน ${evaluated} รายการ`,
        interpretation:
          'รายการค้างนานเพียงไม่กี่รายการสามารถดึงค่าเฉลี่ยให้สูงขึ้นได้',
        source:
          'รถที่ออกแล้วและรถที่ยังอยู่ตามหลักคำนวณของระบบ',
        limitations:
          'ควรอ่านร่วมกับ Median และเวลาส่วนใหญ่ เพื่อแยก Outlier ออกจากรายการทั่วไป'
      },

      p90: {
        title:
          'เวลาส่วนใหญ่ (P90)',
        meaning:
          'เวลาที่ประมาณ 90% ของรายการใช้ไม่เกินค่านี้ และประมาณ 10% ใช้เวลานานกว่า',
        formula:
          'เรียงระยะเวลาทั้งหมด แล้วหาค่าที่ตำแหน่งเปอร์เซ็นไทล์ 90',
        example:
          `เวลาส่วนใหญ่ ${formatMinutes(
            metric.p90DwellMinutes
          )}`,
        interpretation:
          'หากสูงกว่า Median มาก แสดงว่ามีรายการกลุ่มหนึ่งใช้เวลานานผิดปกติ',
        source:
          'ชุดระยะเวลาของรายการที่ประเมินในช่วงที่เลือก',
        limitations:
          'ไม่ใช่เวลาสูงสุด และต้องมีจำนวนข้อมูลเพียงพอจึงจะเสถียร'
      },

      autoClose: {
        title:
          'ปิดอัตโนมัติ',
        meaning:
          'รายการที่ระบบกำหนดเวลาออกให้อัตโนมัติเมื่อไม่มีการบันทึก Gate Out ภายในระยะเวลาที่ตั้งไว้',
        formula:
          `ตรวจรายการที่ยังไม่ออกและมีอายุถึง ${formatNumber(
            method.autoCloseHours
          )} ชั่วโมง`,
        example:
          `พบปิดอัตโนมัติ ${formatNumber(
            metric.autoClose
          )} รายการ`,
        interpretation:
          'จำนวนสูงอาจสะท้อนการไม่ได้บันทึกออก ความคลาดเคลื่อนข้อมูล หรือรถอยู่เกินเวลานาน',
        source:
          'การตั้งค่า Auto Close และดัชนีรายการที่ระบบปิด',
        limitations:
          'ไม่ควรนำไปรวมกับ Gate Out จริงโดยไม่แยกประเภท'
      },

      peakActive: {
        title:
          'จำนวนสูงสุดในพื้นที่',
        meaning:
          'จำนวนรถหรือตู้ Active สูงที่สุดที่ระบบพบภายในวันปฏิบัติงาน',
        formula:
          'คำนวณยอด Active หลังจบแต่ละช่วงเวลา แล้วเลือกค่าสูงสุด',
        example:
          `สูงสุดในพื้นที่ ${formatNumber(
            metric.peakActive
          )} รายการ`,
        interpretation:
          'ใช้ดูแรงกดดันต่อพื้นที่ในช่วงพีค',
        source:
          'สรุปรายชั่วโมงและยอด Active',
        limitations:
          'ไม่บอกความจุพื้นที่สูงสุดที่รองรับได้ เว้นแต่มีข้อมูล Capacity เพิ่มเติม'
      },

      dataCompleteness: {
        title:
          'ความครบถ้วนของข้อมูล',
        meaning:
          'สัดส่วนแถวข้อมูลที่มีเวลาและข้อมูลสำคัญเพียงพอสำหรับการคำนวณ',
        formula:
          'ความครบถ้วน = จำนวนแถวที่ใช้ได้ ÷ จำนวนแถวที่ตรงเงื่อนไข × 100',
        example:
          `ความครบถ้วน ${formatPercent(
            metric.dataCompletenessPercent
          )}`,
        interpretation:
          'หากต่ำ ควรระวังการใช้ตัวเลขเวลาและคงค้างในการตัดสินใจ',
        source:
          'ผลตรวจรูปแบบ Timestamp และข้อมูลที่จำเป็นในแถวต้นทาง',
        limitations:
          '100% หมายถึงผ่านเงื่อนไขทางเทคนิค ไม่ได้ยืนยันว่าข้อมูลหน้างานถูกต้องทุกกรณี'
      },

      workload: {
        title:
          'ระดับภาระงาน',
        meaning:
          'จัดระดับจากปริมาณรถของ Module และกะเดียวกันในอดีต ไม่ใช้จำนวนรถตายตัวร่วมกันทุกคลัง',
        formula:
          'ต่ำ ≤ P25 · ช่วงปกติ P25–P75 · สูง P75–P90 · สูงมาก > P90 ของข้อมูลย้อนหลัง',
        example:
          `${escapeHtml(
            workload.label ||
            'ข้อมูลอ้างอิงยังไม่เพียงพอ'
          )} · ตัวอย่างย้อนหลัง ${formatNumber(
            workload.referenceSampleCount ||
            context.historicalSampleCount
          )} กะ`,
        interpretation:
          'ใช้บอกบริบทของภาระงาน ไม่ได้แปลว่าภาระสูงคือผลงานไม่ดี',
        source:
          'Snapshot กะย้อนหลังของ Module และรหัสกะเดียวกัน',
        limitations:
          workload.preliminary
            ? 'กะยังไม่จบ จึงเป็นค่าประมาณจากอัตรารถเข้าปัจจุบัน'
            : 'ต้องมีข้อมูลย้อนหลังหลายกะและรูปแบบการทำงานควรใกล้เคียงกัน'
      },

      handover: {
        title:
          'การส่งต่องานระหว่างกะ',
        meaning:
          'เปรียบเทียบคงค้างปลายกะก่อนกับคงค้างต้นกะถัดไป',
        formula:
          'ค่าที่ควรสอดคล้องกัน: ปลายกะก่อน = ต้นกะถัดไป',
        example:
          'หากตัวเลขไม่ตรง ระบบจะแสดงเป็นรายการที่ควรตรวจสอบรอยต่อกะ',
        interpretation:
          'ช่วยแยกงานที่กะรับต่อมาออกจากงานที่เกิดขึ้นใหม่ในกะ',
        source:
          'Snapshot ปลายกะและต้นกะตามลำดับเวลา',
        limitations:
          'การแก้ข้อมูลย้อนหลังหรือ Auto Close ในช่วงรอยต่ออาจทำให้ตัวเลขเปลี่ยน'
      },

      flow: {
        title:
          'การไหลของรถ',
        meaning:
          'เปรียบเทียบจำนวนเข้าพื้นที่ ออกจริง และคงค้างของแต่ละกะ',
        formula:
          'ผลต่างการไหล = ออกจริง + ปิดอัตโนมัติ − เข้าพื้นที่',
        example:
          `เข้า ${formatNumber(
            metric.gateIn
          )} · ออกจริง ${formatNumber(
            metric.gateOutActual
          )} · คงค้าง ${formatNumber(
            metric.closingBalance
          )}`,
        interpretation:
          'ออกมากกว่าเข้าอาจช่วยลดคงค้าง แต่ต้องตรวจว่ามี Auto Close ปะปนหรือไม่',
        source:
          'Gate In, Gate Out, Auto Close และ Active Balance',
        limitations:
          'กราฟปริมาณไม่อธิบายเหตุผลของความล่าช้า ต้องดูเวลาและข้อยกเว้นร่วมกัน'
      },

      shiftCard: {
        title:
          card
            ? `คำอธิบายกะ ${card.code}`
            : 'คำอธิบายข้อมูลกะ',
        meaning:
          'การ์ดแยกปริมาณ การเปลี่ยนคงค้าง เวลา ระดับภาระงาน และการเทียบกับข้อมูลอ้างอิง',
        formula:
          'คงค้างเปลี่ยน = ปลายกะ − ต้นกะ\nสัดส่วนเกินเกณฑ์ = จำนวนเกินเกณฑ์ ÷ ฐานคำนวณ × 100',
        example:
          card
            ? `กะ ${card.code}: คงค้างเปลี่ยน ${signed(
                backlog
              )} · เกินเกณฑ์ ${over}/${evaluated} · ${escapeHtml(
                workload.label ||
                'ข้อมูลอ้างอิงยังน้อย'
              )}`
            : 'กดปุ่ม i บนการ์ดกะที่ต้องการ',
        interpretation:
          'ไม่มีคะแนนรวมดีที่สุดแบบตายตัว แต่แยกให้เห็นกะภาระสูง กะลดคงค้าง และกะที่มีเวลารอสูง',
        source:
          'สรุปกะ ข้อมูลย้อนหลังของกะเดียวกัน และการเปรียบเทียบวันก่อน',
        limitations:
          'ปัจจัยที่กะควบคุมไม่ได้ต้องพิจารณาจากข้อมูลหน้างานเพิ่มเติม'
      },

      dailyTrend: {
        title:
          'แนวโน้มรายวัน',
        meaning:
          'แสดงจำนวนเข้า ออกจริง และคงค้างปลายวันย้อนหลัง',
        formula:
          'อ่านค่าจาก Daily Snapshot ของแต่ละวันปฏิบัติงาน',
        example:
          'ใช้ดูทิศทางเพิ่มขึ้นหรือลดลง ไม่ใช้เป็นเส้นเป้าหมาย',
        interpretation:
          'ควรดูร่วมกับระดับภาระงานและสถานะ LIVE/FINAL ของแต่ละวัน',
        source:
          'ชีทสรุปรายวัน',
        limitations:
          'จำนวนวันย้อนหลังน้อยอาจยังไม่เพียงพอสำหรับสรุปแนวโน้มระยะยาว'
      }
    };

    return (
      common[key] ||
      common.overview
    );
  }


  function metricContextHeader(
    data,
    card,
    context
  ) {
    const method =
      data.methodology ||
      {};

    return `
      <div class="metric-info-context">
        <div>
          <span>Module</span>
          <strong>
            ${escapeHtml(
              data.module &&
              data.module.name ||
              state.moduleId ||
              '-'
            )}
          </strong>
        </div>

        <div>
          <span>วันปฏิบัติงาน</span>
          <strong>
            ${escapeHtml(
              data.businessDate ||
              '-'
            )}
          </strong>
        </div>

        <div>
          <span>ขอบเขต</span>
          <strong>
            ${
              card
                ? `กะ ${escapeHtml(
                    card.code
                  )} ${escapeHtml(
                    card.start
                  )}–${escapeHtml(
                    card.end
                  )}`
                : 'รวมทั้งวัน'
            }
          </strong>
        </div>

        <div>
          <span>เกณฑ์เวลา</span>
          <strong>
            เฝ้าระวัง
            ${formatNumber(
              method.warningMinutes
            )}
            · เกิน
            ${formatNumber(
              method.redMinutes
            )}
            นาที
          </strong>
        </div>

        <div>
          <span>ข้อมูลย้อนหลัง</span>
          <strong>
            ${formatNumber(
              context
                .historicalSampleCount
            )}
            ช่วง
          </strong>
        </div>

        <div>
          <span>ภาระใกล้เคียง</span>
          <strong>
            ${formatNumber(
              context
                .similarSampleCount
            )}
            ช่วง
          </strong>
        </div>
      </div>
    `;
  }


  function metricInfoSection(
    title,
    content,
    className
  ) {
    return `
      <section class="metric-info-section ${
        className ||
        ''
      }">
        <h4>
          ${escapeHtml(
            title
          )}
        </h4>

        <div>
          ${formatInfoText(
            content
          )}
        </div>
      </section>
    `;
  }


  function formatInfoText(
    value
  ) {
    return escapeHtml(
      String(
        value ||
        '-'
      )
    )
      .replace(
        /\n/g,
        '<br>'
      );
  }


  function renderProcessCharts(
    data
  ) {
    if (
      typeof window.Chart ===
      'undefined'
    ) {
      return;
    }

    const process =
      data &&
      data.processAnalytics ||
      {};

    const stages =
      Array.isArray(
        process.stages
      )
        ? process.stages
        : [];

    renderProcessShareChart(
      stages
    );

    renderProcessSlaChart(
      stages
    );
  }


  function renderProcessShareChart(
    stages
  ) {
    const canvas =
      byId(
        'processTimeShareChart'
      );

    if (!canvas) {
      return;
    }

    const values =
      stages.map(
        function (stage) {
          return Math.max(
            0,
            Number(
              stage.averageMinutes
            ) ||
            0
          );
        }
      );

    const hasData =
      values.some(
        function (value) {
          return value > 0;
        }
      );

    state.charts.processShare =
      new window.Chart(
        canvas,
        {
          type:
            'doughnut',
          data: {
            labels:
              stages.map(
                function (stage) {
                  return stage.shortLabel ||
                    stage.label;
                }
              ),
            datasets: [
              {
                data:
                  hasData
                    ? values
                    : stages.map(
                        function () {
                          return 1;
                        }
                      ),
                backgroundColor: [
                  '#0f9d7a',
                  '#2369d8',
                  '#7c3aed',
                  '#e88709'
                ],
                borderColor:
                  '#ffffff',
                borderWidth:
                  3
              }
            ]
          },
          options: {
            responsive:
              true,
            maintainAspectRatio:
              false,
            cutout:
              '58%',
            plugins: {
              legend: {
                position:
                  'right',
                labels: {
                  usePointStyle:
                    true,
                  boxWidth:
                    8,
                  color:
                    '#294b5e',
                  font: {
                    size:
                      11,
                    weight:
                      '700'
                  },
                  generateLabels:
                    function (chart) {
                      return chart.data.labels.map(
                        function (label, index) {
                          return {
                            text:
                              label +
                              ' · ' +
                              formatMinutes(
                                values[index]
                              ),
                            fillStyle:
                              chart.data.datasets[0]
                                .backgroundColor[index],
                            strokeStyle:
                              '#ffffff',
                            lineWidth:
                              1,
                            hidden:
                              false,
                            index:
                              index,
                            pointStyle:
                              'circle'
                          };
                        }
                      );
                    }
                }
              },
              tooltip: {
                callbacks: {
                  label:
                    function (context) {
                      const stage =
                        stages[
                          context.dataIndex
                        ] ||
                        {};

                      return [
                        'เฉลี่ย ' +
                        formatMinutes(
                          stage.averageMinutes
                        ),
                        'สัดส่วน ' +
                        formatPercent(
                          stage.averageSharePercent
                        )
                      ];
                    }
                }
              }
            }
          }
        }
      );
  }


  function renderProcessSlaChart(
    stages
  ) {
    const canvas =
      byId(
        'processSlaChart'
      );

    if (!canvas) {
      return;
    }

    const options =
      chartOptions(
        true
      );

    options.indexAxis =
      'y';

    options.scales = {
      x: {
        stacked:
          true,
        beginAtZero:
          true,
        grid: {
          color:
            '#e5edf1'
        },
        ticks: {
          precision:
            0,
          color:
            '#607784'
        }
      },
      y: {
        stacked:
          true,
        grid: {
          display:
            false
        },
        ticks: {
          color:
            '#294b5e',
          font: {
            size:
              10,
            weight:
              '700'
          }
        }
      }
    };

    state.charts.processSla =
      new window.Chart(
        canvas,
        {
          type:
            'bar',
          data: {
            labels:
              stages.map(
                function (stage) {
                  return stage.shortLabel ||
                    stage.label;
                }
              ),
            datasets: [
              {
                label:
                  'ภายในเกณฑ์',
                data:
                  stages.map(
                    function (stage) {
                      return Number(
                        stage.withinCount
                      ) || 0;
                    }
                  ),
                backgroundColor:
                  '#0f9d7a',
                borderRadius:
                  4
              },
              {
                label:
                  'เฝ้าระวัง',
                data:
                  stages.map(
                    function (stage) {
                      return Number(
                        stage.warningCount
                      ) || 0;
                    }
                  ),
                backgroundColor:
                  '#e8a20a',
                borderRadius:
                  4
              },
              {
                label:
                  'เกินเวลา',
                data:
                  stages.map(
                    function (stage) {
                      return Number(
                        stage.criticalCount
                      ) || 0;
                    }
                  ),
                backgroundColor:
                  '#d93636',
                borderRadius:
                  4
              }
            ]
          },
          options:
            options
        }
      );
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
                  'เข้าพื้นที่',

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
                  'คงค้าง',

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
      data.shifts ||
      [];

    const options =
      chartOptions(
        true
      );

    options.scales = {
      x: {
        stacked:
          true,
        grid: {
          display:
            false
        },
        ticks: {
          color:
            '#334f61',
          font: {
            size:
              13,
            weight:
              '700'
          }
        }
      },
      y: {
        stacked:
          true,
        beginAtZero:
          true,
        grid: {
          color:
            '#e3ebef'
        },
        ticks: {
          precision:
            0,
          color:
            '#607784',
          font: {
            size:
              12,
            weight:
              '600'
          }
        }
      }
    };

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
                  'อยู่ภายในเกณฑ์',

                data:
                  cards.map(
                    (card) =>
                      metricWithinCount(
                        card.metrics
                      )
                  ),

                backgroundColor:
                  '#2d7f9d',

                borderRadius:
                  4
              },

              {
                label:
                  'เกินเกณฑ์',

                data:
                  cards.map(
                    (card) =>
                      metricOverCount(
                        card.metrics
                      )
                  ),

                backgroundColor:
                  '#d86b32',

                borderRadius:
                  4
              }
            ]
          },

          options:
            options
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
                  'เข้าพื้นที่',

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
              isMobileChart()
            )
        }
      );
  }


  function isMobileChart() {
    return Boolean(
      window.matchMedia &&
      window.matchMedia(
        '(max-width: 920px)'
      ).matches
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

      devicePixelRatio:
        Math.min(
          window.devicePixelRatio ||
          1,
          2
        ),

      animation: {
        duration:
          260
      },

      interaction: {
        mode:
          'index',

        intersect:
          false
      },

      layout: {
        padding: {
          top:
            8,

          right:
            8,

          bottom:
            2,

          left:
            4
        }
      },

      plugins: {
        legend: {
          position:
            'bottom',

          labels: {
            usePointStyle:
              true,

            pointStyle:
              'rectRounded',

            boxWidth:
              compact
                ? 8
                : 11,

            boxHeight:
              compact
                ? 8
                : 11,

            padding:
              compact
                ? 8
                : 16,

            color:
              '#385365',

            font: {
              size:
                compact
                  ? 10
                  : 13,

              weight:
                '700',

              family:
                'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
            }
          }
        },

        tooltip: {
          enabled:
            true,

          titleFont: {
            size:
              compact
                ? 11
                : 13
          },

          bodyFont: {
            size:
              compact
                ? 11
                : 13
          },

          padding:
            compact
              ? 8
              : 10,

          displayColors:
            true
        }
      },

      scales: {
        y: {
          beginAtZero:
            true,

          grid: {
            color:
              '#e3ebef'
          },

          border: {
            display:
              false
          },

          ticks: {
            precision:
              0,

            maxTicksLimit:
              compact
                ? 5
                : 8,

            color:
              '#607784',

            font: {
              size:
                compact
                  ? 10
                  : 12,

              weight:
                '600'
            }
          }
        },

        x: {
          grid: {
            display:
              false
          },

          border: {
            display:
              false
          },

          ticks: {
            autoSkip:
              true,

            maxRotation:
              0,

            minRotation:
              0,

            maxTicksLimit:
              compact
                ? 5
                : 10,

            color:
              '#334f61',

            font: {
              size:
                compact
                  ? 10
                  : 13,

              weight:
                '750'
            }
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


  function setWorkspaceBusy(
    active,
    message
  ) {
    const workspace =
      byId(
        'dashboardShiftWorkspace'
      );

    if (!workspace) {
      return;
    }

    workspace.classList.toggle(
      'is-refreshing',
      active === true
    );

    let badge =
      workspace.querySelector(
        '.shift-refresh-badge'
      );

    if (
      active === true &&
      !badge
    ) {
      badge =
        document.createElement(
          'div'
        );

      badge.className =
        'shift-refresh-badge';

      workspace.appendChild(
        badge
      );
    }

    if (badge) {
      badge.innerHTML = active
        ? `
            <i></i>
            <span>
              ${escapeHtml(
                message ||
                'กำลังอัปเดต'
              )}
            </span>
          `
        : '';

      badge.hidden =
        active !==
        true;
    }
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
      <div class="shift-professional-loading">
        <div class="shift-loading-title">
          <span></span>

          <div>
            <strong>
              ${escapeHtml(
                message
              )}
            </strong>

            <small>
              กำลังจัดทำข้อมูลสำหรับผู้บริหาร
            </small>
          </div>
        </div>

        <div class="shift-loading-kpis">
          ${Array.from(
            { length: 6 },
            () => '<i></i>'
          ).join('')}
        </div>

        <div class="shift-loading-cards">
          ${Array.from(
            { length: 3 },
            () => '<i></i>'
          ).join('')}
        </div>

        <div class="shift-loading-panels">
          <i></i>
          <i></i>
        </div>
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
    className,
    infoKey
  ) {
    return `
      <div class="${className || ''}">
        <span class="metric-label-line">
          ${escapeHtml(
            label
          )}

          ${
            infoKey
              ? `
                  <button
                    type="button"
                    data-metric-info="${escapeHtml(
                      infoKey
                    )}"
                    aria-label="อธิบาย ${escapeHtml(
                      label
                    )}"
                  >
                    i
                  </button>
                `
              : ''
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
    className,
    infoKey,
    subtext
  ) {
    return `
      <div class="${className || ''}">
        <span class="metric-label-line">
          ${escapeHtml(
            label
          )}

          ${
            infoKey
              ? `
                  <button
                    type="button"
                    data-metric-info="${escapeHtml(
                      infoKey
                    )}"
                    aria-label="อธิบาย ${escapeHtml(
                      label
                    )}"
                  >
                    i
                  </button>
                `
              : ''
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
          subtext
            ? `
                <small>
                  ${escapeHtml(
                    subtext
                  )}
                </small>
              `
            : ''
        }
      </div>
    `;
  }


  function shiftCardMetric(
    label,
    value,
    className
  ) {
    return `
      <div>
        <span>
          ${escapeHtml(
            label
          )}
        </span>

        <strong class="${
          className ||
          ''
        }">
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


  function dailyInsightItem(
    label,
    value,
    description
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

        <small>
          ${escapeHtml(
            description ||
            ''
          )}
        </small>
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
        'เกินเกณฑ์',
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
    return '';
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


  function metricEvaluated(
    metric
  ) {
    const explicit =
      Number(
        metric &&
        metric.evaluatedRecords
      );

    if (
      Number.isFinite(
        explicit
      ) &&
      explicit >= 0
    ) {
      return Math.round(
        explicit
      );
    }

    return Math.max(
      0,
      Math.round(
        Number(
          metric &&
          metric.gateOutActual
        ) +
        Number(
          metric &&
          metric.autoClose
        ) +
        Number(
          metric &&
          metric.closingBalance
        )
      )
    );
  }


  function metricOverCount(
    metric
  ) {
    const explicit =
      Number(
        metric &&
        metric.overThresholdRecords
      );

    if (
      Number.isFinite(
        explicit
      ) &&
      explicit >= 0
    ) {
      return Math.round(
        explicit
      );
    }

    const evaluated =
      metricEvaluated(
        metric
      );

    const compliance =
      Number(
        metric &&
        metric.slaCompliancePercent
      );

    return Math.max(
      0,
      Math.round(
        evaluated *
        (
          1 -
          (
            Number.isFinite(
              compliance
            )
              ? compliance
              : 100
          ) /
          100
        )
      )
    );
  }


  function metricWithinCount(
    metric
  ) {
    const explicit =
      Number(
        metric &&
        metric.withinThresholdRecords
      );

    if (
      Number.isFinite(
        explicit
      ) &&
      explicit >= 0
    ) {
      return Math.round(
        explicit
      );
    }

    return Math.max(
      0,
      metricEvaluated(
        metric
      ) -
      metricOverCount(
        metric
      )
    );
  }


  function metricOverPercent(
    metric
  ) {
    const explicit =
      Number(
        metric &&
        metric.overThresholdPercent
      );

    if (
      Number.isFinite(
        explicit
      ) &&
      explicit >= 0
    ) {
      return explicit;
    }

    const evaluated =
      metricEvaluated(
        metric
      );

    return evaluated > 0
      ? (
          metricOverCount(
            metric
          ) /
          evaluated
        ) *
        100
      : 0;
  }


  function metricBacklogChange(
    metric
  ) {
    const explicit =
      Number(
        metric &&
        metric.backlogChange
      );

    if (
      Number.isFinite(
        explicit
      )
    ) {
      return explicit;
    }

    return (
      Number(
        metric &&
        metric.closingBalance
      ) -
      Number(
        metric &&
        metric.openingBalance
      )
    );
  }


  function metricMedian(
    metric
  ) {
    const value =
      Number(
        metric &&
        metric.medianDwellMinutes
      );

    return Number.isFinite(
      value
    )
      ? value
      : 0;
  }


  function historyStatusLabel(
    status
  ) {
    const labels = {
      LIVE:
        'ระหว่างวัน',
      FINAL:
        'ปิดวันแล้ว',
      CALCULATED:
        'คำนวณแล้ว',
      RECALCULATED:
        'คำนวณใหม่',
      PROVISIONAL:
        'สรุปเบื้องต้น'
    };

    return (
      labels[
        String(
          status ||
          ''
        ).toUpperCase()
      ] ||
      status ||
      '-'
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



  function normalizeBusinessDateValue(
    value
  ) {
    const text =
      String(
        value ||
        ''
      ).trim();

    const isoMatch =
      text.match(
        /^(\d{4})-(\d{2})-(\d{2})/
      );

    if (isoMatch) {
      return (
        isoMatch[1] + '-' +
        isoMatch[2] + '-' +
        isoMatch[3]
      );
    }

    const dmyMatch =
      text.match(
        /^(\d{2})\/(\d{2})\/(\d{4})/
      );

    if (dmyMatch) {
      return (
        dmyMatch[3] + '-' +
        dmyMatch[2] + '-' +
        dmyMatch[1]
      );
    }

    return todayIso();
  }


  function shiftRangeTitle(
    card
  ) {
    const item =
      card &&
      typeof card ===
        'object'
        ? card
        : {};

    const start =
      dashboardDisplayDateTime(
        item.rangeStart
      );

    const end =
      dashboardDisplayDateTime(
        item.rangeEnd
      );

    if (
      start !== '-' &&
      end !== '-'
    ) {
      return (
        'ช่วงจริง ' +
        start +
        ' – ' +
        end +
        (
          item.crossesMidnight ===
            true
            ? ' (ข้ามวัน)'
            : ''
        )
      );
    }

    return (
      String(
        item.start ||
        ''
      ) +
      ' – ' +
      String(
        item.end ||
        ''
      )
    ).trim();
  }


  function isCrossDayWindow(
    startValue,
    endValue
  ) {
    const startText =
      dashboardDisplayDateTime(
        startValue
      );

    const endText =
      dashboardDisplayDateTime(
        endValue
      );

    const startDate =
      startText.match(
        /^(\d{2}\/\d{2}\/\d{4})/
      );

    const endDate =
      endText.match(
        /^(\d{2}\/\d{2}\/\d{4})/
      );

    return Boolean(
      startDate &&
      endDate &&
      startDate[1] !==
        endDate[1]
    );
  }


 function dashboardDisplayDateTime(
  value
) {
  const text =
    String(value || '')
      .trim();

  if (!text) {
    return '-';
  }

  if (
    /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}$/.test(text)
  ) {
    return text;
  }

  /*
   * ต้องตรวจ dd/MM/yyyy ก่อน new Date()
   * เพื่อป้องกัน Browser ตีความ 04/07/2026 เป็น MM/DD/YYYY
   */
  const dmyMatch =
    text.match(
      /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/
    );

  if (dmyMatch) {
    return (
      dmyMatch[1] + '/' +
      dmyMatch[2] + '/' +
      dmyMatch[3] + ' ' +
      String(dmyMatch[4] || '00')
        .padStart(2, '0') + ':' +
      String(dmyMatch[5] || '00')
        .padStart(2, '0') + ':' +
      String(dmyMatch[6] || '00')
        .padStart(2, '0')
    );
  }

  const isoMatch =
    text.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}):(\d{2}))?$/
    );

  if (isoMatch) {
    const date =
      new Date(
        isoMatch[1] + '-' +
        isoMatch[2] + '-' +
        isoMatch[3] + 'T' +
        String(isoMatch[4] || '00')
          .padStart(2, '0') + ':' +
        String(isoMatch[5] || '00')
          .padStart(2, '0') + ':' +
        String(isoMatch[6] || '00')
          .padStart(2, '0') +
        '+07:00'
      );

    if (
      !Number.isNaN(
        date.getTime()
      )
    ) {
      return formatBangkokDateTimeFromDate(
        date
      );
    }
  }

  const nativeDate =
    new Date(text);

  if (
    !Number.isNaN(
      nativeDate.getTime()
    )
  ) {
    return formatBangkokDateTimeFromDate(
      nativeDate
    );
  }

  return text;
}


  function formatBangkokDateTimeFromDate(
    date
  ) {
    const parts =
      new Intl.DateTimeFormat(
        'en-GB',
        {
          timeZone:
            'Asia/Bangkok',
          day:
            '2-digit',
          month:
            '2-digit',
          year:
            'numeric',
          hour:
            '2-digit',
          minute:
            '2-digit',
          second:
            '2-digit',
          hour12:
            false
        }
      )
        .formatToParts(date)
        .reduce(
          (result, part) => {
            result[part.type] =
              part.value;

            return result;
          },
          {}
        );

    return (
      parts.day + '/' +
      parts.month + '/' +
      parts.year + ' ' +
      parts.hour + ':' +
      parts.minute + ':' +
      parts.second
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

    state.followCurrentBusinessDate =
      false;

    state.data =
      null;

    syncDateInput();

    if (
      state.view ===
      'LIVE'
    ) {
      setView(
        'DAILY'
      );

      return;
    }

    loadShiftDashboard();
  }


  function openHistoricalCalendar() {
    const input =
      byId(
        'dashboardShiftDate'
      );

    if (!input) {
      return;
    }

    input.max =
      todayIso();

    if (
      typeof input.showPicker ===
      'function'
    ) {
      try {
        input.showPicker();
        return;
      } catch (error) {
        console.warn(
          'เปิดปฏิทินด้วย showPicker ไม่สำเร็จ',
          error
        );
      }
    }

    input.focus();
    input.click();
  }


  function syncDateInput() {
    const input =
      byId(
        'dashboardShiftDate'
      );

    if (input) {
      state.selectedDate =
        normalizeBusinessDateValue(
          state.selectedDate
        );

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
            state.followCurrentBusinessDate ||
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


  function bindLayoutObservers() {
    const handler =
      scheduleLayoutRefresh;

    document.addEventListener(
      'fullscreenchange',
      handler
    );

    window.addEventListener(
      'resize',
      handler,
      {
        passive:
          true
      }
    );

    window.addEventListener(
      'orientationchange',
      handler,
      {
        passive:
          true
      }
    );

  }


  function scheduleLayoutRefresh() {
    if (
      state.layoutTimer
    ) {
      window.clearTimeout(
        state.layoutTimer
      );
    }

    window.requestAnimationFrame(
      () => {
        syncViewportMetrics();

        state.layoutTimer =
          window.setTimeout(
            () => {
              syncViewportMetrics();
              resizeCharts();
            },
            180
          );
      }
    );
  }


  function syncViewportMetrics() {
    const header =
      document.querySelector(
        '.control-header'
      );

    const measuredHeaderHeight =
      header
        ? Math.ceil(
            header
              .getBoundingClientRect()
              .height
          )
        : 76;

    const isSmallScreen =
      window.matchMedia &&
      window.matchMedia(
        '(max-width: 920px)'
      ).matches;

    /*
     * ROUND 80:
     * desktop ต้องใช้ค่ามาตรฐาน เพื่อกัน header สูงค้าง
     * หลังจากย่อหน้าต่างเข้า breakpoint มือถือแล้วขยายกลับ
     */
    const headerHeight =
      isSmallScreen
        ? measuredHeaderHeight
        : 76;

    document.documentElement
      .style.setProperty(
        '--shift-dashboard-header-height',
        `${headerHeight}px`
      );

    document.documentElement
      .style.setProperty(
        '--shift-dashboard-viewport-height',
        `${window.innerHeight}px`
      );

    document.body.classList.toggle(
      'is-dashboard-fullscreen',
      Boolean(
        document.fullscreenElement
      )
    );
  }


  function resizeCharts() {
    Object.values(
      state.charts
    ).forEach(
      (chart) => {
        if (
          chart &&
          typeof chart.resize ===
            'function'
        ) {
          chart.resize();
        }
      }
    );
  }


  function destroy() {
    stopRefreshTimer();
    destroyCharts();

    if (
      state.layoutTimer
    ) {
      window.clearTimeout(
        state.layoutTimer
      );
    }

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
