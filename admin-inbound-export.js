/**
 * admin-inbound-export.js
 * PHASE 5 ROUND 02 HOTFIX 02 — Async Chunked Export
 */
(function(window,document){
  'use strict';
  const API=window.VehicleAPI;
  const state={session:null,modules:[],moduleId:'',config:null,lastResult:null,loading:false,activeJobId:'',polling:false};
  const ACTIVE_JOB_KEY='alertvendor_management_export_active_job_v1';
  document.addEventListener('DOMContentLoaded',initialize);

  async function initialize(){
    bind();
    try{
      if(!API||typeof API.me!=='function')return;
      const session=await API.me();
      state.session=session;
      if(!isAdmin(session)){hide();return;}
      await loadModules();
      await loadConfig();
      updateControlVisibility();
      await resumeActiveExportJob();
    }catch(error){
      console.warn('management reporting init failed',error);
      setSummary('โหลดศูนย์รายงานไม่สำเร็จ: '+message(error));
    }
  }

  function bind(){
    byId('adminInboundExportRefreshButton')?.addEventListener('click',loadConfig);
    byId('adminInboundExportButton')?.addEventListener('click',createReport);
    byId('adminManagementCleanupButton')?.addEventListener('click',cleanup);
    byId('adminInboundExportModuleSelect')?.addEventListener('change',async event=>{state.moduleId=text(event.target.value);await loadConfig();});
    byId('adminManagementReportType')?.addEventListener('change',updateControlVisibility);
    byId('adminManagementDateMode')?.addEventListener('change',updateControlVisibility);
    byId('adminManagementFileFormat')?.addEventListener('change',updateButtonLabel);
  }

  function hide(){
    document.querySelector('[data-admin-tab="exports"]')?.classList.add('is-hidden');
    byId('adminPanelExports')?.classList.add('is-hidden');
  }

  async function loadModules(){
    const data=await API.getModules();
    const list=Array.isArray(data)?data:Array.isArray(data&&data.modules)?data.modules:[];
    state.modules=list.map(item=>({moduleId:text(item.moduleId||item.id),name:text(item.name||item.moduleName||item.moduleId||item.id)})).filter(item=>item.moduleId);
    const preferred=state.modules.find(item=>item.moduleId.toLowerCase()==='vendors');
    state.moduleId=(preferred||state.modules[0]||{}).moduleId||'';
    renderModules();
  }

  function renderModules(){
    const element=byId('adminInboundExportModuleSelect');
    if(!element)return;
    element.innerHTML=state.modules.length?state.modules.map(item=>`<option value="${esc(item.moduleId)}" ${item.moduleId===state.moduleId?'selected':''}>${esc(item.name||item.moduleId)}</option>`).join(''):'<option value="">ไม่พบ Module</option>';
  }

  async function loadConfig(){
    if(!state.moduleId||state.loading)return;
    state.loading=true;
    setSummary('กำลังโหลด Governance และประวัติรายงาน...');
    try{
      const data=await API.getManagementReportingConfig(state.moduleId);
      state.config=data;
      applyDefaults(data);
      renderConfig(data);
      setSummary('พร้อมส่งออก · ใช้ Business Date จาก Gate In และเกณฑ์ SLA ที่ Admin กำหนด');
    }catch(error){
      setSummary('โหลดข้อมูลไม่สำเร็จ: '+message(error));
    }finally{
      state.loading=false;
    }
  }

  function applyDefaults(data){
    const range=data&&data.defaultRange||{};
    const start=byId('adminManagementStartDate');
    const end=byId('adminManagementEndDate');
    if(start&&!start.value)start.value=range.startDate||'';
    if(end&&!end.value)end.value=range.endDate||'';
    const month=byId('adminManagementMonth');
    if(month&&!month.value){
      const source=(range.endDate||new Date().toISOString().slice(0,10));
      month.value=String(source).slice(0,7);
    }
  }

  function renderConfig(data){
    const governance=data&&data.governance||{};
    set('adminManagementDataRevision',governance.dataRevision||'-');
    set('adminManagementRulesRevision',governance.rulesRevision||'-');
    set('adminManagementShiftVersion',governance.shiftVersion||'-');
    set('adminManagementKpiVersion',governance.kpiVersion||'-');
    set('adminManagementRetention',String(data.retentionHours||24)+' ชั่วโมง');
    renderKpis(data.kpis||[]);
    renderHistory(data.recentExports||[]);
  }

  function renderKpis(items){
    set('adminManagementKpiCount',items.length+' KPI');
    const element=byId('adminManagementKpiList');
    if(!element)return;
    element.innerHTML=items.length?items.map(item=>`<article class="admin-management-kpi"><header><strong>${esc(item['ชื่อ KPI']||'-')}</strong><code>${esc(item['รหัส KPI']||'-')}</code></header><p>${esc(item['นิยาม']||'')}</p><small>${esc(item['สูตร/ฐานคำนวณ']||'')} · ${esc(item['หน่วย']||'')}</small></article>`).join(''):'<div class="empty-state">ยังไม่มีนิยาม KPI</div>';
  }

  function renderHistory(items){
    const element=byId('adminManagementExportHistory');
    if(!element)return;
    element.innerHTML=items.length?items.map(item=>{
      const type=item.reportType==='ALL_STAGES_SINGLE'?'ไฟล์เดียวทุกขั้นตอน':'ชุด ZIP';
      const format=item.fileFormat||'ZIP';
      return `<article class="admin-management-history-item"><div><strong>${esc(item.filename||'-')}</strong><span>${esc(item.startDate||'')} → ${esc(item.endDate||'')} · ${esc(type)} · ${esc(format)} · รถ ${Number(item.vehicleCount||0)} รายการ</span><small>${esc(item.createdAt||'')} · หมดอายุ ${esc(item.expiresAt||'-')}</small></div>${item.downloadUrl?`<a class="button button--secondary button--compact" href="${escAttr(item.downloadUrl)}" target="_blank" rel="noopener">ดาวน์โหลด</a>`:''}</article>`;
    }).join(''):'<div class="empty-state">ยังไม่มีประวัติรายงาน</div>';
  }

  function updateControlVisibility(){
    const reportType=value('adminManagementReportType')||'ALL_STAGES_SINGLE';
    const dateMode=value('adminManagementDateMode')||'RANGE';
    const rangeFields=byId('adminManagementRangeFields');
    const monthField=byId('adminManagementMonthField');
    const formatField=byId('adminManagementFileFormatField');
    rangeFields?.classList.toggle('is-hidden',dateMode==='MONTH');
    monthField?.classList.toggle('is-hidden',dateMode!=='MONTH');
    formatField?.classList.toggle('is-hidden',reportType!=='ALL_STAGES_SINGLE');
    updateButtonLabel();
  }

  function updateButtonLabel(){
    const button=byId('adminInboundExportButton');
    if(!button||state.loading)return;
    const reportType=value('adminManagementReportType')||'ALL_STAGES_SINGLE';
    const format=value('adminManagementFileFormat')||'XLSX';
    button.textContent=reportType==='MANAGEMENT_PACKAGE'?'สร้างชุดรายงาน ZIP':`ส่งออก ${format==='CSV'?'CSV':'Excel'}`;
  }

  function collectSelection(){
    const dateMode=value('adminManagementDateMode')||'RANGE';
    const selection={
      dateMode,
      startDate:value('adminManagementStartDate'),
      endDate:value('adminManagementEndDate'),
      month:value('adminManagementMonth'),
      includeActive:Boolean(byId('adminManagementIncludeActive')?.checked)
    };
    if(dateMode==='MONTH'){
      if(!selection.month)throw new Error('กรุณาเลือกเดือน');
    }else if(!selection.startDate||!selection.endDate){
      throw new Error('กรุณาเลือกวันที่เริ่มต้นและวันที่สิ้นสุด');
    }
    return selection;
  }

  async function createReport(){
    if(!state.moduleId||state.loading)return;
    let selection;
    try{selection=collectSelection();}catch(error){toast(message(error),'warning');return;}
    const reportType=value('adminManagementReportType')||'ALL_STAGES_SINGLE';
    const fileFormat=value('adminManagementFileFormat')||'XLSX';
    state.loading=true;
    buttonBusy(true);
    setSummary(reportType==='MANAGEMENT_PACKAGE'
      ?'กำลังรวบรวมข้อมูลและสร้าง ZIP บน Google Drive...'
      :`กำลังส่งงานสร้างไฟล์ ${fileFormat} แบบแบ่งชุด...`);
    try{
      let result;
      if(reportType==='MANAGEMENT_PACKAGE'){
        result=await API.createManagementReportPackage(state.moduleId,selection);
      }else{
        result=await API.createAllWorkflowStagesExport(state.moduleId,{...selection,fileFormat});
        if(result&&result.async&&result.jobId){
          saveActiveJob(result.jobId,state.moduleId);
          result=await monitorExportJob(result.jobId,result);
        }
      }
      state.lastResult=result;
      renderResult(result);
      set('adminManagementLatestFile',result.filename||'-');
      if(result.reportType==='ALL_STAGES_SINGLE'){
        setSummary(`สร้างไฟล์สำเร็จ · ${Number(result.rowCount||0)} แถว · ${Number(result.columnCount||0)} คอลัมน์ · ${result.fileFormat||'-'}`);
      }else{
        setSummary('สร้างชุดรายงานสำเร็จ · รถ '+Number(result.counts&&result.counts.vehicleDetails||0)+' รายการ · รายวัน '+Number(result.counts&&result.counts.dailyRows||0)+' วัน · รายกะ '+Number(result.counts&&result.counts.shiftRows||0)+' แถว');
      }
      clearActiveJob();
      toast('สร้างไฟล์รายงานแล้ว','success');
      await loadHistoryOnly();
    }catch(error){
      setSummary('สร้างรายงานไม่สำเร็จ: '+message(error));
      toast(message(error),'error');
    }finally{
      state.loading=false;
      buttonBusy(false);
    }
  }

  async function monitorExportJob(jobId,initial){
    if(state.polling)throw new Error('มีงานส่งออกกำลังติดตามอยู่');
    state.polling=true;
    state.activeJobId=jobId;
    let latest=initial||{};
    const started=Date.now();
    try{
      while(Date.now()-started<45*60*1000){
        latest=await API.getManagementReportJobStatus(jobId);
        renderJobProgress(latest);
        const status=text(latest.status).toUpperCase();
        if(status==='READY')return latest;
        if(status==='FAILED'){
          clearActiveJob();
          throw new Error(latest.errorMessage||'งานส่งออกล้มเหลว');
        }
        if(status==='CANCELLED'){
          clearActiveJob();
          throw new Error('งานส่งออกถูกยกเลิก');
        }
        await sleep(4000);
      }
      throw new Error('งานยังประมวลผลอยู่ กรุณากลับมาตรวจสอบอีกครั้ง');
    }finally{
      state.polling=false;
      state.activeJobId='';
    }
  }

  function renderJobProgress(job){
    const progress=Math.max(0,Math.min(100,Number(job.progressPercent||0)));
    const status=text(job.status)||'QUEUED';
    const phase=text(job.phase)||'BUILD';
    setSummary(`กำลังสร้างไฟล์ ${progress}% · ${phase} · ประมวลผล ${Number(job.processedSourceRows||0)} แถว · ส่งออก ${Number(job.rowCount||0)} แถว`);
    const element=byId('adminInboundExportPreview');
    if(!element)return;
    element.classList.add('is-ready');
    element.innerHTML=`<h4>กำลังสร้างไฟล์แบบแบ่งชุด</h4><p><strong>${esc(job.filename||job.jobId||'-')}</strong></p><div class="admin-management-result__facts"><span>สถานะ ${esc(status)}</span><span>${progress}%</span><span>${Number(job.rowCount||0)} แถว</span></div><p>สามารถเปิดหน้านี้ค้างไว้ได้ ระบบจะประมวลผลต่อโดยไม่รอคำขอเดียวจนหมดเวลา</p>`;
  }

  async function resumeActiveExportJob(){
    const saved=readActiveJob();
    if(!saved||!saved.jobId||saved.moduleId!==state.moduleId)return;
    if(state.loading)return;
    state.loading=true;
    buttonBusy(true);
    try{
      const result=await monitorExportJob(saved.jobId,{jobId:saved.jobId});
      state.lastResult=result;
      renderResult(result);
      set('adminManagementLatestFile',result.filename||'-');
      setSummary(`สร้างไฟล์สำเร็จ · ${Number(result.rowCount||0)} แถว · ${result.fileFormat||'-'}`);
      clearActiveJob();
      await loadHistoryOnly();
    }catch(error){
      setSummary('ติดตามงานส่งออกไม่สำเร็จ: '+message(error));
    }finally{
      state.loading=false;
      buttonBusy(false);
    }
  }

  function saveActiveJob(jobId,moduleId){
    try{localStorage.setItem(ACTIVE_JOB_KEY,JSON.stringify({jobId,moduleId,storedAt:Date.now()}));}catch(error){}
  }
  function readActiveJob(){
    try{return JSON.parse(localStorage.getItem(ACTIVE_JOB_KEY)||'null');}catch(error){return null;}
  }
  function clearActiveJob(){
    try{localStorage.removeItem(ACTIVE_JOB_KEY);}catch(error){}
  }
  function sleep(ms){return new Promise(resolve=>window.setTimeout(resolve,ms));}


  function renderResult(result){
    const element=byId('adminInboundExportPreview');
    if(!element)return;
    const single=result.reportType==='ALL_STAGES_SINGLE';
    const facts=single
      ? `<div class="admin-management-result__facts"><span>รูปแบบ ${esc(result.fileFormat||'-')}</span><span>${Number(result.rowCount||0)} แถว</span><span>${Number(result.columnCount||0)} คอลัมน์</span></div>`
      : `<div class="admin-management-result__facts"><span>รถ ${Number(result.counts&&result.counts.vehicleDetails||0)}</span><span>รายวัน ${Number(result.counts&&result.counts.dailyRows||0)}</span><span>รายกะ ${Number(result.counts&&result.counts.shiftRows||0)}</span></div>`;
    element.classList.add('is-ready');
    element.innerHTML=`<h4>สร้างไฟล์สำเร็จ</h4><p><strong>${esc(result.filename||'-')}</strong></p>${facts}<p>ช่วง ${esc(result.startDate||'')} → ${esc(result.endDate||'')} · ${esc(result.dateMode==='MONTH'?'เลือกเดือน':'กำหนดช่วงวันที่')}</p><p>ไฟล์เป็น Private ใน Google Drive และหมดอายุ ${esc(result.expiresAt||'-')}</p><p>Rules ${esc(result.governance&&result.governance.rulesRevision||'-')} · Shift ${esc(result.governance&&result.governance.shiftVersion||'-')} · KPI ${esc(result.governance&&result.governance.kpiVersion||'-')}</p>${result.downloadUrl?`<a class="button button--primary" href="${escAttr(result.downloadUrl)}" target="_blank" rel="noopener">ดาวน์โหลด ${esc(result.fileFormat||'ไฟล์')}</a>`:''}`;
  }

  async function loadHistoryOnly(){
    try{const data=await API.listManagementReportExports(state.moduleId,{limit:20});renderHistory(data.exports||[]);}catch(error){console.warn(error);}
  }

  async function cleanup(){
    if(state.loading)return;
    state.loading=true;
    try{const result=await API.cleanupManagementReportFiles();toast('ตรวจ '+Number(result.checked||0)+' ไฟล์ · ลบ '+Number(result.trashed||0)+' ไฟล์','success');await loadHistoryOnly();}catch(error){toast(message(error),'error');}finally{state.loading=false;}
  }

  function buttonBusy(busy){
    const button=byId('adminInboundExportButton');
    if(!button)return;
    button.disabled=busy;
    if(busy)button.textContent='กำลังสร้างไฟล์...';else updateButtonLabel();
  }

  function setSummary(textValue){set('adminInboundExportSummary',textValue);}
  function set(id,textValue){const element=byId(id);if(element)element.textContent=textValue;}
  function value(id){return text(byId(id)?.value);}
  function byId(id){return document.getElementById(id);}
  function text(input){return input===null||input===undefined?'':String(input).trim();}
  function message(error){return error&&error.message?error.message:String(error||'เกิดข้อผิดพลาด');}
  function isAdmin(session){const user=session&&session.user?session.user:session||{};return text(user.role).toUpperCase()==='ADMIN';}
  function esc(input){return text(input).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');}
  function escAttr(input){return esc(input);}
  function toast(title,icon){if(window.Swal)Swal.fire({toast:true,position:'top-end',timer:3200,showConfirmButton:false,icon:icon||'info',title});}
})(window,document);
