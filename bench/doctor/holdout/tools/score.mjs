// Pure scoring, coverage and gate logic for the independent holdout. No file or process access.
// The matching and gate rules here are part of the pre-registered protocol: the lock records this
// file's digest, so they cannot change after labels exist.
import {
  NEGATIVE_VERDICTS, POSITIVE_VERDICTS, ToolError, fail, isDash, lowerBound, sha256, upperBound,
} from './lib.mjs';

export const auditId = (repo, index) => `A${sha256(`${repo}#${index}`).slice(0, 12)}`;
const isDefectSeverity = (severity) => severity === 'warning' || severity === 'error';

/** A finding matches an opportunity of the same repository, category and claim id when its evidence agrees. */
export function matches(opportunity, finding) {
  if (opportunity.claim_id !== finding.id || opportunity.category !== finding.category) return false;
  const evidence = finding.evidence ?? [];
  if (!isDash(opportunity.match_key) && !String(finding.title).includes(opportunity.match_key)) return false;
  if (!isDash(opportunity.anchor_path) && !evidence.some((e) => e.path === opportunity.anchor_path)) return false;
  if (isDash(opportunity.match_key) && !isDash(opportunity.anchor_line)
    && !evidence.some((e) => e.path === opportunity.anchor_path && e.line === Number(opportunity.anchor_line))) return false;
  return true;
}

/** Two selectors overlap when some finding could satisfy both. Overlapping opportunities are refused at the lock. */
export function selectorsOverlap(a, b) {
  if (a.repo !== b.repo || a.claim_id !== b.claim_id || a.category !== b.category) return false;
  const either = (x, y) => isDash(x) || isDash(y) || x === y;
  if (!either(a.anchor_path, b.anchor_path)) return false;
  if (!(isDash(a.match_key) || isDash(b.match_key) || a.match_key === b.match_key || a.match_key.includes(b.match_key) || b.match_key.includes(a.match_key))) return false;
  if (isDash(a.match_key) && isDash(b.match_key) && !either(a.anchor_line, b.anchor_line)) return false;
  return true;
}

export function findOverlaps(rows) {
  const determinate = rows.filter((r) => r.verdict !== 'unsupported');
  const found = [];
  for (let i = 0; i < determinate.length; i += 1) {
    for (let j = i + 1; j < determinate.length; j += 1) {
      if (selectorsOverlap(determinate[i], determinate[j])) found.push([determinate[i].opportunity_id, determinate[j].opportunity_id]);
    }
  }
  return found;
}

export function assign(rows, reports) {
  const opportunities = rows.map((row) => ({ ...row, finding: null, findingIndex: 0 }));
  const unmatched = [];
  const duplicates = [];
  for (const [repo, report] of reports) {
    const own = opportunities.filter((o) => o.repo === repo && o.verdict !== 'unsupported');
    report.findings.forEach((finding, index) => {
      const candidates = own.filter((o) => matches(o, finding));
      if (candidates.length > 1) fail(`Overlapping selectors for ${repo} finding ${index + 1}: ${candidates.map((c) => c.opportunity_id).join(', ')}`);
      if (candidates.length === 0) unmatched.push({ repo, index: index + 1, finding });
      else if (!candidates[0].finding) { candidates[0].finding = finding; candidates[0].findingIndex = index + 1; }
      else duplicates.push({ repo, index: index + 1, of: candidates[0].opportunity_id, finding });
    });
  }
  return { opportunities, unmatched, duplicates };
}

export function outcomeOf(o) {
  if (o.verdict === 'ambiguous' || o.verdict === 'unsupported') return o.verdict;
  if (POSITIVE_VERDICTS.has(o.verdict)) return o.finding ? 'TP' : 'FN';
  return o.finding ? 'FP' : 'TN';
}

/** Does the emitted evidence identify the labeled source? Whole-file or whole-repository labels need only valid paths. */
export function evidenceCorrect(o, finding, listing) {
  const evidence = finding.evidence ?? [];
  const known = (p) => !listing || listing.has(p) || [...listing].some((q) => q.startsWith(`${p}/`));
  if (!evidence.every((e) => typeof e.path === 'string' && known(e.path))) return false;
  if (isDash(o.anchor_path)) return true;
  const atPath = evidence.filter((e) => e.path === o.anchor_path);
  if (!atPath.length) return false;
  return isDash(o.anchor_line) || atPath.some((e) => e.line === Number(o.anchor_line));
}

