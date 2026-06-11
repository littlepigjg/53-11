import type {
  ParsedDocument,
  Paragraph,
  ParagraphType,
  ComplianceRule,
  Violation,
  ViolationLocation,
  RegexPattern,
  ASTCondition,
  DocumentCategory,
  SeverityLevel,
} from '../../shared/types.js';
import { SandboxService } from './SandboxService.js';

type ASTNodeValue = string | number | boolean | null | undefined | ASTNode | ASTNode[];
type MetadataValue = string | number | boolean | null | undefined;

interface ASTNode {
  type: string;
  children?: ASTNode[];
  items?: ASTNode[];
  metadata?: Record<string, MetadataValue>;
  content?: string;
  index?: number;
  id?: string;
  raw?: Paragraph;
  depth?: number;
  text?: string;
  language?: string;
  code?: string;
  linkText?: string;
  url?: string;
  [key: string]: ASTNodeValue | Record<string, MetadataValue> | Paragraph | undefined;
}

export class ComplianceEngine {
  static detectDocumentCategory(parsed: ParsedDocument, title: string): DocumentCategory {
    const allText = (title + ' ' + parsed.paragraphs.map((p) => p.content).join(' ')).toLowerCase();

    const privacyKeywords = ['隐私政策', '隐私权政策', 'privacy policy', '隐私声明', '个人信息', '个人数据'];
    const contractKeywords = ['合同', '协议', 'contract', 'agreement', '甲方', '乙方', '签署', '签订', '条款'];
    const technicalKeywords = ['api', '接口', '开发文档', '技术文档', 'technical', '接口文档', '部署', '配置', '代码', 'sdk'];

    const score = { privacy: 0, contract: 0, technical: 0, general: 1 };

    for (const kw of privacyKeywords) {
      if (allText.includes(kw)) score.privacy += 2;
    }
    for (const kw of contractKeywords) {
      if (allText.includes(kw)) score.contract += 2;
    }
    for (const kw of technicalKeywords) {
      if (allText.includes(kw)) score.technical += 1;
    }

    const sorted = Object.entries(score).sort((a, b) => b[1] - a[1]);
    return sorted[0][0] as DocumentCategory;
  }

  static buildMarkdownAST(parsed: ParsedDocument): ASTNode {
    const root: ASTNode = {
      type: 'Document',
      children: [],
      metadata: { paragraphCount: parsed.paragraphs.length },
    };

    for (const p of parsed.paragraphs) {
      const node: ASTNode = {
        type: p.type.charAt(0).toUpperCase() + p.type.slice(1),
        content: p.content,
        index: p.index,
        id: p.id,
        raw: p,
      };

      if (p.type === 'heading' && p.level) {
        node.depth = p.level;
        node.text = p.content;
      }

      if (p.type === 'list') {
        node.items = p.content
          .split('\n')
          .filter((l) => l.trim())
          .map((l, i) => ({
            type: 'ListItem',
            text: l.replace(/^[-*+]\s+|\d+\.\s+/, '').trim(),
            index: i,
          }));
      }

      if (p.type === 'code') {
        const langMatch = p.content.match(/```(\w*)/);
        node.language = langMatch ? langMatch[1] : 'unknown';
        node.code = p.content.replace(/```\w*\n?/g, '').trim();
      }

      if (p.type === ('link' as ParagraphType)) {
        const linkMatch = p.content.match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (linkMatch) {
          node.linkText = linkMatch[1];
          node.url = linkMatch[2];
        }
      }

      root.children.push(node);
    }

    return root;
  }

  static executeRegexRule(
    rule: ComplianceRule,
    parsed: ParsedDocument,
    _category: DocumentCategory
  ): Violation[] {
    if (!rule.patterns || rule.patterns.length === 0) return [];

    const violations: Violation[] = [];
    const allText = parsed.paragraphs.map((p) => p.content).join('\n\n');

    for (const pattern of rule.patterns) {
      const matched = this.testPatternOnDocument(pattern, allText, parsed, rule);
      violations.push(...matched);
    }

    return violations;
  }

