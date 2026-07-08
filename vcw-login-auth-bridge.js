/*
 * vcw-login-auth-bridge.js
 * VCW-R14O
 *
 * HOTFIX จาก R14N:
 * - R14N อาจหยิบ userId / requestId ที่ยาวเหมือน token มาเก็บผิด
 * - ทำให้ login แล้วไป index.html แต่ /api/auth/me ได้ 401 Session หมดอายุ
 *
 * รุ่นนี้:
 * - ดึง token เฉพาะ key ที่เป็น token จริงเท่านั้น เช่น accessToken, access_token, token, sessionToken
 * - ไม่เดา token จาก string ยาวทั่วไป
 * - ล้าง session เก่าก่อน login ทุกครั้ง
 * - ADMIN / USER ไป index.html
 * - INBOUND ไป inbound.html
 */
(function (window, document) {
  'use strict';

  const BUILD = 'VCW-R14O';

  const API_BASE =
    (window.CONFIG && window.CONFIG.API_BASE) ||
    (window.APP_CONFIG && window.APP_CONFIG.API_BASE) ||
    'https://alertvendor.somchaibutphon.workers.dev';

  const TOKEN_KEYS = [
    'alertvendor_access_token',
    'alertvendor_token',
    'alertvendorAccessToken',
    'alertvendor_auth_token',
    'alertvendor_session_token',
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

  const USER_KEYS = [
    'alertvendor_user',
    'alertvendor_current_user',
    'currentUser',
    'auth_user',
    'user',
    'vehicle_status_user'
  ];

  const TOKEN_FIELD_NAMES = [
    'accesstoken',
    'access_token',
    'token',
    'authtoken',
    'sessiontoken',
    'jwt',
    'idtoken',
    'bearer',
    'bearertoken'
  ];

  let submitting = false;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  function init() {
    exposeApi();

    const form =
      document.getElementById('loginForm') ||
      document.querySelector('form.login-form') ||
      document.querySelector('form');

    if (!form) {
      return;
    }

    form.addEventListener('submit', handleSubmit, true);
  }

  function exposeApi() {
    window.VCWLoginAuthBridge = {
      version: BUILD,
      login: loginWithWorker,
      persistSession: persistSession,
      clearSession: clearSession,
      getTokenInfo: getTokenInfo,
      extractTokenStrict: extractTokenStrict
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();

    if (submitting) {
      return;
    }

    const usernameInput =
      document.getElementById('username') ||
      document.querySelector('[name="username"]');

    const passwordInput =
      document.getElementById('password') ||
      document.querySelector('[name="password"]');

    const username = String(usernameInput && usernameInput.value || '').trim();
    const password = String(passwordInput && passwordInput.value || '');

    if (!username || !password) {
      showAlert('warning', 'กรอกข้อมูลไม่ครบ', 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
      return;
    }

    submitting = true;
    setButtonBusy(true);

    try {
      clearSession('before-login');

      const result = await loginWithWorker(username, password);

      if (!result.success) {
        clearSession('login-failed');
        showAlert('error', 'เข้าสู่ระบบไม่สำเร็จ', result.message || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
        return;
      }

      const session = normalizeLoginResult(result);

      if (!session.token) {
        console.warn('VCW-R14O login raw result without token', result);
        showAlert('error', 'เข้าสู่ระบบไม่สำเร็จ', 'Server ไม่ส่ง accessToken/token กลับมา');
        return;
      }

      persistSession(session, 'login-success-r14o');

      await showSuccessBrief(session);

      redirectByRole(session.user);

    } catch (error) {
      showAlert(
        'error',
        'เข้าสู่ระบบไม่สำเร็จ',
        error && error.message ? error.message : String(error)
      );

    } finally {
      submitting = false;
      setButtonBusy(false);
    }
  }

  async function loginWithWorker(username, password) {
    const body = {
      username: username,
      password: password
    };

    let result = await postJson('/api/auth/login', body);

    if (
      !result.success &&
      (
        result.status === 404 ||
        result.code === 'ROUTE_NOT_FOUND' ||
        result.code === 'NOT_FOUND'
      )
    ) {
      result = await postJson('/api/login', body);
    }

    return result;
  }

  async function postJson(path, body) {
    const url = API_BASE.replace(/\/+$/, '') + path;

    const response = await window.fetch(url, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const raw = await response.json().catch(function () {
      return {};
    });

    const success =
      response.ok &&
      raw &&
      raw.success !== false &&
      !(raw.error && raw.error.code);

    return {
      success: success,
      status: response.status,
      raw: raw,
      data: raw && raw.data ? raw.data : raw,
      code: raw && raw.error && raw.error.code ? raw.error.code : raw.code || '',
      message:
        raw && raw.error && raw.error.message
          ? raw.error.message
          : raw.message || ''
    };
  }

  function normalizeLoginResult(result) {
    const raw = result.raw || {};
    const data = result.data || {};

    const token =
      extractTokenStrict(data) ||
      extractTokenStrict(raw) ||
      '';

    const user =
      data.user ||
      data.viewer ||
      data.account ||
      raw.user ||
      raw.viewer ||
      {};

    const role =
      String(
        user.role ||
        data.role ||
        raw.role ||
        ''
      ).trim().toUpperCase();

    if (role && !user.role) {
      user.role = role;
    }

    return {
      token: normalizeToken(token),
      user: user,
      expiresAt: data.expiresAt || raw.expiresAt || '',
      raw: raw
    };
  }

  function extractTokenStrict(value) {
    if (value === undefined || value === null) {
      return '';
    }

    if (typeof value === 'string') {
      return '';
    }

    const found = [];

    walk(value, '', 0);

    return found[0] || '';

    function walk(item, path, depth) {
      if (depth > 5 || item === undefined || item === null) {
        return;
      }

      if (Array.isArray(item)) {
        item.slice(0, 5).forEach(function (child, index) {
          walk(child, path + '[' + index + ']', depth + 1);
        });
        return;
      }

      if (typeof item !== 'object') {
        return;
      }

      Object.keys(item).forEach(function (key) {
        const valueAtKey = item[key];
        const normalizedKey = String(key || '').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();

        if (
          TOKEN_FIELD_NAMES.indexOf(normalizedKey) !== -1 &&
          typeof valueAtKey === 'string' &&
          isTokenLike(valueAtKey)
        ) {
          found.push(valueAtKey);
          return;
        }

        walk(valueAtKey, path ? path + '.' + key : key, depth + 1);
      });
    }
  }

  function persistSession(session, source) {
    const token = normalizeToken(session.token);

    if (!isTokenLike(token)) {
      return false;
    }

    TOKEN_KEYS.forEach(function (key) {
      setBoth(key, token);
    });

    const userText = JSON.stringify(session.user || {});

    USER_KEYS.forEach(function (key) {
      setBoth(key, userText);
    });

    setBoth('alertvendor_session', JSON.stringify({
      accessToken: token,
      token: token,
      user: session.user || {},
      authenticated: true,
      expiresAt: session.expiresAt || '',
      savedAt: new Date().toISOString(),
      source: source || BUILD
    }));

    setBoth('alertvendor_last_token_source', source || BUILD);
    setBoth('alertvendor_last_token_saved_at', new Date().toISOString());

    if (
      window.VCWAuthPersistence &&
      typeof window.VCWAuthPersistence.persistToken === 'function'
    ) {
      window.VCWAuthPersistence.persistToken(token, 'login-bridge-r14o');
    }

    return true;
  }

  function clearSession(reason) {
    TOKEN_KEYS.concat(USER_KEYS).forEach(function (key) {
      removeBoth(key);
    });

    removeBoth('alertvendor_session');
    setBoth('alertvendor_last_logout_reason', reason || '');
    setBoth('alertvendor_last_logout_at', new Date().toISOString());
  }

  function redirectByRole(user) {
    const role = String(user && user.role || '').trim().toUpperCase();

    let target = './index.html?v=R14O&t=' + Date.now();

    if (role === 'INBOUND') {
      target = './inbound.html?module=vendors&v=R08H&t=' + Date.now();
    }

    window.location.replace(target);
  }

  async function showSuccessBrief(session) {
    const role = String(session.user && session.user.role || '').trim().toUpperCase();

    if (window.Swal && typeof window.Swal.fire === 'function') {
      await window.Swal.fire({
        icon: 'success',
        title: 'เข้าสู่ระบบสำเร็จ',
        text: role === 'INBOUND'
          ? 'กำลังเปิดหน้าห้อง Inbound'
          : 'กำลังเปิดระบบ',
        timer: 650,
        showConfirmButton: false,
        allowOutsideClick: false
      });
    }
  }

  function showAlert(icon, title, text) {
    if (window.Swal && typeof window.Swal.fire === 'function') {
      window.Swal.fire({
        icon: icon,
        title: title,
        text: text,
        confirmButtonText: 'ตกลง',
        confirmButtonColor: '#0f3d5e'
      });
      return;
    }

    window.alert(title + '\n' + text);
  }

  function setButtonBusy(isBusy) {
    const button =
      document.getElementById('loginButton') ||
      document.querySelector('button[type="submit"]');

    if (!button) {
      return;
    }

    button.disabled = Boolean(isBusy);
    button.textContent = isBusy ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ';
  }

  function setBoth(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch (error) {}

    try {
      window.localStorage.setItem(key, value);
    } catch (error) {}
  }

  function removeBoth(key) {
    try {
      window.sessionStorage.removeItem(key);
    } catch (error) {}

    try {
      window.localStorage.removeItem(key);
    } catch (error) {}
  }

  function getTokenInfo() {
    const found = [];

    [window.sessionStorage, window.localStorage].forEach(function (storage) {
      const storageName =
        storage === window.sessionStorage
          ? 'sessionStorage'
          : 'localStorage';

      TOKEN_KEYS.forEach(function (key) {
        let value = '';

        try {
          value = storage.getItem(key) || '';
        } catch (error) {
          value = '';
        }

        if (value) {
          found.push({
            storage: storageName,
            key: key,
            length: String(value).length
          });
        }
      });
    });

    return {
      hasToken: found.length > 0,
      found: found
    };
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
})(window, document);
