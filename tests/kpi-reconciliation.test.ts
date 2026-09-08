import test from "node:test";
import assert from "node:assert/strict";
import { ACTIVITY_TYPES, CUSTOM_FIELDS, CLOSE_USERS, SALES_PIPELINE, mapCustomActivity, mapWonOpportunity } from "../supabase/functions/_shared/close-mapping.ts";
import { prepareCustomReconciliation, prepareWonReconciliation, prepareLeadReportingSnapshot, CUSTOM_RECONCILIATION_FIELDS } from "../supabase/functions/_shared/close-reconciliation.ts";
import { buildModelInput, buildWeeklyComparison, buildProcessInput } from "../supabase/functions/_shared/weekly-review.ts";
import { buildAssistantClosing, buildAssistantMetrics } from "../supabase/functions/_shared/kpi-assistant.ts";

const row = {
  id: "activity-fixture", lead_id: "lead-fixture", user_id: CLOSE_USERS.antony,
  date_created: "2025-11-01T10:00:00Z", date_updated: "2026-09-07T10:00:00Z",
  activity_at: "2026-08-26T12:00:00Z", status: "published",
  custom_activity_type_id: ACTIVITY_TYPES.setterCall,
  [`custom.${CUSTOM_FIELDS.setterResult}`]: "✅ Closer terminiert",
};
test("late published old draft is included by event date and stable ID", () => {
  const result = prepareCustomReconciliation([row, row], "2026-07-01", "2026-09-07");
  assert.equal(result.facts.length, 1);
  assert.equal(result.facts[0].setterSuccesses, 1);
  assert.equal(result.facts[0].closeUserId, CLOSE_USERS.antony);
  assert.equal(prepareCustomReconciliation([{ ...row, status: "draft" }], "2026-07-01", "2026-09-07").facts.length, 0);
});
test("reconciliation respects Berlin month boundary and retention", () => {
  assert.equal(prepareCustomReconciliation([{ ...row, activity_at: "2026-06-30T22:00:00Z" }], "2026-07-01", "2026-09-07").facts.length, 1);
  assert.equal(prepareCustomReconciliation([{ ...row, activity_at: "2026-06-30T21:59:59Z" }], "2026-07-01", "2026-09-07").facts.length, 0);
  assert.equal(prepareCustomReconciliation([{ ...row, activity_at: "2026-09-07T22:00:00Z" }], "2026-07-01", "2026-09-07").facts.length, 0);
});
test("invalid and changing snapshots fail before destructive replacement", () => {
  assert.throws(() => prepareCustomReconciliation([{ ...row, activity_at: "" }], "2026-07-01", "2026-09-07"));
  assert.throws(() => prepareCustomReconciliation([row, { ...row, status: "draft" }], "2026-07-01", "2026-09-07"));
  assert.equal(CUSTOM_RECONCILIATION_FIELDS.some(field => field.includes("body") || field.includes("name")), false);
});
test("GF unreachable and separator do not invent transfers or decision-maker contact", () => {
  for (const type of [ACTIVITY_TYPES.openingCall, ACTIVITY_TYPES.followUp]) {
    const opening = type === ACTIVITY_TYPES.openingCall;
    const fact = mapCustomActivity({ ...row, custom_activity_type_id: type, status: "published", custom_fields: [
      { id: opening ? CUSTOM_FIELDS.openingGatekeeperResult : CUSTOM_FIELDS.followUpGatekeeperResult, value: "GF nicht erreichbar" },
      { id: opening ? CUSTOM_FIELDS.openingDecisionMakerResult : CUSTOM_FIELDS.followUpDecisionMakerResult, value: "5: --------------------" },
    ] });
    assert.equal(fact?.connectedCalls, 0);
    assert.equal(fact?.gatekeeperContacts, 0);
    assert.equal(fact?.decisionMakerContacts, 0);
    assert.equal(fact?.appointments, 0);
  }
});
test("open CC2 and missing result are not decided conversations", () => {
  for (const [value, expected] of [["2. 🔥 CC2 vereinbart",0], ["",0], ["4. ❌ Nicht verkauft",1], ["3. ✅ Verkauft - in CC2 🔥",1]] as const) {
    const f = mapCustomActivity({ ...row, status: "published", custom_activity_type_id: ACTIVITY_TYPES.closerCall, custom_fields: [{ id: CUSTOM_FIELDS.closerResult, value }] });
    assert.equal(f?.closerCalls, 1);
    assert.equal(f?.closerDecidedCalls, expected);
  }
});
test("missing opener does not erase an Antony win; Berlin won date is used", () => {
  const won = mapWonOpportunity({ id: "won-fixture", lead_id: "lead", pipeline_id: SALES_PIPELINE.id,
    status_type: "won", status_id: [...SALES_PIPELINE.wonStatusIds][0], date_won: "2026-08-31T22:30:00Z",
    value_period: "one_time", value: 1520000,
  }, { openerUserId: null, setterUserId: null, closerUserId: CLOSE_USERS.antony });
  assert.equal(won?.wonDate, "2026-09-01");
  assert.equal(won?.openerCloseUserId, null);
  assert.equal(won?.closerCloseUserId, CLOSE_USERS.antony);
});
test("AI preserves missing denominators and does not create a percent-point trend", () => {
  const empty = buildModelInput({ funnel: { calls_gross: 0, gatekeeper_contacts: 0, transfer_rate: 99 }, closing: { setter_calls: 0, closer_calls: 0 } });
  assert.equal(empty.funnel.transfer_rate, null);
  assert.equal(empty.closing.setter_conversion_rate, null);
  assert.equal(buildWeeklyComparison(empty, empty).funnel.transfer_rate.percentage_point_change, null);
  assert.equal(buildAssistantClosing({ setter_calls: 0, setter_success_rate: 0 }).setter_conversion_rate, null);
});
test("AI recalculates ratios from counts without clamping period ratios", () => {
  const result = buildModelInput({ closing: { appointments: 1, setter_calls: 4, setter_successes: 1, closer_calls: 2, decided_closer_calls: 1, closer_sales: 1 } });
  assert.equal(result.closing.setter_conversion_rate, 25);
  assert.equal(result.closing.closer_period_ratio, 200);
  assert.equal(result.closing.closer_close_rate, 100);
});

