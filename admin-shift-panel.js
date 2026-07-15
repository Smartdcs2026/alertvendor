/**
 * admin-shift-panel.css
 * ROUND 58 — Shift Management inside admin.html
 */

.admin-shift-heading {
  align-items: flex-end;
}

.admin-shift-heading__actions,
.admin-shift-stat-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.admin-shift-heading__actions a {
  text-decoration: none;
}

.admin-shift-message {
  border: 1px solid #cbdbe2;
  border-radius: 12px;
  margin-bottom: 14px;
  padding: 12px 14px;
  color: #35566a;
  background: #f5f9fa;
  font-size: .88rem;
  font-weight: 800;
}

.admin-shift-message[hidden] {
  display: none !important;
}

.admin-shift-message[data-status="ERROR"] {
  border-color: #efb6b6;
  color: #a22121;
  background: #fff3f3;
}

.admin-shift-message[data-status="WARNING"] {
  border-color: #efd49f;
  color: #99600a;
  background: #fff9e9;
}

.admin-shift-config-card,
.admin-shift-statistics-card {
  overflow: hidden;
  margin-bottom: 16px;
}

.admin-shift-toolbar {
  display: grid;
  grid-template-columns:
    minmax(260px, 1.7fr)
    minmax(150px, .8fr)
    minmax(150px, .8fr)
    auto;
  align-items: end;
  gap: 10px;
  border-bottom: 1px solid #dfe7eb;
  padding: 16px;
  background: #f7fafb;
}

.admin-shift-module-field select {
  min-height: 44px;
  font-weight: 850;
}

.admin-shift-current-status {
  min-height: 66px;
  display: grid;
  align-content: center;
  gap: 5px;
  border: 1px solid #d8e3e8;
  border-radius: 10px;
  padding: 9px 11px;
  background: #ffffff;
}

.admin-shift-current-status span {
  color: #73858f;
  font-size: .72rem;
  font-weight: 750;
}

.admin-shift-current-status strong {
  color: #173e54;
  font-size: .95rem;
  overflow-wrap: anywhere;
}

#adminShiftStatusBadge {
  width: max-content;
  border-radius: 999px;
  padding: 5px 9px;
  color: #5d707b;
  background: #eaf0f2;
  font-size: .78rem;
}

#adminShiftStatusBadge[data-status="ENABLED"] {
  color: #08734f;
  background: #dcf6e9;
}

#adminShiftStatusBadge[data-status="DISABLED"] {
  color: #9b2828;
  background: #ffe9e9;
}

.admin-shift-config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 20px 12px;
}

.admin-shift-config-header h3 {
  margin: 4px 0;
}

.admin-shift-config-header p {
  margin: 0;
  color: #70828d;
}

.admin-shift-enable {
  min-width: 220px;
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  border: 1px solid #cbdbe2;
  border-radius: 999px;
  padding: 9px 14px;
  color: #264b5e;
  background: #f1f7f8;
  cursor: pointer;
  font-weight: 900;
}

.admin-shift-enable input {
  width: 20px;
  height: 20px;
  accent-color: #087d66;
}

.admin-shift-general-grid {
  display: grid;
  grid-template-columns:
    repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding: 8px 20px 20px;
}

.admin-shift-general-grid .admin-field {
  min-width: 0;
}

.admin-shift-general-grid input {
  width: 100%;
}

.admin-shift-general-grid small {
  color: #7b8c95;
  font-size: .7rem;
  line-height: 1.45;
}

.admin-shift-list-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border-top: 1px solid #dde6ea;
  border-bottom: 1px solid #dde6ea;
  padding: 12px 20px;
  background: #f7f9fa;
}

.admin-shift-list-heading strong,
.admin-shift-list-heading span {
  display: block;
}

.admin-shift-list-heading strong {
  color: #183f54;
  font-size: 1rem;
}

.admin-shift-list-heading span {
  margin-top: 3px;
  color: #748690;
  font-size: .76rem;
}

