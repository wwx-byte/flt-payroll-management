"""Authenticated payroll workplace."""
import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import closing
from datetime import datetime, timezone
from http.cookies import SimpleCookie, CookieError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parent
DATA = ROOT.parent / "payroll-data"
USERNAME = "admin"
MAX_BODY = 40 * 1024 * 1024
SESSION_AGE = 8 * 60 * 60
ASSETS = {"/style.css": "text/css", "/app.js": "application/javascript",
          "/import.js": "application/javascript", "/xlsx.js": "application/javascript"}
MONTH = re.compile(r"20\d{2}-(?:0[1-9]|1[0-2])")
CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"


def db():
    return sqlite3.connect(DATA / "payroll.sqlite3", timeout=10, isolation_level=None)


def pack(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)


def initialize():
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


def sync(batches):
    with closing(db()) as con:
        con.execute("BEGIN IMMEDIATE")
        rev, state = read_state(con)
        existing = unique_items(state["batches"], "month")
        employees = unique_items(state["employees"], "id")
        stats = []
        for batch in batches:
            month = batch["month"]
            if month in existing:
                latest = existing[month]["versions"][-1]
                if latest.get("checksum") == batch["checksum"]:
                    continue
                raise ValueError(month + " 已有不同版本，请通过界面复核后导入。")
            for row in batch["slips"]:
                employee = employees.get(row["id"])
                if employee is None:
                    employee = {key: row[key] for key in ("id", "name", "dept")}
                    employee["history"] = []
                    state["employees"].append(employee)
                    employees[row["id"]] = employee
                elif employee["name"] != row["name"]:
                    raise ValueError(month + " 存在同一工号对应不同姓名，需要先核对。")
                employee["dept"] = row["dept"]
            new = {"month": month, "versions": [{
                "number": 1, "source": batch["source"], "checksum": batch["checksum"],
                "createdAt": datetime.now(timezone.utc).isoformat(), "slips": batch["slips"]
            }]}
            state["batches"].append(new)
            existing[month] = new
            stats.append((month, len(batch["slips"]), sum("sourceEmployeeId" in row for row in batch["slips"])))
        if stats:
            validate_state(state)
            store(con, rev, state)
        con.commit()
        print(pack({"imported": stats, "employees": len(employees)}))


LOGIN = """<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>登录薪酬工作台</title>
<link rel="stylesheet" href="/style.css"><body style="display:block">
<main style="width:min(440px,calc(100% - 32px));margin:12vh auto">
<section class="panel" style="padding:28px"><h1>薪酬工作台</h1>
<p class="muted" style="margin:10px 0 20px">使用管理员账号登录本机薪资系统。</p>
{message}<form method="post" action="/login" class="form-grid">
<label>账号<input name="username" required autocomplete="username" autofocus></label>
<label>密码<input name="password" type="password" required autocomplete="current-password"></label>
<button class="btn primary">登录</button></form></section></main></body></html>"""


