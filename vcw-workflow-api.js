'use strict';

/************************************************************
 * VCW-R07
 * Frontend Workflow API Client
 *
 * ใช้สำหรับหน้า GitHub Pages เรียก Cloudflare Worker Route:
 * - GET  /api/workflow/modules/:moduleId/lookup?entryCode=...
 * - GET  /api/workflow/modules/:moduleId/state/:entryCode
 * - POST /api/workflow/modules/:moduleId/submit-document
 * - POST /api/workflow/modules/:moduleId/complete-receiving
 * - POST /api/workflow/modules/:moduleId/return-document
 * - POST /api/workflow/modules/:moduleId/cancel-event
 *
 * หมายเหตุ:
 * - ไฟล์นี้เป็น Client กลาง ไม่เขียนข้อมูลเอง
 * - การบันทึกจริงอยู่ที่ Worker + Apps Script
 * - รองรับ Authorization: Bearer token จาก sessionStorage/localStorage
 ************************************************************/

(function attachVCWWorkflowApi(window) {
  const DEFAULT_API_BASE =
    'https://alertvendor.somchaibutphon.workers.dev';

  const DEFAULT_TIMEOUT_MS =
    60000;

  const DEFAULT_MODULE_ID =
    'vendors';

  const ROUTE_STYLE_PRIMARY =
    'workflow';

  const ROUTE_STYLE_FALLBACK =
    'module';

  const TOKEN_KEYS = [
    'alertvendor_access_token',
    'alertvendor_token',
    'alertvendorAccessToken',
    'vehicle_status_access_token',
    'vehicleStatusAccessToken',
    'access_token',
    'accessToken',
    'authToken',
    'token',
    'sessionToken',
    'vehicle_status_token'
  ];

  const SESSION_KEYS = [
    'alertvendor_session',
    'alertvendor_user',
    'vehicle_status_session',
    'vehicleStatusSession',
    'authSession',
    'session',
    'currentUser',
    'user'
  ];

  let runtimeConfig = {
    apiBase:
      resolveApiBase(),

    timeoutMs:
      DEFAULT_TIMEOUT_MS,

    routeStyle:
      ROUTE_STYLE_PRIMARY,

    fallbackRouteStyle:
      ROUTE_STYLE_FALLBACK,

    defaultModuleId:
      DEFAULT_MODULE_ID
  };

  class VCWApiError extends Error {
    constructor(message, options) {
      super(message || 'เกิดข้อผิดพลาดในการเรียก Workflow API');
      this.name = 'VCWApiError';
      this.code = options && options.code
        ? String(options.code)
        : 'VCW_API_ERROR';
      this.status = options && Number.isFinite(Number(options.status))
        ? Number(options.status)
        : 0;
      this.requestId = options && options.requestId
        ? String(options.requestId)
        : '';
      this.serverTime = options && options.serverTime
        ? String(options.serverTime)
        : '';
      this.details = options && options.details
        ? options.details
        : {};
      this.raw = options && options.raw
        ? options.raw
        : null;
    }
  }

  function configure(options) {
    const source =
      options && typeof options === 'object'
        ? options
        : {};

    runtimeConfig = {
      ...runtimeConfig,
      ...source
    };

    runtimeConfig.apiBase =
      normalizeApiBase(
        source.apiBase || runtimeConfig.apiBase || resolveApiBase()
      );

    runtimeConfig.timeoutMs =
      normalizeTimeout(
        source.timeoutMs || runtimeConfig.timeoutMs
      );

    runtimeConfig.routeStyle =
      normalizeRouteStyle(
        source.routeStyle || runtimeConfig.routeStyle
      );

    runtimeConfig.fallbackRouteStyle =
      normalizeRouteStyle(
        source.fallbackRouteStyle || runtimeConfig.fallbackRouteStyle
      );

    runtimeConfig.defaultModuleId =
      sanitizeModuleId(
        source.defaultModuleId || runtimeConfig.defaultModuleId || DEFAULT_MODULE_ID
      );

    return getConfig();
  }

  function getConfig() {
    return {
      ...runtimeConfig
    };
  }

  function resolveApiBase() {
    const direct =
      window.VCW_API_BASE ||
      window.API_BASE ||
      window.API_BASE_URL ||
      '';

    if (direct) {
      return normalizeApiBase(direct);
    }

    const configs = [
      window.CONFIG,
      window.APP_CONFIG,
      window.AppConfig,
      window.AlertVendorConfig,
      window.VehicleStatusConfig
    ];

    for (const config of configs) {
      if (!config || typeof config !== 'object') {
        continue;
      }

      const candidate =
        config.API_BASE ||
        config.API_BASE_URL ||
        config.apiBase ||
        config.apiBaseUrl ||
        config.baseUrl ||
        '';

      if (candidate) {
        return normalizeApiBase(candidate);
      }
    }

    return DEFAULT_API_BASE;
  }

  function normalizeApiBase(value) {
    const text =
      String(value || DEFAULT_API_BASE)
        .trim()
        .replace(/\/+$/g, '');

    if (!/^https:\/\//i.test(text)) {
      return DEFAULT_API_BASE;
    }

    return text;
  }

  function normalizeTimeout(value) {
    const number =
      Number(value);

    if (!Number.isFinite(number)) {
      return DEFAULT_TIMEOUT_MS;
    }

    return Math.max(
      5000,
      Math.min(
        180000,
        Math.floor(number)
      )
    );
  }

  function normalizeRouteStyle(value) {
    const text =
      String(value || ROUTE_STYLE_PRIMARY)
        .trim()
        .toLowerCase();

    return text === ROUTE_STYLE_FALLBACK
      ? ROUTE_STYLE_FALLBACK
      : ROUTE_STYLE_PRIMARY;
  }

  function sanitizeModuleId(value) {
    const text =
      String(value || DEFAULT_MODULE_ID)
        .trim();

    if (!/^[\p{L}\p{N}_-]{1,80}$/u.test(text)) {
      throw new VCWApiError('รหัสโมดูลไม่ถูกต้อง', {
        code: 'INVALID_MODULE_ID',
        status: 400,
        details: {
          moduleId: text
        }
      });
    }

    return text;
  }

  function sanitizeEntryCode(value) {
    const text =
      String(value || '')
        .trim();

    if (!text || text.length > 300) {
      throw new VCWApiError('รหัสเข้าพื้นที่ / QR Code ไม่ถูกต้อง', {
        code: 'INVALID_ENTRY_CODE',
        status: 400
      });
    }

    return text;
  }

  function sanitizeReason(value) {
    const text =
      String(value || '')
        .trim();

    if (!text || text.length < 3) {
      throw new VCWApiError('กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร', {
        code: 'REASON_REQUIRED',
        status: 400
      });
    }

    return text.slice(0, 1000);
  }

  function sanitizeOptionalText(value, maxLength) {
    return String(value || '')
      .trim()
      .slice(0, maxLength || 500);
  }

  function getAccessToken() {
    if (
      window.AuthService &&
      typeof window.AuthService.getAccessToken === 'function'
    ) {
      const token =
        String(window.AuthService.getAccessToken() || '').trim();

      if (token) {
        return token;
      }
    }

    if (
      window.Auth &&
      typeof window.Auth.getAccessToken === 'function'
    ) {
      const token =
        String(window.Auth.getAccessToken() || '').trim();

      if (token) {
        return token;
      }
    }

    const directToken =
      findTokenInStorage(TOKEN_KEYS);

    if (directToken) {
      return directToken;
    }

    return findTokenInsideSessionObjects();
  }

  function findTokenInStorage(keys) {
    for (const storage of [window.sessionStorage, window.localStorage]) {
      if (!storage) {
        continue;
      }

      for (const key of keys) {
        try {
          const value =
            String(storage.getItem(key) || '').trim();

          if (value) {
            return value;
          }
        } catch (error) {
          // ignore blocked storage
        }
      }
    }

    return '';
  }

  function findTokenInsideSessionObjects() {
    const possibleTokenKeys = [
      'accessToken',
      'authToken',
      'token',
      'sessionToken'
    ];

    for (const storage of [window.sessionStorage, window.localStorage]) {
      if (!storage) {
        continue;
      }

      for (const key of SESSION_KEYS) {
        try {
          const raw =
            String(storage.getItem(key) || '').trim();

          if (!raw) {
            continue;
          }

          const parsed =
            JSON.parse(raw);

          const token =
            findTokenInObject(parsed, possibleTokenKeys);

          if (token) {
            return token;
          }
        } catch (error) {
          // ignore non-json storage values
        }
      }
    }

    return '';
  }

  function findTokenInObject(value, keys) {
    if (!value || typeof value !== 'object') {
      return '';
    }

    for (const key of keys) {
      const token =
        String(value[key] || '').trim();

      if (token) {
        return token;
      }
    }

    for (const key of Object.keys(value)) {
      const nested =
        value[key];

      if (nested && typeof nested === 'object') {
        const token =
          findTokenInObject(nested, keys);

        if (token) {
          return token;
        }
      }
    }

    return '';
  }

  function isAuthenticated() {
    return Boolean(getAccessToken());
  }

  function createRequestId(prefix) {
    const random =
      Math.random()
        .toString(36)
        .slice(2, 10);

    return [
      prefix || 'vcw-ui',
      Date.now().toString(36),
      random
    ].join('-');
  }

  function buildWorkflowPath(routeStyle, moduleId, action, entryCode) {
    const safeModuleId =
      encodeURIComponent(sanitizeModuleId(moduleId));

    const safeAction =
      String(action || '')
        .trim()
        .replace(/^\/+|\/+$/g, '');

    if (routeStyle === ROUTE_STYLE_FALLBACK) {
      if (entryCode) {
        return `/api/modules/${safeModuleId}/workflow/${safeAction}/${encodeURIComponent(entryCode)}`;
      }

      return `/api/modules/${safeModuleId}/workflow/${safeAction}`;
    }

    if (entryCode) {
      return `/api/workflow/modules/${safeModuleId}/${safeAction}/${encodeURIComponent(entryCode)}`;
    }

    return `/api/workflow/modules/${safeModuleId}/${safeAction}`;
  }

  function appendQuery(path, query) {
    const params =
      new URLSearchParams();

    const source =
      query && typeof query === 'object'
        ? query
        : {};

    Object.keys(source).forEach((key) => {
      const value = source[key];

      if (
        value === undefined ||
        value === null ||
        String(value).trim() === ''
      ) {
        return;
      }

      params.set(key, String(value));
    });

    const text =
      params.toString();

    return text
      ? `${path}?${text}`
      : path;
  }

  async function request(path, options) {
    const settings =
      options && typeof options === 'object'
        ? options
        : {};

    const method =
      String(settings.method || 'GET')
        .trim()
        .toUpperCase();

    const apiBase =
      normalizeApiBase(settings.apiBase || runtimeConfig.apiBase);

    const url =
      /^https?:\/\//i.test(path)
        ? path
        : `${apiBase}${path}`;

    const token =
      settings.accessToken ||
      getAccessToken();

    if (!token && settings.requireAuth !== false) {
      throw new VCWApiError('ไม่พบ Session กรุณาเข้าสู่ระบบก่อน', {
        code: 'AUTH_REQUIRED',
        status: 401
      });
    }

    const headers = {
      Accept: 'application/json',
      'X-Client-Request-Id': settings.requestId || createRequestId('vcw')
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const fetchOptions = {
      method,
      headers,
      credentials: 'include'
    };

    if (method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = 'application/json; charset=UTF-8';
      fetchOptions.body =
        JSON.stringify(
          settings.body || {}
        );
    }

    const timeoutMs =
      normalizeTimeout(settings.timeoutMs || runtimeConfig.timeoutMs);

    let controller = null;
    let timeoutId = null;

    if (typeof AbortController !== 'undefined') {
      controller =
        new AbortController();

      fetchOptions.signal =
        controller.signal;

      timeoutId =
        window.setTimeout(() => {
          controller.abort();
        }, timeoutMs);
    }

    let response;
    let responseText = '';
    let payload = null;

    try {
      response =
        await fetch(url, fetchOptions);

      responseText =
        await response.text();

      try {
        payload =
          responseText
            ? JSON.parse(responseText)
            : null;
      } catch (error) {
        throw new VCWApiError('API ไม่ได้ส่ง JSON ที่ถูกต้องกลับมา', {
          code: 'INVALID_API_RESPONSE',
          status: response.status,
          details: {
            responsePreview:
              responseText.slice(0, 300)
          }
        });
      }
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new VCWApiError('เชื่อมต่อ API นานเกินกำหนด', {
          code: 'REQUEST_TIMEOUT',
          status: 504,
          details: {
            timeoutMs
          }
        });
      }

      if (error instanceof VCWApiError) {
        throw error;
      }

      throw new VCWApiError('ไม่สามารถเชื่อมต่อ API ได้', {
        code: 'NETWORK_ERROR',
        status: 0,
        details: {
          message:
            error && error.message
              ? error.message
              : String(error || '')
        }
      });
    } finally {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    }

    if (!response.ok || !payload || payload.success === false) {
      const apiError =
        payload && payload.error
          ? payload.error
          : {};

      throw new VCWApiError(
        apiError.message ||
        `API ตอบกลับผิดพลาด (${response.status})`,
        {
          code:
            apiError.code ||
            `HTTP_${response.status}`,
          status:
            response.status,
          requestId:
            payload && payload.requestId
              ? payload.requestId
              : '',
          serverTime:
            payload && payload.serverTime
              ? payload.serverTime
              : '',
          details:
            apiError.details || {},
          raw:
            payload
        }
      );
    }

    return payload;
  }

  function isRouteNotFoundError(error) {
    const code =
      String(error && error.code || '')
        .toUpperCase();

    return (
      Number(error && error.status) === 404 ||
      code === 'ROUTE_NOT_FOUND' ||
      code === 'ADMIN_ROUTE_NOT_FOUND' ||
      code === 'ACTION_NOT_FOUND'
    );
  }

  async function workflowRequest(routeOptions) {
    const options =
      routeOptions && typeof routeOptions === 'object'
        ? routeOptions
        : {};

    const moduleId =
      sanitizeModuleId(
        options.moduleId || runtimeConfig.defaultModuleId
      );

    const routeStyle =
      normalizeRouteStyle(options.routeStyle || runtimeConfig.routeStyle);

    const fallbackRouteStyle =
      normalizeRouteStyle(options.fallbackRouteStyle || runtimeConfig.fallbackRouteStyle);

    const buildPath =
      (style) => appendQuery(
        buildWorkflowPath(
          style,
          moduleId,
          options.action,
          options.pathEntryCode || ''
        ),
        options.query || {}
      );

    try {
      return await request(
        buildPath(routeStyle),
        options.requestOptions || {}
      );
    } catch (error) {
      if (
        routeStyle !== fallbackRouteStyle &&
        isRouteNotFoundError(error)
      ) {
        return request(
          buildPath(fallbackRouteStyle),
          options.requestOptions || {}
        );
      }

      throw error;
    }
  }

  function unwrapData(payload) {
    return payload && Object.prototype.hasOwnProperty.call(payload, 'data')
      ? payload.data
      : payload;
  }

  async function lookupEntry(moduleId, entryCode, options) {
    const safeEntryCode =
      sanitizeEntryCode(entryCode);

    const payload =
      await workflowRequest({
        moduleId,
        action: 'lookup',
        query: {
          entryCode: safeEntryCode
        },
        requestOptions: {
          method: 'GET',
          ...(options || {})
        }
      });

    return unwrapData(payload);
  }

  async function getState(moduleId, entryCode, options) {
    const safeEntryCode =
      sanitizeEntryCode(entryCode);

    const payload =
      await workflowRequest({
        moduleId,
        action: 'state',
        pathEntryCode: safeEntryCode,
        requestOptions: {
          method: 'GET',
          ...(options || {})
        }
      });

    return unwrapData(payload);
  }

  function buildWorkflowWritePayload(source) {
    const body =
      source && typeof source === 'object'
        ? source
        : {};

    const payload = {
      entryCode:
        sanitizeEntryCode(
          body.entryCode || body.autoId || body.qrText
        ),

      qrText:
        sanitizeOptionalText(
          body.qrText || body.entryCode || '',
          500
        ),

      note:
        sanitizeOptionalText(
          body.note || body.remark || '',
          1000
        ),

      latitude:
        body.latitude === undefined || body.latitude === null || body.latitude === ''
          ? ''
          : Number(body.latitude),

      longitude:
        body.longitude === undefined || body.longitude === null || body.longitude === ''
          ? ''
          : Number(body.longitude),

      imageFileId:
        sanitizeOptionalText(
          body.imageFileId || '',
          300
        ),

      requestId:
        sanitizeOptionalText(
          body.requestId || createRequestId('vcw-write'),
          120
        )
    };

    if (
      payload.latitude !== '' &&
      !Number.isFinite(payload.latitude)
    ) {
      throw new VCWApiError('ค่าละติจูดไม่ถูกต้อง', {
        code: 'INVALID_LATITUDE',
        status: 400
      });
    }

    if (
      payload.longitude !== '' &&
      !Number.isFinite(payload.longitude)
    ) {
      throw new VCWApiError('ค่าลองจิจูดไม่ถูกต้อง', {
        code: 'INVALID_LONGITUDE',
        status: 400
      });
    }

    return payload;
  }

  async function submitDocument(moduleId, body, options) {
    const payload =
      await workflowRequest({
        moduleId,
        action: 'submit-document',
        requestOptions: {
          method: 'POST',
          body: buildWorkflowWritePayload(body),
          ...(options || {})
        }
      });

    return unwrapData(payload);
  }

  async function completeReceiving(moduleId, body, options) {
    const payload =
      await workflowRequest({
        moduleId,
        action: 'complete-receiving',
        requestOptions: {
          method: 'POST',
          body: buildWorkflowWritePayload(body),
          ...(options || {})
        }
      });

    return unwrapData(payload);
  }

  async function returnDocument(moduleId, body, options) {
    const payload =
      await workflowRequest({
        moduleId,
        action: 'return-document',
        requestOptions: {
          method: 'POST',
          body: buildWorkflowWritePayload(body),
          ...(options || {})
        }
      });

    return unwrapData(payload);
  }

  async function cancelEvent(moduleId, body, options) {
    const source =
      body && typeof body === 'object'
        ? body
        : {};

    const payloadBody = {
      eventId:
        sanitizeOptionalText(
          source.eventId || source.workflowEventId || '',
          150
        ),

      entryCode:
        source.entryCode || source.autoId || source.qrText
          ? sanitizeEntryCode(source.entryCode || source.autoId || source.qrText)
          : '',

      stageCode:
        sanitizeOptionalText(
          source.stageCode || source.stage || '',
          100
        ),

      reason:
        sanitizeReason(source.reason),

      requestId:
        sanitizeOptionalText(
          source.requestId || createRequestId('vcw-cancel'),
          120
        )
    };

    if (!payloadBody.eventId && !payloadBody.entryCode) {
      throw new VCWApiError('กรุณาระบุ eventId หรือ entryCode สำหรับยกเลิก', {
        code: 'CANCEL_TARGET_REQUIRED',
        status: 400
      });
    }

    const payload =
      await workflowRequest({
        moduleId,
        action: 'cancel-event',
        requestOptions: {
          method: 'POST',
          body: payloadBody,
          ...(options || {})
        }
      });

    return unwrapData(payload);
  }

  const api = {
    version:
      'VCW-R07-2026-07-06',

    VCWApiError,

    configure,
    getConfig,
    getAccessToken,
    isAuthenticated,
    request,

    workflowDashboard: async function (moduleId, options, apiBase) {
      const opts = options || {};
      const payload =
        await workflowRequest({
          moduleId,
          action: 'dashboard',
          query: {
            limit: opts.limit || 30
          },
          requestOptions: {
            method: 'GET',
            apiBase: apiBase || undefined
          }
        });

      return unwrapData(payload);
    },

    lookupEntry,
    lookup:
      lookupEntry,

    getState,
    state:
      getState,

    submitDocument,
    completeReceiving,
    returnDocument,
    cancelEvent,

    buildWorkflowWritePayload,
    createRequestId
  };

  window.VCWWorkflowAPI =
    api;

  window.VCWWorkflowApi =
    api;

  window.dispatchEvent(
    new CustomEvent('vcw-workflow-api-ready', {
      detail: api.getConfig()
    })
  );

  window.dispatchEvent(
    new CustomEvent('VCWWorkflowAPIReady', {
      detail: api.getConfig()
    })
  );
})(window);