.admin-shift-rows {
  display: grid;
  padding: 7px 20px;
}

.admin-shift-row {
  min-width: 0;
  display: grid;
  grid-template-columns:
    90px minmax(150px, 1.4fr)
    132px 132px 100px 72px;
  align-items: end;
  gap: 9px;
  border-bottom: 1px solid #e2e9ec;
  padding: 10px 0;
}

.admin-shift-row:last-child {
  border-bottom: 0;
}

.admin-shift-row .admin-field {
  min-width: 0;
}

.admin-shift-row .admin-field input {
  width: 100%;
  min-height: 41px;
}

.admin-shift-active-toggle {
  min-height: 41px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid #d3dfe4;
  border-radius: 9px;
  padding: 8px;
  color: #345566;
  background: #f5f8f9;
  cursor: pointer;
  font-size: .8rem;
  font-weight: 850;
}

.admin-shift-active-toggle input {
  width: 18px;
  height: 18px;
  accent-color: #087d66;
}

.admin-shift-remove {
  min-height: 41px;
  border: 1px solid #e9b7b7;
  border-radius: 9px;
  color: #a72525;
  background: #fff5f5;
  cursor: pointer;
  font: inherit;
  font-size: .8rem;
  font-weight: 850;
}

.admin-shift-remove:disabled {
  opacity: .4;
  cursor: not-allowed;
}

.admin-shift-validation {
  display: grid;
  grid-template-columns:
    repeat(3, minmax(0, 1fr));
  gap: 8px;
  border-top: 1px solid #dde6ea;
  padding: 12px 20px;
  background: #f7fafb;
}

.admin-shift-validation > div {
  min-width: 0;
  display: grid;
  gap: 4px;
  border: 1px solid #dbe5e9;
  border-radius: 9px;
  padding: 10px 12px;
  background: #ffffff;
}

.admin-shift-validation span {
  color: #748690;
  font-size: .7rem;
}

.admin-shift-validation strong {
  color: #26495b;
  font-size: .84rem;
  overflow-wrap: anywhere;
}

#adminShiftValidationStatus[data-status="VALID"] {
  color: #08734f;
}

#adminShiftValidationStatus[data-status="WARNING"] {
  color: #b16a05;
}

#adminShiftValidationStatus[data-status="ERROR"] {
  color: #c52626;
}

.admin-shift-save-actions {
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid #dfe7eb;
  padding: 14px 20px;
}

.admin-shift-save-actions > span {
  color: #6e818c;
  font-size: .78rem;
  font-weight: 750;
}

.admin-shift-statistics-card .admin-card__header p {
  margin: 4px 0 0;
  color: #71838d;
  font-size: .78rem;
}

.admin-shift-summary-grid {
  display: grid;
  grid-template-columns:
    repeat(4, minmax(0, 1fr));
  gap: 9px;
  padding: 14px 16px;
}

.admin-shift-summary-grid > div {
  min-width: 0;
  min-height: 78px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 5px;
  border: 1px solid #d7e2e7;
  border-radius: 10px;
  padding: 10px;
  background: #f8fafb;
  text-align: center;
}

.admin-shift-summary-grid span {
  color: #72848e;
  font-size: .72rem;
  font-weight: 800;
}

.admin-shift-summary-grid strong {
  color: #173f55;
  font-size: 1.15rem;
  font-weight: 950;
  overflow-wrap: anywhere;
}

.admin-shift-table-wrap {
  overflow-x: auto;
  border-top: 1px solid #e0e8eb;
}

.admin-shift-table {
  width: 100%;
  min-width: 980px;
  border-collapse: collapse;
}

.admin-shift-table th,
.admin-shift-table td {
  border-bottom: 1px solid #e3eaed;
  padding: 10px 9px;
  color: #3e5b6b;
  font-size: .76rem;
  text-align: left;
  white-space: nowrap;
}

.admin-shift-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: #5d7380;
  background: #f4f7f8;
  font-weight: 900;
}

.admin-shift-table td:first-child {
  font-weight: 850;
}

