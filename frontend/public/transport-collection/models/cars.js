/* Original procedural passenger vehicles. Dimensions are in metres. +X is forward. */
export const MODELS = [
  {id:'sedan',name:'Седан S4',category:'cars',type:'Бизнес-седан',description:'Четырёхдверный седан с плавным силуэтом, отдельным багажником и многоспицевыми колёсами.',defaultColor:'#31577d'},
  {id:'hatchback',name:'Хэтчбек H3',category:'cars',type:'Городской хэтчбек',description:'Компактный пятидверный хэтчбек с короткими свесами и высокой задней дверью.',defaultColor:'#c44834'},
  {id:'crossover',name:'Кроссовер C5',category:'cars',type:'Средний кроссовер',description:'Семейный кроссовер с защитными арками, рейлингами и увеличенным дорожным просветом.',defaultColor:'#6c837b'},
  {id:'suv',name:'Внедорожник X8',category:'cars',type:'Большой внедорожник',description:'Высокий внедорожник с почти вертикальной задней частью, подножками и крупными шинами.',defaultColor:'#434c52'},
  {id:'coupe',name:'Купе GT2',category:'cars',type:'Спортивное купе',description:'Низкое двухдверное гран-туризмо с длинным капотом, покатой крышей и широкими колёсами.',defaultColor:'#a72935'},
  {id:'estate',name:'Универсал W6',category:'cars',type:'Пятидверный универсал',description:'Длинный универсал с продолженной линией крыши, боковыми багажными окнами и рейлингами.',defaultColor:'#365951'},
  {id:'cabriolet',name:'Родстер R2',category:'cars',type:'Открытый родстер',description:'Двухместный открытый автомобиль с детальным салоном, защитными дугами и спортивным кузовом.',defaultColor:'#c5c5bb'},
  {id:'pickup',name:'Пикап P7',category:'cars',type:'Двухрядный пикап',description:'Пикап с открытой рифлёной грузовой платформой, двухрядной кабиной и подножками.',defaultColor:'#c1843b'},
  {id:'minivan',name:'Минивэн M8',category:'cars',type:'Семейный минивэн',description:'Просторный минивэн с высокой крышей, длинным остеклением и направляющими сдвижных дверей.',defaultColor:'#7b8392'},
  {id:'city-ev',name:'Электрокар E1',category:'cars',type:'Городской электромобиль',description:'Компактный электрический автомобиль с коротким капотом, закрытой передней панелью и зарядным лючком.',defaultColor:'#7bb7bc'},
];

const CONFIG = {
  sedan:{L:4.72,W:1.82,H:1.46,R:.335,wb:2.80,belt:.96,cab:[-1.43,-.85,.37,1.06],panes:[-.18],doors:4,spokes:10},
  hatchback:{L:4.12,W:1.77,H:1.49,R:.315,wb:2.55,belt:.95,cab:[-1.65,-1.33,.30,.95],panes:[-1.22,-.22],doors:4,spokes:6,hatch:true},
  crossover:{L:4.55,W:1.86,H:1.69,R:.355,wb:2.72,belt:1.08,cab:[-1.84,-1.42,.41,1.11],panes:[-1.35,-.24],doors:4,spokes:7,cladding:true,rails:true,hatch:true},
  suv:{L:5.03,W:2.00,H:1.87,R:.39,wb:2.97,belt:1.18,cab:[-2.14,-1.88,.44,1.18],panes:[-1.48,-.24],doors:4,spokes:6,cladding:true,rails:true,hatch:true,steps:true},
  coupe:{L:4.58,W:1.89,H:1.30,R:.34,wb:2.68,belt:.88,cab:[-1.27,-.60,.24,.95],panes:[-.56],doors:2,spokes:10,sport:true},
  estate:{L:4.88,W:1.86,H:1.53,R:.34,wb:2.87,belt:.98,cab:[-2.05,-1.69,.40,1.09],panes:[-1.48,-.24],doors:4,spokes:8,rails:true,hatch:true},
  cabriolet:{L:4.42,W:1.84,H:1.30,R:.335,wb:2.64,belt:.88,cab:[-.98,-.65,.36,.98],panes:[-.50,.7],doors:2,spokes:8,sport:true,open:true},
  pickup:{L:5.40,W:1.99,H:1.88,R:.39,wb:3.26,belt:1.15,cab:[-.64,-.51,.67,1.36],panes:[.24],doors:4,spokes:6,cladding:true,steps:true,bed:true},
  minivan:{L:5.05,W:1.95,H:1.91,R:.35,wb:3.08,belt:1.11,cab:[-2.22,-1.94,.81,1.73],panes:[-1.52,-.32,.73],doors:4,spokes:8,hatch:true,van:true},
  'city-ev':{L:3.62,W:1.67,H:1.56,R:.295,wb:2.38,belt:.99,cab:[-1.48,-1.19,.36,1.10],panes:[-.15],doors:4,spokes:5,hatch:true,ev:true},
};

