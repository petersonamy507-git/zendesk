"""Real-time chat load test.

Simulates many website visitors and a handful of agents against a running backend:

1. setup    – each visitor starts a widget session and opens a chat (REST)
2. connect  – every visitor opens the widget WebSocket, every agent opens the agent WebSocket
3. traffic  – visitors send chat messages at a steady total rate (REST) while also sending the
              normal 30 s heartbeats; we time how long each message takes to reach
                * the visitor's own socket (chat.message on chat:<id>)
                * every agent socket (chat.activity on account:<id>)
4. report   – latency percentiles, delivery ratio, health-probe latency (event-loop stalls),
              server CPU / memory

Run it against a throwaway database (see loadtest/README.md), never the real one: it creates
thousands of visitors and chats.

    python loadtest/chat_load.py --base http://127.0.0.1:8650 --visitors 3000 --agents 20 --rate 200
"""

from __future__ import annotations

import argparse
import asyncio
import json
import multiprocessing as mp
import os
import random
import statistics
import subprocess
import time
import uuid

import httpx
import websockets

SUBDOMAIN = "demo-co"


def pct(xs: list[float], p: float) -> float:
    if not xs:
        return float("nan")
    xs = sorted(xs)
    k = min(len(xs) - 1, max(0, round(p / 100 * (len(xs) - 1))))
    return xs[k]


def summarize(name: str, xs_s: list[float]) -> str:
    xs = [x * 1000 for x in xs_s]
    if not xs:
        return f"{name:<28} (no samples)"
    return f"{name:<28} n={len(xs):>7}  p50={pct(xs, 50):8.1f}ms  p95={pct(xs, 95):8.1f}ms  p99={pct(xs, 99):8.1f}ms  max={max(xs):8.1f}ms"


