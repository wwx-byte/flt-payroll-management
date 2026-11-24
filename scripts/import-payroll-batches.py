"""Import historical payroll batches from JSON on standard input."""
from contextlib import closing
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from storage import db, initialize, pack, read_state, store, unique_items, validate_state


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


if __name__ == "__main__":
    batches = json.load(sys.stdin)
    initialize()
    sync(batches)
