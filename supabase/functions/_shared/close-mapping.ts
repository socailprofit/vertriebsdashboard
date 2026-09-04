export const MAPPING_VERSION = "2026-09-04.v3";
export const REPORTING_TIMEZONE = "Europe/Berlin";

export function metricTimeInReportingTimezone(occurredAt: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: REPORTING_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(occurredAt)).map((part) => [part.type, part.value]),
  );
  return {
    metricDate: `${parts.year}-${parts.month}-${parts.day}`,
    metricHour: Number(parts.hour),
  };
}

export const CLOSE_USERS = {
  michael: "user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy",
  felix: "user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4",
  antony: "user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR",
} as const;

export const ACTIVITY_TYPES = {
  openingCall: "actitype_3YiimGlbRMzQxr2O3hPKHJ",
  followUp: "actitype_38qU8FYNxY0WkWAy66Uc65",
  setterCall: "actitype_7iu5gw2AEBDGBHD7Mqcz3S",
  closerCall: "actitype_3kZhgp3iCjGQBHQdilV1Og",
  noShow: "actitype_6dnbcILqqeo0iGpRCEjOas",
} as const;

export const CUSTOM_FIELDS = {
  openingGatekeeperResult: "cf_8Bjba56AJvfLXwNKJwhjVJwSmCdaHBlTVyH25kxp3M1",
  openingDecisionMakerResult: "cf_LBuW6DB7vmgifhe2JUasZIhYvrOIjcAd7xB8hzYQrJ9",
  openingProductFocus: "cf_Zw225qd46iqrceG41wQvQUUBsp70HyCgGC8qC9naPQL",
  followUpGatekeeperResult: "cf_cQiYFFuU9Cz20rbmDRy4qQiNYftCi4PZ6bMqCBPQdLB",
  followUpDecisionMakerResult: "cf_cCwSCrUsnKXzbenn1zkdqrjNIjM6ewkGgpdj4w4Yb4c",
  followUpProductFocus: "cf_YM4iE8NKa0VCV3kiyp1yjt7pdWIj5UHtPWrsvR7Kh0t",
  setterResult: "cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo",
  closerResult: "cf_voRgeFZ9DSbfWqrwRSAfzr5ApVvUIzAyLOnkLdOp7qn",
  setterNoShow: "cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz",
  closerNoShow: "cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q",
  leadOpener: "cf_TSACbW8OM7JYd1ibwAOqZgot7DNRVETNZDNDP6qhhBS",
  leadSetter: "cf_szgwxBHGiT3kNPNFmmCXXrI8MZcdFKQsoLEQfiJt0Bg",
  leadCloser: "cf_BfV6Ozp3GtXASgWErLR0y4XGKGg0krhQ64zts9yJSZE",
} as const;

export const SALES_PIPELINE = {
  id: "pipe_42eLhfS7p2vd5Fjw2ou2Sw",
  wonStatusIds: new Set([
    "stat_CxgagrC23GIjKjEqvE931SP6CK9tkfuKaYZzuFQZyuL",
    "stat_JogyhmNFRLb0ucUfEXPYRJTpVeRXJFix9GB0aVoBfz0",
  ]),
} as const;

// Diese Workflow-ID ist die konkrete, vom Team freigegebene Newsletter-
// Sequenz. Andere Sequenzen dürfen niemals in die Newsletter-KPI einfließen.
export const NEWSLETTER_WORKFLOW = {
  id: "seq_1CghCZOXaNSlwDSOIpljTy",
  name: "Newsletter",
} as const;

// Close beschreibt diese beiden Zustände im Workflow-Report als abgeschlossen:
// Der Kontakt hat entweder das Ziel erreicht (z. B. geantwortet) oder die
// Sequenz vollständig durchlaufen. Aktive, pausierte und fehlerhafte Kontakte
// zählen ausdrücklich nicht.
const COMPLETED_NEWSLETTER_STATUSES = new Set(["goal", "finished"]);

const FINAL_CALL_STATUSES = new Set(["completed", "no-answer", "busy", "failed", "timeout"]);
const APPOINTMENT_RESULTS = new Set([
  "4: ✅ Termin vereinbart",
  "Entscheider: Termin vereinbart",
]);
const SETTER_SUCCESS_RESULTS = new Set(["✅ Closer terminiert"]);
const CLOSER_SALE_RESULTS = new Set([
  "1. ✅ Verkauft - in CC1",
  "3. ✅ Verkauft - in CC2 🔥",
]);
const CLOSER_SECOND_CALL_RESULTS = new Set(["2. 🔥 CC2 vereinbart"]);

type CustomValue = string | number | string[] | null;

