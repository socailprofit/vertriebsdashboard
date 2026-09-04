const ANTONY_DASHBOARD_EMAILS = new Set([
  "rigone@socialprofit.de",
  "info@socialprofit.de",
]);

export function hasAntonyDashboardAccess(email) {
  return ANTONY_DASHBOARD_EMAILS.has(String(email ?? "").trim().toLowerCase());
}
