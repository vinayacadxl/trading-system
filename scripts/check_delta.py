#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Delta Exchange API Connection Checker
Comprehensive diagnostic tool for testing Delta Exchange API connectivity
"""

import sys
import io

# Force UTF-8 encoding for Windows
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

import requests
import hashlib
import hmac
import time
import os
import json
from typing import Dict, Tuple, Optional
from dotenv import load_dotenv
from datetime import datetime

# Try to use colorama for Windows compatibility
try:
    from colorama import init, Fore, Style
    init(autoreset=True)
    USE_COLORS = True
except ImportError:
    USE_COLORS = False
    # Fallback: no colors
    class Fore:
        RED = GREEN = YELLOW = CYAN = MAGENTA = BLUE = RESET = ''
    class Style:
        BRIGHT = RESET_ALL = ''

# Color wrapper class
class Colors:
    HEADER = Fore.MAGENTA + Style.BRIGHT if USE_COLORS else ''
    OKBLUE = Fore.BLUE if USE_COLORS else ''
    OKCYAN = Fore.CYAN if USE_COLORS else ''
    OKGREEN = Fore.GREEN if USE_COLORS else ''
    WARNING = Fore.YELLOW if USE_COLORS else ''
    FAIL = Fore.RED if USE_COLORS else ''
    ENDC = Style.RESET_ALL if USE_COLORS else ''
    BOLD = Style.BRIGHT if USE_COLORS else ''
    UNDERLINE = ''

def print_header(text: str):
    """Print formatted header"""
    print(f"\n{Colors.HEADER}{Colors.BOLD}{'='*60}{Colors.ENDC}")
    print(f"{Colors.HEADER}{Colors.BOLD}{text.center(60)}{Colors.ENDC}")
    print(f"{Colors.HEADER}{Colors.BOLD}{'='*60}{Colors.ENDC}\n")

def print_success(text: str):
    """Print success message"""
    print(f"{Colors.OKGREEN}[+] {text}{Colors.ENDC}")

def print_error(text: str):
    """Print error message"""
    print(f"{Colors.FAIL}[X] {text}{Colors.ENDC}")

def print_warning(text: str):
    """Print warning message"""
    print(f"{Colors.WARNING}[!] {text}{Colors.ENDC}")

def print_info(text: str):
    """Print info message"""
    print(f"{Colors.OKCYAN}[i] {text}{Colors.ENDC}")

def generate_signature(api_secret: str, method: str, timestamp: str, path: str, 
                       query_string: str = "", payload: str = "") -> str:
    """Generate HMAC SHA256 signature for Delta Exchange API"""
    signature_payload = method + timestamp + path + query_string + payload
    signature = hmac.new(
        api_secret.encode('utf-8'),
        signature_payload.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    return signature

def make_api_request(base_url: str, api_key: str, api_secret: str, 
                     path: str, method: str = "GET") -> Tuple[bool, int, str, float]:
    """
    Make authenticated API request to Delta Exchange
    Returns: (success, status_code, response_text, response_time)
    """
    timestamp = str(int(time.time()))
    signature = generate_signature(api_secret, method, timestamp, path)
    
    headers = {
        "api-key": api_key,
        "signature": signature,
        "timestamp": timestamp,
        "Content-Type": "application/json"
    }
    
    url = base_url + path
    
    try:
        start_time = time.time()
        response = requests.get(url, headers=headers, timeout=10)
        response_time = time.time() - start_time
        
        success = response.status_code == 200
        return success, response.status_code, response.text, response_time
    except requests.exceptions.Timeout:
        return False, 0, "Request timeout", 0
    except requests.exceptions.ConnectionError:
        return False, 0, "Connection error", 0
    except Exception as e:
        return False, 0, str(e), 0

def diagnose_error(status_code: int, response_text: str):
    """Provide detailed error diagnosis and troubleshooting steps"""
    print_error(f"Request failed with status code: {status_code}")
    print_info(f"Response: {response_text[:200]}...")
    
    print(f"\n{Colors.WARNING}Diagnosis:{Colors.ENDC}")
    
    if status_code == 401 or "Unauthorized" in response_text:
        print("  • Authentication failed")
        print("  • Possible causes:")
        print("    1. Invalid API key or secret")
        print("    2. Incorrect signature generation")
        print("    3. Timestamp out of sync")
        print(f"\n{Colors.OKCYAN}Solutions:{Colors.ENDC}")
        print("  1. Verify API credentials in .env file")
        print("  2. Regenerate API keys from Delta Exchange dashboard")
        print("  3. Check system time is synchronized")
        
    elif status_code == 403 or "ip_not_whitelisted" in response_text:
        print("  • IP address not whitelisted")
        print(f"\n{Colors.OKCYAN}Solutions:{Colors.ENDC}")
        print("  1. Add your IP to whitelist in Delta Exchange settings")
        print("  2. Or disable IP whitelisting for this API key")
        
    elif status_code == 404:
        print("  • Endpoint not found")
        print(f"\n{Colors.OKCYAN}Solutions:{Colors.ENDC}")
        print("  1. Verify the base URL is correct")
        print("  2. Check if the API endpoint path is valid")
        
    elif status_code == 429:
        print("  • Rate limit exceeded")
        print(f"\n{Colors.OKCYAN}Solutions:{Colors.ENDC}")
        print("  1. Wait before making more requests")
        print("  2. Implement rate limiting in your application")
        
    elif status_code == 500 or status_code == 502 or status_code == 503:
        print("  • Server error")
        print(f"\n{Colors.OKCYAN}Solutions:{Colors.ENDC}")
        print("  1. Delta Exchange servers may be experiencing issues")
        print("  2. Try again in a few minutes")
        print("  3. Check Delta Exchange status page")
    
    elif status_code == 0:
        print("  • Network connectivity issue")
        print(f"\n{Colors.OKCYAN}Solutions:{Colors.ENDC}")
        print("  1. Check your internet connection")
        print("  2. Verify the base URL is accessible")
        print("  3. Check if firewall is blocking the connection")

def test_endpoint(base_url: str, api_key: str, api_secret: str, 
                  endpoint_name: str, path: str) -> bool:
    """Test a specific API endpoint"""
    print(f"\n{Colors.BOLD}Testing: {endpoint_name}{Colors.ENDC}")
    print(f"Path: {path}")
    
    success, status_code, response_text, response_time = make_api_request(
        base_url, api_key, api_secret, path
    )
    
    if success:
        print_success(f"Status: {status_code} OK")
        print_info(f"Response time: {response_time:.3f}s")
        
        # Try to parse and display JSON response
        try:
            data = json.loads(response_text)
            if isinstance(data, dict):
                print(f"{Colors.OKBLUE}Response data:{Colors.ENDC}")
                print(json.dumps(data, indent=2)[:500])  # Show first 500 chars
        except:
            print(f"Response: {response_text[:200]}")
        
        return True
    else:
        diagnose_error(status_code, response_text)
        return False

def main():
    """Main execution function"""
    print_header("DELTA EXCHANGE API CONNECTION CHECKER")
    
    # Load environment variables
    load_dotenv()
    
    api_key = os.getenv("DELTA_API_KEY")
    api_secret = os.getenv("DELTA_SECRET_KEY")
    base_url = os.getenv("DELTA_BASE_URL", "https://api.india.delta.exchange").rstrip('/')
    
    # Display configuration
    print(f"{Colors.BOLD}Configuration:{Colors.ENDC}")
    print(f"  Base URL: {Colors.OKCYAN}{base_url}{Colors.ENDC}")
    print(f"  API Key: {Colors.OKCYAN}{api_key[:10]}...{api_key[-4:] if api_key else 'None'}{Colors.ENDC}")
    print(f"  Timestamp: {Colors.OKCYAN}{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}{Colors.ENDC}")
    
    # Validate credentials
    if not api_key or not api_secret:
        print_error("API Key or Secret missing in .env file")
        print_info("Please add DELTA_API_KEY and DELTA_SECRET_KEY to your .env file")
        exit(1)
    
    if len(api_key) < 10 or len(api_secret) < 10:
        print_warning("API credentials seem too short. Please verify.")
    
    # Test multiple endpoints
    endpoints = [
        ("Wallet Balances", "/v2/wallet/balances"),
        ("Positions", "/v2/positions"),
        ("Products (Public)", "/v2/products"),
    ]
    
    results = []
    print_header("TESTING API ENDPOINTS")
    
    for name, path in endpoints:
        success = test_endpoint(base_url, api_key, api_secret, name, path)
        results.append((name, success))
        time.sleep(0.5)  # Small delay between requests
    
    # Summary
    print_header("TEST SUMMARY")
    
    passed = sum(1 for _, success in results if success)
    total = len(results)
    
    for name, success in results:
        if success:
            print_success(f"{name}: PASSED")
        else:
            print_error(f"{name}: FAILED")
    
    print(f"\n{Colors.BOLD}Overall: {passed}/{total} tests passed{Colors.ENDC}")
    
    if passed == total:
        print_success("All tests passed! Delta Exchange API connection is working perfectly.")
        exit(0)
    elif passed > 0:
        print_warning("Some tests passed. Check the failed endpoints above.")
        exit(1)
    else:
        print_error("All tests failed. Please review the diagnostics above.")
        exit(1)

if __name__ == "__main__":
    main()
