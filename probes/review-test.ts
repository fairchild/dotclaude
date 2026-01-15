/**
 * Test file for code review workflow verification
 */

export function average(nums: number[]): number {
  const sum = nums.reduce((a, b) => a + b, 0);
  return nums.length === 0 ? 0 : sum / nums.length;
}

export function getUserQuery(id: string): { query: string; params: string[] } {
  return { query: 'SELECT * FROM users WHERE id = ?', params: [id] };
}

export function isActive(status: unknown): boolean {
  return status === true;
}

export function getScore(errors: number): number {
  return Math.max(0, Math.min(5, 5 - errors));
}