export function buildModel(THREE,id) {
  const meta=MODELS.find(m=>m.id===id);
  if(!meta) throw new Error('Unknown car model: '+id);
  const c={...CONFIG[id],id};
  const b=new ModelBuilder(THREE);
  const M=materials(THREE,meta.defaultColor);
  const axleRear=-c.wb/2, axleFront=c.wb/2;
  c.axles=[axleRear,axleFront];
  makeBody(b,c,M);
  if(c.open) makeOpenCockpit(b,c,M); else makeCabin(b,c,M);
  makeWheels(b,c,M);
  makeExteriorDetails(b,c,M);
  if(c.bed) makePickupBed(b,c,M);
  const g=b.finish();
  g.name=meta.name;
  g.userData={id,name:meta.name,units:'meters'};
  return g;
}

function materials(T,color) {
  const standard=(name,col,rough=.4,metal=0)=>{const m=new T.MeshStandardMaterial({name,color:col,roughness:rough,metalness:metal});return m;};
  const paint=new T.MeshPhysicalMaterial({name:'Paint / body colour',color,metalness:.52,roughness:.23,clearcoat:1,clearcoatRoughness:.12});paint.userData.paint=true;
  const glass=new T.MeshPhysicalMaterial({name:'Smoked automotive glass',color:'#233e49',metalness:.28,roughness:.12,clearcoat:1,clearcoatRoughness:.08,side:T.DoubleSide});
  return {paint,glass,black:standard('Satin black trim','#171b1d',.5,.1),rubber:standard('Tyre rubber','#1b1c1d',.92,0),tread:standard('Tyre tread edges','#222426',.87,0),chrome:standard('Satin aluminium','#b9c2c9',.23,.90),darkChrome:standard('Graphite alloy','#505c64',.27,.85),brake:standard('Brake discs','#858c90',.58,.7),caliper:standard('Brake calipers','#a13324',.35,.4),seam:standard('Panel gaps','#192024',.58,.15),interior:standard('Charcoal upholstery','#303439',.85,0),seat:standard('Leather seats','#805e49',.63,0),plate:standard('Plain number plates','#dce1df',.42,.1),white:new T.MeshStandardMaterial({name:'LED daylight',color:'#ebf7ff',roughness:.2,emissive:'#b6dcff',emissiveIntensity:.65}),red:new T.MeshStandardMaterial({name:'Rear light lenses',color:'#a60913',roughness:.2,metalness:.15,emissive:'#960511',emissiveIntensity:.35}),amber:new T.MeshStandardMaterial({name:'Indicator lenses',color:'#ed9e28',roughness:.25,emissive:'#d78312',emissiveIntensity:.2}),mirror:standard('Mirror glass','#bfd4dd',.06,1)};
}

/* A material batch keeps detailed vehicles light enough for a browser. */
class ModelBuilder {
  constructor(T){this.T=T;this.parts=new Map();this.group=new T.Group();}
  add(geo,mat,pos=[0,0,0],rot=[0,0,0],scale=[1,1,1]){
    const T=this.T;const m=new T.Matrix4().compose(new T.Vector3(...pos),new T.Quaternion().setFromEuler(new T.Euler(...rot)),new T.Vector3(...scale));
    let g=geo.index?geo.toNonIndexed():geo.clone();g.applyMatrix4(m);
    const p=g.getAttribute('position'),n=g.getAttribute('normal');
    if(!n)g.computeVertexNormals();
    let batch=this.parts.get(mat);if(!batch){batch={p:[],n:[]};this.parts.set(mat,batch);}
    batch.p.push(p.array);batch.n.push(g.getAttribute('normal').array);g.dispose();geo.dispose();
  }
  box(dim,pos,mat,rot=[0,0,0],round=0){this.add(round?roundedBox(this.T,...dim,round):new this.T.BoxGeometry(...dim),mat,pos,rot);}
  cyl(radius,length,pos,mat,rot=[0,0,Math.PI/2],segments=20){this.add(new this.T.CylinderGeometry(radius,radius,length,segments,1),mat,pos,rot);}
  rod(a,z,r,mat,segments=8){const T=this.T;const aa=new T.Vector3(...a),bb=new T.Vector3(...z),d=bb.clone().sub(aa);const q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),d.clone().normalize());const e=new T.Euler().setFromQuaternion(q);this.add(new T.CylinderGeometry(r,r,d.length(),segments),mat,aa.add(bb).multiplyScalar(.5).toArray(),[e.x,e.y,e.z]);}
  line(points,r,mat,segments=8){for(let i=1;i<points.length;i++)this.rod(points[i-1],points[i],r,mat,segments);}
  surface(vertices,indices,mat){const g=new this.T.BufferGeometry();g.setAttribute('position',new this.T.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();this.add(g,mat);}
  finish(){const T=this.T;for(const [mat,part] of this.parts){const count=part.p.reduce((a,p)=>a+p.length,0);const p=new Float32Array(count),n=new Float32Array(count);let o=0;for(let i=0;i<part.p.length;i++){p.set(part.p[i],o);n.set(part.n[i],o);o+=part.p[i].length;}const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(p,3));g.setAttribute('normal',new T.BufferAttribute(n,3));g.computeBoundingBox();g.computeBoundingSphere();const mesh=new T.Mesh(g,mat);mesh.name=mat.name;mesh.castShadow=true;mesh.receiveShadow=true;this.group.add(mesh);}return this.group;}
}

