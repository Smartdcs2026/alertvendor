/*
 * vcw-workflow-api.js
 * VCW-R14E Frontend Workflow API Client
 *
 * ใช้กับ GitHub Pages เพื่อเรียก Cloudflare Worker:
 * - /api/health
 * - /api/auth/me
 * - /api/workflow/modules/:moduleId/lookup
 * - /api/workflow/modules/:moduleId/state/:entryCode
 * - /api/workflow/modules/:moduleId/submit-document
 * - /api/workflow/modules/:moduleId/complete-receiving
 * - /api/workflow/modules/:moduleId/return-document
 * - /api/workflow/modules/:moduleId/cancel-event
 */
(function (window) {
  'use strict';

  const DEFAULT_API_BASE = 'https://alertvendor.somchaibutphon.workers.dev';

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

  function cleanApiBase(value) {
    return String(value || DEFAULT_API_BASE).trim().replace(/\/+$/, '');
  }


  function cleanModuleId(value) {
    const text = String(value || 'vendors').trim();

    return text || 'vendors';
  }

  function cleanEntryCode(value) {
    return String(value || '').trim();
  }

  function getConfiguredApiBase() {
    const config = window.APP_CONFIG || {};
    return cleanApiBase(config.API_BASE || DEFAULT_API_BASE);
  }

  function getAccessTokenInfo() {
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

      if (token && isTokenLike(token)) {
        candidates.push({
          token: token,
          source: storageName + ':' + key,
          reason: reason || '',
          priority: priority || 50,
          length: token.length
        });
      }
    }

    storages.forEach(function (box) {
      TOKEN_KEYS.forEach(function (key, index) {
        let value = '';

        try {
          value = box.storage.getItem(key);
        } catch (error) {
          value = '';
        }

        if (value) {
          addCandidate(box.name, key, value, 'exact-key', 1000 - index);
        }
      });
    });

    storages.forEach(function (box) {
      let length = 0;

      try {
        length = box.storage.length || 0;
      } catch (error) {
        length = 0;
      }

      for (let i = 0; i < length; i += 1) {
        let key = '';

        try {
          key = box.storage.key(i);
        } catch (error) {
          key = '';
        }

        if (!key || TOKEN_KEYS.indexOf(key) !== -1) {
          continue;
        }

        const lowerKey = String(key).toLowerCase();

        if (
          lowerKey.indexOf('token') === -1 &&
          lowerKey.indexOf('auth') === -1 &&
          lowerKey.indexOf('session') === -1 &&
          lowerKey.indexOf('user') === -1 &&
          lowerKey.indexOf('alertvendor') === -1
        ) {
          continue;
        }

        let raw = '';

        try {
          raw = box.storage.getItem(key);
        } catch (error) {
          raw = '';
        }

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
      hasToken: Boolean(best && best.token),
      candidateCount: candidates.length
    };
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

  function extractTokensFromValue(raw) {
    const results = [];
    const text = String(raw || '').trim();

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

    let object = null;

    try {
      object = JSON.parse(text);
    } catch (error) {
      object = null;
    }

    if (!object || typeof object !== 'object') {
      return results;
    }

    const tokenKeys = [
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

    const tokenKeyMap = {};
    tokenKeys.forEach(function (key) {
      tokenKeyMap[key.toLowerCase()] = true;
    });

    function walk(value, path, depth) {
      if (depth > 5 || value === undefined || value === null) {
        return;
      }

      if (typeof value === 'string') {
        const keyName = String(path.split('.').pop() || '').toLowerCase();

        if (
          tokenKeyMap[keyName] === true ||
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
          walk(item, path + '[' + index + ']', depth + 1);
        });
        return;
      }

      if (typeof value === 'object') {
        Object.keys(value).forEach(function (key) {
          walk(value[key], path ? path + '.' + key : key, depth + 1);
        });
      }
    }

    walk(object, '', 0);

    return results;
  }

  function buildHeaders(options) {
    const headers = new Headers();
    headers.set('Accept', 'application/json');

    if (options && options.json) {
      headers.set('Content-Type', 'application/json; charset=UTF-8');
    }

    if (options && options.auth !== false) {
      const tokenInfo = getAccessTokenInfo();
      if (tokenInfo.token) {
        headers.set('Authorization', 'Bearer ' + tokenInfo.token);
      }
    }

    return headers;
  }

  function buildUrl(path, query, apiBase) {
    const url = new URL(cleanApiBase(apiBase || getConfiguredApiBase()) + path);

    Object.keys(query || {}).forEach(function (key) {
      const value = query[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        url.searchParams.set(key, String(value));
      }
    });

    return url.toString();
  }

  async function request(path, options) {
    const opts = options || {};
    const method = String(opts.method || 'GET').toUpperCase();
    const url = buildUrl(path, opts.query || {}, opts.apiBase);
    const startedAt = Date.now();

    const fetchOptions = {
      method: method,
      headers: buildHeaders({
        auth: opts.auth,
        json: opts.body !== undefined
      }),
      cache: 'no-store',
      mode: 'cors',
      credentials: 'omit'
    };

    if (opts.body !== undefined) {
      fetchOptions.body = JSON.stringify(opts.body || {});
    }

    let response;
    let text;
    let data;

    try {
      response = await fetch(url, fetchOptions);
      text = await response.text();
    } catch (error) {
      return {
        success: false,
        code: 'NETWORK_ERROR',
        message: 'ไม่สามารถเชื่อมต่อ API ได้',
        status: 0,
        details: {
          url: url,
          method: method,
          withAuthorization: fetchOptions.headers.has('Authorization'),
          tokenInfo: safeTokenInfo(),
          originalMessage: error && error.message ? error.message : String(error),
          hint: 'ถ้า Health แบบไม่ใช้ Token ผ่าน แต่ Auth/Lookup ไม่ผ่าน มักเกิดจาก CORS preflight หรือ ALLOWED_ORIGINS/Authorization header'
        },
        durationMs: Date.now() - startedAt
      };
    }

    try {
      data = text ? JSON.parse(text) : null;
    } catch (error) {
      return {
        success: false,
        code: 'INVALID_JSON_RESPONSE',
        message: 'API ตอบกลับมาไม่ใช่ JSON',
        status: response.status,
        details: {
          url: url,
          preview: String(text || '').slice(0, 500)
        },
        durationMs: Date.now() - startedAt
      };
    }

    if (!response.ok || !data || data.success === false) {
      return {
        success: false,
        code: data && data.error && data.error.code ? data.error.code : 'HTTP_' + response.status,
        message: data && data.error && data.error.message ? data.error.message : 'API ตอบกลับผิดพลาด',
        status: response.status,
        details: Object.assign({}, data && data.error && data.error.details ? data.error.details : {}, {
          tokenInfo: safeTokenInfo(),
          withAuthorization: fetchOptions.headers.has('Authorization')
        }),
        requestId: data && data.requestId ? data.requestId : '',
        serverTime: data && data.serverTime ? data.serverTime : '',
        raw: data,
        durationMs: Date.now() - startedAt
      };
    }

    return {
      success: true,
      status: response.status,
      data: data.data,
      requestId: data.requestId || '',
      serverTime: data.serverTime || '',
      raw: data,
      durationMs: Date.now() - startedAt
    };
  }

  function safeTokenInfo() {
    const info = getAccessTokenInfo();

    return {
      hasToken: info.hasToken,
      source: info.source,
      reason: info.reason,
      found: info.found,
      candidateCount: info.candidateCount
    };
  }

  const api = {
    version: 'VCW-R14E-ClientHelperFix',
    defaultApiBase: DEFAULT_API_BASE,
    tokenKeys: TOKEN_KEYS.slice(),
    getAccessTokenInfo: safeTokenInfo,
    getTokenInfo: safeTokenInfo,
    diagnoseAuth: function () {
      return safeTokenInfo();
    },

    health: function (apiBase) {
      return request('/api/health', {
        apiBase: apiBase,
        auth: false
      });
    },

    me: function (apiBase) {
      return request('/api/auth/me', {
        apiBase: apiBase,
        auth: true
      });
    },

    lookupEntry: function (moduleId, entryCode, apiBase) {
      return request('/api/workflow/modules/' + encodeURIComponent(cleanModuleId(moduleId)) + '/lookup', {
        apiBase: apiBase,
        auth: true,
        query: {
          entryCode: cleanEntryCode(entryCode)
        }
      });
    },

    lookup: function (moduleId, entryCode, apiBase) {
      return request('/api/workflow/modules/' + encodeURIComponent(cleanModuleId(moduleId)) + '/lookup', {
        apiBase: apiBase,
        auth: true,
        query: {
          entryCode: cleanEntryCode(entryCode)
        }
      });
    },

    state: function (moduleId, entryCode, apiBase) {
      return request('/api/workflow/modules/' + encodeURIComponent(cleanModuleId(moduleId)) + '/state/' + encodeURIComponent(cleanEntryCode(entryCode)), {
        apiBase: apiBase,
        auth: true
      });
    },

    submitDocument: function (moduleId, payload, apiBase) {
      return request('/api/workflow/modules/' + encodeURIComponent(cleanModuleId(moduleId)) + '/submit-document', {
        apiBase: apiBase,
        method: 'POST',
        auth: true,
        body: payload || {}
      });
    },

    completeReceiving: function (moduleId, payload, apiBase) {
      return request('/api/workflow/modules/' + encodeURIComponent(cleanModuleId(moduleId)) + '/complete-receiving', {
        apiBase: apiBase,
        method: 'POST',
        auth: true,
        body: payload || {}
      });
    },

    returnDocument: function (moduleId, payload, apiBase) {
      return request('/api/workflow/modules/' + encodeURIComponent(cleanModuleId(moduleId)) + '/return-document', {
        apiBase: apiBase,
        method: 'POST',
        auth: true,
        body: payload || {}
      });
    },

    cancelEvent: function (moduleId, payload, apiBase) {
      return request('/api/workflow/modules/' + encodeURIComponent(cleanModuleId(moduleId)) + '/cancel-event', {
        apiBase: apiBase,
        method: 'POST',
        auth: true,
        body: payload || {}
      });
    },

    syncGateOut: function (moduleId, payload, apiBase) {
      return request('/api/workflow/modules/' + encodeURIComponent(cleanModuleId(moduleId)) + '/sync-gate-out', {
        apiBase: apiBase,
        method: 'POST',
        auth: true,
        body: payload || {}
      });
    },

    previewGateOutBatch: function (moduleId, options, apiBase) {
      const opts = options || {};
      return request('/api/workflow/modules/' + encodeURIComponent(cleanModuleId(moduleId)) + '/gate-out-sync/preview', {
        apiBase: apiBase,
        auth: true,
        query: {
          limit: opts.limit || 30
        }
      });
    },

    runGateOutBatch: function (moduleId, options, apiBase) {
      const opts = options || {};
      return request('/api/workflow/modules/' + encodeURIComponent(cleanModuleId(moduleId)) + '/gate-out-sync/run', {
        apiBase: apiBase,
        method: 'POST',
        auth: true,
        body: {
          limit: opts.limit || 30
        }
      });
    },

    autoGateOutStatus: function (moduleId, apiBase) {
      return request('/api/workflow/modules/' + encodeURIComponent(cleanModuleId(moduleId)) + '/gate-out-sync/auto/status', {
        apiBase: apiBase,
        auth: true
      });
    },

    enableAutoGateOut: function (moduleId, options, apiBase) {
      const opts = options || {};
      return request('/api/workflow/modules/' + encodeURIComponent(cleanModuleId(moduleId)) + '/gate-out-sync/auto/enable', {
        apiBase: apiBase,
        method: 'POST',
        auth: true,
        body: {
          limit: opts.limit || 30,
          intervalMinutes: opts.intervalMinutes || 10
        }
      });
    },

    disableAutoGateOut: function (moduleId, apiBase) {
      return request('/api/workflow/modules/' + encodeURIComponent(cleanModuleId(moduleId)) + '/gate-out-sync/auto/disable', {
        apiBase: apiBase,
        method: 'POST',
        auth: true,
        body: {}
      });
    },

    runAutoGateOutNow: function (moduleId, options, apiBase) {
      const opts = options || {};
      return request('/api/workflow/modules/' + encodeURIComponent(cleanModuleId(moduleId)) + '/gate-out-sync/auto/run-now', {
        apiBase: apiBase,
        method: 'POST',
        auth: true,
        body: {
          limit: opts.limit || 30
        }
      });
    },

    workflowReport: function (moduleId, options, apiBase) {
      const opts = options || {};
      return request('/api/workflow/modules/' + encodeURIComponent(cleanModuleId(moduleId)) + '/report', {
        apiBase: apiBase,
        auth: true,
        query: {
          date: opts.date || opts.reportDate || '',
          limit: opts.limit || 500
        }
      });
    },

    workflowAudit: function (moduleId, options, apiBase) {
      const opts = options || {};
      return request('/api/workflow/modules/' + encodeURIComponent(cleanModuleId(moduleId)) + '/audit', {
        apiBase: apiBase,
        auth: true,
        query: {
          date: opts.date || opts.reportDate || '',
          limit: opts.limit || 300
        }
      });
    },

    exportWorkflowCsv: function (moduleId, options, apiBase) {
      const opts = options || {};
      return request('/api/workflow/modules/' + encodeURIComponent(cleanModuleId(moduleId)) + '/export/csv', {
        apiBase: apiBase,
        method: 'POST',
        auth: true,
        body: {
          date: opts.date || opts.reportDate || '',
          limit: opts.limit || 500
        }
      });
    },

    slaAlerts: function (moduleId, options, apiBase) {
      const opts = options || {};
      return request('/api/workflow/modules/' + encodeURIComponent(cleanModuleId(moduleId)) + '/sla-alerts', {
        apiBase: apiBase,
        auth: true,
        query: { limit: opts.limit || 50 }
      });
    },

    setupDefaultSlaRules: function (moduleId, apiBase) {
      return request('/api/workflow/modules/' + encodeURIComponent(cleanModuleId(moduleId)) + '/sla-alerts/setup-default', {
        apiBase: apiBase,
        method: 'POST',
        auth: true,
        body: {}
      });
    },

    workflowDashboard: function (moduleId, options, apiBase) {
      const opts = options || {};
      return request('/api/workflow/modules/' + encodeURIComponent(cleanModuleId(moduleId)) + '/dashboard', {
        apiBase: apiBase,
        auth: true,
        query: {
          limit: opts.limit || 30
        }
      });
    }
  };

  window.VCWWorkflowAPI = api;
  window.VCWWorkflowApi = api;

  window.dispatchEvent(
    new CustomEvent('vcw-workflow-api-ready', {
      detail: api
    })
  );

  window.dispatchEvent(
    new CustomEvent('VCWWorkflowAPIReady', {
      detail: api
    })
  );
})(window);
