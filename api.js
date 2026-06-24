/**
 * api.js
 * ตัวกลางเรียก Cloudflare Worker API
 */
(function (window) {
  'use strict';

  const CONFIG =
    window.APP_CONFIG || {};

  const API_BASE =
    String(CONFIG.API_BASE || '')
      .replace(/\/+$/, '');

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
      String(path || '').startsWith('/')
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
            text.slice(0, 300)
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
    if (!API_BASE) {
      throw new VehicleAPIError(
        'ยังไม่ได้ตั้งค่า API_BASE',
        'API_BASE_MISSING',
        0
      );
    }

    const config =
      options &&
      typeof options === 'object'
        ? options
        : {};

    const method =
      String(
        config.method || 'GET'
      ).toUpperCase();

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

    const fetchOptions = {
      method,
      headers,
      credentials:
        'include',
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

  const VehicleAPI = {
    Error:
      VehicleAPIError,

    request,

    async health() {
      const response =
        await request(
          '/api/health',
          {
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
      const response =
        await request(
          '/api/auth/login',
          {
            method:
              'POST',

            timeoutMs:
              CONFIG.AUTH_TIMEOUT_MS,

            body: {
              username:
                String(username || '')
                  .trim(),

              password:
                String(password || '')
            }
          }
        );

      return response.data;
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
      const response =
        await request(
          '/api/auth/logout',
          {
            method:
              'POST',

            timeoutMs:
              CONFIG.AUTH_TIMEOUT_MS,

            body: {}
          }
        );

      return response.data;
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

      return response.data;
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
    }
  };

  window.VehicleAPI =
    VehicleAPI;

})(window);
