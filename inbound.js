/************************************************************
 * inbound.js
 * ROUND 03 — Inbound Role Landing Page
 *
 * รอบนี้ยังไม่เปิดกล้องสแกน
 * รอบถัดไปจะเพิ่ม Scanner + Lookup Auto ID
 ************************************************************/
(function (window, document) {
  'use strict';

  const CONFIG =
    window.APP_CONFIG || {};

  const API =
    window.VehicleAPI;

  const state = {
    clockTimer: null,
    session: null
  };

  document.addEventListener(
    'DOMContentLoaded',
    initialize
  );

  window.addEventListener(
    'beforeunload',
    destroy
  );

  async function initialize() {
    startClock();
    bindEvents();

    if (!API || typeof API.me !== 'function') {
      await showError(
        'เริ่มต้นระบบไม่สำเร็จ',
        'ไม่พบ api.js หรือ VehicleAPI.me'
      );
      return;
    }

    try {
      const session =
        await API.me();

      if (
        !session ||
        session.authenticated !== true
      ) {
        redirectToLogin();
        return;
      }

      state.session = session;
      const user = session.user || {};
      const role = normalizeRole(user.role);

      if (
        role !== 'INBOUND' &&
        role !== 'ADMIN'
      ) {
        await Swal.fire({
          icon: 'warning',
          title: 'ไม่มีสิทธิ์เข้าใช้งานห้อง Inbound',
          text: 'บัญชีนี้ไม่ใช่สิทธิ์ Inbound',
          confirmButtonText: 'กลับหน้าหลัก',
          allowOutsideClick: false
        });

        window.location.replace(
          CONFIG.DASHBOARD_URL || './index.html'
        );
        return;
      }

      setText(
        'inboundConnection',
        role === 'ADMIN'
          ? 'ADMIN TEST MODE'
          : 'INBOUND ONLINE'
      );

      setText(
        'inboundUser',
        (user.displayName || user.username || '-') +
        ' · ' +
        role
      );

    } catch (error) {
      if (isAuthError(error)) {
        redirectToLogin();
        return;
      }

      await showError(
        'เปิดหน้า Inbound ไม่สำเร็จ',
        error && error.message ? error.message : String(error)
      );
    }
  }

  function bindEvents() {
    document.getElementById(
      'inboundLogoutButton'
    )?.addEventListener(
      'click',
      logout
    );
  }

  async function logout() {
    try {
      if (API && typeof API.logout === 'function') {
        await API.logout();
      }
    } catch (error) {
      console.warn('ออกจากระบบไม่สำเร็จ', error);
    }

    redirectToLogin();
  }

  function startClock() {
    updateClock();
    state.clockTimer =
      window.setInterval(
        updateClock,
        1000
      );
  }

  function updateClock() {
    setText(
      'inboundDateTime',
      formatBangkokDateTime(
        new Date()
      )
    );
  }

  function formatBangkokDateTime(date) {
    const parts =
      new Intl.DateTimeFormat(
        'en-GB',
        {
          timeZone: 'Asia/Bangkok',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        }
      ).formatToParts(date);

    const map = {};
    parts.forEach((part) => {
      map[part.type] = part.value;
    });

    return [
      map.day,
      map.month,
      map.year
    ].join('/') +
      ' ' +
      [
        map.hour,
        map.minute,
        map.second
      ].join(':');
  }

  function normalizeRole(value) {
    const role =
      String(value || 'USER')
        .trim()
        .toUpperCase();

    if (role === 'ADMIN') return 'ADMIN';
    if (role === 'INBOUND') return 'INBOUND';
    return 'USER';
  }

  function setText(id, value) {
    const element =
      document.getElementById(id);

    if (element) {
      element.textContent =
        String(value || '');
    }
  }

  function redirectToLogin() {
    window.location.replace(
      CONFIG.LOGIN_URL || './login.html'
    );
  }

  function isAuthError(error) {
    return error && [
      'AUTH_REQUIRED',
      'INVALID_SESSION',
      'SESSION_EXPIRED',
      'INVALID_SESSION_SIGNATURE',
      'SESSION_VERSION_EXPIRED'
    ].includes(error.code);
  }

  async function showError(title, message) {
    if (window.Swal) {
      await Swal.fire({
        icon: 'error',
        title: title,
        text: message,
        confirmButtonText: 'ปิด'
      });
      return;
    }

    alert(title + '\n' + message);
  }

  function destroy() {
    if (state.clockTimer) {
      window.clearInterval(
        state.clockTimer
      );
      state.clockTimer = null;
    }
  }
})(window, document);
