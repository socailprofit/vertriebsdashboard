import { type MeetingRow } from "./close-meetings.ts";
import { REPORTING_TIMEZONE } from "./close-mapping.ts";

export const PROCESS_RULE_VERSION = "2026-09-08.explicit-process-v1";
export const REPLACEMENT_WINDOW_MS = 48 * 60 * 60 * 1000;
export type ProcessBooking = { source_activity_id: string; lead_id: string | null; close_user_id: string | null; occurred_at: string };
export type ProcessEventType = "booking" | "setter_completed" | "setter_qualified" | "setter_follow_up" | "setter_disqualified"
  | "setter_cancelled" | "setter_rescheduled" | "setter_no_show" | "closer_completed" | "cc2_agreed" | "closer_follow_up"
  | "closer_lost" | "closer_sold" | "cc2_sold" | "closer_cancelled" | "closer_rescheduled" | "closer_no_show" | "customer_won" | "status_changed";
export type ProcessEvent = { source_event_id: string; source_kind?: string; lead_id: string; occurred_at: string;
  occurred_at_precision?: "date" | "timestamp"; event_type: ProcessEventType; meeting_id?: string | null; setter_id?: string | null; closer_id?: string | null };
export type ProcessStage = "setter" | "closer" | "cc2" | "customer";
export type ProcessState = "scheduled" | "awaiting_result" | "follow_up" | "rescheduled" | "cancelled" | "no_show" | "disqualified" | "lost" | "sold_pending_won" | "won" | "unclear";
export type ProcessMeetingRevision = { meeting_id: string; source_updated_at: string; old_starts_at: string; new_starts_at: string };
export type FunnelProcess = {
  process_id: string; lead_id: string; opening_booking_id: string | null; opened_at: string; documented_booking: boolean;
  booking_owner_id: string | null; first_meeting_at: string | null; initial_planned_at: string | null;
  current_meeting_id: string | null; current_meeting_at: string | null; next_meeting_id: string | null; next_meeting_at: string | null;
  stage: ProcessStage; state: ProcessState; latest_event_id: string | null; latest_event_at: string | null;
  setter_id: string | null; closer_id: string | null; setter_at: string | null; qualified_at: string | null;
  closer_at: string | null; cc2_at: string | null; won_at: string | null; closed_at: string | null; closed_at_precision: "date" | "timestamp" | null;
  previous_process_id: string | null; rule_version: string;
};
export type MeetingProcessRelation = {
  meeting_id: string; lead_id: string; process_id: string; relation_type: "original" | "replacement" | "continuation" | "ambiguous";
  replaces_meeting_id: string | null; superseded_by_meeting_id: string | null; counts_as_setting_success: boolean;
  booking_activity_id: string | null; booking_owner_id: string | null; source_event_id: string | null;
  cancellation_at: string | null; rule_version: string;
  meeting_stage?: "setter" | "closer" | "cc2" | "unassigned";
  stage_basis?: "documented_setter_booking" | "unassigned";
  stage_source_event_id?: string | null;
};
export type ProcessEventRelation = { source_kind: string; source_event_id: string; event_type: ProcessEventType;
  occurred_at: string; occurred_at_precision: "date" | "timestamp"; process_id: string; applies_to_state: boolean; state_conflict?: boolean };

type Input = { meetings: MeetingRow[]; bookings: ProcessBooking[]; events: ProcessEvent[]; dataAsOf: string;
  previousRelations?: MeetingProcessRelation[]; previousProcesses?: FunnelProcess[]; meetingRevisions?: ProcessMeetingRevision[] };
