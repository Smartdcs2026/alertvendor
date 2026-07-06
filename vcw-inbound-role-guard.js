'use strict';

/************************************************************
 * vcw-inbound-role-guard.js
 * VCW-R08B
 *
 * ใช้ป้องกันหน้า inbound.html ฝั่ง Browser
 * - ต้อง Login ก่อน
 * - อนุญาตเฉพาะ ADMIN / INBOUND
 * - ถ้าไม่มีสิทธิ์ให้บล็อกหน้า และพากลับ Login/Admin
 ************************************************************/

(function () {
  var BUILD = 'VCW-R08B';

  var DEFAULT_API_BASE =
    'https://alertvendor.somchaibutphon.workers.dev';

  var ALLOWED_ROLES = {
    ADMIN: true,
    INBOUND: true
  };

  function getApiBase() {
    if (
      window.VCWWorkflowApi &&
      typeof window.VCWWorkflowApi.getApiBase === 'function'
    ) {
      return window.VCWWorkflowApi.getApiBase();
    }

    if (window.API_BASE) {
      return String(window.API_BASE).replace(/\/+$/, '');
    }

    if (window.CONFIG && window.CONFIG.API_BASE) {
      return String(window.CONFIG.API_BASE).replace(/\/+$/, '');
    }

    return DEFAULT_API_BASE;
  }

  function getStoredToken() {
    var keys = [
      'alertvendor_access_token',
      'vehicle_status_access_token',
      'accessToken',
      'token',
      'vcw_access_token'
    ];

    var stores = [
      window.sessionStorage,
      window.localStorage
    ];

    for (var s = 0; s < stores.length; s += 1) {
      var store = stores[s];

      if (!store) continue;

      for (var i = 0; i < keys.length; i += 1) {
        var value = String(store.getItem(keys[i]) || '').trim();

        if (value) {
          return value;
        }
      }

      for (var j = 0; j < store.length; j += 1) {
        var key = store.key(j);
        var item = String(store.getItem(key) || '').trim();

        if (
          item &&
          item.indexOf('.') > 0 &&
          item.length > 50 &&
          /token|session|auth/i.test(key)
        ) {
          return item;
        }
      }
    }

    return '';
  }

  async function fetchMe() {
    var token = getStoredToken();

    if (!token) {
      throw createClientError(
        'TOKEN_NOT_FOUND',
        'ไม่พบ Session กรุณาเข้าสู่ระบบก่อน'
      );
    }

    var response = await fetch(
      getApiBase() + '/api/auth/me',
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + token
        },
        cache: 'no-store'
      }
    );

    var json = await response.json().catch(function () {
      return null;
    });

    if (!response.ok || !json || json.success === false) {
      throw createClientError(
        json && json.code
          ? json.code
          : 'AUTH_CHECK_FAILED',
        json && json.message
          ? json.message
          : 'ตรวจสอบสิทธิ์ไม่สำเร็จ'
      );
    }

    var data = json.data || json;
    var user = data.user || data;

    return {
      token: token,
      data: data,
      user: user,
      role: String(user.role || '').trim().toUpperCase()
    };
  }

  function createClientError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function showBlockedPage(title, message, role) {
    document.body.innerHTML =
      '<main style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f1f5f9;font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:20px;">' +
        '<section style="width:min(560px,100%);background:white;border-radius:22px;padding:24px;box-shadow:0 20px 60px rgba(15,23,42,.12);border:1px solid #dbe4ef;">' +
          '<div style="font-size:13px;font-weight:800;letter-spacing:.08em;color:#0f766e;margin-bottom:8px;">' +
            BUILD +
          '</div>' +
          '<h1 style="font-size:24px;margin:0 0 12px;color:#0f172a;">' +
            escapeHtml(title) +
          '</h1>' +
          '<p style="font-size:15px;line-height:1.6;color:#475569;margin:0 0 10px;">' +
            escapeHtml(message) +
          '</p>' +
          (
            role
              ? '<p style="font-size:14px;color:#64748b;margin:0 0 18px;">สิทธิ์ปัจจุบัน: <b>' + escapeHtml(role) + '</b></p>'
              : ''
          ) +
          '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px;">' +
            '<a href="./admin.html" style="text-decoration:none;border-radius:14px;background:#0f3d5e;color:white;padding:12px 16px;font-weight:800;">กลับหน้า Login / Admin</a>' +
            '<a href="./inbound.html?module=vendors&v=' + encodeURIComponent(BUILD) + '" style="text-decoration:none;border-radius:14px;background:#e2e8f0;color:#0f172a;padding:12px 16px;font-weight:800;">ลองโหลดใหม่</a>' +
          '</div>' +
        '</section>' +
      '</main>';
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function runGuard() {
    try {
      var result = await fetchMe();

      if (!ALLOWED_ROLES[result.role]) {
        showBlockedPage(
          'ไม่มีสิทธิ์เข้าใช้งานหน้า Inbound',
          'หน้านี้อนุญาตเฉพาะผู้ใช้สิทธิ์ ADMIN หรือ INBOUND เท่านั้น',
          result.role || '(ไม่พบ role)'
        );

        return {
          allowed: false,
          user: result.user,
          role: result.role
        };
      }

      window.VCW_INBOUND_AUTH = {
        allowed: true,
        user: result.user,
        role: result.role,
        checkedAt: new Date().toISOString(),
        build: BUILD
      };

      document.documentElement.setAttribute(
        'data-vcw-inbound-role',
        result.role
      );

      window.dispatchEvent(
        new CustomEvent(
          'vcw:inbound-role-ready',
          {
            detail: window.VCW_INBOUND_AUTH
          }
        )
      );

      return window.VCW_INBOUND_AUTH;

    } catch (error) {
      showBlockedPage(
        'กรุณาเข้าสู่ระบบก่อน',
        error.message || 'ไม่สามารถตรวจสอบ Session ได้',
        ''
      );

      return {
        allowed: false,
        error: {
          code: error.code || 'AUTH_ERROR',
          message: error.message || String(error)
        }
      };
    }
  }

  window.VCWInboundRoleGuard = {
    build: BUILD,
    run: runGuard,
    allowedRoles: Object.keys(ALLOWED_ROLES)
  };

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      runGuard,
      { once: true }
    );
  } else {
    runGuard();
  }
})();
