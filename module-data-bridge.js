/**
 * module-data-bridge.js
 * PHASE 3A — Unified Operational Board Data Bridge
 *
 * แหล่งข้อมูลหลักของหน้า Module ต้องเป็น Operational Board เท่านั้น
 * ไฟล์นี้เก็บ Snapshot เต็มเพื่อให้ Detail/Controller อื่นอ่านข้อมูลชุดเดียวกัน
 */
(function (window, document) {
  'use strict';

  const state = {
    installed: false,
    installTimer: null,
    records: [],
    module: null,
    board: null,
    generatedAt: '',
    updatedAt: 0,
    serverOffsetMs: 0,
    source: 'NONE'
  };

  installWhenReady();

  function installWhenReady() {
    const api = window.VehicleAPI;

    if (!api) {
      state.installTimer = window.setTimeout(installWhenReady, 30);
      return;
    }

    wrapMethod(api, 'getOperationalBoard', 'OPERATIONAL_BOARD');

    /* Legacy capture only. Production page must not call this method. */
    wrapMethod(api, 'getRecords', 'LEGACY_RECORDS');

    state.installed = true;
  }

  function wrapMethod(api, methodName, sourceName) {
    const current = api && api[methodName];

    if (typeof current !== 'function' || current.__phase3aDataBridge) {
      return;
    }

    const original = current.bind(api);
    const wrapped = async function (...args) {
      const result = await original(...args);
      captureResult(result, sourceName);
      return result;
    };

    wrapped.__phase3aDataBridge = true;
    wrapped.__original = original;
    api[methodName] = wrapped;
  }

  function captureResult(result, sourceName) {
    if (!result || typeof result !== 'object') {
      return;
    }

    state.records = Array.isArray(result.records)
      ? result.records.slice()
      : [];

    state.module = result.module && typeof result.module === 'object'
      ? { ...(state.module || {}), ...result.module }
      : state.module;

    state.board = sourceName === 'OPERATIONAL_BOARD'
      ? result
      : state.board;

    state.generatedAt = String(result.generatedAt || '');
    state.updatedAt = Date.now();
    state.source = sourceName;

    const generatedMs = parseDateTime(state.generatedAt);
    state.serverOffsetMs = Number.isFinite(generatedMs)
      ? generatedMs - Date.now()
      : 0;

    const detail = {
      count: state.records.length,
      generatedAt: state.generatedAt,
      updatedAt: state.updatedAt,
      source: state.source,
      integrity: result.integrity || null,
      cached: result.cached === true
    };

    document.dispatchEvent(new CustomEvent('alertvendor:records-updated', { detail }));
    window.dispatchEvent(new CustomEvent('alertvendor:records-updated', { detail }));
  }

  function parseDateTime(value) {
    const text = String(value || '').trim();
    const thaiMatch = text.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/
    );

    if (thaiMatch) {
      return new Date(
        Number(thaiMatch[3]),
        Number(thaiMatch[2]) - 1,
        Number(thaiMatch[1]),
        Number(thaiMatch[4]),
        Number(thaiMatch[5]),
        Number(thaiMatch[6])
      ).getTime();
    }

    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function getRecords() {
    return state.records.slice();
  }

  function getModule() {
    return state.module ? { ...state.module } : null;
  }

  function getBoard() {
    return state.board || null;
  }

  function getNowMs() {
    return Date.now() + Number(state.serverOffsetMs || 0);
  }

  function getSnapshot() {
    return {
      records: getRecords(),
      module: getModule(),
      board: getBoard(),
      generatedAt: state.generatedAt,
      updatedAt: state.updatedAt,
      serverOffsetMs: state.serverOffsetMs,
      source: state.source
    };
  }

  window.AlertVendorRecordBridge = {
    getRecords,
    getModule,
    getBoard,
    getNowMs,
    getSnapshot,
    isReady: () => state.source === 'OPERATIONAL_BOARD',
    get updatedAt() { return state.updatedAt; },
    get source() { return state.source; }
  };

})(window, document);
