/************************************************************
 * module-focus.js
 * ROUND 54 — Card-first Workspace with Full Record Bridge
 *
 * เป้าหมาย:
 * - เปิดหน้าแล้วเห็นการ์ดรถ/ตู้ทันที
 * - เก็บส่วนสรุปเดิมไว้เป็น Data Source
 * - เปิดภาพรวม/งานเร่งด่วน/Receiving/รอบ/สถิติ
 *   ผ่าน SweetAlert เมื่อผู้ใช้ต้องการ
 ************************************************************/

(function (window, document) {
  'use strict';

  const state = {
    observer:
      null,

    syncTimer:
      null,

    sortTimer:
      null,

    userChangedFilter:
      false,

    defaultViewApplied:
      false,

    destroyed:
      false
  };


  document.addEventListener(
    'DOMContentLoaded',
    initialize
  );

  window.addEventListener(
    'beforeunload',
    destroy
  );


  function initialize() {
    bindToolbar();
    bindVehicleTools();
    syncWorkspace();

    state.observer =
      new MutationObserver(
        scheduleSync
      );

    state.observer.observe(
      document.body,
      {
        subtree:
          true,
        childList:
          true,
        characterData:
          true,
        attributes:
          true,
        attributeFilter: [
          'class',
          'data-status',
          'data-receiving-stage',
          'aria-hidden',
          'aria-pressed'
        ]
      }
    );

    window.setTimeout(
      applyDefaultCardView,
      900
    );

    window.setTimeout(
      syncWorkspace,
      1300
    );

    document.addEventListener(
      'alertvendor:records-updated',
      () => {
        syncWorkspace();
        applyCardSort();
      }
    );
  }


  function destroy() {
    state.destroyed =
      true;

    if (state.observer) {
      state.observer.disconnect();
    }

    window.clearTimeout(
      state.syncTimer
    );

    window.clearTimeout(
      state.sortTimer
    );
  }


  function bindToolbar() {
    document
      .querySelectorAll(
        '[data-focus-status]'
      )
      .forEach(
        (button) => {
          button.addEventListener(
            'click',
            () => {
              state.userChangedFilter =
                true;

              applyStatusFilter(
                button.dataset
                  .focusStatus ||
                'ALL'
              );
            }
          );
        }
      );

    document
      .querySelectorAll(
        '[data-focus-receiving]'
      )
      .forEach(
        (button) => {
          button.addEventListener(
            'click',
            () => {
              state.userChangedFilter =
                true;

              applyReceivingFilter(
                button.dataset
                  .focusReceiving ||
                'ALL'
              );
            }
          );
        }
      );

    document
      .querySelectorAll(
        '[data-focus-insight]'
      )
      .forEach(
        (button) => {
          button.addEventListener(
            'click',
            () => {
              openInsight(
                button.dataset
                  .focusInsight
              );
            }
          );
        }
      );
  }


  function bindVehicleTools() {
    const statusFilter =
      document.getElementById(
        'statusFilter'
      );

    const sortSelect =
      document.getElementById(
        'focusSortSelect'
      );

    statusFilter
      ?.addEventListener(
        'change',
        () => {
          state.userChangedFilter =
            true;

          syncActiveFilters();
        }
      );

    sortSelect
      ?.addEventListener(
        'change',
        () => {
          state.userChangedFilter =
            true;
          applyCardSort();
        }
      );
  }


  function applyDefaultCardView() {
    if (
      state.destroyed ||
      state.userChangedFilter ||
      state.defaultViewApplied
    ) {
      return;
    }

    state.defaultViewApplied =
      true;

    setStatusSelect(
      'ALL'
    );

    clickReceivingFilter(
      'ALL'
    );

    applyCardSort();
    syncActiveFilters();
  }


  function applyStatusFilter(
    status
  ) {
    clickReceivingFilter(
      'ALL'
    );

    setStatusSelect(
      status
    );

    syncActiveFilters();
    applyCardSort();
  }


  function applyReceivingFilter(
    stage
  ) {
    setStatusSelect(
      'ALL'
    );

    clickReceivingFilter(
      stage
    );

    syncActiveFilters();
    applyCardSort();
  }


  function setStatusSelect(
    status
  ) {
    const select =
      document.getElementById(
        'statusFilter'
      );

    if (!select) {
      return;
    }

    select.value =
      String(
        status ||
        'ALL'
      ).toUpperCase();

    select.dispatchEvent(
      new Event(
        'change',
        {
          bubbles:
            true
        }
      )
    );
  }


  function clickReceivingFilter(
    stage
  ) {
    const button =
      document.querySelector(
        `#receivingFlowPanel [data-receiving-filter="${String(
          stage ||
          'ALL'
        ).toUpperCase()}"]`
      );

    button?.click();
  }


  function scheduleSync() {
    if (state.destroyed) {
      return;
    }

    window.clearTimeout(
      state.syncTimer
    );

    state.syncTimer =
      window.setTimeout(
        syncWorkspace,
        100
      );

    window.clearTimeout(
      state.sortTimer
    );

    state.sortTimer =
      window.setTimeout(
        applyCardSort,
        180
      );
  }


  function syncWorkspace() {
    syncCounts();
    syncActiveFilters();
    syncReceivingAvailability();
  }


  function syncCounts() {
    setText(
      'focusCountAll',
      readText(
        'controlTotal',
        'summaryTotal'
      )
    );

    setText(
      'focusCountNormal',
      readText(
        'controlNormal',
        'summaryNormal'
      )
    );

    setText(
      'focusCountWarning',
      readText(
        'controlWarning',
        'summaryWarning'
      )
    );

    setText(
      'focusCountOverdue',
      readText(
        'controlOverdue',
        'summaryOverdue'
      )
    );

    setText(
      'focusCountWaitingReceiving',
      readText(
        'receivingWaitingCount',
        'receivingFilterWaitingCount'
      )
    );

    setText(
      'focusCountWaitingGateOut',
      readText(
        'receivingWaitingGateOutCount',
        'receivingFilterGateOutCount'
      )
    );
  }


  function syncReceivingAvailability() {
    const panel =
      document.getElementById(
        'receivingFlowPanel'
      );

    const available =
      Boolean(
        panel &&
        !panel.classList.contains(
          'is-hidden'
        ) &&
        panel.getAttribute(
          'aria-hidden'
        ) !== 'true'
      );

    document
      .querySelectorAll(
        '.module-focus-receiving-filter'
      )
      .forEach(
        (button) => {
          button.hidden =
            !available;
        }
      );

    const insightButton =
      document.getElementById(
        'focusReceivingInsightButton'
      );

    if (insightButton) {
      insightButton.hidden =
        !available;
    }
  }


  function syncActiveFilters() {
    const status =
      String(
        document.getElementById(
          'statusFilter'
        )?.value ||
        'ALL'
      ).toUpperCase();

    const receiving =
      String(
        document.querySelector(
          '#receivingFlowPanel [data-receiving-filter][aria-pressed="true"]'
        )?.dataset
          .receivingFilter ||
        'ALL'
      ).toUpperCase();

    document
      .querySelectorAll(
        '[data-focus-status]'
      )
      .forEach(
        (button) => {
          const active =
            receiving === 'ALL' &&
            String(
              button.dataset
                .focusStatus ||
              ''
            ).toUpperCase() ===
              status;

          button.classList.toggle(
            'is-active',
            active
          );
        }
      );

    document
      .querySelectorAll(
        '[data-focus-receiving]'
      )
      .forEach(
        (button) => {
          const active =
            status === 'ALL' &&
            String(
              button.dataset
                .focusReceiving ||
              ''
            ).toUpperCase() ===
              receiving;

          button.classList.toggle(
            'is-active',
            active
          );
        }
      );
  }


  function applyCardSort() {
    const list =
      document.getElementById(
        'vehicleList'
      );

    if (!list) {
      return;
    }

    const mode =
      document.getElementById(
        'focusSortSelect'
      )?.value ||
      'LONGEST';

    const cards =
      Array.from(
        list.querySelectorAll(
          '.vehicle-card'
        )
      );

    if (
      cards.length < 2
    ) {
      return;
    }

    cards.sort(
      (a, b) =>
        compareCards(
          a,
          b,
          mode
        )
    );

    const fragment =
      document.createDocumentFragment();

    cards.forEach(
      (card) => {
        fragment.appendChild(
          card
        );
      }
    );

    list.appendChild(
      fragment
    );
  }


  function compareCards(
    a,
    b,
    mode
  ) {
    if (mode === 'NEWEST') {
      return (
        readGateInEpoch(b) -
        readGateInEpoch(a)
      );
    }

    if (mode === 'APPOINTMENT') {
      return getField(
        a,
        [
          'นัดหมาย',
          'appointment'
        ]
      ).localeCompare(
        getField(
          b,
          [
            'นัดหมาย',
            'appointment'
          ]
        ),
        'th',
        {
          numeric:
            true
        }
      );
    }

    if (mode === 'COMPANY') {
      return getCompany(a)
        .localeCompare(
          getCompany(b),
          'th'
        );
    }

    return (
      readDurationSeconds(b) -
      readDurationSeconds(a)
    );
  }


  function readDurationSeconds(
    card
  ) {
    const value =
      card.querySelector(
        '.vehicle-card__timer'
      )?.textContent ||
      '0';

    const numbers =
      String(value)
        .match(/\d+/g)
        ?.map(Number) ||
      [];

    if (numbers.length >= 3) {
      return (
        numbers[
          numbers.length - 3
        ] *
          3600 +
        numbers[
          numbers.length - 2
        ] *
          60 +
        numbers[
          numbers.length - 1
        ]
      );
    }

    return 0;
  }


  function readGateInEpoch(
    card
  ) {
    const value =
      getField(
        card,
        [
          'gate in',
          'เวลาเข้าพื้นที่',
          'เข้าพื้นที่'
        ]
      );

    const match =
      value.match(
        /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/
      );

    if (!match) {
      return 0;
    }

    return new Date(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6])
    ).getTime();
  }


  function openInsight(
    type
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
        type ||
        ''
      ).toUpperCase();

    if (normalized === 'URGENT') {
      openUrgentInsight();
      return;
    }

    if (normalized === 'RECEIVING') {
      openReceivingInsight();
      return;
    }

    if (normalized === 'ROUND') {
      openRoundInsight();
      return;
    }

    if (normalized === 'STATS') {
      openStatsInsight();
      return;
    }

    openOverviewInsight();
  }


  function openOverviewInsight() {
    const items = [
      {
        label:
          'ทั้งหมด',
        value:
          readText(
            'controlTotal',
            'summaryTotal'
          ),
        status:
          'ALL'
      },
      {
        label:
          'ปกติ',
        value:
          readText(
            'controlNormal',
            'summaryNormal'
          ),
        status:
          'NORMAL'
      },
      {
        label:
          'ใกล้เกินเวลา',
        value:
          readText(
            'controlWarning',
            'summaryWarning'
          ),
        status:
          'WARNING'
      },
      {
        label:
          'เกินเวลา',
        value:
          readText(
            'controlOverdue',
            'summaryOverdue'
          ),
        status:
          'OVERDUE'
      },
      {
        label:
          'ข้อมูลไม่สมบูรณ์',
        value:
          readText(
            'controlIncomplete',
            'summaryIncomplete'
          ),
        status:
          'INCOMPLETE'
      },
      {
        label:
          document.getElementById(
            'controlNearAutoCloseLabel'
          )?.textContent ||
          'ใกล้เคลียร์อัตโนมัติ',
        value:
          readText(
            'controlNearAutoClose'
          ),
        status:
          ''
      }
    ];

    showFocusModal({
      title:
        'ภาพรวมสถานะรถในพื้นที่',

      subtitle:
        document.getElementById(
          'situationLabel'
        )?.textContent ||
        'สถานการณ์ปัจจุบัน',

      html: `
        <div class="focus-modal-metrics">
          ${items
            .map(
              (item) => `
                <button
                  type="button"
                  data-focus-modal-status="${escapeHtml(
                    item.status
                  )}"
                  ${item.status
                    ? ''
                    : 'disabled'}
                >
                  <span>
                    ${escapeHtml(
                      item.label
                    )}
                  </span>

                  <strong>
                    ${escapeHtml(
                      item.value
                    )}
                  </strong>
                </button>
              `
            )
            .join('')}
        </div>

        <div class="focus-modal-note">
          <strong>
            เกณฑ์เวลา
          </strong>

          <span>
            ปกติ
            ${escapeHtml(
              readText(
                'thresholdNormalText'
              )
            )}
            · เฝ้าระวัง
            ${escapeHtml(
              readText(
                'thresholdWarningText'
              )
            )}
            · เกินเวลา
            ${escapeHtml(
              readText(
                'thresholdOverdueText'
              )
            )}
          </span>
        </div>
      `,

      didOpen:
        (popup) => {
          popup
            .querySelectorAll(
              '[data-focus-modal-status]'
            )
            .forEach(
              (button) => {
                if (
                  button.disabled
                ) {
                  return;
                }

                button.addEventListener(
                  'click',
                  () => {
                    window.Swal.close();

                    applyStatusFilter(
                      button.dataset
                        .focusModalStatus
                    );
                  }
                );
              }
            );
        }
    });
  }


  function openUrgentInsight() {
    const records =
      getCardRecords()
        .filter(
          (record) =>
            record.status ===
              'OVERDUE' ||
            record.status ===
              'WARNING'
        )
        .sort(
          (a, b) =>
            b.durationSeconds -
            a.durationSeconds
        );

    showFocusModal({
      title:
        'งานเร่งด่วน',

      subtitle:
        `${records.length} รายการที่ควรติดตามก่อน`,

      html:
        records.length > 0
          ? `
              <div class="focus-modal-list">
                ${records
                  .slice(
                    0,
                    20
                  )
                  .map(
                    (record, index) =>
                      buildRecordRow(
                        record,
                        index + 1
                      )
                  )
                  .join('')}
              </div>
            `
          : emptyInsight(
              'ไม่มีรายการเร่งด่วนในขณะนี้'
            ),

      didOpen:
        bindModalRecordRows
    });
  }


  function openReceivingInsight() {
    const records =
      getCardRecords()
        .filter(
          (record) =>
            record.receivingStage ===
              'WAITING_RECEIVING' ||
            record.receivingStage ===
              'WAITING_GATE_OUT'
        )
        .sort(
          (a, b) =>
            b.durationSeconds -
            a.durationSeconds
        );

    showFocusModal({
      title:
        'Receiving Flow',

      subtitle:
        'ติดตามขั้นตอนรับสินค้าและ Gate Out',

      html: `
        <div class="focus-modal-metrics focus-modal-metrics--receiving">
          ${metricHtml(
            'รอรับสินค้าเสร็จ',
            readText(
              'receivingWaitingCount'
            )
          )}

          ${metricHtml(
            'รับเสร็จรอ Gate Out',
            readText(
              'receivingWaitingGateOutCount'
            )
          )}

          ${metricHtml(
            'รับสินค้าเสร็จวันนี้',
            readText(
              'receivingCompletedTodayCount'
            )
          )}

          ${metricHtml(
            'ข้อมูลไม่ครบ',
            readText(
              'receivingMissingCount'
            )
          )}

          ${metricHtml(
            'เฉลี่ย เข้า → รับเสร็จ',
            readText(
              'receivingAverageStageOne'
            )
          )}

          ${metricHtml(
            'เฉลี่ย รับเสร็จ → Gate Out',
            readText(
              'receivingAverageStageTwo'
            )
          )}
        </div>

        ${
          records.length > 0
            ? `
                <div class="focus-modal-section-title">
                  รายการที่กำลังดำเนินการ
                </div>

                <div class="focus-modal-list">
                  ${records
                    .slice(
                      0,
                      16
                    )
                    .map(
                      (record, index) =>
                        buildRecordRow(
                          record,
                          index + 1,
                          record.stage
                        )
                    )
                    .join('')}
                </div>
              `
            : emptyInsight(
                'ไม่มีรายการใน Receiving Flow'
              )
        }
      `,

      didOpen:
        bindModalRecordRows
    });
  }


  function openRoundInsight() {
    const chart =
      document.getElementById(
        'movementMiniChart'
      );

    showFocusModal({
      title:
        'รอบ 4 ชั่วโมงล่าสุด',

      subtitle:
        document.getElementById(
          'movementScopeTime'
        )?.textContent ||
        'ข้อมูลการเคลื่อนไหวล่าสุด',

      width:
        'min(860px, calc(100vw - 14px))',

      html: `
        <div class="focus-modal-metrics focus-modal-metrics--round">
          ${metricHtml(
            'Gate In',
            readText(
              'movementIn'
            )
          )}

          ${metricHtml(
            'Gate Out จริง',
            readText(
              'movementOutReal'
            )
          )}

          ${metricHtml(
            'สุทธิจริง',
            readText(
              'movementNetActual'
            )
          )}

          ${metricHtml(
            'ระบบเคลียร์',
            readText(
              'movementOutAuto'
            )
          )}
        </div>

        <div class="focus-modal-analysis">
          <strong>
            ${escapeHtml(
              readText(
                'movementAnalysisTitle'
              )
            )}
          </strong>

          <span>
            ${escapeHtml(
              readText(
                'movementAnalysisMessage'
              )
            )}
          </span>
        </div>

        <div class="focus-modal-chart">
          ${
            chart &&
            chart.innerHTML.trim()
              ? chart.innerHTML
              : `
                  <div class="focus-modal-empty">
                    ยังไม่มีข้อมูลกราฟ
                  </div>
                `
          }
        </div>
      `
    });
  }


  function openStatsInsight() {
    const stats = [
      [
        'Gate In',
        readText(
          'movementIn'
        )
      ],
      [
        'Gate Out จริง',
        readText(
          'movementOutReal'
        )
      ],
      [
        'สุทธิจริง',
        readText(
          'movementNetActual'
        )
      ],
      [
        'ระบบเคลียร์ข้อมูล',
        readText(
          'movementOutAuto'
        )
      ],
      [
        'เฉลี่ย เข้า → รับเสร็จ',
        readText(
          'receivingAverageStageOne'
        )
      ],
      [
        'เฉลี่ย รับเสร็จ → Gate Out',
        readText(
          'receivingAverageStageTwo'
        )
      ],
      [
        'รับสินค้าเสร็จวันนี้',
        readText(
          'receivingCompletedTodayCount'
        )
      ],
      [
        'ออกโดยไม่บันทึกรับเสร็จ',
        readText(
          'receivingMissingCount'
        )
      ]
    ];

    showFocusModal({
      title:
        'สถิติการปฏิบัติงาน',

      subtitle:
        'ข้อมูลวิเคราะห์ที่เปิดดูเมื่อต้องการ',

      html: `
        <div class="focus-modal-table">
          ${stats
            .map(
              ([label, value]) => `
                <div>
                  <span>
                    ${escapeHtml(
                      label
                    )}
                  </span>

                  <strong>
                    ${escapeHtml(
                      value
                    )}
                  </strong>
                </div>
              `
            )
            .join('')}
        </div>
      `
    });
  }


  function showFocusModal(
    options
  ) {
    const source =
      options ||
      {};

    window.Swal.fire({
      icon:
        undefined,
      iconHtml:
        '',
      title:
        '',
      text:
        '',

      html: `
        <article class="focus-modal">
          <header class="focus-modal__header">
            <div>
              <small>
                MODULE INFORMATION
              </small>

              <h2>
                ${escapeHtml(
                  source.title ||
                  'ข้อมูลเพิ่มเติม'
                )}
              </h2>

              <p>
                ${escapeHtml(
                  source.subtitle ||
                  ''
                )}
              </p>
            </div>
          </header>

          <div class="focus-modal__body">
            ${source.html || ''}
          </div>
        </article>
      `,

      width:
        source.width ||
        'min(720px, calc(100vw - 14px))',

      padding:
        '0',

      showCloseButton:
        true,

      confirmButtonText:
        'ปิด',

      allowOutsideClick:
        true,

      heightAuto:
        false,

      scrollbarPadding:
        false,

      customClass: {
        popup:
          'focus-modal-popup',
        title:
          'focus-modal-hidden',
        icon:
          'focus-modal-hidden',
        htmlContainer:
          'focus-modal-html',
        actions:
          'focus-modal-actions',
        confirmButton:
          'focus-modal-confirm',
        closeButton:
          'focus-modal-close'
      },

      didOpen:
        (popup) => {
          popup
            .querySelector(
              '.swal2-title'
            )
            ?.setAttribute(
              'hidden',
              ''
            );

          popup
            .querySelector(
              '.swal2-icon'
            )
            ?.setAttribute(
              'hidden',
              ''
            );

          if (
            typeof source.didOpen ===
              'function'
          ) {
            source.didOpen(
              popup
            );
          }
        }
    });
  }


  function bindModalRecordRows(
    popup
  ) {
    popup
      .querySelectorAll(
        '[data-focus-record-id]'
      )
      .forEach(
        (button) => {
          button.addEventListener(
            'click',
            () => {
              const recordId =
                button.dataset
                  .focusRecordId;

              window.Swal.close();

              window.setTimeout(
                () => {
                  focusRecord(
                    recordId
                  );
                },
                100
              );
            }
          );
        }
      );
  }


  function focusRecord(
    recordId
  ) {
    const card =
      Array.from(
        document.querySelectorAll(
          '.vehicle-card[data-record-id]'
        )
      ).find(
        (element) =>
          String(
            element.dataset
              .recordId ||
            ''
          ) ===
          String(
            recordId ||
            ''
          )
      );

    if (!card) {
      return;
    }

    card.scrollIntoView({
      behavior:
        'smooth',
      block:
        'center'
    });

    card.classList.add(
      'is-focus-highlight'
    );

    window.setTimeout(
      () => {
        card.classList.remove(
          'is-focus-highlight'
        );
      },
      2200
    );
  }


  function getCardRecords() {
    const bridgeRecords =
      getBridgeCardRecords();

    if (
      bridgeRecords.length > 0
    ) {
      return bridgeRecords;
    }

    return getDomCardRecords();
  }


  function getBridgeCardRecords() {
    const bridge =
      window
        .AlertVendorRecordBridge;

    if (
      !bridge ||
      typeof bridge.getRecords !==
        'function'
    ) {
      return [];
    }

    const records =
      bridge.getRecords();

    if (
      !Array.isArray(
        records
      ) ||
      records.length === 0
    ) {
      return [];
    }

    const nowMs =
      typeof bridge.getNowMs ===
        'function'
        ? bridge.getNowMs()
        : Date.now();

    const warningSeconds =
      getThresholdSeconds(
        'thresholdWarningText',
        45 * 60
      );

    const overdueSeconds =
      getThresholdSeconds(
        'thresholdOverdueText',
        60 * 60
      );

    const visibleCards =
      new Map(
        Array.from(
          document.querySelectorAll(
            '.vehicle-card[data-record-id]'
          )
        ).map(
          (card) => [
            String(
              card.dataset
                .recordId ||
              ''
            ),
            card
          ]
        )
      );

    return records
      .filter(
        (record) =>
          record &&
          record.isCurrentlyInArea !==
            false
      )
      .map(
        (record) => {
          const timestampMs =
            getBridgeTimestampMs(
              record
            );

          const durationSeconds =
            Number.isFinite(
              timestampMs
            )
              ? Math.max(
                  0,
                  Math.floor(
                    (
                      nowMs -
                      timestampMs
                    ) /
                    1000
                  )
                )
              : 0;

          const status =
            durationSeconds >=
              overdueSeconds
              ? 'OVERDUE'
              : durationSeconds >=
                  warningSeconds
                ? 'WARNING'
                : Number.isFinite(
                    timestampMs
                  )
                  ? 'NORMAL'
                  : 'INCOMPLETE';

          const fields =
            Array.isArray(
              record.fields
            )
              ? record.fields
              : [];

          const recordId =
            String(
              record.recordId ||
              record.id ||
              ''
            );

          const card =
            visibleCards.get(
              recordId
            );

          const stage =
            card
              ?.querySelector(
                '.receiving-card-stage__head strong'
              )
              ?.textContent
              ?.trim() ||
            card
              ?.querySelector(
                '.receiving-stage-badge'
              )
              ?.textContent
              ?.trim() ||
            String(
              record.receivingStage ||
              record.stage ||
              ''
            );

          return {
            recordId,

            status,

            receivingStage:
              String(
                card?.dataset
                  .receivingStage ||
                record.receivingStage ||
                ''
              ).toUpperCase(),

            stage,

            company:
              String(
                record.primaryValue ||
                getRawField(
                  fields,
                  [
                    'บริษัท',
                    'vendor',
                    'company'
                  ]
                ) ||
                '-'
              ),

            appointment:
              getRawField(
                fields,
                [
                  'เลขนัดหมาย',
                  'หมายเลขนัดหมาย',
                  'นัดหมาย',
                  'appointment',
                  'booking'
                ]
              ) ||
              inferRawAppointment(
                fields
              ) ||
              '-',

            registration:
              getRawField(
                fields,
                [
                  'ทะเบียน',
                  'หมายเลขตู้',
                  'เลขตู้',
                  'registration',
                  'container'
                ]
              ) ||
              '-',

            driver:
              getRawField(
                fields,
                [
                  'ชื่อผู้ขับ',
                  'ชื่อคนขับ',
                  'ผู้ขับ',
                  'driver',
                  'ชื่อ'
                ]
              ) ||
              '-',

            duration:
              formatFocusDuration(
                durationSeconds
              ),

            durationSeconds
          };
        }
      );
  }


  function getDomCardRecords() {
    return Array.from(
      document.querySelectorAll(
        '.vehicle-card[data-record-id]'
      )
    ).map(
      (card) => {
        const stage =
          card.querySelector(
            '.receiving-card-stage__head strong'
          )?.textContent?.trim() ||
          '';

        return {
          recordId:
            card.dataset
              .recordId ||
            '',

          status:
            String(
              card.dataset.status ||
              'INCOMPLETE'
            ).toUpperCase(),

          receivingStage:
            String(
              card.dataset
                .receivingStage ||
              ''
            ).toUpperCase(),

          stage,

          company:
            getCompany(card),

          appointment:
            getField(
              card,
              [
                'นัดหมาย',
                'appointment'
              ]
            ) ||
            '-',

          registration:
            getField(
              card,
              [
                'ทะเบียน',
                'หมายเลขตู้',
                'container'
              ]
            ) ||
            '-',

          driver:
            getField(
              card,
              [
                'ชื่อ',
                'ผู้ขับ',
                'คนขับ',
                'driver'
              ]
            ) ||
            '-',

          duration:
            card.querySelector(
              '.vehicle-card__timer'
            )?.textContent?.trim() ||
            '-',

          durationSeconds:
            readDurationSeconds(
              card
            )
        };
      }
    );
  }


  function getBridgeTimestampMs(
    record
  ) {
    const epoch =
      Number(
        record &&
        record.timestampInEpochMs
      );

    if (
      Number.isFinite(
        epoch
      ) &&
      epoch > 0
    ) {
      return epoch;
    }

    const value =
      String(
        record &&
        (
          record.timestampIn ||
          record.gateIn
        ) ||
        ''
      ).trim();

    const match =
      value.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/
      );

    if (match) {
      return new Date(
        Number(match[3]),
        Number(match[2]) - 1,
        Number(match[1]),
        Number(match[4]),
        Number(match[5]),
        Number(match[6])
      ).getTime();
    }

    const parsed =
      Date.parse(
        value
      );

    return Number.isFinite(
      parsed
    )
      ? parsed
      : NaN;
  }


  function getThresholdSeconds(
    elementId,
    fallback
  ) {
    const value =
      document.getElementById(
        elementId
      )?.textContent ||
      '';

    const numberMatch =
      String(value)
        .replace(/,/g, '')
        .match(
          /(\d+(?:\.\d+)?)/
        );

    const number =
      numberMatch
        ? Number(
            numberMatch[1]
          )
        : NaN;

    if (
      !Number.isFinite(
        number
      )
    ) {
      return fallback;
    }

    if (
      /ชั่วโมง|hour/i.test(
        value
      )
    ) {
      return Math.round(
        number *
        3600
      );
    }

    return Math.round(
      number *
      60
    );
  }


  function getRawField(
    fields,
    keywords
  ) {
    const targets =
      keywords.map(
        normalize
      );

    for (
      const field
      of (
        Array.isArray(
          fields
        )
          ? fields
          : []
      )
    ) {
      const label =
        normalize(
          field &&
          (
            field.label ||
            field.name ||
            field.id
          )
        );

      if (
        targets.some(
          (target) =>
            label.includes(
              target
            )
        )
      ) {
        const value =
          String(
            field &&
            (
              field.value ??
              field.displayValue ??
              ''
            )
          ).trim();

        if (value) {
          return value;
        }
      }
    }

    return '';
  }


  function inferRawAppointment(
    fields
  ) {
    for (
      const field
      of (
        Array.isArray(
          fields
        )
          ? fields
          : []
      )
    ) {
      const value =
        String(
          field &&
          (
            field.value ??
            field.displayValue ??
            ''
          )
        ).trim();

      if (
        /^\d{6,10}$/.test(
          value
        )
      ) {
        return value;
      }
    }

    return '';
  }


  function formatFocusDuration(
    totalSeconds
  ) {
    const value =
      Math.max(
        0,
        Number(
          totalSeconds
        ) ||
        0
      );

    const hours =
      Math.floor(
        value /
        3600
      );

    const minutes =
      Math.floor(
        (
          value %
          3600
        ) /
        60
      );

    const seconds =
      Math.floor(
        value %
        60
      );

    return [
      hours,
      minutes,
      seconds
    ]
      .map(
        (part) =>
          String(part)
            .padStart(
              2,
              '0'
            )
      )
      .join(':');
  }

  function buildRecordRow(
    record,
    index,
    note
  ) {
    return `
      <button
        type="button"
        class="focus-modal-record"
        data-focus-record-id="${escapeHtml(
          record.recordId
        )}"
      >
        <span class="focus-modal-record__rank">
          ${index}
        </span>

        <span class="focus-modal-record__identity">
          <strong>
            ${escapeHtml(
              record.appointment
            )}
          </strong>

          <small>
            ${escapeHtml(
              record.company
            )}
            ·
            ${escapeHtml(
              record.registration
            )}
          </small>
        </span>

        <span class="focus-modal-record__time">
          <strong>
            ${escapeHtml(
              record.duration
            )}
          </strong>

          <small>
            ${escapeHtml(
              note ||
              statusLabel(
                record.status
              )
            )}
          </small>
        </span>
      </button>
    `;
  }


  function metricHtml(
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
            value
          )}
        </strong>
      </div>
    `;
  }


  function emptyInsight(
    message
  ) {
    return `
      <div class="focus-modal-empty">
        ${escapeHtml(
          message
        )}
      </div>
    `;
  }


  function statusLabel(
    status
  ) {
    const map = {
      NORMAL:
        'ปกติ',
      WARNING:
        'ใกล้เกินเวลา',
      OVERDUE:
        'เกินเวลา',
      INCOMPLETE:
        'ข้อมูลไม่สมบูรณ์'
    };

    return (
      map[status] ||
      status ||
      '-'
    );
  }


  function getCompany(
    card
  ) {
    return (
      card.querySelector(
        '.vehicle-card__title'
      )?.textContent?.trim() ||
      card.querySelector(
        '.vehicle-card__header strong'
      )?.textContent?.trim() ||
      '-'
    );
  }


  function getField(
    card,
    keywords
  ) {
    const normalizedKeywords =
      keywords.map(
        normalize
      );

    const fields =
      Array.from(
        card.querySelectorAll(
          '.vehicle-field'
        )
      );

    for (
      const field
      of fields
    ) {
      const label =
        normalize(
          field.querySelector(
            'span'
          )?.textContent ||
          ''
        );

      if (
        normalizedKeywords.some(
          (keyword) =>
            label.includes(
              keyword
            )
        )
      ) {
        return (
          field.querySelector(
            'strong, a'
          )?.textContent?.trim() ||
          ''
        );
      }
    }

    return '';
  }


  function normalize(
    value
  ) {
    return String(
      value ||
      ''
    )
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');
  }


  function readText(
    ...ids
  ) {
    for (
      const id
      of ids
    ) {
      const value =
        document.getElementById(
          id
        )?.textContent?.trim();

      if (value) {
        return value;
      }
    }

    return '0';
  }


  function setText(
    id,
    value
  ) {
    const element =
      document.getElementById(
        id
      );

    if (element) {
      element.textContent =
        value ||
        '0';
    }
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
