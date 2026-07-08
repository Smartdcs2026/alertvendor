/*
 * vcw-inbound-only-route-guard.js
 * VCW-R14L
 *
 * เงื่อนไข:
 * - ถ้าผู้ใช้ role = INBOUND ให้เข้าได้เฉพาะ inbound.html
 * - ห้ามเข้า admin.html / index.html / dashboard / หน้าอื่นของระบบ
 * - login.html ไม่ถูกบล็อก เพื่อให้ logout/login ได้
 */
(function (window, document) {
  'use strict';

  const BUILD = 'VCW-R14L';
  const API_BASE = 'https://alertvendor.somchaibutphon.workers.dev';

  const TOKEN_KEYS = [
    'alertvendor_access_token',
    'access_token',
    'accessToken',
    'token',
    'sessionToken',
    'authToken'
  ];

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  function init() {
    exposeApi();

    if (isPublicPage()) {
      return;
    }

    enforceInboundOnly();
  }

  function exposeApi() {
    window.VCWInboundOnlyRouteGuard = {
      version: BUILD,
      check: enforceInboundOnly
    };
  }

  function isPublicPage() {
    const path = String(window.location.pathname || '').toLowerCase();

    return (
      path.endsWith('/login.html') ||
      path.endsWith('/vcw-token-repair.html') ||
      path.indexOf('/login.html') !== -1 ||
      window.location.search.indexOf('logout=1') !== -1
    );
  }

  function isInboundPage() {
    const path = String(window.location.pathname || '').toLowerCase();

    return path.endsWith('/inbound.html') || path.indexOf('/inbound.html') !== -1;
  }

  async function enforceInboundOnly() {
    const token = getToken();

    if (!token) {
      return;
    }

    const me = await getMe(token);

    if (!me || !me.success) {
      return;
    }

    const user = normalizeUser(me.data);
    const role = String(user.role || '').trim().toUpperCase();

    if (role !== 'INBOUND') {
      return;
    }

    if (isInboundPage()) {
      return;
    }

    blockAndRedirect(user);
  }

  async function getMe(token) {
    try {
      const response = await window.fetch(API_BASE + '/api/auth/me', {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          Authorization: 'Bearer ' + token
        }
      });

      const data = await response.json().catch(function () {
        return {};
      });

      return {
        success: response.ok && data && data.success !== false,
        status: response.status,
        data: data && data.data ? data.data : data
      };

    } catch (error) {
      return {
        success: false,
        message: error && error.message ? error.message : String(error)
      };
    }
  }

  function normalizeUser(data) {
    if (data && data.user) {
      return data.user;
    }

    return data || {};
  }

  function blockAndRedirect(user) {
    const inboundUrl =
      './inbound.html?module=vendors&v=R08H&t=' + Date.now();

    if (window.Swal && typeof window.Swal.fire === 'function') {
      window.Swal.fire({
        icon: 'info',
        title: 'สิทธิ์ INBOUND',
        text: 'บัญชีนี้เข้าใช้งานได้เฉพาะหน้าห้อง Inbound เท่านั้น',
        timer: 1400,
        showConfirmButton: false
      }).then(function () {
        window.location.replace(inboundUrl);
      });

      return;
    }

    window.location.replace(inboundUrl);
  }

  function getToken() {
    for (let s = 0; s < 2; s += 1) {
      const storage = s === 0 ? window.sessionStorage : window.localStorage;

      for (let i = 0; i < TOKEN_KEYS.length; i += 1) {
        try {
          const value = storage.getItem(TOKEN_KEYS[i]);

          if (value && String(value).length >= 20) {
            return String(value).replace(/^Bearer\s+/i, '').trim();
          }
        } catch (error) {}
      }
    }

    return '';
  }
})(window, document);
