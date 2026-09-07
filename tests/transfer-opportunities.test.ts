import test from 'node:test';
import assert from 'node:assert/strict';
import { mapCustomActivity, ACTIVITY_TYPES, CUSTOM_FIELDS } from '../supabase/functions/_shared/close-mapping.ts';
for (const [kind, field] of [[ACTIVITY_TYPES.openingCall,CUSTOM_FIELDS.openingGatekeeperResult],[ACTIVITY_TYPES.followUp,CUSTOM_FIELDS.followUpGatekeeperResult]]) {
  test(`only evaluated gatekeeper outcomes count for ${kind}`, () => {
    for (const result of ['✅ Durchgestellt','Nicht durchgestellt','E-Mail senden','Kein Interesse','CEO nicht erreichbar','GF nicht erreichbar','Mailbox','außerhalb der Geschäftszeiten','Nicht erreichbar','🛑 Kein Gatekeeper','', 'new unknown outcome']) {
      const mapped = mapCustomActivity({id:'test',lead_id:'lead',activity_at:'2026-09-07T08:00:00Z',status:'published',custom_activity_type_id:kind,custom_fields:[{id:field,value:result}]})!;
      assert.equal(mapped.gatekeeperContacts, ['✅ Durchgestellt','Nicht durchgestellt','E-Mail senden','Kein Interesse'].includes(result) ? 1 : 0, result);
      assert.equal(mapped.connectedCalls,result==='✅ Durchgestellt'?1:0,result);
      assert.equal(mapped.directDecisionMakerCalls,result==='🛑 Kein Gatekeeper'?1:0,result);
    }
  });
}
