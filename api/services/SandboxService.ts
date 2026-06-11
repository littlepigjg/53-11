import { createHash } from 'node:crypto';
import type { ParsedDocument, Paragraph, Violation, ViolationLocation, DocumentCategory } from '../../shared/types.js';

const DANGEROUS_PATTERNS = [
  /\b(eval|Function|setTimeout|setInterval)\s*\(/g,
  /\b(require|import|fetch|XMLHttpRequest)\b/g,
  /\b(process|global|globalThis|window)\b/g,
  /\b(fs|child_process|net|http|https)\b/g,
  /document\.(cookie|domain|write)/g,
  /\blocalStorage\b|\bsessionStorage\b/g,
  /\b__dirname\b|\b__filename\b/g,
  /\bmodule\b|\bexports\b/g,
  /\bdocument\b[^.]*\.(addEventListener|querySelector)/g,
];

const MAX_EXECUTION_TIME_MS = 2000;
const MAX_LOOP_ITERATIONS = 10000;
const MAX_OUTPUT_SIZE = 100 * 1024;

export interface SandboxContext {
  document: {
    fullText: string;
    paragraphs: {
      id: string;
      index: number;
      type: Paragraph['type'];
      content: string;
      level?: number;
    }[];
    category?: DocumentCategory;
    headings: string[];
    codeBlocks: string[];
    links: string[];
  };
  helpers: {
    regexMatch: (pattern: string, text: string, flags?: string) => RegExpMatchArray[];
    findParagraphByContent: (keyword: string) => number[];
    getParagraphsByType: (type: Paragraph['type']) => number[];
    hasHeading: (text: string, level?: number) => boolean;
    countOccurrences: (text: string, substring: string) => number;
    isWithinCodeBlock: (paragraphIndex: number) => boolean;
  };
  result: Violation[];
}

export interface SandboxExecutionResult {
  success: boolean;
  violations: Violation[];
  error?: string;
  executionTimeMs: number;
  warnings?: string[];
}

export class SandboxService {
  static validateScript(script: string): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!script || script.trim().length === 0) {
      errors.push('脚本不能为空');
      return { valid: false, errors, warnings };
    }

    if (script.length > 10000) {
      errors.push('脚本长度超过最大限制（10000字符）');
    }

    for (const pattern of DANGEROUS_PATTERNS) {
      const matches = script.match(pattern);
      if (matches) {
        const unique = Array.from(new Set(matches));
        warnings.push(`检测到潜在危险调用: ${unique.join(', ')}`);
      }
    }

    try {
      new Function('ctx', `"use strict";\n${script}`);
    } catch (e) {
      errors.push(`语法错误: ${(e as Error).message}`);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  static analyzeDocument(parsed: ParsedDocument) {
    const fullText = parsed.paragraphs.map((p) => p.content).join('\n\n');

    const headings = parsed.paragraphs
      .filter((p) => p.type === 'heading')
      .map((p) => p.content);

    const codeBlocks = parsed.paragraphs
      .filter((p) => p.type === 'code')
      .map((p) => p.content);

    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const links: string[] = [];
    let match;
    while ((match = linkRegex.exec(fullText)) !== null) {
      links.push(match[2]);
    }

    return { fullText, headings, codeBlocks, links };
  }

  static buildContext(parsed: ParsedDocument, category?: DocumentCategory): SandboxContext {
    const analysis = this.analyzeDocument(parsed);

    const paragraphMap = new Map<string, number>();
    parsed.paragraphs.forEach((p, idx) => paragraphMap.set(p.id, idx));

    return {
      document: {
        fullText: analysis.fullText,
        paragraphs: parsed.paragraphs.map((p) => ({
          id: p.id,
          index: p.index,
          type: p.type,
          content: p.content,
          level: p.level,
        })),
        category,
        headings: analysis.headings,
        codeBlocks: analysis.codeBlocks,
        links: analysis.links,
      },
      helpers: {
        regexMatch: (pattern: string, text: string, flags: string = 'g') => {
          try {
            const re = new RegExp(pattern, flags);
            const results: RegExpMatchArray[] = [];
            let m: RegExpExecArray | null;
            let count = 0;
            while ((m = re.exec(text)) !== null && count < 1000) {
              results.push(m as unknown as RegExpMatchArray);
              count++;
              if (m.index === re.lastIndex) re.lastIndex++;
            }
            return results;
          } catch {
            return [];
          }
        },
        findParagraphByContent: (keyword: string) => {
          return parsed.paragraphs
            .filter((p) => p.content.toLowerCase().includes(keyword.toLowerCase()))
            .map((p) => p.index);
        },
        getParagraphsByType: (type: Paragraph['type']) => {
          return parsed.paragraphs.filter((p) => p.type === type).map((p) => p.index);
        },
        hasHeading: (text: string, level?: number) => {
          return parsed.paragraphs.some(
            (p) =>
              p.type === 'heading' &&
              (level === undefined || p.level === level) &&
              p.content.toLowerCase().includes(text.toLowerCase())
          );
        },
        countOccurrences: (text: string, substring: string) => {
          const re = new RegExp(substring.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
          return (text.match(re) || []).length;
        },
        isWithinCodeBlock: (paragraphIndex: number) => {
          return parsed.paragraphs[paragraphIndex]?.type === 'code';
        },
      },
      result: [],
    };
  }

  static createViolation(
    ctx: SandboxContext,
    params: {
      ruleId: string;
      ruleName: string;
      severity: 'critical' | 'warning' | 'info';
      category: DocumentCategory;
      message: string;
      fixGuidance: string;
      paragraphId?: string;
      paragraphIndex?: number;
      snippet?: string;
      lineStart?: number;
      charStart?: number;
      charEnd?: number;
    }
  ): Violation {
    const location: ViolationLocation = {};

    if (params.paragraphId) {
      location.paragraphId = params.paragraphId;
      const p = ctx.document.paragraphs.find((pp) => pp.id === params.paragraphId);
      if (p) {
        location.paragraphIndex = p.index;
        location.snippet = p.content.slice(0, 200);
      }
    }

    if (params.paragraphIndex !== undefined) {
      location.paragraphIndex = params.paragraphIndex;
      const p = ctx.document.paragraphs.find((pp) => pp.index === params.paragraphIndex);
      if (p) {
        location.paragraphId = p.id;
        location.snippet = p.content.slice(0, 200);
      }
    }

    if (params.snippet) {
      location.snippet = params.snippet.slice(0, 200);
    }
    if (params.lineStart !== undefined) location.lineStart = params.lineStart;
    if (params.charStart !== undefined) location.charStart = params.charStart;
    if (params.charEnd !== undefined) location.charEnd = params.charEnd;

    return {
      id: `vio_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      ruleId: params.ruleId,
      ruleName: params.ruleName,
      severity: params.severity,
      category: params.category,
      message: params.message,
      fixGuidance: params.fixGuidance,
      location,
      detectedAt: new Date().toISOString(),
    };
  }

  static execute(
    script: string,
    parsed: ParsedDocument,
    ruleMeta: {
      ruleId: string;
      ruleName: string;
      severity: 'critical' | 'warning' | 'info';
      category: DocumentCategory;
      fixGuidance: string;
    },
    category?: DocumentCategory
  ): SandboxExecutionResult {
    const startTime = Date.now();
    const warnings: string[] = [];

    const validation = this.validateScript(script);
    warnings.push(...validation.warnings);

    if (!validation.valid) {
      return {
        success: false,
        violations: [],
        error: validation.errors.join('; '),
        executionTimeMs: Date.now() - startTime,
        warnings,
      };
    }

    const ctx = this.buildContext(parsed, category);
    const timeoutId = { cancelled: false };

    const wrappedScript = `
      "use strict";
      var __loopCounter = 0;
      var __maxLoops = ${MAX_LOOP_ITERATIONS};
      function __checkLoop() {
        if (++__loopCounter > __maxLoops) {
          throw new Error("Loop iteration limit exceeded");
        }
      }
      var __addViolation = function(params) {
        if (!params) return;
        var merged = Object.assign({}, ${JSON.stringify(ruleMeta)}, params);
        var v = __createViolationFn(__ctx, {
          ruleId: merged.ruleId,
          ruleName: merged.ruleName,
          severity: merged.severity,
          category: merged.category,
          message: params.message || merged.ruleName,
          fixGuidance: params.fixGuidance || merged.fixGuidance,
          paragraphId: params.paragraphId,
          paragraphIndex: params.paragraphIndex,
          snippet: params.snippet,
          lineStart: params.lineStart,
          charStart: params.charStart,
          charEnd: params.charEnd
        });
        if (__ctx.result.length < 500) {
          __ctx.result.push(v);
        }
      };
      (function(__ctx, addViolation) {
        ${script.replace(/\bfor\s*\(/g, 'for (__checkLoop();').replace(/\bwhile\s*\(/g, 'while (__checkLoop() && ')}
      })(__ctx, __addViolation);
    `;

    try {
      const timeout = setTimeout(() => {
        timeoutId.cancelled = true;
      }, MAX_EXECUTION_TIME_MS);

      const fn = new Function(
        '__ctx',
        '__createViolationFn',
        wrappedScript
      );

      fn(ctx, this.createViolation.bind(this));
      clearTimeout(timeout);

      if (timeoutId.cancelled) {
        return {
          success: false,
          violations: [],
          error: '脚本执行超时',
          executionTimeMs: Date.now() - startTime,
          warnings,
        };
      }

      const outputSize = JSON.stringify(ctx.result).length;
      if (outputSize > MAX_OUTPUT_SIZE) {
        warnings.push(`输出结果过大（${outputSize}字节），已截断`);
        ctx.result = ctx.result.slice(0, 100);
      }

      return {
        success: true,
        violations: ctx.result,
        executionTimeMs: Date.now() - startTime,
        warnings,
      };
    } catch (e) {
      return {
        success: false,
        violations: [],
        error: (e as Error).message || '未知执行错误',
        executionTimeMs: Date.now() - startTime,
        warnings,
      };
    }
  }

  static scriptHash(script: string): string {
    return createHash('sha256').update(script).digest('hex').slice(0, 16);
  }
}
