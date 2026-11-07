import {MODELS as cars,buildModel as buildCar} from './cars.js';
import {MODELS as trucks,buildModel as buildTruck} from './trucks.js';
import {MODELS as marine,buildModel as buildMarine} from './marine.js';
export const MODELS=[...cars,...trucks,...marine];
export function buildModel(THREE,id){
  const item=MODELS.find(m=>m.id===id);
  if(!item)throw new Error('Unknown model '+id);
  const result=item.category==='cars'?buildCar(THREE,id):item.category==='trucks'?buildTruck(THREE,id):buildMarine(THREE,id);
  const group=result.isObject3D?result:result.group;
  group.name=item.name;
  group.userData={...group.userData,id,name:item.name,category:item.category,units:'meters'};
  return group;
}
