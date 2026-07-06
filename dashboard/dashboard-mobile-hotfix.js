/************************************************************
 * dashboard-mobile-hotfix.js
 * ROUND 76 — Mobile DOM Watchdog
 *
 * ทำงานเฉพาะจอ <= 920px
 * - ย้าย toolbar กลับไปอยู่บนเนื้อหา
 * - ปิด loading overlay ที่ค้างในหน้า SHIFT/DAILY
 * - ยกเลิก inline style ที่ทำให้ workspace จาง/ถูกบีบ
 ************************************************************/
(function (window, document) {
  'use strict';

  const MAX_WIDTH = 920;
  let timer = 0;
  let observer = null;

  function isMobileWidth() {
    return window.matchMedia(
      '(max-width: ' + MAX_WIDTH + 'px)'
    ).matches;
  }

  function currentView() {
    return String(
      document.body &&
      document.body.dataset &&
      document.body.dataset.dashboardView ||
      'LIVE'
    ).toUpperCase();
  }

  function applyMobileHotfix() {
    if (!document.body) {
      return;
    }

    if (!isMobileWidth()) {
      document.body.classList.remove(
        'mobile-dashboard-hotfix'
      );
      return;
    }

    document.body.classList.add(
      'mobile-dashboard-hotfix'
    );

    moveToolbarToTop();
    normalizeWorkspace();
    hideStaleLoader();
  }

  function moveToolbarToTop() {
    const main = document.querySelector(
      '.control-main'
    );

    const toolbar = document.getElementById(
      'dashboardViewToolbar'
    );

    if (!main || !toolbar) {
      return;
    }

    if (toolbar.parentElement !== main) {
      main.insertBefore(
        toolbar,
        main.firstElementChild
      );
    } else if (main.firstElementChild !== toolbar) {
      main.insertBefore(
        toolbar,
        main.firstElementChild
      );
    }

    toolbar.style.position = 'relative';
    toolbar.style.inset = 'auto';
    toolbar.style.top = 'auto';
    toolbar.style.right = 'auto';
    toolbar.style.bottom = 'auto';
    toolbar.style.left = 'auto';
    toolbar.style.order = '-100';
    toolbar.style.opacity = '1';
    toolbar.style.visibility = 'visible';
    toolbar.style.filter = 'none';
    toolbar.style.transform = 'none';
  }

  function normalizeWorkspace() {
    const view = currentView();
    const workspace = document.getElementById(
      'dashboardShiftWorkspace'
    );

    const main = document.querySelector(
      '.control-main'
    );

    [main, workspace].forEach((element) => {
      if (!element) {
        return;
      }

      element.style.height = 'auto';
      element.style.maxHeight = 'none';
      element.style.overflow = 'visible';
      element.style.opacity = '1';
      element.style.visibility = 'visible';
      element.style.filter = 'none';
      element.style.transform = 'none';
    });

    if (workspace) {
      workspace.hidden = view === 'LIVE';

      if (view !== 'LIVE') {
        workspace.style.display = 'grid';
      } else {
        workspace.style.display = '';
      }
    }
  }

  function hideStaleLoader() {
    const view = currentView();
    const loader = document.getElementById(
      'dashboardLoading'
    );

    if (
      loader &&
      view !== 'LIVE'
    ) {
      loader.classList.add(
        'is-hidden'
      );

      loader.style.display = 'none';
      loader.style.opacity = '0';
      loader.style.visibility = 'hidden';
      loader.style.pointerEvents = 'none';
    }
  }

  function schedule() {
    window.clearTimeout(timer);

    timer = window.setTimeout(
      applyMobileHotfix,
      40
    );
  }

  function startObserver() {
    if (observer || !document.body) {
      return;
    }

    observer = new MutationObserver(
      schedule
    );

    observer.observe(
      document.body,
      {
        attributes: true,
        attributeFilter: [
          'data-dashboard-view',
          'class'
        ],
        childList: true,
        subtree: true
      }
    );
  }

  function init() {
    applyMobileHotfix();
    startObserver();

    document.addEventListener(
      'click',
      (event) => {
        if (
          event.target &&
          event.target.closest &&
          event.target.closest('[data-dashboard-view]')
        ) {
          window.setTimeout(
            applyMobileHotfix,
            80
          );
        }
      },
      true
    );

    window.addEventListener(
      'resize',
      schedule,
      {
        passive: true
      }
    );

    window.addEventListener(
      'orientationchange',
      schedule,
      {
        passive: true
      }
    );

    window.setTimeout(
      applyMobileHotfix,
      300
    );

    window.setTimeout(
      applyMobileHotfix,
      1200
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      init
    );
  } else {
    init();
  }

})(window, document);
