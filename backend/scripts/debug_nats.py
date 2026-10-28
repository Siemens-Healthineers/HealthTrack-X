"""
Debug script to check NATS stream and consumer status
"""
import asyncio
import nats
import os

NATS_URL = os.environ.get("NATS_URL", "nats://localhost:4222")
STREAM_NAME = "JOBS"
SUBJECT = "jobs.pending"
CONSUMER_DURABLE = "htx-worker"

async def main():
    # Connect to NATS
    nc = await nats.connect(NATS_URL)
    js = nc.jetstream()
    
    # Get stream info
    print("=== Stream Info ===")
    stream_info = await js.stream_info(STREAM_NAME)
    print(f"Name: {stream_info.config.name}")
    print(f"Subjects: {stream_info.config.subjects}")
    print(f"Messages: {stream_info.state.messages}")
    print(f"Bytes: {stream_info.state.bytes}")
    print(f"First Seq: {stream_info.state.first_seq}")
    print(f"Last Seq: {stream_info.state.last_seq}")
    
    # List consumers
    print("\n=== Consumers ===")
    consumers = await js.consumers_info(STREAM_NAME)
    for consumer in consumers:
        print(f"\nConsumer: {consumer.name}")
        print(f"  Delivered: {consumer.delivered.consumer_seq}")
        print(f"  Ack Pending: {consumer.num_ack_pending}")
        print(f"  Redelivered: {consumer.num_redelivered}")
        print(f"  Waiting: {consumer.num_waiting}")
    
    # Try to fetch a message
    print("\n=== Testing Message Fetch ===")
    try:
        sub = await js.pull_subscribe(SUBJECT, durable=CONSUMER_DURABLE, stream=STREAM_NAME)
        msgs = await sub.fetch(batch=1, timeout=2)
        print(f"Fetched {len(msgs)} messages")
        for msg in msgs:
            print(f"  Subject: {msg.subject}")
            print(f"  Data: {msg.data[:100]}...")  # First 100 bytes
    except Exception as e:
        print(f"Error fetching: {e}")
    
    await nc.close()

if __name__ == "__main__":
    asyncio.run(main())
