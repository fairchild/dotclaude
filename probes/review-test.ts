/**
 * Test file for code review workflow verification
 */

// Bug: division by zero when array is empty
export function average(nums: number[]): number {
  const sum = nums.reduce((a, b) => a + b, 0);
  return sum / nums.length;
}

// Bug: SQL injection vulnerability
export function getUserQuery(id: string): string {
  return `SELECT * FROM users WHERE id = '${id}'`;
}

// Bug: loose equality with type coercion
export function isActive(status: any): boolean {
  return status == true;
}

// Bug: no bounds checking
export function getScore(errors: number): number {
  return 5 - errors;
}
