export function calculatePrice(departure,input,addons,gst){
 const {adults,children,sharing}=input;
 if(!Number.isInteger(adults)||adults<1||!Number.isInteger(children)||children<0||adults+children>30) throw new Error('Select 1–30 travellers, including at least one adult.');
 if(!['twin','triple','single'].includes(sharing))throw new Error('Invalid room sharing.');
 const round=n=>Math.round((n+Number.EPSILON)*100)/100;
 const multiplier=departure.seasonMultiplier??1;
 const adultTotal=round(departure.adultRate*multiplier*adults),childTotal=round(departure.childRate*multiplier*children);
 const roomCharge=round((sharing==='single'?departure.singleCharge:sharing==='triple'?departure.tripleCharge:0)*(adults+children));
 const extras=addons.map(a=>({name:a.name,amount:round(a.price*(a.perPerson?adults+children:1))}));
 const subtotal=round(adultTotal+childTotal+roomCharge+extras.reduce((s,a)=>s+a.amount,0));
 if(subtotal<0)throw new Error('Room discount exceeds package price.');
 const tax=round(subtotal*gst/100);
 return {adultTotal,childTotal,roomCharge,extras,subtotal,gst,tax,total:round(subtotal+tax),season:departure.season,multiplier};
}