class Handler(BaseHTTPRequestHandler):
    timeout = 10
    auth_lock = Lock()
    sessions = {}
    attempts = []
    origin = ""
    public_host = ""
    cookie_attributes = "; Path=/; HttpOnly; SameSite=Strict"

    def log_message(self, *_):
        pass

    def respond(self, status, content=b"", media="text/plain; charset=utf-8", headers=()):
        if isinstance(content, str):
            content = content.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", media)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        for name, value in headers:
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(content)

    def login_page(self, status=200, message=""):
        detail = '<p class="statusline error">'+message+'</p>' if message else ""
        self.respond(status, LOGIN.format(message=detail), "text/html; charset=utf-8")

    def token(self):
        try:
            return SimpleCookie(self.headers.get("Cookie", ""))["payroll_session"].value
        except (KeyError, CookieError):
            return ""

    def authenticated(self):
        token = self.token()
        with self.auth_lock:
            return self.sessions.get(token, 0) > time.monotonic()

    def local_request(self, mutate=False):
        if self.headers.get("Host") != self.public_host:
            self.respond(403, "请使用薪酬工作台地址。")
            return False
        if mutate and self.headers.get("Origin") != self.origin:
            self.respond(403, "请求来源无效。")
            return False
        return True

    def payload(self, limit):
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= limit:
            raise ValueError("请求大小无效。")
        return self.rfile.read(length)

    def do_GET(self):
        if not self.local_request():
            return
        path = urlsplit(self.path).path
        if path == "/":
            if not self.authenticated():
                return self.login_page()
            index = (ROOT / "dist/index.html").read_text().replace("<body>", '<body data-mode="production">')
            return self.respond(200, index, "text/html; charset=utf-8")
        if path in ASSETS:
            return self.respond(200, (ROOT / "dist" / path[1:]).read_bytes(), ASSETS[path])
        if path == "/api/state":
            if not self.authenticated():
                return self.respond(401, "请重新登录。")
            with closing(db()) as con:
                rev, state = read_state(con)
            return self.respond(200, pack({"rev": rev, "state": state}), "application/json; charset=utf-8")
        self.respond(404, "页面不存在。")

    def do_POST(self):
        if not self.local_request(mutate=True):
            return
        path = urlsplit(self.path).path
        try:
            if path == "/login":
                with self.auth_lock:
                    now = time.monotonic()
                    self.attempts[:] = [at for at in self.attempts if now-at < 60]
                    allowed = len(self.attempts) < 8
                    if allowed:
                        self.attempts.append(now)
                if not allowed:
                    return self.login_page(429, "尝试次数过多，请一分钟后再试。")
                fields = parse_qs(self.payload(4096).decode())
                name = fields.get("username", [""])[0]
                password = fields.get("password", [""])[0]
                with closing(db()) as con:
                    salt, digest = con.execute("SELECT salt, digest FROM account WHERE id=1").fetchone()
                valid = hmac.compare_digest(password_hash(password, salt), digest)
                if name != USERNAME or not valid:
                    return self.login_page(401, "账号或密码不正确。")
                token = secrets.token_urlsafe(32)
                with self.auth_lock:
                    self.attempts.clear()
                    for expired, expires in list(self.sessions.items()):
                        if expires <= now:
                            del self.sessions[expired]
                    self.sessions[token] = now+SESSION_AGE
                return self.respond(303, headers=(("Location", "/"), (
                    "Set-Cookie", "payroll_session="+token+self.cookie_attributes)))
            if not self.authenticated():
                return self.respond(401, "请重新登录。")
            if path == "/logout":
                token = self.token()
                with self.auth_lock:
                    self.sessions.pop(token, None)
                return self.respond(303, headers=(("Location", "/"), (
                    "Set-Cookie", "payroll_session=; Max-Age=0"+self.cookie_attributes)))
            if path != "/api/state" or self.headers.get_content_type() != "application/json":
                return self.respond(404, "请求接口无效。")
            data = json.loads(self.payload(MAX_BODY))
            next_state = data["state"]
            validate_state(next_state)
            with closing(db()) as con:
                con.execute("BEGIN IMMEDIATE")
                rev, current = read_state(con)
                if data["rev"] != rev:
                    return self.respond(409, "数据已在其他窗口更新，请刷新后重试。")
                new_months = unique_items(next_state["batches"], "month")
                for batch in current["batches"]:
                    versions = batch["versions"]
                    if new_months.get(batch["month"], {}).get("versions", [])[:len(versions)] != versions:
                        raise ValueError("已保存的工资条版本必须保留。")
                store(con, rev, next_state)
                con.commit()
            self.respond(200, pack({"rev": rev+1}), "application/json")
        except (ValueError, KeyError, TypeError, AttributeError, UnicodeError):
            self.respond(400, "保存失败，请核对工资表和员工档案后重试。")
        except (TimeoutError, sqlite3.Error):
            self.respond(503, "本机数据库暂时不可用，请重试。")


if __name__ == "__main__":
    import sys
    parser = argparse.ArgumentParser()
    parser.add_argument("--bind", default="127.0.0.1", help="Address to listen on")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--origin", help="Browser-facing URL origin, including any non-default port")
    parser.add_argument("--sync", action="store_true")
    args = parser.parse_args()
    initialize()
    if args.sync:
        sync(json.load(sys.stdin))
    else:
        origin = args.origin or f"http://{args.bind}:{args.port}"
        parsed = urlsplit(origin)
        if (parsed.scheme not in ("http", "https") or not parsed.hostname or
                parsed.username is not None or origin != f"{parsed.scheme}://{parsed.netloc}"):
            parser.error("--origin must be an HTTP or HTTPS origin such as https://payroll.example.com")
        Handler.origin = origin
        Handler.public_host = parsed.netloc
        if parsed.scheme == "https":
            Handler.cookie_attributes += "; Secure"
        ThreadingHTTPServer((args.bind, args.port), Handler).serve_forever()
