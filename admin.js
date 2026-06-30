================================================================================
admin.js
================================================================================
/**
 * admin.js
 * หน้า Admin สำหรับจัดการโมดูล Vendor ผู้ใช้งาน การตั้งค่า และ Audit
 *
 * ปรับปรุง:
 * - ตรวจข้อมูลโมดูลครบทุกข้อก่อนส่ง
 * - แสดงข้อผิดพลาดหลายรายการผ่าน SweetAlert2
 * - ป้องกันกดบันทึกโมดูลซ้ำ
 * - รองรับรายละเอียด Validation จาก Apps Script/Worker
 * - เลื่อนไปยังช่องที่ต้องแก้ไขโดยอัตโนมัติ
 * - รักษาการเลื่อนภายใน Module Editor
 * - รองรับตัวเลือก “อื่นๆ” และกรอกเวลา Auto Close เอง
 * - รองรับเวลา Auto Close แบบกำหนดเองตั้งแต่ 1–168 ชั่วโมง
 * - รองรับ CONCAT แบบกำหนดรูปแบบตำแหน่ง เช่น {1}{2} {3}
 * - ตรวจสอบรูปแบบ CONCAT ก่อนบันทึกเพื่อป้องกันค่าติดกันผิดรูปแบบ
 */
(function (window, document) {
  'use strict';

  const CONFIG = window.APP_CONFIG || {};
  const API = window.VehicleAPI;

  const state = {
    session: null,
    dashboard: null,
    schema: null,
    currentTab: 'overview',
    currentBundle: null,
    currentExpectedUpdatedAt: '',
    sourceMetadata: null,
    clockTimer: null,
    loading: false,
    moduleSaving: false
  };

  const LABELS = {
    moduleStatus: {
      DRAFT: 'ฉบับร่าง',
      ADMIN_ONLY: 'เฉพาะ Admin',
      PUBLISHED: 'เปิดใช้งาน'
    },

    operators: {
      EQUALS: 'เท่ากับ',
      NOT_EQUALS: 'ไม่เท่ากับ',
      CONTAINS: 'มีคำว่า',
      NOT_CONTAINS: 'ไม่มีคำว่า',
      STARTS_WITH: 'ขึ้นต้นด้วย',
      ENDS_WITH: 'ลงท้ายด้วย',
      IS_EMPTY: 'ว่าง',
      IS_NOT_EMPTY: 'ไม่ว่าง'
    },

    fieldTypes: {
      TEXT: 'ข้อความ',
      CONCAT: 'รวมหลายคอลัมน์',
      PHONE: 'เบอร์โทรศัพท์',
      DATE_TIME: 'วันที่และเวลา',
      NUMBER: 'ตัวเลข',
      DURATION: 'ระยะเวลา',
      STATUS: 'สถานะ'
    },

    fieldPositions: {
      HEADER: 'ส่วนหัว',
      BODY: 'เนื้อหาการ์ด',
      FOOTER: 'ส่วนท้าย',
      HIDDEN: 'ซ่อน'
    },

    roles: {
      ADMIN: 'ผู้ดูแลระบบ',
      USER: 'ผู้ใช้งาน'
    }
  };

  document.addEventListener('DOMContentLoaded', initializeAdminPage);

  async function initializeAdminPage() {
    if (!API || typeof Swal === 'undefined') {
      window.alert('ไม่พบไฟล์ระบบที่จำเป็น');
      return;
    }

    bindStaticEvents();
    startClock();
    showPageLoading(true);

    try {
      const session = await API.me();

      if (
        !session ||
        !session.authenticated ||
        !session.user ||
        session.user.role !== 'ADMIN'
      ) {
        throw createLocalError('ADMIN_REQUIRED', 'หน้านี้สำหรับผู้ดูแลระบบเท่านั้น');
      }

      state.session = session;
      setText(
        'adminCurrentUser',
        session.user.displayName || session.user.username || 'Admin'
      );

      const results = await Promise.all([
        API.getAdminUiSchema(),
        API.getAdminDashboard({ auditLimit: 30 })
      ]);

      state.schema = results[0];
      state.dashboard = results[1];

      renderAll();
    } catch (error) {
      showPageLoading(false);
      await handleFatalError(error);
      return;
    } finally {
      showPageLoading(false);
    }
  }

  function bindStaticEvents() {
    document.querySelectorAll('[data-admin-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        switchTab(button.dataset.adminTab || 'overview');
      });
    });

    document.querySelectorAll('[data-go-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        switchTab(button.dataset.goTab || 'overview');
      });
    });

    byId('adminRefreshButton')?.addEventListener('click', refreshDashboard);
    byId('adminLogoutButton')?.addEventListener('click', logout);
    byId('adminValidateQuickButton')?.addEventListener('click', validateSystem);
    byId('adminValidateSystemButton')?.addEventListener('click', validateSystem);
    byId('adminCreateModuleButton')?.addEventListener('click', createNewModule);
    byId('adminCreateUserButton')?.addEventListener('click', () =>
      openUserDialog(null)
    );
    byId('adminSettingsForm')?.addEventListener('submit', saveSettings);
    byId('adminSettingsFields')?.addEventListener(
      'change',
      handleAdminSettingFieldChange
    );
    byId('adminAuditFilterForm')?.addEventListener('submit', loadAuditFromFilter);

    byId('adminCloseModuleEditorButton')?.addEventListener('click', closeModuleEditor);
    byId('adminCancelModuleButton')?.addEventListener('click', closeModuleEditor);
    byId('adminEditorBackdrop')?.addEventListener('click', closeModuleEditor);
    byId('adminModuleForm')?.addEventListener('submit', saveModule);
    byId('adminAddFilterButton')?.addEventListener('click', () => addFilterRow());
    byId('adminAddFieldButton')?.addEventListener('click', () => addFieldRow());
    byId('adminInspectSourceButton')?.addEventListener('click', inspectSource);

    byId('adminModuleList')?.addEventListener('click', handleModuleListClick);
    byId('adminUserList')?.addEventListener('click', handleUserListClick);
    byId('adminFilterRows')?.addEventListener('click', handleDynamicRowClick);
    byId('adminFieldRows')?.addEventListener('click', handleDynamicRowClick);

    document.addEventListener('keydown', (event) => {
      if (
        event.key === 'Escape' &&
        !byId('adminModuleEditor')?.classList.contains('is-hidden')
      ) {
        closeModuleEditor();
      }
    });
  }

  function renderAll() {
    const dashboard = state.dashboard || {};

    setText(
      'adminGeneratedAt',
      dashboard.generatedAt
        ? 'โหลดข้อมูลล่าสุด ' + dashboard.generatedAt
        : 'โหลดข้อมูลแล้ว'
    );

    renderOverview();
    renderModules();
    renderUsers();
    renderSettings();
    renderAudit(dashboard.recentAudit || [], 'adminRecentAudit');
    renderAudit(dashboard.recentAudit || [], 'adminAuditList');
  }

  function renderOverview() {
    const dashboard = state.dashboard || {};
    const modules = Array.isArray(dashboard.modules) ? dashboard.modules : [];
    const users = Array.isArray(dashboard.users) ? dashboard.users : [];
    const structure = dashboard.structure || {};

    setText('adminModuleCount', String(modules.length));
    setText(
      'adminPublishedCount',
      String(modules.filter((item) => item.status === 'PUBLISHED').length)
    );
    setText('adminUserCount', String(users.length));
    setText('adminStructureStatus', structure.success ? 'พร้อม' : 'ต้องแก้ไข');

    const container = byId('adminStructureList');
    if (!container) return;

    const sheets = Array.isArray(structure.sheets) ? structure.sheets : [];

    if (sheets.length === 0) {
      container.innerHTML = emptyHtml('ไม่พบข้อมูลโครงสร้างระบบ');
      return;
    }

    container.innerHTML = sheets
      .map((item) => {
        const ok =
          item.exists && (!item.missingHeaders || item.missingHeaders.length === 0);
        const detail = !item.exists
          ? 'ไม่พบชีต'
          : item.missingHeaders && item.missingHeaders.length
            ? 'ขาด: ' + item.missingHeaders.join(', ')
            : Number(item.rowCount || 0) + ' แถวข้อมูล';

        return `
        <div class="admin-status-item" data-status="${ok ? 'OK' : 'ERROR'}">
          <span class="admin-status-dot"></span>
          <div>
            <strong>${escapeHtml(item.sheetName || '-')}</strong>
            <small>${escapeHtml(detail)}</small>
          </div>
        </div>
      `;
      })
      .join('');
  }

  function renderModules() {
    const container = byId('adminModuleList');
    if (!container) return;

    const modules = Array.isArray(state.dashboard?.modules)
      ? state.dashboard.modules
      : [];

    if (modules.length === 0) {
      container.innerHTML = emptyHtml(
        'ยังไม่มีโมดูล',
        'กด “สร้างโมดูลใหม่” เพื่อเพิ่ม Vendor หรือประเภทรถ'
      );
      return;
    }

    container.innerHTML = modules
      .map((item) => {
        const statusLabel = LABELS.moduleStatus[item.status] || item.status || '-';
        return `
        <article class="admin-module-card" data-module-id="${escapeHtml(item.moduleId)}">
          <div class="admin-module-card__head">
            <div>
              <span class="admin-badge" data-status="${escapeHtml(item.status || 'DRAFT')}">
                ${escapeHtml(statusLabel)}
              </span>
              <h3>${escapeHtml(item.name || item.moduleId || '-')}</h3>
              <p>${escapeHtml(item.description || 'ไม่มีคำอธิบาย')}</p>
            </div>
            <strong class="admin-module-card__id">${escapeHtml(item.moduleId || '-')}</strong>
          </div>

          <div class="admin-module-card__source">
            <span>แหล่งข้อมูล</span>
            <strong>${escapeHtml(item.sourceSheetName || '-')}</strong>
            <small>${escapeHtml(shortId(item.sourceSpreadsheetId || ''))}</small>
          </div>

          <div class="admin-module-card__stats">
            <div><span>เงื่อนไข</span><strong>${Number(item.filterCount || 0)}</strong></div>
            <div><span>ฟิลด์</span><strong>${Number(item.fieldCount || 0)}</strong></div>
            <div><span>สีส้ม</span><strong>${Number(item.warningStartMinutes || 0)} นาที</strong></div>
            <div><span>สีแดง</span><strong>${Number(item.redStartMinutes || 0)} นาที</strong></div>
          </div>

          <div class="admin-module-card__flags">
            ${flagHtml('User', item.showToUsers)}
            ${flagHtml('Alert', item.alertEnabled)}
            ${flagHtml('Checkout', item.checkoutEnabled)}
            ${flagHtml('Calendar', item.calendarEnabled)}
          </div>

          <div class="admin-module-card__meta">
            แก้ไข ${escapeHtml(item.updatedAt || '-')} โดย ${escapeHtml(item.updatedBy || '-')}
          </div>

          <div class="admin-module-card__actions">
            <button class="button button--primary button--compact" type="button" data-module-action="edit">
              แก้ไข
            </button>
            <button class="button button--secondary button--compact" type="button" data-module-action="duplicate">
              คัดลอก
            </button>
            <button class="button button--danger-ghost button--compact" type="button" data-module-action="archive">
              เก็บเป็นร่าง
            </button>
          </div>
        </article>
      `;
      })
      .join('');
  }

  function renderUsers() {
    const container = byId('adminUserList');
    if (!container) return;

    const users = Array.isArray(state.dashboard?.users) ? state.dashboard.users : [];

    if (users.length === 0) {
      container.innerHTML = emptyHtml('ยังไม่มีข้อมูลผู้ใช้งาน');
      return;
    }

    container.innerHTML = users
      .map(
        (user) => `
      <article class="admin-user-card" data-user-id="${escapeHtml(user.userId || '')}">
        <div class="admin-user-card__identity">
          <div class="admin-user-avatar">
            ${escapeHtml((user.displayName || user.username || '?').slice(0, 1).toUpperCase())}
          </div>
          <div>
            <h3>${escapeHtml(user.displayName || user.username || '-')}</h3>
            <span>${escapeHtml(user.username || '-')}</span>
          </div>
        </div>

        <div class="admin-user-card__badges">
          <span class="admin-badge" data-role="${escapeHtml(user.role || 'USER')}">
            ${escapeHtml(LABELS.roles[user.role] || user.role || '-')}
          </span>
          <span class="admin-badge" data-active="${user.active ? 'TRUE' : 'FALSE'}">
            ${user.active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
          </span>
          ${user.mustChangePassword ? '<span class="admin-badge" data-warning="TRUE">ต้องเปลี่ยนรหัส</span>' : ''}
          ${user.lockedAt ? '<span class="admin-badge" data-danger="TRUE">ถูกล็อก</span>' : ''}
        </div>

        <div class="admin-user-card__detail">
          <span>เข้าสู่ระบบล่าสุด <strong>${escapeHtml(user.lastLoginAt || '-')}</strong></span>
          <span>กรอกรหัสผิด <strong>${Number(user.failedLoginCount || 0)} ครั้ง</strong></span>
          <span>แก้ไขล่าสุด <strong>${escapeHtml(user.updatedAt || '-')}</strong></span>
        </div>

        <div class="admin-user-card__actions">
          <button class="button button--secondary button--compact" type="button" data-user-action="edit">
            แก้ไข
          </button>
          <button class="button button--secondary button--compact" type="button" data-user-action="reset-password">
            รีเซ็ตรหัสผ่าน
          </button>
          <button class="button button--secondary button--compact" type="button" data-user-action="unlock" ${user.lockedAt || Number(user.failedLoginCount || 0) > 0 ? '' : 'disabled'}>
            ปลดล็อก
          </button>
        </div>
      </article>
    `
      )
      .join('');
  }

  function renderSettings() {
    const container = byId('adminSettingsFields');
    if (!container) return;

    const settings = state.dashboard?.settings || {};
    const definitions = [
      {
        key: 'SYSTEM_NAME',
        label: 'ชื่อระบบ',
        type: 'text',
        help: 'ชื่อที่ใช้แสดงในระบบ'
      },
      {
        key: 'AUTO_CLOSE_HOURS',
        label: 'เวลาเคลียร์รายการอัตโนมัติ',
        type: 'select',
        help: 'ค่ากลางทุก Module สำหรับรายการที่ยังไม่มีเวลาออก',
        featured: true,
        options: [1, 4, 8, 12, 24, 36, 48, 72, 96, 120, 168],
        allowCustom: true,
        minimum: 1,
        maximum: 168
      },
      {
        key: 'DEFAULT_REFRESH_SECONDS',
        label: 'รีเฟรชเริ่มต้น (วินาที)',
        type: 'number',
        help: '10–3600 วินาที'
      },
      {
        key: 'SESSION_TIMEOUT_MINUTES',
        label: 'อายุ Session (นาที)',
        type: 'number',
        help: '15–10080 นาที'
      },
      {
        key: 'MAX_LOGIN_FAILURES',
        label: 'จำนวนครั้งรหัสผิดสูงสุด',
        type: 'number',
        help: 'ก่อนล็อกบัญชี'
      },
      {
        key: 'LOGIN_LOCK_MINUTES',
        label: 'ระยะเวลาล็อกบัญชี (นาที)',
        type: 'number',
        help: '1–1440 นาที'
      },
      {
        key: 'SWEETALERT_ENABLED',
        label: 'เปิด SweetAlert2',
        type: 'boolean',
        help: 'ใช้แจ้งเตือนทุกจุด'
      }
    ];

    container.innerHTML = definitions
      .map((definition) => {
        const key = definition.key;
        const current = settings[key]?.value;
        const updated = settings[key]?.updatedAt || '-';
        const updatedBy = settings[key]?.updatedBy || '-';
        const featuredClass = definition.featured
          ? ' admin-setting-item--featured'
          : '';

        if (definition.type === 'boolean') {
          return `
          <label class="admin-setting-item admin-setting-item--toggle${featuredClass}">
            <div>
              <strong>${escapeHtml(definition.label)}</strong>
              <small>${escapeHtml(definition.help)}</small>
              <em>แก้ไข ${escapeHtml(updated)} โดย ${escapeHtml(updatedBy)}</em>
            </div>
            <input
              type="checkbox"
              data-setting-key="${key}"
              ${toBoolean(current) ? 'checked' : ''}
            >
          </label>
        `;
        }

        if (definition.type === 'select') {
          const currentNumber = Number(current || 36);
          const options = Array.isArray(definition.options)
            ? definition.options.slice()
            : [];

          const isPresetValue = options.includes(currentNumber);

          const minimum = Number(definition.minimum || 1);

          const maximum = Number(definition.maximum || 168);

          return `
          <label class="admin-setting-item${featuredClass}">
            <span>${escapeHtml(definition.label)}</span>

            <select
              data-setting-key="${key}"
              data-setting-number="TRUE"
              data-setting-select-custom="${definition.allowCustom ? 'TRUE' : 'FALSE'}"
            >
              ${options
                .map(
                  (hours) => `
                <option
                  value="${Number(hours)}"
                  ${Number(hours) === currentNumber ? 'selected' : ''}
                >
                  ${Number(hours)} ชั่วโมง
                </option>
              `
                )
                .join('')}

              ${
                definition.allowCustom
                  ? `
                    <option
                      value="CUSTOM"
                      ${isPresetValue ? '' : 'selected'}
                    >
                      อื่นๆ — กำหนดเวลาเอง
                    </option>
                  `
                  : ''
              }
            </select>

            ${
              definition.allowCustom
                ? `
                  <div
                    class="admin-custom-time-control"
                    data-custom-setting-container="${key}"
                    data-active="${isPresetValue ? 'FALSE' : 'TRUE'}"
                  >
                    <span>
                      กำหนดจำนวนชั่วโมง
                    </span>

                    <div class="admin-custom-time-input">
                      <input
                        type="number"
                        inputmode="numeric"
                        min="${minimum}"
                        max="${maximum}"
                        step="1"
                        value="${escapeHtml(String(currentNumber))}"
                        data-setting-custom-for="${key}"
                        aria-label="กำหนดจำนวนชั่วโมงสำหรับ Auto Close"
                      >

                      <strong>
                        ชั่วโมง
                      </strong>
                    </div>

                    <small>
                      กรอกจำนวนเต็มตั้งแต่
                      ${minimum}–${maximum}
                      ชั่วโมง
                    </small>
                  </div>
                `
                : ''
            }

            <small>${escapeHtml(definition.help)}</small>

            <div class="admin-setting-impact">
              รายการที่ยังไม่มีเวลาออกจะถูกปิดเมื่อครบเวลาที่เลือก
            </div>

            <em>แก้ไข ${escapeHtml(updated)} โดย ${escapeHtml(updatedBy)}</em>
          </label>
        `;
        }

        return `
        <label class="admin-setting-item${featuredClass}">
          <span>${escapeHtml(definition.label)}</span>
          <input
            type="${definition.type}"
            data-setting-key="${key}"
            value="${escapeHtml(current ?? '')}"
          >
          <small>${escapeHtml(definition.help)}</small>
          <em>แก้ไข ${escapeHtml(updated)} โดย ${escapeHtml(updatedBy)}</em>
        </label>
      `;
      })
      .join('');

    syncAdminCustomSettingControls();
  }

  function handleAdminSettingFieldChange(event) {
    const select = event.target?.closest?.('[data-setting-select-custom="TRUE"]');

    if (!select) return;

    syncAdminCustomSettingControls(select);
  }

  function syncAdminCustomSettingControls(changedSelect) {
    const selects = changedSelect
      ? [changedSelect]
      : Array.from(document.querySelectorAll('[data-setting-select-custom="TRUE"]'));

    selects.forEach((select) => {
      const key = String(select.dataset.settingKey || '').trim();

      if (!key) return;

      const customContainer = document.querySelector(
        `[data-custom-setting-container="${cssEscape(key)}"]`
      );

      const customInput = document.querySelector(
        `[data-setting-custom-for="${cssEscape(key)}"]`
      );

      const isCustom = String(select.value || '').toUpperCase() === 'CUSTOM';

      if (customContainer) {
        customContainer.dataset.active = isCustom ? 'TRUE' : 'FALSE';
      }

      if (customInput) {
        customInput.disabled = !isCustom;

        if (isCustom) {
          window.setTimeout(() => {
            customInput.focus();
            customInput.select();
          }, 0);
        }
      }
    });
  }

  function renderAudit(items, containerId) {
    const container = byId(containerId);
    if (!container) return;

    const list = Array.isArray(items) ? items : [];

    if (list.length === 0) {
      container.innerHTML = emptyHtml('ไม่พบประวัติการทำรายการ');
      return;
    }

    container.innerHTML = list
      .map(
        (item) => `
      <article class="admin-audit-item" data-result="${escapeHtml(item.result || '')}">
        <div class="admin-audit-item__head">
          <strong>${escapeHtml(item.action || '-')}</strong>
          <span>${escapeHtml(item.timestamp || '-')}</span>
        </div>
        <div class="admin-audit-item__detail">
          <span>ผู้ใช้: <strong>${escapeHtml(item.username || '-')}</strong></span>
          <span>โมดูล: <strong>${escapeHtml(item.moduleId || '-')}</strong></span>
          <span>ผล: <strong>${escapeHtml(item.result || '-')}</strong></span>
        </div>
        <p>${escapeHtml(item.details || 'ไม่มีรายละเอียด')}</p>
        ${item.requestId ? `<small>Request ID: ${escapeHtml(item.requestId)}</small>` : ''}
      </article>
    `
      )
      .join('');
  }

  async function refreshDashboard() {
    if (state.loading) return;

    const button = byId('adminRefreshButton');
    setButtonLoading(button, true, 'กำลังรีเฟรช...');
    state.loading = true;

    try {
      state.dashboard = await API.getAdminDashboard({ auditLimit: 30 });
      renderAll();
      toast('รีเฟรชข้อมูลแล้ว', 'success');
    } catch (error) {
      await showApiError(error, 'รีเฟรชข้อมูลไม่สำเร็จ');
    } finally {
      state.loading = false;
      setButtonLoading(button, false);
    }
  }

  function switchTab(tab) {
    state.currentTab = tab;

    document.querySelectorAll('[data-admin-tab]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.adminTab === tab);
    });

    document.querySelectorAll('[data-admin-panel]').forEach((panel) => {
      panel.classList.toggle('is-hidden', panel.dataset.adminPanel !== tab);
    });

    if (tab === 'audit' && byId('adminAuditList')?.children.length === 0) {
      loadAudit({ limit: 50 });
    }
  }

  async function handleModuleListClick(event) {
    const actionButton = event.target.closest('[data-module-action]');
    if (!actionButton) return;

    const card = actionButton.closest('[data-module-id]');
    const moduleId = card?.dataset.moduleId || '';
    const action = actionButton.dataset.moduleAction;

    if (action === 'edit') {
      await editModule(moduleId);
    } else if (action === 'duplicate') {
      await duplicateModule(moduleId);
    } else if (action === 'archive') {
      await archiveModule(moduleId);
    }
  }

  async function createNewModule() {
    showLoading('กำลังเตรียมแบบฟอร์ม', 'กรุณารอสักครู่');

    try {
      const result = await API.getAdminNewModuleTemplate();
      Swal.close();
      openModuleEditor(result.bundle, result.expectedUpdatedAt || '', true);
    } catch (error) {
      Swal.close();
      await showApiError(error, 'เปิดแบบฟอร์มไม่สำเร็จ');
    }
  }

  async function editModule(moduleId) {
    showLoading('กำลังโหลดโมดูล', moduleId);

    try {
      const result = await API.getAdminModuleBundle(moduleId);
      Swal.close();
      openModuleEditor(result.bundle, result.expectedUpdatedAt || '', false);
    } catch (error) {
      Swal.close();
      await showApiError(error, 'โหลดโมดูลไม่สำเร็จ');
    }
  }

  function openModuleEditor(bundle, expectedUpdatedAt, isNew) {
    state.currentBundle = clone(bundle || {});
    state.currentExpectedUpdatedAt = expectedUpdatedAt || '';
    state.sourceMetadata = null;

    const module = bundle?.module || {};
    const filters = Array.isArray(bundle?.filters) ? bundle.filters : [];
    const fields = Array.isArray(bundle?.fields) ? bundle.fields : [];

    setValue('adminExpectedUpdatedAt', expectedUpdatedAt || '');
    setValue('adminModuleId', module.moduleId || '');
    setValue('adminModuleName', module.name || '');
    setValue('adminModuleDescription', module.description || '');
    setValue('adminModuleStatus', module.status || 'DRAFT');
    setValue('adminModuleDisplayOrder', module.displayOrder ?? 100);
    setValue('adminSourceSpreadsheetId', module.sourceSpreadsheetId || '');
    setValue('adminSourceSheetName', module.sourceSheetName || '');
    setValue('adminHeaderRow', module.headerRow ?? 1);
    setValue('adminTimestampInColumn', module.timestampInColumn || 'B');
    setValue('adminTimestampOutColumn', module.timestampOutColumn || '');
    setValue('adminDurationColumn', module.durationColumn || '');
    setValue('adminCheckoutUserColumn', module.checkoutUserColumn || '');
    setValue(
      'adminCurrentStatusMethod',
      module.currentStatusMethod || 'TIMESTAMP_OUT_EMPTY_AND_DURATION_EMPTY'
    );
    setValue('adminCustomStatusColumn', module.customStatusColumn || '');
    setValue('adminCustomStatusOperator', module.customStatusOperator || '');
    setValue('adminCustomStatusValue', module.customStatusValue || '');
    setValue('adminGreenStartMinutes', module.greenStartMinutes ?? 0);
    setValue('adminWarningStartMinutes', module.warningStartMinutes ?? 45);
    setValue('adminRedStartMinutes', module.redStartMinutes ?? 60);
    setValue('adminAlertRepeatMinutes', module.alertRepeatMinutes ?? 10);
    setValue('adminRefreshSeconds', module.refreshSeconds ?? 30);
    setValue('adminHistoryMonths', module.historyMonths ?? 12);
    setValue('adminCalendarGroupBy', module.calendarGroupBy || 'TIMESTAMP_IN');
    setValue('adminAfterCheckoutStatusColumn', module.afterCheckoutStatusColumn || '');
    setValue('adminAfterCheckoutStatusValue', module.afterCheckoutStatusValue || '');

    setChecked('adminAlertEnabled', module.alertEnabled !== false);
    setChecked('adminCheckoutEnabled', module.checkoutEnabled !== false);
    setChecked('adminShowToUsers', Boolean(module.showToUsers));
    setChecked('adminHistoryEnabled', module.historyEnabled !== false);
    setChecked('adminCalendarEnabled', module.calendarEnabled !== false);
    setChecked('adminShowCalendarToUsers', Boolean(module.showCalendarToUsers));
    setChecked('adminDailySummaryEnabled', module.dailySummaryEnabled !== false);
    setChecked('adminSoundEnabled', module.soundEnabled !== false);
    setChecked('adminVibrationEnabled', module.vibrationEnabled !== false);

    const moduleIdInput = byId('adminModuleId');
    if (moduleIdInput) moduleIdInput.disabled = !isNew;

    setText('adminModuleEditorTitle', isNew ? 'สร้างโมดูลใหม่' : 'แก้ไขโมดูล');
    setText(
      'adminModuleEditorStatus',
      isNew ? 'ยังไม่ได้บันทึก' : 'แก้ไขล่าสุด ' + (expectedUpdatedAt || '-')
    );
    setText('adminSourceInspectStatus', 'ยังไม่ได้ตรวจสอบแหล่งข้อมูล');

    byId('adminFilterRows').innerHTML = '';
    byId('adminFieldRows').innerHTML = '';

    filters.forEach(addFilterRow);
    fields.forEach(addFieldRow);

    if (fields.length === 0)
      addFieldRow({ primary: true, visible: true, searchable: true });

    updateDynamicCounts();

    byId('adminModuleEditor')?.classList.remove('is-hidden');
    document.body.classList.add('admin-editor-open');

    window.requestAnimationFrame(() => {
      const editorBody = byId('adminModuleForm');

      if (editorBody) {
        editorBody.scrollTop = 0;
      }

      const firstInput = byId('adminModuleId');

      if (isNew && firstInput && typeof firstInput.focus === 'function') {
        firstInput.focus({
          preventScroll: true
        });
      }
    });
  }

  function closeModuleEditor() {
    byId('adminModuleEditor')?.classList.add('is-hidden');
    document.body.classList.remove('admin-editor-open');
    state.currentBundle = null;
    state.sourceMetadata = null;
  }

  async function saveModule(event) {
    event.preventDefault();

    if (state.moduleSaving) {
      return;
    }

    const saveButton = byId('adminSaveModuleButton');

    let payload;
    let validation;

    try {
      payload = readModulePayload();

      validation = validateModulePayload(payload);
    } catch (error) {
      await showValidationErrors(collectErrorMessages(error), 'ข้อมูลโมดูลยังไม่ครบ');

      focusValidationTarget(error && error.focusTarget ? error.focusTarget : '');

      return;
    }

    if (validation.errors.length > 0) {
      await showValidationErrors(validation.errors, 'ข้อมูลโมดูลยังไม่ครบ');

      focusValidationTarget(validation.firstTarget);

      return;
    }

    const warningHtml = validation.warnings.length
      ? `
          <div class="admin-source-warning">
            <strong>คำเตือนก่อนบันทึก</strong>
            <ul class="admin-warning-list">
              ${validation.warnings
                .map((item) => `<li>${escapeHtml(item)}</li>`)
                .join('')}
            </ul>
          </div>
        `
      : '';

    const confirmation = await Swal.fire({
      icon: validation.warnings.length ? 'warning' : 'question',

      title: 'ยืนยันบันทึกโมดูล',

      html: `
          <div class="admin-confirm-box">
            <strong>${escapeHtml(payload.module.name)}</strong>
            <span>รหัส: ${escapeHtml(payload.module.moduleId)}</span>
            <span>
              ${payload.filters.length} เงื่อนไข
              •
              ${payload.fields.length} ฟิลด์
            </span>
          </div>
          ${warningHtml}
        `,

      showCancelButton: true,

      confirmButtonText: 'บันทึก',

      cancelButtonText: 'ยกเลิก',

      reverseButtons: true,

      focusCancel: validation.warnings.length > 0
    });

    if (!confirmation.isConfirmed) {
      return;
    }

    state.moduleSaving = true;

    setButtonLoading(saveButton, true, 'กำลังบันทึก...');

    showLoading('กำลังบันทึกโมดูล', 'ระบบกำลังตรวจสอบข้อมูลต้นทางและบันทึกทุกส่วน');

    try {
      const result = await API.saveAdminModuleBundle(payload);

      Swal.close();

      closeModuleEditor();

      const serverWarnings = Array.isArray(
        result && result.validation && result.validation.warnings
      )
        ? result.validation.warnings
        : [];

      await Swal.fire({
        icon: serverWarnings.length ? 'warning' : 'success',

        title: result.message || 'บันทึกโมดูลแล้ว',

        html: serverWarnings.length
          ? `
              <div class="swal-error-content">
                <div>
                  บันทึกสำเร็จ แต่มีคำเตือน
                </div>
                <ul class="admin-warning-list">
                  ${serverWarnings
                    .map((item) => `<li>${escapeHtml(item)}</li>`)
                    .join('')}
                </ul>
              </div>
            `
          : '',

        confirmButtonText: 'ตกลง'
      });

      await refreshDashboard();
    } catch (error) {
      Swal.close();

      await showApiError(error, 'บันทึกโมดูลไม่สำเร็จ');
    } finally {
      state.moduleSaving = false;

      setButtonLoading(saveButton, false);
    }
  }

  function readModulePayload() {
    const module = {
      moduleId: value('adminModuleId').toLowerCase(),
      name: value('adminModuleName'),
      description: value('adminModuleDescription'),
      status: value('adminModuleStatus'),
      sourceSpreadsheetId: extractSpreadsheetId(value('adminSourceSpreadsheetId')),
      sourceSheetName: value('adminSourceSheetName'),
      headerRow: numberValue('adminHeaderRow', 1),
      timestampInColumn: columnValue('adminTimestampInColumn'),
      timestampOutColumn: columnValue('adminTimestampOutColumn'),
      durationColumn: columnValue('adminDurationColumn'),
      currentStatusMethod: value('adminCurrentStatusMethod'),
      customStatusColumn: columnValue('adminCustomStatusColumn'),
      customStatusOperator: value('adminCustomStatusOperator'),
      customStatusValue: value('adminCustomStatusValue'),
      checkoutUserColumn: columnValue('adminCheckoutUserColumn'),
      afterCheckoutStatusColumn: columnValue('adminAfterCheckoutStatusColumn'),
      afterCheckoutStatusValue: value('adminAfterCheckoutStatusValue'),
      greenStartMinutes: numberValue('adminGreenStartMinutes', 0),
      warningStartMinutes: numberValue('adminWarningStartMinutes', 45),
      redStartMinutes: numberValue('adminRedStartMinutes', 60),
      alertEnabled: checked('adminAlertEnabled'),
      alertRepeatMinutes: numberValue('adminAlertRepeatMinutes', 10),
      refreshSeconds: numberValue('adminRefreshSeconds', 30),
      checkoutEnabled: checked('adminCheckoutEnabled'),
      showToUsers: checked('adminShowToUsers'),
      historyEnabled: checked('adminHistoryEnabled'),
      calendarEnabled: checked('adminCalendarEnabled'),
      showCalendarToUsers: checked('adminShowCalendarToUsers'),
      historyMonths: numberValue('adminHistoryMonths', 12),
      calendarGroupBy: value('adminCalendarGroupBy'),
      dailySummaryEnabled: checked('adminDailySummaryEnabled'),
      soundEnabled: checked('adminSoundEnabled'),
      vibrationEnabled: checked('adminVibrationEnabled'),
      displayOrder: numberValue('adminModuleDisplayOrder', 100)
    };

    const filters = Array.from(
      document.querySelectorAll('#adminFilterRows [data-filter-row]')
    ).map((row, index) => ({
      filterId: row.dataset.filterId || '',
      order: index + 1,
      column: normalizeColumn(row.querySelector('[data-filter-column]')?.value),
      operator: row.querySelector('[data-filter-operator]')?.value || 'EQUALS',
      value: String(row.querySelector('[data-filter-value]')?.value || '').trim(),
      connector: row.querySelector('[data-filter-connector]')?.value || 'AND',
      ignoreCase: Boolean(row.querySelector('[data-filter-ignore-case]')?.checked),
      trim: Boolean(row.querySelector('[data-filter-trim]')?.checked),
      active: Boolean(row.querySelector('[data-filter-active]')?.checked)
    }));

    const fields = Array.from(
      document.querySelectorAll('#adminFieldRows [data-field-row]')
    ).map((row, index) => ({
      fieldRowId: row.dataset.fieldRowId || '',
      fieldId: String(row.querySelector('[data-field-id]')?.value || '').trim(),
      displayName: String(row.querySelector('[data-field-name]')?.value || '').trim(),
      sourceColumns: String(row.querySelector('[data-field-columns]')?.value || '')
        .split(',')
        .map(normalizeColumn)
        .filter(Boolean)
        .filter(
          (column, columnIndex, columns) => columns.indexOf(column) === columnIndex
        ),
      type: row.querySelector('[data-field-type]')?.value || 'TEXT',
      separator: String(row.querySelector('[data-field-separator]')?.value || ''),
      position: row.querySelector('[data-field-position]')?.value || 'BODY',
      order: index + 1,
      visible: Boolean(row.querySelector('[data-field-visible]')?.checked),
      adminOnly: Boolean(row.querySelector('[data-field-admin-only]')?.checked),
      searchable: Boolean(row.querySelector('[data-field-searchable]')?.checked),
      primary: Boolean(row.querySelector('[data-field-primary]')?.checked)
    }));

    return {
      expectedUpdatedAt: value('adminExpectedUpdatedAt'),
      module,
      filters,
      fields
    };
  }

  function validateModulePayload(payload) {
    const module = payload && payload.module ? payload.module : {};

    const filters = Array.isArray(payload && payload.filters) ? payload.filters : [];

    const fields = Array.isArray(payload && payload.fields) ? payload.fields : [];

    const errors = [];
    const warnings = [];

    let firstTarget = '';

    const addError = (message, target) => {
      errors.push(String(message));

      if (!firstTarget && target) {
        firstTarget = target;
      }
    };

    const addWarning = (message) => {
      warnings.push(String(message));
    };

    const limits = state.schema && state.schema.limits ? state.schema.limits : {};

    const minRefreshSeconds = positiveInteger(limits.minRefreshSeconds, 10);

    const maxRefreshSeconds = positiveInteger(limits.maxRefreshSeconds, 3600);

    const maxHistoryMonths = positiveInteger(limits.maxHistoryMonths, 120);

    const maxFilters = positiveInteger(limits.maxFiltersPerModule, 50);

    const maxFields = positiveInteger(limits.maxFieldsPerModule, 50);

    if (!/^[a-z0-9][a-z0-9_-]{1,49}$/.test(module.moduleId || '')) {
      addError(
        'รหัสโมดูลต้องยาว 2–50 ตัว และใช้เฉพาะ a-z, 0-9, _ หรือ -',
        '#adminModuleId'
      );
    }

    if (!module.name) {
      addError('กรุณาระบุชื่อโมดูล', '#adminModuleName');
    }

    if (String(module.name || '').length > 200) {
      addError('ชื่อโมดูลต้องไม่เกิน 200 ตัวอักษร', '#adminModuleName');
    }

    if (String(module.description || '').length > 2000) {
      addError('คำอธิบายต้องไม่เกิน 2,000 ตัวอักษร', '#adminModuleDescription');
    }

    if (!/^[A-Za-z0-9_-]{20,}$/.test(module.sourceSpreadsheetId || '')) {
      addError(
        'กรุณาระบุ Google Spreadsheet ID ต้นทางให้ถูกต้อง',
        '#adminSourceSpreadsheetId'
      );
    }

    if (!module.sourceSheetName) {
      addError('กรุณาระบุชื่อชีตต้นทาง', '#adminSourceSheetName');
    }

    if (
      !Number.isInteger(module.headerRow) ||
      module.headerRow < 1 ||
      module.headerRow > 100
    ) {
      addError('แถวหัวตารางต้องเป็นจำนวนเต็มระหว่าง 1–100', '#adminHeaderRow');
    }

    if (!module.timestampInColumn) {
      addError('กรุณาระบุคอลัมน์เวลาเข้า', '#adminTimestampInColumn');
    }

    if (module.greenStartMinutes < 0) {
      addError('นาทีเริ่มสีเขียวต้องไม่น้อยกว่า 0', '#adminGreenStartMinutes');
    }

    if (module.warningStartMinutes < module.greenStartMinutes) {
      addError(
        'นาทีเริ่มสีส้มต้องไม่น้อยกว่านาทีเริ่มสีเขียว',
        '#adminWarningStartMinutes'
      );
    }

    if (module.redStartMinutes <= module.warningStartMinutes) {
      addError('นาทีเริ่มสีแดงต้องมากกว่านาทีเริ่มสีส้ม', '#adminRedStartMinutes');
    }

    if (
      module.alertEnabled &&
      (!Number.isInteger(module.alertRepeatMinutes) ||
        module.alertRepeatMinutes < 1 ||
        module.alertRepeatMinutes > 1440)
    ) {
      addError(
        'นาทีแจ้งเตือนซ้ำต้องอยู่ระหว่าง 1–1,440 นาที',
        '#adminAlertRepeatMinutes'
      );
    }

    if (
      !Number.isInteger(module.refreshSeconds) ||
      module.refreshSeconds < minRefreshSeconds ||
      module.refreshSeconds > maxRefreshSeconds
    ) {
      addError(
        `วินาทีรีเฟรชต้องอยู่ระหว่าง ${minRefreshSeconds}–${maxRefreshSeconds} วินาที`,
        '#adminRefreshSeconds'
      );
    }

    if (
      !Number.isInteger(module.historyMonths) ||
      module.historyMonths < 1 ||
      module.historyMonths > maxHistoryMonths
    ) {
      addError(
        `เดือนย้อนหลังต้องอยู่ระหว่าง 1–${maxHistoryMonths} เดือน`,
        '#adminHistoryMonths'
      );
    }

    if (
      !Number.isInteger(module.displayOrder) ||
      module.displayOrder < 1 ||
      module.displayOrder > 9999
    ) {
      addError('ลำดับแสดงต้องเป็นจำนวนเต็มระหว่าง 1–9,999', '#adminModuleDisplayOrder');
    }

    if (module.currentStatusMethod === 'TIMESTAMP_OUT_EMPTY_AND_DURATION_EMPTY') {
      if (!module.timestampOutColumn) {
        addError('วิธีตรวจสถานะนี้ต้องระบุคอลัมน์เวลาออก', '#adminTimestampOutColumn');
      }

      if (!module.durationColumn) {
        addError('วิธีตรวจสถานะนี้ต้องระบุคอลัมน์ระยะเวลา', '#adminDurationColumn');
      }
    }

    if (
      module.currentStatusMethod === 'TIMESTAMP_OUT_EMPTY' &&
      !module.timestampOutColumn
    ) {
      addError('วิธีตรวจสถานะนี้ต้องระบุคอลัมน์เวลาออก', '#adminTimestampOutColumn');
    }

    if (module.currentStatusMethod === 'CUSTOM') {
      if (!module.customStatusColumn) {
        addError('สถานะกำหนดเองต้องระบุคอลัมน์สถานะ', '#adminCustomStatusColumn');
      }

      if (!module.customStatusOperator) {
        addError('สถานะกำหนดเองต้องระบุตัวดำเนินการ', '#adminCustomStatusOperator');
      }

      if (
        module.customStatusOperator &&
        !['IS_EMPTY', 'IS_NOT_EMPTY'].includes(module.customStatusOperator) &&
        !module.customStatusValue
      ) {
        addError('สถานะกำหนดเองต้องระบุค่าที่ใช้ตรวจสอบ', '#adminCustomStatusValue');
      }
    }

    if (module.checkoutEnabled && !module.timestampOutColumn) {
      addError('เมื่อเปิดบันทึกออก ต้องระบุคอลัมน์เวลาออก', '#adminTimestampOutColumn');
    }

    if (module.checkoutEnabled && !module.durationColumn) {
      addError('เมื่อเปิดบันทึกออก ต้องระบุคอลัมน์ระยะเวลา', '#adminDurationColumn');
    }

    if (module.afterCheckoutStatusColumn && !module.afterCheckoutStatusValue) {
      addError(
        'เมื่อระบุคอลัมน์สถานะหลังออก ต้องระบุค่าสถานะหลังออก',
        '#adminAfterCheckoutStatusValue'
      );
    }

    if (module.afterCheckoutStatusValue && !module.afterCheckoutStatusColumn) {
      addError(
        'เมื่อระบุค่าสถานะหลังออก ต้องระบุคอลัมน์สถานะหลังออก',
        '#adminAfterCheckoutStatusColumn'
      );
    }

    const coreColumns = [
      ['คอลัมน์เวลาเข้า', module.timestampInColumn],
      ['คอลัมน์เวลาออก', module.timestampOutColumn],
      ['คอลัมน์ระยะเวลา', module.durationColumn]
    ].filter((item) => Boolean(item[1]));

    const duplicateCoreColumns = findDuplicateValues(
      coreColumns.map((item) => item[1])
    );

    if (duplicateCoreColumns.length > 0) {
      addError(
        'คอลัมน์เวลาเข้า เวลาออก และระยะเวลา ต้องไม่ใช้คอลัมน์เดียวกัน',
        '#adminTimestampInColumn'
      );
    }

    if (module.showCalendarToUsers && !module.calendarEnabled) {
      addError(
        'ต้องเปิดปฏิทินก่อน จึงจะแสดงปฏิทินแก่ User ได้',
        '#adminCalendarEnabled'
      );
    }

    if (module.status === 'PUBLISHED' && !module.showToUsers) {
      addWarning('สถานะเป็น “เปิดใช้งาน” แต่ยังปิดการแสดงแก่ User');
    }

    if (module.showToUsers && module.status === 'DRAFT') {
      addWarning(
        'เปิดแสดงแก่ User แล้ว แต่สถานะโมดูลยังเป็นฉบับร่าง จึงยังไม่แสดงในหน้าผู้ใช้'
      );
    }

    if (filters.length > maxFilters) {
      addError(`เงื่อนไขมีได้ไม่เกิน ${maxFilters} รายการ`, '#adminFilterRows');
    }

    const activeFilters = filters.filter((filter) => filter.active);

    if (activeFilters.length === 0) {
      addWarning('ยังไม่มีเงื่อนไขที่เปิดใช้งาน โมดูลจะอ่านข้อมูลทุกแถวจากชีตต้นทาง');
    }

    filters.forEach((filter, index) => {
      const rowSelector = `#adminFilterRows [data-filter-row]:nth-child(${index + 1})`;

      if (!filter.column) {
        addError(
          `เงื่อนไขที่ ${index + 1} ยังไม่ระบุคอลัมน์`,
          `${rowSelector} [data-filter-column]`
        );
      }

      if (!Object.prototype.hasOwnProperty.call(LABELS.operators, filter.operator)) {
        addError(
          `เงื่อนไขที่ ${index + 1} มีตัวดำเนินการไม่ถูกต้อง`,
          `${rowSelector} [data-filter-operator]`
        );
      }

      if (
        filter.active &&
        !['IS_EMPTY', 'IS_NOT_EMPTY'].includes(filter.operator) &&
        !filter.value
      ) {
        addError(
          `เงื่อนไขที่ ${index + 1} ยังไม่ระบุค่าที่ใช้กรอง`,
          `${rowSelector} [data-filter-value]`
        );
      }

      if (!['AND', 'OR'].includes(filter.connector)) {
        addError(
          `เงื่อนไขที่ ${index + 1} มีตัวเชื่อมไม่ถูกต้อง`,
          `${rowSelector} [data-filter-connector]`
        );
      }
    });

    if (fields.length > maxFields) {
      addError(`ฟิลด์มีได้ไม่เกิน ${maxFields} รายการ`, '#adminFieldRows');
    }

    if (fields.length === 0) {
      addError('ต้องมีฟิลด์แสดงผลอย่างน้อย 1 รายการ', '#adminFieldRows');
    }

    const fieldIds = fields.map((field) => String(field.fieldId || '').toLowerCase());

    const duplicateFieldIds = findDuplicateValues(fieldIds.filter(Boolean));

    if (duplicateFieldIds.length > 0) {
      addError('พบรหัสฟิลด์ซ้ำ: ' + duplicateFieldIds.join(', '), '#adminFieldRows');
    }

    const visibleFields = fields.filter(
      (field) => field.visible && field.position !== 'HIDDEN'
    );

    if (visibleFields.length === 0) {
      addError('ต้องเปิดแสดงผลอย่างน้อย 1 ฟิลด์', '#adminFieldRows');
    }

    const primaryFields = fields.filter(
      (field) => field.primary && field.visible && field.position !== 'HIDDEN'
    );

    if (primaryFields.length !== 1) {
      addError(
        'ต้องกำหนดฟิลด์ข้อมูลหลักที่แสดงบนหัวการ์ดจำนวน 1 รายการเท่านั้น',
        '#adminFieldRows'
      );
    }

    if (
      primaryFields.length === 1 &&
      primaryFields[0].adminOnly &&
      module.showToUsers
    ) {
      addError(
        'ฟิลด์ข้อมูลหลักต้องไม่เป็นข้อมูลเฉพาะ Admin เมื่อโมดูลแสดงแก่ User',
        '#adminFieldRows'
      );
    }

    fields.forEach((field, index) => {
      const rowSelector = `#adminFieldRows [data-field-row]:nth-child(${index + 1})`;

      if (!field.fieldId) {
        addError(
          `ฟิลด์ที่ ${index + 1} ยังไม่ระบุรหัสฟิลด์`,
          `${rowSelector} [data-field-id]`
        );
      }

      if (!field.displayName) {
        addError(
          `ฟิลด์ที่ ${index + 1} ยังไม่ระบุชื่อที่แสดง`,
          `${rowSelector} [data-field-name]`
        );
      }

      if (field.sourceColumns.length === 0) {
        addError(
          `ฟิลด์ที่ ${index + 1} ยังไม่ระบุคอลัมน์ต้นทาง`,
          `${rowSelector} [data-field-columns]`
        );
      }

      if (field.type !== 'CONCAT' && field.sourceColumns.length > 1) {
        addError(
          `ฟิลด์ “${field.displayName || index + 1}” ใช้หลายคอลัมน์ ต้องเลือกประเภท “รวมหลายคอลัมน์”`,
          `${rowSelector} [data-field-type]`
        );
      }

      if (!Object.prototype.hasOwnProperty.call(LABELS.fieldTypes, field.type)) {
        addError(
          `ฟิลด์ที่ ${index + 1} มีประเภทข้อมูลไม่ถูกต้อง`,
          `${rowSelector} [data-field-type]`
        );
      }

      if (field.type === 'CONCAT') {
        const concatFormat = String(field.separator ?? '');

        if (concatFormat.length > 120) {
          addError(
            `ฟิลด์ “${field.displayName || index + 1}” กำหนดตัวคั่น/รูปแบบได้ไม่เกิน 120 ตัวอักษร`,
            `${rowSelector} [data-field-separator]`
          );
        }

        const hasAnyBrace = /[{}]/.test(concatFormat);

        const placeholderMatches = Array.from(concatFormat.matchAll(/\{(\d+)\}/g));

        const formatRemainder = concatFormat.replace(/\{\d+\}/g, '');

        if (
          hasAnyBrace &&
          (placeholderMatches.length === 0 || /[{}]/.test(formatRemainder))
        ) {
          addError(
            `ฟิลด์ “${field.displayName || index + 1}” มีรูปแบบ CONCAT ไม่ถูกต้อง กรุณาใช้รูปแบบ เช่น {1}{2} {3}`,
            `${rowSelector} [data-field-separator]`
          );
        }

        if (placeholderMatches.length > 0) {
          const invalidPlaceholder = placeholderMatches.find((match) => {
            const position = Number(match[1]);

            return (
              !Number.isInteger(position) ||
              position < 1 ||
              position > field.sourceColumns.length
            );
          });

          if (invalidPlaceholder) {
            addError(
              `ฟิลด์ “${field.displayName || index + 1}” อ้างตำแหน่ง ${invalidPlaceholder[0]} แต่มีคอลัมน์ต้นทางเพียง ${field.sourceColumns.length} คอลัมน์`,
              `${rowSelector} [data-field-separator]`
            );
          }

          const referencedPositions = new Set(
            placeholderMatches.map((match) => Number(match[1]))
          );

          const missingPositions = field.sourceColumns
            .map((column, columnIndex) => columnIndex + 1)
            .filter((position) => !referencedPositions.has(position));

          if (missingPositions.length > 0) {
            addWarning(
              `ฟิลด์ “${field.displayName || index + 1}” ยังไม่ได้ใช้ตำแหน่ง ${missingPositions.map((position) => `{${position}}`).join(', ')} ในรูปแบบ CONCAT`
            );
          }
        }
      }

      if (
        !Object.prototype.hasOwnProperty.call(LABELS.fieldPositions, field.position)
      ) {
        addError(
          `ฟิลด์ที่ ${index + 1} มีตำแหน่งแสดงไม่ถูกต้อง`,
          `${rowSelector} [data-field-position]`
        );
      }

      if (field.primary && (!field.visible || field.position === 'HIDDEN')) {
        addError(
          `ฟิลด์ข้อมูลหลักลำดับ ${index + 1} ต้องเปิดแสดงผลและห้ามอยู่ในตำแหน่งซ่อน`,
          `${rowSelector} [data-field-visible]`
        );
      }
    });

    return {
      valid: errors.length === 0,

      errors,
      warnings,
      firstTarget
    };
  }

  async function inspectSource() {
    const spreadsheetId = extractSpreadsheetId(value('adminSourceSpreadsheetId'));
    const sheetName = value('adminSourceSheetName');
    const headerRow = numberValue('adminHeaderRow', 1);

    if (!spreadsheetId) {
      await warning('กรุณาระบุ Spreadsheet ID ต้นทาง');
      return;
    }

    const button = byId('adminInspectSourceButton');
    setButtonLoading(button, true, 'กำลังตรวจสอบ...');

    try {
      if (!sheetName) {
        const result = await API.inspectAdminSource({ spreadsheetId });
        populateSheetOptions(result.sheets || []);
        setText(
          'adminSourceInspectStatus',
          `พบ ${result.sheets?.length || 0} ชีตใน ${result.spreadsheetName || 'Spreadsheet'}`
        );

        await Swal.fire({
          icon: 'success',
          title: 'อ่านรายชื่อชีตแล้ว',
          html: createSheetListHtml(result.sheets || []),
          confirmButtonText: 'ปิด',
          didOpen: () => {
            document.querySelectorAll('[data-select-sheet]').forEach((sheetButton) => {
              sheetButton.addEventListener('click', () => {
                setValue('adminSourceSheetName', sheetButton.dataset.selectSheet || '');
                Swal.close();
              });
            });
          }
        });
        return;
      }

      const result = await API.inspectAdminSource({
        spreadsheetId,
        sheetName,
        headerRow,
        sampleRows: 3
      });

      state.sourceMetadata = result;
      populateColumnOptions(result.headers || []);
      setText(
        'adminSourceInspectStatus',
        `ตรวจแล้ว ${result.lastRow || 0} แถว • ${result.lastColumn || 0} คอลัมน์ • ${result.checkedAt || ''}`
      );

      await Swal.fire({
        icon: result.duplicateHeaders?.length ? 'warning' : 'success',
        title: 'ตรวจสอบแหล่งข้อมูลสำเร็จ',
        html: createSourceMetadataHtml(result),
        confirmButtonText: 'ตกลง',
        width: 900
      });
    } catch (error) {
      await showApiError(error, 'ตรวจสอบแหล่งข้อมูลไม่สำเร็จ');
    } finally {
      setButtonLoading(button, false);
    }
  }

  function populateSheetOptions(sheets) {
    const datalist = byId('adminSourceSheetOptions');
    if (!datalist) return;
    datalist.innerHTML = sheets
      .map(
        (sheet) =>
          `<option value="${escapeHtml(sheet.name || '')}">${Number(sheet.rowCount || 0)} แถว</option>`
      )
      .join('');
  }

  function populateColumnOptions(headers) {
    const datalist = byId('adminSourceColumnOptions');
    if (!datalist) return;
    datalist.innerHTML = headers
      .map(
        (item) =>
          `<option value="${escapeHtml(item.column || '')}">${escapeHtml(item.header || '(ไม่มีหัวคอลัมน์)')}</option>`
      )
      .join('');
  }

  function addFilterRow(filter = {}) {
    const container = byId('adminFilterRows');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'admin-dynamic-row admin-filter-row';
    row.dataset.filterRow = 'true';
    row.dataset.filterId = filter.filterId || '';

    row.innerHTML = `
      <div class="admin-dynamic-row__number"></div>
      <label><span>คอลัมน์</span><input data-filter-column list="adminSourceColumnOptions" maxlength="3" value="${escapeHtml(filter.column || '')}"></label>
      <label><span>ตัวดำเนินการ</span><select data-filter-operator>${operatorOptions(filter.operator || 'EQUALS')}</select></label>
      <label class="admin-dynamic-row__wide"><span>ค่าที่ใช้กรอง</span><input data-filter-value value="${escapeHtml(filter.value || '')}"></label>
      <label><span>เชื่อมด้วย</span><select data-filter-connector><option value="AND" ${filter.connector !== 'OR' ? 'selected' : ''}>AND</option><option value="OR" ${filter.connector === 'OR' ? 'selected' : ''}>OR</option></select></label>
      <div class="admin-dynamic-checks">
        ${miniCheck('ไม่สนตัวพิมพ์', 'data-filter-ignore-case', filter.ignoreCase !== false)}
        ${miniCheck('ตัดช่องว่าง', 'data-filter-trim', filter.trim !== false)}
        ${miniCheck('ใช้งาน', 'data-filter-active', filter.active !== false)}
      </div>
      <button class="admin-remove-row" type="button" data-remove-row>ลบ</button>
    `;

    container.appendChild(row);
    updateDynamicCounts();
  }

  function addFieldRow(field = {}) {
    const container = byId('adminFieldRows');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'admin-dynamic-row admin-field-row';
    row.dataset.fieldRow = 'true';
    row.dataset.fieldRowId = field.fieldRowId || '';

    row.innerHTML = `
      <div class="admin-dynamic-row__number"></div>
      <label><span>รหัสฟิลด์</span><input data-field-id maxlength="100" value="${escapeHtml(field.fieldId || '')}"></label>
      <label><span>ชื่อที่แสดง</span><input data-field-name maxlength="150" value="${escapeHtml(field.displayName || '')}"></label>
      <label class="admin-dynamic-row__wide"><span>คอลัมน์ต้นทาง (คั่นด้วย ,)</span><input data-field-columns list="adminSourceColumnOptions" value="${escapeHtml((field.sourceColumns || []).join(','))}"></label>
      <label><span>ประเภท</span><select data-field-type>${fieldTypeOptions(field.type || 'TEXT')}</select></label>
      <label><span>ตำแหน่ง</span><select data-field-position>${fieldPositionOptions(field.position || 'BODY')}</select></label>
      <label class="admin-field-format-control">
        <span data-field-separator-label>ตัวคั่น / รูปแบบการรวม</span>
        <input
          data-field-separator
          maxlength="120"
          placeholder="เช่น {1}{2} {3}"
          value="${escapeHtml(field.separator ?? ' ')}"
        >
        <small data-field-format-help>
          CONCAT: ใช้ตัวคั่นธรรมดา หรือรูปแบบตำแหน่ง เช่น {1}{2} {3}
        </small>
      </label>
      <div class="admin-dynamic-checks">
        ${miniCheck('แสดงผล', 'data-field-visible', field.visible !== false)}
        ${miniCheck('เฉพาะ Admin', 'data-field-admin-only', Boolean(field.adminOnly))}
        ${miniCheck('ค้นหาได้', 'data-field-searchable', field.searchable !== false)}
        ${miniCheck('ข้อมูลหลัก', 'data-field-primary', Boolean(field.primary))}
      </div>
      <button class="admin-remove-row" type="button" data-remove-row>ลบ</button>
    `;

    const primaryCheckbox = row.querySelector('[data-field-primary]');

    const visibleCheckbox = row.querySelector('[data-field-visible]');

    const positionSelect = row.querySelector('[data-field-position]');

    const typeSelect = row.querySelector('[data-field-type]');

    typeSelect?.addEventListener('change', () => {
      syncFieldFormatControl(row);
    });

    primaryCheckbox?.addEventListener('change', (event) => {
      if (!event.target.checked) {
        return;
      }

      document
        .querySelectorAll('#adminFieldRows [data-field-primary]')
        .forEach((checkbox) => {
          if (checkbox !== event.target) {
            checkbox.checked = false;
          }
        });

      if (visibleCheckbox) {
        visibleCheckbox.checked = true;
      }

      if (positionSelect && positionSelect.value === 'HIDDEN') {
        positionSelect.value = 'HEADER';
      }
    });

    positionSelect?.addEventListener('change', () => {
      if (positionSelect.value !== 'HIDDEN') {
        return;
      }

      if (visibleCheckbox) {
        visibleCheckbox.checked = false;
      }

      if (primaryCheckbox) {
        primaryCheckbox.checked = false;
      }
    });

    visibleCheckbox?.addEventListener('change', () => {
      if (visibleCheckbox.checked) {
        return;
      }

      if (primaryCheckbox) {
        primaryCheckbox.checked = false;
      }
    });

    container.appendChild(row);

    syncFieldFormatControl(row);

    updateDynamicCounts();
  }

  /**
   * ปรับช่องตัวคั่น/รูปแบบให้สอดคล้องกับประเภทฟิลด์
   *
   * CONCAT รองรับ 2 รูปแบบ:
   * 1. ตัวคั่นแบบเดิม เช่น เว้นวรรค, -, /
   * 2. รูปแบบตำแหน่ง เช่น {1}{2} {3}
   *
   * @param {HTMLElement} row
   */
  function syncFieldFormatControl(row) {
    if (!row) {
      return;
    }

    const typeSelect = row.querySelector('[data-field-type]');

    const separatorInput = row.querySelector('[data-field-separator]');

    const separatorLabel = row.querySelector('[data-field-separator-label]');

    const formatHelp = row.querySelector('[data-field-format-help]');

    if (!separatorInput) {
      return;
    }

    const isConcat =
      String((typeSelect && typeSelect.value) || '').toUpperCase() === 'CONCAT';

    separatorInput.disabled = !isConcat;

    separatorInput.placeholder = isConcat ? 'เช่น {1}{2} {3}' : 'ใช้เฉพาะประเภท CONCAT';

    if (separatorLabel) {
      separatorLabel.textContent = isConcat
        ? 'ตัวคั่น / รูปแบบการรวม'
        : 'ตัวคั่น (ใช้กับ CONCAT)';
    }

    if (formatHelp) {
      formatHelp.textContent = isConcat
        ? 'ตัวคั่นธรรมดา: เว้นวรรค หรือ -  |  รูปแบบตำแหน่ง: {1}{2} {3}'
        : 'ช่องนี้จะทำงานเมื่อเลือกประเภท “รวมหลายคอลัมน์”';
    }
  }

  function handleDynamicRowClick(event) {
    const button = event.target.closest('[data-remove-row]');
    if (!button) return;
    button.closest('.admin-dynamic-row')?.remove();
    updateDynamicCounts();
  }

  function updateDynamicCounts() {
    document
      .querySelectorAll('#adminFilterRows [data-filter-row]')
      .forEach((row, index) => {
        const number = row.querySelector('.admin-dynamic-row__number');
        if (number) number.textContent = String(index + 1);
      });

    document
      .querySelectorAll('#adminFieldRows [data-field-row]')
      .forEach((row, index) => {
        const number = row.querySelector('.admin-dynamic-row__number');
        if (number) number.textContent = String(index + 1);
      });

    setText(
      'adminFilterCount',
      document.querySelectorAll('#adminFilterRows [data-filter-row]').length +
        ' เงื่อนไข'
    );
    setText(
      'adminFieldCount',
      document.querySelectorAll('#adminFieldRows [data-field-row]').length + ' ฟิลด์'
    );
  }

  async function duplicateModule(moduleId) {
    const result = await Swal.fire({
      icon: 'question',
      title: 'คัดลอกโมดูล',
      html: `
        <div class="swal-form">
          <label class="swal-form-field"><span>รหัสโมดูลใหม่</span><input id="duplicateModuleId" class="swal2-input" placeholder="vendor-new"></label>
          <label class="swal-form-field"><span>ชื่อโมดูลใหม่</span><input id="duplicateModuleName" class="swal2-input" placeholder="สถานะรถ Vendor ใหม่"></label>
          <label class="swal-form-field"><span>คำอธิบาย</span><input id="duplicateModuleDescription" class="swal2-input" placeholder="ไม่บังคับ"></label>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'คัดลอก',
      cancelButtonText: 'ยกเลิก',
      reverseButtons: true,
      focusConfirm: false,
      preConfirm: () => {
        const newModuleId = String(byId('duplicateModuleId')?.value || '')
          .trim()
          .toLowerCase();
        const newModuleName = String(byId('duplicateModuleName')?.value || '').trim();
        const description = String(
          byId('duplicateModuleDescription')?.value || ''
        ).trim();

        if (!/^[a-z0-9][a-z0-9_-]{1,49}$/.test(newModuleId)) {
          Swal.showValidationMessage('รหัสโมดูลใหม่ไม่ถูกต้อง');
          return false;
        }
        if (!newModuleName) {
          Swal.showValidationMessage('กรุณาระบุชื่อโมดูลใหม่');
          return false;
        }
        return { sourceModuleId: moduleId, newModuleId, newModuleName, description };
      }
    });

    if (!result.isConfirmed) return;
    showLoading('กำลังคัดลอกโมดูล', 'โมดูลใหม่จะเริ่มเป็นฉบับร่าง');

    try {
      const response = await API.duplicateAdminModule(result.value);
      Swal.close();
      await success(response.message || 'คัดลอกโมดูลแล้ว');
      await refreshDashboard();
    } catch (error) {
      Swal.close();
      await showApiError(error, 'คัดลอกโมดูลไม่สำเร็จ');
    }
  }

  async function archiveModule(moduleId) {
    const confirmation = await Swal.fire({
      icon: 'warning',
      title: 'เก็บโมดูลเป็นฉบับร่าง?',
      text: 'โมดูลจะไม่แสดงแก่ผู้ใช้ แต่ข้อมูลและการตั้งค่าจะไม่ถูกลบ',
      showCancelButton: true,
      confirmButtonText: 'เก็บเป็นร่าง',
      cancelButtonText: 'ยกเลิก',
      reverseButtons: true
    });

    if (!confirmation.isConfirmed) return;
    showLoading('กำลังปรับสถานะโมดูล', moduleId);

    try {
      const response = await API.archiveAdminModule(moduleId);
      Swal.close();
      await success(response.message || 'เก็บโมดูลเป็นฉบับร่างแล้ว');
      await refreshDashboard();
    } catch (error) {
      Swal.close();
      await showApiError(error, 'ปรับสถานะโมดูลไม่สำเร็จ');
    }
  }

  async function handleUserListClick(event) {
    const button = event.target.closest('[data-user-action]');
    if (!button) return;

    const card = button.closest('[data-user-id]');
    const userId = card?.dataset.userId || '';
    const user = (state.dashboard?.users || []).find((item) => item.userId === userId);
    if (!user) return;

    if (button.dataset.userAction === 'edit') {
      await openUserDialog(user);
    } else if (button.dataset.userAction === 'reset-password') {
      await resetUserPassword(user);
    } else if (button.dataset.userAction === 'unlock') {
      await unlockUser(user);
    }
  }

  async function openUserDialog(user) {
    const isEdit = Boolean(user);
    const generatedPassword = generateTemporaryPassword();

    const result = await Swal.fire({
      width: 650,
      title: isEdit ? 'แก้ไขผู้ใช้งาน' : 'สร้างผู้ใช้งาน',
      html: `
        <div class="swal-form">
          <label class="swal-form-field"><span>ชื่อผู้ใช้</span><input id="userUsername" class="swal2-input" value="${escapeHtml(user?.username || '')}" ${isEdit ? 'disabled' : ''}></label>
          <label class="swal-form-field"><span>ชื่อแสดงผล</span><input id="userDisplayName" class="swal2-input" value="${escapeHtml(user?.displayName || '')}"></label>
          <label class="swal-form-field"><span>สิทธิ์</span><select id="userRole" class="swal2-select"><option value="USER" ${user?.role !== 'ADMIN' ? 'selected' : ''}>USER</option><option value="ADMIN" ${user?.role === 'ADMIN' ? 'selected' : ''}>ADMIN</option></select></label>
          ${!isEdit ? `<label class="swal-form-field"><span>รหัสผ่านชั่วคราว</span><input id="userTemporaryPassword" class="swal2-input" value="${escapeHtml(generatedPassword)}"></label>` : ''}
          <label class="swal-switch-row"><input id="userActive" type="checkbox" ${user?.active !== false ? 'checked' : ''}><span>เปิดใช้งานบัญชี</span></label>
          <label class="swal-switch-row"><input id="userMustChange" type="checkbox" ${user?.mustChangePassword !== false ? 'checked' : ''}><span>บังคับเปลี่ยนรหัสผ่าน</span></label>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'บันทึก',
      cancelButtonText: 'ยกเลิก',
      reverseButtons: true,
      focusConfirm: false,
      preConfirm: () => {
        const payload = {
          userId: user?.userId || '',
          username: String(byId('userUsername')?.value || '')
            .trim()
            .toLowerCase(),
          displayName: String(byId('userDisplayName')?.value || '').trim(),
          role: byId('userRole')?.value || 'USER',
          active: Boolean(byId('userActive')?.checked),
          mustChangePassword: Boolean(byId('userMustChange')?.checked)
        };

        if (!isEdit)
          payload.temporaryPassword = String(
            byId('userTemporaryPassword')?.value || ''
          );
        if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(payload.username)) {
          Swal.showValidationMessage(
            'ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัว และใช้ a-z, 0-9, ., _, -'
          );
          return false;
        }
        if (!payload.displayName) {
          Swal.showValidationMessage('กรุณาระบุชื่อแสดงผล');
          return false;
        }
        if (!isEdit && !validatePassword(payload.temporaryPassword, payload.username)) {
          Swal.showValidationMessage(
            'รหัสผ่านต้องยาวอย่างน้อย 10 ตัว มีตัวอักษรและตัวเลข และไม่มีชื่อผู้ใช้'
          );
          return false;
        }
        return payload;
      }
    });

    if (!result.isConfirmed) return;
    showLoading('กำลังบันทึกผู้ใช้งาน', 'กรุณารอสักครู่');

    try {
      const response = await API.saveAdminUser(result.value);
      Swal.close();
      await success(response.message || 'บันทึกผู้ใช้งานแล้ว');
      await refreshDashboard();
    } catch (error) {
      Swal.close();
      await showApiError(error, 'บันทึกผู้ใช้งานไม่สำเร็จ');
    }
  }

  async function resetUserPassword(user) {
    const suggested = generateTemporaryPassword();

    const result = await Swal.fire({
      icon: 'warning',
      title: 'รีเซ็ตรหัสผ่าน',
      html: `
        <div class="swal-form">
          <div class="admin-confirm-box"><strong>${escapeHtml(user.displayName || user.username)}</strong><span>${escapeHtml(user.username)}</span></div>
          <label class="swal-form-field"><span>รหัสผ่านใหม่</span><input id="resetPasswordValue" class="swal2-input" value="${escapeHtml(suggested)}"></label>
          <label class="swal-switch-row"><input id="resetMustChange" type="checkbox" checked><span>บังคับเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบ</span></label>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'รีเซ็ตรหัสผ่าน',
      cancelButtonText: 'ยกเลิก',
      reverseButtons: true,
      focusConfirm: false,
      preConfirm: () => {
        const newPassword = String(byId('resetPasswordValue')?.value || '');
        if (!validatePassword(newPassword, user.username)) {
          Swal.showValidationMessage(
            'รหัสผ่านต้องยาวอย่างน้อย 10 ตัว มีตัวอักษรและตัวเลข และไม่มีชื่อผู้ใช้'
          );
          return false;
        }
        return {
          userId: user.userId,
          newPassword,
          mustChangePassword: Boolean(byId('resetMustChange')?.checked)
        };
      }
    });

    if (!result.isConfirmed) return;
    showLoading('กำลังรีเซ็ตรหัสผ่าน', 'กรุณารอสักครู่');

    try {
      const response = await API.resetAdminUserPassword(result.value);
      Swal.close();
      await Swal.fire({
        icon: 'success',
        title: response.message || 'รีเซ็ตรหัสผ่านแล้ว',
        html: `<div class="admin-password-result"><span>รหัสผ่านใหม่</span><strong>${escapeHtml(result.value.newPassword)}</strong><small>คัดลอกและส่งให้ผู้ใช้งานผ่านช่องทางที่ปลอดภัย</small></div>`,
        confirmButtonText: 'ปิด',
        allowOutsideClick: false
      });
      await refreshDashboard();
    } catch (error) {
      Swal.close();
      await showApiError(error, 'รีเซ็ตรหัสผ่านไม่สำเร็จ');
    }
  }

  async function unlockUser(user) {
    const confirmation = await Swal.fire({
      icon: 'question',
      title: 'ปลดล็อกบัญชี?',
      text: user.displayName || user.username,
      showCancelButton: true,
      confirmButtonText: 'ปลดล็อก',
      cancelButtonText: 'ยกเลิก',
      reverseButtons: true
    });

    if (!confirmation.isConfirmed) return;
    showLoading('กำลังปลดล็อกบัญชี', 'กรุณารอสักครู่');

    try {
      const response = await API.unlockAdminUser(user.userId);
      Swal.close();
      await success(response.message || 'ปลดล็อกบัญชีแล้ว');
      await refreshDashboard();
    } catch (error) {
      Swal.close();
      await showApiError(error, 'ปลดล็อกบัญชีไม่สำเร็จ');
    }
  }

  async function saveSettings(event) {
    event.preventDefault();

    const settings = {};

    document.querySelectorAll('[data-setting-key]').forEach((input) => {
      const key = input.dataset.settingKey;

      if (
        input.dataset.settingSelectCustom === 'TRUE' &&
        String(input.value || '').toUpperCase() === 'CUSTOM'
      ) {
        const customInput = document.querySelector(
          `[data-setting-custom-for="${cssEscape(key)}"]`
        );

        settings[key] = Number(customInput?.value);

        return;
      }

      if (input.type === 'checkbox') {
        settings[key] = input.checked;
      } else if (input.type === 'number' || input.dataset.settingNumber === 'TRUE') {
        settings[key] = Number(input.value);
      } else {
        settings[key] = String(input.value || '').trim();
      }
    });

    const autoCloseHours = Number(settings.AUTO_CLOSE_HOURS);

    if (
      !Number.isInteger(autoCloseHours) ||
      autoCloseHours < 1 ||
      autoCloseHours > 168
    ) {
      const select = document.querySelector('[data-setting-key="AUTO_CLOSE_HOURS"]');

      const customInput = document.querySelector(
        '[data-setting-custom-for="AUTO_CLOSE_HOURS"]'
      );

      if (select) {
        select.value = 'CUSTOM';
        syncAdminCustomSettingControls(select);
      }

      await Swal.fire({
        icon: 'warning',
        title: 'เวลาที่กำหนดไม่ถูกต้อง',
        text: 'กรุณากรอกจำนวนเต็มตั้งแต่ 1 ถึง 168 ชั่วโมง',
        confirmButtonText: 'แก้ไข'
      });

      customInput?.focus();
      customInput?.select();
      return;
    }

    const currentAutoCloseHours = Number(
      state.dashboard?.settings?.AUTO_CLOSE_HOURS?.value || 36
    );

    const nextAutoCloseHours = Number(
      settings.AUTO_CLOSE_HOURS || currentAutoCloseHours
    );

    const autoCloseChanged =
      Number.isFinite(nextAutoCloseHours) &&
      nextAutoCloseHours !== currentAutoCloseHours;

    const impactMessage = autoCloseChanged
      ? `
        <div class="admin-setting-confirm">
          <div>
            <span>ค่าปัจจุบัน</span>
            <strong>${escapeHtml(String(currentAutoCloseHours))} ชั่วโมง</strong>
          </div>
          <div>
            <span>ค่าใหม่</span>
            <strong>${escapeHtml(String(nextAutoCloseHours))} ชั่วโมง</strong>
          </div>
        </div>
        <p class="admin-setting-confirm-note">
          ${
            nextAutoCloseHours < currentAutoCloseHours
              ? 'รายการที่ยังไม่มีเวลาออกและมีอายุเกินค่าใหม่ อาจถูกเคลียร์ในรอบทำงานถัดไป'
              : 'ค่าใหม่จะใช้กับทุก Module ในการตรวจรอบถัดไป'
          }
        </p>
      `
      : '<p>ค่าที่แก้ไขจะมีผลกับผู้ใช้งานทั้งหมด</p>';

    const confirmation = await Swal.fire({
      icon: autoCloseChanged ? 'warning' : 'question',
      title: 'บันทึกการตั้งค่าระบบ?',
      html: impactMessage,
      showCancelButton: true,
      confirmButtonText: 'บันทึก',
      cancelButtonText: 'ยกเลิก',
      reverseButtons: true
    });

    if (!confirmation.isConfirmed) return;

    showLoading('กำลังบันทึกการตั้งค่า', 'กรุณารอสักครู่');

    try {
      const response = await API.saveAdminSettings(settings);
      Swal.close();

      await success(response.message || 'บันทึกการตั้งค่าแล้ว');

      await refreshDashboard();
    } catch (error) {
      Swal.close();
      await showApiError(error, 'บันทึกการตั้งค่าไม่สำเร็จ');
    }
  }

  async function loadAuditFromFilter(event) {
    event.preventDefault();
    await loadAudit({
      username: value('adminAuditUsername'),
      moduleId: value('adminAuditModuleId'),
      action: value('adminAuditAction'),
      limit: numberValue('adminAuditLimit', 50)
    });
  }

  async function loadAudit(options) {
    const container = byId('adminAuditList');
    if (container) container.innerHTML = loadingHtml('กำลังโหลดประวัติ');

    try {
      const list = await API.getAdminAudit(options || {});
      renderAudit(list, 'adminAuditList');
    } catch (error) {
      if (container)
        container.innerHTML = emptyHtml(
          'โหลดประวัติไม่สำเร็จ',
          buildErrorMessage(error)
        );
      await showApiError(error, 'โหลดประวัติไม่สำเร็จ');
    }
  }

  async function validateSystem() {
    const button = byId('adminValidateSystemButton');

    const quickButton = byId('adminValidateQuickButton');

    setButtonLoading(button, true, 'กำลังตรวจสอบ...');

    setButtonLoading(quickButton, true, 'กำลังตรวจสอบ...');

    showLoading(
      'กำลังตรวจสอบระบบทั้งหมด',
      'กำลังตรวจ Frontend, Worker, Apps Script และแหล่งข้อมูล กรุณารอสักครู่'
    );

    try {
      const client =
        typeof API.getClientDiagnostics === 'function'
          ? API.getClientDiagnostics()
          : null;

      const result =
        typeof API.runProductionDiagnostics === 'function'
          ? await API.runProductionDiagnostics({
              includeReadProbe: true
            })
          : await API.validateAdminSystem();

      if (client) {
        result.client = client;

        result.checks = [
          buildClientDiagnosticCheck(client),
          ...(Array.isArray(result.checks) ? result.checks : [])
        ];

        result.summary = summarizeDiagnostics(result.checks);

        result.success = result.summary.failed === 0;
      }

      Swal.close();

      renderValidation(result);

      switchTab('system');

      const status =
        result && result.summary
          ? result.summary.status
          : result.success
            ? 'READY'
            : 'NOT_READY';

      await Swal.fire({
        icon:
          status === 'READY'
            ? 'success'
            : status === 'READY_WITH_WARNINGS'
              ? 'warning'
              : 'error',

        title:
          status === 'READY'
            ? 'ระบบพร้อมใช้งาน'
            : status === 'READY_WITH_WARNINGS'
              ? 'ระบบใช้งานได้ แต่มีคำเตือน'
              : 'พบรายการที่ต้องแก้ไข',

        text:
          status === 'READY'
            ? 'ทุกชั้นของระบบผ่านการตรวจสอบ'
            : 'ดูรายละเอียดในแท็บตรวจระบบ',

        confirmButtonText: 'ตกลง'
      });
    } catch (error) {
      Swal.close();

      await showApiError(error, 'ตรวจสอบระบบไม่สำเร็จ');
    } finally {
      setButtonLoading(button, false);

      setButtonLoading(quickButton, false);
    }
  }

  function buildClientDiagnosticCheck(client) {
    const valid =
      client && client.online && client.storageAvailable && client.sessionTokenPresent;

    return {
      id: 'frontend-client',

      group: 'Frontend',

      label: 'ตรวจเว็บและ Session ในเบราว์เซอร์',

      status: valid ? 'PASS' : 'FAIL',

      message: valid
        ? 'Frontend เชื่อมต่ออินเทอร์เน็ตและพบ Session Token'
        : 'Frontend หรือ Session ในเบราว์เซอร์ไม่พร้อมใช้งาน',

      durationMs: 0,

      details: client || {}
    };
  }

  function summarizeDiagnostics(checks) {
    const list = Array.isArray(checks) ? checks : [];

    const passed = list.filter((item) => item.status === 'PASS').length;

    const warnings = list.filter((item) => item.status === 'WARN').length;

    const failed = list.filter((item) => item.status === 'FAIL').length;

    return {
      total: list.length,

      passed,

      warnings,

      failed,

      status: failed > 0 ? 'NOT_READY' : warnings > 0 ? 'READY_WITH_WARNINGS' : 'READY'
    };
  }

  function renderValidation(result) {
    const container = byId('adminValidationResult');

    if (!container) {
      return;
    }

    const checks = Array.isArray(result && result.checks) ? result.checks : [];

    const summary =
      result && result.summary ? result.summary : summarizeDiagnostics(checks);

    const statusLabel =
      summary.status === 'READY'
        ? 'พร้อมใช้งาน'
        : summary.status === 'READY_WITH_WARNINGS'
          ? 'พร้อมใช้ มีคำเตือน'
          : 'ต้องแก้ไข';

    setText('adminDiagnosticStatus', statusLabel);

    setText('adminDiagnosticPassed', String(summary.passed || 0));

    setText('adminDiagnosticWarnings', String(summary.warnings || 0));

    setText('adminDiagnosticFailed', String(summary.failed || 0));

    const groupedChecks = checks.reduce((groups, check) => {
      const groupName = String(check.group || 'ระบบ');

      if (!groups[groupName]) {
        groups[groupName] = [];
      }

      groups[groupName].push(check);

      return groups;
    }, {});

    const checksHtml = Object.entries(groupedChecks)
      .map(
        ([groupName, groupChecks]) => `
            <section class="admin-card admin-diagnostic-group">
              <h3>${escapeHtml(groupName)}</h3>

              <div class="admin-diagnostic-checks">
                ${groupChecks
                  .map(
                    (check) => `
                  <article
                    class="admin-diagnostic-check"
                    data-status="${escapeHtml(check.status || 'FAIL')}"
                  >
                    <div class="admin-diagnostic-check__head">
                      <strong>${escapeHtml(check.label || check.id || '-')}</strong>
                      <span>${diagnosticStatusText(check.status)}</span>
                    </div>

                    <p>${escapeHtml(check.message || '-')}</p>

                    ${
                      Number.isFinite(Number(check.durationMs))
                        ? `<small>ใช้เวลา ${escapeHtml(String(check.durationMs))} ms</small>`
                        : ''
                    }
                  </article>
                `
                  )
                  .join('')}
              </div>
            </section>
          `
      )
      .join('');

    const validation =
      result && result.validation
        ? result.validation
        : result && result.appsScript && result.appsScript.validation
          ? result.appsScript.validation
          : result;

    const structureSheets = Array.isArray(
      validation && validation.structure && validation.structure.sheets
    )
      ? validation.structure.sheets
      : [];

    const modules = Array.isArray(validation && validation.modules)
      ? validation.modules
      : [];

    const structureHtml = structureSheets
      .map((item) => {
        const valid =
          item.exists && (!item.missingHeaders || item.missingHeaders.length === 0);

        return `
            <div
              class="admin-validation-item"
              data-valid="${valid ? 'TRUE' : 'FALSE'}"
            >
              <strong>${escapeHtml(item.sheetName || '-')}</strong>
              <span>${
                valid
                  ? 'พร้อมใช้งาน'
                  : !item.exists
                    ? 'ไม่พบชีต'
                    : 'ขาดหัวคอลัมน์: ' + item.missingHeaders.join(', ')
              }</span>
            </div>
          `;
      })
      .join('');

    const moduleHtml = modules
      .map(
        (item) => `
          <article
            class="admin-validation-module"
            data-valid="${item.valid ? 'TRUE' : 'FALSE'}"
          >
            <div>
              <strong>${escapeHtml(item.moduleId || '-')}</strong>
              <span>${item.valid ? 'ผ่านการตรวจสอบ' : 'ต้องแก้ไข'}</span>
            </div>

            ${
              (item.errors || []).length
                ? `<ul>${item.errors.map((errorText) => `<li>${escapeHtml(errorText)}</li>`).join('')}</ul>`
                : ''
            }

            ${
              (item.warnings || []).length
                ? `<ul class="admin-warning-list">${item.warnings.map((warningText) => `<li>${escapeHtml(warningText)}</li>`).join('')}</ul>`
                : ''
            }
          </article>
        `
      )
      .join('');

    container.innerHTML = `
      <div
        class="admin-validation-head"
        data-valid="${summary.failed === 0 ? 'TRUE' : 'FALSE'}"
      >
        <strong>${escapeHtml(statusLabel)}</strong>
        <span>
          ตรวจล่าสุด ${escapeHtml(result.checkedAt || '-')}
          • ${escapeHtml(String(result.durationMs || 0))} ms
        </span>
      </div>

      ${checksHtml || emptyHtml('ไม่พบผลการตรวจแต่ละชั้น')}

      <section class="admin-card">
        <h3>โครงสร้างชีตหลังบ้าน</h3>
        <div class="admin-validation-grid">
          ${structureHtml || emptyHtml('ไม่พบข้อมูลโครงสร้างชีต')}
        </div>
      </section>

      <section class="admin-card">
        <h3>โมดูลทั้งหมด</h3>
        <div class="admin-validation-modules">
          ${moduleHtml || emptyHtml('ยังไม่มีโมดูล')}
        </div>
      </section>
    `;
  }

  function diagnosticStatusText(status) {
    if (status === 'PASS') {
      return 'ผ่าน';
    }

    if (status === 'WARN') {
      return 'คำเตือน';
    }

    return 'ไม่ผ่าน';
  }

  async function logout() {
    const confirmation = await Swal.fire({
      icon: 'question',
      title: 'ออกจากระบบ?',
      showCancelButton: true,
      confirmButtonText: 'ออกจากระบบ',
      cancelButtonText: 'ยกเลิก',
      reverseButtons: true
    });

    if (!confirmation.isConfirmed) return;

    try {
      await API.logout();
    } catch (error) {
      console.warn(error);
    }

    window.location.replace(CONFIG.LOGIN_URL || './login.html');
  }

  async function handleFatalError(error) {
    const isAuth =
      error &&
      (error.status === 401 ||
        ['AUTH_REQUIRED', 'SESSION_EXPIRED', 'INVALID_SESSION'].includes(error.code));

    await Swal.fire({
      icon: 'error',
      title: isAuth ? 'กรุณาเข้าสู่ระบบ' : 'เปิดหน้าหลังบ้านไม่สำเร็จ',
      text: buildErrorMessage(error),
      confirmButtonText: isAuth ? 'ไปหน้าเข้าสู่ระบบ' : 'กลับหน้าหลัก',
      allowOutsideClick: false
    });

    window.location.replace(
      isAuth
        ? CONFIG.LOGIN_URL || './login.html'
        : CONFIG.DASHBOARD_URL || './index.html'
    );
  }

  function startClock() {
    updateClock();
    state.clockTimer = window.setInterval(updateClock, 1000);
  }

  function updateClock() {
    setText('adminCurrentDateTime', formatBangkokDateTime(new Date()));
  }

  function formatBangkokDateTime(date) {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: CONFIG.TIMEZONE || 'Asia/Bangkok',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });

    const parts = {};
    formatter.formatToParts(date).forEach((part) => {
      parts[part.type] = part.value;
    });

    return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
  }

  function operatorOptions(selected) {
    return Object.entries(LABELS.operators)
      .map(
        ([value, label]) =>
          `<option value="${value}" ${selected === value ? 'selected' : ''}>${escapeHtml(label)}</option>`
      )
      .join('');
  }

  function fieldTypeOptions(selected) {
    return Object.entries(LABELS.fieldTypes)
      .map(
        ([value, label]) =>
          `<option value="${value}" ${selected === value ? 'selected' : ''}>${escapeHtml(label)}</option>`
      )
      .join('');
  }

  function fieldPositionOptions(selected) {
    return Object.entries(LABELS.fieldPositions)
      .map(
        ([value, label]) =>
          `<option value="${value}" ${selected === value ? 'selected' : ''}>${escapeHtml(label)}</option>`
      )
      .join('');
  }

  function miniCheck(label, attribute, checkedValue) {
    return `<label><input type="checkbox" ${attribute} ${checkedValue ? 'checked' : ''}><span>${escapeHtml(label)}</span></label>`;
  }

  function flagHtml(label, enabled) {
    return `<span data-enabled="${enabled ? 'TRUE' : 'FALSE'}">${escapeHtml(label)}</span>`;
  }

  function createSheetListHtml(sheets) {
    if (!sheets.length) return '<div class="daily-empty">ไม่พบชีต</div>';
    return `<div class="admin-sheet-list">${sheets
      .map(
        (sheet) => `
      <button type="button" data-select-sheet="${escapeHtml(sheet.name || '')}">
        <strong>${escapeHtml(sheet.name || '-')}</strong>
        <span>${Number(sheet.rowCount || 0)} แถว • ${Number(sheet.columnCount || 0)} คอลัมน์</span>
      </button>
    `
      )
      .join('')}</div>`;
  }

  function createSourceMetadataHtml(result) {
    const headers = Array.isArray(result.headers) ? result.headers : [];
    const samples = Array.isArray(result.samples) ? result.samples : [];

    return `
      <div class="admin-source-result">
        <div class="admin-source-summary">
          <span>Spreadsheet: <strong>${escapeHtml(result.spreadsheetName || '-')}</strong></span>
          <span>ชีต: <strong>${escapeHtml(result.sheetName || '-')}</strong></span>
          <span>ข้อมูล: <strong>${Number(result.lastRow || 0)} แถว / ${Number(result.lastColumn || 0)} คอลัมน์</strong></span>
        </div>
        ${result.duplicateHeaders?.length ? `<div class="admin-source-warning">พบหัวคอลัมน์ซ้ำ: ${escapeHtml(result.duplicateHeaders.join(', '))}</div>` : ''}
        <div class="admin-source-columns">
          ${headers.map((item) => `<span><strong>${escapeHtml(item.column)}</strong>${escapeHtml(item.header || '(ว่าง)')}</span>`).join('')}
        </div>
        ${
          samples.length
            ? `<div class="admin-source-samples">${samples
                .map(
                  (sample) =>
                    `<div><strong>แถว ${sample.rowNumber}</strong><span>${escapeHtml(
                      Object.entries(sample.values || {})
                        .slice(0, 8)
                        .map(([column, text]) => `${column}: ${text}`)
                        .join(' | ')
                    )}</span></div>`
                )
                .join('')}</div>`
            : ''
        }
      </div>
    `;
  }

  function showLoading(title, text) {
    Swal.fire({
      title,
      text: text || '',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => Swal.showLoading()
    });
  }

  function toast(message, icon = 'success') {
    return Swal.fire({
      toast: true,
      position: 'top-end',
      icon,
      title: message,
      showConfirmButton: false,
      timer: 1800,
      timerProgressBar: true
    });
  }

  function success(message) {
    return Swal.fire({
      icon: 'success',
      title: message,
      confirmButtonText: 'ตกลง'
    });
  }

  function warning(message) {
    return Swal.fire({
      icon: 'warning',

      title: 'ข้อมูลยังไม่ครบ',

      text: message,

      confirmButtonText: 'ตกลง'
    });
  }

  function showValidationErrors(messages, title) {
    const list = Array.isArray(messages)
      ? messages.map((item) => String(item || '').trim()).filter(Boolean)
      : [];

    return Swal.fire({
      icon: 'warning',

      title: title || 'ข้อมูลยังไม่ครบ',

      html: list.length
        ? `
            <div class="swal-error-content">
              <ul class="admin-error-list">
                ${list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
              </ul>
            </div>
          `
        : '',

      confirmButtonText: 'ตกลง',

      width: 680
    });
  }

  function showApiError(error, title) {
    const messages = collectErrorMessages(error);

    const warnings = collectErrorWarnings(error);

    const requestId = String(
      (error &&
        (error.requestId ||
          error.details?.upstreamRequestId ||
          error.details?.requestId)) ||
        ''
    ).trim();

    const detailsHtml = messages.length
      ? `
          <ul class="admin-error-list">
            ${messages.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        `
      : '';

    const warningsHtml = warnings.length
      ? `
          <div class="admin-source-warning">
            <strong>คำเตือน</strong>
            <ul class="admin-warning-list">
              ${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
            </ul>
          </div>
        `
      : '';

    const requestIdHtml = requestId
      ? `
          <div class="request-id">
            รหัสอ้างอิง:
            ${escapeHtml(requestId)}
          </div>
        `
      : '';

    return Swal.fire({
      icon: 'error',

      title: title || 'เกิดข้อผิดพลาด',

      html: `
        <div class="swal-error-content">
          <div>
            ${escapeHtml(buildErrorMessage(error))}
          </div>
          ${detailsHtml}
          ${warningsHtml}
          ${requestIdHtml}
        </div>
      `,

      confirmButtonText: 'ตกลง',

      width: 720
    });
  }

  function collectErrorMessages(error) {
    const candidates = [
      error && error.details && error.details.errors,

      error &&
        error.details &&
        error.details.validation &&
        error.details.validation.errors,

      error &&
        error.details &&
        error.details.upstreamDetails &&
        error.details.upstreamDetails.errors,

      error && error.details && error.details.details && error.details.details.errors,

      error && error.errors
    ];

    const result = [];

    candidates.forEach((candidate) => {
      if (!Array.isArray(candidate)) {
        return;
      }

      candidate.forEach((item) => {
        const text = String(item || '').trim();

        if (text && !result.includes(text)) {
          result.push(text);
        }
      });
    });

    if (result.length === 0 && error && error.message) {
      result.push(String(error.message));
    }

    return result;
  }

  function collectErrorWarnings(error) {
    const candidates = [
      error && error.details && error.details.warnings,

      error &&
        error.details &&
        error.details.validation &&
        error.details.validation.warnings,

      error &&
        error.details &&
        error.details.upstreamDetails &&
        error.details.upstreamDetails.warnings,

      error && error.details && error.details.details && error.details.details.warnings
    ];

    const result = [];

    candidates.forEach((candidate) => {
      if (!Array.isArray(candidate)) {
        return;
      }

      candidate.forEach((item) => {
        const text = String(item || '').trim();

        if (text && !result.includes(text)) {
          result.push(text);
        }
      });
    });

    return result;
  }

  function buildErrorMessage(error) {
    const messages = {
      ADMIN_REQUIRED: 'หน้านี้สำหรับผู้ดูแลระบบเท่านั้น',
      AUTH_REQUIRED: 'กรุณาเข้าสู่ระบบ',
      SESSION_EXPIRED: 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่',
      MODULE_CONCURRENT_UPDATE:
        'ข้อมูลโมดูลถูกแก้ไขจากที่อื่น กรุณาปิดแบบฟอร์มแล้วเปิดใหม่',
      MODULE_VALIDATION_FAILED: 'ข้อมูลโมดูลยังไม่สมบูรณ์',
      ADMIN_WRITE_BUSY: 'มีผู้ดูแลระบบคนอื่นกำลังบันทึกข้อมูล กรุณาลองใหม่',
      SOURCE_SPREADSHEET_UNAVAILABLE: 'ไม่สามารถเปิด Spreadsheet ต้นทางได้',
      SOURCE_SHEET_NOT_FOUND: 'ไม่พบชีตต้นทาง',
      USERNAME_ALREADY_EXISTS: 'มีชื่อผู้ใช้นี้อยู่แล้ว',
      CANNOT_DISABLE_SELF: 'ไม่สามารถลดสิทธิ์หรือปิดบัญชีที่กำลังใช้งานอยู่ได้',
      LAST_ADMIN_REQUIRED: 'ระบบต้องมี Admin ที่เปิดใช้งานอย่างน้อย 1 บัญชี',
      NETWORK_ERROR: 'ไม่สามารถเชื่อมต่อระบบได้ กรุณาตรวจสอบอินเทอร์เน็ต',
      REQUEST_TIMEOUT: 'ระบบใช้เวลาตอบกลับนานเกินกำหนด',
      MODULE_FORM_INVALID: 'ข้อมูลโมดูลยังไม่สมบูรณ์',
      SOURCE_SHEET_EMPTY: 'ชีตต้นทางไม่มีข้อมูลหัวตารางในแถวที่กำหนด',
      MODULE_LIMIT_REACHED: 'จำนวนโมดูลถึงขีดจำกัดของระบบแล้ว',
      MODULE_ALREADY_EXISTS: 'มีรหัสโมดูลนี้อยู่แล้ว',
      MODULE_ID_DUPLICATE: 'รหัสโมดูลใหม่ซ้ำกับโมดูลเดิม',
      SERVICE_FUNCTION_MISSING: 'ระบบหลังบ้านยังติดตั้งไม่ครบ'
    };

    return messages[error?.code] || error?.message || 'เกิดข้อผิดพลาดจากระบบ';
  }

  function generateTemporaryPassword() {
    const random = Math.random().toString(36).slice(2, 8);
    return `Vendor${Date.now().toString().slice(-4)}${random}9A`;
  }

  function validatePassword(password, username) {
    return (
      password.length >= 10 &&
      /[A-Za-zก-๙]/.test(password) &&
      /\d/.test(password) &&
      !password.toLowerCase().includes(String(username || '').toLowerCase())
    );
  }

  function focusValidationTarget(selector) {
    if (!selector) {
      return;
    }

    const element = document.querySelector(selector);

    if (!element) {
      return;
    }

    window.setTimeout(() => {
      try {
        element.scrollIntoView({
          behavior: 'smooth',

          block: 'center',

          inline: 'nearest'
        });

        if (typeof element.focus === 'function') {
          element.focus({
            preventScroll: true
          });
        }
      } catch (error) {
        console.warn('ไม่สามารถเลื่อนไปยังช่องที่ผิดได้', error);
      }
    }, 120);
  }

  function positiveInteger(input, fallback) {
    const number = Number(input);

    if (Number.isInteger(number) && number > 0) {
      return number;
    }

    return fallback;
  }

  function findDuplicateValues(values) {
    const seen = new Set();

    const duplicates = new Set();

    values.forEach((valueItem) => {
      const cleanValue = String(valueItem || '').trim();

      if (!cleanValue) {
        return;
      }

      if (seen.has(cleanValue)) {
        duplicates.add(cleanValue);
      }

      seen.add(cleanValue);
    });

    return Array.from(duplicates);
  }

  function extractSpreadsheetId(input) {
    const text = String(input || '').trim();
    const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : text;
  }

  function normalizeColumn(valueText) {
    const text = String(valueText || '')
      .trim()
      .toUpperCase();

    if (!text) {
      return '';
    }

    /*
     * รองรับทั้งตัวอักษรคอลัมน์ เช่น O, P
     * และหมายเลขคอลัมน์ เช่น 15, 16
     */
    if (/^\d+$/.test(text)) {
      return columnNumberToLetter(Number(text));
    }

    const letters = text.replace(/[^A-Z]/g, '');

    return /^[A-Z]{1,3}$/.test(letters) ? letters : '';
  }

  function columnNumberToLetter(input) {
    let number = Number(input);

    if (!Number.isInteger(number) || number < 1 || number > 18278) {
      return '';
    }

    let result = '';

    while (number > 0) {
      number -= 1;

      result = String.fromCharCode(65 + (number % 26)) + result;

      number = Math.floor(number / 26);
    }

    return result;
  }

  function columnValue(id) {
    return normalizeColumn(value(id));
  }

  function shortId(text) {
    const valueText = String(text || '');
    if (valueText.length <= 20) return valueText;
    return valueText.slice(0, 8) + '…' + valueText.slice(-8);
  }

  function emptyHtml(title, text = '') {
    return `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${text ? `<span>${escapeHtml(text)}</span>` : ''}</div>`;
  }

  function loadingHtml(text) {
    return `<div class="inline-loading"><div class="spinner spinner--small"></div><span>${escapeHtml(text)}</span></div>`;
  }

  function showPageLoading(show) {
    byId('adminPageLoading')?.classList.toggle('is-hidden', !show);
  }

  function setButtonLoading(button, loading, text) {
    if (!button) return;
    if (loading) {
      if (!button.dataset.originalText)
        button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.textContent = text || 'กำลังดำเนินการ...';
    } else {
      button.disabled = false;
      if (button.dataset.originalText) button.textContent = button.dataset.originalText;
    }
  }

  function cssEscape(value) {
    const text = String(value || '');

    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(text);
    }

    return text.replace(
      /[^a-zA-Z0-9_-]/g,
      (character) => '\\' + character.charCodeAt(0).toString(16) + ' '
    );
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function value(id) {
    return String(byId(id)?.value || '').trim();
  }

  function numberValue(id, fallback) {
    const number = Number(byId(id)?.value);
    return Number.isFinite(number) ? number : fallback;
  }

  function checked(id) {
    return Boolean(byId(id)?.checked);
  }

  function setValue(id, inputValue) {
    const element = byId(id);
    if (element) element.value = inputValue ?? '';
  }

  function setChecked(id, inputValue) {
    const element = byId(id);
    if (element) element.checked = Boolean(inputValue);
  }

  function setText(id, text) {
    const element = byId(id);
    if (element) element.textContent = text;
  }

  function toBoolean(input) {
    if (input === true || input === false) return input;
    return ['TRUE', '1', 'YES', 'ON', 'เปิด', 'ใช้งาน'].includes(
      String(input || '')
        .trim()
        .toUpperCase()
    );
  }

  function clone(valueObject) {
    return JSON.parse(JSON.stringify(valueObject || {}));
  }

  function createLocalError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function escapeHtml(input) {
    return String(input ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})(window, document);

================================================================================
RecordService.gs
================================================================================
'use strict';

/************************************************************
 * RecordService.gs
 * อ่าน กรอง คำนวณสถานะ และสรุปข้อมูลรถ/ตู้สินค้า
 ************************************************************/

/**
 * อ่านรายการข้อมูลของโมดูล
 *
 * options.mode:
 * active
 * exited
 * all
 * incomplete
 * overdue
 * warning
 * normal
 *
 * @param {string} moduleId
 * @param {Object} options
 * @param {string} viewerRole
 * @returns {Object}
 */
function getModuleRecords_(moduleId, options, viewerRole) {
  const role = normalizeViewerRole_(viewerRole);

  const cleanOptions = options && typeof options === 'object' ? options : {};

  const module = getModuleRuntimeConfig_(moduleId, role);

  const records = loadModuleRecords_(module, role);

  const mode = String(cleanOptions.mode || 'active')
    .trim()
    .toLowerCase();

  const requestedStatus = String(cleanOptions.status || '')
    .trim()
    .toUpperCase();

  const requestedDate = String(cleanOptions.date || '').trim();

  const searchText = String(cleanOptions.search || '')
    .trim()
    .toLowerCase();

  const limit = Math.min(Math.max(Number(cleanOptions.limit) || 500, 1), 1000);

  let filteredRecords = records.filter((record) => {
    return filterRecordByMode_(record, mode);
  });

  if (requestedStatus) {
    filteredRecords = filteredRecords.filter((record) => {
      return record.publicData.statusCode === requestedStatus;
    });
  }

  if (requestedDate) {
    validateDateOnlyInput_(requestedDate);

    filteredRecords = filteredRecords.filter((record) => {
      return record.dateKey === requestedDate;
    });
  }

  if (searchText) {
    filteredRecords = filteredRecords.filter((record) => {
      return String(record.publicData.searchText || '')
        .toLowerCase()
        .includes(searchText);
    });
  }

  sortModuleRecords_(filteredRecords, mode);

  const summary = buildCurrentRecordsSummary_(filteredRecords);

  const totalMatched = filteredRecords.length;

  const returnedRecords = filteredRecords.slice(0, limit).map((record) => {
    return record.publicData;
  });

  return {
    module: createClientModuleConfig_(module, role, true),

    generatedAt: formatSystemDateTime_(new Date()),

    timezone: APP_CONFIG.TIMEZONE,

    dateTimeFormat: APP_CONFIG.DATE_TIME_FORMAT,

    mode: mode,

    summary: summary,

    totalMatched: totalMatched,

    returnedCount: returnedRecords.length,

    records: returnedRecords
  };
}

/**
 * สร้างข้อมูลปฏิทินรายเดือน
 *
 * @param {string} moduleId
 * @param {number|string} month
 * @param {number|string} year
 * @param {string} viewerRole
 * @returns {Object}
 */
function getModuleCalendar_(moduleId, month, year, viewerRole) {
  const role = normalizeViewerRole_(viewerRole);

  const cleanMonth = Number(month);
  const cleanYear = Number(year);

  if (!Number.isInteger(cleanMonth) || cleanMonth < 1 || cleanMonth > 12) {
    throw new Error('เดือนไม่ถูกต้อง');
  }

  if (!Number.isInteger(cleanYear) || cleanYear < 2000 || cleanYear > 2200) {
    throw new Error('ปีไม่ถูกต้อง');
  }

  const module = getModuleRuntimeConfig_(moduleId, role);

  if (!module.calendarEnabled) {
    throw new Error('โมดูลนี้ปิดใช้งานปฏิทิน');
  }

  if (role !== 'ADMIN' && !module.calendarVisibleToUser) {
    throw new Error('ไม่มีสิทธิ์ดูปฏิทินของโมดูลนี้');
  }

  const records = loadModuleRecords_(module, role);

  const grouped = {};

  records.forEach((record) => {
    const date = record.timestampInDate;

    if (!date) {
      return;
    }

    const recordMonth = Number(Utilities.formatDate(date, APP_CONFIG.TIMEZONE, 'M'));

    const recordYear = Number(Utilities.formatDate(date, APP_CONFIG.TIMEZONE, 'yyyy'));

    if (recordMonth !== cleanMonth || recordYear !== cleanYear) {
      return;
    }

    const dateKey = formatSystemDateOnly_(date);

    if (!grouped[dateKey]) {
      grouped[dateKey] = [];
    }

    grouped[dateKey].push(record);
  });

  const days = Object.keys(grouped)
    .sort(compareDateKeys_)
    .map((dateKey) => {
      const dailyResult = buildHistoricalDailyResult_(
        module,
        grouped[dateKey],
        dateKey,
        role,
        false
      );

      return {
        date: dateKey,

        totalRecords: dailyResult.summary.totalRecords,

        exitedRecords: dailyResult.summary.exitedRecords,

        activeRecords: dailyResult.summary.activeRecords,

        overdueRecords: dailyResult.summary.overdueRecords,

        warningRecords: dailyResult.summary.warningRecords,

        normalRecords: dailyResult.summary.normalRecords,

        incompleteRecords: dailyResult.summary.incompleteRecords,

        averageDuration: dailyResult.summary.averageDuration,

        maximumDuration: dailyResult.summary.maximumDuration,

        severity: determineCalendarSeverity_(dailyResult.summary)
      };
    });

  return {
    module: createClientModuleConfig_(module, role, false),

    month: cleanMonth,

    year: cleanYear,

    generatedAt: formatSystemDateTime_(new Date()),

    days: days
  };
}

/**
 * สรุปข้อมูลของวันที่เลือก
 *
 * @param {string} moduleId
 * @param {string} selectedDate dd/MM/yyyy
 * @param {string} viewerRole
 * @returns {Object}
 */
function getModuleDailySummary_(moduleId, selectedDate, viewerRole) {
  const role = normalizeViewerRole_(viewerRole);

  const dateKey = String(selectedDate || '').trim();

  validateDateOnlyInput_(dateKey);

  const module = getModuleRuntimeConfig_(moduleId, role);

  if (!module.dailySummaryEnabled) {
    throw new Error('โมดูลนี้ปิดใช้งานสรุปรายวัน');
  }

  const records = loadModuleRecords_(module, role).filter((record) => {
    return record.dateKey === dateKey;
  });

  return buildHistoricalDailyResult_(module, records, dateKey, role, true);
}

/**
 * อ่านข้อมูลจริงจาก Spreadsheet ต้นทาง
 *
 * @param {Object} module
 * @param {string} viewerRole
 * @returns {Array<Object>}
 */
function loadModuleRecords_(module, viewerRole) {
  const spreadsheet = SpreadsheetApp.openById(module.sourceSpreadsheetId);

  const sheet = spreadsheet.getSheetByName(module.sourceSheetName);

  if (!sheet) {
    throw new Error('ไม่พบชีตต้นทางชื่อ ' + module.sourceSheetName);
  }

  const firstDataRow = module.headerRow + 1;

  const lastRow = sheet.getLastRow();

  const lastColumn = sheet.getLastColumn();

  if (lastRow < firstDataRow || lastColumn < 1) {
    return [];
  }

  const rowCount = lastRow - module.headerRow;

  const rawValues = sheet.getRange(firstDataRow, 1, rowCount, lastColumn).getValues();

  const displayValues = sheet
    .getRange(firstDataRow, 1, rowCount, lastColumn)
    .getDisplayValues();

  const now = new Date();

  const records = [];

  for (let rowIndex = 0; rowIndex < rawValues.length; rowIndex += 1) {
    const rawRow = rawValues[rowIndex];

    const displayRow = displayValues[rowIndex];

    if (!matchesModuleFilters_(module.filters, rawRow, displayRow)) {
      continue;
    }

    const sourceRowNumber = firstDataRow + rowIndex;

    const record = buildModuleRecord_(
      module,
      rawRow,
      displayRow,
      sourceRowNumber,
      now,
      viewerRole
    );

    records.push(record);
  }

  return records;
}

/**
 * ตรวจสอบว่าแถวตรงเงื่อนไขหรือไม่
 *
 * @param {Array<Object>} filters
 * @param {Array<*>} rawRow
 * @param {Array<string>} displayRow
 * @returns {boolean}
 */
function matchesModuleFilters_(filters, rawRow, displayRow) {
  if (!Array.isArray(filters) || filters.length === 0) {
    return true;
  }

  let finalResult = null;

  filters.forEach((filter, index) => {
    const cell = getRowCellByColumn_(rawRow, displayRow, filter.column);

    const currentResult = evaluateFilterCondition_(
      cell.display,
      filter.operator,
      filter.value,
      filter.ignoreCase,
      filter.trimValue
    );

    if (index === 0) {
      finalResult = currentResult;

      return;
    }

    if (filter.joinType === 'OR') {
      finalResult = finalResult || currentResult;
    } else {
      finalResult = finalResult && currentResult;
    }
  });

  return Boolean(finalResult);
}

/**
 * ตรวจสอบเงื่อนไขหนึ่งรายการ
 *
 * @param {*} currentValue
 * @param {string} operator
 * @param {*} expectedValue
 * @param {boolean} ignoreCase
 * @param {boolean} trimValue
 * @returns {boolean}
 */
function evaluateFilterCondition_(
  currentValue,
  operator,
  expectedValue,
  ignoreCase,
  trimValue
) {
  let current = String(
    currentValue === undefined || currentValue === null ? '' : currentValue
  );

  let expected = String(
    expectedValue === undefined || expectedValue === null ? '' : expectedValue
  );

  if (trimValue) {
    current = current.trim();
    expected = expected.trim();
  }

  if (ignoreCase) {
    current = current.toLowerCase();
    expected = expected.toLowerCase();
  }

  switch (
    String(operator || '')
      .trim()
      .toUpperCase()
  ) {
    case 'EQUALS':
      return current === expected;

    case 'NOT_EQUALS':
      return current !== expected;

    case 'CONTAINS':
      return current.includes(expected);

    case 'NOT_CONTAINS':
      return !current.includes(expected);

    case 'STARTS_WITH':
      return current.startsWith(expected);

    case 'ENDS_WITH':
      return current.endsWith(expected);

    case 'IS_EMPTY':
      return current.trim() === '';

    case 'IS_NOT_EMPTY':
      return current.trim() !== '';

    default:
      throw new Error('ไม่รองรับตัวดำเนินการ ' + operator);
  }
}

/**
 * สร้างข้อมูลหนึ่งรายการ
 *
 * @param {Object} module
 * @param {Array<*>} rawRow
 * @param {Array<string>} displayRow
 * @param {number} sourceRowNumber
 * @param {Date} now
 * @param {string} viewerRole
 * @returns {Object}
 */
function buildModuleRecord_(
  module,
  rawRow,
  displayRow,
  sourceRowNumber,
  now,
  viewerRole
) {
  const timestampInCell = getRowCellByColumn_(
    rawRow,
    displayRow,
    module.timestampInColumn
  );

  const timestampOutCell = getRowCellByColumn_(
    rawRow,
    displayRow,
    module.timestampOutColumn
  );

  const durationCell = getRowCellByColumn_(rawRow, displayRow, module.durationColumn);

  const timestampInDate = parseSystemDateTime_(
    timestampInCell.raw || timestampInCell.display
  );

  const timestampOutDate = parseSystemDateTime_(
    timestampOutCell.raw || timestampOutCell.display
  );

  let baseState = determineBaseRecordState_(
    module,
    rawRow,
    displayRow,
    timestampOutCell,
    durationCell
  );

  let durationSeconds = null;

  if (baseState === 'ACTIVE' && timestampInDate) {
    durationSeconds = Math.max(
      0,
      Math.floor((now.getTime() - timestampInDate.getTime()) / 1000)
    );
  }

  if (baseState === 'EXITED' && timestampInDate && timestampOutDate) {
    durationSeconds = Math.floor(
      (timestampOutDate.getTime() - timestampInDate.getTime()) / 1000
    );

    if (durationSeconds < 0) {
      baseState = 'INCOMPLETE';
      durationSeconds = null;
    }
  }

  if (!timestampInDate || (baseState === 'EXITED' && !timestampOutDate)) {
    baseState = 'INCOMPLETE';
    durationSeconds = null;
  }

  const timeStatus =
    baseState === 'ACTIVE'
      ? determineTimeStatus_(module, durationSeconds)
      : baseState === 'EXITED'
        ? 'EXITED'
        : 'INCOMPLETE';

  const fields = buildRecordFields_(module, rawRow, displayRow, viewerRole);

  let primaryValue = '';

  const primaryField = fields.find((field) => {
    return field.primary && field.value;
  });

  if (primaryField) {
    primaryValue = primaryField.value;
  } else if (fields.length > 0) {
    primaryValue = fields[0].value;
  }

  const searchText = fields
    .filter((field) => {
      return field.searchable;
    })
    .map((field) => {
      return field.value;
    })
    .filter(Boolean)
    .join(' ');

  const dateKey = timestampInDate ? formatSystemDateOnly_(timestampInDate) : '';

  const role = normalizeViewerRole_(viewerRole);

  const publicData = {
    recordId: module.id + ':' + sourceRowNumber,

    moduleId: module.id,

    primaryValue: primaryValue,

    timestampIn: timestampInDate ? formatSystemDateTime_(timestampInDate) : '',

    timestampInEpochMs: timestampInDate ? timestampInDate.getTime() : null,

    timestampOut: timestampOutDate ? formatSystemDateTime_(timestampOutDate) : '',

    timestampOutEpochMs: timestampOutDate ? timestampOutDate.getTime() : null,

    durationSeconds: durationSeconds,

    durationDisplay:
      durationSeconds === null ? '' : formatDurationSeconds_(durationSeconds),

    movementState: baseState,

    statusCode: timeStatus,

    statusLabel: getStatusLabel_(timeStatus),

    statusColor: getStatusColor_(timeStatus),

    isCurrentlyInArea: baseState === 'ACTIVE',

    isExited: baseState === 'EXITED',

    isIncomplete: baseState === 'INCOMPLETE',

    isOverdue: timeStatus === 'OVERDUE',

    canCheckout: role === 'ADMIN' && module.checkoutEnabled && baseState === 'ACTIVE',

    fields: fields,

    searchText: searchText,

    dateKey: dateKey
  };

  if (role === 'ADMIN') {
    publicData.sourceRowNumber = sourceRowNumber;
  }

  return {
    publicData: publicData,

    timestampInDate: timestampInDate,

    timestampOutDate: timestampOutDate,

    durationSeconds: durationSeconds,

    baseState: baseState,

    timeStatus: timeStatus,

    dateKey: dateKey
  };
}

/**
 * ตรวจสอบสถานะพื้นฐานของแถว
 *
 * @returns {string}
 */
function determineBaseRecordState_(
  module,
  rawRow,
  displayRow,
  timestampOutCell,
  durationCell
) {
  const outIsBlank = isBlankCell_(timestampOutCell);

  const durationIsBlank = isBlankCell_(durationCell);

  switch (module.currentStatusMethod) {
    case 'TIMESTAMP_OUT_EMPTY':
      return outIsBlank ? 'ACTIVE' : 'EXITED';

    case 'CUSTOM': {
      const customCell = getRowCellByColumn_(
        rawRow,
        displayRow,
        module.customStatusColumn
      );

      const isActive = evaluateFilterCondition_(
        customCell.display,
        module.customStatusOperator,
        module.customStatusValue,
        true,
        true
      );

      if (isActive) {
        return 'ACTIVE';
      }

      if (!outIsBlank) {
        return 'EXITED';
      }

      return 'INCOMPLETE';
    }

    case 'TIMESTAMP_OUT_EMPTY_AND_DURATION_EMPTY':
    default:
      if (!outIsBlank) {
        return 'EXITED';
      }

      if (outIsBlank && durationIsBlank) {
        return 'ACTIVE';
      }

      return 'INCOMPLETE';
  }
}

/**
 * สร้างฟิลด์สำหรับแสดงบนการ์ด
 *
 * @returns {Array<Object>}
 */
function buildRecordFields_(module, rawRow, displayRow, viewerRole) {
  const role = normalizeViewerRole_(viewerRole);

  return module.fields
    .filter((field) => {
      if (!field.visible) {
        return false;
      }

      if (field.adminOnly && role !== 'ADMIN') {
        return false;
      }

      return true;
    })
    .map((field) => {
      return {
        fieldId: field.fieldId,

        label: field.label,

        value: formatModuleFieldValue_(field, rawRow, displayRow),

        type: field.type,

        position: field.position,

        order: field.order,

        searchable: field.searchable,

        primary: field.primary
      };
    });
}

/**
 * รวมค่าหลายคอลัมน์แบบเดิมหรือแบบกำหนดตำแหน่ง
 *
 * รูปแบบเดิม:
 * separator = " "  -> นาย สมชาย บุญพร
 *
 * รูปแบบกำหนดตำแหน่ง:
 * separator = "{1}{2} {3}" -> นายสมชาย บุญพร
 *
 * หมายเหตุ:
 * ใช้ property เดิมชื่อ separator เพื่อไม่ต้องเปลี่ยน Schema
 * ของ ModuleFields และไม่กระทบโมดูลเดิม
 *
 * @param {Array<Object>} cells
 * @param {*} separatorOrFormat
 * @returns {string}
 */
function formatConcatFieldValue_(cells, separatorOrFormat) {
  const values = Array.isArray(cells)
    ? cells.map((cell) => {
        return String(
          cell && cell.display !== undefined && cell.display !== null
            ? cell.display
            : ''
        ).trim();
      })
    : [];

  if (values.length === 0) {
    return '';
  }

  const format = String(
    separatorOrFormat === undefined || separatorOrFormat === null
      ? ''
      : separatorOrFormat
  );

  const placeholderMatches = Array.from(format.matchAll(/\{(\d+)\}/g));

  /*
   * ไม่มี {1}, {2}, ... ให้ทำงานเหมือนระบบเดิม
   * เพื่อรักษา Module ที่ใช้งานอยู่แล้วทั้งหมด
   */
  if (placeholderMatches.length === 0) {
    return values.filter(Boolean).join(format);
  }

  /*
   * ป้องกันรูปแบบวงเล็บปีกกาที่ไม่สมบูรณ์
   * หากพบ ให้ใช้เว้นวรรคเป็น Fallback เพื่อไม่ทำให้ API ล้ม
   */
  const remainder = format.replace(/\{\d+\}/g, '');

  if (/[{}]/.test(remainder)) {
    return values.filter(Boolean).join(' ');
  }

  const result = format.replace(/\{(\d+)\}/g, (match, positionText) => {
    const position = Number(positionText);

    if (!Number.isInteger(position) || position < 1 || position > values.length) {
      return '';
    }

    return values[position - 1] || '';
  });

  return (
    result
      /*
       * ลบช่องว่างซ้ำที่เกิดจากคอลัมน์ว่าง
       * แต่ยังคงรูปแบบ นายสมชาย บุญพร ตามที่กำหนด
       */
      .replace(/[ \t]+/g, ' ')
      .replace(/\s+([,.;:!?/)\]])/g, '$1')
      .replace(/([(\[])\s+/g, '$1')
      .trim()
  );
}

/**
 * แปลงค่าฟิลด์ตามประเภทข้อมูล
 *
 * @returns {string}
 */
function formatModuleFieldValue_(field, rawRow, displayRow) {
  const cells = field.sourceColumns.map((column) => {
    return getRowCellByColumn_(rawRow, displayRow, column);
  });

  if (cells.length === 0) {
    return '';
  }

  switch (field.type) {
    case 'CONCAT':
      return formatConcatFieldValue_(cells, field.separator);

    case 'DATE_TIME': {
      const date = parseSystemDateTime_(cells[0].raw || cells[0].display);

      return date ? formatSystemDateTime_(date) : '';
    }

    case 'DURATION': {
      const cell = cells[0];

      if (typeof cell.raw === 'number' && Number.isFinite(cell.raw)) {
        return formatDurationSeconds_(Math.round(cell.raw * 86400));
      }

      return String(cell.display || '').trim();
    }

    case 'PHONE':
    case 'NUMBER':
    case 'STATUS':
    case 'TEXT':
    default:
      return String(cells[0].display || '').trim();
  }
}

/**
 * สรุปข้อมูลปัจจุบัน
 *
 * @param {Array<Object>} records
 * @returns {Object}
 */
function buildCurrentRecordsSummary_(records) {
  const durations = records
    .map((record) => {
      return record.durationSeconds;
    })
    .filter((seconds) => {
      return seconds !== null && Number.isFinite(seconds);
    });

  return {
    totalRecords: records.length,

    activeRecords: records.filter((record) => {
      return record.baseState === 'ACTIVE';
    }).length,

    exitedRecords: records.filter((record) => {
      return record.baseState === 'EXITED';
    }).length,

    normalRecords: records.filter((record) => {
      return record.timeStatus === 'NORMAL';
    }).length,

    warningRecords: records.filter((record) => {
      return record.timeStatus === 'WARNING';
    }).length,

    overdueRecords: records.filter((record) => {
      return record.timeStatus === 'OVERDUE';
    }).length,

    incompleteRecords: records.filter((record) => {
      return record.baseState === 'INCOMPLETE';
    }).length,

    averageDuration: calculateAverageDuration_(durations),

    minimumDuration: calculateMinimumDuration_(durations),

    maximumDuration: calculateMaximumDuration_(durations),

    totalDuration: calculateTotalDuration_(durations)
  };
}

/**
 * สร้างผลสรุปรายวัน
 *
 * @returns {Object}
 */
function buildHistoricalDailyResult_(
  module,
  records,
  selectedDate,
  viewerRole,
  includeRecords
) {
  const role = normalizeViewerRole_(viewerRole);

  const todayKey = formatSystemDateOnly_(new Date());

  const historicalRecords = records.map((record) => {
    let movementState = '';
    let durationSeconds = null;

    if (record.timestampInDate && record.timestampOutDate) {
      durationSeconds = Math.floor(
        (record.timestampOutDate.getTime() - record.timestampInDate.getTime()) / 1000
      );

      if (durationSeconds >= 0) {
        movementState = 'EXITED';
      } else {
        durationSeconds = null;
        movementState = 'INCOMPLETE';
      }
    } else if (
      record.timestampInDate &&
      !record.timestampOutDate &&
      selectedDate === todayKey
    ) {
      durationSeconds = Math.max(
        0,
        Math.floor((Date.now() - record.timestampInDate.getTime()) / 1000)
      );

      movementState = 'ACTIVE';
    } else {
      movementState = 'INCOMPLETE';
    }

    const timeStatus =
      durationSeconds === null
        ? 'INCOMPLETE'
        : determineTimeStatus_(module, durationSeconds);

    return {
      ...record.publicData,

      movementState: movementState,

      movementLabel: getMovementLabel_(movementState),

      statusCode: timeStatus,

      statusLabel: getStatusLabel_(timeStatus),

      statusColor: getStatusColor_(timeStatus),

      durationSeconds: durationSeconds,

      durationDisplay:
        durationSeconds === null ? '' : formatDurationSeconds_(durationSeconds),

      canCheckout:
        role === 'ADMIN' && module.checkoutEnabled && movementState === 'ACTIVE'
    };
  });

  historicalRecords.sort((left, right) => {
    const leftTime = Number(left.timestampInEpochMs) || 0;

    const rightTime = Number(right.timestampInEpochMs) || 0;

    return leftTime - rightTime;
  });

  const durations = historicalRecords
    .map((record) => {
      return record.durationSeconds;
    })
    .filter((seconds) => {
      return seconds !== null && Number.isFinite(seconds);
    });

  const summary = {
    date: selectedDate,

    totalRecords: historicalRecords.length,

    exitedRecords: historicalRecords.filter((record) => {
      return record.movementState === 'EXITED';
    }).length,

    activeRecords: historicalRecords.filter((record) => {
      return record.movementState === 'ACTIVE';
    }).length,

    normalRecords: historicalRecords.filter((record) => {
      return record.statusCode === 'NORMAL';
    }).length,

    warningRecords: historicalRecords.filter((record) => {
      return record.statusCode === 'WARNING';
    }).length,

    overdueRecords: historicalRecords.filter((record) => {
      return record.statusCode === 'OVERDUE';
    }).length,

    incompleteRecords: historicalRecords.filter((record) => {
      return record.movementState === 'INCOMPLETE';
    }).length,

    validDurationRecords: durations.length,

    excludedDurationRecords: historicalRecords.length - durations.length,

    averageDuration: calculateAverageDuration_(durations),

    minimumDuration: calculateMinimumDuration_(durations),

    maximumDuration: calculateMaximumDuration_(durations),

    totalDuration: calculateTotalDuration_(durations)
  };

  const result = {
    module: createClientModuleConfig_(module, role, true),

    generatedAt: formatSystemDateTime_(new Date()),

    date: selectedDate,

    summary: summary
  };

  if (includeRecords) {
    result.records = historicalRecords;
  }

  return result;
}

/************************************************************
 * การกรองและเรียงข้อมูล
 ************************************************************/

function filterRecordByMode_(record, mode) {
  switch (mode) {
    case 'all':
      return true;

    case 'exited':
      return record.baseState === 'EXITED';

    case 'incomplete':
      return record.baseState === 'INCOMPLETE';

    case 'overdue':
      return record.timeStatus === 'OVERDUE';

    case 'warning':
      return record.timeStatus === 'WARNING';

    case 'normal':
      return record.timeStatus === 'NORMAL';

    case 'active':
    default:
      return record.baseState !== 'EXITED';
  }
}

function sortModuleRecords_(records, mode) {
  if (mode === 'exited') {
    records.sort((left, right) => {
      const leftTime = left.timestampInDate ? left.timestampInDate.getTime() : 0;

      const rightTime = right.timestampInDate ? right.timestampInDate.getTime() : 0;

      return rightTime - leftTime;
    });

    return;
  }

  const severityMap = {
    OVERDUE: 1,
    WARNING: 2,
    NORMAL: 3,
    INCOMPLETE: 4,
    EXITED: 5
  };

  records.sort((left, right) => {
    const leftSeverity = severityMap[left.timeStatus] || 99;

    const rightSeverity = severityMap[right.timeStatus] || 99;

    if (leftSeverity !== rightSeverity) {
      return leftSeverity - rightSeverity;
    }

    const leftDuration = Number(left.durationSeconds) || 0;

    const rightDuration = Number(right.durationSeconds) || 0;

    return rightDuration - leftDuration;
  });
}

/************************************************************
 * สถานะและสี
 ************************************************************/

function determineTimeStatus_(module, durationSeconds) {
  const seconds = Number(durationSeconds);

  if (!Number.isFinite(seconds) || seconds < 0) {
    return 'INCOMPLETE';
  }

  const elapsedMinutes = seconds / 60;

  if (elapsedMinutes >= module.redStartMinutes) {
    return 'OVERDUE';
  }

  if (elapsedMinutes >= module.warningStartMinutes) {
    return 'WARNING';
  }

  return 'NORMAL';
}

function getStatusLabel_(statusCode) {
  const labels = {
    NORMAL: 'ปกติ',
    WARNING: 'ใกล้เกินเวลา',
    OVERDUE: 'เกินเวลา',
    EXITED: 'ออกจากพื้นที่แล้ว',
    INCOMPLETE: 'ข้อมูลไม่สมบูรณ์'
  };

  return labels[statusCode] || 'ไม่ทราบสถานะ';
}

function getMovementLabel_(movementState) {
  const labels = {
    ACTIVE: 'ยังอยู่ในพื้นที่',
    EXITED: 'ออกจากพื้นที่แล้ว',
    INCOMPLETE: 'ข้อมูลไม่สมบูรณ์'
  };

  return labels[movementState] || 'ไม่ทราบสถานะ';
}

function getStatusColor_(statusCode) {
  const colors = {
    NORMAL: 'GREEN',
    WARNING: 'ORANGE',
    OVERDUE: 'RED',
    EXITED: 'BLUE',
    INCOMPLETE: 'GRAY'
  };

  return colors[statusCode] || 'GRAY';
}

function determineCalendarSeverity_(summary) {
  if (summary.overdueRecords > 0) {
    return 'RED';
  }

  if (summary.warningRecords > 0) {
    return 'ORANGE';
  }

  if (summary.incompleteRecords > 0) {
    return 'GRAY';
  }

  return 'GREEN';
}

/************************************************************
 * การคำนวณ Duration
 ************************************************************/

function calculateAverageDuration_(durations) {
  if (durations.length === 0) {
    return createDurationResult_(null);
  }

  const total = durations.reduce((sum, seconds) => {
    return sum + seconds;
  }, 0);

  return createDurationResult_(Math.round(total / durations.length));
}

function calculateMinimumDuration_(durations) {
  if (durations.length === 0) {
    return createDurationResult_(null);
  }

  return createDurationResult_(Math.min.apply(null, durations));
}

function calculateMaximumDuration_(durations) {
  if (durations.length === 0) {
    return createDurationResult_(null);
  }

  return createDurationResult_(Math.max.apply(null, durations));
}

function calculateTotalDuration_(durations) {
  if (durations.length === 0) {
    return createDurationResult_(0);
  }

  const total = durations.reduce((sum, seconds) => {
    return sum + seconds;
  }, 0);

  return createDurationResult_(total);
}

function createDurationResult_(seconds) {
  if (seconds === null || !Number.isFinite(Number(seconds))) {
    return {
      seconds: null,
      display: ''
    };
  }

  const cleanSeconds = Math.max(0, Math.floor(Number(seconds)));

  return {
    seconds: cleanSeconds,

    display: formatDurationSeconds_(cleanSeconds)
  };
}

function formatDurationSeconds_(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));

  const hours = Math.floor(seconds / 3600);

  const minutes = Math.floor((seconds % 3600) / 60);

  const remainingSeconds = seconds % 60;

  return (
    String(hours).padStart(2, '0') +
    ':' +
    String(minutes).padStart(2, '0') +
    ':' +
    String(remainingSeconds).padStart(2, '0')
  );
}

/************************************************************
 * วันที่และเวลา
 ************************************************************/

function parseSystemDateTime_(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getTime());
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  const text = String(value || '').trim();

  if (!text) {
    return null;
  }

  const thaiPattern = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/;

  const thaiMatch = text.match(thaiPattern);

  if (thaiMatch) {
    const day = Number(thaiMatch[1]);

    const month = Number(thaiMatch[2]);

    const year = Number(thaiMatch[3]);

    const hour = Number(thaiMatch[4]);

    const minute = Number(thaiMatch[5]);

    const second = Number(thaiMatch[6]);

    const isoText =
      String(year).padStart(4, '0') +
      '-' +
      String(month).padStart(2, '0') +
      '-' +
      String(day).padStart(2, '0') +
      'T' +
      String(hour).padStart(2, '0') +
      ':' +
      String(minute).padStart(2, '0') +
      ':' +
      String(second).padStart(2, '0') +
      '+07:00';

    const parsed = new Date(isoText);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(text);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatSystemDateTime_(date) {
  return Utilities.formatDate(date, APP_CONFIG.TIMEZONE, APP_CONFIG.DATE_TIME_FORMAT);
}

function formatSystemDateOnly_(date) {
  return Utilities.formatDate(date, APP_CONFIG.TIMEZONE, 'dd/MM/yyyy');
}

function validateDateOnlyInput_(value) {
  const text = String(value || '').trim();

  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (!match) {
    throw new Error('วันที่ต้องเป็นรูปแบบ dd/MM/yyyy');
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  const isoText =
    String(year).padStart(4, '0') +
    '-' +
    String(month).padStart(2, '0') +
    '-' +
    String(day).padStart(2, '0') +
    'T00:00:00+07:00';

  const date = new Date(isoText);

  if (
    Number.isNaN(date.getTime()) ||
    Number(Utilities.formatDate(date, APP_CONFIG.TIMEZONE, 'd')) !== day ||
    Number(Utilities.formatDate(date, APP_CONFIG.TIMEZONE, 'M')) !== month ||
    Number(Utilities.formatDate(date, APP_CONFIG.TIMEZONE, 'yyyy')) !== year
  ) {
    throw new Error('วันที่ไม่ถูกต้อง');
  }

  return true;
}

function compareDateKeys_(left, right) {
  const leftParts = left.split('/').map(Number);

  const rightParts = right.split('/').map(Number);

  const leftValue = leftParts[2] * 10000 + leftParts[1] * 100 + leftParts[0];

  const rightValue = rightParts[2] * 10000 + rightParts[1] * 100 + rightParts[0];

  return leftValue - rightValue;
}

/************************************************************
 * Utility สำหรับแถวข้อมูล
 ************************************************************/

function getRowCellByColumn_(rawRow, displayRow, columnLetter) {
  if (!columnLetter) {
    return {
      raw: '',
      display: ''
    };
  }

  const columnIndex = columnLetterToNumber_(columnLetter) - 1;

  return {
    raw: columnIndex >= 0 && columnIndex < rawRow.length ? rawRow[columnIndex] : '',

    display:
      columnIndex >= 0 && columnIndex < displayRow.length ? displayRow[columnIndex] : ''
  };
}

function isBlankCell_(cell) {
  if (!cell) {
    return true;
  }

  const raw = cell.raw;

  if (raw !== '' && raw !== null && raw !== undefined) {
    return false;
  }

  return String(cell.display || '').trim() === '';
}
