/**
 * styles.css
 * Mobile First
 */

:root {
  --color-primary:
    #0f3d5e;

  --color-primary-strong:
    #082f49;

  --color-primary-soft:
    #e9f3f9;

  --color-accent:
    #0f766e;

  --color-success:
    #15803d;

  --color-warning:
    #c2410c;

  --color-danger:
    #b91c1c;

  --color-text:
    #172033;

  --color-muted:
    #667085;

  --color-border:
    #d8e0e8;

  --color-surface:
    #ffffff;

  --color-background:
    #f3f6f9;

  --shadow-card:
    0 18px 45px rgba(15, 61, 94, 0.12);

  --radius-large:
    22px;

  --radius-medium:
    14px;

  --radius-small:
    10px;

  --safe-bottom:
    env(safe-area-inset-bottom, 0px);
}

* {
  box-sizing:
    border-box;
}

html {
  min-height:
    100%;

  background:
    var(--color-background);

  -webkit-text-size-adjust:
    100%;
}

body {
  min-height:
    100vh;

  margin:
    0;

  color:
    var(--color-text);

  background:
    var(--color-background);

  font-family:
    "Noto Sans Thai",
    "Leelawadee UI",
    Tahoma,
    Arial,
    sans-serif;

  line-height:
    1.5;
}

button,
input {
  font:
    inherit;
}

button {
  -webkit-tap-highlight-color:
    transparent;
}

button:focus-visible,
input:focus-visible {
  outline:
    3px solid rgba(15, 118, 110, 0.22);

  outline-offset:
    2px;
}

.is-hidden {
  display:
    none !important;
}

.eyebrow {
  margin:
    0 0 4px;

  color:
    var(--color-accent);

  font-size:
    0.72rem;

  font-weight:
    800;

  letter-spacing:
    0.08em;
}

.button {
  min-height:
    46px;

  border:
    0;

  border-radius:
    12px;

  padding:
    11px 16px;

  cursor:
    pointer;

  font-weight:
    750;

  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease,
    opacity 0.15s ease,
    background 0.15s ease;
}

.button:active {
  transform:
    translateY(1px);
}

.button:disabled {
  cursor:
    not-allowed;

  opacity:
    0.65;
}

.button--primary {
  color:
    #ffffff;

  background:
    linear-gradient(
      135deg,
      var(--color-primary),
      #145b82
    );

  box-shadow:
    0 9px 22px rgba(15, 61, 94, 0.2);
}

.button--primary:hover {
  box-shadow:
    0 12px 28px rgba(15, 61, 94, 0.26);
}

.button--secondary {
  color:
    var(--color-primary);

  border:
    1px solid var(--color-border);

  background:
    var(--color-surface);
}

.button--danger-ghost {
  color:
    var(--color-danger);

  border:
    1px solid #fecaca;

  background:
    #fff7f7;
}

.button--compact {
  min-height:
    40px;

  padding:
    8px 12px;

  font-size:
    0.84rem;
}

.button--full {
  width:
    100%;
}

.button--login {
  width:
    100%;

  min-height:
    50px;

  margin-top:
    4px;

  font-size:
    1rem;
}

.button.is-loading {
  position:
    relative;
}

/************************************************************
 * หน้า Login
 ************************************************************/

.login-page {
  background:
    radial-gradient(
      circle at top right,
      rgba(15, 118, 110, 0.16),
      transparent 38%
    ),
    linear-gradient(
      145deg,
      #eef4f8,
      #f8fafc 55%,
      #e7f0f5
    );
}

.login-layout {
  min-height:
    100vh;

  display:
    grid;

  place-items:
    center;

  padding:
    20px 14px
    calc(
      20px +
      var(--safe-bottom)
    );
}

.login-card {
  width:
    min(100%, 430px);

  padding:
    26px 20px 20px;

  border:
    1px solid rgba(216, 224, 232, 0.9);

  border-radius:
    var(--radius-large);

  background:
    rgba(255, 255, 255, 0.96);

  box-shadow:
    var(--shadow-card);
}

.brand-mark {
  width:
    62px;

  height:
    62px;

  display:
    grid;

  place-items:
    center;

  margin:
    0 auto 15px;

  color:
    #ffffff;

  border-radius:
    18px;

  background:
    linear-gradient(
      145deg,
      var(--color-primary),
      var(--color-accent)
    );

  box-shadow:
    0 12px 28px rgba(15, 61, 94, 0.22);
}

.brand-mark svg {
  width:
    39px;

  height:
    39px;
}

.login-header {
  text-align:
    center;
}

.login-header h1 {
  margin:
    0;

  font-size:
    clamp(
      1.25rem,
      5vw,
      1.65rem
    );

  line-height:
    1.3;
}