function roundedBox(T,w,h,d,r){
  r=Math.min(r,w*.45,h*.45,d*.45);
  const g=new T.BoxGeometry(w,h,d,6,6,6),p=g.getAttribute('position');
  const inner=[w*.5-r,h*.5-r,d*.5-r];
  for(let i=0;i<p.count;i++){const v=new T.Vector3(p.getX(i),p.getY(i),p.getZ(i)),k=new T.Vector3(Math.max(-inner[0],Math.min(inner[0],v.x)),Math.max(-inner[1],Math.min(inner[1],v.y)),Math.max(-inner[2],Math.min(inner[2],v.z)));v.sub(k).normalize().multiplyScalar(r).add(k);p.setXYZ(i,v.x,v.y,v.z);}
  g.computeVertexNormals();return g;
}
const mix=(a,b,t)=>a+(b-a)*t;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=t=>t*t*(3-2*t);
function bodyWidth(c,x){const end=c.L*.5;const cap=Math.min((end-Math.abs(x))/.38,1);return c.W*.5*(.80+.20*smooth(clamp(cap,0,1)));}
function bodyTop(c,x){const f=x/(c.L*.5);return c.belt-(f>.61?.15*smooth(clamp((f-.61)/.39,0,1)):f<-.79?.08*smooth(clamp((-f-.79)/.21,0,1)):0);}
function archBottom(c,x){let y=c.cladding?.31:.25;const ar=c.R+.055;for(const ax of c.axles){const dx=x-ax;if(Math.abs(dx)<ar)y=Math.max(y,c.R+Math.sqrt(ar*ar-dx*dx));}return y;}
function topHole(c,x,z){return (c.open&&x>-.94&&x<.73&&Math.abs(z)<c.W*.365)||(c.bed&&x>-c.L*.5+.13&&x<c.cab[0]-.04&&Math.abs(z)<c.W*.37);}
function makeBody(b,c,M){
  const N=112,K=14,v=[],ix=[];
  for(let i=0;i<=N;i++){const x=mix(-c.L*.5,c.L*.5,i/N),w=bodyWidth(c,x),top=bodyTop(c,x);for(let j=0;j<=K;j++){const u=j/K*2-1;v.push(x,top+.026*(1-u*u)-.06*Math.pow(Math.abs(u),4),u*w*.965);}}
  for(let i=0;i<N;i++)for(let j=0;j<K;j++){const a=i*(K+1)+j;const x=mix(-c.L*.5,c.L*.5,(i+.5)/N),z=(j+.5)/K*2-1;if(topHole(c,x,z*bodyWidth(c,x)))continue;ix.push(a,a+1,a+K+2,a,a+K+2,a+K+1);}
  b.surface(v,ix,M.paint);
  for(const s of [-1,1]){
    const verts=[],ind=[];const V=5;
    for(let i=0;i<=N;i++){const x=mix(-c.L*.5,c.L*.5,i/N),w=bodyWidth(c,x),top=bodyTop(c,x)-.06,low=archBottom(c,x);for(let j=0;j<=V;j++){const t=j/V,y=mix(low,top,t),z=w*(mix(low>.36?.979:.93,.965,t)+.055*Math.sin(t*Math.PI));verts.push(x,y,s*z);}}
    for(let i=0;i<N;i++)for(let j=0;j<V;j++){const a=i*(V+1)+j;if(s>0)ind.push(a,a+V+2,a+1,a,a+V+1,a+V+2);else ind.push(a,a+1,a+V+2,a,a+V+2,a+V+1);}
    b.surface(verts,ind,M.paint);
    // Rolled metal lips and recessed black arch liners follow the actual cut-outs.
    for(const ax of c.axles){const pts=[],liner=[];const r=c.R+.056;for(let k=0;k<=26;k++){const a=Math.PI*k/26;const x=ax-Math.cos(a)*r,y=c.R+Math.sin(a)*r;pts.push([x,y,s*(bodyWidth(c,x)*.979+.008)]);liner.push([x,y-.017,s*(bodyWidth(c,x)*.955-.045)]);}b.line(pts,c.cladding?.025:.014,c.cladding?M.black:M.paint,8);b.line(liner,.032,M.black,8);}
    // Rocker panel between the wheel openings.
    b.box([c.wb-2*c.R-.2,.075,.095],[0,c.cladding?.32:.27,s*(c.W*.47)],c.cladding?M.black:M.paint,[0,0,0],.025);
  }
  // Nose and tail are closed; the underside stays inside the wheel tracks.
  for(const sign of [-1,1]){const x=sign*c.L*.5,w=bodyWidth(c,x),top=bodyTop(c,x)-.06;const verts=[x,.25,-w*.91,x,.25,w*.91,x,top,w*.965,x,top,-w*.965];b.surface(verts,sign>0?[0,2,1,0,3,2]:[0,1,2,0,2,3],M.paint);}
  b.box([c.L-.46,.15,c.W*.65],[0,.31,0],M.black,[0,0,0],.04);
}

