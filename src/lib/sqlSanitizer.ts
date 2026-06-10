/**
 * SQL Sanitizer for PostgreSQL Compatibility
 * 
 * Fixes common PostgreSQL compatibility issues in AI-generated SQL queries:
 * 1. round(double precision, integer) - needs explicit cast to numeric
 * 2. AT TIME ZONE issues with Azure PostgreSQL 17
 * 3. Other common function signature mismatches
 */

/**
 * Known SQL error patterns and their fixes
 */
interface SqlFix {
    pattern: RegExp
    fix: (match: string, ...groups: string[]) => string
    description: string
}

const SQL_FIXES: SqlFix[] = [
    {
        // Fix: round(value, n) -> round(value::numeric, n)
        // Matches: round(column, 2), round(avg(close), 2), round(expression, 2)
        // BUT we need to be careful not to match round() that already has ::numeric
        // or round() with complex nested expressions
        pattern: /\bround\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\s*\([^)]*\))?)\s*,\s*(\d+)\s*\)/gi,
        fix: (match, value, precision) => {
            // Don't double-cast if already has ::numeric
            if (value.includes('::numeric')) {
                return match
            }
            return `round((${value.trim()})::numeric, ${precision})`
        },
        description: 'Cast to numeric for round() function'
    },
    {
        // Fix: Gemini often generates broken round() with extra ::NUMERIC cast and wrong parenthesis
        // Pattern: round(((...))::NUMERIC,\n      2\n    ) AS alias
        // This catches the malformed round with nested parens and cast
        pattern: /round\s*\(\s*\(\s*\(\s*\(([^)]+)\)\s*\*\s*100\.0\s*\/\s*NULLIF\s*\(([^,]+),\s*0\s*\)\s*\)\s*::NUMERIC\s*,\s*(\d+)\s*\)/gi,
        fix: (_match, expr, nullifExpr, precision) => {
            return `round(((${expr.trim()}) * 100.0 / NULLIF(${nullifExpr.trim()}, 0))::numeric, ${precision})`
        },
        description: 'Fix malformed round() with percentage calculation'
    },
    {
        // Fix: trunc(value, n) -> trunc(value::numeric, n)
        pattern: /\btrunc\s*\(\s*([^,]+?)\s*,\s*(\d+)\s*\)/gi,
        fix: (match, value, precision) => {
            if (value.includes('::numeric')) {
                return match
            }
            return `trunc((${value.trim()})::numeric, ${precision})`
        },
        description: 'Cast to numeric for trunc() function'
    },
    {
        // Fix: "column" AT TIME ZONE 'Asia/Kolkata' issues
        // Remove AT TIME ZONE clause if it's causing issues (DB already stores IST)
        pattern: /AT\s+TIME\s+ZONE\s+'Asia\/Kolkata'/gi,
        fix: () => '',
        description: 'Remove AT TIME ZONE clause (data already in IST)'
    },
    {
        // Fix: mis-parenthesized LAG/LEAD with offset placed outside function: LAG(col)::numeric, 1) OVER (...)
        // Normalize to (LAG(col, 1) OVER (...))::numeric
        pattern: /\b(LAG|LEAD)\s*\(\s*([^\)]+?)\s*\)\s*::numeric\s*,\s*(\d+)\)\s*OVER\s*\(([^)]*?)\)/gi,
        fix: (_match, fn, expr, offset, over) => `(${fn}(${expr.trim()}, ${offset}) OVER (${over}))::numeric`,
        description: 'Normalize LAG/LEAD offset placement and casting to ::numeric'
    },
    {
        // Fix: INTERVAL expressions in SELECT columns cause Prisma deserialization failure.
        // Prisma cannot deserialize PostgreSQL 'interval' type.
        // Cast any INTERVAL expression to TEXT so Prisma can read it as a string.
        // Matches patterns like: (MAX(ts) - MIN(ts)) AS duration
        // or: AVG(ts2 - ts1) AS avg_time
        // Strategy: if the result of a subtraction between timestamp columns is aliased,
        // wrap it with ::text cast.
        pattern: /\(([^)]+\s*-\s*[^)]+)\)\s*(AS\s+\w+)/gi,
        fix: (_match, expr, alias) => {
            // Only cast if it looks like a timestamp subtraction (not arithmetic on numbers)
            // Heuristic: if neither side is a pure number, it's likely a timestamp diff → interval
            const looksLikeTimestampDiff = !/^\s*[\d.]+\s*$/.test(expr.split('-')[0].trim())
            if (looksLikeTimestampDiff) {
                return `(${expr})::text ${alias}`
            }
            return _match
        },
        description: 'Cast timestamp subtraction (interval) to ::text for Prisma compatibility'
    }
]

