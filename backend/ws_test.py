import asyncio
import json
import sys
import websockets

async def main():
    uri = "ws://localhost:8000/api/v1/ws?tablet_token=DEV2-TAB2"
    async with websockets.connect(uri) as ws:
        print("CONNECTED", flush=True)
        try:
            while True:
                msg = await asyncio.wait_for(ws.recv(), timeout=30)
                print("RECV:", msg, flush=True)
        except asyncio.TimeoutError:
            print("TIMEOUT, no more messages", flush=True)

asyncio.run(main())
