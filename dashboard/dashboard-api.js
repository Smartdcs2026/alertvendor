/**
 * dashboard-api.js
 * API แบบอ่านอย่างเดียวสำหรับ Dashboard
 * ROUND 05 HOTFIX 13 — Isolated Session
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

  function readStorageToken(storage) {
    try {
      return String(
        storage && storage.getItem(TOKEN_STORAGE_KEY) || ''
      ).trim();
    } catch (error) {
      return '';
    }
  }

  function writeStorageToken(storage, token) {
    try {
      if (storage && token) {
        storage.setItem(TOKEN_STORAGE_KEY, token);
      }
    } catch (error) {
      /* ignore */
    }
  }

  function removeStorageToken(storage) {
    try {
      if (storage) {
        storage.removeItem(TOKEN_STORAGE_KEY);
      }
    } catch (error) {
      /* ignore */
    }
  }

  function getAccessToken() {
    /*
     * HOTFIX 13:
     * Dashboard ต้องใช้ Token ของหน้าต่างนี้เท่านั้น
     * ไม่อ่าน localStorage เพื่อกันชื่อ/สิทธิ์ปะปนกับ PWA หรือแท็บอื่น
     */
    return readStorageToken(
      window.sessionStorage
    );
  }

  function clearSession() {
    removeStorageToken(window.localStorage);
    removeStorageToken(window.sessionStorage);
  }

  removeStorageToken(window.localStorage);

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

  function buildUrl(path, query) {
    const cleanPath =
      String(path || '')
        .startsWith('/')
        ? String(path)
        : '/' + String(path || '');

    const url =
      new URL(
        API_BASE + cleanPath
      );

    Object.entries(
      query || {}
    ).forEach(
      ([key, value]) => {
        if (
          value !== undefined &&
          value !== null &&
          value !== ''
        ) {
          url.searchParams.set(
            key,
            String(value)
          );
        }
      }
    );

    return url.toString();
  }

  async function request(path, options) {
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

    const controller =
      new AbortController();

    const timeoutId =
      window.setTimeout(
        () => controller.abort(),
        Number(
          CONFIG.API_TIMEOUT_MS
        ) || 60000
      );

    const headers =
      new Headers({
        Accept:
          'application/json',

        'X-Request-Id':
          createRequestId()
      });

    const token =
      getAccessToken();

    if (token) {
      headers.set(
        'Authorization',
        'Bearer ' + token
      );
    }

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

            headers:
              headers,

            cache:
              'no-store',

            credentials:
              'omit',

            signal:
              controller.signal
          }
        );

      const text =
        await response.text();

      let payload;

      try {
        payload =
          JSON.parse(text);
      } catch (error) {
        throw new DashboardAPIError(
          'API ส่งข้อมูลที่ไม่ใช่ JSON',
          'INVALID_JSON_RESPONSE',
          response.status
        );
      }

      if (
        !response.ok ||
        payload.success !== true
      ) {
        const apiError =
          payload.error || {};

        if (response.status === 401) {
          clearSession();
        }

        throw new DashboardAPIError(
          apiError.message ||
          'เกิดข้อผิดพลาดจากระบบ',
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
        error instanceof
        DashboardAPIError
      ) {
        throw error;
      }

      throw new DashboardAPIError(
        navigator.onLine
          ? 'เชื่อมต่อระบบไม่สำเร็จ'
          : 'อุปกรณ์ไม่มีอินเทอร์เน็ต',
        'NETWORK_ERROR',
        0
      );
    } finally {
      window.clearTimeout(
        timeoutId
      );
    }
  }

  window.DashboardAPI =
    Object.freeze({
      Error:
        DashboardAPIError,

      clearSession:
        clearSession,

      me() {
        return request(
          '/api/auth/me'
        );
      },

      getModule(moduleId) {
        return request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          )
        );
      },

      getActiveRecords(moduleId) {
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

      getMovementSummary(moduleId) {
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
      },

      getReceivingFlow(moduleId) {
        return request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/receiving-flow',
          {
            query: {
              mode:
                'ACTIVE'
            }
          }
        );
      },


      getShiftDashboard(
        moduleId,
        options
      ) {
        const config =
          options &&
          typeof options ===
            'object'
            ? options
            : {};

        return request(
          '/api/modules/' +
          encodeURIComponent(
            moduleId
          ) +
          '/shift-dashboard',
          {
            query: {
              date:
                config.date ||
                ''
            }
          }
        );
      }
    });

})(window);
