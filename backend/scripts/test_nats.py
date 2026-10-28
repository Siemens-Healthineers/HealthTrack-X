"""
Test NATS JetStream setup
Run this to verify NATS connection and queue functionality
"""

import asyncio
import sys
import uuid

import nats_client


async def test_nats():
    """Test NATS connection and basic operations"""
    
    print("Testing NATS JetStream Connection...")
    print("-" * 60)
    
    try:
        # Test connection
        print("1. Connecting to NATS...")
        await nats_client.connect()
        
        if nats_client.get_status()["status"] == "online":
            print("   ✓ Connected successfully!")
        else:
            print("   ✗ Connection failed")
            return False
        
        # Test stream exists
        print("\n2. Checking JetStream stream...")
        stream_info = await nats_client._js.stream_info(nats_client.STREAM_NAME)
        print(f"   ✓ Stream exists: {stream_info.config.name}")
        print(f"   - Subjects: {stream_info.config.subjects}")
        print(f"   - Messages: {stream_info.state.messages}")
        
        # Test publish
        print("\n3. Testing message publish...")
        test_data = {
            "test": True,
            "message": "NATS JetStream test message"
        }
        
        await nats_client.publish_job(f"test-{uuid.uuid4().hex[:8]}", test_data)
        print("   ✓ Message published successfully!")
        
        print("\n" + "=" * 60)
        print("✓ All tests passed!")
        print("=" * 60)
        print("\nYou can now:")
        print("1. Start the stack with Docker Compose or Kubernetes")
        print("2. Open the frontend service")
        print("3. Use the backend API against the running NATS service")
        
        return True
        
    except Exception as e:
        print(f"\n✗ Test failed: {e}")
        print("\nMake sure NATS is running:")
        print("  docker-compose up -d")
        return False
    
    finally:
        await nats_client.close()


if __name__ == "__main__":
    result = asyncio.run(test_nats())
    sys.exit(0 if result else 1)