  private static testPatternOnDocument(
    pattern: RegexPattern,
    fullText: string,
    parsed: ParsedDocument,
    rule: ComplianceRule
  ): Violation[] {
    const violations: Violation[] = [];
    let regex: RegExp;

    try {
      regex = new RegExp(pattern.pattern, pattern.flags || 'g');
    } catch {
      return [];
    }

    let matchFoundInFullText = false;
    if (!pattern.invert) {
      const testRegex = new RegExp(pattern.pattern, pattern.flags?.replace('g', '') || '');
      matchFoundInFullText = testRegex.test(fullText);
    } else {
      const testRegex = new RegExp(pattern.pattern, pattern.flags?.replace('g', '') || '');
      matchFoundInFullText = !testRegex.test(fullText);
      if (matchFoundInFullText) {
        violations.push(
          this.createViolation(rule, {
            message: `文档缺少符合规则要求的内容：${rule.description}`,
            snippet: fullText.slice(0, 100) + '...',
            paragraphIndex: 0,
          })
        );
        return violations;
      }
      return [];
    }

    if (!matchFoundInFullText && !pattern.invert) {
      const severity = rule.severity;
      const anyMatch = rule.patterns?.some((p) => {
        try {
          const r = new RegExp(p.pattern, p.flags?.replace('g', '') || '');
          return r.test(fullText);
        } catch {
          return false;
        }
      });
      if (!anyMatch && severity === 'critical') {
        violations.push(
          this.createViolation(rule, {
            message: `文档缺少必要内容：${rule.description}`,
            snippet: '全文档检查',
            paragraphIndex: 0,
          })
        );
      }
      return violations;
    }

    for (const paragraph of parsed.paragraphs) {
      const paraViolations = this.testPatternOnParagraph(pattern, regex, paragraph, rule);
      violations.push(...paraViolations);
    }

    return violations;
  }

  private static testPatternOnParagraph(
    pattern: RegexPattern,
    regex: RegExp,
    paragraph: Paragraph,
    rule: ComplianceRule
  ): Violation[] {
    const violations: Violation[] = [];
    const content = paragraph.content;

    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    let count = 0;

    while ((match = regex.exec(content)) !== null && count < 50) {
      count++;

      if (rule.type === 'regex' && paragraph.type === 'code' && !this.isSecurityRule(rule)) {
        continue;
      }

      const matchedText = match[0];
      const charStart = match.index;
      const charEnd = charStart + matchedText.length;
      const snippet = this.extractSnippet(content, charStart, charEnd);

      violations.push(
        this.createViolation(rule, {
          message: `检测到违规内容：${this.summarizeMatch(matchedText, rule)}`,
          paragraphId: paragraph.id,
          paragraphIndex: paragraph.index,
          snippet,
          charStart,
          charEnd,
        })
      );

      if (match.index === regex.lastIndex) {
        regex.lastIndex++;
      }
    }

    return violations;
  }

  private static isSecurityRule(rule: ComplianceRule): boolean {
    const securityKeywords = ['密码', 'password', 'token', '密钥', 'secret', 'ip', '邮箱', 'email'];
    const text = (rule.name + rule.description + (rule.tags?.join(' ') || '')).toLowerCase();
    return securityKeywords.some((kw) => text.includes(kw));
  }

  private static extractSnippet(content: string, charStart: number, charEnd: number): string {
    const padding = 30;
    const start = Math.max(0, charStart - padding);
    const end = Math.min(content.length, charEnd + padding);
    let snippet = content.slice(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < content.length) snippet = snippet + '...';
    return snippet.slice(0, 200);
  }

