import {DEPARTMENT_NAMES,chunks,classify,excerpts,SaveQueue,isExpired} from './core.mjs';
const $=id=>document.getElementById(id), cfg=window.RECEPTION_CONFIG;
const speech=window.speechSynthesis;
const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
let base='', masters={faqs:[],departments:[]}, session=null, starting=false, busy=false, ready=false, recognizer=null, unknownCount=0, finalRequest=null, startRequest=null;
let speechGeneration=0, activeUtterance=null;
const limit=Math.min(600,Math.max(1,Number(cfg.maxSeconds)||600));
const queue=new SaveQueue(({action,payload})=>api(action,payload),q=>{
  if(!session)return;
  $('saveStatus').textContent=q.error?'保存に失敗しました。未保存 '+q.items.length+' 件。再試行してください。':q.items.length?'保存中：残り '+q.items.length+' 件':session.closed?'保存完了：受付一覧・会話ログに記録しました。':'ここまで保存済みです。';
  $('retry').hidden=!q.error;
  $('restart').disabled=q.items.length>0||q.running;
});
function state(text){$('state').textContent=text;}
function stopSpeech(){speechGeneration++;speech?.cancel();activeUtterance=null;document.body.classList.remove('speaking');}
function speak(text){
  stopSpeech();if(!$('readAloud').checked||!speech)return;
  const generation=speechGeneration;
  activeUtterance=new SpeechSynthesisUtterance(text);activeUtterance.lang='ja-JP';activeUtterance.rate=1;
  activeUtterance.onstart=()=>{if(generation===speechGeneration)document.body.classList.add('speaking');};
  const done=()=>{if(generation===speechGeneration){document.body.classList.remove('speaking');activeUtterance=null;}};
  activeUtterance.onend=done;activeUtterance.onerror=done;speech.speak(activeUtterance);
}
async function api(action,payload={}){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),cfg.requestTimeoutMs||35000);
  try{
    const response=await fetch(base+'/api/reception-submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({purpose:'general-reception-v0.1',action,payload}),signal:controller.signal,cache:'no-store'});
    const data=await response.json();
    if(!response.ok||data.ok!==true){const e=new Error(data.code||'API_ERROR');e.code=data.code;throw e;}return data;
  }finally{clearTimeout(timer);}
}
function controls(){
  const active=session&&!session.closed&&!busy;
  for(const id of ['question','send','human','end'])$(id).disabled=!active;
  $('mic').disabled=!active||!Recognition;
  $('start').disabled=!ready||!$('consent').checked||starting;
}
function showMessage(speaker,text){
  const block=document.createElement('div');block.className='message'+(speaker==='利用者'?' user':'');
  const title=document.createElement('strong');title.textContent=speaker==='AI'?'受付案内':speaker;
  block.append(title,document.createTextNode(text));$('messages').append(block);$('messages').scrollTop=$('messages').scrollHeight;
}
function log(speaker,text,faqId=''){
  const occurredAt=new Date().toISOString();session.messages.push({speaker,text,occurredAt});
  for(const part of chunks(text)){
    queue.add('appendConversationLog',{requestId:session.requestId,receiptNumber:session.receiptNumber,messageId:crypto.randomUUID(),sequence:++session.sequence,speaker,occurredAt,text:part,faqId,saveReason:'発言確定時'});
  }
}
function say(text,faqId=''){showMessage('AI',text);log('AI',text,faqId);speak(text);}
function departmentCard(name,container){
  const d=masters.departments.find(x=>x.name===name);const card=document.createElement('div');card.className='dept';
  const h=document.createElement('h3');h.textContent=name;card.append(h);
  if(d?.phone&&/^[0-9()+\-\s]{8,24}$/.test(d.phone)){
    const a=document.createElement('a');a.href='tel:'+d.phone.replace(/[^+0-9]/g,'');a.textContent=d.phone;a.setAttribute('aria-label',name+' '+d.phone+' に電話する');card.append(a);
  }else{const p=document.createElement('p');p.textContent='電話番号は登録確認中です。';card.append(p);}
  if(d?.note){const p=document.createElement('p');p.textContent=d.note;card.append(p);}
  container.append(card);
}
function clearChoices(){$('choices').replaceChildren();}
function pickDepartment(onPick){
  clearChoices();const p=document.createElement('p');p.textContent='相談する担当課を選んでください。分からない場合は総務課をご案内します。';$('choices').append(p);
  for(const name of DEPARTMENT_NAMES){const b=document.createElement('button');b.type='button';b.textContent=name;b.onclick=()=>{clearChoices();onPick(name);};$('choices').append(b);}
}
function closeRecognition(){const r=recognizer;recognizer=null;if(r){r.onresult=null;r.onend=null;r.abort();}document.body.classList.remove('listening');$('mic').textContent='マイクで入力';}
function expired(){return session&&!session.closed&&isExpired(session.startedAt,Date.now(),limit);}
function finalize(result,reason='',department=''){
  if(!session||session.closed)return;
  session.closed=true;busy=false;closeRecognition();clearChoices();
  const endedAt=new Date(),duration=Math.floor((endedAt.getTime()-session.startedAt)/1000);
  finalRequest={requestId:session.requestId,receiptNumber:session.receiptNumber,endedAt:endedAt.toISOString(),category:'一般受付',consultationSummary:excerpts(session.messages,'利用者'),aiAnswerSummary:excerpts(session.messages,'AI'),unresolvedItems:department?'担当課への相談が必要。'+reason:'',department,departmentPhone:masters.departments.find(d=>d.name===department)?.phone||'',handoffReason:reason,overTenMinutes:duration>=600,durationSeconds:Math.min(duration,86400),result};
  queue.add('finalizeReception',finalRequest);$('restart').hidden=false;controls();state('受付を終了しました。担当課への通知・自動転送は行いません。');
}
function handoff(department,reason='職員への相談希望',force=false){
  if(!session||session.closed)return;
  closeRecognition();
  if(!department&&!force){say('担当課をご案内します。ご相談先を選んでください。');pickDepartment(name=>handoff(name,reason,true));return;}
  const name=department||session.lastDepartment||'総務課';
  stopSpeech();closeRecognition();const d=masters.departments.find(x=>x.name===name);
  const text='申し訳ありません。私では、これ以上お答えすることが難しいため、'+name+'をご案内します。'+(d?.phone?'電話番号は '+d.phone+' です。':'電話番号は登録確認中です。')+'こちらで音声・文字の受付を終了します。担当課への通知や電話の自動転送は行っていません。';
  say(text);$('handoff').hidden=false;$('handoff').replaceChildren();departmentCard(name,$('handoff'));
  finalize(reason==='職員への相談希望'?'職員相談希望':'担当課案内',reason,name);
}
function enforceLimit(){
  if(!session)return;
  const remaining=Math.max(0,limit-Math.floor((Date.now()-session.startedAt)/1000));
  if(!session.closed)$('clock').textContent=String(Math.floor(remaining/60)).padStart(2,'0')+':'+String(remaining%60).padStart(2,'0');
  if(expired())handoff(session.lastDepartment,'受付時間の上限に到達',true);
}
function answerFaq(faq){
  enforceLimit();if(!session||session.closed)return;
  clearChoices();if(faq.department)session.lastDepartment=faq.department;
  if(faq.handoffCondition){handoff(faq.department,'FAQに担当課確認条件あり',true);return;}
  unknownCount=0;say(faq.answer+(faq.note?'\n'+faq.note:''),faq.id);state('ほかにご用件があればお聞かせください。');
}
async function submit(event){
  event.preventDefault();enforceLimit();if(!session||session.closed||busy)return;
  const question=$('question').value.trim();if(!question)return;
  closeRecognition();stopSpeech();busy=true;controls();clearChoices();
  const result=classify(question,masters.faqs,masters.departments,session.lastDepartment);
  const recorded=result.kind==='sensitive'?'【個別・機微な相談のため、入力内容の詳細は記録しません】':question;
  showMessage('利用者',recorded);log('利用者',recorded);$('question').value='';
  if(result.department)session.lastDepartment=result.department;
  if(result.kind==='answer')answerFaq(result.faq);
  else if(result.kind==='choices'){
    say('近い内容が複数見つかりました。画面からご用件を選んでください。');
    for(const f of result.faqs){const b=document.createElement('button');b.type='button';b.textContent=f.label||f.keywords;b.onclick=()=>answerFaq(f);$('choices').append(b);}
  }else if(result.kind==='handoff'||result.kind==='sensitive')handoff(result.department,result.reason,true);
  else{
    unknownCount++;
    if(unknownCount>=2)handoff(result.department,'FAQで回答を確認できなかった',true);
    else{say('登録されているFAQでは確認できませんでした。ご用件をもう少し具体的にお伝えいただくか、担当課を選んでください。');pickDepartment(name=>handoff(name,'FAQで回答を確認できなかった',true));}
  }
  busy=false;controls();
}
async function start(){
  if(starting||session||!ready||!$('consent').checked)return;
  starting=true;controls();state('受付番号を発行しています。');
  // 応答だけ失われても、同じrequestIdで再試行して受付の二重作成を防ぐ。
  if(!startRequest)startRequest={requestId:crypto.randomUUID(),channel:'Webチャット',startedAt:new Date().toISOString(),category:'一般受付'};
  const wait=setTimeout(()=>{state('受付情報を確認しています。しばらくお待ちください。');speak('受付情報を確認しています。しばらくお待ちください。');},cfg.waitNoticeMs||2500);
  try{
    const data=await api('createReception',startRequest);if(!data.receiptNumber)throw new Error('受付番号が返りませんでした');
    session={requestId:startRequest.requestId,receiptNumber:data.receiptNumber,startedAt:Date.parse(startRequest.startedAt),closed:false,sequence:0,messages:[],lastDepartment:''};
    $('receipt').textContent='受付番号 '+data.receiptNumber;$('consentBox').hidden=true;
    say('こんにちは。一般受付です。ご用件をお聞かせください。公開講座のご相談は企画調査課をご案内します。');state('音声入力、または文字入力をご利用ください。');enforceLimit();
  }catch(e){state('受付を開始できませんでした。接続設定を確認して再度お試しください。');$('saveStatus').textContent='受付開始エラー：'+(e.code||e.message);}
  finally{clearTimeout(wait);starting=false;controls();}
}
function microphone(){
  enforceLimit();if(!session||session.closed||busy||!Recognition)return;
  if(recognizer){recognizer.stop();return;}
  stopSpeech();const initial=$('question').value;const r=new Recognition();recognizer=r;r.lang='ja-JP';r.continuous=false;r.interimResults=true;
  r.onresult=event=>{
    if(recognizer!==r||session.closed)return;let text='';for(let i=0;i<event.results.length;i++)text+=event.results[i][0].transcript;
    $('question').value=(initial+(initial?'\n':'')+text).slice(0,12000);
  };
  r.onerror=event=>{state(event.error==='not-allowed'?'マイクが許可されていません。文字入力をご利用ください。':'音声を認識できませんでした。文字入力も利用できます。');};
  r.onend=()=>{if(recognizer===r){recognizer=null;document.body.classList.remove('listening');$('mic').textContent='マイクで入力';if(!session.closed)state('入力内容を確認し、「送信する」を押してください。');}};
  try{r.start();document.body.classList.add('listening');$('mic').textContent='音声入力を止める';state('お話しください。入力後に内容を確認できます。');}catch(_){closeRecognition();state('音声入力を開始できません。文字入力をご利用ください。');}
}
async function load(){
  try{const u=new URL(cfg.workerBaseUrl);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error();base=u.origin;}
  catch(_){$('setup').textContent='接続設定が必要です。管理者はconfig.jsのworkerBaseUrlに一般受付WorkerのURLを設定してください（末尾の/healthは不要）。';return;}
  state('FAQと担当課の情報を確認しています。');const wait=setTimeout(()=>state('情報を確認しています。しばらくお待ちください。'),cfg.waitNoticeMs||2500);
  try{
    const data=await api('getPublicMasters');if(!Array.isArray(data.faqs)||!Array.isArray(data.departments))throw new Error('MASTER_FORMAT');masters=data;ready=true;
    $('setup').textContent='FAQ '+data.faqs.length+' 件・担当課 '+data.departments.length+' 件を読み込みました。試験運用中です。';
    for(const name of DEPARTMENT_NAMES)departmentCard(name,$('departments'));
    state(Recognition?'音声・文字のどちらでも利用できます。':'このブラウザでは文字受付をご利用ください。');controls();
  }catch(e){$('setup').textContent='FAQを読み込めませんでした。Worker・Apps Scriptを同梱のVer0.2に更新し、許可元URLを確認してください。エラー：'+(e.code||e.message);state('現在、受付を開始できません。');}
  finally{clearTimeout(wait);}
}
$('consent').onchange=controls;$('start').onclick=start;$('form').onsubmit=submit;$('mic').onclick=microphone;
$('human').onclick=()=>{enforceLimit();handoff(session?.lastDepartment);};
$('end').onclick=()=>{enforceLimit();if(!session||session.closed)return;stopSpeech();say('ご利用ありがとうございました。受付を終了し、記録を保存します。');finalize('利用者終了');};
$('retry').onclick=()=>queue.flush();$('stopSpeech').onclick=stopSpeech;$('readAloud').onchange=()=>{if(!$('readAloud').checked)stopSpeech();};
$('restart').onclick=()=>{if(queue.items.length||queue.running)return;stopSpeech();location.reload();};
window.addEventListener('online',()=>{if(queue.error)void queue.flush();});
window.addEventListener('beforeunload',e=>{if(starting||(session&&!session.closed)||queue.items.length){e.preventDefault();e.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){closeRecognition();stopSpeech();}else enforceLimit();});
window.addEventListener('pageshow',enforceLimit);setInterval(enforceLimit,500);void load();
