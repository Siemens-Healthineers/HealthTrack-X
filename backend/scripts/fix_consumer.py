"""Fix consumer issue - delete and recreate"""
import asyncio
import os

import nats

NATS_URL = os.environ.get("NATS_URL", "nats://localhost:4222")
STREAM_NAME = "JOBS"
CONSUMER_DURABLE = "htx-worker"

async def main():
    nc = await nats.connect(NATS_URL)
    js = nc.jetstream()
    
    # Delete consumer
    try:
        await js.delete_consumer(STREAM_NAME, CONSUMER_DURABLE)
        print(f"Deleted consumer {CONSUMER_DURABLE}")
    except Exception as e:
        print(f"Consumer delete: {e}")
    
    # Check stream
    stream = await js.stream_info(STREAM_NAME)
    print(f"\nStream status:")
    print(f"  Messages: {stream.state.messages}")
    print(f"  First seq: {stream.state.first_seq}")
    print(f"  Last seq: {stream.state.last_seq}")
    print(f"  Consumers: {stream.state.num_consumers}")
    
    print("\nConsumer deleted. Restart the backend pod to recreate the integrated worker subscription.")
    
    await nc.close()

if __name__ == "__main__":
    asyncio.run(main())