function cabinZ(c,y){const base=c.belt-.005;return mix(c.W*.461,c.W*(c.van?.405:.367),clamp((y-base)/(c.H-base),0,1));}
function cabinUpper(c,x){const [rear,rr,fr,front]=c.cab;if(x<rr)return mix(c.belt+.045,c.H-.065,clamp((x-rear)/(rr-rear),0,1));if(x>fr)return mix(c.H-.065,c.belt+.045,clamp((x-fr)/(front-fr),0,1));return c.H-.065+.018*Math.sin((x-rr)/(fr-rr)*Math.PI);}
function sidePolygon(c,a,z,inset=0){
  const [rear,rr,fr,front]=c.cab;
  const pts=[[rear+.03,c.belt+.045],[front-.035,c.belt+.045],[fr,c.H-.10]];
  for(let i=1;i<=10;i++){const t=i/10;pts.push([mix(fr,rr,t),c.H-.10+.043*Math.sin(Math.PI*t)]);}
  const rounded=roundPolygon(pts,.075);
  return clipX(clipX(rounded,a,true),z,false);
}
function roundPolygon(pts,r){const out=[];for(let i=0;i<pts.length;i++){const p=pts[i],a=pts[(i+pts.length-1)%pts.length],z=pts[(i+1)%pts.length];const la=Math.hypot(a[0]-p[0],a[1]-p[1]),lz=Math.hypot(z[0]-p[0],z[1]-p[1]),da=Math.min(r,la*.22),dz=Math.min(r,lz*.22);const pa=[mix(p[0],a[0],da/la),mix(p[1],a[1],da/la)],pz=[mix(p[0],z[0],dz/lz),mix(p[1],z[1],dz/lz)];for(let k=0;k<=5;k++){const t=k/5;out.push([(1-t)*(1-t)*pa[0]+2*(1-t)*t*p[0]+t*t*pz[0],(1-t)*(1-t)*pa[1]+2*(1-t)*t*p[1]+t*t*pz[1]]);}}return out;}

function clipX(poly,x,greater){const result=[];for(let i=0;i<poly.length;i++){const a=poly[i],bb=poly[(i+1)%poly.length],ina=greater?a[0]>=x:a[0]<=x,inb=greater?bb[0]>=x:bb[0]<=x;if(ina)result.push(a);if(ina!==inb){const t=(x-a[0])/(bb[0]-a[0]);result.push([x,mix(a[1],bb[1],t)]);}}return result;}
function polySide(b,c,pts,s,mat,offset=0){if(pts.length<3)return;const v=[],ix=[];for(const p of pts)v.push(p[0],p[1],s*(cabinZ(c,p[1])+offset));for(let i=1;i<pts.length-1;i++)s>0?ix.push(0,i,i+1):ix.push(0,i+1,i);b.surface(v,ix,mat);}
function glassEnd(b,c,M,isFront){
  const [rear,rr,fr,front]=c.cab,x0=isFront?front:rear,x1=isFront?fr:rr,base=c.belt+.028,upper=c.H-.075;
  const v=[],ix=[],NX=10,NU=18;
  for(let j=0;j<=NX;j++){const t=j/NX;for(let k=0;k<=NU;k++){const u=k/NU*2-1,yy=mix(base,upper,t)+.035*(1-u*u)*t+.018*(1-u*u)*Math.sin(Math.PI*t),zz=u*cabinZ(c,mix(base,upper,t));const xx=mix(x0,x1,t)+(isFront?1:-1)*.055*(1-u*u)*Math.sin(Math.PI*t);v.push(xx,yy,zz);}}
  for(let j=0;j<NX;j++)for(let k=0;k<NU;k++){const a=j*(NU+1)+k;isFront?ix.push(a,a+NU+2,a+1,a,a+NU+1,a+NU+2):ix.push(a,a+1,a+NU+2,a,a+NU+2,a+NU+1);}
  b.surface(v,ix,M.glass);
  for(const s of [-1,1])b.rod([x0,base,s*cabinZ(c,base)],[x1,upper,s*cabinZ(c,upper)],c.open?.029:.026,M.paint,10);
  for(const t of [0,1]){const y=mix(base,upper,t),x=mix(x0,x1,t);const line=[];for(let k=0;k<=16;k++){const u=k/16*2-1;line.push([x+(isFront?1:-1)*.007*(1-u*u),y+(t===1?.035:.004)*(1-u*u),u*cabinZ(c,y)]);}b.line(line,t===1?.022:.015,M.black,8);}
}
function makeCabin(b,c,M){
  const [rear,rr,fr,front]=c.cab;
  glassEnd(b,c,M,true);glassEnd(b,c,M,false);
  // Broad, softly crowned roof: a real surface rather than a single cuboid.
  const v=[],ix=[],NX=18,NU=16;
  for(let i=0;i<=NX;i++){const t=i/NX,x=mix(rr,fr,t);for(let j=0;j<=NU;j++){const u=j/NU*2-1;v.push(x,c.H-.075+.035*(1-u*u)+.043*Math.sin(Math.PI*t),u*cabinZ(c,c.H-.075));}}
  for(let i=0;i<NX;i++)for(let j=0;j<NU;j++){const a=i*(NU+1)+j;ix.push(a,a+1,a+NU+2,a,a+NU+2,a+NU+1);}b.surface(v,ix,M.paint);
  for(const s of [-1,1]){
    const outline=sidePolygon(c,rear-.1,front+.1);polySide(b,c,outline,s,M.black,0);
    const cuts=[rear+.055,...c.panes.filter(x=>x>rear+.12&&x<front-.12),front-.055];
    for(let i=0;i<cuts.length-1;i++){
      let p=sidePolygon(c,cuts[i]+.026,cuts[i+1]-.026);const cy=p.reduce((a,p)=>a+p[1],0)/p.length;p=p.map(([x,y])=>[x,mix(y,cy,.035)]);polySide(b,c,p,s,M.glass,.006);
    }
    const trim=[];for(let k=0;k<=12;k++){const x=mix(rear+.015,front-.015,k/12);trim.push([x,c.belt+.026,s*(cabinZ(c,c.belt+.026)+.012)]);}b.line(trim,.009,c.sport?M.black:M.chrome,8);
    const edge=[];for(let k=0;k<=18;k++){const t=k/18;edge.push([mix(rr,fr,t),c.H-.075+.043*Math.sin(Math.PI*t),s*cabinZ(c,c.H-.075)]);}b.line(edge,.021,M.paint,10);
    // Narrow painted C-pillars make a hatch, estate and van visually distinct.
    b.rod([rear,c.belt+.025,s*cabinZ(c,c.belt+.025)],[rr,c.H-.075,s*cabinZ(c,c.H-.075)],c.van?.047:.037,M.paint,10);
  }
  // Interior silhouettes are visible through the glazed cabin at grazing angles.
  b.box([Math.max(.8,fr-rr+.4),.12,c.W*.70],[(rr+fr)/2,c.belt-.06,0],M.interior);
  if(c.rails){for(const s of [-1,1]){b.rod([rr+.04,c.H+.035,s*c.W*.30],[fr-.02,c.H+.035,s*c.W*.30],.021,M.darkChrome,10);for(const x of [rr+.08,fr-.10])b.box([.09,.055,.045],[x,c.H+.005,s*c.W*.30],M.black);}}
  if(c.van){b.box([1.13,.012,c.W*.52],[-.48,c.H+.015,0],M.glass,[0,0,0],.005);}
}