  private static summarizeMatch(text: string, rule: ComplianceRule): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (this.isSecurityRule(rule)) {
      return clean.slice(0, 3) + '***' + clean.slice(-3);
    }
    return clean.length > 50 ? clean.slice(0, 50) + '...' : clean;
  }

  static executeASTRule(
    rule: ComplianceRule,
    parsed: ParsedDocument,
    category: DocumentCategory
  ): Violation[] {
    void category;
    if (!rule.astConditions || rule.astConditions.length === 0) return [];

    const violations: Violation[] = [];
    const ast = this.buildMarkdownAST(parsed);

    for (const condition of rule.astConditions) {
      const found = this.evaluateASTCondition(ast, condition);
      if (!found) {
        violations.push(
          this.createViolation(rule, {
            message: `文档结构检查失败：${rule.description}`,
            snippet: '文档结构检查',
            paragraphIndex: 0,
          })
        );
      }
    }

    return violations;
  }

  private static evaluateASTCondition(ast: ASTNode, condition: ASTCondition): boolean {
    const matchingNodes = this.findNodesByType(ast, condition.nodeType);

    if (condition.operator === 'exists' || !condition.operator) {
      return matchingNodes.length > 0;
    }

    if (!condition.property) return matchingNodes.length > 0;

    for (const node of matchingNodes) {
      const value = node[condition.property];
      if (value === undefined || value === null) continue;

      switch (condition.operator) {
        case 'equals':
          if (String(value) === condition.value) return true;
          break;
        case 'contains':
          if (condition.value && String(value).toLowerCase().includes(condition.value.toLowerCase())) return true;
          break;
        case 'regex':
          try {
            if (condition.value && new RegExp(condition.value, 'i').test(String(value))) return true;
          } catch {
            continue;
          }
          break;
      }
    }

    return false;
  }

  private static findNodesByType(ast: ASTNode, nodeType: string): ASTNode[] {
    const results: ASTNode[] = [];
    const walk = (node: ASTNode) => {
      if (node.type === nodeType) {
        results.push(node);
      }
      if (node.children) {
        for (const child of node.children) walk(child);
      }
      if (node.items) {
        for (const item of node.items) walk(item);
      }
    };
    walk(ast);
    return results;
  }

  static executeCustomRule(
    rule: ComplianceRule,
    parsed: ParsedDocument,
    category: DocumentCategory
  ): { violations: Violation[]; error?: string; executionTimeMs: number } {
    if (!rule.customScript) {
      return { violations: [], executionTimeMs: 0 };
    }

    const result = SandboxService.execute(
      rule.customScript,
      parsed,
      {
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        category: rule.category,
        fixGuidance: rule.fixGuidance,
      },
      category
    );

    return {
      violations: result.violations,
      error: result.error,
      executionTimeMs: result.executionTimeMs,
    };
  }

  private static createViolation(
    rule: ComplianceRule,
    params: {
      message: string;
      paragraphId?: string;
      paragraphIndex?: number;
      snippet?: string;
      lineStart?: number;
      charStart?: number;
      charEnd?: number;
    }
  ): Violation {
    const location: ViolationLocation = {};
    if (params.paragraphId) location.paragraphId = params.paragraphId;
    if (params.paragraphIndex !== undefined) location.paragraphIndex = params.paragraphIndex;
    if (params.snippet) location.snippet = params.snippet;
    if (params.lineStart !== undefined) location.lineStart = params.lineStart;
    if (params.charStart !== undefined) location.charStart = params.charStart;
    if (params.charEnd !== undefined) location.charEnd = params.charEnd;

    return {
      id: `vio_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      category: rule.category,
      message: params.message,
      fixGuidance: rule.fixGuidance,
      location,
      detectedAt: new Date().toISOString(),
    };
  }

  static scanDocument(
    parsed: ParsedDocument,
    rules: ComplianceRule[],
    documentTitle: string,
    forceCategory?: DocumentCategory
  ): {
    violations: Violation[];
    category: DocumentCategory;
    rulesChecked: number;
    rulesByType: { regex: number; ast: number; custom: number };
    executionErrors: { ruleId: string; ruleName: string; error: string }[];
  } {
    const category = forceCategory || this.detectDocumentCategory(parsed, documentTitle);

    const activeRules = rules.filter((r) => r.status === 'active');

    const applicableRules = activeRules.filter((rule) => {
      return rule.category === 'general' || rule.category === category;
    });

    const violations: Violation[] = [];
    const executionErrors: { ruleId: string; ruleName: string; error: string }[] = [];
    let regexCount = 0, astCount = 0, customCount = 0;

    for (const rule of applicableRules) {
      try {
        switch (rule.type) {
          case 'regex':
            violations.push(...this.executeRegexRule(rule, parsed, category));
            regexCount++;
            break;
          case 'ast':
            violations.push(...this.executeASTRule(rule, parsed, category));
            astCount++;
            break;
          case 'custom': {
            const customResult = this.executeCustomRule(rule, parsed, category);
            violations.push(...customResult.violations);
            if (customResult.error) {
              executionErrors.push({ ruleId: rule.id, ruleName: rule.name, error: customResult.error });
            }
            customCount++;
            break;
          }
        }
      } catch (e) {
        executionErrors.push({
          ruleId: rule.id,
          ruleName: rule.name,
          error: (e as Error).message || '执行错误',
        });
      }
    }

    violations.sort((a, b) => {
      const severityOrder: Record<SeverityLevel, number> = { critical: 0, warning: 1, info: 2 };
      const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (sevDiff !== 0) return sevDiff;
      return (a.location.paragraphIndex ?? 0) - (b.location.paragraphIndex ?? 0);
    });

    return {
      violations,
      category,
      rulesChecked: applicableRules.length,
      rulesByType: { regex: regexCount, ast: astCount, custom: customCount },
      executionErrors,
    };
  }
}