# ----------------------------------------------------------------------------- worker process
async def run_worker(idx: int, args, visitor_ids: range, agent_tokens: list[str], start_at: float, out: mp.Queue) -> None:
    base = args.base.rstrip("/")
    ws_base = base.replace("http", "ws", 1)
    res: dict = {"setup": [], "setup_err": 0, "connect": [], "connect_err": 0, "send": [], "send_err": 0, "vis_lat": [], "agent_lat": [], "sent": 0, "agent_sockets": len(agent_tokens), "vis_recv": 0, "agent_recv": 0, "probe": [], "hb": [], "hb_err": 0, "disconnects": 0}
    limits = httpx.Limits(max_connections=args.http_conns, max_keepalive_connections=args.http_conns)
    async with httpx.AsyncClient(base_url=base, limits=limits, timeout=60) as http:
        # ---- 1. setup
        sem = asyncio.Semaphore(args.setup_conns)
        visitors: list[dict] = []

        async def setup_one(i: int) -> None:
            ip = f"10.{(i >> 16) & 255}.{(i >> 8) & 255}.{i & 255}"
            hdr = {"x-forwarded-for": ip, "origin": "http://localhost:5750"}
            async with sem:
                t0 = time.perf_counter()
                try:
                    r = await http.post(f"/api/v1/widget/{SUBDOMAIN}/session", json={"visitor_key": f"lt-{args.run_id}-{i}", "url": "http://localhost:5750/", "title": "Load test"}, headers=hdr)
                    r.raise_for_status()
                    tok = r.json()["visitor_token"]
                    r = await http.post("/api/v1/widget/chats", json={"name": f"Load {i}", "email": f"load{i}@example.com", "message": "hello"}, headers={**hdr, "x-visitor-token": tok})
                    r.raise_for_status()
                    res["setup"].append(time.perf_counter() - t0)
                    visitors.append({"i": i, "token": tok, "chat": r.json()["id"], "ip": ip})
                except Exception as e:  # noqa: BLE001
                    res["setup_err"] += 1
                    if res["setup_err"] <= 3:
                        print(f"[w{idx}] setup error: {e!r} {getattr(getattr(e, 'response', None), 'text', '')[:200]}")

        await asyncio.gather(*(setup_one(i) for i in visitor_ids))

        # wait until every worker finished setup so the phases line up
        await asyncio.to_thread(start_at.wait)

        # ---- 2. connect
        stop = asyncio.Event()
        csem = asyncio.Semaphore(args.connect_conc)

        async def visitor_socket(v: dict) -> None:
            async with csem:
                t0 = time.perf_counter()
                try:
                    ws = await websockets.connect(f"{ws_base}/api/v1/widget/ws?token={v['token']}", open_timeout=60, ping_interval=None, max_queue=None)
                except Exception as e:  # noqa: BLE001
                    res["connect_err"] += 1
                    if res["connect_err"] <= 3:
                        print(f"[w{idx}] visitor connect error: {e!r}")
                    return
                res["connect"].append(time.perf_counter() - t0)
            try:
                async for raw in ws:
                    evt = json.loads(raw)
                    if evt.get("type") == "chat.message":
                        res["vis_recv"] += 1
                        body = (evt.get("data") or {}).get("body") or ""
                        if body.startswith("lt "):
                            res["vis_lat"].append(time.time() - float(body.split()[1]))
                    if stop.is_set():
                        break
            except websockets.ConnectionClosed:
                if not stop.is_set():
                    res["disconnects"] += 1
            finally:
                await ws.close()

        async def agent_socket(tok: str) -> None:
            try:
                ws = await websockets.connect(f"{ws_base}/api/v1/ws?token={tok}", open_timeout=60, ping_interval=None, max_queue=None)
            except Exception as e:  # noqa: BLE001
                res["connect_err"] += 1
                print(f"[w{idx}] agent connect error: {e!r}")
                return
            try:
                async for raw in ws:
                    evt = json.loads(raw)
                    if evt.get("type") == "chat.activity":
                        res["agent_recv"] += 1
                        prev = (evt.get("data") or {}).get("preview") or ""
                        if prev.startswith("lt "):
                            res["agent_lat"].append(time.time() - float(prev.split()[1]))
            except websockets.ConnectionClosed:
                if not stop.is_set():
                    res["disconnects"] += 1
            finally:
                await ws.close()

        tasks = [asyncio.create_task(agent_socket(t)) for t in agent_tokens]
        tasks += [asyncio.create_task(visitor_socket(v)) for v in visitors]
        # let connections settle
        await asyncio.sleep(args.settle)

        # ---- 3. traffic
        async def send(v: dict) -> None:
            t0 = time.time()
            try:
                r = await http.post(f"/api/v1/widget/chats/{v['chat']}/messages", json={"body": f"lt {t0:.6f} {uuid.uuid4().hex[:6]}", "client_id": uuid.uuid4().hex}, headers={"x-visitor-token": v["token"], "x-forwarded-for": v["ip"]})
                r.raise_for_status()
                res["send"].append(time.time() - t0)
                res["sent"] += 1
            except Exception as e:  # noqa: BLE001
                res["send_err"] += 1
                if res["send_err"] <= 3:
                    print(f"[w{idx}] send error: {e!r} {getattr(getattr(e, 'response', None), 'text', '')[:200]}")

        async def heartbeat(v: dict) -> None:
            t0 = time.perf_counter()
            try:
                r = await http.post("/api/v1/widget/heartbeat", json={"url": "http://localhost:5750/", "title": "Load test"}, headers={"x-visitor-token": v["token"], "x-forwarded-for": v["ip"]})
                r.raise_for_status()
                res["hb"].append(time.perf_counter() - t0)
            except Exception:  # noqa: BLE001
                res["hb_err"] += 1

        async def probe() -> None:
            async with httpx.AsyncClient(base_url=base, timeout=60) as p:
                while not stop.is_set():
                    t0 = time.perf_counter()
                    try:
                        await p.get("/api/v1/health")
                        res["probe"].append(time.perf_counter() - t0)
                    except Exception:  # noqa: BLE001
                        pass
                    await asyncio.sleep(0.2)

        probe_task = asyncio.create_task(probe()) if idx == 0 else None
        inflight: set[asyncio.Task] = set()
        rate = args.rate / args.procs
        hb_rate = (len(visitors) / 30.0) if args.heartbeats else 0.0
        t_start = time.time()
        n_msg = n_hb = 0
        while (el := time.time() - t_start) < args.duration and visitors:
            while n_msg < el * rate:
                t = asyncio.create_task(send(visitors[n_msg % len(visitors)]))
                inflight.add(t)
                t.add_done_callback(inflight.discard)
                n_msg += 1
            while hb_rate and n_hb < el * hb_rate:
                t = asyncio.create_task(heartbeat(visitors[n_hb % len(visitors)]))
                inflight.add(t)
                t.add_done_callback(inflight.discard)
                n_hb += 1
            await asyncio.sleep(0.005)
        if inflight:
            await asyncio.wait(inflight, timeout=60)
        await asyncio.sleep(args.drain)
        stop.set()
        if probe_task:
            await probe_task
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    out.put(res)


