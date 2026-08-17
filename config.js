/**
 * ============================================================================
 * GPA SCALE CONFIGURATION
 * ============================================================================
 * You can edit any of the GPA point values below to match your school's
 * exact handbook. Each tier defines:
 *  - grade: Letter grade identifier
 *  - min / max: Grade percentage range
 *  - regular: Points on the standard 4.33 scale
 *  - honors: Points on the honors 4.83 scale
 *  - ap_ccp: Points on the AP / CCP 5.33 scale
 * ============================================================================
 */

export const SCALE_DEFINITIONS = [
  { id: 'regular', name: 'Regular (4.33 Scale)', maxGpa: 4.33 },
  { id: 'honors', name: 'Honors (4.83 Scale)', maxGpa: 4.83 },
  { id: 'ap_ccp', name: 'AP / CCP (5.33 Scale)', maxGpa: 5.33 }
];

export const GRADE_TIERS = [
  {
    grade: 'A+',
    min: 98,
    max: 100,
    regular: 4.33,
    honors: 4.83,
    ap_ccp: 5.33
  },
  {
    grade: 'A',
    min: 92,
    max: 97,
    regular: 4.00,
    honors: 4.50,
    ap_ccp: 5.00
  },
  {
    grade: 'A-',
    min: 90,
    max: 91,
    regular: 3.67,
    honors: 4.17,
    ap_ccp: 4.67
  },
  {
    grade: 'B+',
    min: 87,
    max: 89,
    regular: 3.33,
    honors: 3.83,
    ap_ccp: 4.33
  },
  {
    grade: 'B',
    min: 82,
    max: 86,
    regular: 3.00,
    honors: 3.50,
    ap_ccp: 4.00
  },
  {
    grade: 'B-',
    min: 80,
    max: 81,
    regular: 2.67,
    honors: 3.17,
    ap_ccp: 3.67
  },
  {
    grade: 'C+',
    min: 77,
    max: 79,
    regular: 2.33,
    honors: 2.83,
    ap_ccp: 3.33
  },
  {
    grade: 'C',
    min: 73,
    max: 76,
    regular: 2.00,
    honors: 2.50,
    ap_ccp: 3.00
  },
  {
    grade: 'C-',
    min: 70,
    max: 72,
    regular: 1.67,
    honors: 2.17,
    ap_ccp: 2.67
  },
  {
    grade: 'D+',
    min: 67,
    max: 69,
    regular: 1.33,
    honors: 1.33,
    ap_ccp: 1.33
  },
  {
    grade: 'D',
    min: 63,
    max: 66,
    regular: 1.00,
    honors: 1.00,
    ap_ccp: 1.00
  },
  {
    grade: 'D-',
    min: 60,
    max: 62,
    regular: 0.67,
    honors: 0.67,
    ap_ccp: 0.67
  },
  {
    grade: 'F',
    min: 0,
    max: 59,
    regular: 0.00,
    honors: 0.00,
    ap_ccp: 0.00
  }
];

/**
 * Finds the matching tier for a numeric percentage (0 - 100) or letter grade.
 * @param {number|string} input - Percentage (e.g. 94) or Letter Grade (e.g. "A-")
 * @returns {object|null} Matching tier object or null
 */
export function getTierForGrade(input) {
  if (input === null || input === undefined || input === '') return null;

  // Clean string: strip %, trim whitespace
  const cleanStr = String(input).trim().replace('%', '');
  const num = parseFloat(cleanStr);

  if (!isNaN(num)) {
    // Check tiers from top to bottom against minimum threshold
    for (const tier of GRADE_TIERS) {
      if (num >= tier.min) {
        return tier;
      }
    }
    return GRADE_TIERS[GRADE_TIERS.length - 1];
  }

  // If input is a letter grade string (e.g., "A+", "B", "c-")
  const str = String(input).trim().toUpperCase();
  return GRADE_TIERS.find(t => t.grade === str) || null;
}

/**
 * Gets the GPA points for a given grade and scale.
 * @param {number|string} gradeInput - Percentage or letter grade
 * @param {string} scaleId - 'regular' | 'honors' | 'ap_ccp'
 * @returns {number|null} GPA points (e.g. 4.83) or null if invalid
 */
export function calculateGpaPoints(gradeInput, scaleId = 'regular') {
  const tier = getTierForGrade(gradeInput);
  if (!tier) return null;

  const points = tier[scaleId];
  return points !== undefined ? points : tier.regular;
}

/**
 * Gets standard unweighted points for comparison (always regular scale)
 * @param {number|string} gradeInput
 * @returns {number|null}
 */
export function calculateUnweightedPoints(gradeInput) {
  const tier = getTierForGrade(gradeInput);
  if (!tier) return null;
  return tier.regular;
}

/**
 * ============================================================================
 * CONVEX BACKEND CONFIGURATION
 * ============================================================================
 * Set your hosted Convex project deployment URL here.
 * Example: 'https://joyful-capybara-123.convex.cloud'
 * ============================================================================
 */
export const CONVEX_URL = 'https://tremendous-tiger-513.convex.cloud';

export function getConvexUrl() {
  return (CONVEX_URL || '').trim().replace(/\/+$/, '');
}


