"use strict";
const PayrollImport = (() => {
  const norm = value => String(value ?? "").replace(/\s/g, "");
  const detailGroups = [
    {title:"出勤与计薪",fields:["应出勤（H）","计薪出勤（H）","加班基数","考勤异常"]},
    {title:"工资与绩效",fields:["基本工资","技能工资","绩效基数","绩效分数","绩效工资"],subtotal:"工资与绩效小计"},
    {title:"津贴、补贴与加班",fields:["学历工资","司龄工资","保密工资","住宿补贴","通讯补贴","交通补贴","餐费补贴","交通及餐费补贴","平时加班","周末加班费","法定加班费","奖金"],subtotal:"增加项小计"},
    {title:"应发前扣减与调整",fields:["事假扣款","病假","旷工扣款","试用期扣款","调整项"],subtotal:"扣减项小计"},
    {title:"代缴及其他扣款",fields:["个人社保","个人公积金","个税","住宿扣款"]},
    {title:"其他明细",fields:[]}
  ];
  const subtotalFor = label => detailGroups.find(group => group.fields.includes(label))?.subtotal;
  const sourceUnits = new Map([["应出勤（H）","小时"],["计薪出勤（H）","小时"],["绩效分数","分"],["考勤异常",""],["加班基数",""],["绩效基数",""],["备注",""]]);
  function groupDetails(details) {
    const groups = detailGroups.map(group => ({title:group.title,items:[]}));
    for (const [oldLabel,value] of details) {
      const label = norm(oldLabel).replace(/\(H\)/i,"（H）");
      const legacy = label.match(/^小计（(.+)所在组）$/);
      const title = (legacy && subtotalFor(legacy[1])) || label;
      const group = detailGroups.findIndex(section => section.fields.includes(title) || section.subtotal===title);
      const unit = sourceUnits.get(title) ?? (group >= 0 ? "元" : "");
      groups[group >= 0 ? group : groups.length-1].items.push({title,value,unit,subtotal:detailGroups.some(section => section.subtotal===title)});
    }
    return groups.filter(group => group.items.length);
  }
  const aliases = {
    id:["工号","员工编号"], name:["姓名","员工姓名"], dept:["部门"],
    gross:["应发合计","应发金额","应发工资"], net:["实发合计","实发金额","实发工资"]
  };
  const cents = value => {
    const s = String(value ?? "").trim().replace(/[,，]/g, "");
    if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
    const rounded = Math.round(Math.abs(Number(s)) * 100 + 1e-8);
    return Number.isSafeInteger(rounded) ? Math.sign(Number(s)) * rounded : NaN;
  };
  function parse(rows) {
    const headerIndex = rows.findIndex((row, index) => index < 20 && Object.values(aliases).every(names => row.some(value => names.includes(norm(value)))));
    if (headerIndex < 0) return {rows:[], errors:["找不到表头。需要部门、姓名、工号、应发合计和实发合计。"]};
    const header = rows[headerIndex].map(norm);
    const col = Object.fromEntries(Object.entries(aliases).map(([key,names]) => [key,header.findIndex(value => names.includes(value))]));
    const deductionColumns = ["扣款合计","扣款金额","合计"];
    const deduction = deductionColumns.map(name => header.findIndex((value,index) => value === name && index > col.gross && index < col.net)).find(index => index >= 0);
    const skipped = new Set([...Object.values(col), deduction]);
    const out = [], errors = [], seen = new Set();
    rows.slice(headerIndex+1).forEach((row,index) => {
      if (!row.some(value => norm(value))) return;
      const id = String(row[col.id] ?? "").trim();
      const name = String(row[col.name] ?? "").trim();
      const dept = String(row[col.dept] ?? "").trim();
      if (!id && /^(合计|总计)$/.test(name || dept)) return;
      const gross = cents(row[col.gross]), net = cents(row[col.net]);
      const withheld = deduction === undefined ? gross-net : cents(row[deduction]);
      const line = "第 " + (headerIndex+index+2) + " 行";
      if (!id || !name || !dept) {errors.push(line+"缺少部门、姓名或工号");return}
      if (seen.has(id)) {errors.push(line+"工号重复");return}
      seen.add(id);
      if (![gross,net,withheld].every(Number.isSafeInteger)) {errors.push(line+"应发、扣款或实发金额无效");return}
      if (Math.abs(gross-withheld-net) > 1) {errors.push(line+"应发减扣款与实发不符");return}
      const details = header.flatMap((label,i) => {
        const value = row[i];
        if (!label || skipped.has(i)) return [];
        const title = label === "小计" ? subtotalFor(header[i-1]) ?? "小计（" + header[i-1] + "所在组）" : label;
        return [[title, value == null || value === "" ? null : typeof value === "number" ? value : String(value)]];
      });
      out.push({id,name,dept,gross,net,withheld,details});
    });
    if (!out.length && !errors.length) errors.push("工资表没有员工明细。");
    return {rows:out,errors};
  }
  return {parse,cents,groupDetails};
})();
if (typeof module !== "undefined") module.exports = PayrollImport;