/**
 * Balance parentheses in SQL - fixes common AI mistakes
 */
function balanceParentheses(sql: string): string {
    // Count opening and closing parens
    const opens = (sql.match(/\(/g) || []).length
    const closes = (sql.match(/\)/g) || []).length

    if (opens > closes) {
        // Add missing closing parens before AS keyword or at end
        const diff = opens - closes
        // Try to add them before " AS " if found after round/calculation
        const asMatch = sql.match(/\)::(?:numeric|NUMERIC)\s*,\s*\d+\s*\)\s+AS\s+/i)
        if (asMatch) {
            const idx = sql.indexOf(asMatch[0])
            return sql.slice(0, idx) + ')'.repeat(diff) + sql.slice(idx)
        }
        return sql + ')'.repeat(diff)
    }
    return sql
}

/**
 * Sanitize SQL query by applying all known fixes
 * @param sql - The raw SQL query from AI
 * @returns Sanitized SQL query
 */
export function sanitizeSql(sql: string): string {
    let sanitized = sql

    // FIX THE EXACT BROKEN PATTERN GEMINI GENERATES:
    // Broken: round(((candles * 100.0 / NULLIF(total)::numeric, 0))::numeric, 2)
    // Correct: round((candles * 100.0 / NULLIF(total, 0))::numeric, 2)
    // 
    // The AI wrongly places NULLIF's second arg after the cast: NULLIF(x)::numeric, 0)
    // And adds extra parens: round(((...)))

    // More flexible pattern - just look for the broken NULLIF pattern and fix it
    // Pattern: ... NULLIF(identifier)::numeric, 0) ...
    // Should be: ... NULLIF(identifier, 0) ...
    sanitized = sanitized.replace(
        /NULLIF\s*\(\s*(\w+)\s*\)\s*::numeric\s*,\s*(\d+)\s*\)/gi,
        (_match, expr, fallback) => `NULLIF(${expr}, ${fallback})`
    )

    // Also fix: round(((expr))::numeric, 2) → round((expr)::numeric, 2)
    // Remove the extra nested parens
    sanitized = sanitized.replace(
        /round\s*\(\s*\(\s*\(\s*([^)]+\))\s*\)\s*::numeric/gi,
        'round(($1)::numeric'
    )

    // Also handle simpler broken NULLIF pattern anywhere:
    // NULLIF(x)::numeric, 0) → NULLIF(x, 0)
    sanitized = sanitized.replace(
        /NULLIF\s*\(\s*([^,\)]+)\s*\)\s*::numeric\s*,\s*(\d+)\s*\)/gi,
        (_match, expr, fallback) => `NULLIF(${expr.trim()}, ${fallback})`
    )

    for (const fix of SQL_FIXES) {
        sanitized = sanitized.replace(fix.pattern, fix.fix)
    }

    // Finally, balance any remaining unmatched parentheses
    sanitized = balanceParentheses(sanitized)

    return sanitized
}

/**
 * Check if an error message indicates a fixable SQL issue
 * @param errorMessage - The PostgreSQL error message
 * @returns Object with canFix flag and suggested fix description
 */
