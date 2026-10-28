"""Recreate NATS stream from scratch"""
import asyncio
import os

import nats

NATS_URL = os.environ.get("NATS_URL", "nats://localhost:4222")
STREAM_NAME = "JOBS"
SUBJECT = "jobs.pending"

async def main():
    nc = await nats.connect(NATS_URL)
    js = nc.jetstream()
    
    # Delete stream if exists
    try:
        await js.delete_stream(STREAM_NAME)
        print(f"Deleted old {STREAM_NAME} stream")
    except Exception as e:
        print(f"No existing stream to delete: {e}")
    
    # Recreate stream
    await js.add_stream(name=STREAM_NAME, subjects=[SUBJECT])
    print(f"Created fresh {STREAM_NAME} stream")
    
    # Check stream info
    stream = await js.stream_info(STREAM_NAME)
    print(f"\nStream Config:")
    print(f"  Name: {stream.config.name}")
    print(f"  Subjects: {stream.config.subjects}")
    print(f"  Retention: {stream.config.retention}")
    print(f"  Messages: {stream.state.messages}")
    
    await nc.close()

if __name__ == "__main__":
    asyncio.run(main())