const ms = (s: string) => {
  const parsed=Date.parse(s);
  if (!/T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(s) || !Number.isFinite(parsed)) throw new Error("invalid_process_timestamp");
  return parsed;
};
const cancelled = (m: MeetingRow) => ["canceled", "cancelled", "declined-by-lead"].includes(m.status ?? "");
const performed = (e: ProcessEvent) => ["setter_completed", "setter_qualified", "setter_follow_up", "setter_disqualified"].includes(e.event_type);
const closerPerformed = (e: ProcessEvent) => ["closer_completed", "cc2_agreed", "closer_follow_up", "closer_lost", "closer_sold", "cc2_sold"].includes(e.event_type);
const negativeSetter = (e: ProcessEvent) => ["setter_no_show", "setter_cancelled", "setter_rescheduled"].includes(e.event_type);
const terminal = (e: ProcessEvent) => ["setter_disqualified", "closer_lost", "customer_won"].includes(e.event_type);
const key = (e: ProcessEvent) => `${e.source_kind ?? "custom_activity"}:${e.source_event_id}`;
const sorted = <T>(values: T[], time: (value: T) => string, id: (value: T) => string) => [...values].sort((a, b) => ms(time(a)) - ms(time(b)) || id(a).localeCompare(id(b)));
const minimum = (a: string | null, b: string) => !a || ms(b) < ms(a) ? b : a;
function groupBy<T>(values: T[], getKey: (value: T) => string) {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const k = getKey(value), group=groups.get(k);
    if(group)group.push(value);else groups.set(k,[value]);
  }
  return groups;
}

function newProcess(leadId: string, at: string, booking: ProcessBooking | undefined, event: ProcessEvent | undefined,
  previousProcessId: string | null): FunnelProcess {
  return { process_id: booking ? `close-process:${booking.source_activity_id}` : `close-process:undocumented:${event!.source_event_id}`,
    lead_id: leadId, opening_booking_id: booking?.source_activity_id ?? null, opened_at: at, documented_booking: !!booking,
    booking_owner_id: booking?.close_user_id ?? null, first_meeting_at: null, initial_planned_at: null,
    current_meeting_id: null, current_meeting_at: null, next_meeting_id: null, next_meeting_at: null,
    stage: "setter", state: booking ? "scheduled" : "awaiting_result", latest_event_id: null, latest_event_at: null,
    setter_id: null, closer_id: null, setter_at: null, qualified_at: null, closer_at: null, cc2_at: null,
    won_at: null, closed_at: null, closed_at_precision: null, previous_process_id: previousProcessId, rule_version: PROCESS_RULE_VERSION };
}

function recordPerformed(p: FunnelProcess, e: ProcessEvent) {
  if (e.setter_id) p.setter_id = e.setter_id;
  if (e.closer_id) p.closer_id = e.closer_id;
  if (performed(e)) p.setter_at = minimum(p.setter_at, e.occurred_at);
  if (closerPerformed(e)) p.closer_at = minimum(p.closer_at, e.occurred_at);
}
function applyEvent(p: FunnelProcess, e: ProcessEvent) {
  p.latest_event_id = e.source_event_id; p.latest_event_at = e.occurred_at;
  recordPerformed(p,e);
  switch (e.event_type) {
    case "setter_completed": p.stage = "setter"; p.state = "awaiting_result"; break;
    case "setter_qualified": p.stage = "closer"; p.state = "scheduled"; p.qualified_at = minimum(p.qualified_at, e.occurred_at); break;
    case "setter_follow_up": p.stage = "setter"; p.state = "follow_up"; break;
    case "setter_disqualified": p.stage = "setter"; p.state = "disqualified"; break;
    case "setter_cancelled": p.stage = "setter"; p.state = "cancelled"; break;
    case "setter_rescheduled": p.stage = "setter"; p.state = "rescheduled"; break;
    case "setter_no_show": p.stage = "setter"; p.state = "no_show"; break;
    case "closer_completed": p.stage = "closer"; p.state = "awaiting_result"; break;
    case "cc2_agreed": p.stage = "cc2"; p.state = "scheduled"; p.cc2_at = minimum(p.cc2_at, e.occurred_at); break;
    case "closer_follow_up": p.stage = p.cc2_at ? "cc2" : "closer"; p.state = "follow_up"; break;
    case "closer_lost": p.stage = p.cc2_at ? "cc2" : "closer"; p.state = "lost"; break;
    case "closer_sold": p.stage = "closer"; p.state = "sold_pending_won"; break;
    case "cc2_sold": p.stage = "cc2"; p.state = "sold_pending_won"; p.cc2_at = minimum(p.cc2_at, e.occurred_at); break;
    case "closer_cancelled": p.stage = p.cc2_at ? "cc2" : "closer"; p.state = "cancelled"; break;
    case "closer_rescheduled": p.stage = p.cc2_at ? "cc2" : "closer"; p.state = "rescheduled"; break;
    case "closer_no_show": p.stage = p.cc2_at ? "cc2" : "closer"; p.state = "no_show"; break;
    case "customer_won": p.stage = "customer"; p.state = "won"; p.won_at = minimum(p.won_at, e.occurred_at); break;
  }
  if (terminal(e)) { p.closed_at = e.occurred_at; p.closed_at_precision = e.occurred_at_precision ?? "timestamp"; }
}

