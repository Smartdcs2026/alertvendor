/* vcw-sla-alerts.js | VCW-R12 */
(function (window, document) {
  'use strict';
  const BUILD = 'VCW-R12';
  const DEFAULT_MODULE = 'vendors';
  function $(id){ return document.getElementById(id); }
  function ready(fn){ document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn, {once:true}) : fn(); }
  ready(init);
  async function init(){
    if (!window.VCWWorkflowAPI || !shouldRender()) return;
    const me = await window.VCWWorkflowAPI.me();
    if (!me.success) return;
    renderShell();
    await loadAlerts();
  }
  function shouldRender(){ const href=String(location.href||'').toLowerCase(); const path=String(location.pathname||'').toLowerCase(); return path.includes('admin')||path.includes('dashboard')||href.includes('tab=dashboard')||href.includes('tab=modules')||href.includes('tab=shifts'); }
  function resolveModuleId(){ const url=new URL(location.href); return url.searchParams.get('module')||url.searchParams.get('moduleId')||window.VCW_ACTIVE_MODULE||DEFAULT_MODULE; }
  function findHost(){ return document.querySelector('[data-vcw-dashboard]')||document.querySelector('#dashboard')||document.querySelector('#adminDashboard')||document.querySelector('.dashboard-grid')||document.querySelector('.admin-dashboard')||document.querySelector('main')||document.body; }
  function renderShell(){
    if ($('vcwSlaAlertsCard')) return;
    const section=document.createElement('section');
    section.id='vcwSlaAlertsCard';
    section.className='vcw-sla-card';
    section.innerHTML=''
      + '<div class="vcw-sla-head"><div><p>SLA Control</p><h2>Workflow SLA Alerts</h2></div><span>'+BUILD+'</span></div>'
      + '<div class="vcw-sla-toolbar"><label>Module<input id="vcwSlaModuleId" value="'+escapeHtml(resolveModuleId())+'"></label><label>Limit<input id="vcwSlaLimit" type="number" min="1" max="200" value="50"></label><button id="vcwSlaRefresh" type="button">Refresh</button><button id="vcwSlaSetup" type="button">Setup Rules</button></div>'
      + '<div id="vcwSlaHealth" class="vcw-sla-health">กำลังโหลด...</div>'
      + '<div class="vcw-sla-metrics">'+metric('open','เปิดอยู่')+metric('warning','ใกล้เกินเวลา')+metric('overdue','เกินเวลา')+metric('completed','ปิดงานแล้ว')+'</div>'
      + '<div class="vcw-sla-lists"><div class="vcw-sla-list"><h3>เกิน SLA</h3><div id="vcwSlaOverdueRows">-</div></div><div class="vcw-sla-list"><h3>ใกล้เกิน SLA</h3><div id="vcwSlaWarningRows">-</div></div></div>';
    const host=findHost();
    host === document.body ? document.body.insertBefore(section, document.body.firstChild) : host.insertBefore(section, host.firstChild);
    $('vcwSlaRefresh').addEventListener('click', loadAlerts);
    $('vcwSlaSetup').addEventListener('click', setupRules);
  }
  function metric(key,label){ return '<div class="vcw-sla-metric"><span>'+escapeHtml(label)+'</span><strong id="vcwSlaMetric_'+key+'">0</strong></div>'; }
  async function loadAlerts(){
    const moduleId=String($('vcwSlaModuleId').value||DEFAULT_MODULE).trim()||DEFAULT_MODULE;
    const limit=Math.max(1,Math.min(200,Number($('vcwSlaLimit').value||50)));
    setHealth('กำลังโหลด SLA...','');
    const result=await window.VCWWorkflowAPI.slaAlerts(moduleId,{limit});
    if(!result.success){ setHealth('โหลด SLA ไม่สำเร็จ: '+result.message,'bad'); return; }
    const data=unwrapData(result.data); const summary=data.summary||{};
    ['open','warning','overdue','completed'].forEach(function(key){ const el=$('vcwSlaMetric_'+key); if(el) el.textContent=String(summary[key]||0); });
    const health=data.health||{}; setHealth((health.level||'OK')+' — '+(health.message||'ยังไม่มีรายการเกิน SLA'), health.level==='OK'?'ok':health.level==='WARNING'?'warn':'bad');
    renderRows('vcwSlaOverdueRows', data.overdueItems||[]); renderRows('vcwSlaWarningRows', data.warningItems||[]);
  }
  async function setupRules(){
    const moduleId=String($('vcwSlaModuleId').value||DEFAULT_MODULE).trim()||DEFAULT_MODULE;
    if(!window.confirm('สร้าง/ตรวจ Default SLA Rules สำหรับ module '+moduleId+'?')) return;
    const result=await window.VCWWorkflowAPI.setupDefaultSlaRules(moduleId);
    if(!result.success){ setHealth('Setup Rules ไม่สำเร็จ: '+result.message,'bad'); return; }
    setHealth('Setup Rules สำเร็จ','ok'); await loadAlerts();
  }
  function renderRows(targetId,items){
    const el=$(targetId); if(!el) return;
    if(!items.length){ el.innerHTML='<div class="vcw-sla-empty">ไม่มีรายการ</div>'; return; }
    el.innerHTML=items.slice(0,15).map(function(item){ return '<div class="vcw-sla-row '+(item.isOverdue?'is-overdue':'is-warning')+'"><strong>'+escapeHtml(item.entryCode||'-')+'</strong><span>'+escapeHtml(item.stageLabel||item.stage||'-')+'</span><em>'+escapeHtml(item.elapsedText||'-')+'</em><small>'+escapeHtml(item.plate||'-')+' | '+escapeHtml(item.company||'-')+'</small></div>'; }).join('');
  }
  function unwrapData(data){ return data&&data.data&&typeof data.data==='object'?data.data:data||{}; }
  function setHealth(text,status){ const el=$('vcwSlaHealth'); if(!el) return; el.textContent=text; el.className='vcw-sla-health '+(status||''); }
  function escapeHtml(value){ return String(value===undefined||value===null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
})(window, document);
