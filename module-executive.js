/**
 * module-executive.js
 * ROUND 28 — ลดข้อมูลซ้ำและคำนวณสุทธิจริง
 */
(function (window, document) {
  'use strict';

  document.addEventListener(
    'DOMContentLoaded',
    initializeExecutiveModuleUi
  );

  function initializeExecutiveModuleUi() {
    bindHourlyToggle();
    observeMovementNumbers();
    updateActualNet();
  }

  function bindHourlyToggle() {
    const button =
      document.getElementById(
        'moduleHourlyDetailToggle'
      );

    const panel =
      document.getElementById(
        'moduleHourlyDetails'
      );

    if (!button || !panel) {
      return;
    }

    button.addEventListener(
      'click',
      () => {
        const expanded =
          button.getAttribute(
            'aria-expanded'
          ) === 'true';

        const nextExpanded =
          !expanded;

        button.setAttribute(
          'aria-expanded',
          String(nextExpanded)
        );

        button.textContent =
          nextExpanded
            ? 'ซ่อนรายละเอียดรายชั่วโมง'
            : 'ดูรายละเอียดรายชั่วโมง';

        panel.hidden =
          !nextExpanded;

        panel.classList.toggle(
          'is-collapsed',
          !nextExpanded
        );

        document.body.classList.toggle(
          'module-hourly-expanded',
          nextExpanded
        );

        if (nextExpanded) {
          window.requestAnimationFrame(
            () => {
              panel.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
              });
            }
          );
        }
      }
    );
  }

  function observeMovementNumbers() {
    const observer =
      new MutationObserver(
        updateActualNet
      );

    [
      document.getElementById(
        'movementIn'
      ),
      document.getElementById(
        'movementOutReal'
      )
    ]
      .filter(Boolean)
      .forEach(
        (element) => {
          observer.observe(
            element,
            {
              childList: true,
              characterData: true,
              subtree: true
            }
          );
        }
      );
  }

  function updateActualNet() {
    const inCount =
      readNumber('movementIn');

    const outReal =
      readNumber('movementOutReal');

    const net =
      inCount - outReal;

    const target =
      document.getElementById(
        'movementNetActual'
      );

    if (target) {
      target.textContent =
        net > 0
          ? '+' + net
          : String(net);
    }
  }

  function readNumber(id) {
    const element =
      document.getElementById(id);

    const value =
      Number(
        String(
          element &&
          element.textContent ||
          '0'
        ).replace(
          /[^\d.-]/g,
          ''
        )
      );

    return Number.isFinite(value)
      ? value
      : 0;
  }

})(window, document);
