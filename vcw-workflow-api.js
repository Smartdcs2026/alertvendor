/*
 * vcw-workflow-api.js
 * VCW-R07B Frontend Workflow API Client
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
    'vehicle_status_access_token',
    'vehicle_access_token',
    'access_token'
  ];

  function cleanApiBase(value) {
    return String(value || DEFAULT_API_BASE).trim().replace(/\/+$/, '');
  }

  function getConfiguredApiBase() {
    const config = window.APP_CONFIG || {};
    return cleanApiBase(config.API_BASE || DEFAULT_API_BASE);
  }

  function getAccessTokenInfo() {
    const found = [];
    let token = '';
    let source = '';

    TOKEN_KEYS.forEach(function (key) {
      let value = '';

      try {
        value = String(window.sessionStorage.getItem(key) || '').trim();
      } catch (error) {
        value = '';
      }

      if (value) {
        found.push({
          storage: 'sessionStorage',
          key: key,
          length: value.length
        });

        if (!token) {
          token = value;
          source = 'sessionStorage:' + key;
        }
      }

      try {
        value = String(window.localStorage.getItem(key) || '').trim();
      } catch (error) {
        value = '';
      }

      if (value) {
        found.push({
          storage: 'localStorage',
          key: key,
          length: value.length
        });

        if (!token) {
          token = value;
          source = 'localStorage:' + key;
        }
      }
    });

    return {
      token: token,
      source: source,
      found: found,
      hasToken: Boolean(token)
    };
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
        details: data && data.error && data.error.details ? data.error.details : {},
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
      found: info.found
    };
  }

  function cleanEntryCode(value) {
    return String(value || '').trim().slice(0, 200);
  }

  function cleanModuleId(value) {
    return String(value || '').trim().slice(0, 80) || 'vendors';
  }

  const api = {
    version: 'VCW-R07B',
    defaultApiBase: DEFAULT_API_BASE,
    tokenKeys: TOKEN_KEYS.slice(),
    getAccessTokenInfo: safeTokenInfo,

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
    }
  };

  window.VCWWorkflowAPI = api;
})(window);
