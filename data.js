// Datenschicht: Anmeldung, Abfragen und Live-Aktualisierung.
//
// Das Dashboard rechnet nichts selbst. Jede Kennzahl und jede Quote kommt aus
// den Datenbankfunktionen, die im Mapping festgelegt sind. Der Browser
// formatiert nur noch.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js?v=2026-09-04h";

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

const client = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

function requireClient() {
  if (!client) {
    throw new Error("Supabase ist nicht konfiguriert. Publishable Key fehlt in config.js.");
  }
  return client;
}

// Ein fehlgeschlagener Aufruf soll sagen, welche Abfrage gescheitert ist. Ohne
// das steht im Browser nur eine PostgREST-Meldung ohne Zusammenhang.
async function run(label, query) {
  const { data, error } = await query;
  if (error) {
    const cause = error.message || error.code || "unbekannter Fehler";
    throw new Error(`${label}: ${cause}`);
  }
  return data ?? [];
}

// --- Anmeldung ---------------------------------------------------------------

export async function currentSession() {
  const { data } = await requireClient().auth.getSession();
  return data.session ?? null;
}

export async function signIn(email, password) {
  const { error } = await requireClient().auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

// Ein Einladungs- oder Reset-Link erstellt eine kurzlebige Sitzung. Nur aus
// dieser Sitzung darf das persönliche Passwort gesetzt werden; die App nimmt
// oder speichert niemals ein Aktivierungs- oder Team-Passwort.
export async function updatePassword(password) {
  const { error } = await requireClient().auth.updateUser({ password });
  if (error) throw new Error(error.message);
}

// Die Datenbank lässt erst nach diesem serverseitigen Abschluss Dashboard-
// Daten zu. Der Aufruf folgt ausschließlich auf einen erfolgreichen
// auth.updateUser()-Aufruf im selben Browserablauf.
export async function completePasswordSetup() {
  const { error } = await requireClient().rpc("complete_personal_password_setup");
  if (error) throw new Error(error.message);
}

export async function signOut() {
  await requireClient().auth.signOut();
}

export function onAuthChange(handler) {
  requireClient().auth.onAuthStateChange((event, session) => handler(event, session));
}

// Das Profil entscheidet über die Chefansicht und darüber, welche Person beim
// Start im Fokus steht. Fehlt es, bleibt es bei der Vertriebsrolle ohne
// eigene Zuordnung — dann ist nur die Teamansicht sinnvoll.
export async function loadProfile() {
  const rows = await run(
    "Profil laden",
    requireClient().from("profiles").select("display_name, role, sales_person_id, must_change_password").limit(1),
  );
  const profile = rows[0];
  if (!profile) return { displayName: null, role: "sales", salesPersonId: null, mustChangePassword: true };
  return {
    displayName: profile.display_name,
    role: profile.role,
    salesPersonId: profile.sales_person_id,
    mustChangePassword: Boolean(profile.must_change_password),
  };
}

// --- Kennzahlen --------------------------------------------------------------

export async function loadPeople() {
  return run(
    "Vertriebler laden",
    requireClient()
      .from("sales_people")
      .select("id, slug, display_name, color, sort_order")
      .eq("active", true)
      .order("sort_order"),
  );
}

export async function loadMetrics(period, referenceDate) {
  return run(
    "Kennzahlen laden",
    requireClient().rpc("get_dashboard_metrics", {
      p_period: period,
      p_reference_date: referenceDate,
    }),
  );
}

// Diese Auswertung ist vorerst für alle vollständig eingerichteten
// Dashboard-Konten freigegeben. Der Login bleibt serverseitig erforderlich;
// eine spätere persönliche Antony-Sperre wird wieder im RPC umgesetzt.
export async function loadAntonyClosingMetrics(period, referenceDate) {
  const rows = await run(
    "Closer-Kennzahlen laden",
    requireClient().rpc("get_antony_closing_metrics", {
      p_period: period,
      p_reference_date: referenceDate,
    }),
  );
  return rows[0] ?? null;
}

// Der optionale Rechner speichert nur die Zielannahmen des angemeldeten
// Antony-/Leitungs-Kontos. Die operativen Close-Daten bleiben unverändert.
export async function loadAntonyGoal(periodType, periodStart) {
  const rows = await run(
    "Anthony-Zielplan laden",
    requireClient()
      .from("antony_performance_goals")
      .select("period_type, period_start, period_end, target_new_customers, target_revenue_cents, customer_value_cents, appointment_to_closer_rate_override, show_rate_override, closing_rate_override")
      .eq("period_type", periodType)
      .eq("period_start", periodStart)
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function saveAntonyGoal(goal) {
  const session = await currentSession();
  if (!session?.user?.id) throw new Error("Für das Speichern ist eine Anmeldung erforderlich.");
  const rows = await run(
    "Anthony-Zielplan speichern",
    requireClient()
      .from("antony_performance_goals")
      .upsert(
        { ...goal, owner_user_id: session.user.id },
        { onConflict: "owner_user_id,period_type,period_start" },
      )
      .select("period_type, period_start, period_end, target_new_customers, target_revenue_cents, customer_value_cents, appointment_to_closer_rate_override, show_rate_override, closing_rate_override")
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function loadHourPerformance(period, referenceDate) {
  return run(
    "Anrufzeiten laden",
    requireClient().rpc("get_call_hour_performance", {
      p_period: period,
      p_reference_date: referenceDate,
    }),
  );
}

export async function loadTrends() {
  return run(
    "Trend laden",
    requireClient().from("dashboard_monthly_trends").select("*"),
  );
}

// Tageszeilen für den Verlauf. Die Ansicht liefert bereits je Tag und Person
// eine Zeile samt fertig berechneter Quoten, deshalb braucht der Verlauf keine
// eigene Datenbankfunktion.
export async function loadDailySeries(startDate, endDate) {
  return run(
    "Verlauf laden",
    requireClient()
      .from("dashboard_daily_metrics")
      .select("metric_date, slug, calls_gross, calls_net, decision_maker_contacts, appointments, calculated_at")
      .gte("metric_date", startDate)
      .lte("metric_date", endDate)
      .order("metric_date"),
  );
}

// Ziele, deren Zeitraum den angezeigten überlappt. Die Skalierung auf den
// gewählten Zeitraum passiert im Dashboard, weil nur dort bekannt ist, welcher
// Ausschnitt gerade sichtbar ist.
export async function loadTargets(periodStart, periodEnd) {
  return run(
    "Ziele laden",
    requireClient()
      .from("sales_targets")
      .select("sales_person_id, period_start, period_end, calls_gross, calls_net, gatekeeper_contacts, connected_calls, decision_maker_contacts, appointments, transfer_rate_target, appointment_rate_target")
      .lte("period_start", periodEnd)
      .gte("period_end", periodStart),
  );
}

export async function saveTargets(rows) {
  return run("Ziele speichern", requireClient().from("sales_targets").upsert(rows).select());
}

// Nur Manager dürfen Sync-Läufe lesen. Für alle anderen liefert die Policy eine
// leere Antwort statt eines Fehlers, deshalb genügt hier ein leeres Ergebnis.
export async function loadLatestSyncRun() {
  const rows = await run(
    "Sync-Status laden",
    requireClient()
      .from("sync_runs")
      .select("status, started_at, completed_at, fetched_records, upserted_records")
      .order("started_at", { ascending: false })
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function loadLatestSummary() {
  const rows = await run(
    "Zusammenfassung laden",
    requireClient()
      .from("daily_summaries")
      .select("*")
      .order("summary_date", { ascending: false })
      .limit(1),
  );
  return rows[0] ?? null;
}

// --- Live-Aktualisierung -----------------------------------------------------

// Views lassen sich nicht abonnieren, das Dashboard liest aber über Views und
// Funktionen. Die Tabellenänderung dient deshalb als Signal zum Nachladen, nicht
// als Datenquelle. Realtime beachtet dieselben Policies wie eine Abfrage.
export function subscribeToUpdates(onChange) {
  const channel = requireClient()
    .channel("dashboard-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "daily_sales_metrics" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "sales_targets" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "sync_runs" }, onChange)
    .subscribe();
  return () => requireClient().removeChannel(channel);
}
