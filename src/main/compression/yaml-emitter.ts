/**
 * Minimal YAML emitter for semantic extraction output.
 *
 * Handles the predictable shapes (SemanticNode + GlobalVars) without pulling
 * in a full YAML library. Optimized for LLM consumption: no refs, no line
 * folding, string quoting only when ambiguous.
 */

const NEEDS_QUOTING = /^[\s#\-?:>{|&!%@`'",[\]{}]|:\s|#|[:\s]$/;

function escapeAndQuote(str: string): string {
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
}

function quoteIfNeeded(str: string): string {
  if (str === '' || str === 'true' || str === 'false' || str === 'null') return escapeAndQuote(str);
  if (str.includes('\n') || str.includes('\r')) return escapeAndQuote(str);
  if (NEEDS_QUOTING.test(str)) return escapeAndQuote(str);
  if (/^-?\d+(\.\d+)?$/.test(str)) return escapeAndQuote(str);
  return str;
}

function emitValue(value: unknown, indent: number): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return quoteIfNeeded(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const prefix = ' '.repeat(indent);
    const lines = value.map((item) => {
      const itemStr = emitValue(item, indent + 2);
      // If the item is a multiline object, put it on the next line
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        const objLines = itemStr.split('\n');
        // First key goes on the same line as the dash
        return `${prefix}- ${objLines[0]}\n${objLines
          .slice(1)
          .map((l) => `${prefix}  ${l}`)
          .join('\n')}`;
      }
      return `${prefix}- ${itemStr}`;
    });
    return '\n' + lines.join('\n');
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const prefix = ' '.repeat(indent);
    const lines = entries.map(([key, val]) => {
      const valStr = emitValue(val, indent + 2);
      if (valStr.startsWith('\n')) {
        // Array or nested object — put on next line
        return `${prefix}${quoteIfNeeded(key)}:${valStr}`;
      }
      return `${prefix}${quoteIfNeeded(key)}: ${valStr}`;
    });
    return lines.join('\n');
  }

  return String(value);
}

/** Convert a value to minimal YAML string. */
export function toYaml(data: unknown): string {
  if (data === null || data === undefined) return 'null\n';
  const result = emitValue(data, 0);
  return result + '\n';
}
