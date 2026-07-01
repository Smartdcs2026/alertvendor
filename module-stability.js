/**
 * module-stability.js
 * ROUND 29 — Interaction and Timeline Stability
 *
 * ต้องโหลดหลัง api.js และก่อน module.js
 */
(function (window, document) {
  'use strict';

  const API =
    window.VehicleAPI;

  const state = {
    refreshDepth: 0,
    refreshWindowUntil: 0,
    preRefreshScrollLeft: 0,
    preRefreshWindowY: 0,
    userIntentUntil: 0,
    initialSettled: false,
    restoring: false,
    timeline: null,
    observer: null,
    restoreRaf: null,
    restoreTimer: null,
    lastMovementSignature: '',
    lastMovementGeneratedAt: '',
    lastMovementGeneratedAtEpochMs: null
  };

  wrapApiRefresh(
    'getRecords'
  );

  wrapApiRefresh(
    'getMovementSummary',
    stabilizeMovementGeneratedAt
  );

  document.addEventListener(
    'DOMContentLoaded',
    initializeTimelineStability
  );

  window.addEventListener(
    'beforeunload',
    destroyTimelineStability
  );

  function wrapApiRefresh(
    methodName,
    transformResult
  ) {
    if (
      !API ||
      typeof API[methodName] !==
        'function' ||
      API[methodName]
        .__round29Wrapped
    ) {
      return;
    }

    const original =
      API[methodName].bind(
        API
      );

    const wrapped =
      async function (...args) {
        beginRefreshWindow();

        try {
          const result =
            await original(
              ...args
            );

          return typeof transformResult ===
            'function'
              ? transformResult(
                  result
                )
              : result;

        } finally {
          endRefreshWindow();
        }
      };

    wrapped.__round29Wrapped =
      true;

    API[methodName] =
      wrapped;
  }


  function beginRefreshWindow() {
    state.refreshDepth += 1;

    const timeline =
      state.timeline ||
      document.getElementById(
        'hourlyTimeline'
      );

    if (timeline) {
      state.preRefreshScrollLeft =
        timeline.scrollLeft;
    }

    state.preRefreshWindowY =
      window.scrollY;
  }


  function endRefreshWindow() {
    state.refreshDepth =
      Math.max(
        0,
        state.refreshDepth - 1
      );

    /*
     * Promise ของ API จบก่อน module.js วาด DOM
     * จึงเปิดช่วงป้องกันต่ออีกเล็กน้อย
     */
    state.refreshWindowUntil =
      Date.now() + 1400;

    window.setTimeout(
      restoreTimelinePosition,
      0
    );

    window.setTimeout(
      restoreTimelinePosition,
      80
    );

    window.setTimeout(
      restoreTimelinePosition,
      260
    );
  }


  function stabilizeMovementGeneratedAt(
    result
  ) {
    if (
      !result ||
      typeof result !==
        'object'
    ) {
      return result;
    }

    const signature =
      stableMovementSignature(
        result
      );

    if (
      signature ===
        state.lastMovementSignature &&
      state.lastMovementGeneratedAt
    ) {
      return {
        ...result,
        generatedAt:
          state.lastMovementGeneratedAt,
        generatedAtEpochMs:
          state
            .lastMovementGeneratedAtEpochMs
      };
    }

    state.lastMovementSignature =
      signature;

    state.lastMovementGeneratedAt =
      result.generatedAt || '';

    state.lastMovementGeneratedAtEpochMs =
      result.generatedAtEpochMs ||
      null;

    return result;
  }


  function stableMovementSignature(
    result
  ) {
    return JSON.stringify({
      thresholds:
        result.thresholds || {},
      currentState:
        stableCurrentState(
          result.currentState
        ),
      currentRound:
        stableMetric(
          result.currentRound
        ),
      today:
        stableMetric(
          result.today
        ),
      rolling24:
        stableMetric(
          result.rolling24
        ),
      hours:
        stableHours(
          result.hours
        )
    });
  }


  function stableCurrentState(source) {
    const value =
      source &&
      typeof source ===
        'object'
        ? source
        : {};

    return {
      activeNow:
        Number(
          value.activeNow
        ) || 0,
      normal:
        Number(
          value.normal
        ) || 0,
      warning:
        Number(
          value.warning
        ) || 0,
      overdue:
        Number(
          value.overdue
        ) || 0,
      incomplete:
        Number(
          value.incomplete
        ) || 0,
      nearAutoClose:
        Number(
          value.nearAutoClose
        ) || 0
    };
  }


  function stableMetric(source) {
    const value =
      source &&
      typeof source ===
        'object'
        ? source
        : {};

    return {
      in:
        Number(value.in) || 0,
      outReal:
        Number(
          value.outReal
        ) || 0,
      outAuto:
        Number(
          value.outAuto
        ) || 0,
      outTotal:
        Number(
          value.outTotal
        ) || 0,
      total:
        Number(
          value.total ||
          value.movementTotal
        ) || 0,
      net:
        Number(value.net) || 0
    };
  }


  function stableHours(source) {
    const value =
      source &&
      typeof source ===
        'object'
        ? source
        : {};

    const result = {};

    Object.keys(value)
      .sort()
      .forEach(
        (key) => {
          result[key] =
            (
              Array.isArray(
                value[key]
              )
                ? value[key]
                : []
            ).map(
              (hour) => ({
                startEpochMs:
                  Number(
                    hour.startEpochMs ||
                    hour.startMs
                  ) || 0,
                label:
                  String(
                    hour.label ||
                    hour.hourLabel ||
                    hour.hour ||
                    ''
                  ),
                in:
                  Number(
                    hour.in
                  ) || 0,
                outReal:
                  Number(
                    hour.outReal
                  ) || 0,
                outAuto:
                  Number(
                    hour.outAuto
                  ) || 0,
                outTotal:
                  Number(
                    hour.outTotal
                  ) || 0,
                net:
                  Number(
                    hour.net
                  ) || 0
              })
            );
        }
      );

    return result;
  }


  function initializeTimelineStability() {
    state.timeline =
      document.getElementById(
        'hourlyTimeline'
      );

    if (!state.timeline) {
      return;
    }

    const markUserIntent =
      () => {
        state.userIntentUntil =
          Date.now() + 2600;

        state.preRefreshScrollLeft =
          state.timeline.scrollLeft;

        state.preRefreshWindowY =
          window.scrollY;
      };

    [
      'pointerdown',
      'touchstart',
      'wheel',
      'keydown'
    ].forEach(
      (eventName) => {
        state.timeline.addEventListener(
          eventName,
          markUserIntent,
          {
            passive:
              eventName !==
              'keydown'
          }
        );
      }
    );

    document
      .getElementById(
        'moduleHourlyDetailToggle'
      )
      ?.addEventListener(
        'pointerdown',
        markUserIntent,
        {
          passive: true
        }
      );

    state.timeline.addEventListener(
      'scroll',
      () => {
        if (!state.restoring) {
          state.preRefreshScrollLeft =
            state.timeline.scrollLeft;
        }
      },
      {
        passive: true
      }
    );

    window.addEventListener(
      'scroll',
      rememberWindowScroll,
      {
        passive: true
      }
    );

    /*
     * ป้องกัน scrollIntoView ที่เกิดจาก Silent Refresh
     * แต่ยังอนุญาตเมื่อผู้ใช้กด/ลาก Timeline เอง
     */
    patchScrollIntoView();

    state.observer =
      new MutationObserver(
        () => {
          if (
            !state.initialSettled ||
            !isRefreshWindow()
          ) {
            return;
          }

          scheduleTimelineRestore();
        }
      );

    state.observer.observe(
      state.timeline,
      {
        childList: true,
        subtree: true
      }
    );

    window.setTimeout(
      () => {
        state.initialSettled = true;
        state.preRefreshScrollLeft =
          state.timeline.scrollLeft;
        state.preRefreshWindowY =
          window.scrollY;
      },
      2200
    );
  }


  function rememberWindowScroll() {
    if (
      !state.restoring &&
      !isRefreshWindow()
    ) {
      state.preRefreshWindowY =
        window.scrollY;
    }
  }


  function patchScrollIntoView() {
    const prototype =
      window.Element &&
      window.Element.prototype;

    if (
      !prototype ||
      prototype.scrollIntoView
        .__round29Wrapped
    ) {
      return;
    }

    const original =
      prototype.scrollIntoView;

    const wrapped =
      function (...args) {
        const insideTimeline =
          state.timeline &&
          (
            this === state.timeline ||
            state.timeline.contains(
              this
            )
          );

        if (
          insideTimeline &&
          state.initialSettled &&
          isRefreshWindow() &&
          Date.now() >
            state.userIntentUntil
        ) {
          scheduleTimelineRestore();
          return;
        }

        return original.apply(
          this,
          args
        );
      };

    wrapped.__round29Wrapped =
      true;

    prototype.scrollIntoView =
      wrapped;
  }


  function isRefreshWindow() {
    return (
      state.refreshDepth > 0 ||
      Date.now() <
        state.refreshWindowUntil
    );
  }


  function scheduleTimelineRestore() {
    if (state.restoreRaf) {
      window.cancelAnimationFrame(
        state.restoreRaf
      );
    }

    state.restoreRaf =
      window.requestAnimationFrame(
        () => {
          state.restoreRaf =
            window.requestAnimationFrame(
              restoreTimelinePosition
            );
        }
      );

    if (state.restoreTimer) {
      window.clearTimeout(
        state.restoreTimer
      );
    }

    state.restoreTimer =
      window.setTimeout(
        restoreTimelinePosition,
        180
      );
  }


  function restoreTimelinePosition() {
    if (
      !state.timeline ||
      !state.initialSettled ||
      Date.now() <=
        state.userIntentUntil
    ) {
      return;
    }

    state.restoring = true;

    const maxLeft =
      Math.max(
        0,
        state.timeline.scrollWidth -
        state.timeline.clientWidth
      );

    state.timeline.scrollLeft =
      Math.min(
        maxLeft,
        Math.max(
          0,
          state.preRefreshScrollLeft
        )
      );

    if (
      !document.querySelector(
        '.swal2-container'
      ) &&
      Math.abs(
        window.scrollY -
        state.preRefreshWindowY
      ) > 2
    ) {
      window.scrollTo({
        top:
          state.preRefreshWindowY,
        left:
          window.scrollX,
        behavior:
          'auto'
      });
    }

    window.requestAnimationFrame(
      () => {
        state.restoring = false;
      }
    );
  }


  function destroyTimelineStability() {
    if (state.observer) {
      state.observer.disconnect();
    }

    if (state.restoreRaf) {
      window.cancelAnimationFrame(
        state.restoreRaf
      );
    }

    if (state.restoreTimer) {
      window.clearTimeout(
        state.restoreTimer
      );
    }

    window.removeEventListener(
      'scroll',
      rememberWindowScroll
    );
  }

})(window, document);
