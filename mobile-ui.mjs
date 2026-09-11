// One reception, two views. No duplicate session or persistence logic.
export function setupMobileUI({getState,toggleLive,stopLive,stopSpeech,closeRecognition}) {
  const $=id=>document.getElementById(id), body=document.body;
  const mobile=matchMedia('(max-width: 720px)');
  let mode='character', previousReadAloud=true;
  const bar=document.createElement('div');bar.className='mobile-mode-bar';
  bar.innerHTML='<span id="mobileModeLabel">音声で相談</span><button type="button" id="mobileSwitch">チャットで相談</button>';
  document.querySelector('.workspace').before(bar);
  const box=document.createElement('div');box.className='mobile-voice-controls';
  box.innerHTML='<p id="mobileReply">こんにちは。ご用件をお聞かせください。</p><p id="mobileStatus" role="status"></p><button type="button" id="mobileVoice" class="primary">音声で受付を始める</button><button type="button" id="mobileStopSpeech" class="text-button">読み上げを止める</button><p class="small">話し終えると自動で送信します</p>';
  document.querySelector('.assistant-panel').append(box);
  const notice=document.createElement('p');notice.id='mobileFallback';notice.className='mobile-fallback';notice.hidden=true;notice.setAttribute('role','status');bar.after(notice);
  function change(next,reason='') {
    if(next===mode&&!reason)return;
    if(next==='chat') {previousReadAloud=$('readAloud').checked;stopLive();closeRecognition();stopSpeech();$('readAloud').checked=false;}
    else {$('readAloud').checked=previousReadAloud;}
    mode=next;body.dataset.mobileMode=mode;
    notice.textContent=reason;notice.hidden=!reason;
    $('mobileSwitch').textContent=mode==='character'?'チャットで相談':'キャラクターに戻る';
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
    b.textContent=s.session?.closed?'受付を終了しました':s.starting?'受付を準備しています…':!s.session?'音声で受付を始める':s.liveConnecting?'接続を中止':s.live?'マイクを止める':'話しかける';
    b.setAttribute('aria-pressed',String(Boolean(s.live)));
    const status=$('state').textContent;
    $('mobileStatus').textContent=!s.session&&s.ready?'下のボタンからお話しください。':status;
  }
  $('mobileSwitch').onclick=()=>change(mode==='character'?'chat':'character');
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
  mobile.addEventListener('change',()=>{stopLive();closeRecognition();stopSpeech();if(mode==='chat')$('readAloud').checked=mobile.matches?false:previousReadAloud;update();});
  update();return {update,fallback};
}
