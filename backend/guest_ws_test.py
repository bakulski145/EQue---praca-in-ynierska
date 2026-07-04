import asyncio
import sys
import websockets

ticket_code = sys.argv[1]

async def main():
    uri = f"ws://localhost:8000/api/v1/queue/ws/{ticket_code}"
    async with websockets.connect(uri) as ws:
        print("CONNECTED", flush=True)
        try:
            while True:
                msg = await asyncio.wait_for(ws.recv(), timeout=20)
                print("RECV:", msg, flush=True)
        except asyncio.TimeoutError:
            print("TIMEOUT, no more messages", flush=True)

asyncio.run(main())
