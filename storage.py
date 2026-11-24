"""SQLite storage and validation shared by the payroll service and import tools."""
import hashlib
import json
import os
import re
import secrets
import sqlite3
from contextlib import closing
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
MONTH = re.compile(r"20\d{2}-(?:0[1-9]|1[0-2])")


def db():
    return sqlite3.connect(DATA / "payroll.sqlite3", timeout=10, isolation_level=None)


def pack(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)


def initialize():
    if not (DATA / "payroll.sqlite3").exists():
        for legacy in (ROOT / "payroll-data", ROOT.parent / "payroll-data"):
            if (legacy / "payroll.sqlite3").is_file():
                raise SystemExit(f"发现旧版薪资数据库。请停止旧服务并备份，将 {legacy} 中的台账和配套文件迁移到 {DATA} 后重启。")
    os.umask(0o077)
    DATA.mkdir(mode=0o700, exist_ok=True)
    DATA.chmod(0o700)
    with closing(db()) as con:
        con.execute("CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), rev INTEGER NOT NULL, value TEXT NOT NULL)")
        con.execute("CREATE TABLE IF NOT EXISTS account (id INTEGER PRIMARY KEY CHECK(id=1), salt BLOB NOT NULL, digest BLOB NOT NULL)")
        con.execute("INSERT OR IGNORE INTO state VALUES (1, 0, ?)", (pack({"employees": [], "batches": []}),))
        if not con.execute("SELECT id FROM account").fetchone():
            passfile = DATA / "initial-login.txt"
            if passfile.exists():
                password = passfile.read_text().splitlines()[-1]
            else:
                password = secrets.token_urlsafe(24)
                with passfile.open("x") as out:
                    out.write("admin\n" + password + "\n")
            salt = secrets.token_bytes(16)
            con.execute("INSERT INTO account VALUES (1, ?, ?)", (salt, password_hash(password, salt)))


def read_state(con):
    rev, raw = con.execute("SELECT rev, value FROM state WHERE id=1").fetchone()
    return rev, json.loads(raw)


def store(con, rev, state):
    con.execute("UPDATE state SET rev=?, value=? WHERE id=1", (rev+1, pack(state)))


def unique_items(items, key):
    values = {item[key]: item for item in items}
    if len(values) != len(items):
        raise ValueError("数据存在重复记录。")
    return values


def validate_state(state):
    employees = unique_items(state["employees"], "id")
    batches = unique_items(state["batches"], "month")
    for employee in employees.values():
        if any(not isinstance(employee[key], str) or not employee[key].strip() for key in ("id", "name", "dept")):
            raise ValueError("员工档案缺少有效工号、姓名或部门。")
        for record in employee["history"]:
            source = record.get("source")
            amount = record["amount"]
            date = record["date"]
            if record["type"] not in ("试用期", "转正", "调薪", "初始标准"):
                raise ValueError("薪资档案含无效类型或金额。")
            if not (source and amount is None) and (type(amount) is not int or not 0 <= amount <= 2**53-1):
                raise ValueError("薪资档案含无效金额。")
            if not (source and date is None):
                datetime.strptime(date, "%Y-%m" if source and MONTH.fullmatch(date) else "%Y-%m-%d")
            if source:
                if not isinstance(source["file"], str) or type(source["row"]) is not int or source["row"] < 3:
                    raise ValueError("薪资档案的来源无效。")
                validate_details(record["details"])
    for month, batch in batches.items():
        if not MONTH.fullmatch(month) or not batch["versions"]:
            raise ValueError("工资条月份或版本无效。")
        for number, version in enumerate(batch["versions"], start=1):
            if version["number"] != number or not version["slips"]:
                raise ValueError("工资条版本无效。")
            for slip in unique_items(version["slips"], "id").values():
                if slip["id"] not in employees or slip["name"] != employees[slip["id"]]["name"]:
                    raise ValueError("工资条工号与员工档案不一致。")
                values = [slip[key] for key in ("gross", "withheld", "net")]
                if any(type(value) is not int or abs(value) > 2**53-1 for value in values) or abs(values[0]-values[1]-values[2]) > 1:
                    raise ValueError("工资条金额无法核对。")
                if slip["status"] not in ("draft", "historical"):
                    raise ValueError("当前版本仅支持历史导入与待发放状态。")
                validate_details(slip["details"])


def validate_details(details):
    if not isinstance(details, list) or any(not isinstance(pair, list) or len(pair) != 2 or
            not isinstance(pair[0], str) or not isinstance(pair[1], (str, int, float, type(None))) for pair in details):
        raise ValueError("薪资分项格式无效。")
