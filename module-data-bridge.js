/**
 * module-data-bridge.js
 * ROUND 54 — Full Record Data Bridge
 *
 * เก็บผลลัพธ์ API.getRecords แบบครบชุด
 * เพื่อให้ SweetAlert และข้อมูลเสริมไม่ขึ้นกับการ์ด
 * ที่กำลังแสดงหลังค้นหา/กรองสถานะ
 */
(function (window, document) {
  'use strict';

  const state = {
    installed:
      false,

    installTimer:
      null,

    records:
      [],

    module:
      null,

    generatedAt:
      '',

    updatedAt:
      0,

    serverOffsetMs:
      0
  };


  installWhenReady();


  function installWhenReady() {
    const api =
      window.VehicleAPI;

    if (
      !api ||
      typeof api.getRecords !==
        'function'
    ) {
      state.installTimer =
        window.setTimeout(
          installWhenReady,
          30
        );

      return;
    }

    if (
      api.getRecords
        .__round54DataBridge
    ) {
      state.installed =
        true;

      return;
    }

    const original =
      api.getRecords.bind(
        api
      );

    const wrapped =
      async function (...args) {
        const result =
          await original(
            ...args
          );

        captureResult(
          result
        );

        return result;
      };

    wrapped.__round54DataBridge =
      true;

    wrapped.__originalGetRecords =
      original;

    api.getRecords =
      wrapped;

    state.installed =
      true;
  }


  function captureResult(
    result
  ) {
    if (
      !result ||
      typeof result !==
        'object'
    ) {
      return;
    }

    state.records =
      Array.isArray(
        result.records
      )
        ? result.records.slice()
        : [];

    state.module =
      result.module &&
      typeof result.module ===
        'object'
        ? {
            ...(
              state.module ||
              {}
            ),
            ...result.module
          }
        : state.module;

    state.generatedAt =
      String(
        result.generatedAt ||
        ''
      );

    state.updatedAt =
      Date.now();

    const generatedMs =
      parseDateTime(
        state.generatedAt
      );

    state.serverOffsetMs =
      Number.isFinite(
        generatedMs
      )
        ? generatedMs -
          Date.now()
        : 0;

    const detail = {
      count:
        state.records.length,

      generatedAt:
        state.generatedAt,

      updatedAt:
        state.updatedAt
    };

    document.dispatchEvent(
      new CustomEvent(
        'alertvendor:records-updated',
        {
          detail
        }
      )
    );

    window.dispatchEvent(
      new CustomEvent(
        'alertvendor:records-updated',
        {
          detail
        }
      )
    );
  }


  function parseDateTime(
    value
  ) {
    const text =
      String(
        value ||
        ''
      ).trim();

    const thaiMatch =
      text.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/
      );

    if (thaiMatch) {
      return new Date(
        Number(
          thaiMatch[3]
        ),
        Number(
          thaiMatch[2]
        ) - 1,
        Number(
          thaiMatch[1]
        ),
        Number(
          thaiMatch[4]
        ),
        Number(
          thaiMatch[5]
        ),
        Number(
          thaiMatch[6]
        )
      ).getTime();
    }

    const parsed =
      Date.parse(
        text
      );

    return Number.isFinite(
      parsed
    )
      ? parsed
      : NaN;
  }


  function getRecords() {
    return state.records.slice();
  }


  function getModule() {
    return state.module
      ? {
          ...state.module
        }
      : null;
  }


  function getNowMs() {
    return (
      Date.now() +
      Number(
        state.serverOffsetMs ||
        0
      )
    );
  }


  function getSnapshot() {
    return {
      records:
        getRecords(),

      module:
        getModule(),

      generatedAt:
        state.generatedAt,

      updatedAt:
        state.updatedAt,

      serverOffsetMs:
        state.serverOffsetMs
    };
  }


  window.AlertVendorRecordBridge = {
    getRecords,
    getModule,
    getNowMs,
    getSnapshot,

    isReady:
      () =>
        state.records.length > 0,

    get updatedAt() {
      return state.updatedAt;
    }
  };

})(window, document);
