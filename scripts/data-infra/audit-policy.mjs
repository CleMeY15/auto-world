// Candidate evidence supplements the shipped inventory; it never replaces a subject.
export function auditSubjects(shipped, candidates) {
  if (candidates?.schemaVersion !== 1 || !candidates.images || typeof candidates.images !== "object" || Array.isArray(candidates.images)) throw new Error("infra_audit_candidates_invalid");
  const subjects = Object.entries(shipped).map(([key, pin]) => ({ key, pin, purpose: "shipped" }));
  for (const [role, pin] of Object.entries(candidates.images)) {
    if (!["postgres", "redis"].includes(role) || pin?.repository !== shipped[role]?.repository ||
        typeof pin.version !== "string" || !/^[0-9]+\.[0-9]+(?:\.[0-9]+)?-alpine[0-9]+\.[0-9]+$/u.test(pin.version) ||
        !/^sha256:[a-f0-9]{64}$/u.test(pin.manifestDigest ?? "") ||
        !/^sha256:[a-f0-9]{64}$/u.test(pin.platform?.digest ?? "") ||
        pin.platform?.os !== "linux" || pin.platform?.architecture !== "amd64" || pin.platform?.variant !== null) throw new Error("infra_audit_candidates_invalid");
    subjects.push({ key: `candidate-${role}`, pin, purpose: "candidate-not-adopted" });
  }
  return subjects;
}

export function evaluateImageReport(report, pin, dispositions = [], now = new Date()) {
  if (report?.SchemaVersion !== 2 || report.Trivy?.Version !== "0.74.0" ||
      !Number.isFinite(Date.parse(report.CreatedAt)) || !Array.isArray(report.Results) || !report.Results.length ||
      report.ArtifactType !== "container_image" ||
      ![pin.manifestDigest, pin.platform.digest].some((digest) => report.ArtifactName?.endsWith(`@${digest}`)) ||
      report.Metadata?.ImageConfig?.architecture !== pin.platform.architecture ||
      report.Metadata?.ImageConfig?.os !== pin.platform.os) {
    throw new Error("infra_audit_report_invalid");
  }
  const blockers = [];
  const findings = [];
  if (report.Metadata?.OS?.EOSL === true) blockers.push({ code: "image_os_end_of_life" });
  for (const result of report.Results) {
    for (const finding of result.Vulnerabilities ?? []) {
      if (!["HIGH", "CRITICAL"].includes(finding.Severity)) throw new Error("infra_audit_unexpected_severity");
      const identity = { imageDigest: pin.manifestDigest, target: result.Target, vulnerabilityId: finding.VulnerabilityID, packageName: finding.PkgName, installedVersion: finding.InstalledVersion, severity: finding.Severity, fixedVersion: finding.FixedVersion ?? "" };
      if (Object.values(identity).some((value) => typeof value !== "string")) throw new Error("infra_audit_report_invalid");
      findings.push(identity);
      if (finding.Severity === "CRITICAL" || identity.fixedVersion.trim()) {
        blockers.push({ ...identity, code: "image_vulnerability_blocked" });
        continue;
      }
      const disposition = dispositions.find((entry) =>
        ["imageDigest", "target", "vulnerabilityId", "packageName", "installedVersion"].every((key) => entry[key] === identity[key]) &&
        entry.decision === "unfixed_local_ci_only" && typeof entry.reason === "string" && entry.reason.length >= 30 &&
        typeof entry.independentReview === "string" && /^https:\/\/github\.com\/CleMeY15\/auto-world\//u.test(entry.independentReview) &&
        Number.isFinite(Date.parse(entry.reviewedAt)) && Date.parse(entry.reviewedAt) <= now.getTime() &&
        Number.isFinite(Date.parse(entry.expiresAt)) && Date.parse(entry.expiresAt) > now.getTime() &&
        Date.parse(entry.expiresAt) - Date.parse(entry.reviewedAt) <= 30 * 86400000);
      if (!disposition) blockers.push({ ...identity, code: "unfixed_high_needs_independent_disposition" });
    }
  }
  return { findings, blockers };
}
