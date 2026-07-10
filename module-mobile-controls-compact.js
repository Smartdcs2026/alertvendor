/************************************************************
 * module-mobile-controls-compact.js
 * ROUND 06 PART 09.1E — Mobile Compact Search/Filter Drawer
 *
 * ลดพื้นที่ Search / Status / Sort / Calendar บนมือถือ
 ************************************************************/
(function (window, document) {
  'use strict';

  const MOBILE_MAX_WIDTH =
    760;

  const state = {
    open: false,
    observer: null,
    timer: 0
  };

  document.addEventListener(
    'DOMContentLoaded',
    init
  );

  window.addEventListener(
    'resize',
    () => scheduleSetup(100)
  );

  function init() {
    injectStyle();
    setup();
    observe();
  }

  function isMobile() {
    return window.innerWidth <= MOBILE_MAX_WIDTH;
  }

  function observe() {
    if (
      typeof MutationObserver !== 'function'
    ) {
      return;
    }

    state.observer =
      new MutationObserver(
        () => scheduleSetup(120)
      );

    state.observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }

  function scheduleSetup(delay) {
    window.clearTimeout(
      state.timer
    );

    state.timer =
      window.setTimeout(
        setup,
        Number(delay) || 0
      );
  }

  function setup() {
    const tools =
      document.querySelector(
        '.vehicle-tools'
      );

    if (!tools) return;

    let toggle =
      document.getElementById(
        'mobileToolsToggleBar'
      );

    if (!toggle) {
      toggle =
        document.createElement('div');

      toggle.id =
        'mobileToolsToggleBar';

      toggle.className =
        'mobile-tools-toggle-bar';

      toggle.innerHTML = `
        <button type="button" id="mobileToolsToggleButton">
          <span>ค้นหา / ตัวกรอง / ปฏิทิน</span>
          <strong>เปิด</strong>
        </button>
      `;

      tools.parentNode.insertBefore(
        toggle,
        tools
      );

      toggle
        .querySelector('button')
        .addEventListener(
          'click',
          () => {
            state.open =
              !state.open;

            applyState();
          }
        );
    }

    if (!isMobile()) {
      state.open = true;
    }

    if (
      hasActiveInput(tools)
    ) {
      state.open = true;
    }

    applyState();
  }

  function hasActiveInput(tools) {
    const search =
      tools.querySelector(
        'input'
      );

    if (
      search &&
      String(search.value || '').trim()
    ) {
      return true;
    }

    const selects =
      Array.from(
        tools.querySelectorAll('select')
      );

    return selects.some((select) => {
      const value =
        String(select.value || '').trim();

      return (
        value &&
        ![
          'ALL',
          'ทั้งหมด',
          'ทุกสถานะ',
          'DURATION_DESC'
        ].includes(value.toUpperCase())
      );
    });
  }

  function applyState() {
    document.body.classList.toggle(
      'mobile-tools-open',
      Boolean(state.open)
    );

    const button =
      document.getElementById(
        'mobileToolsToggleButton'
      );

    if (button) {
      const strong =
        button.querySelector('strong');

      if (strong) {
        strong.textContent =
          state.open
            ? 'ปิด'
            : 'เปิด';
      }
    }
  }

  function injectStyle() {
    if (
      document.getElementById(
        'mobileControlsCompactStyle'
      )
    ) {
      return;
    }

    const style =
      document.createElement('style');

    style.id =
      'mobileControlsCompactStyle';

    style.textContent = `
      .mobile-tools-toggle-bar {
        display: none;
      }

      @media (max-width: 760px) {
        .mobile-tools-toggle-bar {
          display: block;
          width: calc(100% - 18px);
          margin: 8px auto 6px;
        }

        .mobile-tools-toggle-bar button {
          width: 100%;
          min-height: 44px;
          border: 1px solid #bae6fd;
          border-radius: 16px;
          background: linear-gradient(135deg, #ffffff, #f0fdfa);
          color: #0f3d5e;
          font: inherit;
          font-weight: 950;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 14px;
          box-shadow: 0 8px 20px rgba(15, 23, 42, .06);
        }

        .mobile-tools-toggle-bar strong {
          min-width: 54px;
          min-height: 26px;
          border-radius: 999px;
          background: #e0f2fe;
          color: #075985;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
        }

        body:not(.mobile-tools-open)
        .vehicle-tools {
          display: none !important;
        }

        body.mobile-tools-open
        .vehicle-tools {
          display: grid !important;
          grid-template-columns: 1fr 1fr !important;
          gap: 8px !important;
          width: calc(100% - 18px) !important;
          margin: 0 auto 8px !important;
          padding: 10px !important;
          border-radius: 18px !important;
        }

        body.mobile-tools-open
        .vehicle-search {
          grid-column: 1 / -1 !important;
        }

        body.mobile-tools-open
        .vehicle-search input,
        body.mobile-tools-open
        .vehicle-filter select,
        body.mobile-tools-open
        .vehicle-sort select,
        body.mobile-tools-open
        .vehicle-tool-button {
          min-height: 42px !important;
          border-radius: 13px !important;
          font-size: 13px !important;
        }

        body.mobile-tools-open
        .vehicle-tool-button {
          grid-column: 1 / -1 !important;
        }
      }
    `;

    document.head.appendChild(
      style
    );
  }
})(window, document);