export function analyzeError(errorMessage: string): {
    canFix: boolean
    errorType: string
    suggestion: string
} {
    const lowerError = errorMessage.toLowerCase()

    // round(double precision, integer) does not exist
    if (lowerError.includes('round') && lowerError.includes('does not exist')) {
        return {
            canFix: true,
            errorType: 'round_type_mismatch',
            suggestion: 'Cast the first argument to ::numeric before using round()'
        }
    }

    // trunc/truncate type mismatch
    if (lowerError.includes('trunc') && lowerError.includes('does not exist')) {
        return {
            canFix: true,
            errorType: 'trunc_type_mismatch',
            suggestion: 'Cast the first argument to ::numeric before using trunc()'
        }
    }

    // timezone function issues
    if (lowerError.includes('timezone') || lowerError.includes('at time zone')) {
        return {
            canFix: true,
            errorType: 'timezone_issue',
            suggestion: 'Remove AT TIME ZONE clause, data is already in IST'
        }
    }

    // Prisma interval deserialization error
    if (lowerError.includes('interval') && (lowerError.includes('deserializ') || lowerError.includes('unsupported'))) {
        return {
            canFix: true,
            errorType: 'interval_type',
            suggestion: 'Cast timestamp subtraction results to ::text. Never use INTERVAL type in SELECT columns — Prisma cannot deserialize it. Instead of (ts2 - ts1) AS duration, use EXTRACT(EPOCH FROM (ts2 - ts1))::numeric AS duration_seconds or cast to text: (ts2 - ts1)::text AS duration.'
        }
    }

    // column does not exist
    if (lowerError.includes('column') && lowerError.includes('does not exist')) {
        return {
            canFix: false,
            errorType: 'column_not_found',
            suggestion: 'Check column names in the schema'
        }
    }

    // syntax error
    if (lowerError.includes('syntax error')) {
        return {
            canFix: false,
            errorType: 'syntax_error',
            suggestion: 'Fix SQL syntax'
        }
    }

    return {
        canFix: false,
        errorType: 'unknown',
        suggestion: 'Unknown error type'
    }
}

/**
 * Generate a prompt for AI to fix the SQL based on error
 * @param originalQuery - The original user question
 * @param failedSql - The SQL that failed
 * @param errorMessage - The PostgreSQL error message
 * @param errorAnalysis - Result from analyzeError()
 * @returns Prompt to send to AI for retry
 */
export function generateRetryPrompt(
    originalQuery: string,
    failedSql: string,
    errorMessage: string,
    errorAnalysis: { errorType: string; suggestion: string }
): string {
    return `
⚠️ YOUR PREVIOUS SQL QUERY FAILED. PLEASE FIX IT.

ORIGINAL USER QUESTION: "${originalQuery}"

YOUR PREVIOUS SQL (FAILED):
\`\`\`sql
${failedSql}
\`\`\`

ERROR MESSAGE FROM POSTGRESQL:
${errorMessage}

ERROR TYPE: ${errorAnalysis.errorType}
SUGGESTED FIX: ${errorAnalysis.suggestion}

IMPORTANT POSTGRESQL RULES:
1. round() function requires ::numeric cast: round(value::numeric, 2)
2. trunc() function requires ::numeric cast: trunc(value::numeric, 2)
3. Don't use AT TIME ZONE 'Asia/Kolkata' - data is already in IST
4. Column names are case-sensitive and must be in double quotes: "stockId", "createdAt"
5. Use LIMIT to avoid huge result sets
6. Window functions MUST have parentheses: ROW_NUMBER() OVER (...), LAG() OVER (...)
7. OVER clause must follow a window function, never standalone
8. Every opening parenthesis must have a closing one
9. CTEs (WITH clauses) must have proper syntax: WITH name AS (SELECT ...)

TRY A SIMPLER APPROACH:
- If your query was complex, try breaking it into simpler parts
- Use basic aggregations (AVG, SUM, COUNT, MIN, MAX) instead of window functions
- Use GROUP BY DATE("timestamp") for daily summaries

Please generate a CORRECTED SQL query that fixes the error.
`
}