function makeOpenCockpit(b,c,M){
  // A real opening is left in the body shell; this floor and liner sit underneath it.
  b.box([1.72,.15,c.W*.73],[-.08,.50,0],M.interior,[0,0,0],.04);
  for(const s of [-1,1]){b.box([1.67,.25,.055],[-.08,.69,s*c.W*.365],M.interior,[0,0,0],.025);b.box([.49,.095,.49],[-.20,.64,s*.39],M.seat,[0,0,0],.055);b.box([.14,.47,.46],[-.43,.87,s*.39],M.seat,[0,0,-.13],.05);b.box([.12,.15,.25],[-.48,1.12,s*.39],M.seat,[0,0,-.13],.04);
    // Upholstery piping, cushion seams and rollover hoop.
    for(const zz of [-.16,.16])b.rod([-.40,.71,s*.39+zz],[-.38,1.05,s*.39+zz],.0045,M.interior,6);
    const hoop=[];for(let k=0;k<=16;k++){const a=Math.PI*k/16;hoop.push([-.70,.96+Math.sin(a)*.18,s*.39+Math.cos(a)*.20]);}b.line(hoop,.025,M.chrome,10);
  }
  b.box([.68,.25,.16],[.09,.66,0],M.interior,[0,0,0],.03);b.box([.27,.025,.105],[.22,.80,0],M.chrome,[0,0,0],.01);b.cyl(.021,.11,[.18,.86,0],M.black,[0,0,0],12);
  b.box([.22,.25,c.W*.71],[.69,.80,0],M.interior,[0,0,0],.035);
  b.box([.025,.09,.25],[.56,.88,.36],M.black,[0,0,0],.01);
  // Steering wheel lies in the Y/Z plane and faces the driver's seat.
  b.add(new b.T.TorusGeometry(.145,.014,8,32),M.black,[.52,.91,.39],[0,Math.PI/2,0]);
  for(let i=0;i<3;i++){const a=i*Math.PI*2/3;b.rod([.52,.91,.39],[.52,.91+Math.sin(a)*.13,.39+Math.cos(a)*.13],.012,M.darkChrome,8);}b.cyl(.037,.025,[.52,.91,.39],M.black,[0,0,Math.PI/2],16);
  glassEnd(b,c,M,true);
  b.box([.07,.035,c.W*.76],[c.cab[2],c.H-.05,0],M.paint,[0,0,0],.012);
  // Tonneau cover behind the seats, with subtle longitudinal ribs.
  b.box([.42,.065,c.W*.70],[-1.12,.91,0],M.paint,[0,0,0],.025);
  for(const s of [-1,1])b.rod([-.92,c.belt+.035,s*c.W*.37],[.73,c.belt+.035,s*c.W*.37],.015,M.chrome,10);
}