/** Classify every emitted finding as correct, incorrect, excluded or pending audit. */
export function judgeFindings({ opportunities, unmatched, duplicates }, auditLabels = new Map(), listings = new Map()) {
  const judged = [];
  for (const o of opportunities.filter((x) => x.finding)) {
    const verdict = POSITIVE_VERDICTS.has(o.verdict) ? 'correct' : NEGATIVE_VERDICTS.has(o.verdict) ? 'incorrect' : 'excluded';
    judged.push({
      repo: o.repo, index: o.findingIndex, finding: o.finding, source: 'matched', opportunity: o.opportunity_id, verdict,
      expectedSeverity: verdict === 'correct' ? o.severity : null,
      evidence: verdict === 'correct' ? evidenceCorrect(o, o.finding, listings.get(o.repo)) : null,
    });
  }
  for (const u of unmatched) {
    const label = auditLabels.get(auditId(u.repo, u.index));
    let verdict = 'pending';
    if (label) verdict = POSITIVE_VERDICTS.has(label.verdict) ? 'correct' : NEGATIVE_VERDICTS.has(label.verdict) ? 'incorrect' : 'excluded';
    judged.push({
      repo: u.repo, index: u.index, finding: u.finding, source: 'audit', verdict,
      expectedSeverity: verdict === 'correct' ? label.severity : null,
      evidence: verdict === 'correct' ? label.evidence_correct === 'yes' : null,
    });
  }
  for (const d of duplicates) judged.push({ repo: d.repo, index: d.index, finding: d.finding, source: 'duplicate', verdict: 'excluded' });
  return judged;
}

const count = (items, predicate) => items.filter(predicate).length;

export function computeCoverage(rows, identities, gates, docsSwept = null) {
  const g = gates.coverage;
  const positive = rows.filter((r) => POSITIVE_VERDICTS.has(r.verdict));
  const defects = positive.filter((r) => r.class === 'defect');
  const negatives = rows.filter((r) => NEGATIVE_VERDICTS.has(r.verdict));
  const cues = positive.filter((r) => r.class === 'cue');
  const perRepo = {};
  for (const r of defects) perRepo[r.repo] = (perRepo[r.repo] ?? 0) + 1;
  const maxShare = defects.length ? Math.max(...Object.values(perRepo)) / defects.length : 0;
  const ecosystem = (repo) => identities.find((i) => i.repository === repo)?.ecosystem ?? 'unknown';
  const byEcosystem = {};
  for (const r of rows) {
    const e = (byEcosystem[ecosystem(r.repo)] ??= { defectPositives: 0, negatives: 0, cues: 0 });
    if (r.class === 'defect' && POSITIVE_VERDICTS.has(r.verdict)) e.defectPositives += 1;
    else if (r.class === 'cue') e.cues += 1;
    else if (NEGATIVE_VERDICTS.has(r.verdict)) e.negatives += 1;
  }
  const bySeverity = {};
  for (const r of positive) bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
  const categories = {};
  for (const category of ['missing', 'conflict', 'stale', 'unsafe', 'scan']) {
    const d = count(defects, (r) => r.category === category);
    const n = count(negatives, (r) => r.category === category);
    const c = count(cues, (r) => r.category === category);
    categories[category] = {
      defectPositives: d, negatives: n, cues: c,
      validated: d >= g.perCategory.minDeterminateDefectPositives && n >= g.perCategory.minDeterminateNegatives,
    };
  }
  const overall = {
    defectPositives: defects.length, negatives: negatives.length, cues: cues.length,
    repositoriesWithDefectPositives: Object.keys(perRepo).length, maxRepositoryShare: maxShare,
    documentsSwept: docsSwept,
  };
  overall.validated = defects.length >= g.overall.minDeterminateDefectPositives
    && negatives.length >= g.overall.minDeterminateNegatives
    && overall.repositoriesWithDefectPositives >= g.overall.minRepositoriesWithDefectPositives
    && maxShare <= g.overall.maxRepositoryShareOfDefectPositives
    && (docsSwept === null || docsSwept >= g.overall.minInstructionDocumentsSwept);
  const secPositives = count(defects, (r) => r.verdict === 'security-issue');
  return {
    overall, categories, byEcosystem, bySeverity, perRepositoryDefectPositives: perRepo,
    cues: { count: cues.length, validated: cues.length >= g.cues.minDeterminateCues },
    security: { positives: secPositives, validated: secPositives >= g.security.minDeterminateSecurityPositives },
    counts: { ambiguous: count(rows, (r) => r.verdict === 'ambiguous'), unsupported: count(rows, (r) => r.verdict === 'unsupported') },
  };
}

