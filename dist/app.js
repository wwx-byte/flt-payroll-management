"use strict";

const $ = selector => document.querySelector(selector);
const html = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = value => "¥" + (value/100).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2});
const period = value => value.slice(0,4)+" 年 "+Number(value.slice(5))+" 月";
const dateTime = value => new Date(value).toLocaleString("zh-CN",{hour12:false,timeZone:"Asia/Shanghai"});
const pages = {
  home:["薪酬总览","▦"], employees:["员工薪资档案","♙"], ledger:["月度薪资台账","▤"],
  delivery:["工资条与签收","✎"], analysis:["月度薪酬分析","▥"]
};
const statuses = {draft:"待发放",sent:"待签收",signed:"已签收",archived:"已更正"};
const key = "payroll-workbench-v1";
let page = "home", month = "2026-10", state, employeeQuery = "", filter = "", noticeTimer;
function seed() {
  const people = [
    ["林知夏","产品设计部"],["许景川","产品设计部"],["周亦辰","研发部"],["陈予安","研发部"],
    ["唐沐言","研发部"],["叶书宁","研发部"],["沈怀远","市场运营部"],["顾清禾","市场运营部"],
    ["江言希","市场运营部"],["温庭予","人事行政部"],["程舒雅","人事行政部"],["陆向宁","人事行政部"]
  ];
  const employees = people.map(([name,dept],i) => {
    const base = 980000 + (i%5)*125000;
    return {id:"DEMO-"+String(i+1).padStart(3,"0"),name,dept,history:[
      {type:"试用期",date:"2025-09-01",amount:Math.round(base*.8),note:"演示记录"},
      {type:"转正",date:"2025-12-01",amount:base,note:"试用期结束"},
      ...(i%2 ? [{type:"调薪",date:"2026-07-01",amount:base+80000,note:"年度调薪"}] : [])
    ]};
  });
  const batches = Array.from({length:6},(_,j) => ({
    month:"2026-"+String(5+j).padStart(2,"0"),
    versions:[{number:1,source:"虚拟示例",createdAt:"2026-10-31T08:00:00Z",slips:employees.map((e,i) => {
      const base = e.history.filter(h => h.date <= "2026-"+String(5+j).padStart(2,"0")+"-28").at(-1).amount;
      const bonus = 60000 + ((i+2*j)%7)*15000;
      const gross = base+bonus+45000, withheld = 74000+i*2690;
      return {id:e.id,name:e.name,dept:e.dept,gross,withheld,net:gross-withheld,
        details:[["基本工资",base/100],["绩效工资",bonus/100],["交通及餐费补贴",450]],
        status:j===5 && i>6 ? "draft" : "sent",sentAt:j===5 && i>6 ? null : "2026-10-31T09:00:00Z"};
    })}]
  }));
  return {employees,batches};
}
try { state = JSON.parse(localStorage.getItem(key)) || seed() } catch { state = seed() }
function toast(message) {
  $("#notice").textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => $("#notice").textContent="",4600);
}
function commit(next) {
  try { localStorage.setItem(key,JSON.stringify(next)) }
  catch { toast("无法保存。浏览器存储空间不足或不可用，请检查后重试。"); return false }
  state = next;
  render();
  return true;
}
const batchFor = (value=month) => state.batches.find(batch=>batch.month===value);
const current = (value=month) => batchFor(value)?.versions.at(-1);
const slips = () => current()?.slips ?? [];
const sum = (rows,field) => rows.reduce((total,row)=>total+row[field],0);
const counts = rows => Object.fromEntries(["draft","sent","signed"].map(status=>[status, rows.filter(r=>r.status===status).length]));
const button = (label, action, primary=false, extra="") => '<button type="button" class="btn '+(primary?"primary":"")+'" data-action="'+action+'" '+extra+'>'+label+'</button>';
const link = (label, action, id) => '<button type="button" class="link" data-action="'+action+'" data-index="'+id+'">'+label+'</button>';
const badge = (status) => '<span class="pill '+status+'">'+statuses[status]+'</span>';
const selector = () => '<label><span class="sr">薪资月份</span><input type="month" min="2000-01" max="2099-12" id="month" value="'+month+'"></label>';
function head(title, description, actions="") {
  return '<div class="page-head"><div><h1>'+title+'</h1><p>'+description+'</p></div><div class="actions">'+actions+'</div></div>';
}
function panel(title, sub, body, actions="") {
  return '<section class="panel"><div class="section-head"><div><h2>'+title+'</h2>'+(sub?'<p>'+sub+'</p>':"")+'</div><div class="actions">'+actions+'</div></div>'+body+'</section>';
}
function table(headers, rows, fallback="当前月份暂无记录") {
  if (!rows.length) return '<p class="empty">'+fallback+'</p>';
  return '<div class="tablebox"><table><thead><tr>'+headers.map(h=>'<th scope="col">'+h+'</th>').join("")+'</tr></thead><tbody>'+
    rows.map(r=>'<tr>'+r.map(cell=>'<td>'+cell+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';
}
const kpi = (icon,label,value,hint) => '<article class="kpi"><span class="symbol" aria-hidden="true">'+icon+'</span><div class="muted">'+label+'</div><strong>'+value+'</strong><div class="muted">'+hint+'</div></article>';
function insights() {
  const rows = slips(), c = counts(rows), gross = sum(rows,"gross"), net = sum(rows,"net");
  const departments = new Map();
  for (const row of rows) {
    const item = departments.get(row.dept) ?? {headcount:0,gross:0,net:0};
    item.headcount++; item.gross += row.gross; item.net += row.net;
    departments.set(row.dept,item);
  }
  const ordered = [...departments].sort((a,b)=>b[1].gross-a[1].gross);
  return {rows,c,gross,net,ordered};
}
function charts(ordered) {
  const [y,m] = month.split("-").map(Number);
  const trend = Array.from({length:6},(_,i)=>{
    const d = new Date(Date.UTC(y,m-6+i,1));
    const value = d.toISOString().slice(0,7);
    const version = current(value);
    return [value, version ? sum(version.slips,"gross") : null];
  });
  const max = Math.max(1,...trend.map(([,n])=>Math.abs(n ?? 0)));
  const chart = '<div class="chart">'+trend.map(([value,n])=>{
    const label = n===null ? "—" : (n/1000000).toFixed(1);
    return '<div class="chart-item" title="'+period(value)+' '+(n===null?"暂无台账":money(n))+'"><span>'+label+'</span><div class="bar-wrap"><div class="bar" style="height:'+Math.abs(n ?? 0)/max*100+'%"></div></div><span>'+Number(value.slice(5))+' 月</span></div>';
  }).join("")+'</div>';
  const deptMax = Math.max(1,...ordered.map(([,d])=>Math.abs(d.gross)));
  const bars = ordered.slice(0,6).map(([name,d])=>'<div class="dept"><div><span>'+html(name)+'</span><strong>'+money(d.gross)+'</strong></div><div class="track"><span style="width:'+Math.abs(d.gross)/deptMax*100+'%"></span></div></div>').join("");
  return '<div class="columns">'+panel("近 6 个月薪酬趋势","按工资条所属月份统计应发薪资 · 万元",chart)+panel("部门应发薪酬","按应发金额排序 · 前 6 个部门",bars || '<p class="empty">当前月份暂无部门数据</p>')+'</div>';
}
function dashboard(isAnalysis) {
  const {rows,c,gross,net,ordered} = insights();
  const prev = new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5))-2,1)).toISOString().slice(0,7);
  const previous = current(prev);
  const prevGross = previous ? sum(previous.slips,"gross") : 0;
  const change = current() && prevGross > 0 ? ((gross-prevGross)/prevGross*100).toFixed(1)+"%" : "—";
  const cards = '<div class="cards">'+kpi("¥","应发薪资",money(gross),"环比 "+change)+kpi("¥","实发薪资",money(net),"扣款合计 "+money(sum(rows,"withheld")))+
    kpi("♙","发薪人数",rows.length+" 人","人均应发 "+(rows.length?money(Math.round(gross/rows.length)):"—"))+
    kpi("✓","签收进度",c.signed+" / "+(c.signed+c.sent),"待签收 "+c.sent+" 人 · 待发放 "+c.draft+" 人")+'</div>';
  const data = isAnalysis ?
    panel("部门薪酬明细",period(month),table(["部门","人数","应发薪资","实发薪资","人均应发"],ordered.map(([name,d])=>[html(name),d.headcount,money(d.gross),money(d.net),money(Math.round(d.gross/d.headcount))]))) :
    panel("工资条发放进度",period(month),payTable(rows.slice(0,6),true),button("管理发放","goto-delivery"));
  return head(isAnalysis?"月度薪酬分析":"薪酬总览",isAnalysis?"按月份查看薪酬总额、部门分布和发放进度。":"查看月度发薪数据、工资条进度和员工签收情况。",
    selector()+(isAnalysis?button("导出分析","export",false,rows.length?"":"disabled"):button("导入工资表","import",true)))+cards+charts(ordered)+data;
}
function payTable(rows, delivery, version=current()) {
  return table(["员工","工号","部门","应发","实发","状态","操作"],rows.map(row=>{
    const index = version.slips.indexOf(row);
    return [html(row.name),html(row.id),html(row.dept),money(row.gross),money(row.net),badge(row.status),
      link(row.status==="signed"?"查看手写签名":"预览工资条","slip",index)+(delivery && row.status==="sent"?'　'+link("模拟员工签收","sign",index):"")];
  }));
}
function ledger(delivery) {
  const rows = slips(), v=current(), c=counts(rows);
  const displayed = delivery && filter ? rows.filter(row=>row.status===filter) : rows;
  const stats = delivery ? '待发放 '+c.draft+' 人　·　待签收 '+c.sent+' 人　·　已签收 '+c.signed+' 人' :
    (v ? '第 '+v.number+' 版　·　'+rows.length+' 人　·　应发 '+money(sum(rows,"gross"))+'　·　实发 '+money(sum(rows,"net")) : period(month));
  const filterBox = '<label><span class="sr">签收状态</span><select id="status-filter">'+[["","全部状态"],...Object.entries(statuses).slice(0,3)].map(([value,label])=>'<option value="'+value+'" '+(filter===value?"selected":"")+'>'+label+'</option>').join("")+'</select></label>';
  return head(delivery?"工资条与签收":"月度薪资台账",delivery?"查看发放进度、预览手机签字页，并查阅员工手写签名。":"核对每位员工的应发、扣款及实发明细。",selector()+
    (delivery?button("模拟批量发放","send",true,c.draft?"":"disabled"):button("导入工资表","import",true)))+
    (delivery?'<p class="statusline">演示模式下，发放操作更新本机状态，员工签收可在此模拟。</p>':"")+
    panel(delivery?"签收明细":"员工工资明细",stats,payTable(displayed,delivery), (delivery?filterBox:"")+(batchFor()?.versions.length>1?button("查看历史版本","versions"):""));
}
function employeePage() {
  const q=employeeQuery.trim().toLowerCase();
  const rows=state.employees.map((e,i)=>[e,i]).filter(([e])=>[e.name,e.id,e.dept].some(value=>value.toLowerCase().includes(q)));
  return head("员工薪资档案","查看试用期、转正和历次调薪记录。",button("新增员工","add-employee",true))+
    panel("员工列表",rows.length+" 位员工",table(["工号","姓名","部门","最近薪资","档案"],rows.map(([e,i])=>[
      html(e.id),html(e.name),html(e.dept),e.history.length?money(e.history.at(-1).amount):"—",link("查看薪资记录","history",i)
    ]),"没有符合条件的员工"),'<label><span class="sr">搜索员工</span><input id="employee-query" type="search" placeholder="搜索姓名、工号或部门" value="'+html(employeeQuery)+'"></label>');
}
function render() {
  $("#nav").innerHTML = Object.entries(pages).map(([id,[label,icon]])=>'<button type="button" data-action="goto-'+id+'" '+(page===id?'aria-current="page"':'')+'><span class="navicon" aria-hidden="true">'+icon+'</span>'+label+'</button>').join("");
  $("#crumb").textContent = pages[page][0];
  const views = {home:()=>dashboard(false),analysis:()=>dashboard(true),employees:employeePage,ledger:()=>ledger(false),delivery:()=>ledger(true)};
  $("#app").innerHTML = views[page]();
}
const modal = $("#modal");
function dialog(title, body) {
  modal.innerHTML = '<div class="dialog-head"><h2 id="modal-title">'+title+'</h2>'+button("关闭","close")+'</div><div class="dialog-body">'+body+'</div>';
  if (!modal.open) modal.showModal();
}
function finish(message) { modal.close(); toast(message) }
function preview(version, index, mode) {
  const row = version.slips[index];
  if (!row) return;
  const archived=version!==current();
  const header = '<p class="muted">'+period(month)+' · 第 '+version.number+' 版'+(archived?' · 历史版本':'')+' · '+html(row.name)+' / '+html(row.id)+'</p>';
  const items = [["部门",row.dept],["应发合计",money(row.gross)],["扣款合计",money(row.withheld)],...row.details];
  const details = '<details><summary>展开工资明细</summary><div class="slip-fields">'+items.map(([label,value])=>'<div><span>'+html(label)+'</span><strong>'+html(value)+'</strong></div>').join("")+'</div></details>';
  const summary = header+'<div class="secure"><span class="muted">实发合计</span><strong>'+money(row.net)+'</strong></div>'+details;
  const meta = row.sentAt?'<p class="muted">模拟发放时间 '+dateTime(row.sentAt)+'</p>':"";
  if (row.status==="signed") {
    const safe = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(row.signature.image) ? row.signature.image : "";
    dialog("签收详情",summary+'<hr><h3>员工手写签名</h3><img class="saved-signature" alt="手写签名" src="'+safe+'"><p class="muted">提交时间 '+dateTime(row.signature.at)+'</p>'+meta);
    return;
  }
  const signing=mode==="sign" && row.status==="sent" && !archived;
  const signArea = '<hr><h3>手写签字</h3><p class="muted">'+(signing?"请在下方签名，确认已收到并查看本工资条。":"这是员工手机上的签字区，发放后可提交签名。")+'</p>'+
    '<canvas aria-label="手写签字区" class="signature" width="720" height="240"></canvas>'+
    '<div class="actions signature-actions">'+button("清空重签","clear")+button("提交签收","submit-sign",true,"disabled")+'</div>';
  dialog(signing?"员工签收 · 模拟":(archived?"历史工资条":"手机签字页预览"),summary+meta+(archived?"":signArea));
  if (archived) return;
  const canvas = modal.querySelector("canvas"), ctx = canvas.getContext("2d");
  const submit = modal.querySelector('[data-action="submit-sign"]');
  ctx.lineWidth=4; ctx.lineCap="round"; ctx.lineJoin="round"; ctx.strokeStyle="#172d54";
  let pointer=null, startX=0, startY=0, hasStroke=false;
  const point = event => {
    const box = canvas.getBoundingClientRect();
    return [(event.clientX-box.left)*canvas.width/box.width,(event.clientY-box.top)*canvas.height/box.height];
  };
  canvas.onpointerdown = event => {
    if (pointer!==null || event.button!==0) return;
    pointer=event.pointerId;
    canvas.setPointerCapture(pointer);
    [startX,startY] = point(event);
    ctx.beginPath();
    ctx.moveTo(startX,startY);
  };
  canvas.onpointermove = event => {
    if (event.pointerId!==pointer) return;
    const [x,y]=point(event);
    if (Math.hypot(x-startX,y-startY)>3) hasStroke=true;
    ctx.lineTo(x,y);ctx.stroke();
    submit.disabled=!(signing&&hasStroke);
  };
  canvas.onlostpointercapture = () => {pointer=null};
  modal.querySelector('[data-action="clear"]').onclick = () => {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    hasStroke=false; submit.disabled=true;
  };
  submit.onclick = () => {
    if (!signing || !hasStroke || current()!==version || row.status!=="sent") return;
    const next=structuredClone(state);
    const slip=next.batches.find(b=>b.month===month).versions.at(-1).slips[index];
    slip.status="signed";
    slip.signature={image:canvas.toDataURL("image/png"),at:new Date().toISOString()};
    if (commit(next)) finish("签收已保存，可在后台查看手写签名。");
  };
}
function importDialog() {
  dialog("导入本地工资表",'<p class="statusline">适配 2026 年 10 月表结构。请使用脱敏工作簿或下载虚拟样表。文件在当前浏览器内解析。</p>'+
    '<div class="form-grid"><label>薪资所属月份<input id="import-month" type="month" min="2000-01" max="2099-12" value="'+month+'"></label>'+
    '<label>工资表文件<input id="file" type="file" accept=".xlsx,.xls,.csv"></label></div>'+
    '<div class="actions">'+button("下载虚拟样表","sample")+'</div><div id="import-result" aria-live="polite"></div>');
  let request=0;
  $("#file").onchange = async event => {
    const generation=++request, file=event.target.files[0], output=$("#import-result"), picker=$("#import-month");
    output.innerHTML="";
    if (!file) return;
    if (file.size>10*1024*1024) {output.innerHTML='<p class="statusline error">文件超过 10 MB。</p>';return}
    const named=file.name.match(/(20\d{2})\s*(?:年|[-_.])\s*(\d{1,2})(?=月|\D|$)/);
    if (named && Number(named[2])>=1 && Number(named[2])<=12) picker.value=named[1]+"-"+named[2].padStart(2,"0");
    try {
      const bytes=await file.arrayBuffer();
      if (!output.isConnected || request!==generation) return;
      const wb=XLSX.read(bytes, {type:"array"});
      const sheets=wb.SheetNames.map(name=>({name,...PayrollImport.parse(XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:true,defval:null}))}));
      const candidates=sheets.filter(s=>s.rows.length || !s.errors[0]?.startsWith("找不到表头"));
      if (candidates.length>1) throw Error("文件内有多个工资明细工作表，请保留本次发放的单个工作表后重新导入。");
      const found=candidates[0] || sheets[0];
      if (!found) throw Error("文件没有可读取的工作表。");
      const mismatches=found.rows.filter(row=>state.employees.some(e=>e.id===row.id && e.name!==row.name));
      if (mismatches.length) found.errors.push(mismatches.length+" 个工号对应的姓名与档案不一致。请核对文件。");
      if (found.errors.length) throw Error(found.errors.slice(0,8).join("\n")+(found.errors.length>8?"\n共 "+found.errors.length+" 项错误":""));
      function showResult() {
        const existing=current(picker.value);
        const fresh=found.rows.filter(row=>!state.employees.some(e=>e.id===row.id)).length;
        output.innerHTML='<p class="statusline">工作表 '+html(found.name)+' · '+found.rows.length+' 人 · 待新建档案 '+fresh+' 人<br>应发 '+money(sum(found.rows,"gross"))+' · 扣款 '+money(sum(found.rows,"withheld"))+' · 实发 '+money(sum(found.rows,"net"))+'</p>'+
          (existing?'<p class="statusline warn">保存后会生成该月新版，历史工资条和签名可继续查阅。新版需重新发放和签收。</p>':"")+
          table(["姓名","工号","应发","实发"],found.rows.slice(0,5).map(r=>[html(r.name),html(r.id),money(r.gross),money(r.net)]))+
          '<div class="actions signature-actions">'+button("保存至月度台账","accept-import",true)+'</div>';
        output.querySelector('[data-action="accept-import"]').onclick = () => {
          const chosen=picker.value;
          if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(chosen)) {picker.reportValidity();picker.focus();return}
          const next=structuredClone(state);
          for (const row of found.rows) {
            if (!next.employees.some(e=>e.id===row.id)) next.employees.push({id:row.id,name:row.name,dept:row.dept,history:[]});
          }
          let batch=next.batches.find(b=>b.month===chosen);
          if (!batch) {batch={month:chosen,versions:[]};next.batches.push(batch)}
          batch.versions.push({number:batch.versions.length+1,source:file.name,createdAt:new Date().toISOString(),
            slips:found.rows.map(row=>({...row,status:"draft"}))});
          if (commit(next)) {month=chosen;page="ledger";render();finish("已保存 "+found.rows.length+" 条工资条。")}
        };
      }
      picker.onchange=showResult;
      showResult();
    } catch (error) {output.innerHTML='<p class="statusline error">'+html(error.message || "无法读取工资表。")+'</p>'}
  };
}
function download(name, title, rows) {
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),title);
  XLSX.writeFile(book,name+".xlsx");
}
function history(index) {
  const e=state.employees[index];
  dialog("薪资档案 · "+html(e.name),'<p class="muted">'+html(e.id)+' / '+html(e.dept)+'</p>'+
    table(["生效日期","类型","变动前","生效后","备注"],e.history.map((h,i)=>[html(h.date),html(h.type),i?money(e.history[i-1].amount):"—",money(h.amount),html(h.note)]),"暂无薪资变动记录")+
    '<div class="actions signature-actions">'+link("新增薪资记录","add-history",index)+'</div>');
}
function formDialog(title, fields, onSave) {
  dialog(title,'<form id="edit-form"><div class="form-grid">'+fields+'</div><p id="form-error" class="muted" role="alert"></p><button class="btn primary" type="submit">保存</button></form>');
  $("#edit-form").onsubmit = event => {
    event.preventDefault();
    const fields=Object.fromEntries(new FormData(event.currentTarget));
    const error=onSave(Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.trim()])));
    if (error) $("#form-error").textContent=error;
  };
}
function textField(label,name,attrs="") {
  return '<label>'+label+'<input name="'+name+'" '+attrs+'></label>';
}
function addEmployee() {
  formDialog("新增员工",textField("工号","id","required maxlength=40")+textField("姓名","name","required maxlength=60")+textField("部门","dept","required maxlength=60"),(fields)=>{
    if (!fields.id || !fields.name || !fields.dept) return "工号、姓名和部门均为必填。";
    if (state.employees.some(e=>e.id===fields.id)) return "工号已存在。";
    const next=structuredClone(state);
    next.employees.push({...fields,history:[]});
    if (commit(next)) finish("员工档案已创建。");
  });
}
function addHistory(index) {
  formDialog("新增薪资记录",'<label>生效类型<select name="type"><option>试用期</option><option>转正</option><option>调薪</option></select></label>'+
    textField("生效日期","date","type=date required")+textField("月薪（元）","amount","type=number min=0 max=100000000 step=0.01 required")+textField("备注","note","maxlength=200"), fields=>{
      const amount=PayrollImport.cents(fields.amount);
      if (!Number.isSafeInteger(amount)) return "请输入有效的月薪金额。";
      const next=structuredClone(state);
      const employee=next.employees[index];
      if (employee.history.some(h=>h.date===fields.date && h.type===fields.type)) return "该生效日期和类型下已经有薪资记录。";
      employee.history.push({...fields,amount});
      employee.history.sort((a,b)=>a.date.localeCompare(b.date));
      if (commit(next)) { history(index); toast("薪资记录已保存。") }
    });
}
function versions() {
  const batch=batchFor();
  dialog("历史工资条版本",table(["版本","保存时间","来源","操作"],batch.versions.map((v,i)=>[
    "第 "+v.number+" 版",dateTime(v.createdAt),html(v.source),link("查看员工工资条","version",i)
  ])));
}
function viewVersion(i) {
  const v=batchFor().versions[i];
  dialog("第 "+v.number+" 版 · 工资条",table(["员工","工号","实发合计","签收情况","操作"],v.slips.map((r,index)=>[
    html(r.name),html(r.id),money(r.net),badge(r.status),'<button type="button" class="link" data-action="archived-slip" data-index="'+index+'" data-version="'+i+'">查看详情</button>'
  ])));
}
function sendDialog() {
  const pending=slips().filter(row=>row.status==="draft");
  if (!pending.length) return;
  dialog("确认模拟批量发放",'<p class="statusline">'+period(month)+' · '+pending.length+' 位员工 · 应发 '+money(sum(pending,"gross"))+' · 实发 '+money(sum(pending,"net"))+'</p>'+
    '<p class="muted">确认后，待发放工资条会进入待签收状态。</p><div class="actions signature-actions">'+button("确认模拟发放","send-confirm",true)+'</div>');
}
const actions={
  close:()=>modal.close(), import:importDialog, send:sendDialog, versions, version:viewVersion,
  history, "add-employee":addEmployee, "add-history":addHistory,
  slip:i=>preview(current(),i,"preview"), sign:i=>preview(current(),i,"sign"),
  "archived-slip":(i,b)=>preview(batchFor().versions[Number(b.dataset.version)],i,"preview"),
  "send-confirm":()=>{
    const next=structuredClone(state);
    const rows=next.batches.find(b=>b.month===month).versions.at(-1).slips;
    const now=new Date().toISOString();
    for (const row of rows) if (row.status==="draft") {row.status="sent";row.sentAt=now}
    if (commit(next)) finish("模拟发放完成。");
  },
  sample:()=>download("虚拟工资条样表-2026年11月","工资条",[
    ["工资条演示"],["部门","姓名","工号","基本 工资","绩效 工资","应发合计","个人社保","个税","合计","实发合计","备注"],
    ["产品设计部","林知夏","DEMO-001",9800,1200,11000,750,150,900,10100,"虚拟数据"],
    ["产品设计部","许景川","DEMO-002",11850,1500,13350,850,250,1100,12250,"虚拟数据"]
  ]),
  export:()=>download("月度薪酬分析-"+month,"部门薪酬",[
    ["薪资所属月份","部门","人数","应发薪资","实发薪资","人均应发"],
    ...insights().ordered.map(([name,d])=>[month,name,d.headcount,d.gross/100,d.net/100,Math.round(d.gross/d.headcount)/100])
  ])
};
document.addEventListener("click",event=>{
  const b=event.target.closest("[data-action]");
  if (!b || b.disabled) return;
  const action=b.dataset.action;
  if (action.startsWith("goto-")) {
    const target=action.slice(5);
    if (Object.hasOwn(pages,target)) {page=target;filter="";render()}
    return;
  }
  if (Object.hasOwn(actions,action)) actions[action](Number(b.dataset.index),b);
});
document.addEventListener("change",event=>{
  if (event.target.id==="month" && event.target.validity.valid && event.target.value) {month=event.target.value;render()}
  if (event.target.id==="status-filter") {filter=event.target.value;render();$("#status-filter").focus()}
});
document.addEventListener("input",event=>{
  if (event.target.id!=="employee-query") return;
  employeeQuery=event.target.value;
  const caret=event.target.selectionStart;
  const replacement=document.createElement("div");
  replacement.innerHTML=employeePage();
  $("#app .panel .tablebox, #app .panel .empty").replaceWith(replacement.querySelector(".tablebox, .empty"));
  $("#app .panel .section-head p").textContent=replacement.querySelector(".section-head p").textContent;
  if (caret!==null) event.target.setSelectionRange(caret,caret);
});
render();