/**
 * Replay documented business events, never lead-status labels, into durable
 * acquisition processes. A booking alone cannot reopen an active process.
 * Calendar metadata never creates performed calls, qualifications or customers.
 */
export function deriveCloseProcesses(input: Input) {
  const asOf = ms(input.dataAsOf);
  const diagnostics = { replacements: 0, ambiguousReplacements: 0, undocumentedProcesses: 0, ignoredFutureEvents: 0,
    eventsAfterTerminalWithoutBooking: 0, unassignedNegativeEvents: 0, preservedReplacementLinks: 0,
    supersededTimeEvidence: 0, conflictingStateGroups: 0 };
  const bookings = sorted(input.bookings.filter(b => b.lead_id && b.close_user_id && ms(b.occurred_at) <= asOf), b => b.occurred_at, b => b.source_activity_id);
  const bookingById = new Map(bookings.map(b => [b.source_activity_id, b]));
  if (bookingById.size !== bookings.length) throw new Error("duplicate_process_booking");
  const meetings = input.meetings.filter(m => m.lead_id && m.owner_id && !m.excluded_purpose && ms(m.date_created) <= asOf);
  const meetingById = new Map(meetings.map(m => [m.meeting_id, m]));
  if (meetingById.size !== meetings.length) throw new Error("duplicate_process_meeting");
  const revisionSince = new Map<string, number>();
  for (const revision of input.meetingRevisions ?? []) {
    const updatedAt = ms(revision.source_updated_at);
    if (ms(revision.old_starts_at) === ms(revision.new_starts_at) || updatedAt > asOf || !meetingById.has(revision.meeting_id)) continue;
    revisionSince.set(revision.meeting_id, Math.max(revisionSince.get(revision.meeting_id) ?? -Infinity, updatedAt));
  }
  const previousRelationById = new Map((input.previousRelations ?? []).map(r => [r.meeting_id, r]));
  const bookingFor = (m: MeetingRow): ProcessBooking | undefined => {
    const prior = previousRelationById.get(m.meeting_id);
    const id = m.booking_activity_id ?? (prior?.relation_type === "replacement" && prior.lead_id === m.lead_id ? prior.booking_activity_id : null);
    const b = id ? bookingById.get(id) : undefined;
    return b?.lead_id === m.lead_id ? b : undefined;
  };
  const observedEvents = input.events.filter(e => {
    if (ms(e.occurred_at) > asOf) { diagnostics.ignoredFutureEvents++; return false; }
    const m = e.meeting_id ? meetingById.get(e.meeting_id) : undefined;
    if (m && (performed(e) || e.event_type.endsWith("no_show")) && ms(m.starts_at) > asOf) {
      diagnostics.ignoredFutureEvents++; return false;
    }
    return true;
  });
  const eventByIdentity = new Map<string, ProcessEvent>();
  for (const e of observedEvents) {
    const identity = `${key(e)}:${e.event_type}`, previous = eventByIdentity.get(identity);
    if (previous && (previous.lead_id !== e.lead_id || previous.occurred_at !== e.occurred_at
      || (previous.meeting_id ?? null) !== (e.meeting_id ?? null) || (previous.setter_id ?? null) !== (e.setter_id ?? null)
      || (previous.closer_id ?? null) !== (e.closer_id ?? null)
      || (previous.occurred_at_precision ?? "timestamp") !== (e.occurred_at_precision ?? "timestamp"))) throw new Error("conflicting_process_event");
    eventByIdentity.set(identity, e);
  }
  const events = sorted([...eventByIdentity.values()], e => e.occurred_at, e => `${key(e)}:${e.event_type}`);
  const meetingsByLead = groupBy(meetings, m => m.lead_id!);
  const eventsByLead = groupBy(events, e => e.lead_id);
  const bookingsByLead = groupBy(bookings, b => b.lead_id!);
  const nextBookedStart=new Map<string,number>();
  for(const sameLead of meetingsByLead.values()) {
    const ordered=sorted(sameLead.filter(m=>bookingFor(m)),m=>m.starts_at,m=>m.meeting_id);
    let next=Infinity;
    for(let end=ordered.length;end>0;) {
      let start=end-1;
      const at=ms(ordered[start].starts_at);
      while(start>0&&ms(ordered[start-1].starts_at)===at)start--;
      for(let i=start;i<end;i++)nextBookedStart.set(ordered[i].meeting_id,next);
      next=at;end=start;
    }
  }
  const bookingEvents = new Map<string,ProcessEvent>();
  for(const e of events)if(e.event_type==='booking') {
    const id=`${e.lead_id}:${e.source_event_id}`;
    if(!bookingEvents.has(id))bookingEvents.set(id,e);
  }
  const reportingDays = new Map<string, string>();
  const dayFormatter = new Intl.DateTimeFormat('en-US',{timeZone:REPORTING_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'});
  const day = (at: string) => {
    if (!reportingDays.has(at)) {
      const parts=Object.fromEntries(dayFormatter.formatToParts(new Date(at)).map(p=>[p.type,p.value]));
      reportingDays.set(at,`${parts.year}-${parts.month}-${parts.day}`);
    }
    return reportingDays.get(at)!;
  };
  const conflictingEvents = new Set<ProcessEvent>();
  const endedBefore = (e: ProcessEvent, at: string) => terminal(e) && !conflictingEvents.has(e) && ms(e.occurred_at) < ms(at)
    && (e.occurred_at_precision !== "date" || day(e.occurred_at) < day(at));

  // Attribution is deliberately strict: unlinked negative evidence is used
  // only when one documented meeting can own it. An arbitrary lead status is
  // never evidence that a person failed to attend.
  const eventMeeting = new Map<ProcessEvent, MeetingRow>();
  const obsoleteTimeEvidence = new Set<ProcessEvent>();
  for (const e of events.filter(e => performed(e) || negativeSetter(e))) {
    const sameLead = meetingsByLead.get(e.lead_id) ?? [];
    const candidates = sameLead.filter(m => bookingFor(m) && (!e.meeting_id || e.meeting_id === m.meeting_id)
      && ms(bookingFor(m)!.occurred_at) <= ms(e.occurred_at)
      && (previousRelationById.get(m.meeting_id)?.relation_type !== "replacement" || ms(e.occurred_at) >= ms(m.date_created))
      && day(e.occurred_at) <= day(m.ends_at)
      && (!(performed(e) || e.event_type === "setter_no_show") || ms(e.occurred_at) >= ms(m.starts_at))
      && ms(e.occurred_at)<(nextBookedStart.get(m.meeting_id)??Infinity));
    if (candidates.length === 1) {
      if (ms(e.occurred_at) < (revisionSince.get(candidates[0].meeting_id) ?? -Infinity)) {
        if (negativeSetter(e)) { obsoleteTimeEvidence.add(e); diagnostics.supersededTimeEvidence++; }
      } else eventMeeting.set(e, candidates[0]);
    }
  }
  const performedMeetings = new Set(events.filter(performed).map(e => eventMeeting.get(e)?.meeting_id).filter(Boolean));
  const cancellations = new Map<string, ProcessEvent>();
  for (const e of events) if (["setter_cancelled", "setter_rescheduled"].includes(e.event_type) && eventMeeting.has(e))
    cancellations.set(eventMeeting.get(e)!.meeting_id, e);

  const stateGroups = groupBy(events.filter(e => !["booking","status_changed"].includes(e.event_type)
    && (!negativeSetter(e) || eventMeeting.has(e) && ms(eventMeeting.get(e)!.starts_at)<=asOf)), e => `${e.lead_id}:${ms(e.occurred_at)}`);
  // Equal timestamps provide no order. Keep the raw activity evidence, but do
  // not let the alphabetic Close ID select a loss, qualification or follow-up.
  for (const group of stateGroups.values()) {
    if (group.length<2 || group.some(e=>e.event_type==='customer_won')) continue; // First Won is conclusive.
    const outcomes = new Set(group.map(e=>{
      const p=newProcess(e.lead_id,e.occurred_at,undefined,e,null); applyEvent(p,e);return `${p.stage}:${p.state}`;
    }));
    if(outcomes.size>1) for(const e of group) conflictingEvents.add(e);
  }

  type Replacement = { old: MeetingRow; next: MeetingRow; at: string; source: string | null };
  const replacements = new Map<string, Replacement>();
  const superseded = new Map<string, string>();
  // Existing proof remains valid across snapshots; updates to unrelated
  // calendar metadata must not erase a previously established replacement.
  for (const prior of input.previousRelations ?? []) {
    if (prior.relation_type !== "replacement" || !prior.replaces_meeting_id || !prior.cancellation_at) continue;
    const old = meetingById.get(prior.replaces_meeting_id), next = meetingById.get(prior.meeting_id);
    if (!old || !next || old.lead_id !== next.lead_id || !bookingFor(old)
      || !cancelled(old) && !cancellations.has(old.meeting_id) || performedMeetings.has(old.meeting_id)) continue;
    const newBooking = next.booking_activity_id ? bookingById.get(next.booking_activity_id) : undefined;
    if (newBooking && (eventsByLead.get(old.lead_id!) ?? []).some(e => endedBefore(e,newBooking.occurred_at)
      && ms(e.occurred_at) >= ms(bookingFor(old)!.occurred_at))) continue;
    if (superseded.has(old.meeting_id)) throw new Error("conflicting_previous_replacement");
    replacements.set(next.meeting_id, { old, next, at: prior.cancellation_at, source: prior.source_event_id });
    superseded.set(old.meeting_id, next.meeting_id); diagnostics.preservedReplacementLinks++;
  }
  const candidates: Replacement[] = [];
  for (const old of meetings) {
    if (!bookingFor(old) || superseded.has(old.meeting_id)
      || performedMeetings.has(old.meeting_id)) continue;
    const oldBooking = bookingFor(old)!;
    const cancellation = cancellations.get(old.meeting_id);
    const at = cancellation?.occurred_at ?? (cancelled(old) && ms(old.date_updated) <= asOf ? old.date_updated : null);
    if (!at) continue;
    for (const next of meetingsByLead.get(old.lead_id!) ?? []) {
      if (old.meeting_id === next.meeting_id || replacements.has(next.meeting_id)
        || cancelled(next) || ms(next.starts_at) < ms(at)) continue;
      const created = next.booking_activity_id ? bookingById.get(next.booking_activity_id)?.occurred_at ?? next.date_created : next.date_created;
      const delay = ms(created) - ms(at);
      if (delay < 0 || delay > REPLACEMENT_WINDOW_MS || ms(next.date_created) < ms(old.date_created)) continue;
      // An explicitly completed process followed by a new booking is a new
      // sales process, even if a stale cancelled calendar entry still exists.
      if ((eventsByLead.get(old.lead_id!) ?? []).some(e => endedBefore(e,created)
        && ms(e.occurred_at) >= ms(oldBooking.occurred_at))) continue;
      candidates.push({ old, next, at, source: cancellation?.source_event_id ?? old.meeting_id });
    }
  }
  const ambiguous = new Set<string>();
  const candidateOldCounts=new Map<string,number>(),candidateNewCounts=new Map<string,number>();
  for(const c of candidates) {
    candidateOldCounts.set(c.old.meeting_id,(candidateOldCounts.get(c.old.meeting_id)??0)+1);
    candidateNewCounts.set(c.next.meeting_id,(candidateNewCounts.get(c.next.meeting_id)??0)+1);
  }
  for (const c of candidates) {
    if (candidateOldCounts.get(c.old.meeting_id) !== 1 || candidateNewCounts.get(c.next.meeting_id) !== 1) {
      ambiguous.add(c.next.meeting_id); continue;
    }
    replacements.set(c.next.meeting_id, c); superseded.set(c.old.meeting_id, c.next.meeting_id);
  }
  diagnostics.replacements = replacements.size; diagnostics.ambiguousReplacements = ambiguous.size;

  const processes: FunnelProcess[] = [], eventRelations: ProcessEventRelation[] = [];
  const countedConflicts = new Set<string>();
  const bookingProcess = new Map<string, FunnelProcess>();
  const processById=new Map<string,FunnelProcess>(),processesByLead=new Map<string,FunnelProcess[]>();
  const leads = new Set([...bookings.map(b => b.lead_id!), ...events.filter(e => e.event_type !== "status_changed").map(e => e.lead_id)]);
  for (const leadId of [...leads].sort()) {
    const timeline = [
      ...(bookingsByLead.get(leadId) ?? []).map(booking => ({ at: booking.occurred_at, booking, event: undefined as ProcessEvent | undefined })),
      ...(eventsByLead.get(leadId) ?? []).filter(e => e.event_type !== "booking" && e.event_type !== "status_changed")
        .map(event => ({ at: event.occurred_at, booking: undefined as ProcessBooking | undefined, event })),
    ].sort((a, b) => ms(a.at) - ms(b.at) || (a.booking ? -1 : 1) - (b.booking ? -1 : 1)
      || (a.booking?.source_activity_id ?? key(a.event!)).localeCompare(b.booking?.source_activity_id ?? key(b.event!)));
    let current: FunnelProcess | undefined;
    for (const item of timeline) {
      const e = item.event;
      if (e && negativeSetter(e) && !eventMeeting.has(e) && !obsoleteTimeEvidence.has(e)) { diagnostics.unassignedNegativeEvents++; continue; }
      if (!current || item.booking && current.closed_at && ms(item.at) > ms(current.closed_at)
        && (current.closed_at_precision !== "date" || day(item.at) > day(current.closed_at))) {
        // A date-only Won's computational midnight does not predate a known
        // booking on that same business day. Use its real source identity;
        // otherwise a fully documented same-day process would look unbooked.
        const openingBooking = item.booking ?? (!current && e?.event_type==='customer_won' && e.occurred_at_precision==='date'
          ? (bookingsByLead.get(leadId)??[]).find(b=>day(b.occurred_at)===day(e.occurred_at)) : undefined);
        current = newProcess(leadId, openingBooking?.occurred_at ?? item.at, openingBooking, e, current?.process_id ?? null); processes.push(current);
        processById.set(current.process_id,current);
        const leadProcesses=processesByLead.get(leadId);
        if(leadProcesses)leadProcesses.push(current);else processesByLead.set(leadId,[current]);
        if (!openingBooking) diagnostics.undocumentedProcesses++;
      }
      if (item.booking) {
        bookingProcess.set(item.booking.source_activity_id, current);
        const bookingEvent = bookingEvents.get(`${leadId}:${item.booking.source_activity_id}`);
        eventRelations.push({ source_kind: bookingEvent?.source_kind ?? "custom_activity", source_event_id: item.booking.source_activity_id,
          event_type: "booking", occurred_at: item.booking.occurred_at, occurred_at_precision: "timestamp", process_id: current.process_id, applies_to_state: true });
        continue;
      }
      const relation:ProcessEventRelation = { source_kind: e!.source_kind ?? "custom_activity", source_event_id: e!.source_event_id,
        event_type: e!.event_type, occurred_at: e!.occurred_at, occurred_at_precision: e!.occurred_at_precision ?? "timestamp", process_id: current.process_id, applies_to_state: false };
      eventRelations.push(relation);
      // The first verified customer acquisition is conclusive even when an
      // earlier conversation was recorded as lost. It closes the same process;
      // it does not require an invented rebooking or create a second customer.
      const afterDateOnlyWon = current.state==='won' && current.closed_at_precision==='date' && current.closed_at
        && day(current.closed_at)===day(e!.occurred_at) && (performed(e!) || closerPerformed(e!));
      if (current.closed_at && e!.event_type !== "customer_won" && !afterDateOnlyWon) { diagnostics.eventsAfterTerminalWithoutBooking++; continue; }
      if (obsoleteTimeEvidence.has(e!)) continue;
      const m = eventMeeting.get(e!);
      if (m && (negativeSetter(e!) && (superseded.has(m.meeting_id) || ms(m.starts_at) > asOf))) continue;
      if (conflictingEvents.has(e!)) {
        recordPerformed(current,e!);
        relation.state_conflict=true;
        const groupKey=`${e!.lead_id}:${ms(e!.occurred_at)}`;
        if (!countedConflicts.has(groupKey)) { countedConflicts.add(groupKey);diagnostics.conflictingStateGroups++; }
        if(!afterDateOnlyWon) {
          current.state='unclear';current.latest_event_at=e!.occurred_at;current.latest_event_id=null;
          const group=stateGroups.get(groupKey)!;
          if(group.every(e=>e.event_type.startsWith('setter_')))current.stage='setter';
          else if(group.every(e=>e.event_type.startsWith('closer_')||e.event_type.startsWith('cc2_')))current.stage=current.cc2_at?'cc2':'closer';
        }
        continue;
      }
      relation.applies_to_state = true;
      const won = afterDateOnlyWon ? {stage:current.stage,state:current.state,won_at:current.won_at,
        closed_at:current.closed_at,closed_at_precision:current.closed_at_precision} : null;
      applyEvent(current, e!);
      // A date-only Won has no evidenced within-day order. Preserve actual
      // same-day milestones and canonical Won without fabricating a reopen.
      if(won)Object.assign(current,won);
    }
  }

  const relations = new Map<string, MeetingProcessRelation>();
  function assignMeeting(m: MeetingRow, visiting = new Set<string>()): MeetingProcessRelation | undefined {
    if (relations.has(m.meeting_id)) return relations.get(m.meeting_id);
    if (visiting.has(m.meeting_id)) throw new Error("cyclic_replacement_chain");
    visiting.add(m.meeting_id);
    const replacement = replacements.get(m.meeting_id);
    const parent = replacement ? assignMeeting(replacement.old, visiting) : undefined;
    const own = m.booking_activity_id ? bookingProcess.get(m.booking_activity_id) : undefined;
    const p = parent ? processById.get(parent.process_id) : own;
    if (!p || !m.lead_id) return undefined;
    const r: MeetingProcessRelation = {
      meeting_id: m.meeting_id, lead_id: m.lead_id, process_id: p.process_id,
      relation_type: replacement ? "replacement" : ambiguous.has(m.meeting_id) ? "ambiguous"
        : m.booking_activity_id === p.opening_booking_id ? "original" : "continuation",
      replaces_meeting_id: replacement?.old.meeting_id ?? null, superseded_by_meeting_id: superseded.get(m.meeting_id) ?? null,
      counts_as_setting_success: false, booking_activity_id: m.booking_activity_id ?? parent?.booking_activity_id ?? null,
      booking_owner_id: m.booking_owner_id ?? parent?.booking_owner_id ?? null,
      source_event_id: replacement?.source ?? null, cancellation_at: replacement?.at ?? null, rule_version: PROCESS_RULE_VERSION,
      // Only the existing, proven Setter path is active. No calendar title or
      // current lead stage may manufacture Closer/CC2 scheduling evidence.
      meeting_stage:"setter",stage_basis:"documented_setter_booking",
      stage_source_event_id:m.booking_activity_id ?? parent?.booking_activity_id ?? null,
    };
    relations.set(m.meeting_id, r); return r;
  }
  const orderedMeetings=sorted(meetings, m => m.starts_at, m => m.meeting_id);
  for (const m of orderedMeetings) assignMeeting(m);
  const meetingsByProcess=new Map<string,MeetingRow[]>();
  for(const m of orderedMeetings) {
    const id=relations.get(m.meeting_id)?.process_id;
    if(!id)continue;
    const group=meetingsByProcess.get(id);
    if(group)group.push(m);else meetingsByProcess.set(id,[m]);
  }

  // Resolve records first, then derive the live calendar pointer. A replacement
  // in October remains attached to its original process and is automatically
  // visible in October without cloning a booking or a completed Setter call.
  for (const p of processes) {
    const all = meetingsByProcess.get(p.process_id)??[];
    p.initial_planned_at = all[0]?.starts_at ?? null;
    const active = all.filter(m => !superseded.has(m.meeting_id) && !ambiguous.has(m.meeting_id));
    p.first_meeting_at = active[0]?.starts_at ?? null;
    const current = active.filter(m => ms(m.starts_at) <= asOf).at(-1);
    const next = active.find(m => ms(m.starts_at) > asOf && !cancelled(m));
    p.current_meeting_id = current?.meeting_id ?? null; p.current_meeting_at = current?.starts_at ?? null;
    if (!p.closed_at) { p.next_meeting_id = next?.meeting_id ?? null; p.next_meeting_at = next?.starts_at ?? null; }
    // Exactly one initial setting success per documented process, assigned to
    // the effective first slot. Cancelled originals replaced by later dates
    // cannot inflate either month. Later calls remain real activity elsewhere.
    const first = active[0];
    if (first && p.documented_booking) relations.get(first.meeting_id)!.counts_as_setting_success = true;
    if (!p.closed_at && p.state!=='unclear' && p.stage === "setter" && next && (!p.setter_at || ["cancelled", "no_show", "rescheduled"].includes(p.state))) {
      p.state = relations.get(next.meeting_id)?.relation_type === "replacement" ? "rescheduled" : "scheduled";
    } else if (!p.closed_at && p.stage === "setter" && !p.setter_at && current && p.state === "scheduled") {
      p.state = cancelled(current) ? "cancelled" : "awaiting_result";
    }
  }
  // Status transitions are journal evidence, never an automatic performance
  // event. Attach them by their effective time for traceability only.
  // Preserve the last-created eligible process even if a date-only source
  // anchor makes opening timestamps non-monotonic; no global process scan.
  const processTimeIndex=new Map<string,Array<{at:number;process:FunnelProcess}>>();
  for(const [leadId,leadProcesses]of processesByLead) {
    const ordered=leadProcesses.map((process,order)=>({process,order,at:ms(process.opened_at)})).sort((a,b)=>a.at-b.at||a.order-b.order);
    let lastOrder=-1,lastProcess:FunnelProcess;
    processTimeIndex.set(leadId,ordered.map(entry=>{
      if(entry.order>lastOrder){lastOrder=entry.order;lastProcess=entry.process;}
      return {at:entry.at,process:lastProcess!};
    }));
  }
  for (const e of events.filter(e => e.event_type === "status_changed")) {
    const index=processTimeIndex.get(e.lead_id)??[],at=ms(e.occurred_at);
    let low=0,high=index.length;
    while(low<high){const mid=(low+high)>>>1;if(index[mid].at<=at)low=mid+1;else high=mid;}
    const p=low>0?index[low-1].process:undefined;
    if (p) eventRelations.push({ source_kind: e.source_kind ?? "lead_status_change", source_event_id: e.source_event_id,
      event_type: e.event_type, occurred_at: e.occurred_at, occurred_at_precision: e.occurred_at_precision ?? "timestamp", process_id: p.process_id, applies_to_state: false });
  }
  const uniqueRelations = new Map<string, ProcessEventRelation>();
  for (const r of eventRelations) {
    const k = `${r.source_kind}:${r.source_event_id}:${r.event_type}`, old = uniqueRelations.get(k);
    if (old && old.process_id !== r.process_id) throw new Error("event_assigned_to_multiple_processes");
    uniqueRelations.set(k, r);
  }
  return { processes, meetingRelations: [...relations.values()].sort((a, b) => a.meeting_id.localeCompare(b.meeting_id)),
    eventRelations: [...uniqueRelations.values()], diagnostics };
}
