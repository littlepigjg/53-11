import { useState, useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Code,
  FileCheck,
  AlertCircle,
  Check,
  X,
  Plus,
  Trash2,
  Play,
  Copy,
  Tag,
  Settings,
  Eye,
  ShieldAlert,
  AlertTriangle,
  Info,
  FileText,
  TestTube,
  Save,
  LayoutTemplate,
} from 'lucide-react';
import type {
  ComplianceRule,
  RegexPattern,
  ASTCondition,
  RuleType,
  SeverityLevel,
  DocumentCategory,
  RuleStatus,
} from '../types';
import { complianceApi } from '../utils/api';

type IconComponent = LucideIcon;

interface RuleEditorProps {
  ruleId?: string;
  initialData?: Partial<ComplianceRule>;
  onSave: (rule: ComplianceRule) => void;
  onCancel: () => void;
}

const categoryOptions: { value: DocumentCategory; label: string }[] = [
  { value: 'privacy', label: '隐私' },
  { value: 'contract', label: '合同' },
  { value: 'technical', label: '技术' },
  { value: 'general', label: '通用' },
];

const severityConfig: Record<SeverityLevel, { label: string; icon: IconComponent; activeClass: string; badgeClass: string }> = {
  critical: {
    label: '严重',
    icon: ShieldAlert,
    activeClass: 'bg-red-600 text-white border-red-600',
    badgeClass: 'bg-red-100 text-red-700 border-red-200',
  },
  warning: {
    label: '警告',
    icon: AlertTriangle,
    activeClass: 'bg-amber-500 text-white border-amber-500',
    badgeClass: 'bg-amber-100 text-amber-700 border-amber-200',
  },
  info: {
    label: '提示',
    icon: Info,
    activeClass: 'bg-blue-500 text-white border-blue-500',
    badgeClass: 'bg-blue-100 text-blue-700 border-blue-200',
  },
};

const ruleTypeOptions: { value: RuleType; label: string; icon: IconComponent; desc: string }[] = [
  { value: 'regex', label: '正则匹配', icon: FileCheck, desc: '使用正则表达式匹配文本模式' },
  { value: 'ast', label: 'AST 规则', icon: Code, desc: '基于文档语法树节点进行匹配' },
  { value: 'custom', label: '自定义脚本', icon: LayoutTemplate, desc: '编写 JavaScript 脚本灵活检测' },
];

const astNodeTypes = [
  'Heading',
  'Paragraph',
  'Code',
  'List',
  'ListItem',
  'Table',
  'TableRow',
  'TableCell',
  'Quote',
  'Link',
  'Image',
  'Emphasis',
  'Strong',
];

const astOperators: ASTCondition['operator'][] = ['equals', 'contains', 'regex', 'exists'];

const regexFlags = ['g', 'i', 'gi', 'm', 'gm', 'im', 'gim'];

const scriptTemplates = [
  {
    name: '硬编码密码检测',
    script: `// 检测硬编码的密码、密钥等敏感信息
export function check(ctx) {
  const { document, helpers, addViolation } = ctx;
  
  const sensitivePatterns = [
    /password\\s*[:=]\\s*['"]([^'"]+)['"]/gi,
    /api[_-]?key\\s*[:=]\\s*['"]([^'"]+)['"]/gi,
    /secret\\s*[:=]\\s*['"]([^'"]+)['"]/gi,
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  ];
  
  for (const paragraph of document.paragraphs) {
    for (const pattern of sensitivePatterns) {
      const matches = helpers.matchAll(paragraph.content, pattern);
      for (const match of matches) {
        addViolation({
          ruleId: null,
          message: '检测到疑似硬编码敏感信息',
          location: { paragraphId: paragraph.id },
          severity: 'critical'
        });
      }
    }
  }
}`,
  },
  {
    name: '标题完整性检查',
    script: `// 检查文档标题结构是否完整
export function check(ctx) {
  const { document, helpers, addViolation } = ctx;
  
  const headings = document.paragraphs.filter(p => p.type === 'heading');
  
  // 检查是否有顶级标题
  const h1 = headings.filter(h => h.level === 1);
  if (h1.length === 0) {
    addViolation({
      message: '文档缺少 H1 顶级标题',
      severity: 'warning'
    });
  }
  if (h1.length > 1) {
    addViolation({
      message: \`文档包含 \${h1.length} 个 H1 标题，建议只有一个\`,
      severity: 'info'
    });
  }
  
  // 检查标题级别是否跳跃
  let prevLevel = 0;
  for (const h of headings) {
    const lvl = h.level || 1;
    if (prevLevel > 0 && lvl > prevLevel + 1) {
      addViolation({
        message: \`标题级别跳跃: H\${prevLevel} → H\${lvl}\`,
        location: { paragraphId: h.id },
        severity: 'info'
      });
    }
    prevLevel = lvl;
  }
}`,
  },
  {
    name: '合同条款检查',
    script: `// 合同文档关键条款完整性检查
export function check(ctx) {
  const { document, helpers, addViolation } = ctx;
  
  const requiredClauses = [
    { keywords: ['保密', '保密协议', 'NDA'], name: '保密条款' },
    { keywords: ['违约', '违约责任', '违约金'], name: '违约责任条款' },
    { keywords: ['争议解决', '管辖', '仲裁', '诉讼'], name: '争议解决条款' },
    { keywords: ['期限', '有效期', '终止'], name: '合同期限条款' },
    { keywords: ['签署', '签字', '盖章', '签订'], name: '签署条款' },
  ];
  
  const fullText = document.paragraphs.map(p => p.content).join('\\n');
  
  for (const clause of requiredClauses) {
    const found = clause.keywords.some(kw => 
      fullText.includes(kw)
    );
    if (!found) {
      addViolation({
        message: \`建议添加「\${clause.name}」\`,
        severity: 'warning'
      });
    }
  }
}`,
  },
];

