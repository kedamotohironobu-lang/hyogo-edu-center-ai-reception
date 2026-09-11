export function trainingPolicy(question,faqs){
 const q=String(question).normalize('NFKC');const get=id=>faqs.find(f=>f.id===id);
 const school=/特別支援学校|特支/.test(q)?'特別支援教育研修課':/高校|高等学校/.test(q)?'高校教育研修課':/小学校|中学校|小中/.test(q)?'義務教育研修課':'';
 if(/教職員研修管理システム|研修管理システム|ログイン|パスワード|ヘルプデスク|システムの操作/.test(q)){const faq=get('GEN-310');if(faq)return {kind:'answer',faq};}
 if(/警報|レベル[345]|台風|大雨/.test(q)){const faq=get('GEN-311');if(faq)return {kind:'answer',faq};}
 if(!/初任|[23]年次|二年次|三年次|中堅|15年|20年|担当者.*研修|選択研修|研修.*(欠席|休み|休む|遅刻|早退)/.test(q))return null;
 const faq=get(/欠席|休み|休む|遅刻|早退/.test(q)?'GEN-301':'GEN-309');if(!faq)return null;
 const selectCourse=/選択研修|担当者.*研修/.test(q);
 const named=['義務教育研修課','高校教育研修課','特別支援教育研修課','情報教育研修課','企画調査課','総務課','心の教育推進課'].find(d=>q.includes(d));
 return {kind:'training',faq,department:selectCourse?(named||''):school,selectCourse};
}
export function improvementQuestion(value){
 return String(value).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'【メール省略】').replace(/(?:\+81|0)[\d\sー－-]{8,18}\d/g,'【電話省略】').slice(0,900);
}
