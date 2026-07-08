/*
 * vcw-auth-persistence-hotfix.js
 * VCW-R14G
 *
 * จุดประสงค์:
 * - แก้ปัญหา AUTH_REQUIRED เพราะหน้า Workflow หา token ไม่เจอ
 * - คัดลอก token ไปเก็บทั้ง sessionStorage และ localStorage
 * - ดัก token จากผล Login response ถ้า login.js/auth.js เรียก fetch()
 * - ไม่ยุ่งกับรหัสผ่าน
 */
(function (window) {
  'use strict';

  const BUILD = 'VCW-R14G';
  const PRIMARY_KEY = 'alertvendor_access_token';

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

  const JSON_TOKEN_KEYS = [
    'token',
    'accessToken',
    'access_token',
    'authToken',
    'sessionToken',
    'jwt',
    'idToken',
    'bearer',
    'bearerToken'
  ];

  let isWriting = false;

  function init() {
    repairFromExistingStorage();
    hookStorageSetItem();
    hookFetchLoginResponse();

    window.VCWAuthPersistence = {
      version: BUILD,
      repair: repairFromExistingStorage,
      getTokenInfo: getTokenInfo,
      persistToken: persistToken,
      clearToken: clearToken
    };

    window.dispatchEvent(
      new CustomEvent('vcw-auth-persistence-ready', {
        detail: {
          version: BUILD,
          tokenInfo: safePublicTokenInfo()
        }
      })
    );
  }

  function repairFromExistingStorage() {
    const info = findBestToken();

    if (info && info.token) {
      persistToken(info.token, 'repair:' + info.source);
      return true;
    }

    return false;
  }

  function hookStorageSetItem() {
    if (!window.Storage || !window.Storage.prototype) {
      return;
    }

    if (window.Storage.prototype.__vcwR14gPatched) {
      return;
    }

    const originalSetItem = window.Storage.prototype.setItem;

    window.Storage.prototype.setItem = function (key, value) {
      const result = originalSetItem.apply(this, arguments);

      if (!isWriting) {
        tryCaptureTokenFromKeyValue(key, value, 'storage.setItem');
      }

      return result;
    };

    window.Storage.prototype.__vcwR14gPatched = true;
  }

  function hookFetchLoginResponse() {
    if (!window.fetch || window.fetch.__vcwR14gPatched) {
      return;
    }

    const originalFetch = window.fetch;

    window.fetch = async function () {
      const response = await originalFetch.apply(this, arguments);

      try {
        const urlText = String(arguments[0] && arguments[0].url ? arguments[0].url : arguments[0] || '');

        if (isLikelyAuthUrl(urlText)) {
          response.clone().json().then(function (data) {
            const tokens = extractTokensFromValue(data);

            if (tokens.length) {
              persistToken(tokens[0].value, 'fetch:' + urlText);
            }
          }).catch(function () {});
        }
      } catch (error) {}

      return response;
    };

    window.fetch.__vcwR14gPatched = true;
  }

  function isLikelyAuthUrl(urlText) {
    const text = String(urlText || '').toLowerCase();

    return (
      text.indexOf('/api/auth/login') !== -1 ||
      text.indexOf('/api/login') !== -1 ||
      text.indexOf('auth') !== -1 && text.indexOf('login') !== -1
    );
  }

  function tryCaptureTokenFromKeyValue(key, value, source) {
    const keyText = String(key || '').toLowerCase();

    if (
      keyText.indexOf('token') === -1 &&
      keyText.indexOf('auth') === -1 &&
      keyText.indexOf('session') === -1 &&
      keyText.indexOf('alertvendor') === -1 &&
      keyText.indexOf('user') === -1
    ) {
      return false;
    }

    const tokens = extractTokensFromValue(value);

    if (tokens.length) {
      persistToken(tokens[0].value, source + ':' + key);
      return true;
    }

    const normalized = normalizeTokenValue(value);

    if (isTokenLike(normalized)) {
      persistToken(normalized, source + ':' + key);
      return true;
    }

    return false;
  }

  function persistToken(token, source) {
    const normalized = normalizeTokenValue(token);

    if (!isTokenLike(normalized)) {
      return false;
    }

    isWriting = true;

    try {
      trySet(window.sessionStorage, PRIMARY_KEY, normalized);
      trySet(window.localStorage, PRIMARY_KEY, normalized);

      // เขียน key สำรองที่ client รุ่นเก่า/ใหม่อาจเรียกใช้
      trySet(window.sessionStorage, 'access_token', normalized);
      trySet(window.localStorage, 'access_token', normalized);

      trySet(window.sessionStorage, 'token', normalized);
      trySet(window.localStorage, 'token', normalized);

      trySet(window.localStorage, 'alertvendor_last_token_source', source || '');
      trySet(window.localStorage, 'alertvendor_last_token_saved_at', new Date().toISOString());

      window.dispatchEvent(
        new CustomEvent('vcw-auth-token-persisted', {
          detail: {
            source: source || '',
            length: normalized.length
          }
        })
      );

      return true;

    } finally {
      isWriting = false;
    }
  }

  function clearToken() {
    TOKEN_KEYS.forEach(function (key) {
      tryRemove(window.sessionStorage, key);
      tryRemove(window.localStorage, key);
    });

    tryRemove(window.localStorage, 'alertvendor_last_token_source');
    tryRemove(window.localStorage, 'alertvendor_last_token_saved_at');

    return true;
  }

  function getTokenInfo() {
    const info = findBestToken();

    return {
      hasToken: Boolean(info && info.token),
      source: info && info.source ? info.source : '',
      reason: info && info.reason ? info.reason : '',
      found: info && info.found ? info.found : [],
      candidateCount: info && info.candidateCount ? info.candidateCount : 0,
      lastSavedAt: tryGet(window.localStorage, 'alertvendor_last_token_saved_at') || '',
      lastSource: tryGet(window.localStorage, 'alertvendor_last_token_source') || ''
    };
  }

  function safePublicTokenInfo() {
    return getTokenInfo();
  }

  function findBestToken() {
    const found = [];
    const candidates = [];
    const storages = [];

    try {
      storages.push({
        name: 'sessionStorage',
        storage: window.sessionStorage
      });
    } catch (error) {}

    try {
      storages.push({
        name: 'localStorage',
        storage: window.localStorage
      });
    } catch (error) {}

    function addCandidate(storageName, key, value, reason, priority) {
      const token = normalizeTokenValue(value);

      found.push({
        storage: storageName,
        key: key,
        length: token ? token.length : String(value || '').length,
        reason: reason || ''
      });

      if (isTokenLike(token)) {
        candidates.push({
          token: token,
          source: storageName + ':' + key,
          reason: reason || '',
          priority: priority || 50,
          length: token.length
        });
      }
    }

    // exact keys
    storages.forEach(function (box) {
      TOKEN_KEYS.forEach(function (key, index) {
        const value = tryGet(box.storage, key);

        if (value) {
          addCandidate(box.name, key, value, 'exact-key', 1000 - index);
        }
      });
    });

    // deep scan
    storages.forEach(function (box) {
      const length = getStorageLength(box.storage);

      for (let i = 0; i < length; i += 1) {
        const key = tryKey(box.storage, i);

        if (!key || TOKEN_KEYS.indexOf(key) !== -1) {
          continue;
        }

        const lowerKey = String(key).toLowerCase();

        if (
          lowerKey.indexOf('token') === -1 &&
          lowerKey.indexOf('auth') === -1 &&
          lowerKey.indexOf('session') === -1 &&
          lowerKey.indexOf('alertvendor') === -1 &&
          lowerKey.indexOf('user') === -1
        ) {
          continue;
        }

        const raw = tryGet(box.storage, key);

        if (!raw) {
          continue;
        }

        const extracted = extractTokensFromValue(raw);

        if (extracted.length) {
          extracted.forEach(function (item, itemIndex) {
            addCandidate(
              box.name,
              key,
              item.value,
              'deep-scan:' + item.path,
              650 - itemIndex
            );
          });
        } else {
          addCandidate(box.name, key, raw, 'deep-scan-raw', 250);
        }
      }
    });

    candidates.sort(function (a, b) {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }

      return b.length - a.length;
    });

    const best = candidates[0] || null;

    return {
      token: best ? best.token : '',
      source: best ? best.source : '',
      reason: best ? best.reason : '',
      found: found,
      candidateCount: candidates.length
    };
  }

  function extractTokensFromValue(value) {
    const results = [];

    if (value === undefined || value === null) {
      return results;
    }

    if (typeof value === 'string') {
      const text = value.trim();

      if (!text) {
        return results;
      }

      if (isTokenLike(text)) {
        results.push({
          path: 'raw',
          value: text
        });
        return results;
      }

      let parsed = null;

      try {
        parsed = JSON.parse(text);
      } catch (error) {
        parsed = null;
      }

      if (parsed) {
        walkForToken(parsed, '', 0, results);
      }

      return results;
    }

    if (typeof value === 'object') {
      walkForToken(value, '', 0, results);
    }

    return results;
  }

  function walkForToken(value, path, depth, results) {
    if (depth > 5 || value === undefined || value === null) {
      return;
    }

    if (typeof value === 'string') {
      const keyName = String(path.split('.').pop() || '').toLowerCase();

      if (
        JSON_TOKEN_KEYS.map(function (k) { return k.toLowerCase(); }).indexOf(keyName) !== -1 ||
        isTokenLike(value)
      ) {
        if (isTokenLike(value)) {
          results.push({
            path: path || 'string',
            value: value
          });
        }
      }

      return;
    }

    if (Array.isArray(value)) {
      value.slice(0, 5).forEach(function (item, index) {
        walkForToken(item, path + '[' + index + ']', depth + 1, results);
      });
      return;
    }

    if (typeof value === 'object') {
      Object.keys(value).forEach(function (key) {
        walkForToken(value[key], path ? path + '.' + key : key, depth + 1, results);
      });
    }
  }

  function normalizeTokenValue(value) {
    if (value === undefined || value === null) {
      return '';
    }

    let text = String(value).trim();

    if (!text) {
      return '';
    }

    text = text.replace(/^Bearer\s+/i, '').trim();

    if (
      (text.charAt(0) === '"' && text.charAt(text.length - 1) === '"') ||
      (text.charAt(0) === "'" && text.charAt(text.length - 1) === "'")
    ) {
      text = text.slice(1, -1).trim();
    }

    return text;
  }

  function isTokenLike(value) {
    const token = normalizeTokenValue(value);

    if (!token) {
      return false;
    }

    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
      return true;
    }

    if (
      token.length >= 20 &&
      /^[A-Za-z0-9._~+/=-]+$/.test(token)
    ) {
      return true;
    }

    return false;
  }

  function tryGet(storage, key) {
    try {
      return storage.getItem(key);
    } catch (error) {
      return '';
    }
  }

  function trySet(storage, key, value) {
    try {
      storage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function tryRemove(storage, key) {
    try {
      storage.removeItem(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  function getStorageLength(storage) {
    try {
      return storage.length || 0;
    } catch (error) {
      return 0;
    }
  }

  function tryKey(storage, index) {
    try {
      return storage.key(index);
    } catch (error) {
      return '';
    }
  }

  init();
})(window);