function makeWheels(b,c,M){
  const T=b.T,r=c.R,tireW=c.sport?.265:c.cladding?.27:.225,track=c.W*.5-.085;
  const points=[[.61*r,-tireW*.42],[.70*r,-tireW*.50],[.87*r,-tireW*.50],[.965*r,-tireW*.37],[r,-tireW*.20],[r,tireW*.20],[.965*r,tireW*.37],[.87*r,tireW*.50],[.70*r,tireW*.50],[.61*r,tireW*.42]].map(p=>new T.Vector2(...p));
  for(const ax of c.axles)for(const s of [-1,1]){
    const z=s*track;
    b.add(new T.LatheGeometry(points,48),M.rubber,[ax,r,z],[Math.PI/2,0,0]);
    // Shallow repeated blocks across the rolling surface and circumferential grooves.
    for(let k=0;k<44;k++){const a=k*Math.PI*2/44;for(const lane of [-1,1]){const rr=r-.007;b.box([.029,.009,tireW*.34],[ax+Math.sin(a)*rr,r+Math.cos(a)*rr,z+lane*tireW*.255],M.tread,[0,0,-a+(lane*.12)]);}}
    for(const zz of [-1,1]){
      b.add(new T.TorusGeometry(r*.87,.004,5,48),M.tread,[ax,r,z+zz*tireW*.492]);
      b.add(new T.TorusGeometry(r*.68,.0055,5,48),M.tread,[ax,r,z+zz*tireW*.476]);
    }
    // Alloy barrel, ventilated brake rotor, caliper, split spokes and lug bolts.
    const outer=z+s*tireW*.485;
    b.cyl(r*.628,tireW*.78,[ax,r,z],M.darkChrome,[Math.PI/2,0,0],40);
    b.cyl(r*.53,.016,[ax,r,outer-s*.055],M.brake,[Math.PI/2,0,0],40);
    b.add(new T.TorusGeometry(r*.607,.015,8,48),M.chrome,[ax,r,outer]);
    b.add(new T.TorusGeometry(r*.542,.007,6,40),M.darkChrome,[ax,r,outer-s*.021]);
    b.box([r*.13,r*.36,.035],[ax+r*.37,r+.025,outer-s*.034],M.caliper,[0,0,.22],.009);
    for(let k=0;k<c.spokes;k++){
      const a=k*Math.PI*2/c.spokes;
      for(const branch of [-1,1]){
        const from=[ax+Math.sin(a)*r*.17,r+Math.cos(a)*r*.17,outer+s*.003],to=[ax+Math.sin(a+branch*.08)*r*.57,r+Math.cos(a+branch*.08)*r*.57,outer-s*.007];
        b.rod(from,to,c.ev?.018:.0125,M.chrome,6);
      }
    }
    b.cyl(r*.17,.029,[ax,r,outer+s*.008],M.darkChrome,[Math.PI/2,0,0],24);b.cyl(r*.09,.034,[ax,r,outer+s*.014],M.chrome,[Math.PI/2,0,0],20);
    for(let k=0;k<5;k++){const a=k*Math.PI*2/5;b.cyl(.007,.008,[ax+Math.sin(a)*r*.125,r+Math.cos(a)*r*.125,outer+s*.027],M.chrome,[Math.PI/2,0,0],6);}
    for(let k=0;k<20;k++){const a=k*Math.PI*2/20;b.cyl(.006,.002,[ax+Math.sin(a)*r*.46,r+Math.cos(a)*r*.46,outer-s*.044],M.darkChrome,[Math.PI/2,0,0],6);}
  }
}

