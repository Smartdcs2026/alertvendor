'use strict';

/************************************************************
 * vcw-inbound-menu.js
 * VCW-R08A — ปุ่มเมนูเข้า Inbound Workflow
 *
 * วิธีใช้:
 * 1) อัปโหลดไฟล์นี้ไว้ตำแหน่งเดียวกับ admin.html / module.html
 * 2) ใส่ก่อน </body> ในหน้าที่ต้องการให้มีปุ่ม:
 *    <script src="./vcw-inbound-menu.js?v=R08A" defer></script>
 *
 * หมายเหตุ:
 * - ไม่แตะระบบเดิม
 * - แสดงปุ่มเฉพาะ ADMIN / INBOUND
 * - ถ้าเช็กสิทธิ์ไม่ได้ จะไม่แสดงปุ่ม เพื่อความปลอดภัย
 ************************************************************/

(function () {
  const BUILD = 'VCW-R08A';
  const DEFAULT_API_BASE = 'https://alertvendor.somchaibutphon.workers.dev';
  const DEFAULT_MODULE_ID = 'vendors';

  const TOKEN_KEYS = [
    'alertvendor_access_token',
    'vehicle_status_access_token',
    'accessToken',
    'authToken',
    'token',
    'sessionToken'
  ];

  const ALLOWED_ROLES = new Set([
    'ADMIN',
    'INBOUND'
  ]);

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
      return;
    }
    fn();
  }

  ready(initInboundMenu);

  async function initInboundMenu() {
    try {
      if (document.getElementById('vcw-inbound-menu-entry')) {
        return;
      }

      const token = getAccessToken();
      if (!token) {
        return;
      }

      const me = await fetchCurrentUser(token);
      const role = String(me && me.role || '').trim().toUpperCase();

      if (!ALLOWED_ROLES.has(role)) {
        return;
      }

      injectStyle();
      renderButton(me);
    } catch (error) {
      console.warn('[VCW-R08A] ไม่สามารถแสดงปุ่ม Inbound ได้', error);
    }
  }

  function getApiBase() {
    const fromWindow =
      window.APP_CONFIG &&
      typeof window.APP_CONFIG.API_BASE === 'string'
        ? window.APP_CONFIG.API_BASE
        : '';

    const fromConfig =
      window.CONFIG &&
      typeof window.CONFIG.API_BASE === 'string'
        ? window.CONFIG.API_BASE
        : '';

    return String(fromWindow || fromConfig || DEFAULT_API_BASE)
      .trim()
      .replace(/\/+$/, '');
  }

  function getAccessToken() {
    for (const storage of [window.sessionStorage, window.localStorage]) {
      if (!storage) continue;

      for (const key of TOKEN_KEYS) {
        const value = String(storage.getItem(key) || '').trim();
        if (value) return value;
      }
    }

    return '';
  }

  async function fetchCurrentUser(token) {
    const response = await fetch(getApiBase() + '/api/auth/me', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer ' + token
      },
      credentials: 'omit'
    });

    const payload = await response.json().catch(function () {
      return null;
    });

    if (!response.ok || !payload || payload.success === false) {
      throw new Error(
        payload && payload.message
          ? payload.message
          : 'AUTH_ME_FAILED'
      );
    }

    const data = payload.data || payload;
    const user = data.user || data;

    return {
      username: String(user.username || '').trim(),
      displayName: String(user.displayName || user.name || '').trim(),
      role: String(user.role || '').trim().toUpperCase()
    };
  }

  function getCurrentModuleId() {
    const url = new URL(window.location.href);

    const candidates = [
      url.searchParams.get('module'),
      url.searchParams.get('moduleId'),
      url.searchParams.get('m'),
      document.body && document.body.dataset ? document.body.dataset.moduleId : ''
    ];

    for (const value of candidates) {
      const clean = String(value || '').trim();
      if (/^[\p{L}\p{N}_-]{1,80}$/u.test(clean)) {
        return clean;
      }
    }

    return DEFAULT_MODULE_ID;
  }

  function buildInboundUrl() {
    const moduleId = getCurrentModuleId();
    const url = new URL('./inbound.html', window.location.href);
    url.searchParams.set('module', moduleId);
    url.searchParams.set('v', BUILD);
    return url.toString();
  }

  function renderButton(user) {
    const wrapper = document.createElement('div');
    wrapper.id = 'vcw-inbound-menu-entry';
    wrapper.className = 'vcw-inbound-menu-entry';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'vcw-inbound-menu-button';
    button.setAttribute('aria-label', 'เปิดหน้า Inbound Workflow');
    button.innerHTML = [
      '<span class="vcw-inbound-menu-icon">QR</span>',
      '<span class="vcw-inbound-menu-text">Inbound</span>',
      '<span class="vcw-inbound-menu-role">' + escapeHtml(user.role || '') + '</span>'
    ].join('');

    button.addEventListener('click', function () {
      window.location.href = buildInboundUrl();
    });

    wrapper.appendChild(button);
    document.body.appendChild(wrapper);
  }

  function injectStyle() {
    if (document.getElementById('vcw-inbound-menu-style')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'vcw-inbound-menu-style';
    style.textContent = `
      .vcw-inbound-menu-entry {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 9999;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .vcw-inbound-menu-button {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        border: 0;
        border-radius: 999px;
        padding: 12px 16px;
        background: #0f3d5e;
        color: #ffffff;
        box-shadow: 0 12px 28px rgba(15, 61, 94, 0.28);
        cursor: pointer;
        font-weight: 800;
        letter-spacing: 0.01em;
      }

      .vcw-inbound-menu-button:active {
        transform: translateY(1px);
      }

      .vcw-inbound-menu-icon {
        display: inline-grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.16);
        font-size: 12px;
        line-height: 1;
      }

      .vcw-inbound-menu-text {
        font-size: 15px;
      }

      .vcw-inbound-menu-role {
        display: inline-flex;
        align-items: center;
        min-height: 22px;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.16);
        font-size: 11px;
        font-weight: 700;
      }

      @media (max-width: 640px) {
        .vcw-inbound-menu-entry {
          right: 12px;
          bottom: 12px;
        }

        .vcw-inbound-menu-button {
          padding: 11px 13px;
          gap: 8px;
        }

        .vcw-inbound-menu-role {
          display: none;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
