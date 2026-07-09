/**
 * api.js
 * ตัวกลางเรียก Cloudflare Worker API
 *
 * Session:
 * - เก็บ Signed Session Token ใน sessionStorage
 * - ส่งผ่าน Authorization: Bearer <token>
 * - ไม่พึ่ง Third-party Cookie ระหว่าง github.io กับ workers.dev
 * - รองรับ Receiving Flow, การบันทึกรับสินค้าเสร็จ และ Feature Flag ราย Module
 */
(function (window) {
  'use strict';

  const CONFIG =
    window.APP_CONFIG || {};

  const API_BASE =
    String(
      CONFIG.API_BASE || ''
    ).replace(/\/+$/, '');

  const TOKEN_STORAGE_KEY =
    'alertvendor_access_token';

  const inFlightGetRequests =
    new Map();

  const RETRYABLE_ERROR_CODES =
    new Set([
      'NETWORK_ERROR',
      'REQUEST_TIMEOUT',
      'GAS_TIMEOUT',
      'GAS_CONNECTION_FAILED',
      'GAS_HTTP_ERROR'
    ]);

  if (!API_BASE) {
    console.error(
      'ไม่พบ APP_CONFIG.API_BASE'
    );
  }

  class VehicleAPIError extends Error {
    constructor(
      message,
      code,
      status,
      details,
      requestId
    ) {
      super(
        message ||
        'เกิดข้อผิดพลาดในการเรียก API'
      );

      this.name =
        'VehicleAPIError';

      this.code =
        code ||
        'API_ERROR';

      this.status =
        Number(status) || 0;

      this.details =
        details || null;

      this.requestId =
        requestId || '';
    }
  }

  /************************************************************
   * Token Storage
   ************************************************************/

  function getAccessToken() {
    try {
      return String(
        window.sessionStorage
          .getItem(
            TOKEN_STORAGE_KEY
          ) || ''
      ).trim();

    } catch (error) {
      console.warn(
        'ไม่สามารถอ่าน Session Token ได้',
        error
      );

      return '';
    }
  }

  function setAccessToken(
    token
  ) {
    const cleanToken =
      String(
        token || ''
      ).trim();

    if (!cleanToken) {
      clearAccessToken();
      return;
    }

    try {
      window.sessionStorage
        .setItem(
          TOKEN_STORAGE_KEY,
          cleanToken
        );

    } catch (error) {
      throw new VehicleAPIError(
        'เบราว์เซอร์ไม่อนุญาตให้บันทึก Session',
        'SESSION_STORAGE_FAILED',
        0,
        {
          originalMessage:
            error &&
            error.message
              ? error.message
              : String(error)
        }
      );
    }
  }

  function clearAccessToken() {
    try {
      window.sessionStorage
        .removeItem(
          TOKEN_STORAGE_KEY
        );

    } catch (error) {
      console.warn(
        'ไม่สามารถล้าง Session Token ได้',
        error
      );
    }
  }

  function updateTokenFromData(
    data
  ) {
    const token =
      data &&
      data.accessToken
        ? String(
            data.accessToken
          ).trim()
        : '';

    if (token) {
      setAccessToken(
        token
      );
    }

    return token;
  }

  /************************************************************
   * Request helpers
   ************************************************************/

  function createRequestId() {
    if (
      window.crypto &&
      typeof window.crypto.randomUUID ===
        'function'
    ) {
      return window.crypto.randomUUID();
    }

    return (
      'req-' +
      Date.now().toString(36) +
      '-' +
      Math.random()
        .toString(36)
        .slice(2, 12)
    );
  }

  function buildUrl(
    path,
    query
  ) {
    const cleanPath =
      String(
        path || ''
      ).startsWith('/')
        ? String(path)
        : '/' + String(path || '');

    const url =
      new URL(
        API_BASE + cleanPath
      );

    if (
      query &&
      typeof query === 'object'
    ) {
      Object.entries(query)
        .forEach(
          ([key, value]) => {
            if (
              value === undefined ||
              value === null ||
              value === ''
            ) {
              return;
            }

            url.searchParams.set(
              key,
              String(value)
            );
          }
        );
    }

    return url.toString();
  }

  async function parseResponse(
    response
  ) {
    const text =
      await response.text();

    if (!text.trim()) {
      throw new VehicleAPIError(
        'API ไม่ได้ส่งข้อมูลกลับมา',
        'EMPTY_RESPONSE',
        response.status,
        null,
        response.headers.get(
          'X-Request-Id'
        ) || ''
      );
    }

    let payload;

    try {
      payload =
        JSON.parse(text);

    } catch (error) {
      throw new VehicleAPIError(
        'API ไม่ได้ส่ง JSON ที่ถูกต้องกลับมา',
        'INVALID_JSON_RESPONSE',
        response.status,
        {
          preview:
            text.slice(
              0,
              300
            )
        },
        response.headers.get(
          'X-Request-Id'
        ) || ''
      );
    }

    const requestId =
      String(
        payload.requestId ||
        response.headers.get(
          'X-Request-Id'
        ) ||
        ''
      );

    if (
      !response.ok ||
      payload.success !== true
    ) {
      const apiError =
        payload &&
        payload.error
          ? payload.error
          : {};

      if (
        response.status === 401 ||
        [
          'AUTH_REQUIRED',
          'SESSION_EXPIRED',
          'INVALID_SESSION',
          'INVALID_SESSION_SIGNATURE',
          'INVALID_SESSION_PAYLOAD',
          'SESSION_VERSION_EXPIRED'
        ].includes(
          apiError.code
        )
      ) {
        clearAccessToken();
      }

      throw new VehicleAPIError(
        apiError.message ||
        'เกิดข้อผิดพลาดจากระบบ',
        apiError.code ||
        'API_ERROR',
        response.status,
        apiError.details || null,
        requestId
      );
    }

    return payload;
  }

  async function request(
    path,
    options
  ) {
    const config =
      options &&
      typeof options === 'object'
        ? {
            ...options
          }
        : {};

    const method =
      String(
        config.method || 'GET'
      ).toUpperCase();

    const requestKey =
      method === 'GET' &&
      config.dedupe !== false
        ? buildUrl(
            path,
            config.query
          )
        : '';

    if (
      requestKey &&
      inFlightGetRequests.has(
        requestKey
      )
    ) {
      return inFlightGetRequests.get(
        requestKey
      );
    }

    const promise =
      requestWithRetry(
        path,
        config
      );

    if (requestKey) {
      inFlightGetRequests.set(
        requestKey,
        promise
      );
    }

    try {
      return await promise;

    } finally {
      if (requestKey) {
        inFlightGetRequests.delete(
          requestKey
        );
      }
    }
  }

  async function requestWithRetry(
    path,
    config
  ) {
    const method =
      String(
        config.method || 'GET'
      ).toUpperCase();

    const maximumRetries =
      method === 'GET'
        ? clampInteger(
            config.retries,
            0,
            3,
            2
          )
        : 0;

    let attempt = 0;

    while (true) {
      try {
        return await requestOnce(
          path,
          config
        );

      } catch (error) {
        if (
          attempt >=
            maximumRetries ||
          !shouldRetryRequest(
            error,
            method
          )
        ) {
          throw error;
        }

        const waitMs =
          calculateRetryDelayMs(
            error,
            attempt
          );

        await delay(waitMs);

        attempt += 1;
      }
    }
  }

  async function requestOnce(
    path,
    config
  ) {
    if (!API_BASE) {
      throw new VehicleAPIError(
        'ยังไม่ได้ตั้งค่า API_BASE',
        'API_BASE_MISSING',
        0
      );
    }

    const method =
      String(
        config.method || 'GET'
      ).toUpperCase();

    const useAuthentication =
      config.auth !== false;

    const timeoutMs =
      Math.max(
        5000,
        Number(
          config.timeoutMs ||
          CONFIG.API_TIMEOUT_MS ||
          60000
        )
      );

    const controller =
      new AbortController();

    const timeoutId =
      window.setTimeout(
        () => {
          controller.abort();
        },
        timeoutMs
      );

    const headers =
      new Headers(
        config.headers || {}
      );

    headers.set(
      'Accept',
      'application/json'
    );

    headers.set(
      'X-Request-Id',
      createRequestId()
    );

    if (useAuthentication) {
      const token =
        getAccessToken();

      if (token) {
        headers.set(
          'Authorization',
          'Bearer ' + token
        );
      }
    }

    const fetchOptions = {
      method,
      headers,
      credentials:
        'omit',
      cache:
        'no-store',
      redirect:
        'follow',
      signal:
        controller.signal
    };

    if (
      config.body !== undefined
    ) {
      headers.set(
        'Content-Type',
        'application/json; charset=UTF-8'
      );

      fetchOptions.body =
        JSON.stringify(
          config.body
        );
    }

    try {
      const response =
        await fetch(
          buildUrl(
            path,
            config.query
          ),
          fetchOptions
        );

      return await parseResponse(
        response
      );

    } catch (error) {
      if (
        error &&
        error.name === 'AbortError'
      ) {
        throw new VehicleAPIError(
          'ระบบใช้เวลาตอบกลับนานเกินกำหนด',
          'REQUEST_TIMEOUT',
          408
        );
      }

      if (
        error instanceof
        VehicleAPIError
      ) {
        throw error;
      }

      throw new VehicleAPIError(
        navigator.onLine
          ? 'ไม่สามารถเชื่อมต่อระบบได้'
          : 'อุปกรณ์ไม่ได้เชื่อมต่ออินเทอร์เน็ต',
        'NETWORK_ERROR',
        0,
        {
          originalMessage:
            error &&
            error.message
              ? error.message
              : String(error)
        }
      );

    } finally {
      window.clearTimeout(
        timeoutId
      );
    }
  }

  function shouldRetryRequest(
    error,
    method
  ) {
    if (method !== 'GET') {
      return false;
    }

    if (!error) {
      return false;
    }

    if (
      RETRYABLE_ERROR_CODES.has(
        error.code
      )
    ) {
      return true;
    }

    return [
      502,
      503,
      504
    ].includes(
      Number(error.status)
    );
  }

  function calculateRetryDelayMs(
    error,
    attempt
  ) {
    const retryAfterSeconds =
      Number(
        error &&
        error.details &&
        error.details.retryAfterSeconds
      );

    if (
      Number.isFinite(
        retryAfterSeconds
      ) &&
      retryAfterSeconds > 0
    ) {
      return Math.min(
        retryAfterSeconds *
          1000,
        10000
      );
    }

    return Math.min(
      700 *
        Math.pow(
          2,
          attempt
        ) +
        Math.floor(
          Math.random() *
          250
        ),
      5000
    );
  }

  function delay(
    milliseconds
  ) {
    return new Promise(
      (resolve) => {
        window.setTimeout(
          resolve,
          milliseconds
        );
      }
    );
  }

  function clampInteger(
    value,
    minimum,
    maximum,
    fallback
  ) {
    const number =
      Number(value);

    if (
      !Number.isFinite(number)
    ) {
      return fallback;
    }

    return Math.min(
      Math.max(
        Math.floor(number),
        minimum
      ),
      maximum
    );
  }

  function getClientDiagnostics() {
    let storageAvailable =
      true;

    try {
      const probeKey =
        '__alertvendor_probe__';

      window.sessionStorage
        .setItem(
          probeKey,
          '1'
        );

      window.sessionStorage
        .removeItem(
          probeKey
        );

    } catch (error) {
      storageAvailable =
        false;
    }

    return {
      status:
        navigator.onLine &&
        storageAvailable &&
        Boolean(
          getAccessToken()
        )
          ? 'PASS'
          : 'FAIL',

      checkedAt:
        new Date()
          .toISOString(),

      online:
        navigator.onLine,

      origin:
        window.location.origin,

      page:
        window.location.pathname,

      storageAvailable:
        storageAvailable,

      sessionTokenPresent:
        Boolean(
          getAccessToken()
        ),

      apiBase:
        API_BASE
    };
  }

  /************************************************************
   * Public API
   ************************************************************/

  const VehicleAPI = {
    Error:
      VehicleAPIError,

    request,

    getAccessToken,

    clearSession:
      clearAccessToken,

    getClientDiagnostics,

    hasSession() {
      return Boolean(
        getAccessToken()
      );
    },

    async health() {
      const response =
        await request(
          '/api/health',
          {
            auth:
              false,

            timeoutMs:
              CONFIG.AUTH_TIMEOUT_MS
          }
        );

      return response.data;
    },

    async login(
      username,
      password
    ) {
      /*
       * ล้าง Token เก่าก่อน Login ใหม่
       */
      clearAccessToken();

      const response =
        await request(
          '/api/auth/login',
          {
            method:
              'POST',

            auth:
              false,

            timeoutMs:
              CONFIG.AUTH_TIMEOUT_MS,

            body: {
              username:
                String(
                  username || ''
                ).trim(),

              password:
                String(
                  password || ''
                )
            }
          }
        );

      const data =
        response.data || {};

      const token =
        updateTokenFromData(
          data
        );

      if (!token) {
        throw new VehicleAPIError(
          'ระบบเข้าสู่ระบบสำเร็จ แต่ไม่ได้รับ Session Token',
          'ACCESS_TOKEN_MISSING',
          502,
          null,
          response.requestId || ''
        );
      }

      return data;
    },

    async me() {
      const response =
        await request(
          '/api/auth/me',
          {
            timeoutMs:
              CONFIG.AUTH_TIMEOUT_MS
          }
        );

      return response.data;
    },

    async logout() {
      try {
        const response =
          await request(
            '/api/auth/logout',
            {
              method:
                'POST',

              timeoutMs:
                CONFIG.AUTH_TIMEOUT_MS,

              body:
                {}
            }
          );

        return response.data;

      } finally {
        /*
         * Logout ฝั่ง Client ต้องลบ Token เสมอ
         */
        clearAccessToken();
      }
    },

    async changePassword(
      currentPassword,
      newPassword
    ) {
      const response =
        await request(
          '/api/auth/change-password',
          {
            method:
              'POST',

            timeoutMs:
              CONFIG.AUTH_TIMEOUT_MS,

            body: {
              currentPassword:
                String(
                  currentPassword || ''
                ),

              newPassword:
                String(
                  newPassword || ''
                )
            }
          }
        );

      const data =
        response.data || {};

      /*
       * Worker ส่ง Token ใหม่หลังเปลี่ยนรหัสผ่าน
       */
      updateTokenFromData(
        data
      );

      return data;
    },

    async getModules() {
      const response =
        await request(
          '/api/modules'
        );

      return response.data;
    },

    async getModule(
      moduleId
    ) {
      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          )
        );

      return response.data;
    },

    async getRecords(
      moduleId,
      options
    ) {
      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/records',
          {
            query:
              options || {}
          }
        );

      return response.data;
    },

    async getMovementSummary(
      moduleId,
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/movement-summary',
          {
            query: {
              mode:
                config.mode ||
                'all',

              date:
                config.date ||
                '',

              scope:
                config.scope ||
                '',

              shift:
                config.shift ||
                config.shiftCode ||
                ''
            }
          }
        );

      return response.data;
    },



    async getShiftConfig(
      moduleId,
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/shift-config',
          {
            query: {
              date:
                config.date ||
                ''
            }
          }
        );

      return response.data;
    },


    async getMovementScope(
      moduleId,
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/movement-scope',
          {
            query: {
              scope:
                config.scope ||
                'ROLLING_4H',

              date:
                config.date ||
                '',

              shift:
                config.shift ||
                config.shiftCode ||
                ''
            }
          }
        );

      return response.data;
    },


    async getAdminShiftConfig(
      moduleId,
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/admin/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/shift-config',
          {
            query: {
              date:
                config.date ||
                ''
            }
          }
        );

      return response.data;
    },


    async saveAdminShiftConfig(
      moduleId,
      payload
    ) {
      const response =
        await request(
          '/api/admin/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/shift-config',
          {
            method:
              'POST',

            body:
              payload || {}
          }
        );

      return response.data;
    },


    async setupAdminShiftSystem() {
      const response =
        await request(
          '/api/admin/shifts/setup',
          {
            method:
              'POST',

            body: {}
          }
        );

      return response.data;
    },


    async runAdminShiftSnapshots(
      options
    ) {
      const response =
        await request(
          '/api/admin/shifts/run-snapshots',
          {
            method:
              'POST',

            body:
              options || {}
          }
        );

      return response.data;
    },


    async getAdminShiftStatistics(
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/admin/shifts/statistics',
          {
            query: {
              moduleId:
                config.moduleId ||
                '',

              startDate:
                config.startDate ||
                '',

              endDate:
                config.endDate ||
                '',

              shift:
                config.shift ||
                '',

              limit:
                config.limit ||
                100
            }
          }
        );

      return response.data;
    },


    async getReceivingFlow(
      moduleId,
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(moduleId) +
          '/receiving-flow',
          {
            query: {
              mode: config.mode || 'ACTIVE'
            }
          }
        );

      return response.data;
    },


    async completeReceiving(
      moduleId,
      record
    ) {
      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(moduleId) +
          '/receiving-complete',
          {
            method: 'POST',
            timeoutMs:
              CONFIG.SAVE_TIMEOUT_MS ||
              90000,
            body: record || {}
          }
        );

      return response.data;
    },


    async getCalendar(
      moduleId,
      month,
      year
    ) {
      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/calendar',
          {
            query: {
              month,
              year
            }
          }
        );

      return response.data;
    },

    async getDailySummary(
      moduleId,
      date
    ) {
      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/daily-summary',
          {
            query: {
              date
            }
          }
        );

      return response.data;
    },

    async previewCheckout(
      moduleId,
      record
    ) {
      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/checkout/preview',
          {
            method:
              'POST',

            body:
              record
          }
        );

      return response.data;
    },

    async checkout(
      moduleId,
      record
    ) {
      const response =
        await request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/checkout',
          {
            method:
              'POST',

            body:
              record
          }
        );

      return response.data;
    },

    async getAdminDashboard(
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/admin/dashboard',
          {
            query: {
              auditLimit:
                config.auditLimit || 30
            }
          }
        );

      return response.data;
    },

    async getAdminUiSchema() {
      const response =
        await request(
          '/api/admin/ui-schema'
        );

      return response.data;
    },

    async getAdminNewModuleTemplate() {
      const response =
        await request(
          '/api/admin/modules/new-template'
        );

      return response.data;
    },

    async getAdminModuleBundle(
      moduleId
    ) {
      const response =
        await request(
          '/api/admin/modules/' +
          encodeURIComponent(
            moduleId
          )
        );

      return response.data;
    },

    async inspectAdminSource(
      payload
    ) {
      const response =
        await request(
          '/api/admin/source-metadata',
          {
            method:
              'POST',

            body:
              payload || {}
          }
        );

      return response.data;
    },

    async saveAdminModuleBundle(
      payload
    ) {
      const response =
        await request(
          '/api/admin/modules/save',
          {
            method:
              'POST',

            body:
              payload || {}
          }
        );

      return response.data;
    },

    async duplicateAdminModule(
      payload
    ) {
      const response =
        await request(
          '/api/admin/modules/duplicate',
          {
            method:
              'POST',

            body:
              payload || {}
          }
        );

      return response.data;
    },

    async archiveAdminModule(
      moduleId
    ) {
      const response =
        await request(
          '/api/admin/modules/archive',
          {
            method:
              'POST',

            body: {
              moduleId
            }
          }
        );

      return response.data;
    },

    async getAdminUsers() {
      const response =
        await request(
          '/api/admin/users'
        );

      return response.data;
    },

    async saveAdminUser(
      payload
    ) {
      const response =
        await request(
          '/api/admin/users/save',
          {
            method:
              'POST',

            body:
              payload || {}
          }
        );

      return response.data;
    },

    async resetAdminUserPassword(
      payload
    ) {
      const response =
        await request(
          '/api/admin/users/reset-password',
          {
            method:
              'POST',

            body:
              payload || {}
          }
        );

      return response.data;
    },

    async unlockAdminUser(
      userId
    ) {
      const response =
        await request(
          '/api/admin/users/unlock',
          {
            method:
              'POST',

            body: {
              userId
            }
          }
        );

      return response.data;
    },

    async saveAdminSettings(
      settings
    ) {
      const response =
        await request(
          '/api/admin/settings',
          {
            method:
              'POST',

            body: {
              settings:
                settings || {}
            }
          }
        );

      return response.data;
    },

    async getAdminAudit(
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/admin/audit',
          {
            query: {
              limit:
                config.limit || 50,

              username:
                config.username || '',

              moduleId:
                config.moduleId || '',

              action:
                config.action || ''
            }
          }
        );

      return response.data;
    },


    async getAdminAutoCloseStatus() {
      const response =
        await request(
          '/api/admin/auto-close/status'
        );

      return response.data;
    },

    async previewAdminAutoClose(
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/admin/auto-close/preview',
          {
            method:
              'POST',

            timeoutMs:
              120000,

            body: {
              moduleId:
                config.moduleId || '',

              maxClose:
                config.maxClose || 200
            }
          }
        );

      return response.data;
    },

    async runAdminAutoClose(
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/admin/auto-close/run',
          {
            method:
              'POST',

            timeoutMs:
              180000,

            body: {
              moduleId:
                config.moduleId || '',

              maxClose:
                config.maxClose || 200
            }
          }
        );

      return response.data;
    },

    async getAdminAutoCloseHistory(
      options
    ) {
      const config =
        options &&
        typeof options === 'object'
          ? options
          : {};

      const response =
        await request(
          '/api/admin/auto-close/history',
          {
            query: {
              limit:
                config.limit || 50,

              moduleId:
                config.moduleId || '',

              result:
                config.result || '',

              requestId:
                config.requestId || ''
            }
          }
        );

      return response.data;
    },


    async runProductionDiagnostics(
      options
    ) {
      const response =
        await request(
          '/api/admin/diagnostics',
          {
            method:
              'POST',

            timeoutMs:
              120000,

            body: {
              options:
                options || {}
            }
          }
        );

      return response.data;
    },

    async validateAdminSystem() {
      const response =
        await request(
          '/api/admin/validate',
          {
            method:
              'POST',

            body:
              {}
          }
        );

      return response.data;
    }
  };

  window.VehicleAPI =
    VehicleAPI;

})(window);
