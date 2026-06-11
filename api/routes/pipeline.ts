import { Router } from 'express';
import { ComplianceScanService } from '../services/ComplianceScanService.js';

const router = Router();

router.post('/gate/:docId', async (req, res, next) => {
  try {
    const { gateName, failOnCritical, maxWarnings } = req.body || {};
    const result = await ComplianceScanService.runPipelineGate(
      req.params.docId,
      gateName || 'compliance-gate',
      failOnCritical !== false,
      typeof maxWarnings === 'number' ? maxWarnings : 10
    );

    const httpStatus =
      result.status === 'fail' ? 400 : result.status === 'warn' ? 202 : 200;

    res.status(httpStatus).json(result);
  } catch (e) {
    next(e);
  }
});

router.get('/gate/:docId/history', async (req, res, next) => {
  try {
    const results = await ComplianceScanService.getPipelineResults(req.params.docId);
    res.json(results);
  } catch (e) {
    next(e);
  }
});

router.post('/webhook/:docId', async (req, res, next) => {
  try {
    const docId = req.params.docId;
    const { event, payload } = req.body || {};

    let gateResult;
    switch (event) {
      case 'pre-publish':
      case 'pre-release':
      case 'ci-check':
        gateResult = await ComplianceScanService.runPipelineGate(
          docId,
          event,
          true,
          10
        );
        break;
      case 're-scan':
        gateResult = await ComplianceScanService.triggerScan(docId, 'webhook');
        break;
      default:
        gateResult = await ComplianceScanService.runPipelineGate(docId, event || 'webhook-gate');
    }

    const status =
      gateResult && 'status' in gateResult && gateResult.status === 'fail' ? 400 : 200;

    res.status(status).json({
      success: status === 200,
      event: event || 'default',
      docId,
      timestamp: new Date().toISOString(),
      gate: gateResult,
      webhook: {
        received: true,
        payloadSize: JSON.stringify(payload || {}).length,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get('/gate/:docId/badge', async (req, res, next) => {
  try {
    const history = await ComplianceScanService.getPipelineResults(req.params.docId);
    const latest = history[0];

    let status = 'not-checked';
    let color = '#94a3b8';
    let label = '合规检查';

    if (latest) {
      status = latest.status;
      switch (latest.status) {
        case 'pass':
          color = '#10b981';
          label = '合规通过';
          break;
        case 'warn':
          color = '#f59e0b';
          label = '有警告';
          break;
        case 'fail':
          color = '#ef4444';
          label = '合规未通过';
          break;
      }
    }

    const badgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="28" role="img" aria-label="${label}: ${status}">
  <title>${label}: ${status}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="200" height="28" rx="4" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="90" height="28" fill="#555"/>
    <rect x="90" width="110" height="28" fill="${color}"/>
    <rect width="200" height="28" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" text-rendering="geometricPrecision">
    <text x="45" y="18" fill="#fff" font-weight="500">合规状态</text>
    <text x="145" y="18" fill="#fff" font-weight="600">${label}</text>
  </g>
</svg>`;

    res.setHeader('Content-Type', 'image/svg+xml;charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(badgeSvg);
  } catch (e) {
    next(e);
  }
});

export default router;
