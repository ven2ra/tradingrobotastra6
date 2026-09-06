"""Read-only monitor API; backend lifespan owns the paper tick loop."""
import asyncio
import os
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from decimal import Decimal as D
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from engine import Config, Engine, Grid, RiskPolicy, Tick
from tinvest import Observer

engine = Engine(RiskPolicy(), {'SBER': [Grid(Config('grid-sber', 'Grid', frozenset({'FLAT'})))]})

async def loop():
    n = 0
    while True:
        regime, price = [('FLAT', '98'), ('UPTREND', '101'), ('SHOCK', '95'), ('LOW_LIQUIDITY', '95')][n % 4]
        px = D(price)
        engine.tick(Tick('SBER', regime, px, px, px + D('.01'), datetime.now(timezone.utc), lot_size=10))
        n += 1
        await asyncio.sleep(2)

@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(loop())
    observer = Observer()
    app.state.observer = observer
    market_task = asyncio.create_task(observer.run())
    yield
    task.cancel()
    market_task.cancel()
    with suppress(asyncio.CancelledError): await task
    with suppress(asyncio.CancelledError): await market_task

app = FastAPI(title='MOEX Multi-strategy Paper Reference', lifespan=lifespan)

@app.get('/api/paper/snapshot')
async def snapshot():
    s = engine.state
    return {'mode': 'PAPER', 'equity_rub': str(s.equity), 'cash_rub': str(s.cash),
            'day_pnl_rub': str(s.equity - s.day_start), 'day_stopped': s.day_stopped,
            'daily_limit_rub': str(engine.risk.policy.daily_loss_rub),
            'positions': {k: {'lots': p.lots, 'strategy': p.config.id, 'entry': str(p.entry),
                'pnl_rub': str((engine.marks[k].unit(engine.marks[k].bid if p.lots > 0 else engine.marks[k].ask) - p.entry_dirty) * p.lots * engine.marks[k].lot_size)} for k, p in s.positions.items()},
            'marks': {k: {'price': str(t.price), 'kind': t.kind, 'regime': t.regime, 'lot_size': t.lot_size,
                'nominal': str(t.nominal), 'nkd': str(t.nkd), 'time': t.time.isoformat()} for k, t in engine.marks.items()},
            'orders': [{'id': o.id, 'ticker': o.intent.ticker, 'type': o.order_type, 'lots': o.intent.lots,
                'price': str(o.intent.price), 'strategy': o.intent.config.id} for o in s.pending.values()]}

@app.get('/api/paper/journal')
async def journal(): return engine.state.journal[-500:]

@app.get('/api/t-invest/snapshot')
async def market_snapshot(): return app.state.observer.snapshot()

@app.get('/api/t-invest/journal')
async def market_journal(): return app.state.observer.journal

@app.post('/api/live/arm')
def live_disabled():
    raise HTTPException(409, 'Live adapter is not installed; paper reference cannot be armed')

_static_dir = os.path.join(os.path.dirname(__file__), 'static')
if os.path.isdir(_static_dir):
    app.mount('/', StaticFiles(directory=_static_dir, html=True), name='static')
