import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBusinessContext,
  buildModelInput,
  buildPipelineInput,
  buildProcessInput,
  buildWeeklyComparison,
  businessContextIsConfigured,
  classifyNetRate,
  extractResponseText,
  parseReviewSentences,
  previousCompletedSalesWeek,
} from "../supabase/functions/_shared/weekly-review.ts";

test("journey and cross-period AI context retain only categorical dimensions and counters", () => {
  const input=buildProcessInput({period_bridge:{setter_from_prior_bookings:4,sales_after_prior_won:1,lead_id:'private-lead'},
    funnel_by_source:[{source:'private-company',owner:'private-person',booked_leads:8,cc2_cancelled:1,cc2_sold:2,notes:'private-note'}],
    setter_by_day:[{email:'private-mail'}]});
  assert.equal(input.period_bridge.setter_from_prior_bookings,4);
  assert.equal(input.funnel_by_source[0].cc2_cancelled,1);
  assert.equal(input.funnel_by_source[0].cc2_sold,2);
  assert.equal(input.funnel_by_source[0].source,'Nicht zugeordnet');
  assert.equal(JSON.stringify(input).includes('private-'),false);
});

test("Monday run reviews the previous completed Monday-Friday sales week", () => {
  assert.deepEqual(previousCompletedSalesWeek("2026-09-07"), {
    start: "2026-08-31",
    end: "2026-09-04",
    isoYear: 2026,
    isoWeek: 36,
  });
});

test("calendar week stays correct across the ISO year boundary", () => {
  assert.deepEqual(previousCompletedSalesWeek("2027-01-04"), {
    start: "2026-12-28",
    end: "2027-01-01",
    isoYear: 2026,
    isoWeek: 53,
  });
});

test("model input whitelists aggregated metrics and drops raw or personal fields", () => {
  const input = buildModelInput({
    period: { start: "2026-08-31", end: "2026-09-04", timezone: "Europe/Berlin" },
    funnel: {
      calls_gross: 100,
      calls_net: 70,
      net_rate: 70,
      gatekeeper_contacts: 40,
      connected_calls: 20,
      transfer_rate: 50,
      decision_maker_contacts: 35,
      appointments: 8,
      appointment_rate: 22.86,
      close_note: "must never leave Supabase",
    },
    closing: {
      setter_calls: 8,
      setter_successes: 6,
      setter_show_rate: 75,
      closer_calls: 5,
      closer_show_rate: 83.33,
      cc2_agreed: 1,
      cc2_rate: 20,
      decided_closer_calls: 4,
      closer_sales: 1,
      closer_close_rate: 25,
      new_customers: 1,
      appointment_to_closer_rate: 62.5,
      lead_id: "lead_secret",
    },
    data_basis: { too_small: false },
    email: "person@example.test",
    payload: { raw: true },
  });

  const serialised = JSON.stringify(input);
  assert.equal(serialised.includes("close_note"), false);
  assert.equal(serialised.includes("lead_secret"), false);
  assert.equal(serialised.includes("person@example.test"), false);
  assert.equal(serialised.includes("payload"), false);
  assert.equal(input.closing.new_customers, 1);
});

test("business context is bounded, whitelisted and needs the four core fields", () => {
  const context = buildBusinessContext({
    company: { name: "Social Profit", offer: "Angebot", business_model: "Modell", api_key: "secret" },
    icp: { summary: "ICP", buyer_roles: ["Geschäftsführung"], company_profile: "Profil", email: "hidden" },
    sales: { motion: "Outbound", kpi_definitions: ["Terminquote"], priority_rules: [], benchmarks: [] },
    close_notes: "never include",
  });
  const serialised = JSON.stringify(context);
  assert.equal(businessContextIsConfigured(context), true);
  assert.equal(serialised.includes("api_key"), false);
  assert.equal(serialised.includes("hidden"), false);
  assert.equal(serialised.includes("close_notes"), false);
  assert.equal(businessContextIsConfigured(buildBusinessContext({})), false);
});

test("pipeline input exposes aggregate counts but drops raw Close details", () => {
  const input = buildPipelineInput({
    as_of: "2026-09-04",
    window_start: "2026-07-01",
    retention_months: 3,
    counts: {
      total_open: 9,
      setter_pending: 2,
      closer_scheduled: 3,
      rescheduled_closer: 1,
      pending_decision_cc2: 3,
      from_previous_months: 4,
      older_than_14_days: 2,
    },
    oldest_open_date: "2026-07-22",
    lead_ids: ["lead_secret"],
    notes: "private Close note",
    email: "person@example.test",
  });

  const serialised = JSON.stringify(input);
  assert.equal(input.counts.total_open, 9);
  assert.equal(serialised.includes("lead_secret"), false);
  assert.equal(serialised.includes("private Close note"), false);
  assert.equal(serialised.includes("person@example.test"), false);
});