function boundGate(id, { x, n, floor, ceiling, bound, alpha, validated = true, unitDetail = '' }) {
  if (!validated) return { id, status: 'unvalidated', n, detail: 'coverage minimum not met' };
  if (!n) return { id, status: 'not-exercised', n: 0, detail: 'empty denominator' };
  const lower = bound === 'lower';
  const value = lower ? lowerBound(x, n, alpha) : upperBound(x, n, alpha);
  const pass = lower ? value >= floor : value <= ceiling;
  return { id, status: pass ? 'pass' : 'fail', observed: x / n, bound: value, limit: lower ? floor : ceiling, x, n, detail: unitDetail };
}

/** Metrics for one slice of opportunities and judged findings. */
export function metricsFor(opps, judged) {
  const results = opps.map(outcomeOf);
  const at = (verdict) => results.filter((r) => r === verdict).length;
  const defectOpps = opps.filter((o) => POSITIVE_VERDICTS.has(o.verdict) && o.class === 'defect');
  const defectTP = defectOpps.filter((o) => o.finding).length;
  const fp = at('FP');
  const tn = at('TN');
  const claims = (pred) => judged.filter((j) => ['correct', 'incorrect'].includes(j.verdict) && pred(j.finding.severity));
  const correct = (list) => list.filter((j) => j.verdict === 'correct').length;
  const defectClaims = claims(isDefectSeverity);
  const cueClaims = claims((s) => s === 'info');
  return {
    defectTP, defectFN: defectOpps.length - defectTP, fp, tn,
    defectClaims: { correct: correct(defectClaims), n: defectClaims.length },
    cueClaims: { correct: correct(cueClaims), n: cueClaims.length },
  };
}

