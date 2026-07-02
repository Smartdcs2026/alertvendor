/**
 * module-operations.js
 * ROUND 45 — Overdue Operational Alert + Audio
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

  const state = {
    observer: null,
    swalTimer: null,
    audioContext: null,
    audioUnlocked: false,
    pendingAudio: false,
    activeAlertSignature: '',
    lastPlayedSignature: '',
    lastPlayedAt: 0,
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
    annotateVehicleCards();
    observeVehicleList();
    bindAudioUnlock();
    patchSweetAlertWhenReady();
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

    const signature =
      buildAlertSignature(
        records
      );

    state.activeAlertSignature =
      signature;

    return {
      ...source,

      /*
       * รอบ 46 วางหัวเรื่องทั้งหมดไว้ใน HTML ของเราเอง
       * เพื่อไม่ให้ title/icon เดิมของ SweetAlert สร้างพื้นที่ว่าง
       */
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
          records
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
        'min(780px, calc(100vw - 18px))',
      padding:
        '0',

      customClass: {
        popup:
          'av-overdue-popup-v46',
        title:
          'av-overdue-hidden-title-v46',
        icon:
          'av-overdue-hidden-icon-v46',
        htmlContainer:
          'av-overdue-html-v46',
        actions:
          'av-overdue-actions-v46',
        confirmButton:
          'av-overdue-confirm-v46',
        closeButton:
          'av-overdue-close-v46'
      },

      didOpen:
        (popup) => {
          /*
           * ล้างพื้นที่จาก title/icon/inline style รุ่นเดิม
           * ป้องกันกล่องขาวว่างด้านบนและความสูงผิดปกติ
           */
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
            'calc(100vw - 18px)';

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

          requestAlarmSound(
            signature,
            false
          );
        },

      willClose:
        (popup) => {
          state.pendingAudio =
            false;

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
        '[data-overdue-scroll-record]'
      )
      .forEach(
        (button) => {
          button.addEventListener(
            'click',
            () => {
              const id =
                button.dataset
                  .overdueScrollRecord;

              window.Swal.close();

              window.setTimeout(
                () => {
                  scrollToRecord(
                    id
                  );
                },
                80
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


  function collectOverdueRecords() {
    const thresholdSeconds =
      getOverdueThresholdSeconds();

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

            duration:
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
              'อยู่ในพื้นที่'
          };
        }
      )
      .sort(
        (left, right) =>
          right.durationSeconds -
          left.durationSeconds
      );
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


  function buildOverdueHtml(
    records
  ) {
    /*
     * จำกัดจำนวนที่วาดใน Alert เพื่อให้ทำงานลื่น
     * รายการทั้งหมดดูต่อได้จากหน้าหลัก
     */
    const maximumVisible =
      12;

    const visible =
      records.slice(
        0,
        maximumVisible
      );

    const thresholdText =
      text(
        document.getElementById(
          'thresholdOverdueText'
        )
      ) ||
      'ตามเกณฑ์โมดูล';

    return `
      <div class="av-overdue-dialog-v46">
        <header class="av-overdue-header-v46">
          <div class="av-overdue-heading-v46">
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
              · เรียงจากเวลาคงค้างสูงสุด
            </p>
          </div>

          <div class="av-overdue-header-actions-v46">
            <div class="av-overdue-total-v46">
              <strong>
                ${records.length}
              </strong>

              <span>
                รายการ
              </span>
            </div>

            <button
              type="button"
              class="av-overdue-sound-v46"
              data-overdue-play-sound
              aria-label="เล่นเสียงเตือนอีกครั้ง"
            >
              <span aria-hidden="true">
                🔊
              </span>

              <b>
                เล่นเสียง
              </b>
            </button>
          </div>
        </header>

        <div class="av-overdue-toolbar-v46">
          <span>
            แตะรายการเพื่อไปยังการ์ดรถ/ตู้ในหน้าหลัก
          </span>

          <strong>
            แสดง
            ${visible.length}
            จาก
            ${records.length}
          </strong>
        </div>

        <div
          class="av-overdue-list-v46"
          role="list"
          aria-label="รายการรถหรือตู้สินค้าที่เกินเวลา"
        >
          ${visible
            .map(
              (record, index) => `
                <button
                  type="button"
                  class="av-overdue-card-v46"
                  data-overdue-scroll-record="${escapeHtml(
                    record.recordId
                  )}"
                  role="listitem"
                >
                  <span class="av-overdue-card-top-v46">
                    <span class="av-overdue-rank-v46">
                      ${index + 1}
                    </span>

                    <span class="av-overdue-company-v46">
                      <small>
                        บริษัท / Vendor
                      </small>

                      <strong>
                        ${escapeHtml(
                          record.company
                        )}
                      </strong>

                      ${
                        record.driver
                          ? `
                              <em>
                                ผู้ขับ:
                                ${escapeHtml(
                                  record.driver
                                )}
                              </em>
                            `
                          : ''
                      }
                    </span>

                    <span class="av-overdue-duration-v46">
                      <small>
                        เวลาอยู่ในพื้นที่
                      </small>

                      <strong>
                        ${escapeHtml(
                          record.duration
                        )}
                      </strong>
                    </span>
                  </span>

                  <span class="av-overdue-identities-v46">
                    <span>
                      <small>
                        เลขนัดหมาย
                      </small>

                      <strong>
                        ${escapeHtml(
                          record.appointment
                        )}
                      </strong>
                    </span>

                    <span>
                      <small>
                        ทะเบียน / หมายเลขตู้
                      </small>

                      <strong>
                        ${escapeHtml(
                          record.registration
                        )}
                      </strong>
                    </span>
                  </span>

                  <span class="av-overdue-meta-v46">
                    <span>
                      <small>
                        เกิน SLA แล้ว
                      </small>

                      <strong class="is-danger">
                        ${escapeHtml(
                          record.overdueDuration
                        )}
                      </strong>
                    </span>

                    <span>
                      <small>
                        เวลา Gate In
                      </small>

                      <strong>
                        ${escapeHtml(
                          record.gateIn
                        )}
                      </strong>
                    </span>
                  </span>

                  <span class="av-overdue-stage-v46">
                    <small>
                      ขั้นตอนปัจจุบัน
                    </small>

                    <strong>
                      ${escapeHtml(
                        record.stage
                      )}
                    </strong>
                  </span>
                </button>
              `
            )
            .join('')}
        </div>

        ${
          records.length >
            visible.length
            ? `
                <div class="av-overdue-more-v46">
                  แสดงเฉพาะ
                  ${visible.length}
                  รายการที่เกินเวลาสูงสุด

                  <strong>
                    ยังเหลืออีก
                    ${records.length -
                      visible.length}
                    รายการ
                  </strong>
                </div>
              `
            : ''
        }

        <footer class="av-overdue-footer-v46">
          <span>
            รายการนี้ไม่ถูกลบและยังตรวจสอบต่อได้ในหน้าหลัก
          </span>

          <span>
            เสียงแจ้งเตือนจะไม่ดังซ้ำทุกครั้งที่รีเฟรช
          </span>
        </footer>
      </div>
    `;
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
