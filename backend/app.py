"""Read-only monitor API; backend lifespan owns the paper tick loop."""
import asyncio
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from decimal import Decimal as D
from fastapi import FastAPI, HTTPException
from engine import Config, Engine, Grid, RiskPolicy, Tick

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
    yield
    task.cancel()
    with suppress(asyncio.CancelledError): await task

app = FastAPI(title='MOEX Multi-strategy Paper Reference', lifespan=lifespan)

@app.get('/api/paper/snapshot')
def snapshot():
    s = engine.state
    return {'mode': 'PAPER', 'equity_rub': str(s.equity), 'cash_rub': str(s.cash),
            'day_pnl_rub': str(s.equity - s.day_start), 'day_stopped': s.day_stopped,
            'positions': {k: {'lots': p.lots, 'strategy': p.config.id, 'entry': str(p.entry)} for k, p in s.positions.items()},
            'orders': [{'id': o.id, 'ticker': o.intent.ticker, 'type': o.order_type} for o in s.pending.values()]}

@app.get('/api/paper/journal')
def journal(): return engine.state.journal[-500:]

@app.post('/api/live/arm')
def live_disabled():
    raise HTTPException(409, 'Live adapter is not installed; paper reference cannot be armed')
