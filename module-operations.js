/**
 * module-operations.js
 * ROUND 54 — Round 52 Alert Restored with Full Record Bridge
 *
 * - แสดงเลขนัดหมายและทะเบียนอย่างชัดเจน
 * - แสดงเวลา Gate In, ระยะเวลารวม, เวลาเกิน SLA และขั้นตอน
 * - สร้างเสียงเตือนด้วย Web Audio โดยไม่ต้องมีไฟล์เสียง
 * - ป้องกันเสียงดังซ้ำจาก Silent Refresh
 */
(function (window, document) {
  'use strict';

  const AUDIO_STORAGE_KEY =
    'ALERT_VENDOR_OVERDUE_SOUND_V1';

  const SOUND_COOLDOWN_MS =
    10 * 60 * 1000;

  const VIBRATION_STORAGE_KEY =
    'ALERT_VENDOR_OVERDUE_VIBRATION_V1';

  const VIBRATION_COOLDOWN_MS =
    10 * 60 * 1000;

  /*
   * เก็บ Snapshot ที่ผู้ใช้กด “รับทราบ” ล่าสุด
   * เพื่อแยก “รายการทั้งหมด” กับ “รายการใหม่ในรอบนี้”
   */
  const OVERDUE_ACK_STORAGE_KEY =
    'ALERT_VENDOR_OVERDUE_ACK_SNAPSHOT_V1';

  const state = {
    observer: null,
    swalTimer: null,
    audioContext: null,
    audioUnlocked: false,
    pendingAudio: false,
    activeAlertSignature: '',
    lastPlayedSignature: '',
    lastPlayedAt: 0,
    lastVibratedSignature: '',
    lastVibratedAt: 0,
    acknowledgedOverdueKeys:
      new Set(),
    currentOverdueRecords:
      new Map(),
    originalSwalFire:
      null,
    destroyed: false
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
    restoreSoundState();
    restoreVibrationState();
    restoreOverdueAcknowledgement();
    annotateVehicleCards();
    observeVehicleList();
    bindAudioUnlock();
    patchSweetAlertWhenReady();

    document.addEventListener(
      'alertvendor:records-updated',
      annotateVehicleCards
    );
  }


  function observeVehicleList() {
    const list =
      document.getElementById(
        'vehicleList'
      );

    if (!list) {
      return;
    }

    state.observer =
      new MutationObserver(
        debounce(
          annotateVehicleCards,
          80
        )
      );

    state.observer.observe(
      list,
      {
        childList: true,
        subtree: true
      }
    );
  }


  function annotateVehicleCards() {
    document
      .querySelectorAll(
        '.vehicle-card[data-record-id]'
      )
      .forEach(
        (card) => {
          card
            .querySelectorAll(
              '.vehicle-field'
            )
            .forEach(
              (field) => {
                const label =
                  normalize(
                    text(
                      field.querySelector(
                        'span'
                      )
                    )
                  );

                let role =
                  'OTHER';

                if (
                  matches(
                    label,
                    [
                      'เลขนัดหมาย',
                      'หมายเลขนัดหมาย',
                      'นัดหมาย',
                      'appointment',
                      'booking'
                    ]
                  )
                ) {
                  role =
                    'APPOINTMENT';
                } else if (
                  matches(
                    label,
                    [
                      'ทะเบียน',
                      'ทะเบียนรถ',
                      'registration',
                      'plate',
                      'เลขตู้',
                      'container'
                    ]
                  )
                ) {
                  role =
                    'REGISTRATION';
                } else if (
                  matches(
                    label,
                    [
                      'ชื่อ',
                      'driver',
                      'คนขับ',
                      'ผู้ขับ'
                    ]
                  )
                ) {
                  role =
                    'DRIVER';
                }

                field.dataset
                  .operationalRole =
                  role;
              }
            );
        }
      );
  }


  function patchSweetAlertWhenReady() {
    if (state.destroyed) {
      return;
    }

    if (
      !window.Swal ||
      typeof window.Swal.fire !==
        'function'
    ) {
      state.swalTimer =
        window.setTimeout(
          patchSweetAlertWhenReady,
          120
        );

      return;
    }

    if (
      window.Swal.fire
        .__round45Patched
    ) {
      return;
    }

    const original =
      window.Swal.fire.bind(
        window.Swal
      );

    state.originalSwalFire =
      original;

    const wrapped =
      function (...args) {
        const options =
          normalizeSwalOptions(
            args
          );

        const marker =
          [
            options.title,
            options.text,
            options.html
          ]
            .map(
              (value) =>
                String(
                  value ||
                  ''
                )
            )
            .join(' ');

        const records =
          collectOverdueRecords();

        if (
          isOverdueAlert(
            marker
          ) &&
          records.length > 0
        ) {
          return original(
            enhanceOverdueAlert(
              options,
              records
            )
          );
        }

        return original(
          ...args
        );
      };

    wrapped.__round45Patched =
      true;

    window.Swal.fire =
      wrapped;
  }


  function normalizeSwalOptions(
    args
  ) {
    if (
      args[0] &&
      typeof args[0] ===
        'object'
    ) {
      return {
        ...args[0]
      };
    }

    return {
      title:
        args[0] || '',
      text:
        args[1] || '',
      icon:
        args[2] || undefined
    };
  }


  function isOverdueAlert(
    marker
  ) {
    const value =
      String(
        marker ||
        ''
      );

    return (
      value.includes(
        'พบรถอยู่ในพื้นที่เกินกำหนด'
      ) ||
      value.includes(
        'อยู่ในพื้นที่เกินกำหนด'
      ) ||
      value.includes(
        'รถ/ตู้เกินเวลา'
      ) ||
      value.includes(
        'รายการเกิน SLA'
      ) ||
      value.includes(
        'พบรถอยู่ในพื้นที่เกินเวลา'
      )
    );
  }


  function enhanceOverdueAlert(
    source,
    records
  ) {
    const oldDidOpen =
      source.didOpen;

    const oldWillClose =
      source.willClose;

    const oldPreConfirm =
      source.preConfirm;

    const alertModel =
      createOverdueAlertModel(
        records
      );

    const automaticSignature =
      buildAlertSignature(
        alertModel.newRecords
      );

    const manualSignature =
      buildAlertSignature(
        records
      );

    state.activeAlertSignature =
      manualSignature;

    state.currentOverdueRecords =
      new Map(
        records.map(
          (record) => [
            String(
              record.recordId ||
              ''
            ),
            record
          ]
        )
      );

    return {
      ...source,

      icon:
        undefined,
      iconHtml:
        '',
      title:
        '',
      text:
        '',

      html:
        buildOverdueHtml(
          alertModel
        ),

      confirmButtonText:
        'รับทราบ',
      showConfirmButton:
        true,
      showCloseButton:
        true,
      allowOutsideClick:
        false,
      allowEscapeKey:
        true,
      returnFocus:
        false,
      heightAuto:
        false,
      scrollbarPadding:
        false,
      width:
        'min(820px, calc(100vw - 14px))',
      padding:
        '0',

      customClass: {
        popup:
          'av-overdue-popup-v50',
        title:
          'av-overdue-hidden-title-v50',
        icon:
          'av-overdue-hidden-icon-v50',
        htmlContainer:
          'av-overdue-html-v50',
        actions:
          'av-overdue-actions-v50',
        confirmButton:
          'av-overdue-confirm-v50',
        closeButton:
          'av-overdue-close-v50'
      },

      preConfirm:
        async (...args) => {
          if (
            typeof oldPreConfirm ===
              'function'
          ) {
            const previousResult =
              await oldPreConfirm(
                ...args
              );

            if (
              previousResult ===
                false
            ) {
              return false;
            }
          }

          acknowledgeOverdueRecords(
            records
          );

          return true;
        },

      didOpen:
        (popup) => {
          const titleNode =
            popup.querySelector(
              '.swal2-title'
            );

          const iconNode =
            popup.querySelector(
              '.swal2-icon'
            );

          if (titleNode) {
            titleNode.style.display =
              'none';
          }

          if (iconNode) {
            iconNode.style.display =
              'none';
          }

          popup.style.height =
            'auto';

          popup.style.minHeight =
            '0';

          popup.style.maxWidth =
            'calc(100vw - 14px)';

          popup.style.overflow =
            'hidden';

          if (
            typeof oldDidOpen ===
              'function'
          ) {
            oldDidOpen(
              popup
            );
          }

          bindOverdueAlertActions(
            popup
          );

          if (
            source
              .suppressAutomaticFeedback !==
              true &&
            alertModel.newRecords
              .length > 0
          ) {
            requestAlarmFeedback(
              automaticSignature,
              false
            );
          }
        },

      willClose:
        (popup) => {
          state.pendingAudio =
            false;

          stopAlarmVibration();

          if (
            typeof oldWillClose ===
              'function'
          ) {
            oldWillClose(
              popup
            );
          }
        }
    };
  }

  function bindOverdueAlertActions(
    popup
  ) {
    popup
      .querySelectorAll(
        '[data-overdue-detail-record]'
      )
      .forEach(
        (button) => {
          button.addEventListener(
            'click',
            () => {
              openSeparateOverdueDetailAlert(
                button.dataset
                  .overdueDetailRecord
              );
            }
          );
        }
      );

    popup
      .querySelector(
        '[data-overdue-play-sound]'
      )
      ?.addEventListener(
        'click',
        () => {
          requestAlarmVibration(
            state.activeAlertSignature,
            true
          );

          unlockAudio()
            .then(
              () =>
                playAlarmSequence(
                  true
                )
            )
            .catch(
              () => undefined
            );
        }
      );
  }


  async function openSeparateOverdueDetailAlert(
    recordId
  ) {
    const id =
      String(
        recordId ||
        ''
      );

    const record =
      state.currentOverdueRecords.get(
        id
      );

    if (!record) {
      return;
    }

    const fire =
      state.originalSwalFire ||
      window.Swal.fire.bind(
        window.Swal
      );

    const result =
      await fire(
        buildSeparateOverdueDetailOptions(
          record
        )
      );

    if (
      result &&
      result.isConfirmed
    ) {
      reopenOverdueListAlert();
      return;
    }

    if (
      result &&
      result.isDenied
    ) {
      window.setTimeout(
        () => {
          scrollToRecord(
            id
          );
        },
        80
      );
    }
  }


  function reopenOverdueListAlert() {
    const records =
      Array.from(
        state.currentOverdueRecords
          .values()
      );

    if (
      records.length === 0
    ) {
      return;
    }

    const fire =
      state.originalSwalFire ||
      window.Swal.fire.bind(
        window.Swal
      );

    /*
     * ใช้ original Swal.fire โดยตรง ป้องกัน Wrapper
     * จับ Alert ของเราแล้วสร้างซ้ำอีกรอบ
     */
    fire(
      enhanceOverdueAlert(
        {
          title:
            'พบรถอยู่ในพื้นที่เกินกำหนด',

          suppressAutomaticFeedback:
            true
        },
        records
      )
    );
  }


  function buildSeparateOverdueDetailOptions(
    record
  ) {
    return {
      icon:
        undefined,
      iconHtml:
        '',
      title:
        '',
      text:
        '',

      html:
        buildSeparateOverdueDetailHtml(
          record
        ),

      showConfirmButton:
        true,
      confirmButtonText:
        'กลับไปดูรายการ',

      showDenyButton:
        true,
      denyButtonText:
        'ไปยังการ์ดในหน้าหลัก',

      showCloseButton:
        true,
      allowOutsideClick:
        false,
      allowEscapeKey:
        true,
      returnFocus:
        false,
      heightAuto:
        false,
      scrollbarPadding:
        false,
      width:
        'min(720px, calc(100vw - 14px))',
      padding:
        '0',

      customClass: {
        popup:
          'av-record-detail-popup-v52',
        title:
          'av-record-detail-hidden-v52',
        icon:
          'av-record-detail-hidden-v52',
        htmlContainer:
          'av-record-detail-html-v52',
        actions:
          'av-record-detail-actions-v52',
        confirmButton:
          'av-record-detail-back-v52',
        denyButton:
          'av-record-detail-main-v52',
        closeButton:
          'av-record-detail-close-v52'
      },

      didOpen:
        (popup) => {
          const titleNode =
            popup.querySelector(
              '.swal2-title'
            );

          const iconNode =
            popup.querySelector(
              '.swal2-icon'
            );

          if (titleNode) {
            titleNode.style.display =
              'none';
          }

          if (iconNode) {
            iconNode.style.display =
              'none';
          }

          popup.style.height =
            'auto';

          popup.style.minHeight =
            '0';

          popup.style.overflow =
            'hidden';
        }
    };
  }


  function buildSeparateOverdueDetailHtml(
    record
  ) {
    const driverHtml =
      record.driver
        ? `
            <div class="av-minimal-detail-item-v52">
              <span>
                ชื่อผู้ขับ
              </span>

              <strong>
                ${escapeHtml(
                  record.driver
                )}
              </strong>
            </div>
          `
        : '';

    return `
      <article class="av-minimal-detail-v52">
        <header class="av-minimal-detail-header-v52">
          <small>
            รายละเอียดรายการ
          </small>

          <h2>
            เลขนัดหมาย
            ${escapeHtml(
              record.appointment
            )}
          </h2>
        </header>

        <section class="av-minimal-detail-main-v52">
          <div class="av-minimal-detail-company-v52">
            <span>
              บริษัท / Vendor
            </span>

            <strong>
              ${escapeHtml(
                record.company
              )}
            </strong>
          </div>

          <div class="av-minimal-detail-grid-v52">
            <div class="av-minimal-detail-item-v52">
              <span>
                ทะเบียนรถ / หมายเลขตู้
              </span>

              <strong>
                ${escapeHtml(
                  record.registration
                )}
              </strong>
            </div>

            ${driverHtml}

            <div class="av-minimal-detail-item-v52">
              <span>
                เวลา Gate In
              </span>

              <strong>
                ${escapeHtml(
                  record.gateIn
                )}
              </strong>
            </div>

            <div class="av-minimal-detail-item-v52">
              <span>
                เวลาอยู่ในพื้นที่
              </span>

              <strong>
                ${escapeHtml(
                  record.duration
                )}
              </strong>
            </div>

            <div class="av-minimal-detail-item-v52 is-overdue">
              <span>
                เกิน SLA แล้ว
              </span>

              <strong>
                ${escapeHtml(
                  record.overdueDuration
                )}
              </strong>
            </div>

            <div class="av-minimal-detail-item-v52">
              <span>
                ขั้นตอนปัจจุบัน
              </span>

              <strong>
                ${escapeHtml(
                  record.stage
                )}
              </strong>
            </div>
          </div>
        </section>
      </article>
    `;
  }

  function collectOverdueRecords() {
    const thresholdSeconds =
      getOverdueThresholdSeconds();

    const bridgeRecords =
      collectBridgeOverdueRecords(
        thresholdSeconds
      );

    /*
     * ใช้ข้อมูลจาก API ทั้งหมดเป็นแหล่งหลัก
     * จึงไม่กระทบเมื่อหน้าเลือก “ปกติ” หรือค้นหาอยู่
     */
    if (
      bridgeRecords.length > 0
    ) {
      return bridgeRecords;
    }

    /*
     * Fallback สำหรับกรณี Bridge ยังไม่พร้อม
     * เช่น เปิดไฟล์เก่าโดยไม่เพิ่ม module-data-bridge.js
     */
    return collectDomOverdueRecords(
      thresholdSeconds
    );
  }


  function collectBridgeOverdueRecords(
    thresholdSeconds
  ) {
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

    return records
      .filter(
        (record) => {
          if (
            !record ||
            record.isCurrentlyInArea ===
              false
          ) {
            return false;
          }

          const timestampMs =
            getRecordTimestampMs(
              record
            );

          if (
            !Number.isFinite(
              timestampMs
            )
          ) {
            return false;
          }

          const durationValue =
            Math.max(
              0,
              Math.floor(
                (
                  nowMs -
                  timestampMs
                ) /
                1000
              )
            );

          return (
            durationValue >=
            thresholdSeconds
          );
        }
      )
      .map(
        (record) =>
          mapBridgeRecord(
            record,
            thresholdSeconds,
            nowMs
          )
      )
      .sort(
        (left, right) =>
          right.durationSeconds -
          left.durationSeconds
      );
  }


  function mapBridgeRecord(
    record,
    thresholdSeconds,
    nowMs
  ) {
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

    const timestampMs =
      getRecordTimestampMs(
        record
      );

    const durationValue =
      Math.max(
        0,
        Math.floor(
          (
            nowMs -
            timestampMs
          ) /
          1000
        )
      );

    const card =
      findVehicleCardByRecordId(
        recordId
      );

    const company =
      String(
        record.primaryValue ||
        findRawField(
          fields,
          [
            'บริษัท',
            'vendor',
            'company'
          ]
        ) ||
        'ไม่ระบุบริษัท'
      ).trim();

    const appointment =
      findRawField(
        fields,
        [
          'เลขนัดหมาย',
          'หมายเลขนัดหมาย',
          'นัดหมาย',
          'appointment',
          'booking'
        ]
      ) ||
      inferRawNumericField(
        fields
      ) ||
      '-';

    const registration =
      findRawField(
        fields,
        [
          'ทะเบียน',
          'ทะเบียนรถ',
          'registration',
          'plate',
          'เลขตู้',
          'หมายเลขตู้',
          'container'
        ]
      ) ||
      '-';

    const driver =
      findRawField(
        fields,
        [
          'ชื่อผู้ขับ',
          'ชื่อคนขับ',
          'พนักงานขับรถ',
          'driver',
          'ชื่อ'
        ]
      ) ||
      '';

    return {
      recordId,

      company,

      appointment,

      registration,

      driver,

      gateIn:
        String(
          record.timestampIn ||
          record.gateIn ||
          '-'
        ),

      duration:
        formatDuration(
          durationValue
        ),

      durationSeconds:
        durationValue,

      overdueDuration:
        formatDuration(
          Math.max(
            0,
            durationValue -
            thresholdSeconds
          )
        ),

      stage:
        getReceivingStageFromCard(
          card
        ) ||
        String(
          record.receivingStage ||
          record.stage ||
          'อยู่ในพื้นที่'
        ),

      details:
        extractRawFieldDetails(
          fields
        )
    };
  }


  function collectDomOverdueRecords(
    thresholdSeconds
  ) {
    return Array.from(
      document.querySelectorAll(
        '.vehicle-card[data-status="OVERDUE"][data-record-id]'
      )
    )
      .map(
        (card) => {
          const fields =
            Array.from(
              card.querySelectorAll(
                '.vehicle-field'
              )
            );

          const duration =
            text(
              card.querySelector(
                '.vehicle-card__timer'
              )
            ) ||
            '-';

          const durationValue =
            durationSeconds(
              duration
            );

          return {
            recordId:
              String(
                card.dataset.recordId ||
                ''
              ),

            company:
              text(
                card.querySelector(
                  '.vehicle-card__title'
                )
              ) ||
              text(
                card.querySelector(
                  '.vehicle-card__header strong'
                )
              ) ||
              'ไม่ระบุบริษัท',

            appointment:
              findField(
                fields,
                [
                  'เลขนัดหมาย',
                  'หมายเลขนัดหมาย',
                  'นัดหมาย',
                  'appointment',
                  'booking'
                ]
              ) ||
              inferNumericField(
                fields
              ) ||
              '-',

            registration:
              findField(
                fields,
                [
                  'ทะเบียน',
                  'ทะเบียนรถ',
                  'registration',
                  'plate',
                  'เลขตู้',
                  'container'
                ]
              ) ||
              '-',

            driver:
              findField(
                fields,
                [
                  'ชื่อผู้ขับ',
                  'ชื่อคนขับ',
                  'พนักงานขับรถ',
                  'driver',
                  'ชื่อ'
                ]
              ) ||
              '',

            gateIn:
              text(
                card.querySelector(
                  '.vehicle-in-time strong'
                )
              ) ||
              '-',

            duration,

            durationSeconds:
              durationValue,

            overdueDuration:
              formatDuration(
                Math.max(
                  0,
                  durationValue -
                  thresholdSeconds
                )
              ),

            stage:
              getReceivingStageFromCard(
                card
              ) ||
              'อยู่ในพื้นที่',

            details:
              extractVehicleFieldDetails(
                fields
              )
          };
        }
      )
      .sort(
        (left, right) =>
          right.durationSeconds -
          left.durationSeconds
      );
  }


  function getRecordTimestampMs(
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

    const thaiMatch =
      value.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/
      );

    if (thaiMatch) {
      return new Date(
        Number(
          thaiMatch[3]
        ),
        Number(
          thaiMatch[2]
        ) - 1,
        Number(
          thaiMatch[1]
        ),
        Number(
          thaiMatch[4]
        ),
        Number(
          thaiMatch[5]
        ),
        Number(
          thaiMatch[6]
        )
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


  function findRawField(
    fields,
    labels
  ) {
    const targets =
      (
        Array.isArray(
          labels
        )
          ? labels
          : []
      ).map(
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


  function inferRawNumericField(
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


  function extractRawFieldDetails(
    fields
  ) {
    const result =
      [];

    const used =
      new Set();

    (
      Array.isArray(
        fields
      )
        ? fields
        : []
    ).forEach(
      (field) => {
        const label =
          String(
            field &&
            (
              field.label ||
              field.name ||
              field.id ||
              'ข้อมูล'
            )
          ).trim();

        const value =
          String(
            field &&
            (
              field.value ??
              field.displayValue ??
              ''
            )
          ).trim();

        const key =
          normalize(
            label
          );

        if (
          !value ||
          value === '-' ||
          used.has(
            key
          )
        ) {
          return;
        }

        used.add(
          key
        );

        result.push({
          label,
          value
        });
      }
    );

    return result;
  }


  function findVehicleCardByRecordId(
    recordId
  ) {
    return Array.from(
      document.querySelectorAll(
        '.vehicle-card[data-record-id]'
      )
    ).find(
      (card) =>
        String(
          card.dataset.recordId ||
          ''
        ) ===
        String(
          recordId ||
          ''
        )
    ) ||
    null;
  }


  function getReceivingStageFromCard(
    card
  ) {
    if (!card) {
      return '';
    }

    return (
      text(
        card.querySelector(
          '.receiving-card-stage__head strong'
        )
      ) ||
      text(
        card.querySelector(
          '.receiving-stage-badge'
        )
      ) ||
      ''
    );
  }

  function extractVehicleFieldDetails(
    fields
  ) {
    const result =
      [];

    const usedLabels =
      new Set();

    (
      Array.isArray(
        fields
      )
        ? fields
        : []
    ).forEach(
      (field) => {
        const label =
          text(
            field.querySelector(
              'span'
            )
          ) ||
          'ข้อมูล';

        const value =
          text(
            field.querySelector(
              'strong, a'
            )
          ) ||
          '';

        const normalizedLabel =
          normalize(
            label
          );

        if (
          !value ||
          value === '-' ||
          usedLabels.has(
            normalizedLabel
          )
        ) {
          return;
        }

        usedLabels.add(
          normalizedLabel
        );

        result.push({
          label,
          value
        });
      }
    );

    return result;
  }


  function getOverdueThresholdSeconds() {
    const value =
      text(
        document.getElementById(
          'thresholdOverdueText'
        )
      );

    const hourMatch =
      value.match(
        /(\d+(?:\.\d+)?)\s*ชั่วโมง/
      );

    if (hourMatch) {
      return Math.round(
        Number(
          hourMatch[1]
        ) *
        3600
      );
    }

    const minuteMatch =
      value.match(
        /(\d+(?:\.\d+)?)\s*นาที/
      );

    if (minuteMatch) {
      return Math.round(
        Number(
          minuteMatch[1]
        ) *
        60
      );
    }

    return 60 * 60;
  }


  function createOverdueAlertModel(
    records
  ) {
    const allRecords =
      Array.isArray(
        records
      )
        ? records
        : [];

    const newRecords =
      allRecords.filter(
        (record) =>
          !state
            .acknowledgedOverdueKeys
            .has(
              getOverdueRecordKey(
                record
              )
            )
      );

    return {
      allRecords,
      newRecords
    };
  }


  function buildOverdueHtml(
    alertModel
  ) {
    const allRecords =
      alertModel.allRecords ||
      [];

    const newRecords =
      alertModel.newRecords ||
      [];

    const thresholdText =
      text(
        document.getElementById(
          'thresholdOverdueText'
        )
      ) ||
      'ตามเกณฑ์โมดูล';

    return `
      <div class="av-overdue-dialog-v49">
        <header class="av-overdue-header-v49">
          <div class="av-overdue-heading-v49">
            <small>
              OPERATIONAL ALERT
            </small>

            <h2>
              รถ/ตู้สินค้าเกินเวลา
            </h2>

            <p>
              เกณฑ์ควบคุม
              ${escapeHtml(
                thresholdText
              )}
              · เทียบรายการใหม่จากรอบที่กดรับทราบล่าสุด
            </p>
          </div>

          <div class="av-overdue-header-summary-v49">
            <span>
              <small>ทั้งหมด</small>
              <strong>
                ${allRecords.length}
              </strong>
            </span>

            <span class="is-new">
              <small>ใหม่รอบนี้</small>
              <strong>
                ${newRecords.length}
              </strong>
            </span>

            <button
              type="button"
              class="av-overdue-feedback-v49"
              data-overdue-play-sound
              aria-label="เล่นเสียงและสั่นเตือนอีกครั้ง"
            >
              <span aria-hidden="true">
                🔔
              </span>

              <b>
                เตือนซ้ำ
              </b>
            </button>
          </div>
        </header>

        <div class="av-overdue-split-v49">
          ${buildOverduePanelHtml(
            'ทั้งหมดที่เกินเวลา',
            allRecords,
            'ALL'
          )}

          ${buildOverduePanelHtml(
            'เข้ามาใหม่ในรอบนี้',
            newRecords,
            'NEW'
          )}
        </div>

        <footer class="av-overdue-footer-v49">
          <span>
            1 รายการใช้ 2 แถว:
            เลขนัดหมาย /
            บริษัท · ทะเบียน · เวลาอยู่ในพื้นที่
          </span>

          <span>
            แตะแถวเพื่อดูรายละเอียดข้อมูลทั้งหมด
          </span>
        </footer>

      </div>
    `;
  }


  function buildOverduePanelHtml(
    title,
    records,
    panelType
  ) {
    const isNewPanel =
      panelType ===
      'NEW';

    return `
      <section
        class="av-overdue-panel-v49 ${
          isNewPanel
            ? 'is-new-panel'
            : 'is-all-panel'
        }"
      >
        <header class="av-overdue-panel-header-v49">
          <strong>
            ${escapeHtml(
              title
            )}
          </strong>

          <span>
            ${records.length}
            รายการ
          </span>
        </header>

        <div
          class="av-overdue-rows-v49"
          role="list"
          aria-label="${escapeHtml(
            title
          )}"
        >
          ${
            records.length > 0
              ? records
                  .map(
                    (record) =>
                      buildOverdueRowHtml(
                        record,
                        isNewPanel
                      )
                  )
                  .join('')
              : `
                  <div class="av-overdue-empty-v49">
                    <strong>
                      ไม่มีรายการใหม่
                    </strong>

                    <span>
                      รายการเดิมยังอยู่ฝั่งซ้ายและติดตามต่อได้
                    </span>
                  </div>
                `
          }
        </div>
      </section>
    `;
  }


  function buildOverdueRowHtml(
    record,
    isNew
  ) {
    const accessibleText =
      [
        'เลขนัดหมาย ' +
          record.appointment,
        'บริษัท ' +
          record.company,
        'ทะเบียน ' +
          record.registration,
        'เวลาอยู่ในพื้นที่ ' +
          record.duration
      ].join(', ');

    return `
      <button
        type="button"
        class="av-overdue-row-v49 ${
          isNew
            ? 'is-new'
            : ''
        }"
        data-overdue-detail-record="${escapeHtml(
          record.recordId
        )}"
        role="listitem"
        aria-label="${escapeHtml(
          accessibleText
        )}"
      >
        <span class="av-overdue-row-top-v49">
          <small>
            นัดหมาย
          </small>

          <strong>
            ${escapeHtml(
              record.appointment
            )}
          </strong>

          ${
            isNew
              ? `
                  <em>
                    ใหม่
                  </em>
                `
              : ''
          }
        </span>

        <span class="av-overdue-row-bottom-v49">
          <span
            class="is-company"
            title="${escapeHtml(
              record.company
            )}"
          >
            ${escapeHtml(
              record.company
            )}
          </span>

          <span
            class="is-registration"
            title="${escapeHtml(
              record.registration
            )}"
          >
            ${escapeHtml(
              record.registration
            )}
          </span>

          <strong class="is-duration">
            ${escapeHtml(
              record.duration
            )}
          </strong>
        </span>
      </button>
    `;
  }


  function getOverdueRecordKey(
    record
  ) {
    const source =
      record &&
      typeof record ===
        'object'
        ? record
        : {};

    return [
      source.recordId ||
        '',
      source.appointment ||
        '',
      source.registration ||
        '',
      source.gateIn ||
        ''
    ]
      .map(
        (value) =>
          String(
            value ||
            ''
          ).trim()
      )
      .join('|');
  }


  function acknowledgeOverdueRecords(
    records
  ) {
    const keys =
      (
        Array.isArray(
          records
        )
          ? records
          : []
      )
        .map(
          getOverdueRecordKey
        )
        .filter(Boolean);

    state.acknowledgedOverdueKeys =
      new Set(
        keys
      );

    persistOverdueAcknowledgement();
  }

  function buildAlertSignature(
    records
  ) {
    return records
      .map(
        (record) =>
          [
            record.recordId,
            record.appointment,
            record.registration
          ].join('|')
      )
      .sort()
      .join('::');
  }


  function bindAudioUnlock() {
    [
      'pointerdown',
      'touchstart',
      'keydown'
    ].forEach(
      (eventName) => {
        document.addEventListener(
          eventName,
          handleAudioUnlock,
          {
            passive: true,
            capture: true
          }
        );
      }
    );
  }


  function handleAudioUnlock() {
    unlockAudio()
      .then(
        () => {
          if (
            state.pendingAudio &&
            document.querySelector(
              '.overdue-command-popup'
            )
          ) {
            state.pendingAudio =
              false;

            playAlarmSequence(
              false
            );
          }
        }
      )
      .catch(
        () => undefined
      );
  }


  async function unlockAudio() {
    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioContextClass) {
      return false;
    }

    if (!state.audioContext) {
      state.audioContext =
        new AudioContextClass();
    }

    if (
      state.audioContext.state ===
      'suspended'
    ) {
      await state.audioContext.resume();
    }

    state.audioUnlocked =
      state.audioContext.state ===
      'running';

    return state.audioUnlocked;
  }


  function requestAlarmFeedback(
    signature,
    force
  ) {
    requestAlarmVibration(
      signature,
      force
    );

    requestAlarmSound(
      signature,
      force
    );
  }


  function requestAlarmVibration(
    signature,
    force
  ) {
    if (
      !window.navigator ||
      typeof window.navigator.vibrate !==
        'function'
    ) {
      return false;
    }

    const now =
      Date.now();

    const duplicate =
      !force &&
      signature &&
      signature ===
        state.lastVibratedSignature &&
      now -
        state.lastVibratedAt <
        VIBRATION_COOLDOWN_MS;

    if (duplicate) {
      return false;
    }

    try {
      /*
       * เตือน 3 จังหวะ:
       * สั้น - สั้น - ยาว
       */
      const accepted =
        window.navigator.vibrate(
          [
            180,
            110,
            180,
            110,
            360
          ]
        );

      if (accepted !== false) {
        state.lastVibratedSignature =
          signature ||
          state.activeAlertSignature ||
          '';

        state.lastVibratedAt =
          now;

        persistVibrationState();

        return true;
      }
    } catch (error) {
      return false;
    }

    return false;
  }


  function stopAlarmVibration() {
    if (
      !window.navigator ||
      typeof window.navigator.vibrate !==
        'function'
    ) {
      return;
    }

    try {
      window.navigator.vibrate(
        0
      );
    } catch (error) {
      // Ignore unsupported vibration errors.
    }
  }


  function requestAlarmSound(
    signature,
    force
  ) {
    const now =
      Date.now();

    const duplicate =
      !force &&
      signature &&
      signature ===
        state.lastPlayedSignature &&
      now -
        state.lastPlayedAt <
        SOUND_COOLDOWN_MS;

    if (duplicate) {
      return;
    }

    state.activeAlertSignature =
      signature;

    unlockAudio()
      .then(
        (unlocked) => {
          if (!unlocked) {
            state.pendingAudio =
              true;
            return;
          }

          playAlarmSequence(
            force
          );
        }
      )
      .catch(
        () => {
          state.pendingAudio =
            true;
        }
      );
  }


  function playAlarmSequence(
    force
  ) {
    if (
      !state.audioContext ||
      state.audioContext.state !==
        'running'
    ) {
      state.pendingAudio =
        true;
      return;
    }

    const signature =
      state.activeAlertSignature;

    const now =
      Date.now();

    if (
      !force &&
      signature &&
      signature ===
        state.lastPlayedSignature &&
      now -
        state.lastPlayedAt <
        SOUND_COOLDOWN_MS
    ) {
      return;
    }

    const context =
      state.audioContext;

    const start =
      context.currentTime +
      0.025;

    const notes = [
      {
        frequency: 880,
        offset: 0,
        duration: .13
      },
      {
        frequency: 660,
        offset: .18,
        duration: .13
      },
      {
        frequency: 880,
        offset: .36,
        duration: .24
      }
    ];

    notes.forEach(
      (note) => {
        const oscillator =
          context.createOscillator();

        const gain =
          context.createGain();

        oscillator.type =
          'sine';

        oscillator.frequency.setValueAtTime(
          note.frequency,
          start + note.offset
        );

        gain.gain.setValueAtTime(
          0.0001,
          start + note.offset
        );

        gain.gain.exponentialRampToValueAtTime(
          0.12,
          start +
          note.offset +
          0.018
        );

        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          start +
          note.offset +
          note.duration
        );

        oscillator.connect(
          gain
        );

        gain.connect(
          context.destination
        );

        oscillator.start(
          start + note.offset
        );

        oscillator.stop(
          start +
          note.offset +
          note.duration +
          0.03
        );
      }
    );

    state.pendingAudio =
      false;

    state.lastPlayedSignature =
      signature;

    state.lastPlayedAt =
      now;

    persistSoundState();
  }


  function restoreSoundState() {
    try {
      const saved =
        JSON.parse(
          window.localStorage.getItem(
            AUDIO_STORAGE_KEY
          ) ||
          '{}'
        );

      state.lastPlayedSignature =
        String(
          saved.signature ||
          ''
        );

      state.lastPlayedAt =
        Number(
          saved.timestamp
        ) || 0;
    } catch (error) {
      state.lastPlayedSignature =
        '';

      state.lastPlayedAt =
        0;
    }
  }


  function restoreVibrationState() {
    try {
      const saved =
        JSON.parse(
          window.localStorage.getItem(
            VIBRATION_STORAGE_KEY
          ) ||
          '{}'
        );

      state.lastVibratedSignature =
        String(
          saved.signature ||
          ''
        );

      state.lastVibratedAt =
        Number(
          saved.timestamp
        ) || 0;
    } catch (error) {
      state.lastVibratedSignature =
        '';

      state.lastVibratedAt =
        0;
    }
  }


  function persistVibrationState() {
    try {
      window.localStorage.setItem(
        VIBRATION_STORAGE_KEY,
        JSON.stringify({
          signature:
            state.lastVibratedSignature,

          timestamp:
            state.lastVibratedAt
        })
      );
    } catch (error) {
      // Storage may be disabled.
    }
  }


  function restoreOverdueAcknowledgement() {
    try {
      const saved =
        JSON.parse(
          window.localStorage.getItem(
            OVERDUE_ACK_STORAGE_KEY
          ) ||
          '[]'
        );

      state.acknowledgedOverdueKeys =
        new Set(
          Array.isArray(saved)
            ? saved
                .map(
                  (value) =>
                    String(
                      value ||
                      ''
                    )
                )
                .filter(Boolean)
            : []
        );
    } catch (error) {
      state.acknowledgedOverdueKeys =
        new Set();
    }
  }


  function persistOverdueAcknowledgement() {
    try {
      window.localStorage.setItem(
        OVERDUE_ACK_STORAGE_KEY,
        JSON.stringify(
          Array.from(
            state
              .acknowledgedOverdueKeys
          )
        )
      );
    } catch (error) {
      // Storage may be disabled.
    }
  }


  function persistSoundState() {
    try {
      window.localStorage.setItem(
        AUDIO_STORAGE_KEY,
        JSON.stringify({
          signature:
            state.lastPlayedSignature,
          timestamp:
            state.lastPlayedAt
        })
      );
    } catch (error) {
      // localStorage may be unavailable in private mode.
    }
  }


  function findField(
    fields,
    patterns
  ) {
    const targets =
      patterns.map(
        normalize
      );

    for (
      const field of fields
    ) {
      const label =
        normalize(
          text(
            field.querySelector(
              'span'
            )
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
        return (
          text(
            field.querySelector(
              'strong, a'
            )
          ) ||
          '-'
        );
      }
    }

    return '';
  }


  function inferNumericField(
    fields
  ) {
    for (
      const field of fields
    ) {
      const value =
        text(
          field.querySelector(
            'strong, a'
          )
        );

      if (
        /^\d{5,12}$/.test(
          value
        )
      ) {
        return value;
      }
    }

    return '';
  }


  function scrollToRecord(
    id
  ) {
    const card =
      Array.from(
        document.querySelectorAll(
          '.vehicle-card[data-record-id]'
        )
      )
        .find(
          (item) =>
            String(
              item.dataset.recordId ||
              ''
            ) ===
            String(
              id ||
              ''
            )
        );

    if (!card) {
      return;
    }

    card.classList.remove(
      'is-receiving-filter-hidden'
    );

    card.removeAttribute(
      'aria-hidden'
    );

    card.scrollIntoView({
      behavior:
        window.matchMedia(
          '(prefers-reduced-motion: reduce)'
        ).matches
          ? 'auto'
          : 'smooth',
      block:
        'center'
    });

    card.classList.add(
      'receiving-highlight'
    );

    window.setTimeout(
      () => {
        card.classList.remove(
          'receiving-highlight'
        );
      },
      1800
    );
  }


  function formatDuration(
    seconds
  ) {
    const value =
      Math.max(
        0,
        Math.floor(
          Number(
            seconds
          ) || 0
        )
      );

    const hours =
      Math.floor(
        value / 3600
      );

    const minutes =
      Math.floor(
        (
          value % 3600
        ) / 60
      );

    const secs =
      value % 60;

    return [
      hours,
      minutes,
      secs
    ]
      .map(
        (part) =>
          String(
            part
          ).padStart(
            2,
            '0'
          )
      )
      .join(':');
  }


  function durationSeconds(
    value
  ) {
    const parts =
      String(
        value ||
        ''
      )
        .split(':')
        .map(Number);

    if (
      parts.length !== 3 ||
      parts.some(
        (part) =>
          !Number.isFinite(
            part
          )
      )
    ) {
      return 0;
    }

    return (
      parts[0] * 3600 +
      parts[1] * 60 +
      parts[2]
    );
  }


  function text(
    element
  ) {
    return String(
      element &&
      element.textContent ||
      ''
    ).trim();
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
      .replace(
        /[\s_\-:]+/g,
        ''
      );
  }


  function matches(
    value,
    patterns
  ) {
    return patterns
      .map(
        normalize
      )
      .some(
        (pattern) =>
          value.includes(
            pattern
          )
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


  function debounce(
    fn,
    delay
  ) {
    let timer =
      null;

    return (
      ...args
    ) => {
      window.clearTimeout(
        timer
      );

      timer =
        window.setTimeout(
          () => {
            timer =
              null;

            fn(
              ...args
            );
          },
          delay
        );
    };
  }


  function destroy() {
    state.destroyed =
      true;

    if (
      state.observer
    ) {
      state.observer.disconnect();
    }

    if (
      state.swalTimer
    ) {
      window.clearTimeout(
        state.swalTimer
      );
    }

    if (
      state.audioContext &&
      typeof state.audioContext
        .close ===
        'function'
    ) {
      state.audioContext
        .close()
        .catch(
          () => undefined
        );
    }
  }

})(window, document);
