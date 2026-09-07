"""T-Invest market data and observational decisions. No account/order calls
happen in this file; a fired signal only writes a local, unsent proposal
via live_orders.create_proposal (see live_orders.py for the actual
OrdersService boundary and the human-approval gate in front of it).
"""
import asyncio
import os
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from decimal import Decimal as D
from pathlib import Path

import httpx
from dotenv import load_dotenv
import live_orders
import settings_store
from broker import BASE, MarketDataError, _ssl_context, quotation, timestamp
from engine import Config, Grid, MeanReversion, Stop, Tick, Trend, MSK

ROOT = Path(__file__).resolve().parents[1]
ALLOWED_METHODS = {
    ('InstrumentsService', 'GetInstrumentBy'), ('InstrumentsService', 'BondBy'),
    ('InstrumentsService', 'Shares'), ('InstrumentsService', 'Bonds'),
    ('MarketDataService', 'GetLastPrices'), ('MarketDataService', 'GetOrderBook'),
    ('MarketDataService', 'GetCandles'), ('MarketDataService', 'GetTradingStatus'),
}

def indicators(candles):
    # Only completed, chronologically ordered candles; no current-bar lookahead.
    rows = sorted({c['time']: c for c in candles if c.get('isComplete')}.values(), key=lambda c: c['time'])
    if len(rows) < 60: return None
    closes = [quotation(c['close']) for c in rows]
    highs = [quotation(c['high']) for c in rows]
    lows = [quotation(c['low']) for c in rows]
    tr, plus, minus, gains, losses = [], [], [], [], []
    for i in range(1, len(rows)):
        tr.append(max(highs[i]-lows[i], abs(highs[i]-closes[i-1]), abs(lows[i]-closes[i-1])))
        up, down = highs[i]-highs[i-1], lows[i-1]-lows[i]
        plus.append(max(up, D(0)) if up > down else D(0))
        minus.append(max(down, D(0)) if down > up else D(0))
        gains.append(max(closes[i]-closes[i-1], D(0)))
        losses.append(max(closes[i-1]-closes[i], D(0)))
    def wilder(series):
        out = [sum(series[:14])/14]
        for v in series[14:]: out.append((out[-1]*13+v)/14)
        return out
    atr, pdm, mdm = wilder(tr), wilder(plus), wilder(minus)
    dx = [100*abs(p-m)/(p+m) if p+m else D(0) for p,m in zip(pdm,mdm)]
    gain, loss = wilder(gains)[-1], wilder(losses)[-1]
    rsi = 100-100/(1+gain/loss) if loss else D(100) if gain else D(50)
    return dict(mean=sum(closes[-50:])/50, previous_mean=sum(closes[-55:-5])/50,
                atr=atr[-1], adx=wilder(dx)[-1], rsi=rsi,
                high_n=max(highs[-20:]), low_n=min(lows[-20:]),
                previous_close=closes[-1], candle_time=rows[-1]['time'])

def classify(price, bid, ask, stats, age, book_age):
    if stats is None or age < 0 or age > 120 or book_age < 0 or book_age > 30:
        return 'UNDEFINED', 'Недостаточно завершённых свечей или котировка устарела'
    if bid is None or ask is None or bid <= 0 or ask < bid or (ask-bid)/bid*10000 > 100:
        return 'LOW_LIQUIDITY', 'Нет двухстороннего стакана или bid/ask превышает 100 bps'
    if stats['atr'] <= 0: return 'UNDEFINED', 'ATR не определён'
    if abs(price-stats['previous_close']) >= stats['atr']*3:
        return 'SHOCK', 'Движение от последней завершённой свечи ≥ 3 ATR'
    if stats['adx'] >= 25:
        if price > stats['mean'] > stats['previous_mean']:
            return 'UPTREND', 'Цена выше растущей SMA50, ADX ≥ 25'
        if price < stats['mean'] < stats['previous_mean']:
            return 'DOWNTREND', 'Цена ниже снижающейся SMA50, ADX ≥ 25'
    if stats['adx'] < 20: return 'FLAT', 'ADX < 20: диапазон'
    return 'UNDEFINED', 'Переходный режим: признаки тренда не согласованы'