.admin-shift-table td:nth-child(2) strong,
.admin-shift-table td:nth-child(2) small {
  display: block;
}

.admin-shift-table td:nth-child(2) small {
  margin-top: 2px;
  color: #7c8d96;
  font-size: .66rem;
}

.admin-shift-table tbody tr:hover {
  background: #f8fbfc;
}

.admin-shift-table-status {
  display: inline-flex;
  border-radius: 999px;
  padding: 4px 7px;
  color: #5b707c;
  background: #eaf0f2;
  font-size: .68rem;
  font-weight: 900;
}

.admin-shift-table-status[data-status="FINAL"] {
  color: #08704e;
  background: #def5e9;
}

.admin-shift-table-status[data-status="PROVISIONAL"] {
  color: #a66507;
  background: #fff0ce;
}

.admin-shift-danger-text {
  color: #c82828;
}

.admin-shift-loading {
  min-height: 130px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  color: #6f818b;
  font-size: .86rem;
  font-weight: 800;
}

.admin-shift-loading span {
  width: 25px;
  height: 25px;
  border: 3px solid #d8e5e9;
  border-top-color: #0d7189;
  border-radius: 50%;
  animation:
    adminShiftSpin
    .8s linear infinite;
}

.admin-shift-result {
  display: grid;
  grid-template-columns:
    repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.admin-shift-result span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid #dce5e9;
  border-radius: 8px;
  padding: 9px;
  color: #5c717e;
  background: #f7f9fa;
}

.admin-shift-result strong {
  color: #173f55;
  font-size: 1rem;
}

@keyframes adminShiftSpin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1050px) {
  .admin-shift-toolbar {
    grid-template-columns:
      repeat(2, minmax(0, 1fr));
  }

  .admin-shift-row {
    grid-template-columns:
      80px minmax(150px, 1fr)
      120px 120px;
  }

  .admin-shift-active-toggle,
  .admin-shift-remove {
    min-height: 38px;
  }

  .admin-shift-validation {
    grid-template-columns:
      repeat(2, minmax(0, 1fr));
  }

  .admin-shift-validation > div:last-child {
    grid-column: 1 / -1;
  }
}