test("persistent pipeline preserves future planning without inflating the current stock or leaking identifiers", () => {
  const input=buildPipelineInput({persistent:true,as_of:"2026-09-10",data_as_of:"2026-09-10T11:15:00+00:00",retention_months:3,
    counts:{total_open:4,setter_planned:3,planning_needs_review:1,setter_followup:0,closer_followup:0,closer_cancelled:0,closer_planned:0,cc2_planned:0,lead_id:"private-lead"},
    coverage:{unlinked_processes:1,notes:"private-note"},
    next_by_month:[{month:"2026-10-01",stage:"setter",count:2,meeting_id:"private-meeting"},{month:"2026-10-01",stage:"setter",count:1},
      {month:"2026-11-01",stage:"unassigned",count:1,email:"private-mail"},{month:"2026-08-01",stage:"setter",count:20},
      {month:"2026-12-01",stage:"private-person",count:2},{month:"2026-99-01",stage:"setter",count:1},{month:"2026-12-01",stage:"setter",count:"private-count"}]
  });
  assert.equal(input.persistent,true);assert.equal(input.retention_months,null);assert.equal(input.data_as_of,"2026-09-10T11:15:00.000Z");
  assert.equal(input.counts.total_open,4);assert.equal(input.counts.setter_planned,3);assert.equal(input.counts.setter_followup,0);assert.equal(input.counts.planning_needs_review,1);
  assert.deepEqual(input.next_by_month,[{month:"2026-10-01",stage:"setter",count:3},{month:"2026-11-01",stage:"unassigned",count:1}]);
  assert.equal(input.coverage.unlinked_processes,1);assert.equal(JSON.stringify(input).includes("private-"),false);
});

test("process input separates old work, first qualifications and due attendance while deriving quality from the same process population", () => {
  const input=buildProcessInput({period:{start:"2026-09-01",end:"2026-09-10"},
    flow:{new_processes:7,carried_in:2,first_qualified:3,repeat_setter_calls:4,unlinked_setter_calls:1,cohort_basis:"first_scheduled_meeting",process_id:"private-process"},
    coverage:{history_complete:true,complete_period:true,raw:"private-history"},
    setter_attendance:{period_start:"2026-09-01",period_end:"2026-09-10",data_as_of:"2026-09-10T11:15:00Z",scheduled:9,elapsed:7,future:2,attended:4,no_show:1,cancelled:1,rescheduled:0,unknown:1,show_rate:99,
      by_source:[{source:"LinkedIn",owner:"linkedin",scheduled:9,elapsed:7,future:2,attended:4,lead_id:"private-lead"}]},
    lead_quality:{assessed_leads:999,qualified:999},
    quality_by_source:[{source:"LinkedIn",owner:"linkedin",attribution:"sales_process",assessed_leads:2,qualified:1,followup:1,disqualified:0,unrated:0,notes:"private-notes"}],
    activity_by_origin:[{source:"LinkedIn",owner:"linkedin",booked_date:"2026-08-01",setter_calls:4,setter_from_prior_bookings:4,cc_unassigned_calls:1,closer_lost_unassigned:1,notes:"private-notes"}],
    booking_cohort:[{source:"LinkedIn",owner:"linkedin",booked_leads:7,setter_arrived:3,future:2}]
  });
  assert.deepEqual(input.flow,{new_processes:7,carried_in:2,first_qualified:3,repeat_setter_calls:4,unlinked_setter_calls:1,cohort_basis:"first_scheduled_meeting"});
  assert.equal(input.setter_attendance.show_rate,57.14);assert.equal(input.setter_attendance.future,2);assert.equal(input.setter_attendance.unknown,1);
  assert.equal(input.setter_attendance.by_source[0].owner,"linkedin");assert.equal(input.lead_quality.assessed_leads,2);
  assert.equal(input.quality_by_source[0].qualified_share,50);assert.equal(input.quality_by_source[0].attribution,"sales_process");
  assert.equal(input.activity_by_origin[0].setter_from_prior_bookings,4);assert.equal(input.activity_by_origin[0].closer_lost_unassigned,1);
  assert.equal(input.booking_cohort[0].future,2);assert.equal(JSON.stringify(input).includes("private-"),false);
});