test("Won reconciliation filters the Berlin boundary, deduplicates and fails on incomplete records", () => {
  const won = { id: "won", lead_id: "lead", pipeline_id: SALES_PIPELINE.id, status_type: "won",
    status_id: [...SALES_PIPELINE.wonStatusIds][0], date_won: "2026-06-30T22:30:00Z", value_period: "one_time", value: 100 };
  const attribution = new Map([["lead", { openerUserId: null, setterUserId: null, closerUserId: CLOSE_USERS.antony }]]);
  assert.equal(prepareWonReconciliation([won,won],attribution,"2026-07-01","2026-09-07").length,1);
  assert.equal(prepareWonReconciliation([{...won,date_won:"2026-06-30T21:30:00Z"}],attribution,"2026-07-01","2026-09-07").length,0);
  assert.throws(()=>prepareWonReconciliation([{...won,date_won:"invalid"}],attribution,"2026-07-01","2026-09-07"));
  assert.throws(()=>prepareWonReconciliation([won],new Map(),"2026-07-01","2026-09-07"));
});

test("missing AI counts stay unknown instead of inventing zero activity or a partial team total", () => {
  const missing = buildModelInput({});
  assert.equal(missing.funnel.calls_gross, null);
  assert.equal(missing.closing.closer_calls, null);
  assert.equal(buildWeeklyComparison(missing, buildModelInput({funnel:{calls_gross:5}})).funnel.calls_gross.absolute_change, null);
  assert.equal(buildAssistantClosing({closer_calls:null}).closer_calls,null);
  assert.equal(buildAssistantMetrics([{calls_gross:5},{calls_gross:null}]).team.calls_gross,null);
  assert.equal(buildAssistantMetrics([]).team.calls_gross,null);
  assert.equal(buildAssistantClosing({closer_calls:0}).closer_calls,0);
});


test("process AI only receives allowlisted aggregates with explicit attribution and denominator", () => {
  const result=buildProcessInput({activity:{setter_calls:7,notes:"private-note"},lead_quality:{assessed_leads:4,qualified:2},
    quality_by_source:[{source:"LinkedIn",owner:"michael",attribution:"booking_activity",assessed_leads:4,qualified:2,lead_id:"private-lead"}],
    booking_cohort:[{source:"LinkedIn",owner:"michael",booked_leads:6,setter_arrived:3,qualified:2,notes:"private-note"},
      {source:"private-source",owner:"private-owner",booked_leads:0,setter_arrived:0,qualified:0}]});
  assert.equal(result.activity.setter_calls,7);
  assert.equal(result.quality_by_source[0].qualified_share,50);
  assert.equal(result.quality_by_source[0].attribution,"booking_activity");
  assert.equal(result.booking_cohort[0].setter_arrival_progress,50);
  assert.equal(result.booking_cohort[0].qualified_share_of_arrivals,66.67);
  assert.equal(result.booking_cohort[1].setter_arrival_progress,null);
  assert.equal(JSON.stringify(result).includes("private-"),false);
  assert.equal(buildProcessInput(null).activity.setter_calls,null);
});

test("weekly AI preserves the same process counts instead of inferring losses from follow-ups", () => {
  const process={activity:{setter_followups:3,cc2_agreed:2,closer_lost:1},booking_cohort:[]};
  const result=buildModelInput({process,closing:{closer_sales:1,decided_closer_calls:2}});
  assert.equal(result.process.activity.setter_followups,3);
  assert.equal(result.process.activity.cc2_agreed,2);
  assert.equal(result.process.activity.closer_lost,1);
  assert.equal(result.closing.closer_close_rate,50);
});


test("lead metadata excludes padded out-of-window Won leads and requires appointment-only leads", () => {
  const rows=[{lead_id:"booked",opener_close_user_id:CLOSE_USERS.felix,lead_source:"LinkedIn"},
    {lead_id:"won-inside",opener_close_user_id:null,lead_source:null},
    {lead_id:"won-outside",opener_close_user_id:null,lead_source:null}];
  const facts=prepareCustomReconciliation([{...row,lead_id:"booked",custom_activity_type_id:ACTIVITY_TYPES.followUp,
    [`custom.${CUSTOM_FIELDS.followUpDecisionMakerResult}`]:"Entscheider: Termin vereinbart"}],"2026-07-01","2026-09-07").facts;
  assert.deepEqual(prepareLeadReportingSnapshot(rows,facts,[{leadId:"won-inside"}]).map(x=>x.lead_id),["booked","won-inside"]);
  assert.throws(()=>prepareLeadReportingSnapshot(rows.slice(1),facts,[{leadId:"won-inside"}]));
  assert.throws(()=>prepareLeadReportingSnapshot([...rows,rows[0]],facts,[]));
});
