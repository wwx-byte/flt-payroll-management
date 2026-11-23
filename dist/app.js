"use strict";

const $ = selector => document.querySelector(selector);
const html = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = value => "¥" + (value/100).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2});
const period = value => value.slice(0,4)+" 年 "+Number(value.slice(5))+" 月";
const dateTime = value => new Date(value).toLocaleString("zh-CN",{hour12:false,timeZone:"Asia/Shanghai"});
const pages = {
  home:["薪酬总览","▦"], employees:["员工薪资档案","♙"], ledger:["月度薪资台账","▤"],
  delivery:["工资条与签收","✎"], analysis:["薪酬分析","▥"]
};
const statuses = {draft:"待发放",sent:"待签收",signed:"已签收",archived:"已更正",historical:"历史导入"};
const key = "payroll-workbench-v1";
const production = document.body?.dataset.mode==="production";
let revision, saving=false;
let page = "home", month = "2026-10", state, filter = "", noticeTimer;
const employeeSearchLabels = {name:"姓名",id:"工号",dept:"部门"};
const employeeSearches = {employee:{name:"",id:"",dept:""},payslip:{name:"",id:"",dept:""}};
let analysisMode = "month", analysisStart = "", analysisEnd = "";
const analysisModes = {month:"月度",quarter:"季度",year:"年度",custom:"自选区间"};
function demoDetails(base, bonus, withheld, index) {
  const skill = index%2 ? 10000 : 0;
  const social = 51000;
  const housing = 12000;
  return [
    ["应出勤（H）",176],["计薪出勤（H）",176],["加班基数",base/100],["考勤异常",0],
    ["基本工资",base/100],["技能工资",skill/100],["绩效基数",bonus/100],["绩效分数",95],
    ["绩效工资",(bonus-skill)/100],["工资与绩效小计",(base+bonus)/100],
    ["学历工资",0],["司龄工资",0],["保密工资",0],["住宿补贴",0],["通讯补贴",0],
    ["交通补贴",150],["餐费补贴",200],["平时加班",100],["周末加班费",0],["法定加班费",0],
    ["奖金",0],["增加项小计",450],["事假扣款",0],["病假",0],["旷工扣款",0],["试用期扣款",0],
    ["扣减项小计",0],["调整项",0],["个人社保",social/100],["个人公积金",housing/100],
    ["个税",(withheld-social-housing)/100],["住宿扣款",0],["备注","虚拟数据"]
  ];
}
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
        details:demoDetails(base,bonus,withheld,i),
        status:j===5 && i>6 ? "draft" : "sent",sentAt:j===5 && i>6 ? null : "2026-10-31T09:00:00Z"};
    })}]
  }));
  return {employees,batches};
}
if (!production) {
  try { state = JSON.parse(localStorage.getItem(key)) || seed() } catch { state = seed() }
}
function toast(message) {
  $("#notice").textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => $("#notice").textContent="",4600);
}
async function commit(next) {
  if (saving) return false;
  saving=true;
  try {
    if (production) {
      const response = await fetch("/api/state",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({rev:revision,state:next})});
      if (!response.ok) throw Error(await response.text());
      ({rev:revision} = await response.json());
    } else localStorage.setItem(key,JSON.stringify(next));
  } catch (error) {
    const message = error.message || "无法保存，请检查本机服务后重试。";
    const openDialog = $("#modal[open] .dialog-body");
    if (openDialog) {
      let status = openDialog.querySelector(".save-error");
      if (!status) {
        status=document.createElement("p");
        status.className="statusline error save-error";
        status.setAttribute("role","alert");
        openDialog.prepend(status);
      }
      status.textContent=message;
      status.scrollIntoView({block:"nearest"});
    } else toast(message);
    return false;
  } finally {saving=false}
  state = next;
  render();
  return true;
}
const batchFor = (value=month) => state.batches.find(batch=>batch.month===value);
const current = (value=month) => batchFor(value)?.versions.at(-1);
const slips = () => current()?.slips ?? [];
const sum = (rows,field) => rows.reduce((total,row)=>total+row[field],0);
const counts = rows => Object.fromEntries(["draft","sent","signed"].map(status=>[status, rows.filter(r=>r.status===status).length]));
function shiftMonth(value, offset) {
  const [year, number] = value.split("-").map(Number);
  return new Date(Date.UTC(year,number-1+offset,1)).toISOString().slice(0,7);
}
function payrollMonths(start,end) {
  const rows = [];
  for (let value=start; value<=end; value=shiftMonth(value,1)) rows.push({month:value,version:current(value)});
  return rows;
}
function employeePayRange(employeeId, start, end) {
  return payrollMonths(start,end).map(({month,version})=>{
    const slip = version?.slips.find(row=>row.id===employeeId);
    return {month,slip,version:slip ? version.number : null};
  });
}
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
function insights(rows=slips()) {
  const c = counts(rows), gross = sum(rows,"gross"), net = sum(rows,"net");
  const departments = new Map();
  for (const row of rows) {
    const item = departments.get(row.dept) ?? {employees:new Set(),slipCount:0,gross:0,net:0,withheld:0};
    item.employees.add(row.id);
    item.slipCount++; item.gross += row.gross; item.net += row.net; item.withheld += row.withheld;
    departments.set(row.dept,item);
  }
  const ordered = [...departments].sort((a,b)=>b[1].gross-a[1].gross);
  return {rows,c,gross,net,ordered};
}
function charts(ordered) {
  const trend = Array.from({length:6},(_,i)=>{
    const value = shiftMonth(month,i-5);
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
function dashboard() {
  const {rows,c,gross,net,ordered} = insights();
  const prev = shiftMonth(month,-1);
  const previous = current(prev);
  const prevGross = previous ? sum(previous.slips,"gross") : 0;
  const change = current() && prevGross > 0 ? ((gross-prevGross)/prevGross*100).toFixed(1)+"%" : "—";
  const cards = '<div class="cards">'+kpi("¥","应发薪资",money(gross),"环比 "+change)+kpi("¥","实发薪资",money(net),"扣款合计 "+money(sum(rows,"withheld")))+
    kpi("♙","发薪人数",rows.length+" 人","人均应发 "+(rows.length?money(Math.round(gross/rows.length)):"—"))+
    kpi("✓","签收进度",c.signed+" / "+(c.signed+c.sent),"待签收 "+c.sent+" 人 · 待发放 "+c.draft+" 人")+'</div>';
  const data = panel("工资条发放进度",period(month),payTable(rows.slice(0,6),true),button("管理发放","goto-delivery"));
  return head("薪酬总览","查看月度发薪数据、工资条进度和员工签收情况。",selector()+button("导入工资表","import",true))+cards+charts(ordered)+data;
}
function analysisBounds() {
  const zeroBased = Number(month.slice(5))-1;
  if (analysisMode==="year") return [shiftMonth(month,-zeroBased),shiftMonth(month,11-zeroBased)];
  if (analysisMode==="quarter") return [shiftMonth(month,-(zeroBased%3)),shiftMonth(month,2-zeroBased%3)];
  if (analysisMode==="custom") return [analysisStart,analysisEnd];
  return [month,month];
}
function analysisData() {
  const [start,end] = analysisBounds();
  const periods = payrollMonths(start,end);
  return {start,end,periods,...insights(periods.flatMap(({version})=>version?.slips ?? []))};
}
function analysisPage() {
  const {start,end,periods,rows,c,gross,net,ordered} = analysisData();
  const options = Object.entries(analysisModes).map(([value,label])=>'<option value="'+value+'" '+(value===analysisMode?"selected":"")+'>'+label+'</option>').join("");
  const rangePicker = [["起始月份","analysis-start",start],["结束月份","analysis-end",end]].map(([label,id,value])=>
    '<label class="analysis-month">'+label+'<input type="month" min="2000-01" max="2099-12" required id="'+id+'" value="'+value+'"></label>').join("");
  const title = head("薪酬分析","查看所选区间的公司总额、部门分布和逐月明细。",
    '<label><span class="sr">分析周期</span><select id="analysis-mode">'+options+'</select></label>'+
    (analysisMode==="custom"?rangePicker:selector())+button("导出分析","export",false,rows.length?"":"disabled"));
  if (start>end) return title+'<p class="statusline error">起始月份不能晚于结束月份。</p>';
  const covered = periods.filter(({version})=>version).length;
  const range = start===end?period(start):period(start)+" 至 "+period(end);
  const summary = '<p class="statusline">'+range+' · 有记录 '+covered+' / '+periods.length+' 个月。按每月最新版工资条汇总，含待发放记录。</p>';
  const cards = '<div class="cards">'+kpi("¥","应发合计",rows.length?money(gross):"—","按所选区间汇总")+
    kpi("¥","实发合计",rows.length?money(net):"—","应发后扣款 "+(rows.length?money(sum(rows,"withheld")):"—"))+
    kpi("♙","涉及员工",new Set(rows.map(row=>row.id)).size+" 人","工资条共 "+rows.length+" 条")+
    kpi("✓","签收进度",c.signed+" / "+(c.signed+c.sent),"待签收 "+c.sent+" 条 · 待发放 "+c.draft+" 条")+'</div>';
  const departments = table(["部门","涉及员工","应发薪资","应发后扣款","实发薪资","平均每人每月应发"],ordered.map(([name,d])=>[
    html(name),d.employees.size,money(d.gross),money(d.withheld),money(d.net),money(Math.round(d.gross/d.slipCount))
  ]),"所选区间暂无部门记录");
  const monthly = table(["工资所属月","人数","应发薪资","应发后扣款","实发薪资"],periods.map(({month:value,version})=>[
    period(value),version?version.slips.length:"无记录",
    ...["gross","withheld","net"].map(key=>version?money(sum(version.slips,key)):"—")
  ]));
  return title+summary+cards+(analysisMode==="month"?charts(ordered):"")+
    panel("部门薪酬明细","员工按工号去重，部门按工资条所属部门统计。",departments)+panel("逐月薪酬明细","",monthly);
}
function payTable(rows, delivery, version=current(), fallback) {
  return table(["员工","工号","部门","应发","应发后扣款","实发","状态","操作"],rows.map(row=>{
    const index = version.slips.indexOf(row);
    const department=delivery?html(row.dept):departmentButton(row,index,"edit-payslip-dept");
    return [html(row.name),html(row.id),department,money(row.gross),money(row.withheld),money(row.net),badge(row.status),
      link(row.status==="signed"?"查看明细与签名":"查看工资明细","slip",index)+(!production && delivery && row.status==="sent"?'　'+link("模拟员工签收","sign",index):"")];
  }),fallback);
}
function payslipResults(delivery) {
  const eligible=slips().filter(row=>!delivery || !filter || row.status===filter);
  const {matching,hasTerms}=filterEmployees(eligible,employeeSearches.payslip);
  const count=hasTerms ? "找到 "+matching.length+" 条工资条，共 "+eligible.length+" 条" : "共 "+eligible.length+" 条工资条";
  const fallback=hasTerms || (delivery && filter) ? "没有符合条件的工资条" : "当前月份暂无记录";
  return {count,results:payTable(matching,delivery,current(),fallback)};
}
function ledger(delivery) {
  const rows = slips(), v=current(), c=counts(rows);
  const historyCount = rows.filter(row=>row.status==="historical").length;
  const stats = delivery ? '待发放 '+c.draft+' 人　·　待签收 '+c.sent+' 人　·　已签收 '+c.signed+' 人'+(historyCount?'　·　历史导入 '+historyCount+' 人':"") :
    (v ? '第 '+v.number+' 版　·　'+rows.length+' 人　·　应发 '+money(sum(rows,"gross"))+'　·　实发 '+money(sum(rows,"net")) : period(month));
  const filterBox = '<label><span class="sr">签收状态</span><select id="status-filter">'+[["","全部状态"],...Object.entries(statuses).filter(([value])=>value!=="archived" && (value!=="historical" || production))].map(([value,label])=>'<option value="'+value+'" '+(filter===value?"selected":"")+'>'+label+'</option>').join("")+'</select></label>';
  return head(delivery?"工资条与签收":"月度薪资台账",delivery?"查看发放进度、预览手机签字页，并查阅员工手写签名。":"核对每位员工的应发、扣款及实发明细。",selector()+
    (delivery?(production?"":button("模拟批量发放","send",true,c.draft?"":"disabled")):button("导入工资表","import",true)))+
    (delivery?'<p class="statusline">'+(production?"历史导入保留工资条金额，钉钉推送与员工签收待接入。":"演示模式下，发放操作更新本机状态，员工签收可在此模拟。")+'</p>':"")+
    panel(delivery?"签收明细":"员工工资明细",stats,employeeSearchPanel("payslip",payslipResults(delivery)),
      (delivery?filterBox:"")+(batchFor()?.versions.length>1?button("查看历史版本","versions"):""));
}
function departmentButton(employee,index,action="edit-employee-dept") {
  return '<button class="link" type="button" data-action="'+action+'" data-index="'+index+
    '" aria-label="'+html(employee.name+'的部门：'+employee.dept+'，点击编辑')+'">'+html(employee.dept)+'</button>';
}
function filterEmployees(rows,search) {
  const normalize = value => value.normalize("NFKC").trim().toLowerCase();
  const terms = Object.entries(search).map(([field,value])=>[field,normalize(value)]).filter(([,value])=>value);
  return {matching:rows.filter(row=>terms.every(([field,value])=>normalize(row[field]).includes(value))),hasTerms:terms.length>0};
}
function employeeResults() {
  const {matching,hasTerms}=filterEmployees(state.employees,employeeSearches.employee);
  const count = hasTerms ? "找到 "+matching.length+" 位员工，共 "+state.employees.length+" 位" : "共 "+matching.length+" 位员工";
  const results = table(["工号","姓名","部门","最近薪资","操作"],matching.map(e=>{
    const i=state.employees.indexOf(e);
    return [
      html(e.id),html(e.name),departmentButton(e,i),recentStandard(e.history),
      link("查看薪资记录","history",i)+'　'+link("薪资汇总","pay-range",i)
    ];
  }),"没有找到匹配的员工");
  return {count,results};
}
function employeeSearchPanel(scope,{count,results}) {
  const search=employeeSearches[scope];
  return '<div class="employee-search" role="search" aria-label="员工搜索">'+
    Object.entries(employeeSearchLabels).map(([field,label])=>'<label>'+label+
      '<input id="'+scope+'-search-'+field+'" data-search-scope="'+scope+'" data-search-field="'+field+
      '" type="search" autocomplete="off" aria-controls="'+scope+'-results" placeholder="输入'+label+'" value="'+html(search[field])+'"></label>').join("")+
    button("清空","clear-employee-search",false,'data-search-scope="'+scope+'" '+(Object.values(search).some(Boolean)?"":"disabled"))+'</div>'+
    '<p id="'+scope+'-search-count" class="muted search-count" role="status">'+count+'</p><div id="'+scope+'-results">'+results+'</div>';
}
function employeePage() {
  return head("员工薪资档案","查看试用期、转正和历次调薪记录。",button("新增员工","add-employee",true))+
    panel("员工列表","",employeeSearchPanel("employee",employeeResults()));
}
function updateEmployeeSearch(scope) {
  const {count,results} = scope==="employee"?employeeResults():payslipResults(page==="delivery");
  $("#"+scope+"-search-count").textContent=count;
  $("#"+scope+"-results").innerHTML=results;
  $('[data-action="clear-employee-search"][data-search-scope="'+scope+'"]').disabled=!Object.values(employeeSearches[scope]).some(Boolean);
}
function render() {
  $("#nav").innerHTML = Object.entries(pages).map(([id,[label,icon]])=>'<button type="button" data-action="goto-'+id+'" '+(page===id?'aria-current="page"':'')+'><span class="navicon" aria-hidden="true">'+icon+'</span>'+label+'</button>').join("");
  $("#crumb").textContent = pages[page][0];
  const views = {home:dashboard,analysis:analysisPage,employees:employeePage,ledger:()=>ledger(false),delivery:()=>ledger(true)};
  $("#app").innerHTML = views[page]();
}
const modal = $("#modal");
function dialog(title, body) {
  modal.innerHTML = '<div class="dialog-head"><h2 id="modal-title">'+title+'</h2>'+button("关闭","close")+'</div><div class="dialog-body">'+body+'</div>';
  if (!modal.open) modal.showModal();
}
function finish(message) { modal.close(); toast(message) }
function payTotals(row) {
  const totals = [["应发合计",row?.gross],["应发后扣款",row?.withheld],["实发合计",row?.net]];
  return '<dl class="slip-totals">'+totals.map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+(value==null?"—":money(value))+'</dd></div>').join("")+'</dl>';
}
function slipDetails(row) {
  const groups = PayrollImport.groupDetails(row.details);
  const details = groups.map(group=>{
    const items = group.items.map(({title,value,unit,subtotal})=>{
      let display = value ?? "—";
      if (typeof value==="number") {
        display = unit==="元" ? money(Math.round(value*100)) :
          value.toLocaleString("zh-CN",{maximumFractionDigits:4})+(unit?" "+unit:"");
      }
      return '<div'+(subtotal?' class="subtotal"':'')+'><dt>'+html(title)+'</dt><dd>'+html(display)+'</dd></div>';
    });
    return '<section class="slip-group"><h3>'+group.title+'</h3><dl class="slip-fields">'+items.join("")+'</dl></section>';
  });
  const correction = row.correction;
  const corrected = correction?.reason ? '<div class="statusline"><strong>金额更正</strong><br>'+
    '原为第 '+html(correction.previousVersion)+' 版：应发 '+money(correction.gross)+' · 应发后扣款 '+money(correction.withheld)+' · 实发 '+money(correction.net)+
    '<br>更正时间 '+dateTime(correction.at)+'<br>原因：'+html(correction.reason)+'</div>' : "";
  return payTotals(row)+corrected+(correction?'<h3>原工资表分项</h3>':"")+
    (details.length?'<div class="slip-groups">'+details.join("")+'</div>':'<p class="muted">该工资条没有保存分项明细。</p>');
}
function preview(version, index, mode) {
  const row = version.slips[index];
  if (!row) return;
  const archived=version!==current();
  const header = '<p class="muted">'+period(month)+' · 第 '+version.number+' 版'+(archived?' · 历史版本':'')+' · '+html(row.name)+' / '+html(row.id)+' · '+html(row.dept)+'</p>'+
    (row.sourceEmployeeId?'<p class="muted">原表工号 '+html(row.sourceEmployeeId)+'</p>':"");
  const summary = header+slipDetails(row);
  const meta = row.sentAt?'<p class="muted">模拟发放时间 '+dateTime(row.sentAt)+'</p>':"";
  if (row.status==="signed") {
    const safe = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(row.signature.image) ? row.signature.image : "";
    dialog("签收详情",summary+'<hr><h3>员工手写签名</h3><img class="saved-signature" alt="手写签名" src="'+safe+'"><p class="muted">提交时间 '+dateTime(row.signature.at)+'</p>'+meta);
    return;
  }
  const signing=!production && mode==="sign" && row.status==="sent" && !archived;
  const signArea = '<hr><h3>手写签字</h3><p class="muted">'+(signing?"请在下方签名，确认已收到并查看本工资条。":production?"员工端签字区域预览。接入钉钉后可提交。":"这是员工手机上的签字区，发放后可提交签名。")+'</p>'+
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
  submit.onclick = async () => {
    if (!signing || !hasStroke || current()!==version || row.status!=="sent") return;
    const next=structuredClone(state);
    const slip=next.batches.find(b=>b.month===month).versions.at(-1).slips[index];
    slip.status="signed";
    slip.signature={image:canvas.toDataURL("image/png"),at:new Date().toISOString()};
    if (await commit(next)) finish("签收已保存，可在后台查看手写签名。");
  };
}
function importDialog() {
  dialog("导入本地工资表",'<p class="statusline">'+(production?"适配已导入的工资表结构。核对预览后保存至本机数据库。":"适配 2026 年 10 月表结构。请使用脱敏工作簿或下载虚拟样表。文件在当前浏览器内解析。")+'</p>'+
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
        output.querySelector('[data-action="accept-import"]').onclick = async () => {
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
          if (await commit(next)) {month=chosen;page="ledger";render();finish("已保存 "+found.rows.length+" 条工资条。")}
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
const standardAmount=record=>!record?"—":record.amount==null?"待确认":money(record.amount);
function recentStandard(records) {
  const latest=records.reduce((best,record)=>record.date && (!best || record.date>=best.date)?record:best,null);
  return latest?standardAmount(latest):records.length?"待确认":"—";
}
function history(index) {
  const employee=state.employees[index];
  const priced = label => /工资|补贴|加班基数/.test(label);
  const labels=[...new Set(employee.history.flatMap(record=>(record.details ?? []).map(([label])=>label)))];
  const details=[...labels.filter(priced),...labels.filter(label=>label!=="综合薪资" && !priced(label))];
  const withSource=employee.history.some(record=>record.source);
  const headers=["生效时间","类型","综合薪资",...details.map(html),"备注",...(withSource?["来源"]:[])];
  const rows=employee.history.map(record=>{
    const values=new Map(record.details ?? []);
    return [
      html(record.date?.slice(0,7) ?? "待确认"),html(record.type),standardAmount(record),
      ...details.map(label=>{
        const value=values.get(label);
        return value==null?"—":(typeof value==="number" && priced(label)?money(Math.round(value*100)):html(value));
      }),
      record.note?'<span class="salary-standard-note">'+html(record.note)+'</span>':"—",
      ...(withSource?[record.source?'<span class="salary-standard-note">'+html(record.source.file)+' · 第 '+html(record.source.row)+' 行</span>':"—"]:[])
    ];
  });
  dialog("薪资档案 · "+html(employee.name),'<div class="standard-history">'+
    '<div class="muted employee-profile-fields"><span>工号 '+html(employee.id)+'</span>'+
    '<div>部门 '+departmentButton(employee,index)+'</div></div>'+
    (details.length?'<p class="muted">可横向滚动查看全部薪资项。</p>':"")+
    table(headers,rows,"暂无薪资变动记录")+
    '<div class="actions signature-actions">'+link("新增薪资记录","add-history",index)+link("薪资汇总","pay-range",index)+'</div></div>');
  const historyTable=modal.querySelector(".standard-history .tablebox");
  if (details.length && historyTable) {
    historyTable.tabIndex=0;
    historyTable.setAttribute("role","region");
    historyTable.setAttribute("aria-label","薪资记录与分项");
  }
}
function payRangeDialog(index) {
  const employee = state.employees[index];
  dialog("薪资汇总 · "+html(employee.name),'<p class="muted">'+html(employee.id)+' / '+html(employee.dept)+'</p>'+
    '<form id="pay-range-form" class="range-form"><label>统计范围<select name="mode"><option value="recent">近 12 个月（含截止月）</option><option value="custom">自选起止月份</option></select></label>'+
    '<label id="range-start-label" hidden>起始月份<input name="start" type="month" min="1999-02" max="2099-12" required disabled></label>'+
    '<label><span id="range-end-label">截止月份</span><input name="end" type="month" min="2000-01" max="2099-12" required></label>'+
    '<button class="btn primary" type="submit">计算</button><button class="btn" id="export-pay-range" type="submit">导出 Excel</button></form>'+
    '<div id="pay-range-result" aria-live="polite"></div>');
  const form = $("#pay-range-form");
  const {mode,start,end} = form.elements;
  start.value=shiftMonth(month,-11);
  end.value=month;
  const output = $("#pay-range-result");
  const editableAmount = (month,field,label,value) => '<button class="link" type="button" data-edit-month="'+month+
    '" data-edit-field="'+field+'" aria-label="'+period(month)+' '+label+' '+money(value)+'，点击编辑">'+money(value)+'</button>';
  function calculate(exportExcel=false) {
    const last = end.value;
    const first = mode.value==="recent" ? shiftMonth(last,-11) : start.value;
    if (first>last) {
      output.innerHTML='<p class="statusline error">起始月份不能晚于结束月份。</p>';
      return;
    }
    const rows = employeePayRange(employee.id,first,last);
    const saved = rows.flatMap(row=>row.slip?[row.slip]:[]);
    const totals = saved.length ? {gross:sum(saved,"gross"),withheld:sum(saved,"withheld"),net:sum(saved,"net")} : null;
    const missing = rows.length-saved.length;
    const scope = "按每月最新版工资条汇总，包含待发放记录。";
    output.innerHTML = '<h3>'+period(first)+' 至 '+period(last)+'</h3>'+
      '<p class="muted">共 '+rows.length+' 个月，有记录 '+saved.length+' 个月，缺记录 '+missing+' 个月。'+scope+'</p>'+
      payTotals(totals)+(saved.length?'<p class="muted pay-edit-hint">点击应发或应发后扣款金额即可修改，实发会自动重算。</p>':"")+
      table(["工资所属月","应发","应发后扣款","实发","工资条"],rows.map(({month:value,slip,version})=>[
        period(value),slip?editableAmount(value,"gross","应发",slip.gross):"—",
        slip?editableAmount(value,"withheld","应发后扣款",slip.withheld):"—",slip?money(slip.net):"—",
        slip?badge(slip.status)+' <span class="muted">第 '+version+' 版</span>':'<span class="muted">无记录</span>'
      ]));
    if (exportExcel) {
      const amount = row => ["gross","withheld","net"].map(field=>row ? row[field]/100 : null);
      const columns = ["应发（元）","应发后扣款（元）","实发（元）"];
      const fileId = employee.id.replace(/[\\/:*?"<>|\u0000-\u001f]/g,"_").slice(0,40);
      download("员工薪资汇总-"+fileId+"-"+first+"至"+last,"员工薪资汇总",[
        ["姓名","工号","档案部门","起始月份","结束月份","有记录月数","缺记录月数"],
        [employee.name,employee.id,employee.dept,first,last,saved.length,missing],
        ["统计口径",scope],
        [],
        ["汇总",...columns],
        ["合计",...amount(totals)],
        [],
        ["工资所属月",...columns,"工资条状态","版本"],
        ...rows.map(({month:value,slip,version})=>[value,...amount(slip),slip?statuses[slip.status]:"无记录",version])
      ]);
    }
  }
  output.onclick = event => {
    const control=event.target.closest("[data-edit-month]");
    if (!control) return;
    const {editMonth,editField}=control.dataset;
    const version=current(editMonth);
    const original=version?.slips.find(row=>row.id===employee.id);
    if (!original) return;
    const enabled=[...form.elements,...output.querySelectorAll("[data-edit-month]")].filter(element=>!element.disabled);
    enabled.forEach(element=>element.disabled=true);
    const [monthCell,grossCell,withheldCell,netCell]=control.closest("tr").cells;
    const field=(name,label)=>'<input class="pay-edit-amount" type="number" step="0.01" required name="'+name+
      '" aria-label="'+label+'（元）" value="'+(original[name]/100).toFixed(2)+'">';
    monthCell.insertAdjacentHTML("beforeend",'<div class="pay-edit-controls"><button class="link" type="button" data-save-pay>保存</button>'+
      '<button class="link" type="button" data-cancel-pay>取消</button></div><p class="pay-edit-error" role="alert"></p>');
    grossCell.innerHTML=field("gross","应发");
    withheldCell.innerHTML=field("withheld","应发后扣款");
    const grossInput=grossCell.firstElementChild, withheldInput=withheldCell.firstElementChild;
    const save=monthCell.querySelector("[data-save-pay]"), cancel=monthCell.querySelector("[data-cancel-pay]");
    const message=monthCell.querySelector(".pay-edit-error");
    function amounts() {
      const gross=PayrollImport.cents(grossInput.value), withheld=PayrollImport.cents(withheldInput.value);
      return {gross,withheld,net:gross-withheld};
    }
    const valid=amounts=>[amounts.gross,amounts.withheld,amounts.net].every(Number.isSafeInteger)&&
      grossInput.validity.valid&&withheldInput.validity.valid;
    function finishEdit() {
      enabled.forEach(element=>element.disabled=false);
      calculate();
      output.querySelector('[data-edit-month="'+editMonth+'"][data-edit-field="'+editField+'"]')?.focus();
    }
    for (const input of [grossInput,withheldInput]) {
      input.oninput=()=>{
        const updated=amounts();
        netCell.textContent=valid(updated)?money(updated.net):"—";
        message.textContent="";
      };
    }
    cancel.onclick=finishEdit;
    save.onclick=async ()=>{
      const updated=amounts();
      if (!valid(updated)) {message.textContent="请输入有效金额，最多两位小数。";return}
      if (updated.gross===original.gross && updated.withheld===original.withheld) {finishEdit();return}
      if (current(editMonth)!==version) {finishEdit();toast("工资条已更新，请重新编辑。");return}
      const controls=[save,cancel,grossInput,withheldInput];
      controls.forEach(element=>element.disabled=true);
      const saved=await savePaySlipAmounts(employee.id,editMonth,updated);
      if (!output.isConnected) return;
      if (saved) {finishEdit();toast("工资金额已保存。")}
      else controls.forEach(element=>element.disabled=false);
    };
    (editField==="gross"?grossInput:withheldInput).focus();
  };
  form.onsubmit = event => {event.preventDefault(); calculate(event.submitter?.id==="export-pay-range")};
  mode.onchange = () => {
    const custom = mode.value==="custom";
    start.disabled = !custom;
    $("#range-start-label").hidden = !custom;
    $("#range-end-label").textContent = custom?"结束月份":"截止月份";
    if (form.checkValidity()) calculate();
  };
  mode.onchange();
}
function formDialog(title, fields, onSave) {
  dialog(title,'<form id="edit-form"><div class="form-grid">'+fields+'</div><p id="form-error" class="muted" role="alert"></p>'+
    '<button class="btn primary" type="submit">保存</button></form>');
  $("#edit-form").onsubmit = async event => {
    event.preventDefault();
    const fields=Object.fromEntries(new FormData(event.currentTarget));
    const error=await onSave(Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.trim()])));
    const message=event.target.querySelector("#form-error");
    if (error && message.isConnected) message.textContent=error;
  };
}
function textField(label,name,attrs="") {
  return '<label>'+label+'<input name="'+name+'" '+attrs+'></label>';
}
function editEmployeeDept(index,control) {
  const employee=state.employees[index];
  const employeeDialog=control.closest("dialog");
  editDepartment(employee.dept,control,dept=>{
    const next=structuredClone(state);
    next.employees[index].dept=dept;
    return commit(next);
  },form=>{
    if (employeeDialog?.open && form.isConnected) history(index);
    const target=(employeeDialog?.open?employeeDialog:$("#employee-results"))
      ?.querySelector('[data-action="edit-employee-dept"][data-index="'+index+'"]') ?? $("#employee-search-dept");
    target?.focus();
    toast("员工部门已更新。");
  });
}
function editPayslipDept(index,control) {
  const payrollMonth=month;
  const slip=slips()[index];
  if (!slip) return;
  editDepartment(slip.dept,control,dept=>savePaySlipVersion(slip.id,payrollMonth,"修改工资条部门",row=>{row.dept=dept}),()=>{
    if (page==="ledger" && month===payrollMonth) {
      const target=$('[data-action="edit-payslip-dept"][data-index="'+index+'"]') ?? $("#payslip-search-dept");
      target?.focus();
    }
    toast("本月工资条部门已更新。");
  });
}
function editDepartment(original,control,save,onSaved) {
  const activeEditor=control.closest("dialog,.tablebox").querySelector(".inline-dept-form");
  if (activeEditor) {activeEditor.elements.dept.focus();return}
  control.hidden=true;
  control.insertAdjacentHTML("afterend",'<form class="inline-dept-form"><input type="text" name="dept" aria-label="部门" required maxlength="60" value="'+html(original)+'">'+
    '<button class="link" type="submit">保存</button><button class="link" type="button" data-cancel-dept>取消</button>'+
    '<span class="pay-edit-error" role="alert"></span></form>');
  const form=control.nextElementSibling;
  const input=form.elements.dept;
  const cancel=()=>{
    form.remove();
    control.hidden=false;
    control.focus();
  };
  form.querySelector("[data-cancel-dept]").onclick=cancel;
  form.onsubmit=async event=>{
    event.preventDefault();
    const dept=input.value.trim();
    if (!dept) {form.querySelector("[role=alert]").textContent="请输入部门。";return}
    if (dept===original) {cancel();return}
    const controls=[...form.elements];
    controls.forEach(element=>element.disabled=true);
    if (await save(dept)) onSaved(form);
    else controls.forEach(element=>element.disabled=false);
  };
  input.focus();
  input.select();
}
function savePaySlipAmounts(employeeId,payrollMonth,amounts) {
  return savePaySlipVersion(employeeId,payrollMonth,"修改工资金额",(slip,number,now)=>{
    slip.correction={at:now,previousVersion:number,gross:slip.gross,withheld:slip.withheld,net:slip.net};
    Object.assign(slip,amounts);
  });
}
function savePaySlipVersion(employeeId,payrollMonth,source,edit) {
  const next=structuredClone(state);
  const batch=next.batches.find(item=>item.month===payrollMonth);
  const version=structuredClone(batch.versions.at(-1));
  const slip=version.slips.find(row=>row.id===employeeId);
  const now=new Date().toISOString();
  edit(slip,version.number,now);
  if (slip.status!=="historical") slip.status="draft";
  delete slip.signature;
  delete slip.sentAt;
  batch.versions.push({number:version.number+1,source:source+" · "+employeeId,createdAt:now,slips:version.slips});
  return commit(next);
}
function addEmployee() {
  formDialog("新增员工",textField("工号","id","required maxlength=40")+textField("姓名","name","required maxlength=60")+textField("部门","dept","required maxlength=60"),async fields=>{
    if (!fields.id || !fields.name || !fields.dept) return "工号、姓名和部门均为必填。";
    if (state.employees.some(e=>e.id===fields.id)) return "工号已存在。";
    const next=structuredClone(state);
    next.employees.push({...fields,history:[]});
    if (await commit(next)) finish("员工档案已创建。");
  });
}
function addHistory(index) {
  formDialog("新增薪资记录",'<label>生效类型<select name="type"><option>试用期</option><option>转正</option><option>调薪</option></select></label>'+
    textField("生效日期","date","type=date required")+textField("月薪（元）","amount","type=number min=0 max=100000000 step=0.01 required")+textField("备注","note","maxlength=200"), async fields=>{
      const amount=PayrollImport.cents(fields.amount);
      if (!Number.isSafeInteger(amount)) return "请输入有效的月薪金额。";
      const next=structuredClone(state);
      const employee=next.employees[index];
      if (employee.history.some(h=>h.date===fields.date && h.type===fields.type)) return "该生效日期和类型下已经有薪资记录。";
      const after=employee.history.findIndex(record=>record.date && record.date>fields.date);
      employee.history.splice(after<0?employee.history.length:after,0,{...fields,amount});
      if (await commit(next)) { history(index); toast("薪资记录已保存。") }
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
  if (production) return;
  const pending=slips().filter(row=>row.status==="draft");
  if (!pending.length) return;
  dialog("确认模拟批量发放",'<p class="statusline">'+period(month)+' · '+pending.length+' 位员工 · 应发 '+money(sum(pending,"gross"))+' · 实发 '+money(sum(pending,"net"))+'</p>'+
    '<p class="muted">确认后，待发放工资条会进入待签收状态。</p><div class="actions signature-actions">'+button("确认模拟发放","send-confirm",true)+'</div>');
}
const actions={
  close:()=>modal.close(), import:importDialog, send:sendDialog, versions, version:viewVersion,
  history, "pay-range":index=>payRangeDialog(index), "add-employee":addEmployee, "add-history":addHistory,
  "edit-employee-dept":editEmployeeDept,
  "edit-payslip-dept":editPayslipDept,
  "clear-employee-search":(_,control)=>{
    const scope=control.dataset.searchScope;
    if (!Object.hasOwn(employeeSearches,scope)) return;
    for (const field of Object.keys(employeeSearches[scope])) {
      employeeSearches[scope][field]="";
      $("#"+scope+"-search-"+field).value="";
    }
    updateEmployeeSearch(scope);
    $("#"+scope+"-search-name").focus();
  },
  slip:i=>preview(current(),i,"preview"), sign:i=>preview(current(),i,"sign"),
  "archived-slip":(i,b)=>preview(batchFor().versions[Number(b.dataset.version)],i,"preview"),
  "send-confirm":async ()=>{
    if (production) return;
    const next=structuredClone(state);
    const rows=next.batches.find(b=>b.month===month).versions.at(-1).slips;
    const now=new Date().toISOString();
    for (const row of rows) if (row.status==="draft") {row.status="sent";row.sentAt=now}
    if (await commit(next)) finish("模拟发放完成。");
  },
  sample:()=>{
    const sample = seed().batches.at(-1).versions[0].slips.slice(0,2);
    const fields = sample[0].details.map(([label])=>label);
    download("虚拟工资条样表-2026年11月","工资条",[
      ["工资条演示"],["部门","姓名","工号","应发合计","合计","实发合计",...fields],
      ...sample.map(row=>[row.dept,row.name,row.id,row.gross/100,row.withheld/100,row.net/100,...row.details.map(([,value])=>value)])
    ]);
  },
  export:()=>{
    const {start,end,ordered} = analysisData();
    download("薪酬分析-"+start+(start===end?"":"至"+end),"部门薪酬",[
      ["起始月份","结束月份","部门","涉及员工","应发薪资","应发后扣款","实发薪资","平均每人每月应发"],
      ...ordered.map(([name,d])=>[start,end,name,d.employees.size,d.gross/100,d.withheld/100,d.net/100,Math.round(d.gross/d.slipCount)/100])
    ]);
  }
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
  const {id,value,validity} = event.target;
  if (id==="month" && validity.valid && value) {month=value;render()}
  if (id==="status-filter") {filter=value;render();$("#status-filter").focus()}
  if (id==="analysis-mode" && Object.hasOwn(analysisModes,value)) {
    if (value==="custom" && !analysisStart) [analysisStart,analysisEnd] = analysisBounds();
    analysisMode=value;render();$("#analysis-mode").focus();
  }
  if (page==="analysis" && (id==="analysis-start" || id==="analysis-end") && validity.valid) {
    if (id==="analysis-start") analysisStart=value;
    else analysisEnd=value;
    render();
  }
});
document.addEventListener("input",event=>{
  const {searchScope,searchField}=event.target.dataset ?? {};
  if (!Object.hasOwn(employeeSearches,searchScope) || !Object.hasOwn(employeeSearchLabels,searchField)) return;
  employeeSearches[searchScope][searchField]=event.target.value;
  updateEmployeeSearch(searchScope);
});
async function start() {
  if (production) {
    $(".top .demo").outerHTML='<form method="post" action="/logout"><button class="btn logout">退出登录</button></form>';
    $(".profile small").remove();
    $("#app").innerHTML='<p class="statusline">正在读取本机薪资台账…</p>';
    try {
      const response=await fetch("/api/state",{cache:"no-store"});
      if (response.status===401) {location.reload();return}
      if (!response.ok) throw Error();
      ({state,rev:revision}=await response.json());
      month=state.batches.map(batch=>batch.month).sort().at(-1) ?? month;
    } catch {
      $("#app").innerHTML='<p class="statusline error">本机台账暂时无法读取。请检查服务并刷新页面。</p>';
      return;
    }
  }
  render();
}
start();