test("missing process evidence remains unknown and future-only attendance has no show rate", () => {
  const missing=buildProcessInput(null);assert.equal(missing.flow.first_qualified,null);assert.equal(missing.coverage.history_complete,false);
  const future=buildProcessInput({setter_attendance:{scheduled:3,elapsed:0,future:3,attended:0,no_show:0}});
  assert.equal(future.setter_attendance.show_rate,null);assert.equal(future.setter_attendance.no_show,0);
  assert.equal(buildPipelineInput({data_as_of:"private-date"}).data_as_of,null);
});

test("weekly comparison covers every aggregate KPI with stable deltas", () => {
  const current = buildModelInput({
    funnel: {
      calls_gross: 120, calls_net: 90, net_rate: 75,
      gatekeeper_contacts: 40, connected_calls: 20, transfer_rate: 50,
      decision_maker_contacts: 30, appointments: 8, appointment_rate: 26.67,
    },
    closing: {
      setter_calls: 8, setter_successes: 6, setter_show_rate: 75,
      closer_calls: 5, closer_show_rate: 83.33, cc2_agreed: 1, cc2_rate: 20,
      decided_closer_calls: 4, closer_sales: 1, closer_close_rate: 25,
      new_customers: 1, appointment_to_closer_rate: 62.5,
    },
    data_basis: { too_small: false },
  });
  const previous = buildModelInput({
    funnel: {
      calls_gross: 100, calls_net: 65, net_rate: 65,
      gatekeeper_contacts: 35, connected_calls: 14, transfer_rate: 40,
      decision_maker_contacts: 25, appointments: 4, appointment_rate: 16,
    },
    closing: {
      setter_calls: 6, setter_successes: 3, setter_show_rate: 50,
      closer_calls: 3, closer_show_rate: 100, cc2_agreed: 0, cc2_rate: 0,
      decided_closer_calls: 3, closer_sales: 0, closer_close_rate: 0,
      new_customers: 0, appointment_to_closer_rate: 75,
    },
    data_basis: { too_small: true },
  });

  const comparison = buildWeeklyComparison(current, previous);
  assert.deepEqual(comparison.funnel.calls_gross, { absolute_change: 20 });
  assert.deepEqual(comparison.funnel.net_rate, { percentage_point_change: 10 });
  assert.deepEqual(comparison.closing.setter_successes, { absolute_change: 3 });
  assert.deepEqual(comparison.closing.closer_period_ratio, { percentage_point_change: -16.67 });
  assert.equal(Object.keys(comparison.funnel).length, 9);
  assert.equal(Object.keys(comparison.closing).length, 12);
  assert.deepEqual(comparison.data_basis, {
    current_too_small: false,
    previous_too_small: true,
    trend_reliable: false,
  });
  assert.deepEqual(comparison.business_signals.current_net_rate, {
    status: "standard",
    interpretation: "Interner Normalbereich; darf im Review nicht als besondere Staerke gelobt werden.",
  });
  assert.deepEqual(comparison.business_signals.previous_net_rate, {
    status: "lead_list_quality_warning",
    interpretation: "Unter dem internen Standard; Leadlisten-Qualitaet pruefen, aber keine Ursache behaupten.",
  });
});

test("net rate uses Social Profit's deterministic internal benchmark", () => {
  assert.equal(classifyNetRate(0, 0).status, "no_data");
  assert.equal(classifyNetRate(69.99, 100).status, "lead_list_quality_warning");
  assert.equal(classifyNetRate(70, 100).status, "standard");
  assert.equal(classifyNetRate(80, 100).status, "standard");
  assert.equal(classifyNetRate(80.01, 100).status, "above_standard");
});

test("structured model output covers every required review topic", () => {
  const json = JSON.stringify({
    strength: "Eins.",
    bottleneck: "Zwei.",
    trend_and_conversion: "Drei.",
    priority: "Vier.",
    action: "Fünf.",
  });
  const text = extractResponseText({
    output: [{ type: "message", content: [{ type: "output_text", text: json }] }],
  });
  assert.deepEqual(parseReviewSentences(text), ["Eins.", "Zwei.", "Drei.", "Vier.", "Fünf."]);
  assert.throws(() => parseReviewSentences(JSON.stringify({ strength: "Nur einer." })));
  assert.throws(() => parseReviewSentences(JSON.stringify({ ...JSON.parse(json), action: "" })));
});
