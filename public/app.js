'use strict';
const $ = id => document.getElementById(id);
const state = {mode:'build',history:[],selected:null,last:null,busy:false,treeCount:0,taskPath:null};
const $login=$('login-view'), $app=$('app'), $feed=$('chat-feed');
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
function toast(msg){const el=$('toast');el.textContent=msg;el.classList.remove('hidden');setTimeout(()=>el.classList.add('hidden'),4000);}
async function api(route, opts={}){
  const response=await fetch(route, {credentials:'same-origin',headers:{'Content-Type':'application/json'},...opts});
  let data;try{data=await response.json();}catch{throw new Error('Сервер вернул неверный ответ');}
  if(!response.ok){if(response.status===401 && !route.includes('/auth/login')) showLogin();throw new Error(data.error || 'Ошибка HTTP '+response.status);}
  return data;
}
function showLogin(){$app.classList.add('hidden');$login.classList.remove('hidden');$('password').value='';}
function showApp(){$login.classList.add('hidden');$app.classList.remove('hidden');}
async function boot(){
  try{const x=await api('/api/auth/status'); if(x.authenticated){showApp();await loadConfig();}else{showLogin(); if(!x.configured)$('login-error').textContent='Администратору нужно добавить APP_PASSWORD (не менее 12 символов) в Render.';}}
  catch(e){showLogin();$('login-error').textContent=e.message;}
}
$('login-form').addEventListener('submit',async e=>{e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;$('login-error').textContent='';try{await api('/api/auth/login',{method:'POST',body:JSON.stringify({password:$('password').value})});showApp();await loadConfig();}catch(e){$('login-error').textContent=e.message;}finally{btn.disabled=false;}});
$('logout').addEventListener('click',async ()=>{try{await api('/api/auth/logout',{method:'POST',body:'{}'});}catch{}showLogin();});
function status(id,yes,okText,badText){const el=$(id);el.textContent=(yes?'● ':'○ ')+(yes?okText:badText);el.className='status-pill '+(yes?'ready':'bad');}
async function loadConfig(){
  try{const conf=await api('/api/config');status('ai-state',conf.ai,'ИИ готов','ИИ не подключён');status('rbx-state',conf.roblox,'Roblox настроен','Roblox не подключён');$('project-title').textContent=conf.place?'Place '+conf.place:'Плейс не выбран';$('project-subtitle').textContent=conf.universe?'Universe '+conf.universe:'Укажи ID в Render';$('footer-model').textContent=conf.model;$('roblox-indicator').classList.toggle('online',conf.roblox);
    if(conf.roblox) await refreshTree();else $('tree').textContent='Добавь ключ Roblox и ID плейса в переменных Render.';
  }catch(e){toast(e.message);}
}
async function refreshTree(){const wrap=$('tree');wrap.replaceChildren();state.treeCount=0;$('tree-count').textContent='0';await showChildren('root',wrap);}
async function showChildren(id,parent){
  const holder=document.createElement('div');holder.className='loading';holder.textContent='⟳ Загрузка объектов...';parent.appendChild(holder);
  try{
    const data=await api('/api/roblox/children?id='+encodeURIComponent(id));holder.remove();
    if(!data.items.length){const blank=document.createElement('p');blank.className='muted small';blank.textContent='Вложенных объектов нет';parent.append(blank);return;}
    for(const item of data.items){
      if(!item.id)continue;
      state.treeCount++;$('tree-count').textContent=state.treeCount;
      const root=document.createElement('div'); const btn=document.createElement('button');
      btn.type='button';btn.className=item.isScript?'script':'';
      btn.textContent=(item.hasChildren?'▸ ':item.isScript?'⌘ ':'□ ')+(item.name||'Без имени')+' '+(item.isScript?'['+item.type+']':'');
      btn.title=item.type+' — '+item.id;
      root.appendChild(btn);parent.appendChild(root);
      let expanded=false,childWrap=null;
      btn.addEventListener('click',async()=>{
        if(item.isScript){
          document.querySelectorAll('.tree button.selected').forEach(x=>x.classList.remove('selected'));btn.classList.add('selected');
          try{const script=await api('/api/roblox/script?id='+encodeURIComponent(item.id));state.selected=script;setMode('edit');$('selected-name').textContent=script.name+' ('+script.type+')';$('selected-script').classList.remove('hidden');
            $('code-view').value=script.source;$('preview-summary').textContent='Исходный код '+script.name+'. Запроси ИИ изменить этот скрипт или редактируй код самостоятельно.';
            $('notes').textContent='Выбран существующий скрипт. Перед записью будет проверено, что его исходный код на Roblox не изменился.';
            state.last={mode:'edit',selectedScript:{id:script.id,name:script.name,type:script.type,originalHash:script.sha256}};updateApply();toast('Выбран скрипт '+script.name);
          }catch(e){toast(e.message);}
          return;
        }
        if(!item.hasChildren)return;
        if(expanded){if(childWrap)childWrap.remove();childWrap=null;expanded=false;btn.textContent=btn.textContent.replace(/^▾/,'▸');}
        else{expanded=true;btn.textContent=btn.textContent.replace(/^▸/,'▾');childWrap=document.createElement('div');childWrap.className='nested';root.appendChild(childWrap);await showChildren(item.id,childWrap);}
      });
    }
  }catch(e){holder.className='loading error';holder.textContent='Ошибка: '+e.message;}
}
$('refresh-tree').addEventListener('click',refreshTree);
function setMode(next){state.mode=next;document.querySelectorAll('.mode').forEach(btn=>btn.classList.toggle('active',btn.dataset.mode===next));
  $('prompt').placeholder=next==='build'?'Например: создай красивый город с домами, фонарями и парком...':next==='edit'?'Как нужно изменить выбранный скрипт?':'Задай вопрос про Roblox и Luau...';updateApply();}