export function evaluateGates({ rows, identities, gates, assignment, judged, runSummary, profile, docsSwept = null }) {
  const alpha = gates.confidence.alpha;
  const results = [];
  const coverage = computeCoverage(rows, identities, gates, docsSwept);
  const pending = judged.filter((j) => j.verdict === 'pending').length;
  const opps = assignment.opportunities;
  const all = metricsFor(opps, judged);
  const acc = gates.accuracy;
  const incomplete = (gate) => (pending ? { id: gate.id, status: 'incomplete', detail: `${pending} unmatched findings await audit` } : gate);

  const defectGates = (label, slice, sliceJudged, validated) => {
    const m = metricsFor(slice, sliceJudged);
    const out = [];
    out.push(incomplete(boundGate(`${label}.defectPrecision`, { x: m.defectClaims.correct, n: m.defectClaims.n, floor: acc.defectPrecision.floor, bound: 'lower', alpha, validated })));
    out.push(boundGate(`${label}.defectRecall`, { x: m.defectTP, n: m.defectTP + m.defectFN, floor: acc.defectRecall.floor, bound: 'lower', alpha, validated }));
    out.push(boundGate(`${label}.falsePositiveRate`, { x: m.fp, n: m.fp + m.tn, ceiling: acc.falsePositiveRate.ceiling, bound: 'upper', alpha, validated }));
    return out;
  };
  results.push(...defectGates('overall', opps, judged, coverage.overall.validated));
  for (const [category, info] of Object.entries(coverage.categories)) {
    results.push(...defectGates(category, opps.filter((o) => o.category === category), judged.filter((j) => j.finding.category === category), info.validated));
  }
  const cue = metricsFor(opps, judged).cueClaims;
  results.push(incomplete(boundGate('overall.cueFactualAccuracy', { x: cue.correct, n: cue.n, floor: acc.cueFactualAccuracy.floor, bound: 'lower', alpha, validated: coverage.cues.validated })));
  const correctOnes = judged.filter((j) => j.verdict === 'correct');
  const evidenceOk = correctOnes.filter((j) => j.evidence).length;
  const severityOk = correctOnes.filter((j) => j.expectedSeverity === j.finding.severity).length;
  results.push(incomplete(boundGate('overall.evidenceCorrectness', { x: evidenceOk, n: correctOnes.length, floor: acc.evidenceCorrectness.floor, bound: 'lower', alpha, validated: coverage.overall.validated })));
  results.push(incomplete(boundGate('overall.severityExactAgreement', { x: severityOk, n: correctOnes.length, floor: acc.severityExactAgreement.floor, bound: 'lower', alpha, validated: coverage.overall.validated })));

  // Leave-one-repository-out: a gate that holds only because of one repository does not pass.
  if (acc.leaveOneRepositoryOut.pointEstimateMustClearFloor && coverage.overall.validated) {
    const repos = [...new Set(rows.map((r) => r.repo))];
    const worst = { precision: 1, recall: 1, fpr: 0 };
    for (const repo of repos) {
      const m = metricsFor(opps.filter((o) => o.repo !== repo), judged.filter((j) => j.repo !== repo));
      if (m.defectClaims.n) worst.precision = Math.min(worst.precision, m.defectClaims.correct / m.defectClaims.n);
      if (m.defectTP + m.defectFN) worst.recall = Math.min(worst.recall, m.defectTP / (m.defectTP + m.defectFN));
      if (m.fp + m.tn) worst.fpr = Math.max(worst.fpr, m.fp / (m.fp + m.tn));
    }
    const ok = worst.precision >= acc.defectPrecision.floor && worst.recall >= acc.defectRecall.floor && worst.fpr <= acc.falsePositiveRate.ceiling;
    results.push(incomplete({ id: 'overall.leaveOneRepositoryOut', status: ok ? 'pass' : 'fail', detail: `worst precision ${worst.precision.toFixed(3)}, recall ${worst.recall.toFixed(3)}, FPR ${worst.fpr.toFixed(3)}` }));
  }

  const errorFindings = judged.filter((j) => j.finding.severity === 'error');
  const errorWrong = errorFindings.filter((j) => j.verdict === 'incorrect' || (j.verdict === 'correct' && j.expectedSeverity !== 'error')).length;
  const errorPending = errorFindings.some((j) => j.verdict === 'pending');
  const security = gates.security;
  results.push({
    id: 'security.errorSeverityFalsePositives', status: errorPending ? 'incomplete' : errorFindings.length === 0 ? 'not-exercised' : errorWrong <= security.errorSeverityFalsePositives.max ? 'pass' : 'fail',
    x: errorWrong, n: errorFindings.length,
  });
  for (const [id, key] of [
    ['security.credentialValuesInOutput', 'credentialValues'], ['security.nonAsciiOrControlBytesInOutput', 'nonAsciiBytes'],
    ['security.snapshotModifications', 'snapshotModifications'], ['security.nonDeterministicRepeats', 'nonDeterministic'],
    ['security.uncaughtFailures', 'failures'],
  ]) {
    const limit = security[id.split('.')[1]].max;
    const value = runSummary?.[key];
    results.push({ id, status: value === undefined ? 'incomplete' : value <= limit ? 'pass' : 'fail', x: value, limit });
  }
  const outside = judged.filter((j) => (j.finding.evidence ?? []).some((e) => typeof e.path !== 'string' || e.path.startsWith('/') || /^[A-Za-z]:/.test(e.path) || e.path.split('/').includes('..'))).length;
  results.push({ id: 'security.evidencePathsOutsideSnapshot', status: outside <= security.evidencePathsOutsideSnapshot.max ? 'pass' : 'fail', x: outside });
  results.push(boundGate('security.securityIssueRecall', {
    x: opps.filter((o) => o.verdict === 'security-issue' && o.class === 'defect' && o.finding).length,
    n: opps.filter((o) => o.verdict === 'security-issue' && o.class === 'defect').length,
    floor: acc.defectRecall.floor, bound: 'lower', alpha, validated: coverage.security.validated,
  }));

  if (!profile) results.push({ id: 'runtime.pairedProfile', status: 'incomplete', detail: 'no profile supplied' });
  else {
    const ratios = profile.summary.map((s) => ({
      repository: s.repository,
      latency: s.candidate.medianMilliseconds / s.baseline.medianMilliseconds,
      rss: s.candidate.medianMaxRssKiB / s.baseline.medianMaxRssKiB,
    }));
    const runsOk = profile.runs >= gates.runtime.pairedRuns;
    const worstLatency = Math.max(...ratios.map((r) => r.latency));
    const worstRss = Math.max(...ratios.map((r) => r.rss));
    results.push({
      id: 'runtime.pairedProfile', status: runsOk && worstLatency <= gates.runtime.maxMedianLatencyRatio && worstRss <= gates.runtime.maxMedianPeakRssRatio ? 'pass' : 'fail',
      detail: `runs ${profile.runs}, worst latency ratio ${worstLatency.toFixed(3)}, worst RSS ratio ${worstRss.toFixed(3)}`, ratios,
    });
  }
  const blocking = results.filter((r) => r.status === 'fail');
  const open = results.filter((r) => ['incomplete'].includes(r.status));
  const unvalidated = Object.entries(coverage.categories).filter(([, v]) => !v.validated).map(([k]) => k);
  const decision = blocking.length ? 'NO-GO' : open.length ? 'INCOMPLETE' : !coverage.overall.validated ? 'NO-GO (overall coverage unmet)' : unvalidated.length ? 'SCOPED-GO' : 'GO';
  return { decision, coverage, results, unvalidatedCategories: unvalidated, pendingAudit: pending, all };
}

export { ToolError };
