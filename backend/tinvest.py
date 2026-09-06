"""T-Invest market data and observational decisions. No account/order methods."""
import asyncio
import os
import ssl
from datetime import datetime, timedelta, timezone
from decimal import Decimal as D
from pathlib import Path

import certifi
import httpx
from dotenv import load_dotenv
from engine import Config, Grid, MeanReversion, Stop, Tick, Trend, MSK

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://invest-public-api.tbank.ru/rest/tinkoff.public.invest.api.contract.v1.'
RUSSIAN_ROOT_CA = Path(__file__).resolve().parent / 'certs' / 'russian_trusted_root_ca.pem'

def _ssl_context():
    # invest-public-api.tbank.ru serves a chain rooted at the Russian Trusted
    # Sub CA (Минцифры), which is absent from certifi's public trust store.
    ctx = ssl.create_default_context(cafile=certifi.where())
    if RUSSIAN_ROOT_CA.is_file():
        ctx.load_verify_locations(cafile=str(RUSSIAN_ROOT_CA))
    return ctx
ALLOWED_METHODS = {
    ('InstrumentsService', 'GetInstrumentBy'), ('InstrumentsService', 'BondBy'),
    ('MarketDataService', 'GetLastPrices'), ('MarketDataService', 'GetOrderBook'),
    ('MarketDataService', 'GetCandles'), ('MarketDataService', 'GetTradingStatus'),
}

def quotation(value):
    if not isinstance(value, dict) or 'units' not in value and 'nano' not in value:
        raise ValueError('Missing quotation')
    result = D(str(value.get('units', 0))) + D(str(value.get('nano', 0))) / D('1000000000')
    if not result.is_finite(): raise ValueError('Nonfinite quotation')
    return result

def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))

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

class MarketDataError(Exception): pass

class TInvest:
    def __init__(self, token, transport=None):
        self.client = httpx.AsyncClient(headers={'Authorization': f'Bearer {token}'}, timeout=15,
                                       follow_redirects=False, transport=transport, verify=_ssl_context())

    async def call(self, service, method, body):
        if (service, method) not in ALLOWED_METHODS:
            raise ValueError('Only allowlisted market-data methods are permitted')
        try:
            response = await self.client.post(f'{BASE}{service}/{method}', json=body)
        except httpx.RequestError:
            raise MarketDataError('Сетевая ошибка T-Invest; проверьте соединение') from None
        if not response.is_success:
            # Never expose response body, Authorization, request object or token.
            descriptions = {401:'Токен не принят',403:'Недостаточно прав токена',429:'Лимит запросов T-Invest'}
            raise MarketDataError(f'{descriptions.get(response.status_code,"Ошибка T-Invest")} (HTTP {response.status_code})')
        try: return response.json()
        except ValueError: raise MarketDataError('Некорректный JSON T-Invest') from None

class Observer:
    def __init__(self, token=None, instruments=None, transport=None):
        load_dotenv(ROOT / '.env', override=False)
        token = token if token is not None else os.getenv('T_INVEST_TOKEN', '')
        self.api = TInvest(token, transport) if token else None
        self.ids = instruments or [s.strip() for s in os.getenv('T_INVEST_INSTRUMENTS', 'SBER_TQBR,LKOH_TQBR,YDEX_TQBR,GAZP_TQBR').split(',') if s.strip()][:20]
        self.metadata, self.candle_cache = {}, {}
        self.marks, self.journal = {}, []
        self.status, self.error, self.updated = ('loading' if token else 'not_configured'), '', None
        try: self.interval = max(15, int(os.getenv('T_INVEST_POLL_SECONDS', '15')))
        except ValueError: self.interval = 15

    def log(self, ticker, regime, strategy, action, reason, price=None, lots=0):
        self.journal.append(dict(time=datetime.now(timezone.utc).astimezone(MSK).isoformat(), ticker=ticker,
            regime=regime, strategy=strategy, action=action, reason=reason,
            price=str(price) if price is not None else None, lots=lots, status='ANALYSIS_ONLY', order_id=None))
        self.journal = self.journal[-500:]

    async def refresh(self):
        if not self.api: return
        failures = []
        for ident in self.ids:
            try: await self.instrument(ident)
            except (MarketDataError, ValueError, KeyError, TypeError, ArithmeticError) as exc:
                reason = str(exc) if isinstance(exc, MarketDataError) else 'Неполные или некорректные рыночные данные'
                failures.append(reason)
                if ident in self.marks:
                    self.marks[ident] = {**self.marks[ident], 'regime':'UNDEFINED', 'reason':reason, 'stale':True}
                self.log(ident, 'UNDEFINED', 'RiskOff', 'HOLD', reason)
        self.status = 'error' if len(failures)==len(self.ids) else 'partial' if failures else 'connected'
        self.error = '; '.join(dict.fromkeys(failures))
        self.updated = datetime.now(timezone.utc).isoformat()

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
            # 1h candles: several sessions of history within a single supported interval.
            data = await self.api.call('MarketDataService','GetCandles',{'instrumentId':uid,
                'from':(now-timedelta(days=7)).isoformat(), 'to':now.isoformat(),
                'interval':'CANDLE_INTERVAL_HOUR','candleSourceType':'CANDLE_SOURCE_EXCHANGE'})
            self.candle_cache[ident] = (now, indicators(data.get('candles', [])))
        stats = self.candle_cache[ident][1]
        quote = last['lastPrices'][0]
        price = quotation(quote['price'])
        if price <= 0: raise ValueError('Nonpositive price')
        bid = quotation(book['bids'][0]['price']) if book.get('bids') else None
        ask = quotation(book['asks'][0]['price']) if book.get('asks') else None
        age = (now-timestamp(quote['time'])).total_seconds()
        book_age = (now-timestamp(book['orderbookTs'])).total_seconds() if book.get('orderbookTs') else 9999
        regime, reason = classify(price, bid, ask, stats, age, book_age)
        session_open = status.get('tradingStatus') == 'SECURITY_TRADING_STATUS_NORMAL_TRADING'
        if not session_open: reason += '; основная торговая сессия закрыта или приостановлена'
        self.marks[ident] = dict(ticker=meta['ticker'], name=meta['name'], kind='bond' if meta['instrumentType']=='bond' else 'stock',
            price=str(price), bid=str(bid) if bid else None, ask=str(ask) if ask else None, lot_size=meta['lot'],
            nominal=str(quotation(meta['nominal'])) if meta.get('nominal') else '1000',
            nkd=str(quotation(meta['aciValue'])) if meta.get('aciValue') else None,
            regime=regime, time=quote['time'], reason=reason, stale=age>120 or book_age>30,
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
                self.log(meta['ticker'],regime,plugin.config.id,'SIGNAL',
                    f'{reason}; кандидат {signal.side}: {signal.rule}. Заявка не создана: режим наблюдения, портфель и календарь не подключены.',price,signal.lots)
            else:
                why = 'режим не разрешён стратегии' if regime not in plugin.config.regimes else 'правило входа не выполнено'
                self.log(meta['ticker'],regime,plugin.config.id,'HOLD',f'{reason}; {why}',price)

    def snapshot(self):
        return dict(mode='OBSERVE', provider='T-Invest', status=self.status, error=self.error, updated=self.updated,
                    configured=self.api is not None, marks=self.marks, positions={}, orders=[],
                    equity_rub='0',cash_rub='0',day_pnl_rub='0',day_stopped=False,daily_limit_rub='5000')

    async def run(self):
        try:
            while True:
                await self.refresh()
                await asyncio.sleep(self.interval if self.status != 'error' else max(60,self.interval))
        finally:
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
