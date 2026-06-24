/**
 * auth.js
 * ระบบ Login, Session, เปลี่ยนรหัสผ่าน และ Logout
 *
 * ใช้ SweetAlert2 สำหรับการแจ้งเตือนทุกจุด
 */
(function (
  window,
  document
) {
  'use strict';

  const CONFIG =
    window.APP_CONFIG || {};

  const API =
    window.VehicleAPI;

  const state = {
    submitting:
      false,

    session:
      null,

    clockTimer:
      null
  };

  document.addEventListener(
    'DOMContentLoaded',
    initializePage
  );

  async function initializePage() {
    if (
      typeof window.Swal ===
      'undefined'
    ) {
      console.error(
        'ไม่พบ SweetAlert2'
      );

      return;
    }

    if (!API) {
      await Swal.fire({
        icon:
          'error',

        title:
          'เริ่มต้นระบบไม่สำเร็จ',

        text:
          'ไม่พบไฟล์ api.js',

        confirmButtonText:
          'ปิด'
      });

      return;
    }

    const page =
      String(
        document.body.dataset.page ||
        ''
      ).trim();

    if (page === 'login') {
      await initializeLoginPage();
      return;
    }

    if (page === 'dashboard') {
      await initializeDashboardPage();
    }
  }

  /************************************************************
   * หน้า Login
   ************************************************************/

  async function initializeLoginPage() {
    bindPasswordToggle();
    bindLoginForm();
    startClock();

    const usernameInput =
      document.getElementById(
        'username'
      );

    if (usernameInput) {
      usernameInput.focus();
    }

    /*
     * ถ้ามี Session อยู่แล้ว
     * ให้เข้าสู่หน้าหลักโดยไม่ต้อง Login ซ้ำ
     */
    try {
      const session =
        await API.me();

      if (
        session &&
        session.authenticated
      ) {
        state.session =
          session;

        if (
          session.user &&
          session.user
            .mustChangePassword
        ) {
          const changed =
            await promptChangePassword({
              force:
                true
            });

          if (!changed) {
            return;
          }
        }

        redirectToDashboard();
      }

    } catch (error) {
      /*
       * 401 บนหน้า Login เป็นสถานะปกติ
       * จึงไม่ต้องแจ้ง Error
       */
      if (
        !isAuthenticationError(
          error
        )
      ) {
        console.warn(
          'ตรวจสอบ Session ไม่สำเร็จ',
          error
        );
      }
    }
  }

  function bindLoginForm() {
    const form =
      document.getElementById(
        'loginForm'
      );

    if (!form) {
      return;
    }

    form.addEventListener(
      'submit',
      handleLoginSubmit
    );
  }

  async function handleLoginSubmit(
    event
  ) {
    event.preventDefault();

    if (state.submitting) {
      return;
    }

    const usernameInput =
      document.getElementById(
        'username'
      );

    const passwordInput =
      document.getElementById(
        'password'
      );

    const submitButton =
      document.getElementById(
        'loginButton'
      );

    const username =
      String(
        usernameInput
          ? usernameInput.value
          : ''
      ).trim();

    let password =
      String(
        passwordInput
          ? passwordInput.value
          : ''
      );

    if (!username) {
      await showWarning(
        'กรุณากรอกชื่อผู้ใช้'
      );

      usernameInput &&
        usernameInput.focus();

      return;
    }

    if (!password) {
      await showWarning(
        'กรุณากรอกรหัสผ่าน'
      );

      passwordInput &&
        passwordInput.focus();

      return;
    }

    state.submitting =
      true;

    setButtonLoading(
      submitButton,
      true,
      'กำลังเข้าสู่ระบบ...'
    );

    showLoading(
      'กำลังเข้าสู่ระบบ',
      'กำลังตรวจสอบชื่อผู้ใช้และรหัสผ่าน'
    );

    try {
      const result =
        await API.login(
          username,
          password
        );

      Swal.close();

      state.session =
        result;

      if (
        result.mustChangePassword ||
        (
          result.user &&
          result.user
            .mustChangePassword
        )
      ) {
        const changed =
          await promptChangePassword({
            force:
              true,

            knownCurrentPassword:
              password
          });

        password = '';

        if (!changed) {
          return;
        }
      }

      await showSuccess(
        'เข้าสู่ระบบสำเร็จ',
        'กำลังเปิดหน้าหลัก'
      );

      redirectToDashboard();

    } catch (error) {
      Swal.close();

      await showApiError(
        error,
        'เข้าสู่ระบบไม่สำเร็จ'
      );

      if (passwordInput) {
        passwordInput.value =
          '';

        passwordInput.focus();
      }

    } finally {
      password = '';

      state.submitting =
        false;

      setButtonLoading(
        submitButton,
        false
      );
    }
  }

  function bindPasswordToggle() {
    const button =
      document.getElementById(
        'togglePassword'
      );

    const input =
      document.getElementById(
        'password'
      );

    if (
      !button ||
      !input
    ) {
      return;
    }

    button.addEventListener(
      'click',
      () => {
        const shouldShow =
          input.type ===
          'password';

        input.type =
          shouldShow
            ? 'text'
            : 'password';

        button.setAttribute(
          'aria-pressed',
          shouldShow
            ? 'true'
            : 'false'
        );

        button.textContent =
          shouldShow
            ? 'ซ่อน'
            : 'แสดง';

        input.focus();
      }
    );
  }

  /************************************************************
   * หน้าหลักหลัง Login
   ************************************************************/

  async function initializeDashboardPage() {
    startClock();
    bindLogoutButton();
    bindChangePasswordButton();
    bindRefreshModulesButton();

    showPageLoading(
      true
    );

    try {
      const session =
        await API.me();

      if (
        !session ||
        !session.authenticated
      ) {
        redirectToLogin();
        return;
      }

      state.session =
        session;

      renderSession(
        session
      );

      if (
        session.user &&
        session.user
          .mustChangePassword
      ) {
        const changed =
          await promptChangePassword({
            force:
              true
          });

        if (!changed) {
          return;
        }

        state.session =
          await API.me();

        renderSession(
          state.session
        );
      }

      await loadModules();

    } catch (error) {
      if (
        isAuthenticationError(
          error
        )
      ) {
        await Swal.fire({
          icon:
            'warning',

          title:
            'กรุณาเข้าสู่ระบบ',

          text:
            'Session หมดอายุหรือยังไม่ได้เข้าสู่ระบบ',

          confirmButtonText:
            'ไปหน้าเข้าสู่ระบบ',

          allowOutsideClick:
            false
        });

        redirectToLogin();
        return;
      }

      await showApiError(
        error,
        'เปิดหน้าหลักไม่สำเร็จ'
      );

    } finally {
      showPageLoading(
        false
      );
    }
  }

  function renderSession(
    session
  ) {
    const user =
      session &&
      session.user
        ? session.user
        : {};

    setText(
      'displayName',
      user.displayName ||
      user.username ||
      '-'
    );

    setText(
      'usernameDisplay',
      user.username || '-'
    );

    setText(
      'roleDisplay',
      user.role === 'ADMIN'
        ? 'ผู้ดูแลระบบ'
        : 'ผู้ใช้งาน'
    );

    setText(
      'sessionExpiry',
      session.expiresAt || '-'
    );

    const roleBadge =
      document.getElementById(
        'roleBadge'
      );

    if (roleBadge) {
      roleBadge.dataset.role =
        user.role || 'USER';
    }
  }

  async function loadModules() {
    const container =
      document.getElementById(
        'moduleList'
      );

    const emptyState =
      document.getElementById(
        'moduleEmpty'
      );

    if (!container) {
      return;
    }

    container.innerHTML =
      '';

    emptyState &&
      emptyState.classList.add(
        'is-hidden'
      );

    setModuleLoading(
      true
    );

    try {
      const modules =
        await API.getModules();

      const list =
        Array.isArray(modules)
          ? modules
          : [];

      setText(
        'moduleCount',
        String(list.length)
      );

      if (
        list.length === 0
      ) {
        emptyState &&
          emptyState.classList.remove(
            'is-hidden'
          );

        return;
      }

      const fragment =
        document.createDocumentFragment();

      list.forEach(
        (module) => {
          fragment.appendChild(
            createModuleCard(
              module
            )
          );
        }
      );

      container.appendChild(
        fragment
      );

    } catch (error) {
      if (
        error &&
        error.code ===
          'PASSWORD_CHANGE_REQUIRED'
      ) {
        const changed =
          await promptChangePassword({
            force:
              true
          });

        if (changed) {
          await loadModules();
        }

        return;
      }

      throw error;

    } finally {
      setModuleLoading(
        false
      );
    }
  }

  function createModuleCard(
    module
  ) {
    const article =
      document.createElement(
        'article'
      );

    article.className =
      'module-card';

    const header =
      document.createElement(
        'div'
      );

    header.className =
      'module-card__header';

    const icon =
      document.createElement(
        'div'
      );

    icon.className =
      'module-card__icon';

    icon.textContent =
      'รถ';

    const titleWrap =
      document.createElement(
        'div'
      );

    const title =
      document.createElement(
        'h3'
      );

    title.className =
      'module-card__title';

    title.textContent =
      module.name ||
      module.id ||
      'โมดูล';

    const status =
      document.createElement(
        'span'
      );

    status.className =
      'module-card__status';

    status.textContent =
      getModuleStatusLabel(
        module.status
      );

    status.dataset.status =
      module.status ||
      'DRAFT';

    titleWrap.appendChild(
      title
    );

    titleWrap.appendChild(
      status
    );

    header.appendChild(
      icon
    );

    header.appendChild(
      titleWrap
    );

    const description =
      document.createElement(
        'p'
      );

    description.className =
      'module-card__description';

    description.textContent =
      module.description ||
      'ไม่มีคำอธิบาย';

    const meta =
      document.createElement(
        'div'
      );

    meta.className =
      'module-card__meta';

    meta.appendChild(
      createMetaItem(
        'รีเฟรช',
        String(
          module.refreshSeconds ||
          30
        ) + ' วินาที'
      )
    );

    meta.appendChild(
      createMetaItem(
        'แจ้งเตือน',
        module.alertEnabled
          ? 'เปิด'
          : 'ปิด'
      )
    );

    meta.appendChild(
      createMetaItem(
        'ปฏิทิน',
        module.calendarEnabled
          ? 'เปิด'
          : 'ปิด'
      )
    );

    const button =
      document.createElement(
        'button'
      );

    button.type =
      'button';

    button.className =
      'button button--primary button--full';

    button.textContent =
      'เปิดหน้าสถานะ';

    button.addEventListener(
      'click',
      () => {
        window.location.href =
          './module.html?id=' +
          encodeURIComponent(
            module.id
          );
      }
    );

    article.appendChild(
      header
    );

    article.appendChild(
      description
    );

    article.appendChild(
      meta
    );

    article.appendChild(
      button
    );

    return article;
  }

  function createMetaItem(
    label,
    value
  ) {
    const item =
      document.createElement(
        'div'
      );

    item.className =
      'module-meta-item';

    const labelElement =
      document.createElement(
        'span'
      );

    labelElement.textContent =
      label;

    const valueElement =
      document.createElement(
        'strong'
      );

    valueElement.textContent =
      value;

    item.appendChild(
      labelElement
    );

    item.appendChild(
      valueElement
    );

    return item;
  }

  function getModuleStatusLabel(
    status
  ) {
    const labels = {
      DRAFT:
        'ฉบับร่าง',

      ADMIN_ONLY:
        'เฉพาะผู้ดูแล',

      PUBLISHED:
        'เปิดใช้งาน'
    };

    return (
      labels[
        String(
          status || ''
        ).toUpperCase()
      ] ||
      'ไม่ทราบสถานะ'
    );
  }

  function bindRefreshModulesButton() {
    const button =
      document.getElementById(
        'refreshModulesButton'
      );

    if (!button) {
      return;
    }

    button.addEventListener(
      'click',
      async () => {
        setButtonLoading(
          button,
          true,
          'กำลังรีเฟรช...'
        );

        try {
          await loadModules();

          showToast(
            'รีเฟรชข้อมูลแล้ว',
            'success'
          );

        } catch (error) {
          await showApiError(
            error,
            'รีเฟรชข้อมูลไม่สำเร็จ'
          );

        } finally {
          setButtonLoading(
            button,
            false
          );
        }
      }
    );
  }

  /************************************************************
   * เปลี่ยนรหัสผ่าน
   ************************************************************/

  function bindChangePasswordButton() {
    const button =
      document.getElementById(
        'changePasswordButton'
      );

    if (!button) {
      return;
    }

    button.addEventListener(
      'click',
      async () => {
        await promptChangePassword({
          force:
            false
        });
      }
    );
  }

  async function promptChangePassword(
    options
  ) {
    const config =
      options &&
      typeof options === 'object'
        ? options
        : {};

    const force =
      Boolean(config.force);

    let knownCurrentPassword =
      String(
        config.knownCurrentPassword ||
        ''
      );

    const result =
      await Swal.fire({
        icon:
          'warning',

        title:
          force
            ? 'ต้องเปลี่ยนรหัสผ่าน'
            : 'เปลี่ยนรหัสผ่าน',

        text:
          force
            ? 'กรุณากำหนดรหัสผ่านใหม่ก่อนใช้งานระบบ'
            : 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 10 ตัวอักษร',

        html:
          createPasswordChangeHtml(
            Boolean(
              knownCurrentPassword
            )
          ),

        showCancelButton:
          !force,

        confirmButtonText:
          'บันทึกรหัสผ่านใหม่',

        cancelButtonText:
          'ยกเลิก',

        reverseButtons:
          true,

        allowOutsideClick:
          false,

        allowEscapeKey:
          !force,

        focusConfirm:
          false,

        customClass: {
          popup:
            'swal-password-popup'
        },

        didOpen:
          () => {
            const firstInput =
              document.getElementById(
                knownCurrentPassword
                  ? 'newPassword'
                  : 'currentPassword'
              );

            firstInput &&
              firstInput.focus();
          },

        preConfirm:
          async () => {
            const currentPassword =
              knownCurrentPassword ||
              getInputValue(
                'currentPassword'
              );

            const newPassword =
              getInputValue(
                'newPassword'
              );

            const confirmPassword =
              getInputValue(
                'confirmNewPassword'
              );

            const validationMessage =
              validatePasswordChange(
                currentPassword,
                newPassword,
                confirmPassword
              );

            if (validationMessage) {
              Swal.showValidationMessage(
                validationMessage
              );

              return false;
            }

            try {
              const response =
                await API.changePassword(
                  currentPassword,
                  newPassword
                );

              return response;

            } catch (error) {
              Swal.showValidationMessage(
                buildErrorMessage(
                  error
                )
              );

              return false;
            }
          }
      });

    knownCurrentPassword =
      '';

    if (!result.isConfirmed) {
      if (force) {
        await API.logout()
          .catch(() => null);

        await Swal.fire({
          icon:
            'warning',

          title:
            'ยังไม่สามารถใช้งานระบบได้',

          text:
            'ต้องเปลี่ยนรหัสผ่านก่อนเข้าสู่หน้าหลัก',

          confirmButtonText:
            'กลับหน้าเข้าสู่ระบบ',

          allowOutsideClick:
            false
        });

        redirectToLogin();
      }

      return false;
    }

    await showSuccess(
      'เปลี่ยนรหัสผ่านสำเร็จ',
      'สามารถใช้งานระบบต่อได้'
    );

    return true;
  }

  function createPasswordChangeHtml(
    hideCurrentPassword
  ) {
    const currentField =
      hideCurrentPassword
        ? ''
        : `
          <label class="swal-form-field">
            <span>รหัสผ่านปัจจุบัน</span>
            <input
              id="currentPassword"
              class="swal2-input"
              type="password"
              autocomplete="current-password"
              maxlength="128"
              placeholder="กรอกรหัสผ่านปัจจุบัน"
            >
          </label>
        `;

    return `
      <div class="swal-form">
        ${currentField}

        <label class="swal-form-field">
          <span>รหัสผ่านใหม่</span>
          <input
            id="newPassword"
            class="swal2-input"
            type="password"
            autocomplete="new-password"
            maxlength="128"
            placeholder="อย่างน้อย 10 ตัวอักษร"
          >
        </label>

        <label class="swal-form-field">
          <span>ยืนยันรหัสผ่านใหม่</span>
          <input
            id="confirmNewPassword"
            class="swal2-input"
            type="password"
            autocomplete="new-password"
            maxlength="128"
            placeholder="กรอกรหัสผ่านใหม่อีกครั้ง"
          >
        </label>

        <div class="password-rule-box">
          ต้องมีตัวอักษรและตัวเลขอย่างน้อยอย่างละ 1 ตัว
        </div>
      </div>
    `;
  }

  function validatePasswordChange(
    currentPassword,
    newPassword,
    confirmPassword
  ) {
    if (!currentPassword) {
      return 'กรุณากรอกรหัสผ่านปัจจุบัน';
    }

    if (!newPassword) {
      return 'กรุณากรอกรหัสผ่านใหม่';
    }

    if (
      newPassword.length < 10
    ) {
      return 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 10 ตัวอักษร';
    }

    if (
      !/[A-Za-zก-๙]/.test(
        newPassword
      ) ||
      !/\d/.test(
        newPassword
      )
    ) {
      return 'รหัสผ่านใหม่ต้องมีตัวอักษรและตัวเลข';
    }

    if (
      currentPassword ===
      newPassword
    ) {
      return 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม';
    }

    if (
      newPassword !==
      confirmPassword
    ) {
      return 'ยืนยันรหัสผ่านใหม่ไม่ตรงกัน';
    }

    return '';
  }

  /************************************************************
   * Logout
   ************************************************************/

  function bindLogoutButton() {
    const button =
      document.getElementById(
        'logoutButton'
      );

    if (!button) {
      return;
    }

    button.addEventListener(
      'click',
      async () => {
        const confirmation =
          await Swal.fire({
            icon:
              'question',

            title:
              'ออกจากระบบ?',

            text:
              'ยืนยันการออกจากระบบ',

            showCancelButton:
              true,

            confirmButtonText:
              'ออกจากระบบ',

            cancelButtonText:
              'ยกเลิก',

            reverseButtons:
              true
          });

        if (
          !confirmation.isConfirmed
        ) {
          return;
        }

        showLoading(
          'กำลังออกจากระบบ',
          'กรุณารอสักครู่'
        );

        try {
          await API.logout();

        } catch (error) {
          console.warn(
            'Logout API ไม่สำเร็จ',
            error
          );

        } finally {
          Swal.close();
        }

        await showSuccess(
          'ออกจากระบบแล้ว',
          ''
        );

        redirectToLogin();
      }
    );
  }

  /************************************************************
   * วันที่และเวลา
   ************************************************************/

  function startClock() {
    updateClock();

    if (state.clockTimer) {
      window.clearInterval(
        state.clockTimer
      );
    }

    state.clockTimer =
      window.setInterval(
        updateClock,
        1000
      );
  }

  function updateClock() {
    const element =
      document.getElementById(
        'currentDateTime'
      );

    if (!element) {
      return;
    }

    element.textContent =
      formatBangkokDateTime(
        new Date()
      );
  }

  function formatBangkokDateTime(
    date
  ) {
    const formatter =
      new Intl.DateTimeFormat(
        'en-GB',
        {
          timeZone:
            CONFIG.TIMEZONE ||
            'Asia/Bangkok',

          day:
            '2-digit',

          month:
            '2-digit',

          year:
            'numeric',

          hour:
            '2-digit',

          minute:
            '2-digit',

          second:
            '2-digit',

          hourCycle:
            'h23'
        }
      );

    const parts = {};

    formatter
      .formatToParts(date)
      .forEach(
        (part) => {
          parts[part.type] =
            part.value;
        }
      );

    return (
      parts.day +
      '/' +
      parts.month +
      '/' +
      parts.year +
      ' ' +
      parts.hour +
      ':' +
      parts.minute +
      ':' +
      parts.second
    );
  }

  /************************************************************
   * SweetAlert helpers
   ************************************************************/

  function showLoading(
    title,
    text
  ) {
    Swal.fire({
      title:
        title ||
        'กำลังดำเนินการ',

      text:
        text || '',

      allowOutsideClick:
        false,

      allowEscapeKey:
        false,

      didOpen:
        () => {
          Swal.showLoading();
        }
    });
  }

  function showSuccess(
    title,
    text
  ) {
    return Swal.fire({
      icon:
        'success',

      title:
        title,

      text:
        text || '',

      confirmButtonText:
        'ตกลง',

      timer:
        text
          ? undefined
          : 1200,

      timerProgressBar:
        true
    });
  }

  function showWarning(
    message
  ) {
    return Swal.fire({
      icon:
        'warning',

      title:
        'ข้อมูลยังไม่ครบ',

      text:
        message,

      confirmButtonText:
        'ตกลง'
    });
  }

  function showToast(
    message,
    icon
  ) {
    return Swal.fire({
      toast:
        true,

      position:
        'top-end',

      icon:
        icon || 'success',

      title:
        message,

      showConfirmButton:
        false,

      timer:
        1800,

      timerProgressBar:
        true
    });
  }

  function showApiError(
    error,
    title
  ) {
    return Swal.fire({
      icon:
        error &&
        error.code ===
          'ACCOUNT_LOCKED'
          ? 'warning'
          : 'error',

      title:
        title ||
        'เกิดข้อผิดพลาด',

      html:
        buildErrorHtml(
          error
        ),

      confirmButtonText:
        'ตกลง'
    });
  }

  function buildErrorHtml(
    error
  ) {
    const message =
      escapeHtml(
        buildErrorMessage(
          error
        )
      );

    const requestId =
      error &&
      error.requestId
        ? String(
            error.requestId
          )
        : '';

    return `
      <div class="swal-error-content">
        <div>${message}</div>

        ${
          requestId
            ? `
              <div class="request-id">
                รหัสอ้างอิง: ${escapeHtml(requestId)}
              </div>
            `
            : ''
        }
      </div>
    `;
  }

  function buildErrorMessage(
    error
  ) {
    if (
      !error
    ) {
      return 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    }

    const errorMessages = {
      INVALID_CREDENTIALS:
        'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',

      ACCOUNT_DISABLED:
        'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ',

      ACCOUNT_LOCKED:
        'บัญชีถูกล็อกชั่วคราว เนื่องจากกรอกรหัสผ่านผิดหลายครั้ง',

      AUTH_REQUIRED:
        'กรุณาเข้าสู่ระบบ',

      SESSION_EXPIRED:
        'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่',

      INVALID_SESSION:
        'Session ไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่',

      PASSWORD_CHANGE_REQUIRED:
        'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งานระบบ',

      PASSWORD_REUSE:
        'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม',

      REQUEST_TIMEOUT:
        'ระบบใช้เวลาตอบกลับนานเกินกำหนด',

      NETWORK_ERROR:
        'ไม่สามารถเชื่อมต่อระบบได้ กรุณาตรวจสอบอินเทอร์เน็ต',

      ORIGIN_NOT_ALLOWED:
        'โดเมนหน้าเว็บนี้ยังไม่ได้รับอนุญาตใน Cloudflare'
    };

    return (
      errorMessages[error.code] ||
      error.message ||
      'เกิดข้อผิดพลาดจากระบบ'
    );
  }

  /************************************************************
   * UI helpers
   ************************************************************/

  function setButtonLoading(
    button,
    loading,
    loadingText
  ) {
    if (!button) {
      return;
    }

    if (loading) {
      if (
        !button.dataset.originalText
      ) {
        button.dataset.originalText =
          button.textContent;
      }

      button.disabled =
        true;

      button.classList.add(
        'is-loading'
      );

      button.textContent =
        loadingText ||
        'กำลังดำเนินการ...';

      return;
    }

    button.disabled =
      false;

    button.classList.remove(
      'is-loading'
    );

    if (
      button.dataset.originalText
    ) {
      button.textContent =
        button.dataset.originalText;
    }
  }

  function showPageLoading(
    show
  ) {
    const overlay =
      document.getElementById(
        'pageLoading'
      );

    if (!overlay) {
      return;
    }

    overlay.classList.toggle(
      'is-hidden',
      !show
    );
  }

  function setModuleLoading(
    show
  ) {
    const element =
      document.getElementById(
        'moduleLoading'
      );

    if (!element) {
      return;
    }

    element.classList.toggle(
      'is-hidden',
      !show
    );
  }

  function setText(
    id,
    value
  ) {
    const element =
      document.getElementById(
        id
      );

    if (element) {
      element.textContent =
        value;
    }
  }

  function getInputValue(
    id
  ) {
    const element =
      document.getElementById(
        id
      );

    return String(
      element
        ? element.value
        : ''
    );
  }

  function isAuthenticationError(
    error
  ) {
    return Boolean(
      error &&
      (
        error.status === 401 ||
        [
          'AUTH_REQUIRED',
          'SESSION_EXPIRED',
          'INVALID_SESSION',
          'INVALID_SESSION_SIGNATURE',
          'SESSION_VERSION_EXPIRED'
        ].includes(
          error.code
        )
      )
    );
  }

  function redirectToLogin() {
    window.location.replace(
      CONFIG.LOGIN_URL ||
      './login.html'
    );
  }

  function redirectToDashboard() {
    window.location.replace(
      CONFIG.DASHBOARD_URL ||
      './index.html'
    );
  }

  function escapeHtml(
    value
  ) {
    return String(
      value || ''
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

})(window, document);
