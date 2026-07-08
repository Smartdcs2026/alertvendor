/*
 * vcw-logout-hardening.js
 * VCW-R14M
 *
 * HOTFIX:
 * - แก้ปัญหากดปุ่ม "ออกจากระบบ" ใน SweetAlert แล้วไม่ไปไหน
 * - สาเหตุ: ตัวดักคลิก logout ไปดักปุ่ม confirm ใน SweetAlert ซ้ำ
 * - รุ่นนี้ไม่ดักปุ่มที่อยู่ใน .swal2-container และมี lock กันคลิกซ้ำ
 */
(function (window, document) {
  'use strict';

  const BUILD = 'VCW-R14M';

  const AUTH_KEYS = [
    'alertvendor_access_token',
    'alertvendor_token',
    'alertvendorAccessToken',
    'alertvendor_auth_token',
    'alertvendor_session_token',
    'alertvendor_last_token_source',
    'alertvendor_last_token_saved_at',
    'av_access_token',
    'access_token',
    'accessToken',
    'authToken',
    'token',
    'sessionToken',
    'jwt',
    'idToken',
    'vehicle_status_access_token',
    'vehicle_access_token',
    'vehicleStatusAccessToken',
    'vehicle_status_token'
  ];

  const REMOVE_HINTS = [
    'alertvendor',
    'access_token',
    'accesstoken',
    'authtoken',
    'sessiontoken',
    'vehicle_status_access_token',
    'vehicle_access_token'
  ];

  const LOGOUT_QUERY_KEYS = [
    'logout',
    'forceLogout',
    'signedOut'
  ];

  let logoutRunning = false;

  initEarly();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDom, { once: true });
  } else {
    initDom();
  }

  function initEarly() {
    const params = new URLSearchParams(window.location.search || '');

    const isLogoutPage = LOGOUT_QUERY_KEYS.some(function (key) {
      return params.get(key) === '1';
    });

    if (isLogoutPage) {
      clearAuthStorage('logout-query');
    }
  }

  function initDom() {
    exposeApi();
    bindLogoutClicks();
  }

  function exposeApi() {
    window.VCWLogoutHardening = {
      version: BUILD,
      clear: clearAuthStorage,
      logout: doLogout,
      forceLogout: forceLogout,
      snapshot: getAuthSnapshot
    };
  }

  function bindLogoutClicks() {
    document.addEventListener(
      'click',
      function (event) {
        const rawTarget = event.target;

        if (
          rawTarget &&
          rawTarget.closest &&
          rawTarget.closest('.swal2-container')
        ) {
          return;
        }

        const el = rawTarget && rawTarget.closest
          ? rawTarget.closest('button, a, [role="button"]')
          : null;

        if (!el || !isLogoutControl(el)) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();

        doLogout();
      },
      true
    );
  }

  function isLogoutControl(el) {
    if (!el) {
      return false;
    }

    if (
      el.closest &&
      el.closest('.swal2-container')
    ) {
      return false;
    }

    const text = String(el.textContent || '').trim().toLowerCase();
    const attrs = [
      el.id,
      el.name,
      el.className,
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.getAttribute('href'),
      el.getAttribute('data-action')
    ].join(' ').toLowerCase();

    return (
      text.indexOf('ออกจากระบบ') !== -1 ||
      text.indexOf('logout') !== -1 ||
      text.indexOf('log out') !== -1 ||
      attrs.indexOf('logout') !== -1 ||
      attrs.indexOf('signout') !== -1 ||
      attrs.indexOf('sign-out') !== -1
    );
  }

  async function doLogout() {
    if (logoutRunning) {
      return;
    }

    logoutRunning = true;

    const ok = await confirmLogout();

    if (!ok) {
      logoutRunning = false;
      return;
    }

    await forceLogout('manual-logout');
  }

  async function forceLogout(reason) {
    const token = findToken();

    try {
      await callLogoutApi(token);
    } catch (error) {
      // ต่อให้ backend logout fail ก็ต้องล้าง token ฝั่ง browser
    }

    clearAuthStorage(reason || 'force-logout');

    window.location.replace(
      './login.html?logout=1&v=R14M&t=' + Date.now()
    );
  }

  async function confirmLogout() {
    if (window.Swal && typeof window.Swal.fire === 'function') {
      const result = await window.Swal.fire({
        icon: 'question',
        title: 'ออกจากระบบ',
        text: 'ต้องการออกจากระบบหรือไม่',
        showCancelButton: true,
        confirmButtonText: 'ออกจากระบบ',
        cancelButtonText: 'ยกเลิก',
        confirmButtonColor: '#0f3d5e',
        allowOutsideClick: false,
        allowEscapeKey: true
      });

      return result.isConfirmed === true;
    }

    return window.confirm('ต้องการออกจากระบบหรือไม่');
  }

  async function callLogoutApi(token) {
    const apiBase = resolveApiBase();

    if (!apiBase || !window.fetch) {
      return;
    }

    const headers = {
      'Content-Type': 'application/json'
    };

    if (token) {
      headers.Authorization = 'Bearer ' + token;
    }

    await window.fetch(apiBase.replace(/\/+$/, '') + '/api/auth/logout', {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: headers,
      body: JSON.stringify({
        reason: 'manual-logout',
        client: BUILD
      })
    });
  }

  function clearAuthStorage(reason) {
    const removed = [];

    [window.sessionStorage, window.localStorage].forEach(function (storage) {
      if (!storage) {
        return;
      }

      AUTH_KEYS.forEach(function (key) {
        if (removeKey(storage, key)) {
          removed.push(key);
        }
      });

      const allKeys = [];

      try {
        for (let i = 0; i < storage.length; i += 1) {
          allKeys.push(storage.key(i));
        }
      } catch (error) {}

      allKeys.forEach(function (key) {
        const lower = String(key || '').toLowerCase();

        const shouldRemove = REMOVE_HINTS.some(function (hint) {
          return lower.indexOf(hint) !== -1;
        });

        if (shouldRemove && removeKey(storage, key)) {
          removed.push(key);
        }
      });
    });

    try {
      window.localStorage.setItem('alertvendor_last_logout_at', new Date().toISOString());
      window.localStorage.setItem('alertvendor_last_logout_reason', reason || '');
    } catch (error) {}

    window.dispatchEvent(
      new CustomEvent('vcw-auth-cleared', {
        detail: {
          version: BUILD,
          reason: reason || '',
          removedCount: removed.length
        }
      })
    );

    return removed;
  }

  function removeKey(storage, key) {
    try {
      if (storage.getItem(key) !== null) {
        storage.removeItem(key);
        return true;
      }
    } catch (error) {}

    return false;
  }

  function findToken() {
    for (let s = 0; s < 2; s += 1) {
      const storage = s === 0 ? window.sessionStorage : window.localStorage;

      for (let i = 0; i < AUTH_KEYS.length; i += 1) {
        try {
          const value = storage.getItem(AUTH_KEYS[i]);

          if (value && String(value).length >= 20) {
            return String(value).replace(/^Bearer\s+/i, '').trim();
          }
        } catch (error) {}
      }
    }

    return '';
  }

  function getAuthSnapshot() {
    const snapshot = [];

    [window.sessionStorage, window.localStorage].forEach(function (storage) {
      const storageName =
        storage === window.sessionStorage
          ? 'sessionStorage'
          : 'localStorage';

      AUTH_KEYS.forEach(function (key) {
        try {
          const value = storage.getItem(key);

          if (value) {
            snapshot.push({
              storage: storageName,
              key: key,
              length: String(value).length
            });
          }
        } catch (error) {}
      });
    });

    return snapshot;
  }

  function resolveApiBase() {
    if (window.CONFIG && window.CONFIG.API_BASE) {
      return window.CONFIG.API_BASE;
    }

    if (window.APP_CONFIG && window.APP_CONFIG.API_BASE) {
      return window.APP_CONFIG.API_BASE;
    }

    return 'https://alertvendor.somchaibutphon.workers.dev';
  }
})(window, document);
