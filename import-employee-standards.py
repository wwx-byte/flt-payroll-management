"""Import the approved employee salary standards into the local archive."""
import argparse
from collections import Counter
from contextlib import closing
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from getpass import getpass
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
import re
import sqlite3

import msoffcrypto
import openpyxl

from server import DATA, db, read_state, store, validate_state

DEFERRED = {610, 612, 614, 617}
MATCH_BY_NAME = {345, 608, 615, 616, 618, 619}
PENDING_AMOUNT = 597
DATE_PATTERN = re.compile(
    r"(?<!\d)(20\d{2})(?:\s*年\s*|[./-])\s*(1[0-2]|0?[1-9])(?!\d)"
    r"(?:(?:\s*月\s*((?:[12]\d|3[01]|0?[1-9]))\s*[日号])|(?:[./-](3[01]|[12]\d|0?[1-9])(?!\d)))?"
)


def clean(value):
    return str(value).strip() if value is not None else ""


def effective_date(note, hire, first):
    dates = set()
    for match in DATE_PATTERN.finditer(note):
        year, month, day, numeric_day = match.groups()
        day = day or numeric_day
        try:
            dates.add(date(int(year), int(month), int(day)).isoformat() if day else f"{year}-{int(month):02}")
        except ValueError:
            return None
    if len({value[:7] for value in dates}) > 1:
        return None
    days = {value for value in dates if len(value) == 10}
    if days:
        return next(iter(days)) if len(days) == 1 else None
    if dates:
        return next(iter(dates))
    return hire.date().isoformat() if first and isinstance(hire, datetime) else None


def source_value(value):
    return value.date().isoformat() if isinstance(value, datetime) else value


def prepare(source, workbook, checksum, state):
    sheets = workbook.worksheets
    if len(sheets) != 1:
        raise ValueError("工资标准表结构与已核对的版本不同。")
    sheet = sheets[0]
    rows = iter(sheet.values)
    next(rows)
    headers = [re.sub(r"\s+", "", clean(label)) for label in next(rows)]
    if headers[1:4] != ["工号","姓名","部门"] or headers[18:21] != ["补贴合计","综合薪资","备注"]:
        raise ValueError("工资标准表头与已核对的版本不同。")

    employees = {e["id"]: e for e in state["employees"]}
    seen_employees = set()
    source_keys = {(h["source"]["checksum"],h["source"]["row"]) for e in employees.values()
                   for h in e["history"] if "source" in h}
    counts = Counter()
    group = None
    imported_employees = set()
    for line,row in enumerate(rows,3):
        if row[1] not in (None,""):
            group = (line,clean(row[1]),clean(row[2]),clean(row[3]),row[7])
        if not isinstance(row[19],(int,float)) or isinstance(row[19],bool):
            if row[1] not in (None,""):
                raise ValueError(f"第 {line} 行有工号但缺少综合薪资。")
            continue
        counts["source_records"] += 1
        if group is None:
            raise ValueError(f"第 {line} 行缺少归属的员工。")
        anchor,source_id,name,dept,hire=group
        if anchor in DEFERRED:
            counts["deferred"] += 1
            continue
        employee=employees.get(source_id)
        if anchor in MATCH_BY_NAME:
            matches=[e for e in employees.values() if e["name"]==name]
            if len(matches)!=1:
                raise ValueError(f"第 {anchor} 行无法找到获确认的唯一同名档案。")
            employee=matches[0]
        if not employee or employee["name"]!=name:
            raise ValueError(f"第 {anchor} 行工号与姓名无法核对。")
        first=employee["id"] not in seen_employees
        seen_employees.add(employee["id"])
        note=clean(row[20])
        effective=effective_date(note,hire,first)
        if "转正" in note:
            kind="转正"
        elif "试用" in note:
            kind="试用期"
        else:
            kind="初始标准" if first else "调薪"
        cents=int((Decimal(str(row[19]))*100).quantize(Decimal("1"),rounding=ROUND_HALF_UP))
        amount=None if line==PENDING_AMOUNT else cents
        if (line==PENDING_AMOUNT and cents!=0) or (line!=PENDING_AMOUNT and cents==0):
            raise ValueError(f"第 {line} 行零元记录与确认范围不符。")
        if (checksum,line) in source_keys:
            counts["already_imported"] += 1
            continue
        details=[[headers[i],source_value(row[i])] for i in range(4,20)]
        details[15][1]=None if amount is None else details[15][1]
        details.insert(0,["原表部门",dept])
        if employee["id"]!=source_id:
            details.insert(0,["原表工号",source_id])
        audit={"file":source.name,"checksum":checksum,"row":line}
        if amount is None:
            audit["originalAmount"]=cents
        employee["history"].append({"date":effective,"type":kind,"amount":amount,"note":note,"details":details,"source":audit})
        counts["imported"]+=1
        counts["unknown_date"]+=effective is None
        counts["month_only"]+=bool(effective and len(effective)==7)
        counts["unknown_amount"]+=amount is None
        counts[kind]+=1
        imported_employees.add(employee["id"])
    counts["employees"]=len(imported_employees)
    if counts["source_records"]!=631:
        raise ValueError("原表有效记录数不是已核对的 631 条。")
    validate_state(state)
    return dict(counts)


def backup_database():
    target=DATA/"backups"
    target.mkdir(mode=0o700,exist_ok=True)
    name="before-salary-standards-"+datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")+".sqlite3"
    path=target/name
    with closing(db()) as source, closing(sqlite3.connect(path)) as backup:
        source.backup(backup)
        if backup.execute("PRAGMA integrity_check").fetchone()!=("ok",):
            raise RuntimeError("薪资数据库备份校验未通过。")
    return name


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("file",type=Path)
    parser.add_argument("--apply",action="store_true")
    args=parser.parse_args()
    os.umask(0o077)
    encrypted=args.file.read_bytes()
    checksum=sha256(encrypted).hexdigest()
    office=msoffcrypto.OfficeFile(BytesIO(encrypted))
    office.load_key(password=getpass("Excel password: "),verify_password=True)
    clear=BytesIO()
    office.decrypt(clear,verify_integrity=True)
    clear.seek(0)
    workbook=openpyxl.load_workbook(clear,read_only=True,data_only=True)
    with closing(db()) as con:
        con.execute("BEGIN IMMEDIATE" if args.apply else "BEGIN")
        rev,state=read_state(con)
        stats=prepare(args.file,workbook,checksum,state)
        if args.apply and stats.get("imported"):
            stats["backup"]=backup_database()
            store(con,rev,state)
            con.commit()
    print(json.dumps(stats,ensure_ascii=False))


if __name__=="__main__":
    main()
