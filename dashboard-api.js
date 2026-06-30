/**
 * dashboard-api.js
 * API สำหรับ Dashboard แบบอ่านอย่างเดียว
 *
 * มีเฉพาะคำสั่ง GET:
 * - ตรวจ Session
 * - อ่านข้อมูล Module
 * - อ่าน Active Records
 * - อ่าน Movement Summary
 */
(function (window) {
  'use strict';

  const CONFIG =
    window.DASHBOARD_CONFIG || {};

  const API_BASE =
    String(
      CONFIG.API_BASE || ''
    ).replace(/\/+$/, '');

  const TOKEN_STORAGE_KEY =
    String(
      CONFIG.TOKEN_STORAGE_KEY ||
      'alertvendor_access_token'
    );

  class DashboardAPIError extends Error {
    constructor(
      message,
      code,
      status,
      details,
      requestId
    ) {
      super(
        message ||
        'เกิดข้อผิดพลาดในการเรียก Dashboard API'
      );

      this.name =
        'DashboardAPIError';

      this.code =
        code || 'DASHBOARD_API_ERROR';

      this.status =
        Number(status) || 0;

      this.details =
        details || null;

      this.requestId =
        requestId || '';
    }
  }

  function getAccessToken() {
    try {
      return String(
        window.sessionStorage.getItem(
          TOKEN_STORAGE_KEY
        ) || ''
      ).trim();

    } catch (error) {
      return '';
    }
  }

  function clearAccessToken() {
    try {
      window.sessionStorage.removeItem(
        TOKEN_STORAGE_KEY
      );

    } catch (error) {
      console.warn(
        'ล้าง Session Token ไม่สำเร็จ',
        error
      );
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
      'dashboard-' +
      Date.now().toString(36) +
      '-' +
      Math.random()
        .toString(36)
        .slice(2, 10)
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

  async function request(
    path,
    options
  ) {
    if (!API_BASE) {
      throw new DashboardAPIError(
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

    const token =
      getAccessToken();

    if (!token) {
      throw new DashboardAPIError(
        'ไม่พบ Session กรุณาเข้าสู่ระบบใหม่',
        'AUTH_REQUIRED',
        401
      );
    }

    const controller =
      new AbortController();

    const timeoutId =
      window.setTimeout(
        () => controller.abort(),
        Math.max(
          5000,
          Number(
            config.timeoutMs ||
            CONFIG.API_TIMEOUT_MS ||
            60000
          )
        )
      );

    const headers =
      new Headers();

    headers.set(
      'Accept',
      'application/json'
    );

    headers.set(
      'Authorization',
      'Bearer ' + token
    );

    headers.set(
      'X-Request-Id',
      createRequestId()
    );

    try {
      const response =
        await fetch(
          buildUrl(
            path,
            config.query
          ),
          {
            method:
              'GET',

            headers,

            credentials:
              'omit',

            cache:
              'no-store',

            redirect:
              'follow',

            signal:
              controller.signal
          }
        );

      const text =
        await response.text();

      let payload;

      try {
        payload =
          JSON.parse(
            text || '{}'
          );

      } catch (error) {
        throw new DashboardAPIError(
          'API ไม่ได้ส่ง JSON ที่ถูกต้องกลับมา',
          'INVALID_JSON_RESPONSE',
          response.status,
          {
            preview:
              String(text || '').slice(
                0,
                250
              )
          }
        );
      }

      const apiError =
        payload &&
        payload.error
          ? payload.error
          : {};

      if (
        !response.ok ||
        payload.success !== true
      ) {
        if (
          response.status === 401 ||
          [
            'AUTH_REQUIRED',
            'SESSION_EXPIRED',
            'INVALID_SESSION',
            'INVALID_SESSION_SIGNATURE',
            'SESSION_VERSION_EXPIRED'
          ].includes(
            apiError.code
          )
        ) {
          clearAccessToken();
        }

        throw new DashboardAPIError(
          apiError.message ||
          'Dashboard API ทำงานไม่สำเร็จ',
          apiError.code ||
          'API_ERROR',
          response.status,
          apiError.details || null,
          payload.requestId || ''
        );
      }

      return payload.data;

    } catch (error) {
      if (
        error &&
        error.name === 'AbortError'
      ) {
        throw new DashboardAPIError(
          'ระบบใช้เวลาตอบกลับนานเกินกำหนด',
          'REQUEST_TIMEOUT',
          408
        );
      }

      if (
        error instanceof DashboardAPIError
      ) {
        throw error;
      }

      throw new DashboardAPIError(
        navigator.onLine
          ? 'ไม่สามารถเชื่อมต่อ Dashboard API ได้'
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

  const DashboardAPI = Object.freeze({
    Error:
      DashboardAPIError,

    getAccessToken,

    clearSession:
      clearAccessToken,

    async me() {
      return request(
        '/api/auth/me'
      );
    },

    async getModule(
      moduleId
    ) {
      return request(
        '/api/modules/' +
        encodeURIComponent(
          moduleId
        )
      );
    },

    async getActiveRecords(
      moduleId
    ) {
      return request(
        '/api/modules/' +
        encodeURIComponent(
          moduleId
        ) +
        '/records',
        {
          query: {
            mode:
              'active',

            limit:
              Number(
                CONFIG.ACTIVE_RECORD_LIMIT
              ) || 5000
          }
        }
      );
    },

    async getMovementSummary(
      moduleId
    ) {
      return request(
        '/api/modules/' +
        encodeURIComponent(
          moduleId
        ) +
        '/movement-summary',
        {
          query: {
            mode:
              'all'
          }
        }
      );
    }
  });

  window.DashboardAPI =
    DashboardAPI;
})(window);
