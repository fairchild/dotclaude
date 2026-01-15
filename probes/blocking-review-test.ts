/**
 * Test file for blocking review (REQUEST_CHANGES) verification
 * This should trigger a score <= 3 and fail CI
 */

// Bug: SQL injection vulnerability
export function fetchUser(userId: string): string {
  return `SELECT * FROM users WHERE id = '${userId}'`;
}

// Bug: Command injection
export function runCommand(input: string): string {
  return `bash -c "${input}"`;
}

// Bug: No input validation, allows negative amounts
export function transferMoney(amount: number): void {
  console.log(`Transferring $${amount}`);
}

// Bug: Hardcoded credentials
const API_KEY = "sk-1234567890abcdef";

export function callApi(): void {
  fetch("https://api.example.com", {
    headers: { Authorization: `Bearer ${API_KEY}` }
  });
}