function makeExteriorDetails(b,c,M){
  const front=c.L*.5,rear=-front;
  // Distinct LED signatures, recessed optical chambers and indicator corners.
  const lampY=bodyTop(c,front)-.135,headW=c.ev?.38:c.cladding?.44:.47;
  for(const s of [-1,1]){
    const zz=s*c.W*.305;
    // The swept lens wraps around the rounded front corner.
    const hp=[[-headW*.49,-.045],[-headW*.48,.045],[headW*.39,.064],[headW*.49,-.026]];
    const hv=[],hi=[];for(const [u,y]of hp)hv.push(front+.020-Math.max(0,u)*.24,lampY+y,zz+s*u);
    if(s>0)hi.push(0,1,2,0,2,3);else hi.push(0,2,1,0,3,2);b.surface(hv,hi,M.black);
    const led=[[-headW*.42,.033],[headW*.34,.050],[headW*.43,.017]].map(([u,y])=>[front+.033-Math.max(0,u)*.24,lampY+y,zz+s*u]);b.line(led,.010,M.white,8);
    for(const u of [-headW*.22,headW*.05])b.cyl(.026,.010,[front+.034-Math.max(0,u)*.24,lampY-.010,zz+s*u],M.white,[0,0,Math.PI/2],16);
    b.box([.022,.035,.015],[front-.004,lampY+.007,zz+s*headW*.43],M.amber,[0,-s*.24,0],.004);
    const ty=bodyTop(c,rear)-.135;
    b.box([.037,.14,headW*.92],[rear-.015,ty,zz],M.red,[0,0,0],.014);
    b.box([.043,.020,headW*.82],[rear-.037,ty+.030,zz],M.red,[0,0,0],.008);
    b.box([.043,.022,headW*.42],[rear-.038,ty-.026,zz],M.white,[0,0,0],.006);
    // Independent lower intakes and fog-light blades.
    b.box([.034,.12,.24],[front+.017,.36,s*c.W*.33],M.black,[0,0,0],.025);
    b.box([.045,.018,.18],[front+.039,.37,s*c.W*.33],M.chrome,[0,0,0],.006);
    b.box([.034,.023,.19],[rear-.022,.33,s*c.W*.34],M.red,[0,0,0],.006);
  }
  const grilleHeight=c.id==='suv'?.37:c.cladding?.28:.18;
  if(!c.ev){
    b.box([.032,grilleHeight,c.W*.44],[front+.014,.52,0],M.black,[0,0,0],.024);
    for(let i=-3;i<=3;i++){if(c.id==='suv'||c.bed)b.box([.045,grilleHeight*.85,.017],[front+.037,.52,i*c.W*.052],M.chrome);else b.box([.043,.009,c.W*.42],[front+.038,.52+i*grilleHeight*.12,0],M.darkChrome);}
  } else {b.box([.032,.145,c.W*.39],[front+.025,.58,0],M.paint,[0,0,0],.03);b.rod([front+.045,.66,-c.W*.18],[front+.045,.66,c.W*.18],.009,M.darkChrome,8);}
  b.box([.038,.075,c.W*.72],[front+.02,.27,0],c.sport?M.darkChrome:M.paint,[0,0,0],.025);
  b.box([.040,.09,c.W*.69],[rear-.023,.27,0],M.black,[0,0,0],.024);
  for(const sign of [-1,1]){
    const x=sign>0?front+.053:rear-.051;
    b.box([.018,.105,.45],[x,.43,0],M.black,[0,0,0],.009);b.box([.021,.081,.406],[x+sign*.011,.43,0],M.plate,[0,0,0],.006);
    for(const z of [-.16,.16])b.cyl(.004,.003,[x+sign*.024,.43,z],M.darkChrome,[0,0,Math.PI/2],6);
  }
  // Unbranded small badge and subtle hood shut line.
  b.box([.018,.043,.052],[front+.026,bodyTop(c,front)-.045,0],M.chrome,[0,0,0],.008);
  const hood=[];for(let k=0;k<=18;k++){const z=mix(-c.W*.39,c.W*.39,k/18),x=c.cab[3]+.09+.025*(1-Math.abs(z)/(c.W*.4));hood.push([Math.min(front-.13,x),bodyTop(c,Math.min(front-.13,x))+.015,z]);}b.line(hood,.0045,M.seam,6);
  for(const side of [-1,1]){const crease=[];for(let k=0;k<=20;k++){const t=k/20,x=mix(c.cab[3]+.13,front-.20,t),z=side*c.W*mix(.29,.24,t);const u=z/bodyWidth(c,x);crease.push([x,bodyTop(c,x)+.026*(1-u*u)-.06*Math.pow(Math.abs(u),4)+.002,z]);}b.line(crease,.0028,M.darkChrome,5);}
  if(!c.ev)for(const s of [-1,1]){b.cyl(.038,.105,[rear-.028,.265,s*c.W*.29],M.chrome,[0,0,Math.PI/2],20);b.cyl(.028,.111,[rear-.034,.265,s*c.W*.29],M.black,[0,0,Math.PI/2],20);}
  // Doors, handles, wing mirrors, wheel-arch protection and side repeaters.
  for(const s of [-1,1]){
    const doorRear=Math.max(-c.wb/2+c.R+.07,c.cab[0]+.06),doorFront=Math.min(c.wb/2-c.R-.05,c.cab[3]-.08),divider=c.bed?.22:c.van?.38:c.id==='coupe'?-0.52:c.id==='cabriolet'?-.65:-.20;
    const cuts=c.doors===2?[doorRear,doorFront]:[doorRear,divider,doorFront];
    for(const x of cuts){const y0=Math.max(.37,archBottom(c,x)+.03),y1=bodyTop(c,x)-.065;const pts=[];for(let k=0;k<=8;k++){const yy=mix(y0,y1,k/8);const low=archBottom(c,x),tt=clamp((yy-low)/(y1-low),0,1);pts.push([x,yy,s*(bodyWidth(c,x)*(mix(low>.36?.979:.93,.965,tt)+.055*Math.sin(tt*Math.PI))+.003)]);}if(y1>y0)b.line(pts,.004,M.seam,6);}
    const bottom=[];for(let k=0;k<=16;k++){const x=mix(doorRear,doorFront,k/16);bottom.push([x,.35,s*(bodyWidth(c,x)*.955)]);}b.line(bottom,.004,M.seam,6);
    const handles=c.doors===2?[divider+.50]:[Math.min(doorFront-.24,divider+.51),Math.max(doorRear+.22,divider-.42)];
    for(const x of handles){const z=s*(bodyWidth(c,x)*.994+.013);b.box([.17,.030,.031],[x,c.belt-.14,z],M.darkChrome,[0,0,0],.012);b.box([.12,.014,.036],[x+.008,c.belt-.133,z+s*.004],M.chrome,[0,0,0],.006);}
    const mx=c.cab[3]-.25,my=c.belt+.15,mz=s*(c.W*.5+.075);
    b.rod([mx+.03,c.belt+.06,s*c.W*.452],[mx,my,mz-s*.04],.019,M.black,10);
    b.box([.23,.11,.15],[mx,my,mz],M.paint,[0,0,.03],.035);b.box([.017,.073,.12],[mx-.116,my,mz],M.mirror,[0,0,0],.012);b.box([.10,.010,.015],[mx+.01,my-.009,mz+s*.078],M.white,[0,0,0],.005);
    b.box([.075,.022,.009],[c.wb/2-.27,c.belt-.23,s*(c.W*.502)],M.amber,[0,0,0],.004);
    if(c.steps)b.box([c.wb-2*c.R+.20,.07,.19],[0,.285,s*c.W*.52],M.darkChrome,[0,0,0],.025);
    if(c.van){b.rod([-1.82,c.belt-.08,s*c.W*.503],[.32,c.belt-.08,s*c.W*.503],.011,M.darkChrome,8);b.rod([-.68,.39,s*c.W*.476],[.23,.39,s*c.W*.476],.006,M.seam,6);}
  }
  // Wipers lie against the curved lower windshield.
  for(const s of [-1,1]){
    const x=c.cab[3]-.035,y=c.belt+.075;
    b.rod([x,y,s*.36],[x-.09,y+.10,s*.13],.007,M.black,8);b.rod([x-.10,y+.115,s*.13-.23],[x-.10,y+.115,s*.13+.23],.009,M.black,8);
  }
  if(c.hatch&&!c.bed){const x=c.cab[0]-.018,y=c.belt+.10;b.rod([x,y,-.10],[x+.06,y+.15,.14],.008,M.black,8);b.rod([x+.06,y+.15,-.01],[x+.06,y+.15,.30],.009,M.black,8);}
  // Shark-fin antenna and rear hatch shut line / rear deck separation.
  if(!c.open){b.box([.10,.06,.045],[c.cab[1]+.20,c.H+.025,0],M.paint,[0,0,-.27],.015);}
  if(!c.bed&&!c.hatch){const pts=[];for(let k=0;k<=14;k++){const z=mix(-c.W*.40,c.W*.40,k/14);pts.push([c.cab[0]-.12,bodyTop(c,c.cab[0]-.12)+.014,z]);}b.line(pts,.004,M.seam,6);}
  if(c.ev){for(const s of [-1,1])b.box([.16,.13,.012],[-c.wb/2+.10,c.belt-.18,s*c.W*.502],M.seam,[0,0,0],.025);}
  // Ground-plane-free geometry: every wheel itself sits at Y=0.
}

