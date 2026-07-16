/**
 * admin-inbound-export.js
 * PHASE 5 ROUND 02 HOTFIX 03
 * Simple one-click export + secure Admin download
 */
(function (
  window,
  document
) {
  'use strict';

  const API =
    window.VehicleAPI;

  const state = {
    session:
      null,

    modules:
      [],

    moduleId:
      '',

    config:
      null,

    loading:
      false,

    downloading:
      false,

    activeJobId:
      '',

    polling:
      false,

    dateMode:
      'TODAY'
  };

  const ACTIVE_JOB_KEY =
    'alertvendor_management_export_active_job_v2';

  document.addEventListener(
    'DOMContentLoaded',
    initialize
  );


  async function initialize() {
    bindEvents();

    try {
      if (
        !API ||
        typeof API.me !==
          'function'
      ) {
        return;
      }

      const session =
        await API.me();

      state.session =
        session;

      if (!isAdmin(session)) {
        hideExportTab();
        return;
      }

      await loadModules();
      await loadConfig();
      setDateMode(
        'TODAY'
      );
      await resumeActiveExportJob();

    } catch (error) {
      console.warn(
        'simple export init failed',
        error
      );

      setSummary(
        'โหลดระบบส่งออกไม่สำเร็จ: ' +
        errorMessage(
          error
        )
      );
    }
  }


  function bindEvents() {
    byId(
      'adminInboundExportRefreshButton'
    )?.addEventListener(
      'click',
      loadConfig
    );

    byId(
      'adminManagementCleanupButton'
    )?.addEventListener(
      'click',
      cleanupExpiredFiles
    );

    byId(
      'adminInboundExportButton'
    )?.addEventListener(
      'click',
      createAndDownload
    );

    byId(
      'adminInboundExportModuleSelect'
    )?.addEventListener(
      'change',
      async (
        event
      ) => {
        state.moduleId =
          text(
            event.target.value
          );

        await loadConfig();
      }
    );

    byId(
      'adminManagementFileFormat'
    )?.addEventListener(
      'change',
      updatePrimaryButton
    );

    document
      .querySelectorAll(
        '[data-export-date-mode]'
      )
      .forEach(
        (button) => {
          button.addEventListener(
            'click',
            () =>
              setDateMode(
                button.getAttribute(
                  'data-export-date-mode'
                )
              )
          );
        }
      );

    byId(
      'adminManagementExportHistory'
    )?.addEventListener(
      'click',
      async (
        event
      ) => {
        const button =
          event.target.closest(
            '[data-secure-export-id]'
          );

        if (!button) {
          return;
        }

        await downloadExport(
          button.getAttribute(
            'data-secure-export-id'
          ),
          button
        );
      }
    );

    byId(
      'adminInboundExportPreview'
    )?.addEventListener(
      'click',
      async (
        event
      ) => {
        const button =
          event.target.closest(
            '[data-secure-export-id]'
          );

        if (!button) {
          return;
        }

        await downloadExport(
          button.getAttribute(
            'data-secure-export-id'
          ),
          button
        );
      }
    );
  }


  function hideExportTab() {
    document
      .querySelector(
        '[data-admin-tab="exports"]'
      )
      ?.classList.add(
        'is-hidden'
      );

    byId(
      'adminPanelExports'
    )?.classList.add(
      'is-hidden'
    );
  }


  async function loadModules() {
    const data =
      await API.getModules();

    const list =
      Array.isArray(
        data
      )
        ? data
        : Array.isArray(
            data &&
            data.modules
          )
          ? data.modules
          : [];

    state.modules =
      list
        .map(
          (
            item
          ) => ({
            moduleId:
              text(
                item.moduleId ||
                item.id
              ),

            name:
              text(
                item.name ||
                item.moduleName ||
                item.moduleId ||
                item.id
              )
          })
        )
        .filter(
          (
            item
          ) =>
            item.moduleId
        );

    const preferred =
      state.modules.find(
        (
          item
        ) =>
          item.moduleId
            .toLowerCase() ===
          'vendors'
      );

    state.moduleId =
      (
        preferred ||
        state.modules[0] ||
        {}
      ).moduleId ||
      '';

    renderModules();
  }


  function renderModules() {
    const select =
      byId(
        'adminInboundExportModuleSelect'
      );

    if (!select) {
      return;
    }

    select.innerHTML =
      state.modules.length
        ? state.modules.map(
            (
              item
            ) => `
              <option
                value="${escapeHtml(item.moduleId)}"
                ${item.moduleId === state.moduleId ? 'selected' : ''}
              >
                ${escapeHtml(item.name || item.moduleId)}
              </option>
            `
          ).join(
            ''
          )
        : '<option value="">ไม่พบ Module</option>';
  }


  async function loadConfig() {
    if (
      !state.moduleId ||
      state.loading
    ) {
      return;
    }

    state.loading =
      true;

    setSummary(
      'กำลังตรวจสอบชีตและประวัติไฟล์...'
    );

    try {
      const data =
        await API
          .getManagementReportingConfig(
            state.moduleId
          );

      state.config =
        data;

      applyDefaults(
        data
      );

      renderConfig(
        data
      );

      setSummary(
        'พร้อมส่งออกจากชีตที่เกี่ยวข้อง'
      );

    } catch (error) {
      setSummary(
        'โหลดข้อมูลไม่สำเร็จ: ' +
        errorMessage(
          error
        )
      );

    } finally {
      state.loading =
        false;

      updatePrimaryButton();
    }
  }


  function applyDefaults(
    data
  ) {
    const range =
      data &&
      data.defaultRange
        ? data.defaultRange
        : {};

    const today =
      new Date()
        .toISOString()
        .slice(
          0,
          10
        );

    const start =
      byId(
        'adminManagementStartDate'
      );

    const end =
      byId(
        'adminManagementEndDate'
      );

    if (
      start &&
      !start.value
    ) {
      start.value =
        today;
    }

    if (
      end &&
      !end.value
    ) {
      end.value =
        today;
    }

    const month =
      byId(
        'adminManagementMonth'
      );

    if (
      month &&
      !month.value
    ) {
      month.value =
        String(
          range.endDate ||
          today
        ).slice(
          0,
          7
        );
    }
  }


  function renderConfig(
    data
  ) {
    const governance =
      data &&
      data.governance
        ? data.governance
        : {};

    setText(
      'adminManagementDataRevision',
      governance.dataRevision ||
      '-'
    );

    setText(
      'adminManagementRulesRevision',
      governance.rulesRevision ||
      '-'
    );

    setText(
      'adminManagementShiftVersion',
      governance.shiftVersion ||
      '-'
    );

    setText(
      'adminManagementKpiVersion',
      governance.kpiVersion ||
      '-'
    );

    setText(
      'adminManagementRetention',
      String(
        data.retentionHours ||
        24
      ) +
      ' ชั่วโมง'
    );

    renderSourceSheets(
      data.sourceSheets ||
      []
    );

    renderKpis(
      data.kpis ||
      []
    );

    renderHistory(
      data.recentExports ||
      []
    );
  }


  function renderSourceSheets(
    sources
  ) {
    const element =
      byId(
        'adminManagementSources'
      );

    if (!element) {
      return;
    }

    const names =
      sources
        .map(
          (
            source
          ) => {
            const label =
              text(
                source.label
              );

            const sheet =
              text(
                source.sheetName
              );

            return (
              label +
              (
                sheet
                  ? ' [' +
                    sheet +
                    ']'
                  : ''
              )
            );
          }
        )
        .filter(
          Boolean
        );

    element.textContent =
      names.length
        ? (
            'ใช้ข้อมูลจริงจาก: ' +
            names.join(
              ' · '
            )
          )
        : 'ใช้ข้อมูลรถ/ตู้, สถานะล่าสุดรถ และเกณฑ์ SLA จาก Admin';
  }


  function renderKpis(
    items
  ) {
    setText(
      'adminManagementKpiCount',
      items.length +
      ' KPI'
    );

    const element =
      byId(
        'adminManagementKpiList'
      );

    if (!element) {
      return;
    }

    element.innerHTML =
      items.length
        ? items.map(
            (
              item
            ) => `
              <article class="admin-management-kpi">
                <header>
                  <strong>
                    ${escapeHtml(item['ชื่อ KPI'] || '-')}
                  </strong>

                  <code>
                    ${escapeHtml(item['รหัส KPI'] || '-')}
                  </code>
                </header>

                <p>
                  ${escapeHtml(item['นิยาม'] || '')}
                </p>

                <small>
                  ${escapeHtml(item['สูตร/ฐานคำนวณ'] || '')}
                  ·
                  ${escapeHtml(item['หน่วย'] || '')}
                </small>
              </article>
            `
          ).join(
            ''
          )
        : '<div class="empty-state">ยังไม่มีนิยาม KPI</div>';
  }


  function renderHistory(
    items
  ) {
    const element =
      byId(
        'adminManagementExportHistory'
      );

    if (!element) {
      return;
    }

    element.innerHTML =
      items.length
        ? items.map(
            (
              item
            ) => `
              <article class="admin-management-history-item">
                <div>
                  <strong>
                    ${escapeHtml(item.filename || '-')}
                  </strong>

                  <span>
                    ${escapeHtml(item.startDate || '')}
                    →
                    ${escapeHtml(item.endDate || '')}
                    ·
                    ${escapeHtml(item.fileFormat || '-')}
                    ·
                    ${Number(item.vehicleCount || 0)} แถว
                  </span>

                  <small>
                    สร้าง ${escapeHtml(item.createdAt || '-')}
                    · หมดอายุ ${escapeHtml(item.expiresAt || '-')}
                  </small>
                </div>

                ${
                  item.secureDownload &&
                  item.exportId
                    ? `
                      <button
                        class="button button--secondary button--compact"
                        type="button"
                        data-secure-export-id="${escapeAttribute(item.exportId)}"
                      >
                        ดาวน์โหลด
                      </button>
                    `
                    : ''
                }
              </article>
            `
          ).join(
            ''
          )
        : '<div class="empty-state">ยังไม่มีไฟล์ส่งออก</div>';
  }


  function setDateMode(
    mode
  ) {
    const normalized =
      [
        'TODAY',
        'RANGE',
        'MONTH'
      ].includes(
        String(
          mode ||
          ''
        ).toUpperCase()
      )
        ? String(
            mode
          ).toUpperCase()
        : 'TODAY';

    state.dateMode =
      normalized;

    const input =
      byId(
        'adminManagementDateMode'
      );

    if (input) {
      input.value =
        normalized;
    }

    document
      .querySelectorAll(
        '[data-export-date-mode]'
      )
      .forEach(
        (
          button
        ) => {
          button.classList.toggle(
            'is-active',
            button.getAttribute(
              'data-export-date-mode'
            ) === normalized
          );
        }
      );

    byId(
      'adminManagementRangeFields'
    )?.classList.toggle(
      'is-hidden',
      normalized !==
        'RANGE'
    );

    byId(
      'adminManagementMonthField'
    )?.classList.toggle(
      'is-hidden',
      normalized !==
        'MONTH'
    );
  }


  function collectSelection() {
    const dateMode =
      state.dateMode ||
      'TODAY';

    const selection = {
      dateMode:
        dateMode,

      includeActive:
        Boolean(
          byId(
            'adminManagementIncludeActive'
          )?.checked
        )
    };

    if (
      dateMode ===
      'MONTH'
    ) {
      selection.month =
        value(
          'adminManagementMonth'
        );

      if (!selection.month) {
        throw new Error(
          'กรุณาเลือกเดือน'
        );
      }

    } else if (
      dateMode ===
      'RANGE'
    ) {
      selection.startDate =
        value(
          'adminManagementStartDate'
        );

      selection.endDate =
        value(
          'adminManagementEndDate'
        );

      if (
        !selection.startDate ||
        !selection.endDate
      ) {
        throw new Error(
          'กรุณาเลือกวันที่เริ่มต้นและวันที่สิ้นสุด'
        );
      }
    }

    return selection;
  }


  async function createAndDownload() {
    if (
      !state.moduleId ||
      state.loading ||
      state.downloading
    ) {
      return;
    }

    let selection;

    try {
      selection =
        collectSelection();

    } catch (error) {
      toast(
        errorMessage(
          error
        ),
        'warning'
      );

      return;
    }

    const fileFormat =
      value(
        'adminManagementFileFormat'
      ) ||
      'CSV';

    state.loading =
      true;

    setButtonBusy(
      true,
      'กำลังเตรียมงาน...'
    );

    setSummary(
      'กำลังอ่านข้อมูลจากชีตและสร้างไฟล์...'
    );

    try {
      const result =
        await API
          .createAllWorkflowStagesExport(
            state.moduleId,
            {
              ...selection,
              fileFormat:
                fileFormat
            }
          );

      if (
        !result ||
        !result.jobId
      ) {
        throw new Error(
          'ระบบไม่ส่ง Job ID กลับมา'
        );
      }

      saveActiveJob(
        result.jobId,
        state.moduleId
      );

      const ready =
        await monitorExportJob(
          result.jobId,
          result
        );

      renderReadyResult(
        ready
      );

      setText(
        'adminManagementLatestFile',
        ready.filename ||
        '-'
      );

      clearActiveJob();

      await loadHistoryOnly();

      /*
       * พยายามดาวน์โหลดทันที
       * หาก Browser ป้องกัน ยังมีปุ่มดาวน์โหลดค้างไว้
       */
      await downloadExport(
        ready.exportId ||
        ready.jobId,
        null,
        true
      );

    } catch (error) {
      setSummary(
        'ส่งออกไม่สำเร็จ: ' +
        errorMessage(
          error
        )
      );

      toast(
        errorMessage(
          error
        ),
        'error'
      );

    } finally {
      state.loading =
        false;

      setButtonBusy(
        false
      );
    }
  }


  async function monitorExportJob(
    jobId,
    initial
  ) {
    if (state.polling) {
      throw new Error(
        'มีงานส่งออกกำลังทำงานอยู่'
      );
    }

    state.polling =
      true;

    state.activeJobId =
      jobId;

    let latest =
      initial ||
      {};

    const started =
      Date.now();

    try {
      while (
        Date.now() -
          started <
        45 *
          60 *
          1000
      ) {
        latest =
          await API
            .getManagementReportJobStatus(
              jobId
            );

        renderJobProgress(
          latest
        );

        const status =
          text(
            latest.status
          ).toUpperCase();

        if (
          status ===
          'READY'
        ) {
          return latest;
        }

        if (
          status ===
          'FAILED'
        ) {
          clearActiveJob();

          throw new Error(
            latest.errorMessage ||
            'งานส่งออกล้มเหลว'
          );
        }

        if (
          status ===
          'CANCELLED'
        ) {
          clearActiveJob();

          throw new Error(
            'งานส่งออกถูกยกเลิก'
          );
        }

        await sleep(
          4000
        );
      }

      throw new Error(
        'งานยังประมวลผลอยู่ สามารถกลับมาตรวจสอบภายหลังได้'
      );

    } finally {
      state.polling =
        false;

      state.activeJobId =
        '';
    }
  }


  function renderJobProgress(
    job
  ) {
    const progress =
      Math.max(
        0,
        Math.min(
          100,
          Number(
            job.progressPercent ||
            0
          )
        )
      );

    setSummary(
      'กำลังสร้างไฟล์ ' +
      progress +
      '% · ตรวจแล้ว ' +
      Number(
        job.processedSourceRows ||
        0
      ) +
      ' แถว · ส่งออก ' +
      Number(
        job.rowCount ||
        0
      ) +
      ' แถว'
    );

    const element =
      byId(
        'adminInboundExportPreview'
      );

    if (!element) {
      return;
    }

    element.classList.add(
      'is-ready'
    );

    element.innerHTML = `
      <h4>
        กำลังสร้างไฟล์
      </h4>

      <p>
        <strong>
          ${escapeHtml(job.filename || job.jobId || '-')}
        </strong>
      </p>

      <div class="admin-management-result__facts">
        <span>
          ${progress}%
        </span>

        <span>
          ตรวจ ${Number(job.processedSourceRows || 0)} แถว
        </span>

        <span>
          ส่งออก ${Number(job.rowCount || 0)} แถว
        </span>
      </div>

      <p>
        ระบบทำงานเบื้องหลัง ไม่ต้องเปิดลิงก์ Google Drive
      </p>
    `;
  }


  function renderReadyResult(
    result
  ) {
    const element =
      byId(
        'adminInboundExportPreview'
      );

    if (!element) {
      return;
    }

    const exportId =
      result.exportId ||
      result.jobId ||
      '';

    element.classList.add(
      'is-ready'
    );

    element.innerHTML = `
      <h4>
        ไฟล์สรุป Timeline พร้อมดาวน์โหลด
      </h4>

      <p>
        <strong>
          ${escapeHtml(result.filename || '-')}
        </strong>
      </p>

      <div class="admin-management-result__facts">
        <span>
          ${escapeHtml(result.fileFormat || '-')}
        </span>

        <span>
          ${Number(result.rowCount || 0)} แถว
        </span>

        <span>
          ${Number(result.columnCount || 44)} คอลัมน์
        </span>
      </div>

      <p>
        ช่วง ${escapeHtml(result.startDate || '')}
        →
        ${escapeHtml(result.endDate || '')}
      </p>

      ${
        exportId
          ? `
            <button
              class="button button--primary"
              type="button"
              data-secure-export-id="${escapeAttribute(exportId)}"
            >
              ดาวน์โหลดไฟล์
            </button>
          `
          : ''
      }
    `;
  }


  async function downloadExport(
    exportId,
    button,
    automatic
  ) {
    const cleanExportId =
      text(
        exportId
      );

    if (
      !cleanExportId ||
      state.downloading
    ) {
      return;
    }

    state.downloading =
      true;

    const originalText =
      button
        ? button.textContent
        : '';

    if (button) {
      button.disabled =
        true;

      button.textContent =
        'กำลังดาวน์โหลด...';
    }

    try {
      const result =
        await API
          .downloadManagementReportFile(
            cleanExportId,
            {
              onProgress:
                (
                  progress
                ) => {
                  setSummary(
                    'กำลังดาวน์โหลด ' +
                    Number(
                      progress.percent ||
                      0
                    ) +
                    '%'
                  );
                }
            }
          );

      setSummary(
        'ดาวน์โหลดแล้ว: ' +
        (
          result.filename ||
          'ไฟล์รายงาน'
        )
      );

      toast(
        'ดาวน์โหลดไฟล์สำเร็จ',
        'success'
      );

    } catch (error) {
      setSummary(
        'ดาวน์โหลดไม่สำเร็จ: ' +
        errorMessage(
          error
        )
      );

      if (!automatic) {
        toast(
          errorMessage(
            error
          ),
          'error'
        );
      }

    } finally {
      state.downloading =
        false;

      if (button) {
        button.disabled =
          false;

        button.textContent =
          originalText ||
          'ดาวน์โหลด';
      }
    }
  }


  async function resumeActiveExportJob() {
    const saved =
      readActiveJob();

    if (
      !saved ||
      !saved.jobId ||
      saved.moduleId !==
        state.moduleId ||
      state.loading
    ) {
      return;
    }

    state.loading =
      true;

    setButtonBusy(
      true,
      'กำลังติดตามงานเดิม...'
    );

    try {
      const result =
        await monitorExportJob(
          saved.jobId,
          {
            jobId:
              saved.jobId
          }
        );

      renderReadyResult(
        result
      );

      setText(
        'adminManagementLatestFile',
        result.filename ||
        '-'
      );

      clearActiveJob();

      await loadHistoryOnly();

    } catch (error) {
      setSummary(
        'ติดตามงานเดิมไม่สำเร็จ: ' +
        errorMessage(
          error
        )
      );

    } finally {
      state.loading =
        false;

      setButtonBusy(
        false
      );
    }
  }


  async function loadHistoryOnly() {
    try {
      const data =
        await API
          .listManagementReportExports(
            state.moduleId,
            {
              limit:
                20
            }
          );

      renderHistory(
        data.exports ||
        []
      );

    } catch (error) {
      console.warn(
        error
      );
    }
  }


  async function cleanupExpiredFiles() {
    if (state.loading) {
      return;
    }

    state.loading =
      true;

    try {
      const result =
        await API
          .cleanupManagementReportFiles();

      toast(
        'ตรวจ ' +
        Number(
          result.checked ||
          0
        ) +
        ' ไฟล์ · ลบ ' +
        Number(
          result.trashed ||
          0
        ) +
        ' ไฟล์',
        'success'
      );

      await loadHistoryOnly();

    } catch (error) {
      toast(
        errorMessage(
          error
        ),
        'error'
      );

    } finally {
      state.loading =
        false;
    }
  }


  function updatePrimaryButton() {
    const button =
      byId(
        'adminInboundExportButton'
      );

    if (
      !button ||
      state.loading
    ) {
      return;
    }

    const format =
      value(
        'adminManagementFileFormat'
      ) ||
      'CSV';

    button.textContent =
      'สร้างและดาวน์โหลด ' +
      (
        format ===
          'CSV'
          ? 'CSV'
          : 'Excel'
      );
  }


  function setButtonBusy(
    busy,
    label
  ) {
    const button =
      byId(
        'adminInboundExportButton'
      );

    if (!button) {
      return;
    }

    button.disabled =
      Boolean(
        busy
      );

    if (busy) {
      button.textContent =
        label ||
        'กำลังสร้างไฟล์...';

    } else {
      updatePrimaryButton();
    }
  }


  function saveActiveJob(
    jobId,
    moduleId
  ) {
    try {
      localStorage.setItem(
        ACTIVE_JOB_KEY,
        JSON.stringify({
          jobId:
            jobId,

          moduleId:
            moduleId,

          storedAt:
            Date.now()
        })
      );
    } catch (error) {
      // Browser อาจปิด localStorage
    }
  }


  function readActiveJob() {
    try {
      return JSON.parse(
        localStorage.getItem(
          ACTIVE_JOB_KEY
        ) ||
        'null'
      );

    } catch (error) {
      return null;
    }
  }


  function clearActiveJob() {
    try {
      localStorage.removeItem(
        ACTIVE_JOB_KEY
      );
    } catch (error) {
      // Browser อาจปิด localStorage
    }
  }


  function setSummary(
    value
  ) {
    setText(
      'adminInboundExportSummary',
      value
    );
  }


  function setText(
    id,
    value
  ) {
    const element =
      byId(
        id
      );

    if (element) {
      element.textContent =
        value;
    }
  }


  function value(
    id
  ) {
    return text(
      byId(
        id
      )?.value
    );
  }


  function byId(
    id
  ) {
    return document
      .getElementById(
        id
      );
  }


  function text(
    value
  ) {
    if (
      value === null ||
      value === undefined
    ) {
      return '';
    }

    return String(
      value
    ).trim();
  }


  function errorMessage(
    error
  ) {
    return (
      error &&
      error.message
    )
      ? error.message
      : String(
          error ||
          'เกิดข้อผิดพลาด'
        );
  }


  function isAdmin(
    session
  ) {
    const user =
      session &&
      session.user
        ? session.user
        : session ||
          {};

    return (
      text(
        user.role
      ).toUpperCase() ===
      'ADMIN'
    );
  }


  function escapeHtml(
    value
  ) {
    return text(
      value
    )
      .replace(
        /&/g,
        '&amp;'
      )
      .replace(
        /</g,
        '&lt;'
      )
      .replace(
        />/g,
        '&gt;'
      )
      .replace(
        /"/g,
        '&quot;'
      )
      .replace(
        /'/g,
        '&#039;'
      );
  }


  function escapeAttribute(
    value
  ) {
    return escapeHtml(
      value
    );
  }


  function toast(
    title,
    icon
  ) {
    if (!window.Swal) {
      return;
    }

    Swal.fire({
      toast:
        true,

      position:
        'top-end',

      timer:
        3200,

      showConfirmButton:
        false,

      icon:
        icon ||
        'info',

      title:
        title
    });
  }


  function sleep(
    milliseconds
  ) {
    return new Promise(
      (
        resolve
      ) =>
        window.setTimeout(
          resolve,
          milliseconds
        )
    );
  }

})(
  window,
  document
);