@media (max-width: 760px) {
  .admin-tabs {
    overflow-x: auto;
    flex-wrap: nowrap;
    scrollbar-width: thin;
  }

  .admin-tab {
    flex: 0 0 auto;
  }

  .admin-shift-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .admin-shift-heading__actions,
  .admin-shift-stat-actions {
    width: 100%;
    justify-content: stretch;
  }

  .admin-shift-heading__actions > *,
  .admin-shift-stat-actions > * {
    flex: 1 1 150px;
  }

  .admin-shift-toolbar,
  .admin-shift-general-grid {
    grid-template-columns: 1fr;
  }

  .admin-shift-config-header {
    align-items: stretch;
    flex-direction: column;
  }

  .admin-shift-enable {
    min-width: 0;
    width: 100%;
  }

  .admin-shift-row {
    grid-template-columns:
      repeat(2, minmax(0, 1fr));
    gap: 7px;
    border: 1px solid #dce5e9;
    border-radius: 10px;
    margin: 5px 0;
    padding: 10px;
    background: #ffffff;
  }

  .admin-shift-active-toggle,
  .admin-shift-remove {
    min-height: 41px;
  }

  .admin-shift-validation,
  .admin-shift-summary-grid {
    grid-template-columns:
      repeat(2, minmax(0, 1fr));
  }

  .admin-shift-validation > div:last-child {
    grid-column: auto;
  }

  .admin-shift-save-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .admin-shift-save-actions button {
    width: 100%;
  }

  .admin-shift-statistics-card
  .admin-card__header {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (max-width: 420px) {
  .admin-shift-toolbar,
  .admin-shift-general-grid,
  .admin-shift-rows,
  .admin-shift-validation,
  .admin-shift-summary-grid {
    padding-left: 10px;
    padding-right: 10px;
  }

  .admin-shift-config-header,
  .admin-shift-list-heading,
  .admin-shift-save-actions {
    padding-left: 12px;
    padding-right: 12px;
  }

  .admin-shift-row {
    grid-template-columns:
      repeat(2, minmax(0, 1fr));
  }

  .admin-shift-current-status {
    min-height: 58px;
  }

  .admin-shift-summary-grid > div {
    min-height: 65px;
  }

  .admin-shift-summary-grid strong {
    font-size: .96rem;
  }
}


/* ROUND 59 — Module loading recovery */
.admin-shift-message {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.admin-shift-message[hidden] {
  display: none !important;
}

.admin-shift-message > span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.admin-shift-message > button {
  flex: 0 0 auto;
}

.admin-shift-load-error {
  min-height: 150px;
  flex-direction: column;
  color: #9f2828;
  text-align: center;
}

.admin-shift-load-error strong,
.admin-shift-load-error span {
  display: block;
}

.admin-shift-load-error span {
  max-width: 680px;
  color: #735454;
  font-size: .78rem;
  font-weight: 650;
}

@media (max-width: 600px) {
  .admin-shift-message {
    align-items: stretch;
    flex-direction: column;
  }

  .admin-shift-message > button {
    width: 100%;
  }
}

/* =========================================================
 * ADMIN SLA & ALERT CONTROL
 * ========================================================= */

.admin-sla-heading__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.admin-sla-card {
  overflow: hidden;
}

.admin-sla-toolbar {
  display: grid;
  grid-template-columns:
    minmax(250px, 1.35fr)
    repeat(3, minmax(150px, .65fr));
  gap: 10px;
  padding: 16px;
  border-bottom: 1px solid #dce7ed;
  background: #f8fbfc;
}

.admin-sla-module-field {
  margin: 0;
}

.admin-sla-status-box {
  min-width: 0;
  min-height: 74px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  padding: 10px 12px;
  border: 1px solid #dbe6ec;
  border-radius: 12px;
  background: #ffffff;
}

.admin-sla-status-box span {
  color: #657d89;
  font-size: .75rem;
  font-weight: 800;
}

.admin-sla-status-box strong {
  overflow: hidden;
  color: #123d51;
  font-size: .94rem;
  font-weight: 950;
  text-overflow: ellipsis;
  white-space: nowrap;
}

#adminSlaStatus[data-status="READY"] {
  color: #08745c;
}

#adminSlaStatus[data-status="WARNING"] {
  color: #a76500;
}

#adminSlaStatus[data-status="ERROR"] {
  color: #c72f2f;
}

.admin-sla-notice {
  display: grid;
  gap: 4px;
  margin: 14px 16px 0;
  padding: 11px 13px;
  border-left: 4px solid #0c809c;
  border-radius: 10px;
  background: #eff8fa;
}

.admin-sla-notice strong {
  color: #075f78;
}

.admin-sla-notice span {
  color: #153f51;
  font-weight: 850;
}

.admin-sla-notice small {
  color: #607985;
}

.admin-sla-rule-grid {
  display: grid;
  grid-template-columns:
    repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 16px;
}

.admin-sla-loading {
  min-height: 150px;
  display: grid;
  place-items: center;
  grid-column: 1 / -1;
  border: 1px dashed #bad0db;
  border-radius: 12px;
  background: #f8fbfc;
  color: #607985;
  font-weight: 800;
}

.admin-sla-rule-card {
  min-width: 0;
  display: grid;
  gap: 11px;
  padding: 13px;
  border: 1px solid #d7e3e9;
  border-top: 4px solid #0c809c;
  border-radius: 13px;
  background: #ffffff;
  box-shadow: 0 6px 18px rgba(11, 60, 82, .055);
}

.admin-sla-rule-card[data-configured="FALSE"] {
  border-top-color: #d58b13;
  background: #fffdf8;
}

