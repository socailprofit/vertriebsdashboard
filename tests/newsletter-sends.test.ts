import test from 'node:test';
import assert from 'node:assert/strict';
import { mapNewsletterSend, NEWSLETTER_WORKFLOW, CLOSE_USERS, metricTimeInReportingTimezone } from '../supabase/functions/_shared/close-mapping.ts';

const sent = { id: 'email-1', sequence_id: NEWSLETTER_WORKFLOW.id, user_id: CLOSE_USERS.felix, direction: 'outgoing', status: 'sent', date_sent: '2026-09-06T22:10:00Z' };

test('newsletter counts actual send on Berlin date and attributes the sending user', () => {
  const result = mapNewsletterSend({ ...sent, date_created: '2025-01-01' } as typeof sent);
  assert.equal(result?.emailId, 'email-1');
  assert.equal(result?.closeUserId, CLOSE_USERS.felix);
  assert.equal(metricTimeInReportingTimezone(result!.sentAt).metricDate, '2026-09-07');
});

test('workflow completion, queued, draft and failed emails are not sends', () => {
  for (const status of ['goal', 'finished', 'draft', 'scheduled', 'outbox', 'error', 'inbox']) {
    assert.equal(mapNewsletterSend({ ...sent, status }), null);
  }
});

test('unrelated workflow, incoming emails and invalid/missing sent dates are excluded', () => {
  for (const change of [{ sequence_id: 'other' }, { sequence_id: null }, { direction: 'incoming' }, { date_sent: null }, { date_sent: 'invalid' }, { id: '' }]) {
    assert.equal(mapNewsletterSend({ ...sent, ...change }), null);
  }
});

test('each sent step is a separate email; absent sender is never credited to the creator', () => {
  assert.notEqual(mapNewsletterSend(sent)?.emailId, mapNewsletterSend({ ...sent, id: 'email-2' })?.emailId);
  assert.equal(mapNewsletterSend({ ...sent, user_id: null })?.closeUserId, null);
});
