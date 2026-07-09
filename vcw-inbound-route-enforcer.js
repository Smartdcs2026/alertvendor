/*
 * vcw-inbound-route-enforcer.js
 * VCW-R14R
 *
 * จุดประสงค์:
 * - ผู้ใช้ Role INBOUND ต้องถูกพาไปหน้า inbound.html เท่านั้น
 * - ห้ามอยู่หน้า index.html / admin.html / dashboard / หน้าอื่น
 * - หน้า login.html ไม่บล็อก เพื่อให้ login/logout ได้
 * - หน้า inbound.html เข้าได้ตามปกติ
 *
 * วิธีติดตั้ง:
 * - ใส่ script นี้ใน login.html, index.html, admin.html และหน้าระบบอื่น
 * - แนะนำให้วางหลัง config.js และก่อน auth.js/api.js เท่าที่ทำได้
 */
(function (window, document) {
  'use strict';

  const BUILD = 'VCW-R14R';
  const DEFAULT_API_BASE = 'https://alertvendor.somchaibutphon.workers.dev';
  const DEFAULT_INBOUND_MODULE = 'vendors';

  const TOKEN_KEYS = [
    'alertvendor_access_token',
    'access_token',
    'accessToken',
    'token',
    'sessionToken',
    'authToken',
    'alertvendor_token',
    'vehicle_status_access_token',
    'vehicle_access_token'
  ];

  const USER_KEYS = [
    'alertvendor_user',
    'alertvendor_current_user',
    'currentUser',
    'auth_user',
    'user',
    'vehicle_status_user',
    'alertvendor_session'
  ];

  let checking = false;
  let redirected = false;

  runEarly();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runDom, { once: true });
  } else {
    runDom();
  }

  function runEarly() {
    exposeApi();

    // ถ้าอยู่หน้า login ให้ดักผล login เฉพาะกรณี response มี role INBOUND
    // เพื่อพยายามพาไป inbound โดยตรงก่อนระบบเดิมส่งไป index
    if (isLoginPage()) {
      hookFetchLoginResponse();
      return;
    }

    // หน้าอื่นให้ตรวจเร็วที่สุด
    window.setTimeout(enforce, 0);
    window.setTimeout(enforce, 250);
    window.setTimeout(enforce, 900);
  }

  function runDom() {
    exposeApi();

    if (!isLoginPage()) {
      enforce();
    }
  }

  function exposeApi() {
    window.VCWInboundRouteEnforcer = {
      version: BUILD,
      enforce: enforce,
      getLocalUser: getLocalUser,
      getTokenInfo: getTokenInfo
    };
  }

  function hookFetchLoginResponse() {
    if (!window.fetch || window.fetch.__vcwInboundRouteEnforcerR14R) {
      return;
    }

    const originalFetch = window.fetch;

    window.fetch = async function () {
      const response = await originalFetch.apply(this, arguments);

      try {
        const urlText = String(arguments[0] && arguments[0].url ? arguments[0].url : arguments[0] || '').toLowerCase();

        if (urlText.indexOf('/api/auth/login') !== -1 || urlText.indexOf('/api/login') !== -1) {
          response.clone().json().then(function (payload) {
            const user = extractUser(payload);
            const role = String(user && user.role || '').trim().toUpperCase();

            if (role === 'INBOUND') {
              markInboundSession(user);
              window.setTimeout(goInbound, 120);
            }
          }).catch(function () {});
        }
      } catch (error) {}

      return response;
    };

    window.fetch.__vcwInboundRouteEnforcerR14R = true;
  }

  async function enforce() {
    if (checking || redirected || isLoginPage() || isInboundPage()) {
      return;
    }

    checking = true;

    try {
      const localUser = getLocalUser();
      const localRole = String(localUser && localUser.role || '').trim().toUpperCase();

      if (localRole === 'INBOUND') {
        goInbound();
        return;
      }

      const token = getToken();

      if (!token) {
        return;
      }

      const me = await getMe(token);

      if (!me || !me.success) {
        return;
      }

      const user = normalizeMeUser(me.data);
      const role = String(user && user.role || '').trim().toUpperCase();

      if (role === 'INBOUND') {
        markInboundSession(user);
        goInbound();
      }

    } finally {
      checking = false;
    }
  }

  function goInbound() {
    if (redirected || isInboundPage()) {
      return;
    }

    redirected = true;

    const target =
      './inbound.html?module=' +
      encodeURIComponent(DEFAULT_INBOUND_MODULE) +
      '&v=R14R&t=' +
      Date.now();

    try {
      showRedirectOverlay();
    } catch (error) {}

    window.location.replace(target);
  }

  function showRedirectOverlay() {
    if (document.getElementById('vcwInboundRedirectOverlay')) {
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'vcwInboundRedirectOverlay';
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483647',
      'background:rgba(241,245,249,.96)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'color:#0f172a',
      'text-align:center',
      'padding:24px'
    ].join(';');

    overlay.innerHTML =
      '<div style="background:#fff;border:1px solid #dbe4ef;border-radius:22px;padding:24px;box-shadow:0 18px 50px rgba(15,23,42,.18);max-width:420px;width:100%;">' +
      '<div style="font-size:13px;font-weight:900;color:#047857;letter-spacing:.04em;">INBOUND ACCESS</div>' +
      '<h2 style="margin:8px 0 6px;font-size:22px;">กำลังเปิดหน้าห้อง Inbound</h2>' +
      '<p style="margin:0;color:#64748b;font-size:14px;">บัญชีนี้เข้าใช้งานได้เฉพาะหน้าสแกน Inbound เท่านั้น</p>' +
      '</div>';

    document.body.appendChild(overlay);
  }

  async function getMe(token) {
    try {
      const apiBase = resolveApiBase();

      const response = await window.fetch(apiBase.replace(/\/+$/, '') + '/api/auth/me', {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          Authorization: 'Bearer ' + token
        }
      });

      const payload = await response.json().catch(function () {
        return {};
      });

      return {
        success: response.ok && payload && payload.success !== false,
        status: response.status,
        data: payload && payload.data ? payload.data : payload,
        raw: payload
      };

    } catch (error) {
      return {
        success: false,
        status: 0,
        message: error && error.message ? error.message : String(error)
      };
    }
  }

  function extractUser(payload) {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const data = payload.data || payload;

    return data.user || data.viewer || data.account || null;
  }

  function normalizeMeUser(data) {
    if (data && data.user) {
      return data.user;
    }

    return data || {};
  }

  function markInboundSession(user) {
    if (!user || typeof user !== 'object') {
      return;
    }

    const text = JSON.stringify(user);

    USER_KEYS.forEach(function (key) {
      safeSet(window.sessionStorage, key, text);
      safeSet(window.localStorage, key, text);
    });

    safeSet(window.sessionStorage, 'vcw_inbound_only', '1');
    safeSet(window.localStorage, 'vcw_inbound_only', '1');
  }

  function getLocalUser() {
    for (let s = 0; s < 2; s += 1) {
      const storage = s === 0 ? window.sessionStorage : window.localStorage;

      for (let i = 0; i < USER_KEYS.length; i += 1) {
        const raw = safeGet(storage, USER_KEYS[i]);

        if (!raw) {
          continue;
        }

        const user = parseUser(raw);

        if (user && user.role) {
          return user;
        }
      }
    }

    return null;
  }

  function parseUser(raw) {
    try {
      const obj = JSON.parse(raw);

      if (obj && obj.user && obj.user.role) {
        return obj.user;
      }

      if (obj && obj.role) {
        return obj;
      }

      if (obj && obj.data && obj.data.user && obj.data.user.role) {
        return obj.data.user;
      }

      return null;

    } catch (error) {
      return null;
    }
  }

  function getToken() {
    for (let s = 0; s < 2; s += 1) {
      const storage = s === 0 ? window.sessionStorage : window.localStorage;

      for (let i = 0; i < TOKEN_KEYS.length; i += 1) {
        const value = safeGet(storage, TOKEN_KEYS[i]);
        const token = normalizeToken(value);

        if (isTokenLike(token)) {
          return token;
        }
      }
    }

    return '';
  }

  function getTokenInfo() {
    const found = [];

    for (let s = 0; s < 2; s += 1) {
      const storage = s === 0 ? window.sessionStorage : window.localStorage;
      const storageName = s === 0 ? 'sessionStorage' : 'localStorage';

      TOKEN_KEYS.forEach(function (key) {
        const value = safeGet(storage, key);

        if (value) {
          found.push({
            storage: storageName,
            key: key,
            length: String(value).length,
            tokenLike: isTokenLike(value)
          });
        }
      });
    }

    return {
      version: BUILD,
      hasToken: found.some(function (item) { return item.tokenLike; }),
      found: found
    };
  }

  function isLoginPage() {
    const path = String(window.location.pathname || '').toLowerCase();

    return path.indexOf('/login.html') !== -1 || path.endsWith('/login');
  }

  function isInboundPage() {
    const path = String(window.location.pathname || '').toLowerCase();

    return path.indexOf('/inbound.html') !== -1;
  }

  function resolveApiBase() {
    if (window.CONFIG && window.CONFIG.API_BASE) {
      return window.CONFIG.API_BASE;
    }

    if (window.APP_CONFIG && window.APP_CONFIG.API_BASE) {
      return window.APP_CONFIG.API_BASE;
    }

    return DEFAULT_API_BASE;
  }

  function normalizeToken(value) {
    return String(value || '').replace(/^Bearer\s+/i, '').trim();
  }

  function isTokenLike(value) {
    const token = normalizeToken(value);

    if (!token) {
      return false;
    }

    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
      return true;
    }

    return token.length >= 80 && /^[A-Za-z0-9._~+/=-]+$/.test(token);
  }

  function safeGet(storage, key) {
    try {
      return storage.getItem(key) || '';
    } catch (error) {
      return '';
    }
  }

  function safeSet(storage, key, value) {
    try {
      storage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }
})(window, document);
