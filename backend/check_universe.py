"""Read-only smoke check of the liquid universe; never prints credentials."""
import asyncio
import json
from tinvest import Observer

async def main():
    observer=Observer()
    if not observer.api:
        print('T_INVEST_TOKEN is not configured')
        return 1
    try:
        await observer.discover()
        result={'instruments':len(observer.ids or []),
                'stocks':sum(m['instrumentType']=='share' for m in observer.metadata.values()),
                'bonds':sum(m['instrumentType']=='bond' for m in observer.metadata.values()),
                'quotes':sum(bool(m.get('price')) for m in observer.marks.values()),
                'status':observer.status,'error':observer.error}
        print(json.dumps(result,ensure_ascii=True))
        return 0 if result['instruments'] else 1
    finally:
        await observer.api.client.aclose()

if __name__=='__main__':
    raise SystemExit(asyncio.run(main()))
