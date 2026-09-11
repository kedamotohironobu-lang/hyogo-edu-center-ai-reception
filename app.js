function voiceErrorMessage(error){
  const code=error?.name==='NotAllowedError'?'MIC_PERMISSION_DENIED':error?.name==='NotFoundError'?'MIC_NOT_FOUND':error?.name==='NotReadableError'?'MIC_BUSY':error?.message||'VOICE_UNKNOWN';
  const messages={MIC_PERMISSION_DENIED:'マイクの使用が許可されていません。ブラウザのマイク許可をご確認ください。',MIC_NOT_FOUND:'マイクが見つかりません。',MIC_BUSY:'マイクを開始できません。他の通話や録音を終了してお試しください。',VOICE_BROWSER_UNSUPPORTED:'このブラウザでは音声処理を利用できません。',VOICE_PROCESSOR_LOAD_FAILED:'音声処理ファイルを読み込めませんでした。更新ファイルの配置をご確認ください。',VOICE_TOKEN_HTTP_404:'音声接続先が見つかりません。Workerの音声機能をご確認ください。'};
  return (messages[code]||'音声に接続できませんでした。文字で相談できます。')+'（確認コード：'+(/^[A-Za-z0-9_-]{1,80}$/.test(code)?code:'VOICE_START_FAILED')+'）';
}
import {setupMobileUI} from './mobile-ui.mjs';
let mobileUI=null;
import {DEPARTMENT_NAMES,chunks,classify,excerpts,SaveQueue,isExpired} from './core.mjs';
import {LiveTranscription} from './live-transcription.mjs?v=voice-fix-1';
import {trainingPolicy,improvementQuestion} from './training-policy.mjs';
let pendingTraining=null;
const $=id=>document.getElementById(id), cfg=window.RECEPTION_CONFIG;
const speech=window.speechSynthesis;
const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
let base='', masters={faqs:[],departments:[]}, session=null, starting=false, busy=false, ready=false, recognizer=null, unknownCount=0, finalRequest=null, startRequest=null;
let speechGeneration=0, activeUtterance=null;
let live=null, liveConnecting=false, liveResumeTimer=null;
function pauseLive(){clearTimeout(liveResumeTimer);live?.pause();document.body.classList.remove('listening');}
function resumeLive(){clearTimeout(liveResumeTimer);liveResumeTimer=setTimeout(()=>{
  enforceLimit();if(live&&!liveConnecting&&session&&!session.closed&&!busy&&!activeUtterance&&!document.hidden){live.resume();document.body.classList.add('listening');state('お話しください。話し終えると自動で送信します。');}
},700);}
function stopLive(){clearTimeout(liveResumeTimer);const old=live;live=null;liveConnecting=false;old?.close();document.body.classList.remove('listening');$('live').textContent='続けて話す（自動送信）';controls();}
async function toggleLive(){
  if(live){stopLive();state('連続音声を停止しました。文字でも入力できます。');return;}
  enforceLimit();if(!session||session.closed||busy)return;
  closeRecognition();stopSpeech();liveConnecting=true;state('音声受付に接続しています。');
  const client=new LiveTranscription({base,
    onPreview:text=>{if(live===client&&!session.closed)$('voicePreview').textContent=text;},
    onText:text=>{if(live!==client)return;enforceLimit();if(session.closed)return;$('voicePreview').textContent='';$('question').value=text;void submit({preventDefault(){}});},
    onError:error=>{if(live===client){stopLive();state('連続音声の接続が切れました。文字入力、またはマイクで入力をご利用ください。');$('voicePreview').textContent='音声接続：'+error.message;mobileUI?.fallback(voiceErrorMessage(error));}}
  });
  live=client;$('live').textContent='音声接続を中止';controls();
  try{await client.start();if(live!==client)return;liveConnecting=false;$('live').textContent='連続音声を止める';controls();resumeLive();}
  catch(error){if(live===client){stopLive();state('連続音声を開始できませんでした。文字入力、またはマイクで入力をご利用ください。');$('voicePreview').textContent='音声接続：'+error.message;mobileUI?.fallback(voiceErrorMessage(error));}}
}
const limit=Math.min(600,Math.max(1,Number(cfg.maxSeconds)||600));
const queue=new SaveQueue(({action,payload})=>api(action,payload),q=>{
  if(!session)return;
  $('saveStatus').textContent=q.error?'保存に失敗しました。未保存 '+q.items.length+' 件。再試行してください。':q.items.length?'保存中：残り '+q.items.length+' 件':session.closed?'保存完了：受付一覧・会話ログに記録しました。':'ここまで保存済みです。';
  $('retry').hidden=!q.error;
  $('restart').disabled=q.items.length>0||q.running;
});
function state(text){$('state').textContent=text;mobileUI?.update();}
function stopSpeech(){pauseLive();speechGeneration++;speech?.cancel();activeUtterance=null;document.body.classList.remove('speaking');}
function speak(text){
  stopSpeech();if(!$('readAloud').checked||!speech){resumeLive();return;}
  const generation=speechGeneration;
  activeUtterance=new SpeechSynthesisUtterance(text);activeUtterance.lang='ja-JP';activeUtterance.rate=1;
  activeUtterance.onstart=()=>{if(generation===speechGeneration)document.body.classList.add('speaking');};
  const done=()=>{if(generation===speechGeneration){document.body.classList.remove('speaking');activeUtterance=null;resumeLive();}};
  activeUtterance.onend=done;activeUtterance.onerror=e=>{if(generation!==speechGeneration)return;done();if(!['canceled','interrupted'].includes(e.error))mobileUI?.fallback('音声の読み上げを開始できませんでした。回答をチャットでご確認ください。');};speech.speak(activeUtterance);
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
  $('mic').disabled=!active||!Recognition||Boolean(live);
  $('live').disabled=(!active&&!live)||!window.AudioWorkletNode||!navigator.mediaDevices?.getUserMedia;
  $('start').disabled=!ready||!$('consent').checked||starting;
  mobileUI?.update();
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
  session.closed=true;busy=false;stopLive();closeRecognition();clearChoices();
  const endedAt=new Date(),duration=Math.floor((endedAt.getTime()-session.startedAt)/1000);
  finalRequest={requestId:session.requestId,receiptNumber:session.receiptNumber,endedAt:endedAt.toISOString(),category:'一般受付',consultationSummary:excerpts(session.messages,'利用者'),aiAnswerSummary:excerpts(session.messages,'AI'),unresolvedItems:department?'担当課への相談が必要。'+reason:'',department,departmentPhone:masters.departments.find(d=>d.name===department)?.phone||'',handoffReason:reason,overTenMinutes:duration>=600,durationSeconds:Math.min(duration,86400),result};
  queue.add('finalizeReception',finalRequest);$('restart').hidden=false;controls();state('受付を終了しました。担当課への通知・自動転送は行いません。');
}
function handoff(department,reason='職員への相談希望',force=false,preface=''){
  if(!session||session.closed)return;
  closeRecognition();
  if(!department&&!force){say('担当課をご案内します。ご相談先を選んでください。');pickDepartment(name=>handoff(name,reason,true));return;}
  const name=department||session.lastDepartment||'総務課';
  stopSpeech();closeRecognition();const d=masters.departments.find(x=>x.name===name);
  const text='申し訳ありません。私では、これ以上お答えすることが難しいため、'+name+'をご案内します。'+(d?.phone?'電話番号は '+d.phone+' です。':'電話番号は登録確認中です。')+'こちらで音声・文字の受付を終了します。担当課への通知や電話の自動転送は行っていません。';
  say(preface?preface+'\n'+text:text);$('handoff').hidden=false;$('handoff').replaceChildren();departmentCard(name,$('handoff'));
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
  let result=classify(question,masters.faqs,masters.departments,session.lastDepartment);
  if(!/公開講座/.test(question)&&result.kind!=='sensitive'){
    const followup=pendingTraining&&!pendingTraining.selectCourse&&/^(小学校|中学校|高校|高等学校|特別支援学校)(です)?[。！!\s]*$/.test(question.trim());
    const policy=trainingPolicy(followup?question+' '+pendingTraining.question:question,masters.faqs);
    if(policy)result=policy;
  }
  const recorded=result.kind==='sensitive'?'【個別・機微な相談のため、入力内容の詳細は記録しません】':question;
  showMessage('利用者',recorded);log('利用者',recorded);$('question').value='';
  if(result.department)session.lastDepartment=result.department;
  if(result.kind==='training'){
    pendingTraining=null;
    if(result.department){
      handoff(result.department,'研修の問い合わせ',true,result.faq.answer);
    }else{
      pendingTraining={question,selectCourse:result.selectCourse};
      say(result.faq.answer+'\n'+(result.selectCourse?'開催している課を選んでください。不明な場合は、講座の実施要項で担当課をご確認ください。':'所属する校種を教えてください。小学校・中学校、高校、特別支援学校から選べます。'),result.faq.id);
      const names=result.selectCourse?DEPARTMENT_NAMES:['義務教育研修課','高校教育研修課','特別支援教育研修課'];
      for(const name of names){const b=document.createElement('button');b.type='button';b.textContent=name;b.onclick=()=>{pendingTraining=null;handoff(name,'研修の問い合わせ',true);};$('choices').append(b);}
    }
  }else if(result.kind==='answer'){pendingTraining=null;answerFaq(result.faq);}
  else if(result.kind==='choices'){
    say('近い内容が複数見つかりました。画面からご用件を選んでください。');
    for(const f of result.faqs){const b=document.createElement('button');b.type='button';b.textContent=f.label||f.keywords;b.onclick=()=>answerFaq(f);$('choices').append(b);}
  }else if(result.kind==='handoff'||result.kind==='sensitive')handoff(result.department,result.reason,true);
  else{
    queue.add('addFaqImprovement',{requestId:session.requestId,receiptNumber:session.receiptNumber,candidateId:crypto.randomUUID(),question:improvementQuestion(question),category:'一般受付',department:result.department||'',reason:'登録FAQに一致せず回答できなかった。質問は最大900文字。全文は会話ログ参照。'});
    unknownCount++;
    if(unknownCount>=2)handoff(result.department,'FAQで回答を確認できなかった',true);
    else{say('登録されているFAQでは確認できませんでした。ご用件をもう少し具体的にお伝えいただくか、担当課を選んでください。');pickDepartment(name=>handoff(name,'FAQで回答を確認できなかった',true));}
  }
  busy=false;controls();if(!activeUtterance)resumeLive();
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
$('live').onclick=toggleLive;
$('question').addEventListener('focus',()=>{if(live){stopLive();state('文字入力に切り替えました。');}});
$('human').onclick=()=>{enforceLimit();handoff(session?.lastDepartment);};
$('end').onclick=()=>{enforceLimit();if(!session||session.closed)return;stopSpeech();say('ご利用ありがとうございました。受付を終了し、記録を保存します。');finalize('利用者終了');};
$('retry').onclick=()=>queue.flush();$('stopSpeech').onclick=()=>{stopSpeech();resumeLive();};$('readAloud').onchange=()=>{if(!$('readAloud').checked){stopSpeech();resumeLive();}};
$('restart').onclick=()=>{if(queue.items.length||queue.running)return;stopSpeech();location.reload();};
window.addEventListener('online',()=>{if(queue.error)void queue.flush();});
window.addEventListener('beforeunload',e=>{if(starting||(session&&!session.closed)||queue.items.length){e.preventDefault();e.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopLive();closeRecognition();stopSpeech();}else enforceLimit();});
mobileUI=setupMobileUI({getState:()=>({session,ready,starting,busy,live,liveConnecting}),toggleLive,stopLive,stopSpeech,closeRecognition});
window.addEventListener('pageshow',enforceLimit);setInterval(enforceLimit,500);void load();
