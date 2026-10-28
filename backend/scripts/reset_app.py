#!/usr/bin/env python
"""Script to reset the application after deleting all files in the repo"""
import os

import requests

BASE_URL = os.environ.get("HTX_BACKEND_URL", "http://htx.local").rstrip("/")

print("Resetting application state...")
print(f"Backend: {BASE_URL}")
print("="*60)

# 1. Invalidate cache
print("\n1. Invalidating cache...")
try:
    response = requests.post(f"{BASE_URL}/api/invalidate-cache")
    if response.status_code == 200:
        print("   ✓ Cache invalidated successfully")
    else:
        print(f"   ✗ Failed to invalidate cache: {response.status_code}")
        print(f"   Response: {response.text}")
except Exception as e:
    print(f"   ✗ Error: {e}")

# 2. Rebuild aggregated file (will create empty structure)
print("\n2. Rebuilding aggregated file...")
try:
    response = requests.get(f"{BASE_URL}/api/rebuild-aggregated")
    if response.status_code == 200:
        data = response.json()
        print(f"   ✓ Aggregated file rebuilt")
        print(f"   Products count: {data.get('productsCount', 0)}")
    else:
        print(f"   ✗ Failed to rebuild: {response.status_code}")
        print(f"   Response: {response.text}")
except Exception as e:
    print(f"   ✗ Error: {e}")

# 3. Test list products endpoint
print("\n3. Testing list products endpoint...")
try:
    response = requests.get(f"{BASE_URL}/api/list-products")
    if response.status_code == 200:
        data = response.json()
        print(f"   ✓ List products working")
        print(f"   Products: {len(data.get('data', []))}")
    else:
        print(f"   ✗ Failed to list products: {response.status_code}")
        print(f"   Response: {response.text}")
except Exception as e:
    print(f"   ✗ Error: {e}")

print("\n" + "="*60)
print("Reset complete! You can now add new products.")