export type CloseCall = {
  id: string;
  lead_id?: string | null;
  user_id?: string | null;
  activity_at: string;
  direction: "inbound" | "outbound";
  status?: string | null;
  disposition?: string | null;
  duration?: number | null;
};

export type CloseCustomActivity = {
  id: string;
  lead_id: string;
  user_id?: string | null;
  activity_at: string;
  custom_activity_type_id: string;
  status: "draft" | "published";
  custom_fields?: Array<{ id: string; value: CustomValue }>;
};

export type CloseOpportunity = {
  id: string;
  lead_id: string;
  pipeline_id?: string | null;
  status_id: string;
  status_type?: "won" | "lost" | "active" | null;
  date_won?: string | null;
  value?: number | null;
  value_period: "one_time" | "monthly" | "annual";
};

export type CloseSequenceSubscription = {
  id: string;
  sequence_id: string;
  created_by_id?: string | null;
  date_created: string;
  date_updated: string;
  status: string;
};

export type NewsletterCompletion = {
  subscriptionId: string;
  closeUserId: string | null;
  completedAt: string;
  status: "goal" | "finished";
  mappingVersion: string;
};

export type LeadAttribution = {
  openerUserId: string | null;
  setterUserId: string | null;
  closerUserId: string | null;
};

export type ActivityFact = {
  sourceActivityId: string;
  sourceType: "call" | "custom_activity";
  closeUserId: string | null;
  leadId: string | null;
  occurredAt: string;
  callsGross: number;
  callsNet: number;
  talkSeconds: number;
  gatekeeperContacts: number;
  connectedCalls: number;
  directDecisionMakerCalls: number;
  decisionMakerContacts: number;
  appointments: number;
  setterCalls: number;
  setterSuccesses: number;
  closerCalls: number;
  closerSecondCalls: number;
  closerSales: number;
  noShows: number;
  cancellations: number;
  rescheduledAppointments: number;
  productFocus: string | null;
  mappingVersion: string;
};

function emptyActivityFact(
  sourceActivityId: string,
  sourceType: ActivityFact["sourceType"],
  closeUserId: string | null,
  leadId: string | null,
  occurredAt: string,
): ActivityFact {
  return {
    sourceActivityId,
    sourceType,
    closeUserId,
    leadId,
    occurredAt,
    callsGross: 0,
    callsNet: 0,
    talkSeconds: 0,
    gatekeeperContacts: 0,
    connectedCalls: 0,
    directDecisionMakerCalls: 0,
    decisionMakerContacts: 0,
    appointments: 0,
    setterCalls: 0,
    setterSuccesses: 0,
    closerCalls: 0,
    closerSecondCalls: 0,
    closerSales: 0,
    noShows: 0,
    cancellations: 0,
    rescheduledAppointments: 0,
    productFocus: null,
    mappingVersion: MAPPING_VERSION,
  };
}

function fieldValue(activity: CloseCustomActivity, fieldId: string): CustomValue {
  return activity.custom_fields?.find((field) => field.id === fieldId)?.value ?? null;
}

function stringValue(value: CustomValue): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function mapCall(call: CloseCall): ActivityFact {
  const fact = emptyActivityFact(
    call.id,
    "call",
    call.user_id ?? null,
    call.lead_id ?? null,
    call.activity_at,
  );
  const isFinalOutbound = call.direction === "outbound" && FINAL_CALL_STATUSES.has(call.status ?? "");
  const isAnswered = isFinalOutbound && call.status === "completed" && call.disposition === "answered";

  fact.callsGross = isFinalOutbound ? 1 : 0;
  fact.callsNet = isAnswered ? 1 : 0;
  fact.talkSeconds = isAnswered ? Math.max(0, call.duration ?? 0) : 0;
  return fact;
}

