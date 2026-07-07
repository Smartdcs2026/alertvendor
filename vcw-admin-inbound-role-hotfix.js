/*
 * vcw-admin-inbound-role-hotfix.js
 * VCW-R14D
 *
 * จุดประสงค์:
 * - เพิ่มตัวเลือก Role: INBOUND ในหน้า Admin/User Management
 * - ใช้แบบ drop-in ไม่ต้องแก้ admin.js เดิม
 * - เฝ้าดู modal/form ที่เปิดใหม่ แล้วเติม INBOUND ให้อัตโนมัติ
 */
(function (window, document) {
  'use strict';

  const BUILD = 'VCW-R14D';
  const INBOUND_VALUE = 'INBOUND';
  const INBOUND_LABEL = 'INBOUND';

  const ROLE_HINTS = [
    'role',
    'บทบาท',
    'สิทธิ์',
    'permission',
    'userrole',
    'user_role'
  ];

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  ready(function () {
    patchAll();
    startObserver();
    exposeApi();
  });

  function exposeApi() {
    window.VCWAdminInboundRoleHotfix = {
      version: BUILD,
      patch: patchAll
    };
  }

  function startObserver() {
    const observer = new MutationObserver(function () {
      patchAll();
    });

    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });

    window.setInterval(patchAll, 1500);
  }

  function patchAll() {
    patchRoleSelects();
    patchRoleDatalists();
    patchRoleInputs();
  }

  function patchRoleSelects() {
    document.querySelectorAll('select').forEach(function (select) {
      if (!isLikelyRoleControl(select)) return;

      ensureInboundOption(select);
    });
  }

  function patchRoleDatalists() {
    document.querySelectorAll('datalist').forEach(function (list) {
      if (!isLikelyRoleControl(list) && !containsRoleOptions(list)) return;

      if (!hasInboundOption(list)) {
        const option = document.createElement('option');
        option.value = INBOUND_VALUE;
        option.textContent = INBOUND_LABEL;
        list.appendChild(option);
        list.setAttribute('data-vcw-inbound-patched', BUILD);
      }
    });
  }

  function patchRoleInputs() {
    document.querySelectorAll('input').forEach(function (input) {
      const listId = input.getAttribute('list');
      if (!listId) return;

      const list = document.getElementById(listId);
      if (!list) return;

      if (isLikelyRoleControl(input) || containsRoleOptions(list)) {
        if (!hasInboundOption(list)) {
          const option = document.createElement('option');
          option.value = INBOUND_VALUE;
          option.textContent = INBOUND_LABEL;
          list.appendChild(option);
        }
      }
    });
  }

  function ensureInboundOption(select) {
    if (hasInboundOption(select)) {
      select.setAttribute('data-vcw-inbound-patched', BUILD);
      return;
    }

    const option = document.createElement('option');
    option.value = INBOUND_VALUE;
    option.textContent = INBOUND_LABEL;

    const adminOption = Array.from(select.options).find(function (opt) {
      return String(opt.value || opt.textContent || '').trim().toUpperCase() === 'ADMIN';
    });

    if (adminOption && adminOption.nextSibling) {
      select.insertBefore(option, adminOption.nextSibling);
    } else {
      select.appendChild(option);
    }

    select.setAttribute('data-vcw-inbound-patched', BUILD);
  }

  function hasInboundOption(control) {
    return Array.from(control.querySelectorAll('option')).some(function (opt) {
      const text = String(opt.value || opt.textContent || '').trim().toUpperCase();
      return text === INBOUND_VALUE;
    });
  }

  function containsRoleOptions(control) {
    const values = Array.from(control.querySelectorAll('option')).map(function (opt) {
      return String(opt.value || opt.textContent || '').trim().toUpperCase();
    });

    return values.indexOf('ADMIN') !== -1 && values.indexOf('USER') !== -1;
  }

  function isLikelyRoleControl(el) {
    const attrs = [
      el.id,
      el.name,
      el.className,
      el.getAttribute('aria-label'),
      el.getAttribute('placeholder'),
      el.getAttribute('data-field'),
      el.getAttribute('data-name'),
      el.getAttribute('data-role')
    ].join(' ').toLowerCase();

    if (ROLE_HINTS.some(function (hint) { return attrs.indexOf(hint.toLowerCase()) !== -1; })) {
      return true;
    }

    const label = findLabelText(el).toLowerCase();
    if (ROLE_HINTS.some(function (hint) { return label.indexOf(hint.toLowerCase()) !== -1; })) {
      return true;
    }

    if (el.tagName === 'SELECT' && containsRoleOptions(el)) {
      return true;
    }

    return false;
  }

  function findLabelText(el) {
    if (!el) return '';

    const id = el.id;
    if (id) {
      const label = document.querySelector('label[for="' + cssEscape(id) + '"]');
      if (label) return label.textContent || '';
    }

    const parentLabel = el.closest('label');
    if (parentLabel) return parentLabel.textContent || '';

    const row = el.closest('.form-row, .field, .input-row, .modal-row, div');
    if (row) {
      const label = row.querySelector('label, .label, .field-label');
      if (label) return label.textContent || '';
    }

    return '';
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }

    return String(value).replace(/"/g, '\\"');
  }
})(window, document);
