/**
 * module-workspace-compact.js
 * ROUND 3 — Responsive Workspace Runtime
 * Build: 2026.07.17-round3-responsive-r2-mobile-two-cards
 */
(function (window, document) {
  'use strict';

  const BUILD = '2026.07.17-round3-responsive-r2-mobile-two-cards';
  const state = {
    resizeRaf: 0,
    observer: null,
    mutationObserver: null,
    liveRegion: null,
    destroyed: false
  };

  document.addEventListener('DOMContentLoaded', initialize, { once: true });
  window.addEventListener('pagehide', destroy, { once: true });

  function initialize() {
    if (!document.body || !document.body.classList.contains('module-page')) {
      return;
    }

    document.body.dataset.moduleWorkspaceBuild = BUILD;
    document.documentElement.style.overflowX = 'clip';

    ensureLiveRegion();
    measureLayout();
    observeLayout();
    observeVehicleCards();
    bindEvents();
    updateFullscreenState();
  }

  function bindEvents() {
    window.addEventListener('resize', scheduleMeasure, { passive: true });
    window.addEventListener('orientationchange', scheduleMeasure, { passive: true });
    document.addEventListener('fullscreenchange', updateFullscreenState);
    document.addEventListener('webkitfullscreenchange', updateFullscreenState);
    document.addEventListener('alertvendor:records-updated', () => {
      window.requestAnimationFrame(() => {
        decorateVehicleCards();
        measureLayout();
      });
    });
    document.addEventListener('alertvendor:receiving-card-state', handleReceivingCardState);
  }

  function scheduleMeasure() {
    if (state.resizeRaf) {
      window.cancelAnimationFrame(state.resizeRaf);
    }

    state.resizeRaf = window.requestAnimationFrame(() => {
      state.resizeRaf = 0;
      measureLayout();
    });
  }

  function measureLayout() {
    if (state.destroyed || !document.body) return;

    const header = document.querySelector('.module-header');
    const footer = document.querySelector('body.module-page > footer.app-footer.module-footer');
    const container = document.querySelector('.module-container');
    const width = Math.max(0, document.documentElement.clientWidth || window.innerWidth || 0);

    document.documentElement.style.setProperty(
      '--module-header-measured',
      Math.ceil(header ? header.getBoundingClientRect().height : 58) + 'px'
    );
    document.documentElement.style.setProperty(
      '--module-footer-measured',
      Math.ceil(footer ? footer.getBoundingClientRect().height : 38) + 'px'
    );

    document.body.dataset.moduleViewport = viewportName(width);

    if (container) {
      const containerWidth = Math.round(container.getBoundingClientRect().width);
      container.dataset.workspaceDensity = densityName(containerWidth);
    }

    detectPageOverflow();
  }

  function viewportName(width) {
    if (width < 390) return 'PHONE_SMALL';
    if (width < 600) return 'PHONE';
    if (width < 900) return 'TABLET';
    if (width < 1280) return 'NOTEBOOK';
    if (width < 1700) return 'DESKTOP';
    return 'WIDE';
  }

  function densityName(width) {
    if (width < 480) return 'COMPACT';
    if (width < 900) return 'MEDIUM';
    return 'COMFORTABLE';
  }

  function observeLayout() {
    if (typeof ResizeObserver !== 'function') return;

    state.observer = new ResizeObserver(scheduleMeasure);
    [
      document.querySelector('.module-header'),
      document.querySelector('.module-container'),
      document.querySelector('body.module-page > footer.app-footer.module-footer')
    ].filter(Boolean).forEach((node) => state.observer.observe(node));
  }

  function observeVehicleCards() {
    const list = document.getElementById('vehicleList');
    if (!list || typeof MutationObserver !== 'function') {
      decorateVehicleCards();
      return;
    }

    state.mutationObserver = new MutationObserver((mutations) => {
      let changed = false;
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' && mutation.addedNodes.length) {
          changed = true;
        }
      });

      if (changed) {
        window.requestAnimationFrame(() => {
          decorateVehicleCards();
          detectPageOverflow();
        });
      }
    });

    state.mutationObserver.observe(list, {
      childList: true,
      subtree: true
    });

    decorateVehicleCards();
  }

  function decorateVehicleCards() {
    document.querySelectorAll('.vehicle-card').forEach((card) => {
      if (card.dataset.round3Responsive === 'TRUE') return;

      card.dataset.round3Responsive = 'TRUE';
      card.querySelectorAll('.vehicle-field strong, .vehicle-field a').forEach((node) => {
        const value = String(node.textContent || '').trim();
        if (value) node.title = value;
      });
    });
  }

  function handleReceivingCardState(event) {
    const detail = event && event.detail && typeof event.detail === 'object'
      ? event.detail
      : {};
    const recordId = String(detail.recordId || '');
    const active = detail.active === true;
    const card = findCard(recordId);

    if (card) {
      card.classList.toggle('is-receiving-busy', active);
      if (active) {
        card.setAttribute('aria-busy', 'true');
      } else if (!card.querySelector('.receiving-card-progress, .receiving-live-status')) {
        card.removeAttribute('aria-busy');
      }
    }

    if (active && detail.message) {
      announce(String(detail.message));
    }
  }

  function findCard(recordId) {
    if (!recordId) return null;
    const escaped = window.CSS && typeof window.CSS.escape === 'function'
      ? window.CSS.escape(recordId)
      : recordId.replace(/["\\]/g, '\\$&');
    return document.querySelector('.vehicle-card[data-record-id="' + escaped + '"]');
  }

  function ensureLiveRegion() {
    let region = document.getElementById('moduleWorkspaceLiveRegion');
    if (!region) {
      region = document.createElement('div');
      region.id = 'moduleWorkspaceLiveRegion';
      region.className = 'sr-only';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      region.setAttribute('aria-atomic', 'true');
      document.body.appendChild(region);
    }
    state.liveRegion = region;
  }

  function announce(message) {
    if (!state.liveRegion) return;
    state.liveRegion.textContent = '';
    window.setTimeout(() => {
      if (state.liveRegion) state.liveRegion.textContent = message;
    }, 30);
  }

  function updateFullscreenState() {
    const active = Boolean(
      document.fullscreenElement ||
      document.webkitFullscreenElement
    );
    document.body && document.body.classList.toggle('is-native-fullscreen', active);
    scheduleMeasure();
  }

  function detectPageOverflow() {
    if (!document.body) return;

    const rootWidth = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth > rootWidth + 2;
    document.body.dataset.horizontalOverflow = overflow ? 'TRUE' : 'FALSE';

    if (overflow) {
      console.warn('ROUND 3: พบองค์ประกอบกว้างเกินหน้าจอ', {
        viewportWidth: rootWidth,
        scrollWidth: document.documentElement.scrollWidth
      });
    }
  }

  function destroy() {
    state.destroyed = true;
    if (state.resizeRaf) window.cancelAnimationFrame(state.resizeRaf);
    if (state.observer) state.observer.disconnect();
    if (state.mutationObserver) state.mutationObserver.disconnect();
  }
})(window, document);

