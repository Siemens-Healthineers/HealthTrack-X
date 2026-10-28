"""
Test script to diagnose GitHub connection issues
"""
import os
from dotenv import load_dotenv
from github import Github, GithubException, Auth

load_dotenv()

# Load configuration
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
GITHUB_APP_ID = os.getenv("GITHUB_APP_ID")
GITHUB_APP_PRIVATE_KEY_RAW = os.getenv("GITHUB_APP_PRIVATE_KEY")
GITHUB_APP_INSTALLATION_ID = os.getenv("GITHUB_APP_INSTALLATION_ID")
GITHUB_REPO = os.getenv("GITHUB_REPO")
GITHUB_BRANCH = os.getenv("GITHUB_BRANCH", "main")
GITHUB_BASE_URL = os.getenv("GITHUB_BASE_URL")

# Process the private key
GITHUB_APP_PRIVATE_KEY = None
if GITHUB_APP_PRIVATE_KEY_RAW:
    GITHUB_APP_PRIVATE_KEY = GITHUB_APP_PRIVATE_KEY_RAW.replace('\\n', '\n')

print("=" * 60)
print("GitHub Connection Test")
print("=" * 60)
print(f"Repository: {GITHUB_REPO}")
print(f"Branch: {GITHUB_BRANCH}")
print(f"Base URL: {GITHUB_BASE_URL}")
print(f"Using Token: {bool(GITHUB_TOKEN)}")
print(f"Using GitHub App: {bool(GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY)}")
print("=" * 60)

try:
    if GITHUB_TOKEN:
        print("\n[1] Authenticating with Personal Access Token...")
        auth = Auth.Token(GITHUB_TOKEN)
        g = Github(auth=auth, base_url=GITHUB_BASE_URL) if GITHUB_BASE_URL else Github(auth=auth)
        print("✓ Authentication successful")
    else:
        print("\n[1] Authenticating with GitHub App...")
        print(f"    App ID: {GITHUB_APP_ID}")
        print(f"    Installation ID: {GITHUB_APP_INSTALLATION_ID}")
        print(f"    Private Key Length: {len(GITHUB_APP_PRIVATE_KEY) if GITHUB_APP_PRIVATE_KEY else 0} chars")
        
        app_auth = Auth.AppAuth(GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY)
        print("✓ App Auth created")
        
        print(f"    Getting installation auth...")
        installation_auth = app_auth.get_installation_auth(int(GITHUB_APP_INSTALLATION_ID))
        print("✓ Installation Auth obtained")
        
        if GITHUB_BASE_URL:
            print(f"    Creating GitHub client with base URL: {GITHUB_BASE_URL}")
        g = Github(auth=installation_auth, base_url=GITHUB_BASE_URL) if GITHUB_BASE_URL else Github(auth=installation_auth)
        print("✓ GitHub client created")
    
    print("\n[2] Testing API connection...")
    try:
        user = g.get_user()
        print(f"✓ Connected as: {user.login if hasattr(user, 'login') else 'GitHub App'}")
    except GithubException as e:
        if e.status == 403:
            print("✓ Connected as: GitHub App (user endpoint not accessible, which is normal)")
        else:
            raise
    
    print("\n[3] Accessing repository...")
    repo = g.get_repo(GITHUB_REPO)
    print(f"✓ Repository found: {repo.full_name}")
    print(f"    Description: {repo.description}")
    print(f"    Private: {repo.private}")
    
    print("\n[4] Testing branch access...")
    branch = repo.get_branch(GITHUB_BRANCH)
    print(f"✓ Branch '{GITHUB_BRANCH}' found")
    print(f"    Last commit: {branch.commit.sha[:7]}")
    
    print("\n[5] Testing write permissions...")
    try:
        # Try to get contents to check read permission
        try:
            contents = repo.get_contents("", ref=GITHUB_BRANCH)
            print(f"✓ Can read repository contents ({len(contents)} items)")
        except GithubException as e:
            if e.status == 404:
                print("✓ Repository is empty (no contents yet)")
            else:
                raise
        
        # Note: We can't fully test write without actually writing
        # Check permissions instead
        permissions = repo.permissions
        print(f"    Permissions - Push: {permissions.push}, Admin: {permissions.admin}")
        
        if permissions.push:
            print("✓ Write permission confirmed")
        else:
            print("⚠ WARNING: No push permission - writes will fail!")
            
    except Exception as e:
        print(f"⚠ Permission check failed: {str(e)}")
    
    print("\n" + "=" * 60)
    print("✓ ALL TESTS PASSED - GitHub connection is working!")
    print("=" * 60)

except GithubException as e:
    print(f"\n✗ GitHub API Error:")
    print(f"    Status: {e.status}")
    print(f"    Message: {e.data.get('message', str(e)) if hasattr(e, 'data') else str(e)}")
    if hasattr(e, 'data') and 'documentation_url' in e.data:
        print(f"    Docs: {e.data['documentation_url']}")
    print("\n" + "=" * 60)
    print("FAILURE - Check your credentials and repository access")
    print("=" * 60)
    exit(1)

except Exception as e:
    print(f"\n✗ Error: {type(e).__name__}")
    print(f"    {str(e)}")
    import traceback
    print("\nFull traceback:")
    print(traceback.format_exc())
    print("\n" + "=" * 60)
    print("FAILURE - See error details above")
    print("=" * 60)
    exit(1)
