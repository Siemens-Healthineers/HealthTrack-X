"""
Force process pending messages
"""
import asyncio
import nats
import json
import os

NATS_URL = os.environ.get("NATS_URL", "nats://localhost:4222")
STREAM_NAME = "JOBS"
SUBJECT = "jobs.pending"
CONSUMER_DURABLE = "htx-worker"

async def main():
    nc = await nats.connect(NATS_URL)
    js = nc.jetstream()
    
    # Get stream info first
    stream = await js.stream_info(STREAM_NAME)
    print(f"Total messages in stream: {stream.state.messages}")
    
    # Delete the old consumer and create a new one
    print("\nDeleting old consumer...")
    try:
        await js.delete_consumer(STREAM_NAME, CONSUMER_DURABLE)
        print("Old consumer deleted")
    except Exception as e:
        print(f"Could not delete consumer: {e}")
    
    # Create fresh consumer
    print("\nCreating fresh consumer...")
    sub = await js.pull_subscribe(
        SUBJECT,
        durable=f"{CONSUMER_DURABLE}-drain",
        stream=STREAM_NAME
    )
    
    # Try to fetch all messages
    print("\nFetching messages...")
    try:
        msgs = await sub.fetch(batch=10, timeout=5)
        print(f"Fetched {len(msgs)} messages:")
        for i, msg in enumerate(msgs, 1):
            data = json.loads(msg.data.decode())
            payload = data.get("payload", {})
            print(f"\nMessage {i}:")
            print(f"  Job ID: {data.get('job_id')}")
            print(f"  Product: {payload.get('productName') or payload.get('materialName')}")
            # ACK the message to clear it
            await msg.ack()
            print(f"  ✓ ACKed")
    except asyncio.TimeoutError:
        print("No messages available")
    except Exception as e:
        print(f"Error: {e}")
    
    await nc.close()
    print("\n\nDone!")

if __name__ == "__main__":
    asyncio.run(main())
