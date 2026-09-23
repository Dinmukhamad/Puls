import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const built = await build({entryPoints:[fileURLToPath(new URL('./cityInteraction.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const { bindCityDrag, placeCityPins } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

class Host extends EventTarget {
  clientWidth = 320; dataset = {}; captured = new Set();
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
  pointer(type,x,id=1,extra={}) { this.dispatchEvent(Object.assign(new Event(type),{clientX:x,pointerId:id,isPrimary:true,button:0,...extra})); }
}

test('mouse and touch drag can turn repeatedly past 360 degrees, then release outside the map',()=>{
  for (const pointerType of ['mouse','touch']) {
    const host=new Host(); let angle=0;
    const dispose=bindCityDrag(host,delta=>angle+=delta);
    host.pointer('pointerdown',0,1,{pointerType});
    host.pointer('pointermove',4); assert.equal(angle,0);
    for (let x=20;x<=960;x+=20) host.pointer('pointermove',x);
    assert.ok(Math.abs(angle+6*Math.PI)<.00001); assert.equal(host.dataset.dragging,'true');
    host.pointer('pointerup',960); host.pointer('pointermove',1200);
    assert.ok(Math.abs(angle+6*Math.PI)<.00001); assert.equal(host.captured.size,0);
    dispose(); host.pointer('pointerdown',0);host.pointer('pointermove',100);assert.equal(host.dataset.dragging,undefined);
  }
});

test('cancelled touch, a second finger and secondary mouse buttons never leave a stuck drag',()=>{
  const host=new Host();let angle=0;const dispose=bindCityDrag(host,d=>angle+=d);
  host.pointer('pointerdown',0,1,{button:2});host.pointer('pointermove',100);assert.equal(angle,0);
  host.pointer('pointerdown',0);host.pointer('pointerdown',10,2,{isPrimary:false});host.pointer('pointermove',100,2);assert.equal(angle,0);
  host.pointer('pointercancel',0);host.pointer('pointermove',100);assert.equal(angle,0);
  host.pointer('pointerdown',0);host.pointer('pointermove',100);assert.ok(angle<0);
  host.pointer('lostpointercapture',100);const before=angle;host.pointer('pointermove',200);assert.equal(angle,before);
  dispose();
});

test('all five district labels stay visible and separate through a full rotation on narrow and desktop maps',()=>{
  const locations=[[-5,2],[-4,-4],[3,-1],[4,5],[-2,7]];
  for(const [w,h] of [[280,395],[320,395],[390,395],[440,440],[760,560],[1100,560]]) {
    const span=w<440?21.5:24,aspect=w/h;
    const camera=new THREE.OrthographicCamera(-span/2,span/2,span/aspect/2,-span/aspect/2,.1,120);
    for(let degree=0;degree<360;degree+=5) {
      const angle=degree*Math.PI/180;camera.position.set(Math.sin(angle)*27,25,Math.cos(angle)*27);camera.lookAt(new THREE.Vector3(0,0,1.2));camera.updateMatrixWorld();
      const pins=locations.map(([x,z],i)=>{const p=new THREE.Vector3(x,.35,z+1.6).project(camera);return{id:String(i),x:(p.x*.5+.5)*w,y:(-p.y*.5+.5)*h+18};});
      const positions=Object.values(placeCityPins(pins,w,h)),width=w<440?112:124;
      for(const p of positions){assert.ok(p.x-width/2>=0&&p.x+width/2<=w&&p.y-24>=0&&p.y+24<=h,`${w}px / ${degree}deg bounds`);}
      for(let a=0;a<positions.length;a++)for(let b=a+1;b<positions.length;b++) {
        assert.ok(Math.abs(positions[a].x-positions[b].x)>=width||Math.abs(positions[a].y-positions[b].y)>=48,`${w}px / ${degree}deg overlap ${a}/${b}`);
      }
    }
  }
});
