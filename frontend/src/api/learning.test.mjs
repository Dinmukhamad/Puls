import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const bundled = await build({entryPoints:[fileURLToPath(new URL('./learning.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'client-fixture',setup(plugin){plugin.onResolve({filter:/^\.\/client$/},()=>({path:'fixture:client',external:true}));}}]});
const rows=[{id:1,kind:'test',title:'Hidden test',completed:true},{id:2,kind:'mission',title:'Hidden mission',state:'in_progress'},{id:3,kind:'simulator',title:'Driver Simulator',state:'new'}];
const requests=[];
const fixture={request:async url=>{requests.push(url);return rows;},buildQuery:params=>'?' + new URLSearchParams(params).toString()};
const module={exports:{}};
new Function('require','module','exports',bundled.outputFiles[0].text)(()=>fixture,module,module.exports);
const {learning,learningKindFilter,visibleLearningFilters}=module.exports;

test('catalogue and studio omit hidden content without modifying saved data',async()=>{
  assert.deepEqual(await learning.catalog(),[rows[2]]);
  assert.deepEqual(await learning.definitions(),[rows[2]]);
  assert.equal(rows.length,3);
  assert.deepEqual(rows.map(x=>x.kind),['test','mission','simulator']);
});
test('team summaries and paginated results request only visible content with existing filters',async()=>{
  for(const kind of [undefined,'test','mission','simulator']){
    await learning.results({kind,page:2,user_id:42});
    let query=new URL(requests.at(-1),'https://local.example').searchParams;
    assert.equal(query.get('kind'),'simulator');assert.equal(query.get('page'),'2');assert.equal(query.get('user_id'),'42');
    await learning.analytics({kind,state:'passed'});
    query=new URL(requests.at(-1),'https://local.example').searchParams;
    assert.equal(query.get('kind'),'simulator');assert.equal(query.get('state'),'passed');
  }
  assert.deepEqual(visibleLearningFilters({kind:'test',export:true,date_from:'2026-09-01'}),{kind:'simulator',export:true,date_from:'2026-09-01'});
});
test('legacy category bookmarks cannot restore hidden sections',()=>{
  for(const kind of [null,'test','mission','invalid','all'])assert.equal(learningKindFilter(kind),'all');
  assert.equal(learningKindFilter('simulator'),'simulator');
});