export function mapCustomActivity(activity: CloseCustomActivity): ActivityFact | null {
  if (activity.status !== "published") return null;

  const fact = emptyActivityFact(
    activity.id,
    "custom_activity",
    activity.user_id ?? null,
    activity.lead_id,
    activity.activity_at,
  );

  if (activity.custom_activity_type_id === ACTIVITY_TYPES.openingCall || activity.custom_activity_type_id === ACTIVITY_TYPES.followUp) {
    const isOpening = activity.custom_activity_type_id === ACTIVITY_TYPES.openingCall;
    const gatekeeperResult = stringValue(fieldValue(activity, isOpening ? CUSTOM_FIELDS.openingGatekeeperResult : CUSTOM_FIELDS.followUpGatekeeperResult));
    const decisionMakerResult = stringValue(fieldValue(activity, isOpening ? CUSTOM_FIELDS.openingDecisionMakerResult : CUSTOM_FIELDS.followUpDecisionMakerResult));
    fact.productFocus = stringValue(fieldValue(activity, isOpening ? CUSTOM_FIELDS.openingProductFocus : CUSTOM_FIELDS.followUpProductFocus));
    fact.gatekeeperContacts = gatekeeperResult && gatekeeperResult !== "🛑 Kein Gatekeeper" ? 1 : 0;
    fact.connectedCalls = gatekeeperResult === "✅ Durchgestellt" ? 1 : 0;
    fact.directDecisionMakerCalls = gatekeeperResult === "🛑 Kein Gatekeeper" ? 1 : 0;
    fact.decisionMakerContacts = decisionMakerResult ? 1 : 0;
    fact.appointments = decisionMakerResult && APPOINTMENT_RESULTS.has(decisionMakerResult) ? 1 : 0;
    return fact;
  }

  if (activity.custom_activity_type_id === ACTIVITY_TYPES.setterCall) {
    const setterResult = stringValue(fieldValue(activity, CUSTOM_FIELDS.setterResult));
    fact.setterCalls = 1;
    fact.setterSuccesses = setterResult && SETTER_SUCCESS_RESULTS.has(setterResult) ? 1 : 0;
    return fact;
  }

  if (activity.custom_activity_type_id === ACTIVITY_TYPES.closerCall) {
    const closerResult = stringValue(fieldValue(activity, CUSTOM_FIELDS.closerResult));
    fact.closerCalls = 1;
    fact.closerSecondCalls = closerResult && CLOSER_SECOND_CALL_RESULTS.has(closerResult) ? 1 : 0;
    fact.closerSales = closerResult && CLOSER_SALE_RESULTS.has(closerResult) ? 1 : 0;
    return fact;
  }

  if (activity.custom_activity_type_id === ACTIVITY_TYPES.noShow) {
    const setterNoShow = stringValue(fieldValue(activity, CUSTOM_FIELDS.setterNoShow));
    const closerNoShow = stringValue(fieldValue(activity, CUSTOM_FIELDS.closerNoShow));
    const values = [setterNoShow, closerNoShow].filter(Boolean);
    fact.noShows = values.includes("Nicht erschienen") ? 1 : 0;
    fact.cancellations = values.includes("⛔ Abgesagt") ? 1 : 0;
    fact.rescheduledAppointments = values.includes("🔄 Termin verschoben") ? 1 : 0;
    return fact;
  }

  return null;
}

export function leadAttribution(customFields: Array<{ id: string; value: CustomValue }>): LeadAttribution {
  const value = (fieldId: string) => stringValue(customFields.find((field) => field.id === fieldId)?.value ?? null);
  return {
    openerUserId: value(CUSTOM_FIELDS.leadOpener),
    setterUserId: value(CUSTOM_FIELDS.leadSetter),
    closerUserId: value(CUSTOM_FIELDS.leadCloser),
  };
}

export function mapWonOpportunity(opportunity: CloseOpportunity, attribution: LeadAttribution) {
  const isSalesPipeline = !opportunity.pipeline_id || opportunity.pipeline_id === SALES_PIPELINE.id;
  const isWon = opportunity.status_type === "won" && SALES_PIPELINE.wonStatusIds.has(opportunity.status_id);
  if (!isSalesPipeline || !isWon || !opportunity.date_won || !attribution.openerUserId) return null;

  return {
    opportunityId: opportunity.id,
    leadId: opportunity.lead_id,
    openerCloseUserId: attribution.openerUserId,
    setterCloseUserId: attribution.setterUserId,
    closerCloseUserId: attribution.closerUserId,
    wonAt: opportunity.date_won.length === 10
      ? `${opportunity.date_won}T12:00:00.000Z`
      : opportunity.date_won,
    valueCents: Math.max(0, opportunity.value ?? 0),
    valuePeriod: opportunity.value_period,
    mappingVersion: MAPPING_VERSION,
  };
}

export function mapNewsletterCompletion(
  subscription: CloseSequenceSubscription,
): NewsletterCompletion | null {
  if (subscription.sequence_id !== NEWSLETTER_WORKFLOW.id) return null;
  if (!COMPLETED_NEWSLETTER_STATUSES.has(subscription.status)) return null;
  if (Number.isNaN(Date.parse(subscription.date_updated))) return null;

  return {
    subscriptionId: subscription.id,
    closeUserId: subscription.created_by_id ?? null,
    completedAt: subscription.date_updated,
    status: subscription.status as NewsletterCompletion["status"],
    mappingVersion: MAPPING_VERSION,
  };
}