def select_universe(shares, bonds, limit=300):
    """Broker liquidity flag, RUB, main MOEX boards; retain both asset classes."""
    def eligible(rows, kind, boards):
        found = {}
        for m in rows:
            if (m.get('currency') == 'rub' and m.get('apiTradeAvailableFlag') is True
                    and m.get('liquidityFlag') is True and m.get('classCode') in boards
                    and m.get('ticker') and m.get('uid')):
                found[f"{m['ticker']}_{m['classCode']}"] = {**m, 'instrumentType':kind}
        preferred = {'SBER','LKOH','YDEX','GAZP'}
        return sorted(found.items(), key=lambda item:(item[1]['ticker'] not in preferred,item[0]))
    stocks = eligible(shares, 'share', {'TQBR'})
    debt = eligible(bonds, 'bond', {'TQOB','TQCB'})
    # About 100 equities / 200 bonds at limit=300. Fill unused slots from either class.
    stock_count = min(len(stocks), max(limit // 3, limit - len(debt)))
    selected = stocks[:stock_count] + debt[:limit-stock_count]
    return dict(selected)

class TInvest:
    def __init__(self, token, transport=None, concurrency=3, min_interval=0.35):
        self.client = httpx.AsyncClient(headers={'Authorization': f'Bearer {token}'}, timeout=15,
                                       follow_redirects=False, transport=transport, verify=_ssl_context())
        self.semaphore = asyncio.Semaphore(max(1, concurrency))
        self.min_interval = min_interval
        self._rate_lock = asyncio.Lock()
        self._last_call = 0.0
        self._blocked_until = 0.0

    async def _throttle(self):
        # A shared min-interval gate keeps the sustained request rate under
        # T-Invest's per-method limit even though many instruments run
        # concurrently; the semaphore alone only bounds in-flight requests.
        async with self._rate_lock:
            now = asyncio.get_event_loop().time()
            wait = max(self._last_call + self.min_interval, self._blocked_until) - now
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_call = asyncio.get_event_loop().time()

    async def call(self, service, method, body):
        if (service, method) not in ALLOWED_METHODS:
            raise ValueError('Only allowlisted market-data methods are permitted')
        async with self.semaphore:
            await self._throttle()
            try:
                response = await self.client.post(f'{BASE}{service}/{method}', json=body)
            except httpx.RequestError:
                raise MarketDataError('Сетевая ошибка T-Invest; проверьте соединение') from None
        if not response.is_success:
            # Never expose response body, Authorization, request object or token.
            descriptions = {401:'Токен не принят',403:'Недостаточно прав токена',429:'Лимит запросов T-Invest'}
            if response.status_code in (429, 503):
                try: delay = min(60, max(1, float(response.headers.get('retry-after', '15'))))
                except ValueError: delay = 15
                self._blocked_until = asyncio.get_running_loop().time() + delay
            raise MarketDataError(f'{descriptions.get(response.status_code,"Ошибка T-Invest")} (HTTP {response.status_code})', response.status_code)
        try:
            data = response.json()
            if not isinstance(data, dict): raise ValueError('Object expected')
            return data
        except ValueError: raise MarketDataError('Некорректный JSON T-Invest') from None

class Observer:
    def __init__(self, token=None, instruments=None, transport=None):
        if token is None: load_dotenv(ROOT / '.env', override=False)
        # An admin-set token in settings_store (via the settings UI) always
        # wins over the .env default, without needing a server restart.
        token = token if token is not None else (settings_store.get('T_INVEST_TOKEN') or os.getenv('T_INVEST_TOKEN', ''))
        try: self.max_instruments = max(1, min(300, int(settings_store.get('T_INVEST_MAX_INSTRUMENTS') or os.getenv('T_INVEST_MAX_INSTRUMENTS', '300'))))
        except ValueError: self.max_instruments = 300
        try: concurrency = max(1, min(10, int(os.getenv('T_INVEST_CONCURRENCY', '3'))))
        except ValueError: concurrency = 3
        try: min_interval = max(0.05, float(os.getenv('T_INVEST_MIN_INTERVAL', '0.35')))
        except ValueError: min_interval = 0.35
        self.api = TInvest(token, transport, concurrency=concurrency, min_interval=min_interval) if token else None
        env_ids = [s.strip() for s in os.getenv('T_INVEST_INSTRUMENTS', '').split(',') if s.strip()]
        # None = universe not discovered yet; refresh() populates it from the
        # live, liquidity-flagged MOEX catalog on first run unless pinned below.
        self.ids = (instruments or env_ids)[:self.max_instruments] or None
        self.metadata, self.candle_cache = {}, {}
        self._instrument_slots = asyncio.Semaphore(concurrency)
        self._refresh_lock = asyncio.Lock()
        self.last_attempt = None
        self.marks, self.journal = {}, []
        self.status, self.error, self.updated = ('loading' if token else 'not_configured'), '', None
        try: self.interval = max(15, int(os.getenv('T_INVEST_POLL_SECONDS', '15')))
        except ValueError: self.interval = 15
        self.priority_ids = set()
        try: self.priority_interval = max(1, float(os.getenv('T_INVEST_PRIORITY_POLL_SECONDS', '2')))
        except ValueError: self.priority_interval = 2
        try: self.priority_signal_interval = max(3, float(os.getenv('T_INVEST_PRIORITY_SIGNAL_POLL_SECONDS', '8')))
        except ValueError: self.priority_signal_interval = 8

    async def discover(self):
        try:
            shares = (await self.api.call('InstrumentsService', 'Shares',
                {'instrumentStatus': 'INSTRUMENT_STATUS_BASE'})).get('instruments', [])
            bonds = (await self.api.call('InstrumentsService', 'Bonds',
                {'instrumentStatus': 'INSTRUMENT_STATUS_BASE'})).get('instruments', [])
        except MarketDataError as exc:
            self.ids, self.status, self.error = None, 'error', str(exc)
            return
        selected = select_universe(shares, bonds, self.max_instruments)
        self.ids = list(selected)
        self.metadata.update(selected)
        # Publish the entire catalog immediately; no need to wait for 300 analyses.
        for ident, m in selected.items():
            self.marks.setdefault(ident, dict(ticker=m['ticker'], name=m.get('name',m['ticker']),
                kind='stock' if m['instrumentType']=='share' else 'bond', price=None,
                lot_size=m.get('lot',1), regime='UNDEFINED', time=None, stale=True,
                pending_quote=True, reason='Ожидаем котировку и проверку стакана',
                nominal=str(quotation(m['nominal'])) if m.get('nominal') else None,
                nkd=str(quotation(m['aciValue'])) if m.get('aciValue') else None))
        if selected:
            self.status = 'partial'
            await self.warm_quotes()

    async def warm_quotes(self):
        """Batch initial quotes so the whole watchlist is useful during analysis warmup."""
        try:
            response = await self.api.call('MarketDataService','GetLastPrices',
                {'instrumentId':[self.metadata[i]['uid'] for i in self.ids], 'lastPriceType':'LAST_PRICE_EXCHANGE'})
            by_uid = {m['uid']:ident for ident,m in self.metadata.items()}
            for q in response.get('lastPrices',[]):
                if not isinstance(q,dict): continue
                ident = by_uid.get(q.get('instrumentUid'))
                if ident in self.marks:
                    try:
                        price = quotation(q['price'])
                        timestamp(q['time'])
                        if price > 0:
                            self.marks[ident].update(price=str(price), time=q['time'], pending_quote=False,
                                reason='Котировка получена; ожидаем анализ стакана и свечей')
                    except (ValueError,KeyError,TypeError,AttributeError):
                        continue  # A missing quote must not discard later valid rows.
            self.updated = datetime.now(timezone.utc).isoformat()
        except (MarketDataError, ValueError, KeyError, TypeError):
            # Per-instrument polling retries; catalog remains visible with no fake prices.
            self.error = 'Каталог загружен; котировки будут получены при повторном опросе'

    def build_tick(self, ticker):
        """A real engine.Tick for a bare ticker (e.g. 'SBER'), built from
        this instrument's current quote, order book and cached hourly-candle
        indicators — the same data instrument() uses before firing a live
        signal. Returns None rather than a fake tick whenever there isn't
        enough real, fresh data yet (no candle history, stale quote/book, no
        two-sided book, or a bond, which paper plugins don't price here):
        callers should simply skip ticking that instrument this cycle."""
        ident = next((i for i, m in self.metadata.items() if m.get('ticker') == ticker), None)
        if ident is None: return None
        stats = self.candle_cache.get(ident, (None, None))[1]
        if stats is None: return None
        mark = self.snapshot()['marks'].get(ident)
        if not mark or mark.get('stale') or mark.get('price') is None or mark.get('bid') is None or mark.get('ask') is None:
            return None
        meta = self.metadata[ident]
        if meta.get('instrumentType') == 'bond': return None
        try:
            return Tick(ticker, mark['regime'], D(mark['price']), D(mark['bid']), D(mark['ask']),
                        timestamp(mark['time']), lot_size=meta['lot'], mean=stats['mean'], atr=stats['atr'],
                        high_n=stats['high_n'], low_n=stats['low_n'], adx=stats['adx'], rsi=stats['rsi'],
                        price_step=quotation(meta['minPriceIncrement']), calendar_complete=False)
        except (KeyError, ValueError, TypeError, ArithmeticError):
            return None

    def set_priority(self, tickers):
        # Watched tickers (usually a handful) from a browser's Watchlist.
        # Not persisted or per-session — any poll can update it, and the
        # fast loop below always reflects whoever asked most recently.
        if not tickers or not self.ids: return
        wanted = {t.strip().upper() for t in tickers if t and t.strip()}
        self.priority_ids = {ident for ident in self.ids if ident.split('_')[0] in wanted}

    async def refresh_priority_prices(self):
        """Cheap, frequent freshness for watched tickers: one batched
        GetLastPrices call regardless of how many are watched, instead of
        the full instrument() pass (order book + trading status + candles)
        the slow catalog-wide refresh uses for regime classification. Never
        touches bid/ask/regime — only price and its timestamp."""
        ids = [i for i in self.priority_ids if i in self.metadata and i in self.marks]
        if not self.api or not ids: return
        try:
            response = await self.api.call('MarketDataService', 'GetLastPrices',
                {'instrumentId': [self.metadata[i]['uid'] for i in ids], 'lastPriceType': 'LAST_PRICE_EXCHANGE'})
            by_uid = {self.metadata[i]['uid']: i for i in ids}
            received_at = datetime.now(timezone.utc).isoformat()
            for q in response.get('lastPrices', []):
                if not isinstance(q, dict): continue
                ident = by_uid.get(q.get('instrumentUid'))
                if ident not in self.marks: continue
                try:
                    price = quotation(q['price'])
                    timestamp(q['time'])
                    if price > 0:
                        self.marks[ident] = {**self.marks[ident], 'price': str(price), 'time': q['time'],
                                              'received_at': received_at}
                except (ValueError, KeyError, TypeError, AttributeError):
                    continue  # A missing quote must not discard later valid rows.
        except MarketDataError:
            pass  # Best-effort; the slower full pass surfaces persistent errors.

    async def _priority_loop(self):
        while True:
            try:
                await self.refresh_priority_prices()
            except asyncio.CancelledError:
                raise
            except Exception:
                pass  # A malformed payload here must not kill the fast loop.
            await asyncio.sleep(self.priority_interval)

    async def refresh_priority_signals(self):
        """Full analysis (order book, trading status, candles, plugin
        signals — the same instrument() used by the slow catalog pass) for
        watched tickers only, so a strategy signal on a favorited instrument
        doesn't wait for its turn in a 300-instrument scan. Failures are
        handled exactly like the slow pass: mark UNDEFINED, log HOLD."""
        if not self.api or not self.priority_ids: return
        async def guarded(ident):
            try:
                await self.instrument(ident)
            except (MarketDataError, ValueError, KeyError, TypeError, ArithmeticError, IndexError) as exc:
                reason = str(exc) if isinstance(exc, MarketDataError) else 'Неполные или некорректные рыночные данные'
                if ident in self.marks:
                    self.marks[ident] = {**self.marks[ident], 'regime': 'UNDEFINED', 'reason': reason, 'stale': True}
                self.log(ident, 'UNDEFINED', 'RiskOff', 'HOLD', reason)
        await asyncio.gather(*(guarded(i) for i in list(self.priority_ids)))

    async def _priority_signal_loop(self):
        while True:
            try:
                await self.refresh_priority_signals()
            except asyncio.CancelledError:
                raise
            except Exception:
                pass  # A malformed payload here must not kill the fast loop.
            await asyncio.sleep(self.priority_signal_interval)

    def log(self, ticker, regime, strategy, action, reason, price=None, lots=0):
        self.journal.append(dict(time=datetime.now(timezone.utc).astimezone(MSK).isoformat(), ticker=ticker,
            regime=regime, strategy=strategy, action=action, reason=reason,
            price=str(price) if price is not None else None, lots=lots, status='ANALYSIS_ONLY', order_id=None))
        self.journal = self.journal[-500:]

    async def refresh(self):
        async with self._refresh_lock:
            await self._refresh()

    async def _refresh(self):
        if not self.api: return
        self.last_attempt = datetime.now(timezone.utc).isoformat()
        if self.ids is None:
            await self.discover()
        if not self.ids:
            if self.status != 'error':
                self.status, self.error = 'error', 'Список ликвидных инструментов недоступен'
                self.ids = None
            return
        failures = []
        async def guarded(ident):
            try:
                async with self._instrument_slots:
                    await self.instrument(ident)
                    self.updated = datetime.now(timezone.utc).isoformat()
                    if self.status == 'loading': self.status = 'partial'
            except (MarketDataError, ValueError, KeyError, TypeError, ArithmeticError, IndexError) as exc:
                reason = str(exc) if isinstance(exc, MarketDataError) else 'Неполные или некорректные рыночные данные'
                failures.append(reason)
                if ident in self.marks:
                    self.marks[ident] = {**self.marks[ident], 'regime':'UNDEFINED', 'reason':reason, 'stale':True}
                self.log(ident, 'UNDEFINED', 'RiskOff', 'HOLD', reason)
        await asyncio.gather(*(guarded(ident) for ident in self.ids))
        self.status = 'error' if len(failures)==len(self.ids) else 'partial' if failures else 'connected'
        self.error = '; '.join(dict.fromkeys(failures))

    async def _fetch_candles(self, uid, now):
        # T-Invest caps a single CANDLE_INTERVAL_HOUR request to a 7-day
        # window. A 7-CALENDAR-day window alone almost always contains only
        # 5 trading days once a weekend falls inside it — at MOEX's ~8.8h
        # main session that's roughly 40 completed hourly candles, always
        # short of the 60 indicators() requires. Fetch three consecutive
        # 7-day windows (21 calendar days, ~14-15 trading days) and merge,
        # so real history actually accumulates past that threshold instead
        # of permanently starving every instrument of a regime/signal.
        candles = []
        for chunk in range(3):
            end = now - timedelta(days=7 * chunk)
            start = end - timedelta(days=7)
            data = await self.api.call('MarketDataService', 'GetCandles', {
                'instrumentId': uid, 'from': start.isoformat(), 'to': end.isoformat(),
                'interval': 'CANDLE_INTERVAL_HOUR', 'candleSourceType': 'CANDLE_SOURCE_EXCHANGE'})
            candles.extend(data.get('candles', []))
        return candles

    async def instrument(self, ident):
        now = datetime.now(timezone.utc)
        if ident not in self.metadata:
            ticker, board = ident.rsplit('_', 1)
            request = {'idType':'INSTRUMENT_ID_TYPE_TICKER','id':ticker,'classCode':board}
            meta = (await self.api.call('InstrumentsService','GetInstrumentBy',request))['instrument']
            if meta.get('currency') != 'rub' or meta.get('instrumentType') not in {'share','bond'}:
                raise MarketDataError('Поддерживаются только акции и облигации в RUB')
            if meta.get('instrumentType') == 'bond':
                meta = (await self.api.call('InstrumentsService','BondBy',request))['instrument'] | {'instrumentType':'bond'}
            self.metadata[ident] = meta
        meta = self.metadata[ident]
        uid = meta['uid']
        last, book, status = await asyncio.gather(
            self.api.call('MarketDataService','GetLastPrices',{'instrumentId':[uid],'lastPriceType':'LAST_PRICE_EXCHANGE'}),
            self.api.call('MarketDataService','GetOrderBook',{'instrumentId':uid,'depth':1}),
            self.api.call('MarketDataService','GetTradingStatus',{'instrumentId':uid}))
        cached = self.candle_cache.get(ident)
        if not cached or (now-cached[0]).total_seconds() >= 300:
            self.candle_cache[ident] = (now, indicators(await self._fetch_candles(uid, now)))
        stats = self.candle_cache[ident][1]
        quote = last['lastPrices'][0]
        price = quotation(quote['price'])
        if price <= 0: raise ValueError('Nonpositive price')
        bid = quotation(book['bids'][0]['price']) if book.get('bids') else None
        ask = quotation(book['asks'][0]['price']) if book.get('asks') else None
        now = datetime.now(timezone.utc)  # Measure freshness AFTER network/throttle waits.
        age = (now-timestamp(quote['time'])).total_seconds()
        book_age = (now-timestamp(book['orderbookTs'])).total_seconds() if book.get('orderbookTs') else 9999
        regime, reason = classify(price, bid, ask, stats, age, book_age)
        session_open = status.get('tradingStatus') == 'SECURITY_TRADING_STATUS_NORMAL_TRADING'
        if not session_open: reason += '; основная торговая сессия закрыта или приостановлена'
        self.marks[ident] = dict(ticker=meta['ticker'], name=meta['name'], kind='bond' if meta['instrumentType']=='bond' else 'stock',
            price=str(price), bid=str(bid) if bid else None, ask=str(ask) if ask else None, lot_size=meta['lot'],
            nominal=str(quotation(meta['nominal'])) if meta.get('nominal') else '1000',
            nkd=str(quotation(meta['aciValue'])) if meta.get('aciValue') else None,
            regime=regime, time=quote['time'], book_time=book.get('orderbookTs'), received_at=now.isoformat(),
            reason=reason, stale=not (0 <= age <= 120 and 0 <= book_age <= 30),
            session_open=session_open, indicators={k:str(v) for k,v in (stats or {}).items()})
        if stats is None or regime in {'SHOCK','LOW_LIQUIDITY','UNDEFINED'} or not session_open or not status.get('limitOrderAvailableFlag'):
            self.log(meta['ticker'], regime, 'RiskOff', 'HOLD', reason+'; новые входы запрещены',price)
            return
        if meta['instrumentType']=='bond':
            self.log(meta['ticker'], regime, 'BondSpread', 'HOLD', 'Нет проверенных YTM, рейтинга, дюрации и календаря; облигационный вход запрещён',price)
            return
        tick = Tick(meta['ticker'],regime,price,bid,ask,timestamp(quote['time']),lot_size=meta['lot'],
            mean=stats['mean'],atr=stats['atr'],high_n=stats['high_n'],low_n=stats['low_n'],adx=stats['adx'],rsi=stats['rsi'],
            price_step=quotation(meta['minPriceIncrement']),calendar_complete=False)
        plugins = [Grid(Config('Grid','Grid',frozenset({'FLAT'}))),
                   Trend(Config('Trend','Trend',frozenset({'UPTREND','DOWNTREND'}))),
                   MeanReversion(Config('MeanReversion','MeanReversion',frozenset({'FLAT'}),stop=Stop('level',max(tick.price_step,stats['low_n']-stats['atr']))))]
        for plugin in plugins:
            signals = plugin.on_tick(tick)
            if signals:
                signal = signals[0]
                proposed = live_orders.create_proposal(meta['ticker'], uid, signal.side, signal.lots,
                    price, 'LIMIT', f'{plugin.config.id}: {signal.rule}')
                note = ('Предложение на подтверждение создано в Live.' if proposed
                        else 'Заявка не создана: режим наблюдения, портфель и календарь не подключены.')
                self.log(meta['ticker'],regime,plugin.config.id,'SIGNAL',
                    f'{reason}; кандидат {signal.side}: {signal.rule}. {note}',price,signal.lots)
            else:
                why = 'режим не разрешён стратегии' if regime not in plugin.config.regimes else 'правило входа не выполнено'
                self.log(meta['ticker'],regime,plugin.config.id,'HOLD',f'{reason}; {why}',price)

    def snapshot(self):
        now = datetime.now(timezone.utc)
        marks = {}
        for ident, mark in self.marks.items():
            if mark.get('time') is None:
                age, stale = None, True
            else:
                try:
                    age = (now-timestamp(mark['time'])).total_seconds()
                    book_age = (now-timestamp(mark['book_time'])).total_seconds() if mark.get('book_time') else 9999
                    stale = mark.get('stale', False) or not (0 <= age <= 120 and 0 <= book_age <= 30)
                except (ValueError, TypeError, KeyError, AttributeError): age, stale = None, True
            marks[ident] = {**mark, 'stale':stale, 'age_seconds':round(age,1) if age is not None else None}
            if stale:
                marks[ident].update(regime='UNDEFINED', reason=mark['reason'] if mark.get('pending_quote') else 'Котировка или стакан устарели; новые входы запрещены')
        return dict(mode='OBSERVE', provider='T-Invest', status=self.status, error=self.error, updated=self.updated,
                    last_attempt=self.last_attempt, configured=self.api is not None, marks=marks, positions={}, orders=[],
                    tracked_count=len(self.ids or []), stale_count=sum(m['stale'] for m in marks.values()),
                    equity_rub='0',cash_rub='0',day_pnl_rub='0',day_stopped=False,daily_limit_rub='5000')

    async def run(self):
        priority_task = asyncio.create_task(self._priority_loop())
        priority_signal_task = asyncio.create_task(self._priority_signal_loop())
        try:
            while True:
                try:
                    await self.refresh()
                except asyncio.CancelledError:
                    raise
                except Exception:
                    # Prevent a malformed provider payload from silently killing the worker.
                    self.status, self.error = 'error', 'Ошибка обработки T-Invest; повторное подключение запланировано'
                await asyncio.sleep(self.interval if self.status != 'error' else max(60,self.interval))
        finally:
            priority_task.cancel()
            priority_signal_task.cancel()
            with suppress(asyncio.CancelledError): await priority_task
            with suppress(asyncio.CancelledError): await priority_signal_task
            if self.api: await self.api.client.aclose()

if __name__ == '__main__':
    async def smoke():
        observer = Observer()
        try:
            await observer.refresh()
            print({'status':observer.status,'instruments':len(observer.marks),'decisions':len(observer.journal),'error':observer.error})
        finally:
            if observer.api: await observer.api.client.aclose()
    asyncio.run(smoke())
