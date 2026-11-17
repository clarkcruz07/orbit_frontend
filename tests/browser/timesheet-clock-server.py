"""Test-only launcher for the Attendance & Timesheet real-backend E2E.

Starts the real FastAPI app (memory DB, demo auth: the environment is set by the Node harness) with the backend's injectable
clock `app.state.timesheet_now` wired to a small offset file, so a test can move "now" forward (for example +17 h to
exercise the 16-hour needs_correction rule) without sleeping. With no file, or an offset of 0, the real UTC clock is used.
Usage: python timesheet-clock-server.py <port> <clock-file>   (run with the backend folder as the working directory)
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.getcwd())

import uvicorn  # noqa: E402

from app.main import create_app  # noqa: E402

port = int(sys.argv[1])
clock_file = sys.argv[2]


def now() -> datetime:
    offset = 0.0
    try:
        with open(clock_file, encoding="utf-8") as fh:
            offset = float(json.load(fh).get("offset_seconds", 0))
    except (OSError, ValueError):
        pass
    return datetime.now(timezone.utc) + timedelta(seconds=offset)


app = create_app()
app.state.timesheet_now = now
uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
