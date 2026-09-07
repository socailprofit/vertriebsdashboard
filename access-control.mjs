// UI visibility follows the authenticated server RPC. Supabase separately
// enforces data access even if browser state is manipulated.
export function hasAntonyDashboardAccess(profile) {
  return profile?.antonyAccess === true && profile?.mustChangePassword === false;
}

export function hasWeeklyReviewAccess(profile) {
  return hasAntonyDashboardAccess(profile);
}