document.querySelectorAll('.mode').forEach(btn=>btn.addEventListener('click',()=>setMode(btn.dataset.mode)));
$('clear-selection').addEventListener('click',()=>{state.selected=null;$('selected-script').classList.add('hidden');setMode('build');});
$('prompt').addEventListener('input',()=>{$('char-count').textContent=$('prompt').value.length+' / 3500';});
$('prompt').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();if(!state.busy)$('chat-form').requestSubmit();}});
function addBubble(who,msg,small=''){
  const intro=$feed.querySelector('.intro');if(intro)intro.remove();
  const bubble=document.createElement('div');bubble.className='bubble '+who;
  const name=document.createElement('span');name.className='who';name.textContent=who==='user'?'ТЫ':'✦ FORGECLOUD AI';
  const text=document.createElement('span');text.textContent=msg;
  bubble.append(name,text);
  if(small){const hint=document.createElement('span');hint.className='sub';hint.textContent=small;bubble.append(hint);}
  $feed.appendChild(bubble);$feed.scrollTop=$feed.scrollHeight;return bubble;
}
function setBusy(b){state.busy=b;$('send-btn').disabled=b;$('send-btn').textContent=b?'◌':'➤';}
function updateApply(){const last=state.last;const valid=!!last && last.mode!=='help' && $('code-view').value.trim().length>0;
  $('apply-code').disabled=!valid;
  $('apply-code').textContent=last?.mode==='edit'?'✓  Записать в Script':'✓  Сохранить в Roblox';}
