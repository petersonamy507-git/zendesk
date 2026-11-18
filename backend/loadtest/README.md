# Real-time chat load test

`chat_load.py` simulates thousands of website visitors plus a few agents against a running API:
each visitor starts a widget session, opens a chat and a widget WebSocket, then visitors send
chat messages (and their normal 30 s heartbeats) at a steady rate while the script measures how
long each message takes to reach the visitor's own socket and every agent socket.

**Never point it at your real database.** It creates thousands of visitors and chats. Use a copy:

```bash
mysql -uroot -h127.0.0.1 -e "CREATE DATABASE helpdesk_load CHARACTER SET utf8mb4; GRANT ALL ON helpdesk_load.* TO 'helpdesk'@'127.0.0.1';"
mysqldump -uroot -h127.0.0.1 --single-transaction helpdesk | mysql -uroot -h127.0.0.1 helpdesk_load
```

Start a separate API on that copy (several workers, Redis DB 1 so it doesn't share state with the
normal app). Run from `backend/`:

```bash
ulimit -n 60000
DATABASE_URL='mysql+pymysql://helpdesk:<password>@127.0.0.1:3306/helpdesk_load' REDIS_URL=redis://127.0.0.1:6379/1 \
  THREADPOOL_SIZE=8 .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8650 --workers 6 --no-access-log
```

Then run the test (same `DATABASE_URL`: the script mints agent logins directly in that database):

```bash
ulimit -n 60000
PYTHONPATH=. DATABASE_URL='mysql+pymysql://helpdesk:<password>@127.0.0.1:3306/helpdesk_load' \
  .venv/bin/python loadtest/chat_load.py --visitors 3000 --agents 20 --rate 100 --duration 30 --procs 8
```

Useful flags: `--rate` total messages/second, `--setup-conns` how fast visitors arrive,
`--no-heartbeats`, `--json-out results.jsonl` to keep results.

Reset the copy between runs (old visitors left behind get swept by the server and skew results):
drop and re-create `helpdesk_load` as above and `redis-cli -n 1 flushdb`.

Running the load generator on the same laptop as the server understates capacity: both compete
for the same CPU, and laptops throttle under sustained load (`pmset -g therm`). For real numbers,
run the generator from a second machine.
