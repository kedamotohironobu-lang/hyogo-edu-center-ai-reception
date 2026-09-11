// One reception, two views. No duplicate session or persistence logic.
export function setupMobileUI({getState,toggleLive,stopLive,stopSpeech,closeRecognition}) {
  const $=id=>document.getElementById(id), body=document.body;
  const mobile=matchMedia('(max-width: 720px)');
  let mode='character', previousReadAloud=true;
  const icon=(name)=>'<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+({chat:'<path d="M21 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 19 0Z"/><path d="M7 9h10M7 13h7"/>',person:'<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',mic:'<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>',end:'<path d="m4 9 16 6M4 15l16-6"/>',mute:'<path d="m10 5-5 4H2v6h3l5 4ZM16 9l6 6M22 9l-6 6"/>'}[name])+'</svg>';
  function iconButton(id,name,label){const b=$(id);b.innerHTML=icon(name)+'<span class="mobile-accessible-label">'+label+'</span>';b.setAttribute('aria-label',label);b.title=label;}
  const bar=document.createElement('div');bar.className='mobile-mode-bar';
  bar.innerHTML='<span id="mobileModeLabel">音声で相談</span><button type="button" id="mobileSwitch">チャットで相談</button>';
  document.querySelector('.workspace').before(bar);
  const box=document.createElement('div');box.className='mobile-voice-controls';
  box.innerHTML='<p id="mobileReply">こんにちは。ご用件をお聞かせください。</p><p id="mobileStatus" role="status"></p><button type="button" id="mobileVoice" class="primary">音声で受付を始める</button><button type="button" id="mobileStopSpeech" class="text-button">読み上げを止める</button><p class="small">話し終えると自動で送信します</p>';
  document.querySelector('.assistant-panel').append(box);
  const endButton=document.createElement('button');endButton.id='mobileEnd';endButton.type='button';endButton.className='mobile-end-button';box.append(endButton);
  iconButton('mobileEnd','end','受付を終了する');
  iconButton('mobileStopSpeech','mute','読み上げを止める');
  const notice=document.createElement('p');notice.id='mobileFallback';notice.className='mobile-fallback';notice.hidden=true;notice.setAttribute('role','status');bar.after(notice);
  function change(next,reason='',keepSpeech=false) {
    if(next===mode&&!reason)return;
    if(next==='chat') {previousReadAloud=$('readAloud').checked;stopLive();closeRecognition();if(!keepSpeech)stopSpeech();$('readAloud').checked=false;}
    else {$('readAloud').checked=previousReadAloud;}
    mode=next;body.dataset.mobileMode=mode;
    notice.textContent=reason;notice.hidden=!reason;
    iconButton('mobileSwitch',mode==='character'?'chat':'person',mode==='character'?'チャットで相談':'キャラクターに戻る');
    $('mobileModeLabel').textContent=mode==='character'?'音声で相談':'文字で相談';
    update();
    if(mode==='chat'&&getState().session&&!getState().session.closed) $('question').focus();
  }
  function fallback(reason='音声を利用できませんでした。このまま文字でご相談いただけます。') {
    if(mobile.matches&&mode==='character') change('chat',reason);
  }
  function update() {
    const s=getState();body.dataset.mobileMode=mode;
    body.classList.toggle('reception-ready',s.ready);
    body.classList.toggle('reception-active',Boolean(s.session));
    body.classList.toggle('reception-closed',Boolean(s.session?.closed));
    if(s.session)body.classList.remove('mobile-consent-open');
    const b=$('mobileVoice');b.disabled=!s.ready||s.starting||s.busy||Boolean(s.session?.closed);
    const label=s.session?.closed?'受付を終了しました':s.starting?'受付を準備しています…':!s.session?'音声で受付を始める':s.liveConnecting?'接続を中止':s.live?'マイクを止める':'話しかける';
    iconButton('mobileVoice',s.live?'stop':'mic',label);
    b.setAttribute('aria-pressed',String(Boolean(s.live)));
    $('mobileEnd').disabled=!s.session||s.session.closed||s.busy;
    $('mobileSwitch').disabled=Boolean(s.session?.closed)&&mode==='chat';
    const status=$('state').textContent;
    $('mobileStatus').textContent=!s.session&&s.ready?'下のボタンからお話しください。':status;
  }
  $('mobileSwitch').onclick=()=>change(mode==='character'?'chat':'character');
  $('mobileEnd').onclick=()=>{$('end').click();};
  $('mobileStopSpeech').onclick=()=>{$('stopSpeech').click();};
  $('mobileVoice').onclick=()=>{
    const s=getState();if(!s.session){body.classList.add('mobile-consent-open');$('consentBox').scrollIntoView({block:'center',behavior:'smooth'});$('consent').focus();return;}
    if(!window.AudioWorkletNode||!navigator.mediaDevices?.getUserMedia||!window.speechSynthesis){fallback('この端末では音声での会話を開始できません。文字でご相談ください。');return;}
    $('readAloud').checked=true;void toggleLive();
  };
  new MutationObserver(()=>{
    const last=[...$('messages').children].filter(x=>!x.classList.contains('user')).at(-1);
    if(last){const copy=last.cloneNode(true);copy.querySelector('strong')?.remove();$('mobileReply').textContent=copy.textContent;}
  }).observe($('messages'),{childList:true});
  new MutationObserver(()=>{$('mobileStatus').textContent=$('voicePreview').textContent||$('state').textContent;}).observe($('voicePreview'),{childList:true,characterData:true,subtree:true});
  // Actions that require reading are shown in the chat view, never over the character.
  const checkActions=()=>{
    if(!mobile.matches||mode!=='character')return;
    const s=getState();
    if(s.session?.closed){change('chat','受付を終了しました。ご案内と保存状態をご確認ください。',true);return;}
    if($('choices').children.length){change('chat','確認する項目があります。画面から選んでください。',true);return;}
    if(!$('retry').hidden){change('chat','記録の保存に失敗しました。再試行してください。');return;}
    if(!s.ready&&/エラー|できません|必要です/.test($('setup').textContent))fallback('受付に接続できませんでした。画面の案内をご確認ください。');
    if(!s.session&&/受付開始エラー/.test($('saveStatus').textContent))fallback('受付を開始できませんでした。画面の案内をご確認ください。');
  };
  for(const id of ['choices','handoff','saveStatus','setup','restart'])new MutationObserver(checkActions).observe($(id),{childList:true,attributes:true,subtree:true});
  mobile.addEventListener('change',()=>{stopLive();closeRecognition();stopSpeech();if(mode==='chat')$('readAloud').checked=mobile.matches?false:previousReadAloud;update();});
  iconButton('mobileSwitch','chat','チャットで相談');update();return {update,fallback};
}
