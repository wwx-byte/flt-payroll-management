"use strict";
const PayrollImport = (() => {
  const norm = value => String(value ?? "").replace(/\s/g, "");
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
        if (!label || skipped.has(i) || value == null || value === "") return [];
        const title = label === "小计" ? "小计（" + header[i-1] + "所在组）" : label;
        return [[title, typeof value === "number" ? Number(value.toFixed(2)) : String(value)]];
      });
      out.push({id,name,dept,gross,net,withheld,details});
    });
    if (!out.length && !errors.length) errors.push("工资表没有员工明细。");
    return {rows:out,errors};
  }
  return {parse,cents};
})();
if (typeof module !== "undefined") module.exports = PayrollImport;
