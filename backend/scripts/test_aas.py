"""
Quick test for AAS implementation

Trademark notice: "Asset Administration Shell" (AAS) and the AAS logo are
trademarks of the Industrial Digital Twin Association (IDTA), referenced here
for identification and interoperability purposes only.
"""
import sys
sys.path.insert(0, '.')

from main import create_product_aas, aas_to_json, BASYX_AVAILABLE

def test_aas_creation():
    print(f"BaSyx Available: {BASYX_AVAILABLE}")
    
    if not BASYX_AVAILABLE:
        print("❌ BaSyx SDK not available")
        return
    
    # Test data
    test_product = {
        'productId': 'PROD-20260129-TEST001',
        'productName': 'Test Battery Pack',
        'manufacturer': 'HTX Manufacturing GmbH',
        'materialName': 'Lithium-Ion Battery',
        'recycledContent': '35%',
        'co2Equivalent': '150 kg CO2'
    }
    
    print("\n📦 Testing AAS creation...")
    print(f"Product: {test_product['productName']}")
    
    # Create AAS
    result = create_product_aas(test_product)
    
    if result:
        aas, submodels = result
        print(f"✓ AAS created: {aas.id_short}")
        print(f"✓ Submodels: {len(submodels)}")
        
        for sm in submodels:
            print(f"  - {sm.id_short} ({len(sm.submodel_element)} properties)")
        
        # Convert to JSON
        json_str = aas_to_json(aas, submodels)
        if json_str:
            print(f"\n✓ JSON generated: {len(json_str)} bytes")
            
            # Show preview
            import json
            data = json.loads(json_str)
            print("\n📄 JSON Structure Preview:")
            print(f"  - assetAdministrationShells: {len(data.get('assetAdministrationShells', []))}")
            print(f"  - submodels: {len(data.get('submodels', []))}")
            print(f"  - assets: {len(data.get('assets', []))}")
            
            print("\n✅ AAS implementation test PASSED!")
            return True
        else:
            print("❌ JSON generation failed")
    else:
        print("❌ AAS creation failed")
    
    return False

if __name__ == "__main__":
    success = test_aas_creation()
    sys.exit(0 if success else 1)
