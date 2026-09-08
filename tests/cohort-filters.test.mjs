import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingBucket,bookingRange,selectCohort,filteredActivity,originGroups} from '../cohort-filters.mjs';
const base={period:{start:'2026-09-01',end:'2026-09-08'},coverage:{retention_start:'2026-07-01'},
 cohort_history:[{source:'LinkedIn',owner:'michael',booked_date:'2026-08-31',booked_leads:1,setter_arrived:1},
 {source:'LinkedIn',owner:'felix',booked_date:'2026-09-01',booked_leads:2,setter_arrived:1}],
 booking_cohort_history:[],activity_by_origin:[
 {source:'LinkedIn',owner:'michael',booked_date:'2026-08-31',setter_calls:1,closer_calls:1,cc2_agreed:1},
 {source:'LinkedIn',owner:'felix',booked_date:'2026-09-01',setter_calls:1,closer_calls:0},
 {source:'DMC',owner:'unassigned',booked_date:null,new_customers:1}
 ]};
const all={source:'all',owner:'all',cohort:'period'};
test('a prior-month booking can be followed through the current cutoff without mixing new bookings',()=>{
 assert.equal(selectCohort(base,all).funnel_by_source[0].owner,'felix');
 const old=selectCohort(base,{...all,cohort:'2026-08-01'});
 assert.equal(old.funnel_by_source.length,1);assert.equal(old.funnel_by_source[0].owner,'michael');
 assert.equal(old.period.end,'2026-09-08');assert.equal(old.cohort_range.start,'2026-08-01');
});
test('calendar grouping handles cross-month weeks, ISO year boundaries and daylight saving',()=>{
 assert.equal(bookingBucket('2026-09-01','week'),'2026-08-31');
 assert.equal(bookingBucket('2027-01-01','week'),'2026-12-28');
 assert.equal(bookingBucket('2026-10-25','week'),'2026-10-19');
 assert.deepEqual(bookingRange(base,'2026-08-31','week'),{start:'2026-08-31',end:'2026-09-06'});
 assert.deepEqual(bookingRange(base,'2026-12-01','month'),{start:'2026-12-01',end:'2026-12-31'});
});
test('source and supplier filters apply to every conversation counter and origin row',()=>{
 const f={...all,owner:'michael'};
 const a=filteredActivity(base,f);assert.equal(a.setter_calls,1);assert.equal(a.closer_calls,1);assert.equal(a.new_customers,0);
 assert.equal(originGroups(base,f).length,1);
 assert.equal(filteredActivity(base,{...f,source:'DMC'}).setter_calls,0);
 assert.equal(originGroups(base,all).reduce((n,r)=>n+r.setter_calls,0),2);
 assert.equal(originGroups(base,all).find(r=>r.key==='unknown').new_customers,1);
 assert.equal(filteredActivity({},all),null);
});
test('incomplete booking cohorts cannot be presented as complete conversion',()=>{
 assert.equal(selectCohort(base,{...all,cohort:'2026-06-01'}).cohort_complete,false);
});