const apiHelpText = `可用 API 说明:
• ctx.document - 当前文档对象，包含 paragraphs 数组
  - paragraph: { id, type, level, content, rawHtml }
• ctx.helpers - 辅助函数集合
  - matchAll(text, regex): 返回所有匹配结果
  - escapeRegExp(str): 转义正则特殊字符
  - countMatches(text, pattern): 统计匹配次数
• addViolation({ message, location, severity }) - 添加违规记录
  - location: { paragraphId, lineStart, lineEnd, snippet }
  - severity: 'critical' | 'warning' | 'info'`;

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

export function RuleEditor({ ruleId, initialData, onSave, onCancel }: RuleEditorProps) {
  const [name, setName] = useState(initialData?.name || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [category, setCategory] = useState<DocumentCategory>(initialData?.category || 'general');
  const [severity, setSeverity] = useState<SeverityLevel>(initialData?.severity || 'warning');
  const [type, setType] = useState<RuleType>(initialData?.type || 'regex');
  const [status, setStatus] = useState<RuleStatus>(initialData?.status || 'active');
  const [tags, setTags] = useState<string[]>(initialData?.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [patterns, setPatterns] = useState<RegexPattern[]>(
    initialData?.patterns?.length ? initialData.patterns : [{ pattern: '', flags: 'g', invert: false }]
  );
  const [astConditions, setAstConditions] = useState<ASTCondition[]>(
    initialData?.astConditions?.length
      ? initialData.astConditions
      : [{ nodeType: 'Paragraph', operator: 'contains', property: 'content', value: '' }]
  );
  const [customScript, setCustomScript] = useState(
    initialData?.customScript ||
      `// 自定义规则脚本示例
export function check(ctx) {
  const { document, addViolation } = ctx;
  
  // TODO: 在此编写检测逻辑
  for (const paragraph of document.paragraphs) {
    // 示例: 检测内容为空的段落
  }
}`
  );
  const [fixGuidance, setFixGuidance] = useState(initialData?.fixGuidance || '');

  const [showTestModal, setShowTestModal] = useState(false);
  const [testText, setTestText] = useState('');
  const [testResults, setTestResults] = useState<{ matched: boolean; matchCount: number; samples: string[] } | null>(null);

  const [validatingScript, setValidatingScript] = useState(false);
  const [scriptValidation, setScriptValidation] = useState<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  } | null>(null);

  const [nameError, setNameError] = useState<string>('');

  const isEditMode = Boolean(ruleId);

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) {
      setTags([...tags, t]);
    }
    setTagInput('');
  };

  const removeTag = (t: string) => {
    setTags(tags.filter((x) => x !== t));
  };

  const addPattern = () => {
    setPatterns([...patterns, { pattern: '', flags: 'g', invert: false }]);
  };

  const removePattern = (i: number) => {
    if (patterns.length > 1) {
      setPatterns(patterns.filter((_, idx) => idx !== i));
    }
  };

  const updatePattern = (i: number, patch: Partial<RegexPattern>) => {
    setPatterns(patterns.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  };

  const addAstCondition = () => {
    setAstConditions([
      ...astConditions,
      { nodeType: 'Paragraph', operator: 'contains', property: 'content', value: '' },
    ]);
  };

  const removeAstCondition = (i: number) => {
    if (astConditions.length > 1) {
      setAstConditions(astConditions.filter((_, idx) => idx !== i));
    }
  };

  const updateAstCondition = (i: number, patch: Partial<ASTCondition>) => {
    setAstConditions(astConditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };

  const runRegexTest = () => {
    if (!testText.trim()) {
      setTestResults({ matched: false, matchCount: 0, samples: [] });
      return;
    }
    let matchCount = 0;
    const samples: string[] = [];
    try {
      for (const p of patterns) {
        if (!p.pattern.trim()) continue;
        const regex = new RegExp(p.pattern, p.flags || 'g');
        const matches = testText.match(regex);
        if (matches) {
          if (p.invert) {
            // invert 模式：如果匹配到则视为不通过
          } else {
            matchCount += matches.length;
            for (const m of matches.slice(0, 3)) {
              samples.push(m.length > 60 ? m.slice(0, 60) + '...' : m);
            }
          }
        } else if (p.invert) {
          matchCount += 1;
          samples.push('(反向匹配: 未发现模式，通过)');
        }
      }
      setTestResults({ matched: matchCount > 0, matchCount, samples });
    } catch (e) {
      setTestResults({ matched: false, matchCount: 0, samples: ['错误: ' + (e as Error).message] });
    }
  };

  const validateCustomScript = async () => {
    setValidatingScript(true);
    setScriptValidation(null);
    try {
      const res = await complianceApi.rules.validateScript(customScript);
      setScriptValidation(res);
    } catch (e) {
      setScriptValidation({ valid: false, errors: [(e as Error).message || '验证请求失败'], warnings: [] });
    } finally {
      setValidatingScript(false);
    }
  };

  const applyTemplate = (idx: number) => {
    setCustomScript(scriptTemplates[idx].script);
    setScriptValidation(null);
  };

  const copyJsonPreview = () => {
    navigator.clipboard?.writeText(jsonPreview);
  };

  const buildRule = (): ComplianceRule | null => {
    if (!name.trim()) {
      setNameError('规则名称不能为空');
      return null;
    }
    setNameError('');

    const now = new Date().toISOString();
    const base: ComplianceRule = {
      id: ruleId || genId(),
      name: name.trim(),
      description: description.trim(),
      type,
      severity,
      category,
      status,
      version: initialData?.version || 1,
      createdAt: initialData?.createdAt || now,
      updatedAt: now,
      fixGuidance: fixGuidance.trim(),
      tags,
      isBuiltin: false,
    };

    if (type === 'regex') {
      base.patterns = patterns.filter((p) => p.pattern.trim());
    } else if (type === 'ast') {
      base.astConditions = astConditions.filter((c) => c.nodeType);
    } else if (type === 'custom') {
      base.customScript = customScript;
    }

    return base;
  };

  const jsonPreview = useMemo(() => {
    const rule = buildRule();
    if (!rule) {
      return '{\n  // 请先填写规则名称\n}';
    }
    const disp: Partial<ComplianceRule> & { id?: string } = { ...rule };
    if (!ruleId) {
      disp.id = '<auto-generated>';
    }
    return JSON.stringify(disp, null, 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, description, category, severity, type, status, tags, patterns, astConditions, customScript, fixGuidance]);

  const handleSave = () => {
    const rule = buildRule();
    if (rule) {
      onSave(rule);
    }
  };

  const handleTestRule = async () => {
    const rule = buildRule();
    if (!rule) return;
    alert('规则测试:\n\n' + JSON.stringify(rule, null, 2).slice(0, 500));
  };

  const scriptLines = customScript.split('\n').length;

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">
              {isEditMode ? '编辑规则' : '新建规则'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {isEditMode ? `规则 ID: ${ruleId}` : '创建一条新的合规检查规则'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <X size={14} /> 取消
            </button>
            <button
              onClick={handleTestRule}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#1e3a5f] bg-white px-4 py-2 text-sm font-medium text-[#1e3a5f] hover:bg-[#1e3a5f]/5"
            >
              <TestTube size={14} /> 测试规则
            </button>
            <button
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2e4e7a]"
            >
              <Save size={14} /> 保存规则
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-6 p-6">
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <FileText size={16} className="text-[#1e3a5f]" />
                <h3 className="text-base font-semibold text-slate-800">基本信息</h3>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    规则名称 <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (e.target.value.trim()) setNameError('');
                    }}
                    placeholder="例如：检测硬编码密码"
                    className={`w-full rounded-md border px-3 py-2 text-sm focus:border-[#1e3a5f] focus:outline-none ${
                      nameError ? 'border-red-300 focus:border-red-500' : 'border-slate-200'
                    }`}
                  />
                  {nameError && (
                    <p className="mt-1 text-xs text-red-500">{nameError}</p>
                  )}
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600">规则描述</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="描述规则的用途、检测目标等"
                    className="w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-[#1e3a5f] focus:outline-none"
                    rows={3}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">适用文档类别</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as DocumentCategory)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[#1e3a5f] focus:outline-none"
                  >
                    {categoryOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">状态</label>
                  <div className="flex h-[38px] items-center justify-between rounded-md border border-slate-200 px-3">
                    <span className="text-sm text-slate-700">
                      {status === 'active' ? '启用' : status === 'disabled' ? '禁用' : '草稿'}
                    </span>
                    <button
                      onClick={() => setStatus(status === 'active' ? 'disabled' : 'active')}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        status === 'active' ? 'bg-[#1e3a5f]' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          status === 'active' ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <label className="mb-2 block text-xs font-medium text-slate-600">严重级别</label>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(severityConfig) as SeverityLevel[]).map((lv) => {
                    const cfg = severityConfig[lv];
                    const Icon = cfg.icon;
                    const active = severity === lv;
                    return (
                      <button
                        key={lv}
                        onClick={() => setSeverity(lv)}
                        className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-all ${
                          active ? cfg.activeClass : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <Icon size={14} /> {cfg.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4">
                <label className="mb-2 block text-xs font-medium text-slate-600">规则类型</label>
                <div className="grid grid-cols-3 gap-2">
                  {ruleTypeOptions.map((opt) => {
                    const Icon = opt.icon;
                    const active = type === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setType(opt.value)}
                        className={`flex flex-col items-start gap-1 rounded-md border px-3 py-2.5 text-left transition-all ${
                          active
                            ? 'border-[#1e3a5f] bg-[#1e3a5f]/5 text-[#1e3a5f]'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-sm font-medium">
                          <Icon size={14} /> {opt.label}
                        </div>
                        <p className="text-[11px] leading-snug text-slate-500">{opt.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-xs font-medium text-slate-600">标签</label>
                <div className="flex flex-wrap gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 focus-within:border-[#1e3a5f]">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 rounded-md bg-[#1e3a5f]/10 px-2 py-0.5 text-xs text-[#1e3a5f]"
                    >
                      <Tag size={10} />
                      {t}
                      <button onClick={() => removeTag(t)} className="ml-0.5 text-[#1e3a5f]/60 hover:text-[#1e3a5f]">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag();
                      }
                      if (e.key === 'Backspace' && !tagInput && tags.length) {
                        setTags(tags.slice(0, -1));
                      }
                    }}
                    onBlur={addTag}
                    placeholder="输入标签后按回车"
                    className="min-w-[120px] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-slate-400"
                  />
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <Settings size={16} className="text-[#1e3a5f]" />
                <h3 className="text-base font-semibold text-slate-800">规则配置</h3>
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  {ruleTypeOptions.find((o) => o.value === type)?.label}
                </span>
              </div>

              {type === 'regex' && (
                <div className="space-y-3">
                  {patterns.map((p, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-slate-200 bg-slate-50/50 p-3"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-500">规则 #{i + 1}</span>
                        {patterns.length > 1 && (
                          <button
                            onClick={() => removePattern(i)}
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
                        <div className="md:col-span-7">
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Pattern</label>
                          <input
                            value={p.pattern}
                            onChange={(e) => updatePattern(i, { pattern: e.target.value })}
                            placeholder="如: password\\s*[:=]"
                            className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs focus:border-[#1e3a5f] focus:outline-none"
                          />
                        </div>
                        <div className="md:col-span-3">
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">Flags</label>
                          <select
                            value={p.flags || 'g'}
                            onChange={(e) => updatePattern(i, { flags: e.target.value })}
                            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-[#1e3a5f] focus:outline-none"
                          >
                            {regexFlags.map((f) => (
                              <option key={f} value={f}>
                                {f || '(none)'}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex items-end md:col-span-2">
                          <label className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 cursor-pointer hover:bg-slate-50 w-full justify-center">
                            <input
                              type="checkbox"
                              checked={!!p.invert}
                              onChange={(e) => updatePattern(i, { invert: e.target.checked })}
                              className="rounded border-slate-300 text-[#1e3a5f] focus:ring-[#1e3a5f]"
                            />
                            反向匹配
                          </label>
                        </div>
                      </div>
                    </div>
                  ))}

                  <div className="flex gap-2">
                    <button
                      onClick={addPattern}
                      className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 hover:border-[#1e3a5f] hover:text-[#1e3a5f]"
                    >
                      <Plus size={12} /> 添加规则
                    </button>
                    <button
                      onClick={() => setShowTestModal(true)}
                      className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
                    >
                      <Play size={12} /> 测试匹配
                    </button>
                  </div>
                </div>
              )}

              {type === 'ast' && (
                <div className="space-y-3">
                  {astConditions.map((c, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-500">条件 #{i + 1}</span>
                        {astConditions.length > 1 && (
                          <button
                            onClick={() => removeAstCondition(i)}
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-12">
                        <div className="md:col-span-3">
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">节点类型</label>
                          <select
                            value={c.nodeType}
                            onChange={(e) => updateAstCondition(i, { nodeType: e.target.value })}
                            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-[#1e3a5f] focus:outline-none"
                          >
                            {astNodeTypes.map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="md:col-span-3">
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">属性</label>
                          <select
                            value={c.property || 'content'}
                            onChange={(e) => updateAstCondition(i, { property: e.target.value })}
                            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-[#1e3a5f] focus:outline-none"
                          >
                            <option value="content">content</option>
                            <option value="level">level</option>
                            <option value="type">type</option>
                            <option value="id">id</option>
                            <option value="index">index</option>
                          </select>
                        </div>
                        <div className="md:col-span-3">
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">操作符</label>
                          <select
                            value={c.operator || 'contains'}
                            onChange={(e) =>
                              updateAstCondition(i, { operator: e.target.value as ASTCondition['operator'] })
                            }
                            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-[#1e3a5f] focus:outline-none"
                          >
                            {astOperators.map((op) => (
                              <option key={op} value={op}>
                                {op}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="md:col-span-3">
                          <label className="mb-1 block text-[11px] font-medium text-slate-500">预期值</label>
                          <input
                            value={c.value || ''}
                            onChange={(e) => updateAstCondition(i, { value: e.target.value })}
                            placeholder={c.operator === 'exists' ? '(可选)' : '值 / 正则'}
                            disabled={c.operator === 'exists'}
                            className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-[#1e3a5f] focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={addAstCondition}
                    className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 hover:border-[#1e3a5f] hover:text-[#1e3a5f]"
                  >
                    <Plus size={12} /> 添加条件
                  </button>
                </div>
              )}

              {type === 'custom' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-500">预置模板:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {scriptTemplates.map((tpl, i) => (
                        <button
                          key={i}
                          onClick={() => applyTemplate(i)}
                          className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-[#1e3a5f] hover:text-white"
                        >
                          <LayoutTemplate size={10} /> {tpl.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-lg border border-slate-200" style={{ background: '#1e293b' }}>
                    <div className="flex items-center justify-between border-b border-slate-700 px-3 py-1.5">
                      <div className="flex items-center gap-1.5 text-xs text-slate-400">
                        <Code size={12} /> custom-script.js
                      </div>
                      <button
                        onClick={validateCustomScript}
                        disabled={validatingScript}
                        className="inline-flex items-center gap-1 rounded bg-slate-700 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-60"
                      >
                        <Check size={10} /> {validatingScript ? '检查中…' : '脚本语法检查'}
                      </button>
                    </div>
                    <div className="flex" style={{ lineHeight: '1.55' }}>
                      <div
                        className="select-none border-r border-slate-700 py-3 pr-3 pl-3 text-right text-xs"
                        style={{ color: '#475569', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                      >
                        {Array.from({ length: scriptLines }, (_, i) => (
                          <div key={i}>{i + 1}</div>
                        ))}
                      </div>
                      <textarea
                        value={customScript}
                        onChange={(e) => {
                          setCustomScript(e.target.value);
                          setScriptValidation(null);
                        }}
                        spellCheck={false}
                        className="flex-1 resize-none p-3 text-xs outline-none"
                        style={{
                          background: '#1e293b',
                          color: '#e2e8f0',
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          minHeight: '320px',
                        }}
                      />
                    </div>
                  </div>

                  {scriptValidation && (
                    <div
                      className={`rounded-lg border p-3 text-xs ${
                        scriptValidation.valid
                          ? 'border-emerald-200 bg-emerald-50/60 text-emerald-800'
                          : 'border-red-200 bg-red-50/60 text-red-800'
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-1 font-medium">
                        {scriptValidation.valid ? (
                          <>
                            <Check size={12} /> 脚本验证通过
                          </>
                        ) : (
                          <>
                            <AlertCircle size={12} /> 脚本存在问题
                          </>
                        )}
                      </div>
                      {scriptValidation.errors.length > 0 && (
                        <ul className="ml-5 list-disc space-y-0.5">
                          {scriptValidation.errors.map((e, i) => (
                            <li key={`e${i}`}>错误: {e}</li>
                          ))}
                        </ul>
                      )}
                      {scriptValidation.warnings.length > 0 && (
                        <ul className="ml-5 list-disc space-y-0.5 mt-1 text-amber-700">
                          {scriptValidation.warnings.map((w, i) => (
                            <li key={`w${i}`}>警告: {w}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
                      <Info size={12} /> 可用 API
                    </div>
                    <pre
                      className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600"
                      style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                    >
                      {apiHelpText}
                    </pre>
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <AlertCircle size={16} className="text-[#1e3a5f]" />
                <h3 className="text-base font-semibold text-slate-800">修复指引</h3>
              </div>
              <textarea
                value={fixGuidance}
                onChange={(e) => setFixGuidance(e.target.value)}
                placeholder="当规则触发时，向用户展示的修复建议。例如：\n1. 请将硬编码密码提取到环境变量配置中\n2. 参考密钥管理方案：https://..."
                className="w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-[#1e3a5f] focus:outline-none"
                rows={5}
              />
            </section>
          </div>
        </div>

        <aside className="w-[420px] shrink-0 border-l border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eye size={16} className="text-[#1e3a5f]" />
                <h3 className="text-sm font-semibold text-slate-800">规则 JSON 预览</h3>
              </div>
              <button
                onClick={copyJsonPreview}
                className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              >
                <Copy size={12} /> 复制
              </button>
            </div>
          </div>
          <div className="p-5" style={{ height: 'calc(100% - 57px)' }}>
            <div
              className="h-full overflow-auto rounded-lg p-4"
              style={{ background: '#1e293b' }}
            >
              <pre
                className="text-xs leading-relaxed"
                style={{
                  color: '#cbd5e1',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {jsonPreview}
              </pre>
            </div>
          </div>
        </aside>
      </div>

      {showTestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="text-sm font-semibold text-slate-800">正则匹配测试</h3>
              <button
                onClick={() => {
                  setShowTestModal(false);
                  setTestResults(null);
                }}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">样本文本</label>
                <textarea
                  value={testText}
                  onChange={(e) => setTestText(e.target.value)}
                  placeholder="粘贴要测试的文档内容..."
                  className="w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-[#1e3a5f] focus:outline-none"
                  rows={8}
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={runRegexTest}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#2e4e7a]"
                >
                  <Play size={14} /> 运行测试
                </button>
              </div>

              {testResults && (
                <div
                  className={`rounded-lg border p-4 ${
                    testResults.matched
                      ? 'border-emerald-200 bg-emerald-50/60'
                      : 'border-slate-200 bg-slate-50/60'
                  }`}
                >
                  <div className="mb-2 flex items-center gap-2">
                    {testResults.matched ? (
                      <>
                        <Check size={16} className="text-emerald-600" />
                        <span className="text-sm font-medium text-emerald-800">
                          匹配成功 · {testResults.matchCount} 处命中
                        </span>
                      </>
                    ) : (
                      <>
                        <X size={16} className="text-slate-500" />
                        <span className="text-sm font-medium text-slate-600">未匹配任何内容</span>
                      </>
                    )}
                  </div>
                  {testResults.samples.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs font-medium text-slate-500">匹配片段示例:</p>
                      {testResults.samples.map((s, i) => (
                        <div
                          key={i}
                          className="rounded bg-white px-2 py-1 font-mono text-xs text-slate-700"
                        >
                          {s}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-right">
              <button
                onClick={() => {
                  setShowTestModal(false);
                  setTestResults(null);
                }}
                className="rounded-md bg-slate-200 px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-300"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
