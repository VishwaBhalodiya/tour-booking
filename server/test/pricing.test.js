import {test} from 'node:test';import assert from 'node:assert/strict';import {calculatePrice} from '../src/pricing.js';
const departure={adultRate:1000,childRate:500,seasonMultiplier:1.5,singleCharge:200,tripleCharge:-50,season:'peak'};
test('season, child pricing, per-person room and extras, GST',()=>{const p=calculatePrice(departure,{adults:2,children:1,sharing:'single'},[{name:'Insurance',price:100,perPerson:true},{name:'Pickup',price:500}],5);assert.equal(p.subtotal,5150);assert.equal(p.total,5407.5)});
test('triple discount and rounding',()=>{assert.equal(calculatePrice(departure,{adults:1,children:0,sharing:'triple'},[],5).total,1522.5)});
test('reject invalid traveller counts and sharing',()=>{for(const input of [{adults:0,children:1,sharing:'twin'},{adults:1,children:-1,sharing:'twin'},{adults:1,children:0,sharing:'other'}])assert.throws(()=>calculatePrice(departure,input,[],5))});
