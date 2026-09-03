import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVITY_TYPES,
  CUSTOM_FIELDS,
  NEWSLETTER_WORKFLOW,
  SALES_PIPELINE,
  mapCall,
  mapCustomActivity,
  mapNewsletterCompletion,
  mapWonOpportunity,
} from "../supabase/functions/_shared/close-mapping.ts";

test("answered outbound call counts as gross and net", () => {
  const fact = mapCall({
    id: "call_1",
    user_id: "user_1",
    activity_at: "2026-09-01T08:00:00Z",
    direction: "outbound",
    status: "completed",
    disposition: "answered",
    duration: 104,
  });
  assert.equal(fact.callsGross, 1);
  assert.equal(fact.callsNet, 1);
  assert.equal(fact.talkSeconds, 104);
});

test("unanswered outbound call counts only as gross", () => {
  const fact = mapCall({
    id: "call_2",
    user_id: "user_1",
    activity_at: "2026-09-01T08:00:00Z",
    direction: "outbound",
    status: "no-answer",
    disposition: null,
    duration: 0,
  });
  assert.equal(fact.callsGross, 1);
  assert.equal(fact.callsNet, 0);
  assert.equal(fact.talkSeconds, 0);
});

test("direct decision maker appointment maps without a gatekeeper", () => {
  const fact = mapCustomActivity({
    id: "custom_1",
    lead_id: "lead_1",
    user_id: "user_1",
    activity_at: "2026-09-01T09:00:00Z",
    custom_activity_type_id: ACTIVITY_TYPES.openingCall,
    status: "published",
    custom_fields: [
      { id: CUSTOM_FIELDS.openingGatekeeperResult, value: "🛑 Kein Gatekeeper" },
      { id: CUSTOM_FIELDS.openingDecisionMakerResult, value: "4: ✅ Termin vereinbart" },
    ],
  });
  assert.ok(fact);
  assert.equal(fact.gatekeeperContacts, 0);
  assert.equal(fact.directDecisionMakerCalls, 1);
  assert.equal(fact.decisionMakerContacts, 1);
  assert.equal(fact.appointments, 1);
});

test("gatekeeper transfer maps to the transfer rate", () => {
  const fact = mapCustomActivity({
    id: "custom_2",
    lead_id: "lead_2",
    user_id: "user_1",
    activity_at: "2026-09-01T10:00:00Z",
    custom_activity_type_id: ACTIVITY_TYPES.openingCall,
    status: "published",
    custom_fields: [
      { id: CUSTOM_FIELDS.openingGatekeeperResult, value: "✅ Durchgestellt" },
      { id: CUSTOM_FIELDS.openingDecisionMakerResult, value: "Kein Interesse" },
    ],
  });
  assert.ok(fact);
  assert.equal(fact.gatekeeperContacts, 1);
  assert.equal(fact.connectedCalls, 1);
  assert.equal(fact.directDecisionMakerCalls, 0);
  assert.equal(fact.decisionMakerContacts, 1);
});

test("won deal is credited to the lead opener", () => {
  const statusId = [...SALES_PIPELINE.wonStatusIds][0];
  const deal = mapWonOpportunity({
    id: "oppo_1",
    lead_id: "lead_1",
    pipeline_id: SALES_PIPELINE.id,
    status_id: statusId,
    status_type: "won",
    date_won: "2026-09-01",
    value: 250000,
    value_period: "one_time",
  }, {
    openerUserId: "user_opener",
    setterUserId: "user_setter",
    closerUserId: "user_closer",
  });
  assert.ok(deal);
  assert.equal(deal.openerCloseUserId, "user_opener");
  assert.equal(deal.valueCents, 250000);
  assert.equal(deal.wonAt, "2026-09-01T12:00:00.000Z");
});

test("newsletter counts only a completed subscription in the approved workflow", () => {
  const completion = mapNewsletterCompletion({
    id: "sub_1",
    sequence_id: NEWSLETTER_WORKFLOW.id,
    created_by_id: "user_1",
    date_created: "2026-09-01T08:00:00Z",
    date_updated: "2026-09-03T10:15:00Z",
    status: "goal",
  });
  assert.ok(completion);
  assert.equal(completion.closeUserId, "user_1");
  assert.equal(completion.completedAt, "2026-09-03T10:15:00Z");

  assert.equal(mapNewsletterCompletion({
    id: "sub_2",
    sequence_id: NEWSLETTER_WORKFLOW.id,
    date_created: "2026-09-01T08:00:00Z",
    date_updated: "2026-09-03T10:15:00Z",
    status: "active",
  }), null);
});
