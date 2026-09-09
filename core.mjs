export const DEPARTMENT_NAMES = ['義務教育研修課','高校教育研修課','特別支援教育研修課','情報教育研修課','企画調査課','総務課','心の教育推進課'];
export const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s、。！？!?「」『』]/g,'');
export const terms = value => String(value || '').split(/[、,，;；\n|｜]/).map(s=>s.trim()).filter(Boolean);
export const isExpired = (startedAt, now, seconds=600) => now-startedAt>=Math.min(seconds,600)*1000;
export function chunks(text, size=2800) {
  // UTF-16長を上限以内に保ち、サロゲートペアを分断しない。
  const parts=[]; let part='';
  for(const char of String(text)){if(part.length+char.length>size){parts.push(part);part='';}part+=char;}
  if(part)parts.push(part);return parts;
}
export function route(question, departments, lastDepartment='') {
  const q=normalize(question);
  if(q.includes('公開講座')) return '企画調査課';
  const scored=departments.map(d=>({name:d.name,score:Math.max(0,...terms(d.keywords).filter(t=>!['研修','相談','教育'].includes(t)).map(t=>q.includes(normalize(t))?normalize(t).length:0),q.includes(normalize(d.name))?100:0)})).sort((a,b)=>b.score-a.score);
  if(scored[0]?.score && !scored[1]?.score)return scored[0].name;
  if(scored[1]?.score)return '';
  return lastDepartment || '';
}
export function classify(question, faqs, departments, lastDepartment='') {
  const q=normalize(question); const department=route(question,departments,lastDepartment);
  if(/公開講座/.test(q))return {kind:'handoff',department:'企画調査課',reason:'公開講座の問い合わせ'};
  if(/死にたい|自殺|自傷|虐待|暴力|いじめ|不登校|診断|病歴/.test(q))return {kind:'sensitive',department:'心の教育推進課',reason:'個別・機微な相談'};
  if(/職員|担当者|人間|人に相談|電話したい|担当課に/.test(q))return {kind:'handoff',department,reason:'職員への相談希望'};
  if(/違う|違いま|解決しない|わからない|分からない|苦情|責任者|例外|個別判断/.test(q))return {kind:'handoff',department,reason:'回答では解決できない・個別判断'};
  const matches=faqs.filter(f=>terms(f.keywords).some(t=>normalize(t).length>=2&&q.includes(normalize(t))));
  if(matches.length===1){const faq=matches[0];return faq.handoffCondition?{kind:'handoff',department:faq.department,reason:'FAQに担当課確認条件あり'}:{kind:'answer',faq};}
  if(matches.length>1)return {kind:'choices',faqs:matches.slice(0,5)};
  return {kind:'unknown',department};
}
export function excerpts(messages,speaker,max=1900){
  const selected=messages.filter(m=>m.speaker===speaker).map(m=>m.text);
  const prefix='【発言抜粋・全文は会話ログ参照】\n';
  if(!selected.length)return '';
  const joined=selected.join('\n');
  if(joined.length<=max-prefix.length)return prefix+joined;
  const n=Math.floor((max-prefix.length-20)/2);
  return prefix+joined.slice(0,n)+'\n…（中略）…\n'+joined.slice(-n);
}
export class SaveQueue {
  constructor(send,onChange=()=>{}){this.send=send;this.onChange=onChange;this.items=[];this.running=false;this.error='';}
  add(action,payload){this.items.push({action,payload});this.onChange(this);void this.flush();}
  async flush(){
    if(this.running)return;this.running=true;this.error='';this.onChange(this);
    try{while(this.items.length){await this.send(this.items[0]);this.items.shift();this.onChange(this);}}
    catch(e){this.error=e.code||e.message||'SAVE_FAILED';}
    finally{this.running=false;this.onChange(this);}
  }
}
