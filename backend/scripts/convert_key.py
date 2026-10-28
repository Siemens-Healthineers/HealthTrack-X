"""
Helper script to convert GitHub App private key file to environment variable format.
Usage: python convert_key.py path/to/your-app.private-key.pem
"""
import sys

def convert_pem_to_env_format(pem_file_path):
    """Read a PEM file and convert it to the format needed for .env file"""
    try:
        with open(pem_file_path, 'r') as f:
            content = f.read()
        
        # Replace actual newlines with \n string
        env_format = content.replace('\n', '\\n')
        
        print("\n" + "="*60)
        print("Copy the following line to your .env file:")
        print("="*60 + "\n")
        print(f"GITHUB_APP_PRIVATE_KEY={env_format}")
        print("\n" + "="*60 + "\n")
        
    except FileNotFoundError:
        print(f"Error: File '{pem_file_path}' not found")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python convert_key.py path/to/your-app.private-key.pem")
        sys.exit(1)
    
    pem_file = sys.argv[1]
    convert_pem_to_env_format(pem_file)
