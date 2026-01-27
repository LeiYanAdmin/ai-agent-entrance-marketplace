/**
 * Sensitive information detection and sanitization
 */

import { logger } from '../../utils/logger.js';

export interface SensitiveFinding {
  pattern: string;
  match: string;
  position: number;
}

const BUILTIN_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: 'api_key', regex: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?([a-zA-Z0-9_\-]{20,})["']?/gi },
  { name: 'password', regex: /(?:password|passwd|pwd)\s*[:=]\s*["']?([^\s"']{8,})["']?/gi },
  { name: 'secret', regex: /(?:secret|client_secret)\s*[:=]\s*["']?([a-zA-Z0-9_\-]{16,})["']?/gi },
  { name: 'token', regex: /(?:token|access_token|refresh_token)\s*[:=]\s*["']?([a-zA-Z0-9_\-\.]{20,})["']?/gi },
  { name: 'bearer', regex: /Bearer\s+([a-zA-Z0-9_\-\.]{20,})/g },
  { name: 'private_key', regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA )?PRIVATE KEY-----/g },
  { name: 'aws_key', regex: /(?:AKIA|ASIA)[A-Z0-9]{16}/g },
  { name: 'aws_secret', regex: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*["']?([a-zA-Z0-9/+=]{40})["']?/gi },
  { name: 'hex_secret', regex: /(?:secret|private|signing)\s*[:=]\s*["']?([0-9a-fA-F]{32,})["']?/gi },
  { name: 'connection_string', regex: /(?:mongodb|postgres|mysql|redis):\/\/[^\s"']+/gi },
  { name: 'jwt', regex: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+/g },
  { name: 'github_token', regex: /(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36}/g },
  { name: 'slack_token', regex: /xox[bpars]-[a-zA-Z0-9-]+/g },
];

export class SensitiveFilter {
  private customPatterns: { name: string; regex: RegExp }[] = [];

  constructor(customPatterns?: string[]) {
    if (customPatterns) {
      for (const pattern of customPatterns) {
        try {
          this.customPatterns.push({
            name: `custom_${this.customPatterns.length}`,
            regex: new RegExp(pattern, 'g'),
          });
        } catch (error) {
          logger.warn('SECURITY', `Invalid custom pattern: ${pattern}`);
        }
      }
    }
  }

  /**
   * Detect sensitive information in content
   */
  detect(content: string): SensitiveFinding[] {
    const findings: SensitiveFinding[] = [];
    const allPatterns = [...BUILTIN_PATTERNS, ...this.customPatterns];

    for (const { name, regex } of allPatterns) {
      // Reset regex state for global patterns
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        findings.push({
          pattern: name,
          match: match[0].length > 20
            ? match[0].slice(0, 10) + '...' + match[0].slice(-5)
            : match[0],
          position: match.index,
        });
      }
    }

    return findings;
  }

  /**
   * Sanitize content by replacing sensitive matches with [REDACTED]
   */
  sanitize(content: string): string {
    let result = content;
    const allPatterns = [...BUILTIN_PATTERNS, ...this.customPatterns];

    for (const { regex } of allPatterns) {
      regex.lastIndex = 0;
      result = result.replace(regex, '[REDACTED]');
    }

    return result;
  }

  /**
   * Check if content is safe (no sensitive info detected)
   */
  isSafe(content: string): { safe: boolean; findings: SensitiveFinding[] } {
    const findings = this.detect(content);
    return {
      safe: findings.length === 0,
      findings,
    };
  }
}