def worker_main(idx, args, visitor_ids, agent_tokens, start_at, out):
    asyncio.run(run_worker(idx, args, visitor_ids, agent_tokens, start_at, out))


# ----------------------------------------------------------------------------- helpers
def mint_agent_tokens(n: int) -> list[str]:
    """Creates n agent login sessions directly in the (load-test) database and returns access tokens."""
    from datetime import timedelta

    from sqlalchemy import select

    from app.core.db import SessionLocal
    from app.core.security import create_access_token, new_opaque_token, sha256, utcnow
    from app.models import Account, User
    from app.models.identity import UserSession

    with SessionLocal() as db:
        acc = db.scalar(select(Account).where(Account.subdomain == SUBDOMAIN))
        user = db.scalar(select(User).where(User.account_id == acc.id, User.enabled.is_(True), User.deleted_at.is_(None)))
        toks = []
        for _ in range(n):
            s = UserSession(user_id=user.id, token_hash=sha256(new_opaque_token()), user_agent="loadtest", ip="127.0.0.1", expires_at=utcnow() + timedelta(days=1))
            db.add(s)
            db.flush()
            toks.append(create_access_token(user_id=user.id, account_id=acc.id, role="agent", session_id=s.id))
        db.commit()
        return toks


def server_stats(port: int) -> tuple[float, float]:
    """(total %CPU, total RSS MB) of every process listening on / forked from the server on `port`."""
    try:
        roots = subprocess.run(["pgrep", "-f", "--", f"--port {port}"], capture_output=True, text=True).stdout.split()
        pids = set(roots)
        for r in roots:
            pids |= set(subprocess.run(["pgrep", "-P", r], capture_output=True, text=True).stdout.split())
        if not pids:
            return 0.0, 0.0
        out = subprocess.run(["ps", "-o", "%cpu=,rss=", "-p", ",".join(pids)], capture_output=True, text=True).stdout
        cpu = rss = 0.0
        for line in out.splitlines():
            c, r = line.split()
            cpu += float(c)
            rss += float(r)
        return cpu, rss / 1024
    except Exception:  # noqa: BLE001
        return 0.0, 0.0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8650")
    ap.add_argument("--visitors", type=int, default=2000)
    ap.add_argument("--agents", type=int, default=20)
    ap.add_argument("--rate", type=float, default=100, help="total visitor messages per second")
    ap.add_argument("--duration", type=float, default=30)
    ap.add_argument("--procs", type=int, default=4, help="client processes")
    ap.add_argument("--http-conns", type=int, default=50, help="HTTP connections per client process")
    ap.add_argument("--setup-conns", type=int, default=8, help="concurrent visitor setups per client process (ramp speed)")
    ap.add_argument("--connect-conc", type=int, default=200, help="concurrent WebSocket handshakes per client process")
    ap.add_argument("--settle", type=float, default=3)
    ap.add_argument("--drain", type=float, default=5)
    ap.add_argument("--no-heartbeats", dest="heartbeats", action="store_false")
    ap.add_argument("--label", default="")
    ap.add_argument("--json-out", default="")
    args = ap.parse_args()
    args.run_id = uuid.uuid4().hex[:8]
    port = int(args.base.rsplit(":", 1)[1].split("/")[0])

    agent_tokens = mint_agent_tokens(args.agents)
    per = -(-args.visitors // args.procs)
    out: mp.Queue = mp.Queue()
    t_setup = time.time()
    start_at = mp.Barrier(args.procs + 1)  # workers + this process (which samples server stats)
    procs = []
    for i in range(args.procs):
        vids = range(i * per, min(args.visitors, (i + 1) * per))
        toks = agent_tokens[i :: args.procs]  # spread agent sockets so no single client process is the bottleneck
        p = mp.Process(target=worker_main, args=(i, args, vids, toks, start_at, out))
        p.start()
        procs.append(p)

    start_at.wait()
    setup_wall = time.time() - t_setup
    cpu_samples: list[float] = []
    rss_samples: list[float] = []
    results = []
    t_end = time.time() + args.settle + args.duration
    while len(results) < args.procs:
        try:
            results.append(out.get(timeout=1))
        except Exception:  # noqa: BLE001
            if time.time() <= t_end:
                c, r = server_stats(port)
                cpu_samples.append(c)
                rss_samples.append(r)
    for p in procs:
        p.join()

    agg: dict = {}
    for r in results:
        for k, v in r.items():
            agg[k] = agg.get(k, [] if isinstance(v, list) else 0) + v

    expected_agent = agg["sent"] * args.agents
    lines = [
        f"=== {args.label or 'run'}: {args.visitors} visitors, {args.agents} agents, {args.rate:g} msg/s for {args.duration:g}s, heartbeats={'on' if args.heartbeats else 'off'}",
        summarize("setup (session+chat)", agg["setup"]) + f"  errors={agg['setup_err']}  wall={setup_wall:.0f}s ({len(agg['setup']) / max(setup_wall, 1e-9):.0f} visitors/s)",
        summarize("socket connect", agg["connect"]) + f"  errors={agg['connect_err']}",
        summarize("send message (REST)", agg["send"]) + f"  errors={agg['send_err']}",
        summarize("heartbeat (REST)", agg["hb"]) + f"  errors={agg['hb_err']}",
        summarize("delivery -> visitor", agg["vis_lat"]),
        summarize("delivery -> agents", agg["agent_lat"]),
        summarize("health probe", agg["probe"]),
        f"{'messages sent':<28} {agg['sent']}  achieved rate={agg['sent'] / args.duration:.1f}/s",
        f"{'visitor delivery':<28} {agg['vis_recv']}/{agg['sent']} ({100 * agg['vis_recv'] / max(1, agg['sent']):.1f}%)",
        f"{'agent delivery':<28} {agg['agent_recv']}/{expected_agent} ({100 * agg['agent_recv'] / max(1, expected_agent):.1f}%)",
        f"{'unexpected disconnects':<28} {agg['disconnects']}",
        f"{'server CPU / RSS':<28} avg {statistics.fmean(cpu_samples) if cpu_samples else 0:.0f}% / peak {max(rss_samples) if rss_samples else 0:.0f} MB",
    ]
    print("\n".join(lines))
    if args.json_out:
        summary = {k: ({"n": len(v), "p50": pct(v, 50), "p95": pct(v, 95), "p99": pct(v, 99), "max": max(v) if v else None} if isinstance(v, list) else v) for k, v in agg.items()}
        summary.update(setup_wall=setup_wall, label=args.label, visitors=args.visitors, agents=args.agents, rate=args.rate, duration=args.duration, cpu_avg=statistics.fmean(cpu_samples) if cpu_samples else 0, rss_peak=max(rss_samples) if rss_samples else 0)
        with open(args.json_out, "a") as f:
            f.write(json.dumps(summary) + "\n")


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    main()
