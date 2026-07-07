/*
 * vcw-report-export.js
 * VCW-R13 Report / Export / Audit UI
 */
(function (window, document) {
  'use strict';
  const BUILD = 'VCW-R13';
  const DEFAULT_MODULE = 'vendors';
  function $(id) { return document.getElementById(id); }
  function ready(fn){ if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',fn,{once:true});}else{fn();} }
  ready(init);
  async function init(){ if(!window.VCWWorkflowAPI) return; if(!shouldRender()) return; const me=await window.VCWWorkflowAPI.me(); if(!me.success) return; renderShell(); await loadReport(); }
  function shouldRender(){ const href=String(location.href||'').toLowerCase(); const path=String(location.pathname||'').toLowerCase(); return path.includes('admin')||path.includes('dashboard')||href.includes('tab=dashboard')||href.includes('tab=modules')||href.includes('tab=shifts'); }
  function resolveModuleId(){ const url=new URL(location.href); return url.searchParams.get('module')||url.searchParams.get('moduleId')||window.VCW_ACTIVE_MODULE||DEFAULT_MODULE; }
  function todayIso(){ const d=new Date(); const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return y+'-'+m+'-'+day; }
  function findHost(){ return document.querySelector('[data-vcw-dashboard]')||document.querySelector('#dashboard')||document.querySelector('#adminDashboard')||document.querySelector('.dashboard-grid')||document.querySelector('.admin-dashboard')||document.querySelector('main')||document.body; }
  function renderShell(){ if($('vcwReportExportCard')) return; const section=document.createElement('section'); section.id='vcwReportExportCard'; section.className='vcw-report-card'; section.innerHTML=''
    +'<div class="vcw-report-head"><div><p>Report Center</p><h2>Workflow Report / Export / Audit</h2></div><span>'+BUILD+'</span></div>'
    +'<div class="vcw-report-toolbar"><label>Module<input id="vcwReportModuleId" value="'+escapeHtml(resolveModuleId())+'"></label><label>วันที่<input id="vcwReportDate" type="date" value="'+todayIso()+'"></label><label>Limit<input id="vcwReportLimit" type="number" min="1" max="5000" value="500"></label><button id="vcwReportPreview" type="button">Preview</button><button id="vcwReportExport" type="button">Export CSV</button></div>'
    +'<div id="vcwReportStatus" class="vcw-report-status">พร้อมใช้งาน</div>'
    +'<div class="vcw-report-metrics">'+metric('records','รายการ')+metric('open','เปิดอยู่')+metric('completed','ปิดงานแล้ว')+metric('events','Events')+'</div>'
    +'<div class="vcw-report-grid"><div class="vcw-report-list"><h3>รายการรายงาน</h3><div id="vcwReportRows">-</div></div><div class="vcw-report-list"><h3>Audit / Events</h3><div id="vcwAuditRows">-</div></div></div>';
    const host=findHost(); if(host===document.body){document.body.insertBefore(section,document.body.firstChild);}else{host.insertBefore(section,host.firstChild);} $('vcwReportPreview').addEventListener('click',loadReport); $('vcwReportExport').addEventListener('click',exportCsv); }
  function metric(key,label){ return '<div class="vcw-report-metric"><span>'+escapeHtml(label)+'</span><strong id="vcwReportMetric_'+key+'">0</strong></div>'; }
  function getOptions(){ return {moduleId:String($('vcwReportModuleId').value||DEFAULT_MODULE).trim()||DEFAULT_MODULE,date:$('vcwReportDate').value||'',limit:Math.max(1,Math.min(5000,Number($('vcwReportLimit').value||500)))}; }
  async function loadReport(){ const opt=getOptions(); setStatus('กำลังโหลดรายงาน...',''); const result=await window.VCWWorkflowAPI.workflowReport(opt.moduleId,{date:opt.date,limit:opt.limit}); if(!result.success){setStatus('โหลดรายงานไม่สำเร็จ: '+result.message,'bad');return;} const data=unwrap(result.data); const summary=data.summary||{}; ['records','open','completed','events'].forEach(function(k){const el=$('vcwReportMetric_'+k); if(el) el.textContent=String(summary[k]||0);}); renderRecords(data.records||[]); renderAudit([...(data.events||[]),...(data.audit||[])]); setStatus('โหลดรายงานสำเร็จ '+(data.generatedAt||''),'ok'); }
  async function exportCsv(){ const opt=getOptions(); setStatus('กำลัง Export CSV...',''); const result=await window.VCWWorkflowAPI.exportWorkflowCsv(opt.moduleId,{date:opt.date,limit:opt.limit}); if(!result.success){setStatus('Export ไม่สำเร็จ: '+result.message,'bad');return;} const data=unwrap(result.data); downloadText(data.filename||'workflow_report.csv', data.csv||'', data.mimeType||'text/csv;charset=utf-8'); setStatus('Export CSV สำเร็จ: '+(data.rows||0)+' rows','ok'); }
  function renderRecords(items){ const el=$('vcwReportRows'); if(!items.length){el.innerHTML='<div class="vcw-report-empty">ไม่มีรายการในวันที่เลือก</div>';return;} el.innerHTML=items.slice(0,20).map(function(x){return '<div class="vcw-report-row"><strong>'+escapeHtml(x.entryCode||'-')+'</strong><span>'+escapeHtml(x.stageLabel||x.stage||'-')+'</span><em>'+escapeHtml(x.gateInAt||'-')+'</em><small>'+escapeHtml(x.plate||'-')+' | '+escapeHtml(x.company||'-')+'</small></div>';}).join(''); }
  function renderAudit(items){ const el=$('vcwAuditRows'); if(!items.length){el.innerHTML='<div class="vcw-report-empty">ไม่มี Audit/Event</div>';return;} el.innerHTML=items.slice(0,20).map(function(x){return '<div class="vcw-report-row"><strong>'+escapeHtml(x.actionLabel||x.action||'-')+'</strong><span>'+escapeHtml(x.entryCode||x.status||'-')+'</span><em>'+escapeHtml(x.at||'-')+'</em><small>'+escapeHtml(x.actor||x.user||'-')+' | '+escapeHtml(x.note||x.detail||'')+'</small></div>';}).join(''); }
  function downloadText(filename,text,mime){ const blob=new Blob([text],{type:mime}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){URL.revokeObjectURL(url);},1000); }
  function unwrap(data){ return data&&data.data&&typeof data.data==='object'?data.data:(data||{}); }
  function setStatus(text,status){ const el=$('vcwReportStatus'); if(!el)return; el.textContent=text; el.className='vcw-report-status '+(status||''); }
  function escapeHtml(value){ return String(value===undefined||value===null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
})(window, document);
