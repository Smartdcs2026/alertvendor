/**
 * dashboard-api.js
 * PHASE 4A — Read-only API with GET retry and Operational Board snapshot
 */
(function (window) {
  'use strict';

  const CONFIG = window.DASHBOARD_CONFIG || {};
  const API_BASE = String(CONFIG.API_BASE || '').replace(/\/+$/, '');
  const TOKEN_STORAGE_KEY = String(
    CONFIG.TOKEN_STORAGE_KEY || 'alertvendor_access_token_v2'
  );

  class DashboardAPIError extends Error {
    constructor(message, code, status, details, requestId) {
      super(message || 'เกิดข้อผิดพลาดในการเรียก Dashboard API');
      this.name = 'DashboardAPIError';
      this.code = code || 'DASHBOARD_API_ERROR';
      this.status = Number(status) || 0;
      this.details = details || null;
      this.requestId = requestId || '';
    }
  }

  function getAccessToken() {
    try {
      return String(
        window.sessionStorage.getItem(TOKEN_STORAGE_KEY) || ''
      ).trim();
    } catch (error) {
      return '';
    }
  }

  function clearSession() {
    try {
      [
        TOKEN_STORAGE_KEY,
        'alertvendor_access_token',
        'alertvendor_access_token_v1'
      ].forEach((key) => window.sessionStorage.removeItem(key));
    } catch (error) {
      console.warn('ล้าง Session ไม่สำเร็จ', error);
    }
  }

  function createRequestId() {
    if (
      window.crypto &&
      typeof window.crypto.randomUUID === 'function'
    ) {
      return window.crypto.randomUUID();
    }

    return (
      'dashboard-' +
      Date.now().toString(36) +
      '-' +
      Math.random().toString(36).slice(2, 10)
    );
  }

  function buildUrl(path, query) {
    const cleanPath = String(path || '').startsWith('/')
      ? String(path)
      : '/' + String(path || '');
    const url = new URL(API_BASE + cleanPath);

    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });

    return url.toString();
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function retryDelay(attempt) {
    const base = Math.max(200, Number(CONFIG.GET_RETRY_BASE_MS) || 700);
    const jitter = Math.floor(Math.random() * Math.max(100, base / 3));
    return Math.min(5000, base * Math.pow(2, attempt) + jitter);
  }

  function shouldRetry(error, attempt, maxRetries) {
    if (attempt >= maxRetries) {
      return false;
    }

    if (!error || error.status === 401 || error.status === 403) {
      return false;
    }

    return (
      error.code === 'NETWORK_ERROR' ||
      error.code === 'REQUEST_TIMEOUT' ||
      error.status === 408 ||
      error.status === 429 ||
      error.status >= 500
    );
  }

  async function executeGet(path, config, logicalRequestId, attempt) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      Number(CONFIG.API_TIMEOUT_MS) || 60000
    );
    const headers = new Headers({
      Accept: 'application/json',
      'X-Request-Id': logicalRequestId,
      'X-Retry-Attempt': String(attempt)
    });
    const token = getAccessToken();

    if (token) {
      headers.set('Authorization', 'Bearer ' + token);
    }

    try {
      const response = await fetch(
        buildUrl(path, config.query),
        {
          method: 'GET',
          headers,
          cache: 'no-store',
          credentials: 'omit',
          signal: controller.signal
        }
      );
      const text = await response.text();
      let payload;

      try {
        payload = JSON.parse(text);
      } catch (error) {
        throw new DashboardAPIError(
          'API ส่งข้อมูลที่ไม่ใช่ JSON',
          'INVALID_JSON_RESPONSE',
          response.status
        );
      }

      if (!response.ok || payload.success !== true) {
        const apiError = payload.error || {};

        if (response.status === 401) {
          clearSession();
        }

        throw new DashboardAPIError(
          apiError.message || 'เกิดข้อผิดพลาดจากระบบ',
          apiError.code || 'API_ERROR',
          response.status,
          apiError.details || null,
          payload.requestId || ''
        );
      }

      return payload.data;
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new DashboardAPIError(
          'ระบบใช้เวลาตอบกลับนานเกินกำหนด',
          'REQUEST_TIMEOUT',
          408
        );
      }

      if (error instanceof DashboardAPIError) {
        throw error;
      }

      throw new DashboardAPIError(
        window.navigator.onLine
          ? 'เชื่อมต่อระบบไม่สำเร็จ'
          : 'อุปกรณ์ไม่มีอินเทอร์เน็ต',
        'NETWORK_ERROR',
        0
      );
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function request(path, options) {
    if (!API_BASE) {
      throw new DashboardAPIError(
        'ยังไม่ได้ตั้งค่า API_BASE',
        'API_BASE_MISSING',
        0
      );
    }

    const config = options && typeof options === 'object' ? options : {};
    const maxRetries = Math.max(
      0,
      Number.isFinite(Number(config.retries))
        ? Number(config.retries)
        : Number(CONFIG.GET_RETRY_COUNT) || 0
    );
    const logicalRequestId = createRequestId();
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await executeGet(path, config, logicalRequestId, attempt);
      } catch (error) {
        lastError = error;

        if (!shouldRetry(error, attempt, maxRetries)) {
          throw error;
        }

        await sleep(retryDelay(attempt));
      }
    }

    throw lastError || new DashboardAPIError(
      'เชื่อมต่อระบบไม่สำเร็จ',
      'NETWORK_ERROR',
      0
    );
  }

  window.DashboardAPI = Object.freeze({
    Error: DashboardAPIError,
    clearSession,

    me() {
      return request('/api/auth/me', {retries: 1});
    },

    getOperationalBoard(moduleId, options) {
      const config = options && typeof options === 'object' ? options : {};

      return request(
        '/api/modules/' +
          encodeURIComponent(moduleId) +
          '/operational-board',
        {
          query: {
            limit:
              Number(config.limit) ||
              Number(CONFIG.OPERATIONAL_BOARD_LIMIT) ||
              3000,
            forceRefresh: config.forceRefresh === true ? 'true' : ''
          }
        }
      );
    },

    // คง API เดิมสำหรับหน้า Shift/การย้อนกลับเฉพาะกิจ
    getModule(moduleId) {
      return request('/api/modules/' + encodeURIComponent(moduleId));
    },

    getActiveRecords(moduleId) {
      return request(
        '/api/modules/' + encodeURIComponent(moduleId) + '/records',
        {query: {mode: 'active', limit: 5000}}
      );
    },

    getMovementSummary(moduleId) {
      return request(
        '/api/modules/' + encodeURIComponent(moduleId) + '/movement-summary',
        {query: {mode: 'all'}}
      );
    },

    getReceivingFlow(moduleId) {
      return request(
        '/api/modules/' + encodeURIComponent(moduleId) + '/receiving-flow',
        {query: {mode: 'ACTIVE'}}
      );
    },

    getShiftDashboard(moduleId, options) {
      const config = options && typeof options === 'object' ? options : {};

      return request(
        '/api/modules/' + encodeURIComponent(moduleId) + '/shift-dashboard',
        {query: {date: config.date || ''}}
      );
    }
  });
})(window);
