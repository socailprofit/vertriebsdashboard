import { CLOSE_USERS, metricTimeInReportingTimezone } from "./close-mapping.ts";

type Row = Record<string, unknown>;
type Booking = { source_activity_id: string; lead_id: string | null; close_user_id: string | null; occurred_at: string };
export const MEETING_FIELDS = ["id", "lead_id", "contact_id", "user_id", "users", "attendees", "status",
  "starts_at", "ends_at", "date_created", "date_updated", "title", "calendar_event_uids"];
const SALES_USERS: Set<string> = new Set(Object.values(CLOSE_USERS));
const timestamp = (v: unknown): v is string => typeof v === "string"
  && /T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const nullableId = (v: unknown) => typeof v === "string" && v.length ? v : null;

export function isObservedAt(eventAt: string, dataAsOf: string) {
  if (!timestamp(eventAt) || !timestamp(dataAsOf)) throw new Error("invalid_observation_timestamp");
  return Date.parse(eventAt) <= Date.parse(dataAsOf);
}

// Both calendar dates are inclusive in the Berlin reporting timezone.
// In particular, Jan 1–Feb 1 includes all of Feb 1, including 23:59:59.
export function meetingWithinDates(startsAt: string, startDate: string, endDate: string) {
  for (const date of [startDate, endDate]) if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
    || new Date(`${date}T00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("invalid_meeting_date_range");
  if (endDate < startDate || !timestamp(startsAt)) throw new Error("invalid_meeting_date_range");
  const day = metricTimeInReportingTimezone(startsAt).metricDate;
  return day >= startDate && day <= endDate;
}

export type MeetingRow = {
  meeting_id: string; lead_id: string | null; contact_id: string | null; owner_id: string | null;
  starts_at: string; ends_at: string; date_created: string; date_updated: string;
  status: string | null; participant_ids: Array<{contact_id: string | null; user_id: string | null; status: string | null}>;
  calendar_event_uids: string[]; excluded_purpose: boolean;
  booking_activity_id: string | null; booking_owner_id: string | null;
};

export type MeetingLink = Pick<MeetingRow, "meeting_id" | "lead_id" | "booking_activity_id" | "booking_owner_id">;

export function prepareMeetingSnapshot(records: Row[], bookings: Booking[], dataAsOf: string, previousLinks: MeetingLink[] = []) {
  if (!timestamp(dataAsOf)) throw new Error("invalid_meeting_snapshot_time");
  const byId = new Map<string, MeetingRow>();
  for (const row of records) {
    if (typeof row.id !== "string" || !timestamp(row.starts_at) || !timestamp(row.ends_at)
      || !timestamp(row.date_created) || !timestamp(row.date_updated)
      || Date.parse(row.ends_at) < Date.parse(row.starts_at)) throw new Error("invalid_meeting_record");
    // A paginated snapshot must not mix changes made after its observation time.
    // The next complete sync picks those updates up.
    if (!isObservedAt(row.date_created, dataAsOf)) continue;
    const attendees = Array.isArray(row.attendees) ? row.attendees as Row[] : [];
    const participantUsers = [...new Set([row.user_id, ...(Array.isArray(row.users) ? row.users : []),
      ...attendees.map(a => a.user_id)].filter((x): x is string => typeof x === "string" && SALES_USERS.has(x)))];
    if (!participantUsers.length) continue;
    const owner = typeof row.user_id === "string" && SALES_USERS.has(row.user_id) ? row.user_id
      : participantUsers.length === 1 ? participantUsers[0] : null;
    const meeting: MeetingRow = {
      meeting_id: row.id, lead_id: nullableId(row.lead_id), contact_id: nullableId(row.contact_id), owner_id: owner,
      starts_at: row.starts_at, ends_at: row.ends_at, date_created: row.date_created, date_updated: row.date_updated,
      status: nullableId(row.status), participant_ids: attendees.map(a => ({contact_id: nullableId(a.contact_id),
        user_id: nullableId(a.user_id), status: nullableId(a.status)})),
      calendar_event_uids: Array.isArray(row.calendar_event_uids) ? row.calendar_event_uids.filter((x): x is string => typeof x === "string") : [],
      // These observed calendar categories are not Setter appointments. Titles
      // are inspected only for exclusion and are never persisted in the snapshot.
      excluded_purpose: /coaching|onboarding|videodreh|strategieberatung|^beratung\s*:/i.test(String(row.title ?? "")),
      booking_activity_id: null, booking_owner_id: null,
    };
    const old = byId.get(meeting.meeting_id);
    if (old && JSON.stringify(old) !== JSON.stringify(meeting)) throw new Error("unstable_meeting_pagination");
    byId.set(meeting.meeting_id, meeting);
  }
  const meetings = [...byId.values()];
  // An already proven booking belongs to its stable Close meeting ID even
  // after a move past another meeting. Never guess a replacement from its title.
  const retainedBookings = new Set<string>();
  for (const old of previousLinks) {
    const meeting = byId.get(old.meeting_id);
    const booking = bookings.find(b => b.source_activity_id === old.booking_activity_id);
    if (!meeting || !booking || meeting.excluded_purpose || !meeting.owner_id
      || meeting.lead_id !== old.lead_id || booking.lead_id !== meeting.lead_id
      || booking.close_user_id !== old.booking_owner_id || !booking.close_user_id
      || !SALES_USERS.has(booking.close_user_id) || !isObservedAt(booking.occurred_at, dataAsOf)
      || Date.parse(booking.occurred_at) > Date.parse(meeting.starts_at)) continue;
    if (retainedBookings.has(booking.source_activity_id)) throw new Error("ambiguous_stored_meeting_link");
    meeting.booking_activity_id = booking.source_activity_id;
    meeting.booking_owner_id = booking.close_user_id;
    retainedBookings.add(booking.source_activity_id);
  }
  const nominations = new Map<string, Booking[]>();
  let withoutMeeting = 0, ambiguous = 0;
  for (const booking of bookings) {
    if (retainedBookings.has(booking.source_activity_id)) continue;
    if (!booking.lead_id || !booking.close_user_id || !SALES_USERS.has(booking.close_user_id) || !isObservedAt(booking.occurred_at, dataAsOf)) continue;
    const candidates = meetings.filter(m => m.lead_id === booking.lead_id && m.owner_id && !m.excluded_purpose
      && Date.parse(m.starts_at) >= Date.parse(booking.occurred_at))
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
    if (!candidates.length) { withoutMeeting++; continue; }
    const first = candidates[0];
    if (candidates.length > 1 && Date.parse(first.starts_at) === Date.parse(candidates[1].starts_at)) { ambiguous++; continue; }
    nominations.set(first.meeting_id, [...(nominations.get(first.meeting_id) ?? []), booking]);
  }
  for (const meeting of meetings) {
    const nominated = nominations.get(meeting.meeting_id) ?? [];
    if (meeting.booking_activity_id) { ambiguous += nominated.length; continue; }
    if (nominated.length > 1) { ambiguous += nominated.length; continue; }
    if (nominated.length === 1) {
      meeting.booking_activity_id = nominated[0].source_activity_id;
      meeting.booking_owner_id = nominated[0].close_user_id;
    }
  }
  return { meetings, diagnostics: { total: meetings.length, linked: meetings.filter(m => m.booking_activity_id).length,
    future: meetings.filter(m => Date.parse(m.starts_at) > Date.parse(dataAsOf)).length,
    withoutMeeting, ambiguous, excludedPurpose: meetings.filter(m => m.excluded_purpose).length,
    withLead: meetings.filter(m => m.lead_id).length, withOwner: meetings.filter(m => m.owner_id).length,
    withStatus: meetings.filter(m => m.status).length, withParticipants: meetings.filter(m => m.participant_ids.length).length } };
}