$('code-view').addEventListener('input',updateApply);
$('chat-form').addEventListener('submit',async event=>{
  event.preventDefault();if(state.busy)return;
  const message=$('prompt').value.trim();if(!message)return;
  if(state.mode==='edit'&&!state.selected){toast('Выбери Script, LocalScript или ModuleScript в Explorer.');return;}
  setBusy(true);$('prompt').value='';$('char-count').textContent='0 / 3500';addBubble('user',message);
  const loading=addBubble('assistant','Думаю и генерирую Luau-код...');
  try{
    const result=await api('/api/ai/generate',{method:'POST',body:JSON.stringify({message,mode:state.mode,selectedId:state.selected?.id||null,history:state.history})});
    loading.remove();addBubble('assistant',result.summary, result.notes || 'Готовый код справа →');
    state.history.push({role:'user',content:message},{role:'assistant',content:result.summary});state.history=state.history.slice(-12);
    $('code-view').value=result.code||'';state.last=result;$('preview-summary').textContent=result.summary;
    $('notes').textContent=result.notes||'Проверь код и только после этого нажми применить.';
    $('task-box').classList.add('hidden'); updateApply();toast('Готово! Проверь код.');
  }catch(e){loading.remove();addBubble('assistant','Ошибка: '+e.message);toast(e.message);}
  finally{setBusy(false);}
});
function code(){return $('code-view').value;}
$('copy-code').addEventListener('click',async()=>{if(!code()){toast('Код пока пустой');return;}try{await navigator.clipboard.writeText(code());toast('Код скопирован');}catch{ $('code-view').select();toast('Выделен код — скопируй вручную');}});
$('download-code').addEventListener('click',()=>{if(!code())return toast('Код пока пустой');const blob=new Blob([code()],{type:'text/plain;charset=utf-8'});const href=URL.createObjectURL(blob);const a=document.createElement('a');a.href=href;a.download='ForgeCloud_'+(state.last?.mode||'code')+'.luau';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),1000);});
function showTask(msg,details=''){$('task-box').classList.remove('hidden');$('task-title').textContent=msg;$('task-output').textContent=details;}
$('apply-code').addEventListener('click',async()=>{
  if(state.busy)return;const current=state.last;if(!current||current.mode==='help')return toast('Нужно сначала создать код');
  if(!code().trim())return toast('Нет кода для применения');
  const applyingScript=current.mode==='edit';
  let confirmText;
  if(applyingScript){confirmText=window.prompt('Это ЗАМЕНИТ существующий скрипт «'+(current.selectedScript?.name||'Script')+'».\n\nСделай резервную копию и введи ЗАМЕНИТЬ:');if(confirmText!=='ЗАМЕНИТЬ')return toast('Запись отменена');}
  else{confirmText=window.prompt('Luau-код запустится в облачной сессии Roblox, изменит плейс и попытается сохранить НЕОПУБЛИКОВАННУЮ версию. Сделай резервную копию!\n\nДля продолжения введи СОХРАНИТЬ:');if(confirmText!=='СОХРАНИТЬ')return toast('Сохранение отменено');}
  state.busy=true;$('apply-code').disabled=true;showTask('Подключаемся к Roblox...', 'Отправка кода.');
  try{
    if(applyingScript){
      const d=await api('/api/roblox/script/apply',{method:'POST',body:JSON.stringify({id:current.selectedScript.id,originalHash:current.selectedScript.originalHash,source:code(),confirmation:'APPLY_SCRIPT'})});
      showTask('✓ Script обновлён','Скрипт «'+d.name+'» обновлён через Open Cloud. Старую версию можно восстановить через историю версий плейса.');
      state.selected={...state.selected,source:code()};state.last.selectedScript.originalHash='';toast('Скрипт успешно обновлён');
      // Refresh original source so accidental reapply cannot overwrite changes.
      const newSrc=await api('/api/roblox/script?id='+encodeURIComponent(current.selectedScript.id));
      state.selected=newSrc;state.last.selectedScript.originalHash=newSrc.sha256;
    }else{
      const task=await api('/api/roblox/build',{method:'POST',body:JSON.stringify({source:code(),confirmation:'SAVE_DRAFT'})});
      state.taskPath=task.path;showTask('⏳ Roblox выполняет Luau','Запущено облачное выполнение. Сохранение только в черновик.');
      await pollTask(task.path);
    }
  }catch(e){showTask('Ошибка Roblox',e.message);toast(e.message);}
  finally{state.busy=false;updateApply();}
});
async function pollTask(path){
  for(let i=0;i<90;i++){
    await pause(3300);
    let info;
    try{info=await api('/api/roblox/build/status?path='+encodeURIComponent(path));}
    catch(e){showTask('Ошибка проверки',e.message+'\nЗадача может продолжать выполняться на Roblox.');return;}
    if(info.state==='PROCESSING'||info.state==='STATE_UNSPECIFIED'||info.state==='QUEUED'){
      showTask('⏳ Roblox выполняет Luau','Состояние: '+info.state+'\nПроверка '+(i+1)+' / 90');continue;
    }
    let logs='';try{const log=await api('/api/roblox/build/logs?path='+encodeURIComponent(path));logs=(log.logs||[]).flatMap(x=>x.messages||[]).join('\n').slice(0,6000);}catch{}
    if(info.state==='COMPLETE'){
      showTask('✓ Задача завершена','Luau Cloud ответил COMPLETE.\n'+(logs||'Нет дополнительных логов.')+'\n\nПроверь черновик в Roblox Creator Dashboard.');toast('Roblox выполнил задачу!');
    }else{showTask('Задача не выполнена','Статус: '+info.state+'\n'+JSON.stringify(info.error||{}).slice(0,1600)+'\n'+logs);toast('Roblox вернул ошибку');}
    return;
  }
  showTask('Долгая задача','Превышено время ожидания сайта. Проверь версию плейса в Creator Dashboard.');
}
$('new-chat').addEventListener('click',()=>{if(!confirm('Очистить историю чата и результат ИИ?'))return;state.history=[];state.last=null;$feed.replaceChildren();addBubble('assistant','Новый чат открыт. Что будем создавать?');$('code-view').value='';$('preview-summary').textContent='Здесь появится сгенерированный код.';$('notes').textContent='Опиши задачу в чате.';$('task-box').classList.add('hidden');updateApply();});
$('close-chat').addEventListener('click',()=>{$('chat-window').classList.add('hidden');$('reopen-wrapper').classList.remove('hidden');});
$('reopen-chat').addEventListener('click',()=>{$('chat-window').classList.remove('hidden');$('reopen-wrapper').classList.add('hidden');});
document.querySelectorAll('.suggestion').forEach(btn=>btn.addEventListener('click',()=>{$('prompt').value=btn.dataset.example;$('prompt').dispatchEvent(new Event('input'));setMode('build');$('prompt').focus();}));
boot();
