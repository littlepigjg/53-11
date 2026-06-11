import { Router } from 'express';
import { ComplianceRuleService as RuleService } from '../services/ComplianceRuleService.js';
import { ComplianceScanService } from '../services/ComplianceScanService.js';
import { ComplianceReportService } from '../services/ComplianceReportService.js';

const router = Router();

router.get('/rules', async (req, res, next) => {
  try {
    const { status, category, type, severity, search } = req.query;
    const rules = await RuleService.list({
      status: status as 'active' | 'disabled' | 'draft' | undefined,
      category: category as 'privacy' | 'contract' | 'technical' | 'general' | undefined,
      type: type as 'regex' | 'ast' | 'custom' | undefined,
      severity: severity as 'critical' | 'warning' | 'info' | undefined,
      search: search as string | undefined,
    });
    res.json(rules);
  } catch (e) {
    next(e);
  }
});

router.get('/rules/version', async (_req, res, next) => {
  try {
    const version = await RuleService.getVersion();
    res.json(version);
  } catch (e) {
    next(e);
  }
});

router.get('/rules/:id', async (req, res, next) => {
  try {
    const rule = await RuleService.get(req.params.id);
    if (!rule) {
      res.status(404).json({ error: '规则不存在' });
      return;
    }
    res.json(rule);
  } catch (e) {
    next(e);
  }
});

router.post('/rules', async (req, res, next) => {
  try {
    const rule = await RuleService.create(req.body);
    res.status(201).json(rule);
  } catch (e) {
    next(e);
  }
});

router.patch('/rules/:id', async (req, res, next) => {
  try {
    const rule = await RuleService.update(req.params.id, req.body);
    if (!rule) {
      res.status(404).json({ error: '规则不存在' });
      return;
    }
    res.json(rule);
  } catch (e) {
    next(e);
  }
});

router.delete('/rules/:id', async (req, res, next) => {
  try {
    const ok = await RuleService.remove(req.params.id);
    res.json({ ok });
  } catch (e) {
    next(e);
  }
});

router.post('/rules/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    const rule = await RuleService.toggleStatus(req.params.id, status);
    if (!rule) {
      res.status(404).json({ error: '规则不存在' });
      return;
    }
    res.json(rule);
  } catch (e) {
    next(e);
  }
});

router.post('/rules/:id/duplicate', async (req, res, next) => {
  try {
    const rule = await RuleService.duplicate(req.params.id);
    if (!rule) {
      res.status(404).json({ error: '规则不存在' });
      return;
    }
    res.status(201).json(rule);
  } catch (e) {
    next(e);
  }
});

router.post('/rules/validate-script', async (req, res, next) => {
  try {
    const { script } = req.body;
    const result = await RuleService.validateScript(script || '');
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.post('/rules/reset-builtin', async (_req, res, next) => {
  try {
    const rules = await RuleService.resetToBuiltin();
    res.json({ restored: true, count: rules.length });
  } catch (e) {
    next(e);
  }
});

router.post('/scan/:docId', async (req, res, next) => {
  try {
    const { triggeredBy, category } = req.body || {};
    const scan = await ComplianceScanService.triggerScan(
      req.params.docId,
      triggeredBy || 'manual',
      category
    );
    res.json(scan);
  } catch (e) {
    next(e);
  }
});

router.get('/scan/:docId/latest', async (req, res, next) => {
  try {
    const scan = await ComplianceScanService.getLatestScan(req.params.docId);
    if (!scan) {
      res.status(404).json({ error: '无扫描记录' });
    } else {
      res.json(scan);
    }
  } catch (e) {
    next(e);
  }
});

router.get('/scans', async (req, res, next) => {
  try {
    const { docId, limit } = req.query;
    const scans = await ComplianceScanService.listScans(
      docId as string | undefined,
      limit ? parseInt(limit as string) : undefined
    );
    res.json(scans);
  } catch (e) {
    next(e);
  }
});

router.get('/scan/detail/:scanId', async (req, res, next) => {
  try {
    const scan = await ComplianceScanService.getScan(req.params.scanId);
    if (!scan) {
      res.status(404).json({ error: '扫描不存在' });
      return;
    }
    res.json(scan);
  } catch (e) {
    next(e);
  }
});

router.patch('/scan/:scanId/violations/:violationId/resolve', async (req, res, next) => {
  try {
    const { resolvedBy, note } = req.body || {};
    const scan = await ComplianceScanService.resolveViolation(
      req.params.scanId,
      req.params.violationId,
      resolvedBy || 'admin',
      note
    );
    if (!scan) {
      res.status(404).json({ error: '扫描不存在' });
    } else {
      res.json(scan);
    }
  } catch (e) {
    next(e);
  }
});

router.get('/summary', async (_req, res, next) => {
  try {
    const summary = await ComplianceScanService.getScanSummary();
    res.json(summary);
  } catch (e) {
    next(e);
  }
});

router.get('/monitor', async (_req, res, next) => {
  try {
    const state = await ComplianceScanService.getMonitorState();
    res.json(state);
  } catch (e) {
    next(e);
  }
});

router.post('/monitor/refresh', async (_req, res, next) => {
  try {
    const result = await ComplianceScanService.checkRulesUpdateAndRescan();
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.get('/report/:docId', async (req, res, next) => {
  try {
    const { scanId } = req.query;
    const report = await ComplianceReportService.generateReport(
      req.params.docId,
      scanId as string | undefined
    );
    res.json(report);
  } catch (e) {
    next(e);
  }
});

router.get('/report/:docId/html', async (req, res, next) => {
  try {
    const { scanId } = req.query;
    const report = await ComplianceReportService.generateReport(
      req.params.docId,
      scanId as string | undefined
    );
    const html = ComplianceReportService.generateHTMLReport(report);
    const filename = `合规报告_${report.documentMeta.title}_${report.reportId}.html`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.send(html);
  } catch (e) {
    next(e);
  }
});

router.get('/report/:docId/print', async (req, res, next) => {
  try {
    const { scanId } = req.query;
    const report = await ComplianceReportService.generateReport(
      req.params.docId,
      scanId as string | undefined
    );
    const html = ComplianceReportService.generateHTMLReport(report);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    next(e);
  }
});

export default router;