/**
 * ROUND 3 REVISION 4 — Professional Mobile Menu + Workspace Presentation
 * Build: 2026.07.17-round3-r4-professional-module-ui
 */
(function (window, document) {
  'use strict';

  const BUILD = '2026.07.17-round3-r4-professional-module-ui';
  const STORAGE_KEY = 'alertvendor:module:operational-board-collapsed';
  const state = {
    drawerOpen: false,
    historyEntryActive: false,
    scrollY: 0,
    previousFocus: null,
    observer: null,
    userObserver: null,
    titleObserver: null
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }

  function initialize() {
    if (!document.body || !document.body.classList.contains('module-page')) return;

    document.body.dataset.moduleProfessionalUiBuild = BUILD;
    bindDrawer();
    bindDrawerActions();
    bindSnapshotMirror();
    bindIdentityMirror();
    bindFullscreenState();
    bindOperationalBoardCollapse();
    syncSnapshotMirror();
    syncIdentityMirror();
    syncFullscreenLabel();
  }

  function element(id) {
    return document.getElementById(id);
  }

  function bindDrawer() {
    const openButton = element('mobileModuleMenuButton');
    const closeButton = element('mobileModuleDrawerClose');
    const overlay = element('mobileModuleDrawerOverlay');
    const drawer = element('mobileModuleDrawer');

    if (!openButton || !closeButton || !overlay || !drawer) return;

    openButton.addEventListener('click', () => openDrawer({ pushHistory: true }));
    closeButton.addEventListener('click', requestCloseDrawer);
    overlay.addEventListener('click', requestCloseDrawer);

    drawer.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestCloseDrawer();
        return;
      }

      if (event.key === 'Tab') trapFocus(event, drawer);
    });

    window.addEventListener('popstate', () => {
      if (!state.drawerOpen) return;
      state.historyEntryActive = false;
      closeDrawerNow();
    });

    window.addEventListener('resize', () => {
      if (window.matchMedia('(min-width: 961px)').matches && state.drawerOpen) {
        closeDrawerNow();
      }
    }, { passive: true });
  }

  function openDrawer(options) {
    if (state.drawerOpen) return;

    const drawer = element('mobileModuleDrawer');
    const overlay = element('mobileModuleDrawerOverlay');
    const button = element('mobileModuleMenuButton');
    if (!drawer || !overlay || !button) return;

    const config = options && typeof options === 'object' ? options : {};
    state.drawerOpen = true;
    state.previousFocus = document.activeElement;
    state.scrollY = Math.max(0, window.scrollY || window.pageYOffset || 0);

    overlay.hidden = false;
    drawer.setAttribute('aria-hidden', 'false');
    drawer.classList.add('is-open');
    button.setAttribute('aria-expanded', 'true');
    document.body.classList.add('module-menu-open');
    document.body.style.position = 'fixed';
    document.body.style.top = '-' + state.scrollY + 'px';
    document.body.style.width = '100%';

    if (config.pushHistory !== false && !state.historyEntryActive) {
      try {
        window.history.pushState({ alertVendorModuleDrawer: true }, '', window.location.href);
        state.historyEntryActive = true;
      } catch (error) {
        state.historyEntryActive = false;
      }
    }

    window.requestAnimationFrame(() => {
      const first = firstFocusable(drawer) || drawer;
      first.focus({ preventScroll: true });
    });
  }

  function requestCloseDrawer() {
    if (!state.drawerOpen) return;

    if (state.historyEntryActive) {
      state.historyEntryActive = false;
      window.history.back();
      return;
    }

    closeDrawerNow();
  }

  function closeDrawerNow() {
    const drawer = element('mobileModuleDrawer');
    const overlay = element('mobileModuleDrawerOverlay');
    const button = element('mobileModuleMenuButton');

    state.drawerOpen = false;
    drawer && drawer.classList.remove('is-open');
    drawer && drawer.setAttribute('aria-hidden', 'true');
    if (overlay) overlay.hidden = true;
    button && button.setAttribute('aria-expanded', 'false');

    if (document.body) {
      document.body.classList.remove('module-menu-open');
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
    }

    window.scrollTo({ top: state.scrollY, left: 0, behavior: 'auto' });

    const focusTarget = state.previousFocus && document.contains(state.previousFocus)
      ? state.previousFocus
      : button;
    focusTarget && focusTarget.focus({ preventScroll: true });
  }

  function trapFocus(event, container) {
    const focusable = getFocusable(container);
    if (!focusable.length) {
      event.preventDefault();
      container.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function getFocusable(container) {
    return Array.from(container.querySelectorAll([
      'button:not([disabled]):not([hidden])',
      'a[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(','))).filter((node) => {
      const style = window.getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }

  function firstFocusable(container) {
    return getFocusable(container)[0] || null;
  }

  function bindDrawerActions() {
    document.querySelectorAll('[data-module-menu-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = String(button.dataset.moduleMenuAction || '').toUpperCase();
        runDrawerAction(action);
      });
    });

    const retry = element('mobileDrawerSnapshotRetry');
    retry && retry.addEventListener('click', () => {
      const source = element('moduleSnapshotRetry');
      if (source && !source.hidden && !source.disabled) source.click();
    });
  }

  function runDrawerAction(action) {
    const map = {
      DASHBOARD: 'moduleDashboardLauncher',
      CALENDAR: 'calendarButton',
      REFRESH: 'operationalBoardRefresh',
      ALERT: 'operationalAlertToggle',
      THRESHOLD: 'thresholdInfoButton',
      HOME: 'backButton',
      LOGOUT: 'logoutButton'
    };

    if (action === 'FULLSCREEN') {
      void toggleFullscreen();
      return;
    }

    const target = element(map[action]);
    if (!target) return;

    const waitsForHistoryClose = state.historyEntryActive;
    requestCloseDrawer();
    window.setTimeout(() => target.click(), waitsForHistoryClose ? 120 : 30);
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } else {
        const target = document.documentElement;
        if (target.requestFullscreen) await target.requestFullscreen({ navigationUI: 'hide' });
        else if (target.webkitRequestFullscreen) target.webkitRequestFullscreen();
      }
    } catch (error) {
      console.warn('เปิดโหมดเต็มหน้าจอไม่สำเร็จ', error);
    } finally {
      syncFullscreenLabel();
    }
  }

  function bindFullscreenState() {
    document.addEventListener('fullscreenchange', syncFullscreenLabel);
    document.addEventListener('webkitfullscreenchange', syncFullscreenLabel);
  }

  function syncFullscreenLabel() {
    const label = element('mobileMenuFullscreenLabel');
    if (!label) return;
    label.textContent = document.fullscreenElement || document.webkitFullscreenElement
      ? 'ออกจากเต็มหน้าจอ'
      : 'เปิดเต็มหน้าจอ';
  }

  function bindSnapshotMirror() {
    const panel = element('moduleSnapshotState');
    if (!panel || typeof MutationObserver !== 'function') return;

    state.observer = new MutationObserver(syncSnapshotMirror);
    state.observer.observe(panel, {
      attributes: true,
      attributeFilter: ['data-state', 'aria-label'],
      childList: true,
      subtree: true,
      characterData: true
    });

    document.addEventListener('alertvendor:module-board-health', syncSnapshotMirror);
  }

  function syncSnapshotMirror() {
    const panel = element('moduleSnapshotState');
    const sourceTitle = element('moduleSnapshotTitle');
    const sourceDetail = element('moduleSnapshotDetail');
    const sourceRetry = element('moduleSnapshotRetry');
    const drawerStatus = document.querySelector('.module-mobile-menu__status');
    const drawerTitle = element('mobileDrawerSnapshotTitle');
    const drawerDetail = element('mobileDrawerSnapshotDetail');
    const drawerRetry = element('mobileDrawerSnapshotRetry');
    const menuButton = element('mobileModuleMenuButton');

    const status = String(panel && panel.dataset.state || 'LOADING').toUpperCase();
    drawerStatus && drawerStatus.setAttribute('data-drawer-status', status);
    menuButton && menuButton.setAttribute('data-server-state', status);
    if (drawerTitle) drawerTitle.textContent = String(sourceTitle && sourceTitle.textContent || 'กำลังตรวจสอบข้อมูล').trim();
    if (drawerDetail) drawerDetail.textContent = String(sourceDetail && sourceDetail.textContent || '').trim();
    if (drawerRetry) {
      drawerRetry.hidden = !sourceRetry || sourceRetry.hidden;
      drawerRetry.disabled = Boolean(sourceRetry && sourceRetry.disabled);
    }
  }

  function bindIdentityMirror() {
    const user = element('userDisplayName');
    const title = element('moduleTitle');
    if (typeof MutationObserver !== 'function') return;

    if (user) {
      state.userObserver = new MutationObserver(syncIdentityMirror);
      state.userObserver.observe(user, { childList: true, subtree: true, characterData: true });
    }

    if (title) {
      state.titleObserver = new MutationObserver(syncIdentityMirror);
      state.titleObserver.observe(title, { childList: true, subtree: true, characterData: true });
    }
  }

  function syncIdentityMirror() {
    const sourceUser = element('userDisplayName');
    const sourceTitle = element('moduleTitle');
    const drawerUser = element('mobileModuleDrawerUser');
    const drawerTitle = element('mobileModuleDrawerTitle');

    if (drawerUser) {
      const name = String(sourceUser && sourceUser.textContent || '').trim();
      drawerUser.textContent = name ? 'ผู้ใช้งาน: ' + name : 'กำลังอ่านข้อมูลผู้ใช้งาน';
    }

    if (drawerTitle) {
      const name = String(sourceTitle && sourceTitle.textContent || '').trim();
      drawerTitle.textContent = name || 'สถานะรถและตู้สินค้า';
    }
  }

  function bindOperationalBoardCollapse() {
    const panel = element('operationalBoardPanel');
    const toggle = element('operationalBoardCollapseToggle');
    if (!panel || !toggle) return;

    let collapsed = true;
    try {
      const saved = window.sessionStorage.getItem(STORAGE_KEY);
      collapsed = saved === null ? true : saved === 'TRUE';
    } catch (error) {
      collapsed = true;
    }

    setOperationalBoardCollapsed(collapsed);

    toggle.addEventListener('click', () => {
      setOperationalBoardCollapsed(!panel.classList.contains('is-professional-collapsed'));
    });

    document.querySelectorAll('[data-mobile-workspace]').forEach((button) => {
      button.addEventListener('click', () => {
        const workspace = String(button.dataset.mobileWorkspace || 'LIST').toUpperCase();
        if (workspace !== 'LIST' && window.matchMedia('(max-width: 767px)').matches) {
          panel.classList.remove('is-professional-collapsed');
        }
      });
    });
  }

  function setOperationalBoardCollapsed(collapsed) {
    const panel = element('operationalBoardPanel');
    const toggle = element('operationalBoardCollapseToggle');
    if (!panel || !toggle) return;

    panel.classList.toggle('is-professional-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.textContent = collapsed ? 'เปิดภาพรวมกะ' : 'ย่อภาพรวมกะ';

    try {
      window.sessionStorage.setItem(STORAGE_KEY, collapsed ? 'TRUE' : 'FALSE');
    } catch (error) {
      // sessionStorage อาจถูกปิดในโหมดส่วนตัวบางอุปกรณ์
    }
  }
})(window, document);