.login-header p:not(.eyebrow) {
  margin:
    8px 0 0;

  color:
    var(--color-muted);

  font-size:
    0.9rem;
}

.date-time-panel {
  display:
    flex;

  align-items:
    center;

  justify-content:
    space-between;

  gap:
    12px;

  margin:
    20px 0 16px;

  padding:
    10px 12px;

  border:
    1px solid #dbe7ee;

  border-radius:
    12px;

  background:
    var(--color-primary-soft);
}

.date-time-panel span {
  color:
    var(--color-muted);

  font-size:
    0.75rem;
}

.date-time-panel strong {
  color:
    var(--color-primary);

  font-size:
    0.8rem;

  font-variant-numeric:
    tabular-nums;

  white-space:
    nowrap;
}

.login-form {
  display:
    grid;

  gap:
    14px;
}

.form-field {
  display:
    grid;

  gap:
    6px;
}

.form-label {
  color:
    #344054;

  font-size:
    0.86rem;

  font-weight:
    700;
}

.form-field input {
  width:
    100%;

  min-height:
    48px;

  border:
    1px solid var(--color-border);

  border-radius:
    12px;

  padding:
    11px 13px;

  color:
    var(--color-text);

  background:
    #ffffff;

  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.form-field input::placeholder {
  color:
    #98a2b3;
}

.form-field input:focus {
  border-color:
    var(--color-accent);

  box-shadow:
    0 0 0 4px rgba(15, 118, 110, 0.1);

  outline:
    0;
}

.password-control {
  position:
    relative;

  display:
    block;
}

.password-control input {
  padding-right:
    70px;
}

.password-toggle {
  position:
    absolute;

  top:
    50%;

  right:
    8px;

  min-width:
    54px;

  min-height:
    34px;

  border:
    0;

  border-radius:
    8px;

  color:
    var(--color-primary);

  background:
    var(--color-primary-soft);

  cursor:
    pointer;

  transform:
    translateY(-50%);

  font-size:
    0.78rem;

  font-weight:
    750;
}

.login-footer {
  display:
    flex;

  align-items:
    center;

  justify-content:
    center;

  gap:
    7px;

  margin-top:
    17px;

  color:
    var(--color-muted);

  font-size:
    0.74rem;

  text-align:
    center;
}

.security-dot {
  width:
    8px;

  height:
    8px;

  border-radius:
    999px;

  background:
    var(--color-success);

  box-shadow:
    0 0 0 4px rgba(21, 128, 61, 0.1);
}

.noscript-message {
  position:
    fixed;

  inset:
    auto 12px 12px;

  padding:
    12px;

  border-radius:
    10px;

  color:
    #ffffff;

  background:
    var(--color-danger);

  text-align:
    center;
}

/************************************************************
 * Dashboard
 ************************************************************/

.dashboard-page {
  padding-bottom:
    calc(
      20px +
      var(--safe-bottom)
    );
}

.app-header {
  position:
    sticky;

  top:
    0;

  z-index:
    20;

  border-bottom:
    1px solid rgba(216, 224, 232, 0.9);

  background:
    rgba(255, 255, 255, 0.94);

  backdrop-filter:
    blur(16px);
}

.app-header__content {
  width:
    min(100%, 1180px);

  display:
    flex;

  flex-direction:
    column;

  gap:
    10px;

  margin:
    0 auto;

  padding:
    11px 14px;
}

.app-brand {
  display:
    flex;

  align-items:
    center;

  gap:
    10px;
}

.app-brand__icon {
  width:
    42px;

  height:
    42px;

  display:
    grid;

  flex:
    0 0 auto;

  place-items:
    center;

  color:
    #ffffff;

  border-radius:
    12px;

  background:
    linear-gradient(
      145deg,
      var(--color-primary),
      var(--color-accent)
    );

  font-size:
    0.78rem;

  font-weight:
    800;
}

.app-brand p {
  margin:
    0;

  color:
    var(--color-accent);

  font-size:
    0.63rem;

  font-weight:
    800;

  letter-spacing:
    0.07em;
}

.app-brand h1 {
  margin:
    1px 0 0;

  font-size:
    0.98rem;

  line-height:
    1.25;
}

.header-actions {
  display:
    grid;

  grid-template-columns:
    1fr 1fr;

  gap:
    8px;
}

.dashboard-container {
  width:
    min(100%, 1180px);

  margin:
    0 auto;

  padding:
    14px;
}

.welcome-panel {
  display:
    grid;

  gap:
    14px;

  padding:
    18px;

  border:
    1px solid var(--color-border);

  border-radius:
    var(--radius-large);

  background:
    linear-gradient(
      145deg,
      #ffffff,
      #f5f9fb
    );

  box-shadow:
    0 10px 28px rgba(15, 61, 94, 0.08);
}

.welcome-panel h2 {
  margin:
    0;

  font-size:
    1.35rem;
}

.user-detail-row {
  display:
    flex;

  flex-wrap:
    wrap;

  align-items:
    center;

  gap:
    8px 12px;

  margin-top:
    7px;

  color:
    var(--color-muted);

  font-size:
    0.82rem;
}

.role-badge {
  display:
    inline-flex;

  align-items:
    center;

  min-height:
    28px;

  padding:
    4px 9px;

  border-radius:
    999px;

  color:
    #1d4ed8;

  background:
    #dbeafe;

  font-size:
    0.75rem;
}

.role-badge[data-role="ADMIN"] {
  color:
    #7c2d12;

  background:
    #ffedd5;
}

.welcome-time {
  display:
    grid;

  gap:
    3px;

  padding:
    12px;

  border-radius:
    12px;

  background:
    var(--color-primary-soft);
}

.welcome-time > span,
.welcome-time small {
  color:
    var(--color-muted);

  font-size:
    0.72rem;
}

.welcome-time strong {
  color:
    var(--color-primary);

  font-size:
    0.95rem;

  font-variant-numeric:
    tabular-nums;
}

.summary-grid {
  display:
    grid;

  grid-template-columns:
    repeat(2, minmax(0, 1fr));

  gap:
    10px;

  margin-top:
    12px;
}

.summary-card {
  min-width:
    0;

  padding:
    14px;

  border:
    1px solid var(--color-border);

  border-radius:
    var(--radius-medium);

  background:
    var(--color-surface);
}

.summary-card__label {
  display:
    block;

  color:
    var(--color-muted);

  font-size:
    0.72rem;
}

.summary-card__value {
  display:
    inline-block;

  margin-top:
    5px;

  color:
    var(--color-primary);

  font-size:
    1.75rem;

  line-height:
    1;
}

.summary-card__unit {
  margin-left:
    3px;

  color:
    var(--color-muted);

  font-size:
    0.74rem;
}

.summary-card__status {
  display:
    block;

  margin-top:
    5px;

  color:
    var(--color-success);

  font-size:
    1rem;
}

.connection-indicator {
  display:
    inline-flex;

  align-items:
    center;

  gap:
    6px;

  margin-top:
    6px;

  color:
    var(--color-muted);

  font-size:
    0.7rem;
}

.connection-indicator span {
  width:
    7px;

  height:
    7px;

  border-radius:
    999px;

  background:
    var(--color-success);
}

.module-section {
  margin-top:
    20px;
}

.section-heading {
  display:
    flex;

  align-items:
    flex-end;

  justify-content:
    space-between;

  gap:
    12px;

  margin-bottom:
    11px;
}

.section-heading h2 {
  margin:
    0;

  font-size:
    1.08rem;
}

.module-grid {
  display:
    grid;

  grid-template-columns:
    1fr;

  gap:
    12px;
}

.module-card {
  display:
    grid;

  gap:
    12px;

  min-width:
    0;

  padding:
    15px;

  border:
    1px solid var(--color-border);

  border-radius:
    var(--radius-medium);

  background:
    var(--color-surface);

  box-shadow:
    0 7px 20px rgba(15, 61, 94, 0.06);
}

.module-card__header {
  display:
    flex;

  align-items:
    center;

  gap:
    10px;
}

.module-card__icon {
  width:
    43px;

  height:
    43px;

  display:
    grid;

  flex:
    0 0 auto;

  place-items:
    center;

  border-radius:
    12px;

  color:
    var(--color-primary);

  background:
    var(--color-primary-soft);

  font-size:
    0.75rem;

  font-weight:
    800;
}

.module-card__title {
  margin:
    0;

  font-size:
    1rem;
}

.module-card__status {
  display:
    inline-block;

  margin-top:
    4px;

  padding:
    2px 7px;

  border-radius:
    999px;

  color:
    #475467;

  background:
    #f2f4f7;

  font-size:
    0.65rem;
}

.module-card__status[data-status="PUBLISHED"] {
  color:
    #166534;

  background:
    #dcfce7;
}

.module-card__status[data-status="ADMIN_ONLY"] {
  color:
    #9a3412;

  background:
    #ffedd5;
}

.module-card__description {
  min-height:
    42px;

  margin:
    0;

  color:
    var(--color-muted);

  font-size:
    0.8rem;
}

.module-card__meta {
  display:
    grid;

  grid-template-columns:
    repeat(3, minmax(0, 1fr));

  gap:
    7px;
}

.module-meta-item {
  min-width:
    0;

  padding:
    8px;

  border-radius:
    9px;

  background:
    #f7f9fb;

  text-align:
    center;
}

.module-meta-item span,
.module-meta-item strong {
  display:
    block;

  overflow:
    hidden;

  text-overflow:
    ellipsis;

  white-space:
    nowrap;
}

.module-meta-item span {
  color:
    var(--color-muted);

  font-size:
    0.62rem;
}

.module-meta-item strong {
  margin-top:
    2px;

  font-size:
    0.72rem;
}

.inline-loading,
.empty-state {
  display:
    flex;

  align-items:
    center;

  justify-content:
    center;

  gap:
    10px;

  min-height:
    120px;

  padding:
    20px;

  border:
    1px dashed #cbd5e1;

  border-radius:
    var(--radius-medium);

  color:
    var(--color-muted);

  background:
    rgba(255, 255, 255, 0.55);

  font-size:
    0.82rem;
}

.empty-state {
  flex-direction:
    column;

  text-align:
    center;
}

.app-footer {
  padding:
    6px 14px
    calc(
      10px +
      var(--safe-bottom)
    );

  color:
    var(--color-muted);

  font-size:
    0.68rem;

  text-align:
    center;
}

/************************************************************
 * Loading
 ************************************************************/

.page-loading {
  position:
    fixed;

  inset:
    0;

  z-index:
    9999;

  display:
    grid;

  place-content:
    center;

  justify-items:
    center;

  gap:
    12px;

  color:
    var(--color-primary);

  background:
    rgba(243, 246, 249, 0.94);

  font-size:
    0.84rem;
}

.spinner {
  width:
    38px;

  height:
    38px;

  border:
    4px solid #dbe7ee;

  border-top-color:
    var(--color-primary);

  border-radius:
    999px;

  animation:
    spin 0.8s linear infinite;
}

.spinner--small {
  width:
    23px;

  height:
    23px;

  border-width:
    3px;
}

@keyframes spin {
  to {
    transform:
      rotate(360deg);
  }
}

/************************************************************
 * SweetAlert2
 ************************************************************/

.swal2-popup {
  border-radius:
    18px !important;

  font-family:
    inherit !important;
}

.swal2-title {
  color:
    var(--color-text) !important;

  font-size:
    1.25rem !important;
}

.swal2-confirm,
.swal2-cancel {
  min-height:
    42px;

  border-radius:
    10px !important;

  font-weight:
    700 !important;
}

.swal2-confirm {
  background:
    var(--color-primary) !important;
}

.swal2-cancel {
  color:
    #344054 !important;

  background:
    #e8edf2 !important;
}

.swal-form {
  display:
    grid;

  gap:
    10px;

  margin-top:
    4px;

  text-align:
    left;
}

.swal-form-field {
  display:
    grid;

  gap:
    5px;
}

.swal-form-field > span {
  color:
    #344054;

  font-size:
    0.78rem;

  font-weight:
    700;
}

.swal-form-field .swal2-input {
  width:
    100%;

  height:
    45px;

  margin:
    0 !important;

  border-radius:
    10px;

  font-size:
    0.9rem;
}

.password-rule-box {
  padding:
    9px 10px;

  border-radius:
    9px;

  color:
    #475467;

  background:
    #f2f4f7;

  font-size:
    0.72rem;
}

.swal-error-content {
  color:
    #475467;

  font-size:
    0.88rem;

  line-height:
    1.6;
}

.request-id {
  margin-top:
    10px;

  padding:
    7px;

  border-radius:
    8px;

  color:
    #667085;

  background:
    #f2f4f7;

  font-size:
    0.67rem;

  word-break:
    break-all;
}

/************************************************************
 * Responsive
 ************************************************************/

@media (min-width: 640px) {
  .login-card {
    padding:
      32px 30px 25px;
  }

  .app-header__content {
    flex-direction:
      row;

    align-items:
      center;

    justify-content:
      space-between;

    padding:
      12px 20px;
  }

  .header-actions {
    display:
      flex;
  }

  .dashboard-container {
    padding:
      20px;
  }

  .welcome-panel {
    grid-template-columns:
      minmax(0, 1fr)
      auto;

    align-items:
      center;
  }

  .welcome-time {
    min-width:
      260px;
  }

  .module-grid {
    grid-template-columns:
      repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 960px) {
  .module-grid {
    grid-template-columns:
      repeat(3, minmax(0, 1fr));
  }

  .summary-grid {
    max-width:
      520px;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior:
      auto !important;

    animation-duration:
      0.01ms !important;

    animation-iteration-count:
      1 !important;

    transition-duration:
      0.01ms !important;
  }
}
