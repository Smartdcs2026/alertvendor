
/*
 * vcw-session-compat.js
 * VCW-R14P
 * Sync token ให้ api.js เดิมอ่านเจอจาก sessionStorage: alertvendor_access_token
 * ไม่ดัก Login เอง และไม่แทน auth.js เดิม
 */
(function (window) {
  'use strict';

  const BUILD = 'VCW-R14P';
  const PRIMARY_KEY = 'alertvendor_access_token';

  const TOKEN_KEYS = [
    'alertvendor_access_token',
    'access_token',
    'accessToken',
    'token',
    'sessionToken',
    'authToken',
    'alertvendor_token',
    'alertvendorAccessToken',
    'alertvendor_auth_token',
    'alertvendor_session_token',
    'vehicle_status_access_token',
    'vehicle_access_token',
    'vehicleStatusAccessToken',
    'vehicle_status_token'
  ];

  const TOKEN_FIELDS = [
    'accessToken',
    'access_token',
    'token',
    'sessionToken',
    'authToken',
    'jwt',
    'idToken',
    'bearer',
    'bearerToken'
  ];

  init();

  function init() {
    const params = new URLSearchParams(window.location.search || '');

    if (
      params.get('logout') === '1' ||
      params.get('forceLogout') === '1' ||
      params.get('signedOut') === '1'
    ) {
      clearAll('logout-query');
      exposeApi();
      return;
    }

    repairSessionStorage('startup');
    hookFetchLoginResponse();
    exposeApi();
  }

  function exposeApi() {
    window.VCWSessionCompat = {
      version: BUILD,
      repair: repairSessionStorage,
      clear: clearAll,
      getTokenInfo: getTokenInfo
    };
  }

  function repairSessionStorage(source) {
    const current = safeGet(window.sessionStorage, PRIMARY_KEY);

    if (isTokenLike(current)) {
      persist(current, source || 'session-primary');
      return true;
    }

    const token = findBestToken();

    if (token) {
      persist(token, source || 'repair');
      return true;
    }

    return false;
  }

  function hookFetchLoginResponse() {
    if (!window.fetch || window.fetch.__vcwR14pPatched) {
      return;
    }

    const originalFetch = window.fetch;

    window.fetch = async function () {
      const response = await originalFetch.apply(this, arguments);

      try {
        const urlText = String(arguments[0] && arguments[0].url ? arguments[0].url : arguments[0] || '').toLowerCase();

        if (urlText.indexOf('/api/auth/login') !== -1 || urlText.indexOf('/api/login') !== -1) {
          response.clone().json().then(function (payload) {
            const token = extractTokenStrict(payload);

            if (token) {
              persist(token, 'fetch-login-response');
            }
          }).catch(function () {});
        }
      } catch (error) {}

      return response;
    };

    window.fetch.__vcwR14pPatched = true;
  }

  function findBestToken() {
    for (let s = 0; s < 2; s += 1) {
      const storage = s === 0 ? window.sessionStorage : window.localStorage;

      for (let i = 0; i < TOKEN_KEYS.length; i += 1) {
        const value = safeGet(storage, TOKEN_KEYS[i]);

        if (isTokenLike(value)) {
          return normalize(value);
        }
      }
    }

    for (let s = 0; s < 2; s += 1) {
      const storage = s === 0 ? window.sessionStorage : window.localStorage;
      const length = safeLength(storage);

      for (let i = 0; i < length; i += 1) {
        const key = safeKey(storage, i);
        const lower = String(key || '').toLowerCase();

        if (
          lower.indexOf('alertvendor') === -1 &&
          lower.indexOf('session') === -1 &&
          lower.indexOf('auth') === -1 &&
          lower.indexOf('token') === -1
        ) {
          continue;
        }

        const raw = safeGet(storage, key);
        const token = extractTokenStrict(raw);

        if (token) {
          return normalize(token);
        }
      }
    }

    return '';
  }

  function persist(token, source) {
    const clean = normalize(token);

    if (!isTokenLike(clean)) {
      return false;
    }

    safeSet(window.sessionStorage, PRIMARY_KEY, clean);
    safeSet(window.localStorage, PRIMARY_KEY, clean);
    safeSet(window.sessionStorage, 'access_token', clean);
    safeSet(window.localStorage, 'access_token', clean);
    safeSet(window.sessionStorage, 'token', clean);
    safeSet(window.localStorage, 'token', clean);
    safeSet(window.localStorage, 'alertvendor_last_token_source', source || BUILD);
    safeSet(window.localStorage, 'alertvendor_last_token_saved_at', new Date().toISOString());

    return true;
  }

  function clearAll(reason) {
    const hints = [
      'alertvendor',
      'access_token',
      'accesstoken',
      'authtoken',
      'sessiontoken',
      'vehicle_status_access_token',
      'vehicle_access_token'
    ];

    [window.sessionStorage, window.localStorage].forEach(function (storage) {
      TOKEN_KEYS.forEach(function (key) {
        safeRemove(storage, key);
      });

      const keys = [];
      const length = safeLength(storage);

      for (let i = 0; i < length; i += 1) {
        keys.push(safeKey(storage, i));
      }

      keys.forEach(function (key) {
        const lower = String(key || '').toLowerCase();

        if (hints.some(function (hint) { return lower.indexOf(hint) !== -1; })) {
          safeRemove(storage, key);
        }
      });
    });

    safeSet(window.localStorage, 'alertvendor_last_logout_reason', reason || '');
    safeSet(window.localStorage, 'alertvendor_last_logout_at', new Date().toISOString());
  }

  function extractTokenStrict(value) {
    if (value === undefined || value === null) {
      return '';
    }

    let object = value;

    if (typeof value === 'string') {
      try {
        object = JSON.parse(value);
      } catch (error) {
        return '';
      }
    }

    if (!object || typeof object !== 'object') {
      return '';
    }

    const found = [];

    walk(object, 0);

    return found[0] || '';

    function walk(item, depth) {
      if (depth > 5 || item === undefined || item === null) {
        return;
      }

      if (Array.isArray(item)) {
        item.slice(0, 5).forEach(function (child) {
          walk(child, depth + 1);
        });
        return;
      }

      if (typeof item !== 'object') {
        return;
      }

      Object.keys(item).forEach(function (key) {
        const valueAtKey = item[key];

        if (
          TOKEN_FIELDS.indexOf(key) !== -1 &&
          typeof valueAtKey === 'string' &&
          isTokenLike(valueAtKey)
        ) {
          found.push(valueAtKey);
          return;
        }

        walk(valueAtKey, depth + 1);
      });
    }
  }

  function getTokenInfo() {
    const found = [];

    [window.sessionStorage, window.localStorage].forEach(function (storage) {
      const storageName = storage === window.sessionStorage ? 'sessionStorage' : 'localStorage';

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
    });

    return {
      version: BUILD,
      hasPrimarySessionToken: isTokenLike(safeGet(window.sessionStorage, PRIMARY_KEY)),
      found: found
    };
  }

  function normalize(value) {
    return String(value || '').replace(/^Bearer\s+/i, '').trim();
  }

  function isTokenLike(value) {
    const token = normalize(value);

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

  function safeRemove(storage, key) {
    try {
      storage.removeItem(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  function safeLength(storage) {
    try {
      return storage.length || 0;
    } catch (error) {
      return 0;
    }
  }

  function safeKey(storage, index) {
    try {
      return storage.key(index);
    } catch (error) {
      return '';
    }
  }
})(window);
