import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import type { ComplianceRule, RuleStatus, DocumentCategory, RuleType, SeverityLevel } from '../../shared/types.js';
import { FileStorageService } from './FileStorageService.js';
import { BUILTIN_RULES, createRuleFromTemplate } from './BuiltinRules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const RULES_FILE = path.join(DATA_DIR, 'compliance_rules.json');
const RULES_VERSION_FILE = path.join(DATA_DIR, 'rules_version.json');

export interface RulesVersion {
  version: string;
  updatedAt: string;
  ruleCount: number;
  checksum: string;
}

export class ComplianceRuleService {
  static async ensureInitialized() {
    try {
      await fs.access(RULES_FILE);
    } catch {
      await this.resetToBuiltin();
    }
    await this.ensureVersionFile();
  }

  private static async ensureVersionFile() {
    try {
      await fs.access(RULES_VERSION_FILE);
    } catch {
      await this.updateVersion();
    }
  }

  private static async updateVersion() {
    const rules = await this.listAllInternal();
    const version: RulesVersion = {
      version: Date.now().toString(36),
      updatedAt: new Date().toISOString(),
      ruleCount: rules.length,
      checksum: this.computeChecksum(rules),
    };
    await FileStorageService.writeJson(RULES_VERSION_FILE, version);
  }

  private static computeChecksum(rules: ComplianceRule[]): string {
    const data = rules
      .map((r) => `${r.id}:${r.version}:${r.updatedAt}`)
      .sort()
      .join('|');
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36);
  }

  private static async listAllInternal(): Promise<ComplianceRule[]> {
    const rules = await FileStorageService.readJson<ComplianceRule[]>(RULES_FILE, []);

    const withBuiltins = [...rules];
    for (const builtin of BUILTIN_RULES) {
      if (!rules.some((r) => r.id === builtin.id)) {
        withBuiltins.push(builtin);
      }
    }

    return withBuiltins;
  }

  static async getVersion(): Promise<RulesVersion> {
    await this.ensureInitialized();
    try {
      return await FileStorageService.readJson<RulesVersion>(RULES_VERSION_FILE, {
        version: 'initial',
        updatedAt: new Date().toISOString(),
        ruleCount: 0,
        checksum: '0',
      });
    } catch {
      return { version: 'initial', updatedAt: new Date().toISOString(), ruleCount: 0, checksum: '0' };
    }
  }

  static async resetToBuiltin(): Promise<ComplianceRule[]> {
    await FileStorageService.writeJson(RULES_FILE, []);
    await this.updateVersion();
    return this.listAllInternal();
  }

  static async list(params?: {
    status?: RuleStatus;
    category?: DocumentCategory;
    type?: RuleType;
    severity?: SeverityLevel;
    search?: string;
  }): Promise<ComplianceRule[]> {
    await this.ensureInitialized();
    let rules = await this.listAllInternal();

    if (params) {
      if (params.status) rules = rules.filter((r) => r.status === params.status);
      if (params.category) rules = rules.filter((r) => r.category === params.category);
      if (params.type) rules = rules.filter((r) => r.type === params.type);
      if (params.severity) rules = rules.filter((r) => r.severity === params.severity);
      if (params.search) {
        const q = params.search.toLowerCase();
        rules = rules.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            r.description.toLowerCase().includes(q) ||
            (r.tags?.some((t) => t.toLowerCase().includes(q)) ?? false)
        );
      }
    }

    return rules.sort((a, b) => {
      const catOrder: Record<DocumentCategory, number> = { privacy: 0, contract: 1, technical: 2, general: 3 };
      const sevOrder: Record<SeverityLevel, number> = { critical: 0, warning: 1, info: 2 };
      const catDiff = catOrder[a.category] - catOrder[b.category];
      if (catDiff !== 0) return catDiff;
      return sevOrder[a.severity] - sevOrder[b.severity];
    });
  }

  static async get(id: string): Promise<ComplianceRule | null> {
    await this.ensureInitialized();
    const rules = await this.listAllInternal();
    return rules.find((r) => r.id === id) || null;
  }

  static async create(data: Partial<ComplianceRule>): Promise<ComplianceRule> {
    await this.ensureInitialized();
    const rules = await FileStorageService.readJson<ComplianceRule[]>(RULES_FILE, []);
    const newRule = createRuleFromTemplate(data);
    rules.push(newRule);
    await FileStorageService.writeJson(RULES_FILE, rules);
    await this.updateVersion();
    return newRule;
  }

  static async update(id: string, data: Partial<ComplianceRule>): Promise<ComplianceRule | null> {
    await this.ensureInitialized();
    const rules = await FileStorageService.readJson<ComplianceRule[]>(RULES_FILE, []);
    const idx = rules.findIndex((r) => r.id === id);
    if (idx < 0) {
      const builtinIdx = BUILTIN_RULES.findIndex((r) => r.id === id);
      if (builtinIdx >= 0) {
        const original = BUILTIN_RULES[builtinIdx];
        const updated = {
          ...original,
          ...data,
          id: original.id,
          isBuiltin: true,
          version: original.version + 1,
          updatedAt: new Date().toISOString(),
        };
        rules.push(updated);
        await FileStorageService.writeJson(RULES_FILE, rules);
        await this.updateVersion();
        return updated;
      }
      return null;
    }
    const updated = {
      ...rules[idx],
      ...data,
      version: rules[idx].version + 1,
      updatedAt: new Date().toISOString(),
    };
    rules[idx] = updated;
    await FileStorageService.writeJson(RULES_FILE, rules);
    await this.updateVersion();
    return updated;
  }

  static async remove(id: string): Promise<boolean> {
    await this.ensureInitialized();
    if (BUILTIN_RULES.some((r) => r.id === id)) {
      const rules = await FileStorageService.readJson<ComplianceRule[]>(RULES_FILE, []);
      const filtered = rules.filter((r) => r.id !== id);
      filtered.push({
        ...(BUILTIN_RULES.find((r) => r.id === id)!),
        status: 'disabled',
        updatedAt: new Date().toISOString(),
      });
      await FileStorageService.writeJson(RULES_FILE, filtered);
      await this.updateVersion();
      return true;
    }

    const rules = await FileStorageService.readJson<ComplianceRule[]>(RULES_FILE, []);
    const idx = rules.findIndex((r) => r.id === id);
    if (idx < 0) return false;
    rules.splice(idx, 1);
    await FileStorageService.writeJson(RULES_FILE, rules);
    await this.updateVersion();
    return true;
  }

  static async toggleStatus(id: string, status: RuleStatus): Promise<ComplianceRule | null> {
    return this.update(id, { status });
  }

  static async duplicate(id: string): Promise<ComplianceRule | null> {
    const original = await this.get(id);
    if (!original) return null;
    const copy = createRuleFromTemplate({
      ...original,
      id: undefined,
      name: `${original.name} (副本)`,
      isBuiltin: false,
      status: 'draft',
      version: 1,
    });
    const rules = await FileStorageService.readJson<ComplianceRule[]>(RULES_FILE, []);
    rules.push(copy);
    await FileStorageService.writeJson(RULES_FILE, rules);
    await this.updateVersion();
    return copy;
  }

  static async validateScript(script: string): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
    const { SandboxService } = await import('./SandboxService.js');
    return SandboxService.validateScript(script);
  }
}
