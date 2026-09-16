import test from 'node:test';import assert from 'node:assert/strict';
import {workingCapital,liquidity,overviewLeads,renderQualityOverview,renderQualityCompanies} from '../lead-quality-overview.mjs';
const lead=(id,name,wc,price)=>({lead_id:id,lead_name:name,dimensions:{working_capital:wc,offer_price_eur:price}});
test('liquidity is per-company capital divided by actual EUR offer, never an example default',()=>{
 assert.equal(liquidity(lead('a','A','50.000','10000')).value,5);
 assert(Math.abs(liquidity(lead('b','B','47.579,71','20000')).value-2.3789855)<1e-12);
 assert.equal(liquidity(lead('c','C','-500,00','10000')).value,-.05);
 assert.equal(liquidity(lead('d','D','0','10000')).value,0);
 for(const [wc,price] of [['','10000'],['unknown','10000'],['50.000',''],['50.000','0'],['50.000','-1']])assert.equal(liquidity(lead('e','E',wc,price)).value,null);
 for(const input of ['1,000.00','47.579,71garbage',null,'Infinity'])assert.equal(workingCapital(input),null);
});
test('overview unions period events and stage cohorts by lead ID including no shows and prior-month wins',()=>{
 const leads=[lead('s','Setting','50.000','10000'),lead('n','No Show','',''),lead('w','Won','70.000','10000'),lead('x','Outside','','')];
 const report={leads,groups:[{cohort:[{lead_id:'s'},{lead_id:'n'}],monthly_entries:[{lead_id:'s'}],leads:[leads[0]]},{cohort:[],monthly_entries:[],leads:[]},{cohort:[],monthly_entries:[],leads:[]},{cohort:[{lead_id:'w'}],monthly_entries:[{lead_id:'w'}],leads:[leads[2]]}],rates:[]};
 assert.deepEqual(overviewLeads(report).map(l=>l.lead_id),['n','s','w']);
 const before=JSON.stringify(report),html=renderQualityOverview(report);
 assert.match(html,/Alle 3 Unternehmen/);assert.match(html,/5×/);assert.match(html,/7×/);assert.doesNotMatch(html,/Outside/);assert.equal(JSON.stringify(report),before);
 const byCapital=renderQualityCompanies(report,overviewLeads(report),'working_capital');assert(byCapital.indexOf('Won ↗')<byCapital.indexOf('Setting ↗'));
});
test('company and financial strings are escaped and rates intersect the original denominator',()=>{
 const l=lead('lead_a','<script>Company</script>','50.000',null);l.dimensions.offer_note='<img onerror=x>';
 const report={leads:[l],groups:Array.from({length:4},()=>({cohort:[{lead_id:l.lead_id}],monthly_entries:[],leads:[]})),rates:[{key:'setter_show',numerator:[{lead_id:l.lead_id}],denominator:[{lead_id:l.lead_id,entry_known:false}]}]};
 const html=renderQualityOverview(report);assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;script&gt;/);assert.match(html,/Show: <b>—<\/b>/);assert.match(html,/\(1\/1\)/);
});
