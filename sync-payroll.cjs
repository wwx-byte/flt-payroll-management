const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const XLSX = require("./dist/xlsx.js");
const {parse} = require("./dist/import.js");

const workbooks = process.argv.slice(2).map(file => {
  const source = path.basename(file);
  const match = source.match(/(20\d{2})年(\d{1,2})月/);
  if (!match || Number(match[2])<1 || Number(match[2])>12) throw Error("文件名缺少有效工资所属月份。");
  const bytes = fs.readFileSync(file);
  const wb = XLSX.read(bytes);
  if (wb.SheetNames.length!==1) throw Error("历史同步要求每份文件只有一个工资明细工作表。");
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,raw:true,defval:null});
  const headerIndex = rows.findIndex(row => ["工号","姓名","部门"].every(label=>row.some(cell=>String(cell??"").replace(/\s/g,"")===label)));
  if (headerIndex<0) throw Error("找不到工资表工号、姓名、部门。");
  const header = rows[headerIndex].map(value=>String(value??"").replace(/\s/g,""));
  const month = match[1]+"-"+match[2].padStart(2,"0");
  const columns = Object.fromEntries(["工号","姓名","部门"].map(name=>[name,header.indexOf(name)]));
  let lastPayrollRow = rows.findLastIndex((row,index)=>index>headerIndex && [columns["工号"],columns["部门"]].some(col=>row[col]!=null && row[col]!==""));
  const footer = rows.slice(lastPayrollRow+1);
  if (lastPayrollRow>headerIndex && footer[0]?.every(cell=>cell==null || cell==="") &&
      footer.every(row=>row.every((cell,col)=>cell==null || cell==="" || (col===columns["姓名"] && typeof cell==="string")))) {
    rows.splice(lastPayrollRow+1);
  }
  return {source,month,checksum:crypto.createHash("sha256").update(bytes).digest("hex"),rows,headerIndex,columns};
}).sort((a,b)=>a.month.localeCompare(b.month));

if (!workbooks.length || new Set(workbooks.map(w=>w.month)).size!==workbooks.length) throw Error("请选择所属月份互不重复的工资表。");

const identities = new Map();
for (const workbook of workbooks) {
  const {columns,rows,headerIndex} = workbook;
  workbook.identities = rows.slice(headerIndex+1).flatMap((row,index)=>{
    const [id,name,dept]=[columns["工号"],columns["姓名"],columns["部门"]].map(col=>String(row[col]??"").trim());
    if (!id || !name || !dept) return [];
    const names = identities.get(id) ?? new Set();
    identities.set(id,names);
    names.add(name);
    return [{id,name,dept,index:index+headerIndex+1}];
  });
}
const confirmed = new Map();
for (const workbook of workbooks) for (const {id,name,dept} of workbook.identities) {
  if (identities.get(id).size!==1) continue;
  const key=JSON.stringify([name,dept]);
  const ids=confirmed.get(key)??new Set();
  ids.add(id); confirmed.set(key,ids);
}
const batches = workbooks.map(({month,source,checksum,rows,identities:entries,columns})=>{
  const original = new Map();
  for (const entry of entries) {
    if (identities.get(entry.id).size===1) continue;
    const matches=confirmed.get(JSON.stringify([entry.name,entry.dept]));
    if (matches?.size!==1) throw Error(month+" 第 "+(entry.index+1)+" 行工号冲突，缺少唯一的姓名和部门匹配。");
    const [id]=matches;
    rows[entry.index][columns["工号"]]=id;
    original.set(id,entry.id);
  }
  const result=parse(rows);
  if (result.errors.length) throw Error(month+" "+result.errors.join("；"));
  return {month,source,checksum,slips:result.rows.map(s=>({
    ...s,...(original.has(s.id)?{sourceEmployeeId:original.get(s.id)}:{}),status:"historical"
  }))};
});
process.stdout.write(JSON.stringify(batches));
