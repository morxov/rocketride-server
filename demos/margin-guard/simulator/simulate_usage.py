#!/usr/bin/env python3
"""Stand-in for a customer's backend: counts AI usage in Redis.

This is the code a real customer would run next to their AI calls. It talks
to Redis directly (not through RocketRide) and uses the same keys the AI
Margin Guard app reads through the tool_redis node.

    .venv/bin/python simulator/simulate_usage.py                 # steady traffic
    .venv/bin/python simulator/simulate_usage.py --burst hooli   # one customer spikes

Load the sample customers first with "Load demo data" on the app's Setup screen.
"""

import argparse
import datetime as dt
import random
import time

import redis

PREFIX = 'rr:margin-guard:'
UNIT_COST_MICROS = {'summarize': 12000, 'chat': 4000, 'search': 1500}
FALLBACK_COST_FACTOR = 0.15
COUNTER_TTL = 100 * 86400


def month() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime('%Y-%m')


def record_ai_call(r: redis.Redis, customer: str, feature: str, calls: int = 1) -> str:
    """The snippet from the app's Setup screen: check the switch, then count."""
    if r.exists(f'{PREFIX}switch:{customer}:{feature}'):
        return 'blocked'  # feature switched off for this customer: skip the AI call
    cheaper = r.get(f'{PREFIX}fallback:{customer}')  # use this model if set
    unit = int(UNIT_COST_MICROS[feature] * (FALLBACK_COST_FACTOR if cheaper else 1))
    usage = f'{PREFIX}usage:{customer}:{feature}:{month()}'
    count = f'{PREFIX}calls:{customer}:{feature}:{month()}'
    pipe = r.pipeline()
    pipe.incrby(usage, unit * calls)
    pipe.incrby(count, calls)
    pipe.expire(usage, COUNTER_TTL, nx=True)
    pipe.expire(count, COUNTER_TTL, nx=True)
    pipe.execute()
    return 'fallback' if cheaper else 'ok'


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--port', type=int, default=6379)
    ap.add_argument('--burst', metavar='CUSTOMER', help='customer id that spikes on the summarize feature')
    ap.add_argument('--burst-calls', type=int, default=40, help='extra summarize calls per tick for the burst customer')
    ap.add_argument('--tick', type=float, default=1.0, help='seconds between ticks')
    ap.add_argument('--seconds', type=float, default=0, help='stop after this long (0 = until Ctrl-C)')
    args = ap.parse_args()

    r = redis.Redis(host=args.host, port=args.port, decode_responses=True)
    customers = sorted(k[len(PREFIX) + len('budget:') :] for k in r.scan_iter(f'{PREFIX}budget:*'))
    if not customers:
        raise SystemExit('No customers found. Open the app, go to Setup and press "Load demo data" first.')
    if args.burst and args.burst not in customers:
        raise SystemExit(f'Unknown customer {args.burst!r}. Known: {", ".join(customers)}')

    print(f'Simulating AI traffic for {len(customers)} customers. Ctrl-C to stop.')
    started = time.time()
    try:
        while not args.seconds or time.time() - started < args.seconds:
            line = []
            for c in customers:
                for feature in UNIT_COST_MICROS:
                    calls = random.randint(0, 3)
                    if c == args.burst and feature == 'summarize':
                        calls += args.burst_calls
                    if not calls:
                        continue
                    outcome = record_ai_call(r, c, feature, calls)
                    if c == args.burst and feature == 'summarize':
                        line.append(f'{c}/summarize x{calls}: {outcome}')
            if line:
                print(time.strftime('%H:%M:%S'), '  '.join(line), flush=True)
            time.sleep(args.tick)
    except KeyboardInterrupt:
        pass
    print('Stopped.')


if __name__ == '__main__':
    main()