function makePickupBed(b,c,M){
  const rear=-c.L*.5,start=rear+.16,end=c.cab[0]-.065,length=end-start,cx=(start+end)/2;
  b.box([length,.045,c.W*.73],[cx,.66,0],M.black);
  for(const s of [-1,1]){
    b.box([length,.46,.045],[cx,.89,s*c.W*.37],M.paint,[0,0,0],.015);
    b.rod([start,c.belt+.005,s*c.W*.395],[end,c.belt+.005,s*c.W*.395],.023,M.black,10);
    b.box([.84,.25,.23],[-c.wb*.5,.79,s*c.W*.32],M.black,[0,0,0],.09);
    for(const x of [start+.12,end-.12])b.add(new b.T.TorusGeometry(.035,.008,6,16),M.chrome,[x,.89,s*c.W*.345],[Math.PI/2,0,0]);
  }
  for(let j=-5;j<=5;j++)b.box([length-.08,.014,.018],[cx,.691,j*c.W*.057],M.darkChrome,[0,0,0],.004);
  b.box([.055,.45,c.W*.74],[start,.89,0],M.paint);
  b.box([.04,.055,.22],[rear-.025,c.belt-.11,0],M.black,[0,0,0],.01);
  for(const s of [-1,1])b.rod([rear-.008,.39,s*c.W*.44],[rear-.008,c.belt-.045,s*c.W*.44],.0045,M.seam,6);
  b.rod([rear-.014,.39,-c.W*.43],[rear-.014,.39,c.W*.43],.0045,M.seam,6);
  b.box([.09,.07,.38],[rear-.04,.29,0],M.darkChrome,[0,0,0],.025);
}
