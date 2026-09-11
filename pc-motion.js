// Observe existing visual state only; never start audio or send requests.
const body=document.body;
const panel=document.querySelector('.assistant-panel');
const state=document.getElementById('state');
const receipt=document.getElementById('receipt');
const desktop=matchMedia('(min-width:721px)');
const reduced=matchMedia('(prefers-reduced-motion:reduce)');
let greeting=false,ended=false,seenReceipt='',timer=null;
if(panel&&state&&receipt){
 const control=document.createElement('div');control.className='motion-preference';
 const label=document.createElement('label');const input=document.createElement('input');input.type='checkbox';
 let enabled=!reduced.matches;
 try{const saved=localStorage.getItem('general-reception-pc-motion');if(saved!==null)enabled=saved==='on';}catch{}
 input.checked=enabled;label.append(input,document.createTextNode('キャラクターを動かす'));control.append(label);panel.append(control);
 function update(){
  const paused=!desktop.matches||document.hidden||!input.checked||reduced.matches;
  // Apply pause only on PC, so the old mobile visual behaviour is unchanged.
  const shouldPause=desktop.matches&&paused;
  if(body.classList.contains('pc-motion-paused')!==shouldPause)body.classList.toggle('pc-motion-paused',shouldPause);
  const mode=ended?'ended':body.classList.contains('speaking')?'speaking':greeting?'greeting':body.classList.contains('listening')?'listening':'idle';
  if(body.dataset.pcMotion!==mode)body.dataset.pcMotion=mode;
 }
 input.addEventListener('change',()=>{try{localStorage.setItem('general-reception-pc-motion',input.checked?'on':'off');}catch{}update();});
 new MutationObserver(update).observe(body,{attributes:true,attributeFilter:['class']});
 new MutationObserver(()=>{
  const value=receipt.textContent;
  if(value!==seenReceipt&&value.includes('受付番号')){seenReceipt=value;ended=false;greeting=true;clearTimeout(timer);timer=setTimeout(()=>{greeting=false;update();},1400);}
  update();
 }).observe(receipt,{childList:true,characterData:true,subtree:true});
 new MutationObserver(()=>{if(state.textContent.includes('受付を終了しました')){ended=true;greeting=false;clearTimeout(timer);}update();}).observe(state,{childList:true,characterData:true,subtree:true});
 document.addEventListener('visibilitychange',update);desktop.addEventListener('change',update);reduced.addEventListener('change',update);update();
}