.admin-sla-rule-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.admin-sla-rule-card__title {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.admin-sla-rule-card__title span {
  color: #64808e;
  font-size: .7rem;
  font-weight: 950;
  letter-spacing: .05em;
}

.admin-sla-rule-card__title strong {
  color: #103e53;
  font-size: 1rem;
  line-height: 1.2;
}

.admin-sla-source-badge {
  flex: 0 0 auto;
  min-height: 25px;
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 999px;
  background: #e8f7f2;
  color: #08745c;
  font-size: .7rem;
  font-weight: 950;
}

.admin-sla-source-badge[data-source="DEFAULT"] {
  background: #edf2ff;
  color: #315eb3;
}

.admin-sla-source-badge[data-source="MISSING"] {
  background: #fff2dc;
  color: #9a6108;
}

.admin-sla-flow {
  display: grid;
  grid-template-columns:
    minmax(0, 1fr)
    auto
    minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  padding: 8px 9px;
  border-radius: 9px;
  background: #eef5f8;
}

.admin-sla-flow span {
  min-width: 0;
  overflow: hidden;
  color: #254e60;
  font-size: .75rem;
  font-weight: 850;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.admin-sla-flow b {
  color: #0b7894;
}

.admin-sla-fields {
  display: grid;
  grid-template-columns:
    repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.admin-sla-fields label {
  min-width: 0;
  display: grid;
  gap: 5px;
}

.admin-sla-fields label > span {
  color: #607985;
  font-size: .72rem;
  font-weight: 850;
}

.admin-sla-fields input {
  width: 100%;
  min-height: 39px;
  padding: 7px 9px;
  border: 1px solid #cadbe3;
  border-radius: 9px;
  background: #ffffff;
  color: #123d51;
  font-weight: 900;
  box-sizing: border-box;
}

.admin-sla-toggles {
  display: grid;
  grid-template-columns:
    repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.admin-sla-toggle {
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #d7e3e9;
  border-radius: 9px;
  background: #f8fbfc;
  color: #274e60;
  font-size: .76rem;
  font-weight: 850;
}

.admin-sla-toggle input {
  width: 18px;
  height: 18px;
  accent-color: #087f97;
}

.admin-sla-rule-card__meta {
  min-height: 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #718692;
  font-size: .68rem;
}

.admin-sla-rule-card__meta span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.admin-sla-validation {
  display: grid;
  grid-template-columns:
    repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 0 16px 16px;
}

.admin-sla-validation > div {
  display: grid;
  gap: 3px;
  padding: 9px 11px;
  border: 1px solid #dce7ed;
  border-radius: 10px;
  background: #f8fbfc;
}

.admin-sla-validation span {
  color: #6a818c;
  font-size: .7rem;
  font-weight: 800;
}

.admin-sla-validation strong {
  color: #173f51;
  font-size: .78rem;
}

.admin-sla-save-actions {
  border-top: 1px solid #dce7ed;
}

@media (max-width: 1100px) {
  .admin-sla-toolbar {
    grid-template-columns:
      repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 820px) {
  .admin-sla-rule-grid,
  .admin-sla-validation {
    grid-template-columns: 1fr;
  }

  .admin-sla-fields {
    grid-template-columns:
      repeat(2, minmax(0, 1fr));
  }

  .admin-sla-fields label:last-child {
    grid-column: 1 / -1;
  }
}

@media (max-width: 600px) {
  .admin-sla-heading__actions,
  .admin-sla-heading__actions > button,
  .admin-sla-save-actions > button {
    width: 100%;
  }

  .admin-sla-toolbar,
  .admin-sla-fields,
  .admin-sla-toggles {
    grid-template-columns: 1fr;
  }

  .admin-sla-rule-grid {
    padding: 12px;
  }

  .admin-sla-notice {
    margin-inline: 12px;
  }
}

/* PHASE 4E ROUND 03 — Alert Engine */
.admin-alert-engine { margin: 14px 16px 0; padding: 14px; border: 1px solid #cee0e8; border-left: 4px solid #0b809a; border-radius: 13px; background: #f7fbfc; }
.admin-alert-engine > header { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.admin-alert-engine h3 { margin:2px 0 3px; color:#0c4055; }
.admin-alert-engine p { margin:0; color:#607985; font-size:.78rem; }
.admin-alert-engine__actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:7px; }
.admin-alert-engine__metrics { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:8px; margin-top:12px; }
.admin-alert-engine__metrics > div { min-width:0; display:grid; gap:4px; padding:9px 10px; border:1px solid #d8e6ec; border-radius:10px; background:#fff; }
.admin-alert-engine__metrics span { color:#69818d; font-size:.68rem; font-weight:850; }
.admin-alert-engine__metrics strong { overflow:hidden; color:#123f52; font-size:.88rem; font-weight:950; text-overflow:ellipsis; white-space:nowrap; }
#adminAlertEngineStatus[data-status="READY"] { color:#08745c; }
#adminAlertEngineStatus[data-status="DISABLED"] { color:#9b6508; }
#adminAlertEngineStatus[data-status="ERROR"] { color:#c52e2e; }
.admin-alert-engine__notice { margin-top:9px; padding:7px 9px; border-radius:8px; background:#eaf5f8; color:#285467; font-size:.72rem; font-weight:800; }
.admin-alert-delivery-list { max-height:210px; margin-top:9px; overflow:auto; border:1px solid #d9e5eb; border-radius:10px; background:#fff; }
.admin-alert-delivery-item { display:grid; grid-template-columns:80px minmax(160px,1.2fr) minmax(220px,2fr) 130px; gap:8px; align-items:center; padding:8px 10px; border-bottom:1px solid #edf2f5; font-size:.72rem; }
.admin-alert-delivery-item:last-child { border-bottom:0; }
.admin-alert-delivery-item strong { color:#133f52; }
.admin-alert-delivery-item[data-severity="OVERDUE"] { border-left:3px solid #dc3333; }
.admin-alert-delivery-item[data-severity="WARNING"] { border-left:3px solid #e49408; }
.admin-alert-delivery-item small { color:#6c838e; }
@media(max-width:1100px){ .admin-alert-engine__metrics{grid-template-columns:repeat(3,minmax(0,1fr));}.admin-alert-delivery-item{grid-template-columns:70px 1fr 1.4fr;} .admin-alert-delivery-item time{display:none;} }
@media(max-width:700px){ .admin-alert-engine{margin-inline:10px;} .admin-alert-engine>header{display:grid;} .admin-alert-engine__actions,.admin-alert-engine__actions>button{width:100%;} .admin-alert-engine__metrics{grid-template-columns:repeat(2,minmax(0,1fr));} .admin-alert-delivery-item{grid-template-columns:1fr;} }



/* PHASE 4E ROUND 04 */
.admin-diagnostic-actions{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px}.admin-diagnostic-meta-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 14px}.admin-diagnostic-meta-grid>article{min-width:0;display:grid;gap:5px;padding:11px 13px;border:1px solid #d8e4ea;border-left:4px solid #0c809c;border-radius:11px;background:#fff}.admin-diagnostic-meta-grid span{color:#687f8b;font-size:.72rem;font-weight:850}.admin-diagnostic-meta-grid strong{min-width:0;overflow:hidden;color:#103e53;font-size:.86rem;font-weight:950;text-overflow:ellipsis;white-space:nowrap}.admin-diagnostic-check details{margin-top:8px;padding-top:7px;border-top:1px dashed #d6e2e8}.admin-diagnostic-check summary{color:#486574;font-size:.72rem;font-weight:850;cursor:pointer}.admin-diagnostic-check pre{max-height:260px;margin:7px 0 0;padding:9px;overflow:auto;border-radius:8px;background:#0d2937;color:#e9f6fb;font:11px/1.45 Consolas,monospace;white-space:pre-wrap;word-break:break-word}@media(max-width:900px){.admin-diagnostic-meta-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.admin-diagnostic-actions,.admin-diagnostic-actions>button{width:100%}.admin-diagnostic-meta-grid{grid-template-columns:1fr}}
