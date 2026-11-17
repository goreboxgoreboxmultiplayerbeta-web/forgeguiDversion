'use strict';
// ForgeCloud AI: single-owner, dependency-free web service for Z.ai free GLM + Roblox Open Cloud.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const PASSWORD = (process.env.APP_PASSWORD || '').trim();
const ZAI_KEY = (process.env.ZAI_API_KEY || '').trim();
const ZAI_MODEL = (process.env.ZAI_MODEL || 'glm-4.7-flash').trim();
const ROBLOX_KEY = (process.env.ROBLOX_API_KEY || '').trim();
const UNIVERSE = (process.env.ROBLOX_UNIVERSE_ID || '').trim();
const PLACE = (process.env.ROBLOX_PLACE_ID || '').trim();
const SESSION_SECRET = crypto.randomBytes(32); // sessions expire on server restart, not stored persistently
const STATIC = path.join(__dirname, 'public');
const MAX_BODY = 240 * 1024;
const attempts = new Map();
const COOKIE = 'forgecloud_auth';
const SCRIPT_TYPES = ['Script','LocalScript','ModuleScript'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = v => crypto.createHash('sha256').update(v).digest('hex');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function baseHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('Cache-Control', 'no-store');
}
function json(res, status, data) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(data));
}
function err(res, status, message) { json(res, status, {error: message}); }
function cookieParse(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split(/=(.*)/s).slice(0,2)).filter(p => p[0]));
  return cookies[COOKIE] || '';
}
function validSession(req) {
  const val = cookieParse(req);
  if (!val) return false;
  const m = /^([0-9]{13})\.([a-f0-9]{64})$/.exec(val);
  if (!m) return false;
  const expires = Number(m[1]);
  if (expires < Date.now() || expires > Date.now() + 13*3600*1000) return false;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(m[1]).digest('hex');
  return safeEqual(m[2], expected);
}
function sessionCookie(req, seconds=0) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted || process.env.NODE_ENV === 'production';
  if (!seconds) return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
  const expires = String(Date.now() + seconds*1000);
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(expires).digest('hex');
  return `${COOKIE}=${expires}.${sig}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
}
function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // curl or same-site navigation without Origin
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
async function body(req) {
  if ((req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') throw new Error('Нужен Content-Type: application/json');
  let data='';
  for await (const chunk of req) {
    data += chunk.toString('utf8');
    if (Buffer.byteLength(data) > MAX_BODY) throw new Error('Запрос слишком большой');
  }
  try { return JSON.parse(data || '{}'); } catch { throw new Error('Неверный JSON'); }
}
function checkRoblox() {
  if (!ROBLOX_KEY || !/^\d+$/.test(UNIVERSE) || !/^\d+$/.test(PLACE)) throw new Error('Укажи ROBLOX_API_KEY, ROBLOX_UNIVERSE_ID и ROBLOX_PLACE_ID в переменных Render');
}
function idCheck(v) {
  if (typeof v !== 'string' || !/^(?:root|[a-fA-F0-9-]{12,64})$/.test(v)) throw new Error('Неверный Instance ID');
  return v;
}
function cloudPrefix() { return `universes/${UNIVERSE}/places/${PLACE}`; }
function safeCloudPath(p) {
  if (typeof p !== 'string' || p.length > 300 || !p.startsWith(cloudPrefix() + '/') || !/^[\w./-]+$/.test(p) || p.includes('..')) throw new Error('Недопустимый путь операции');
  return p;
}
async function fetchJson(url, opts={}, timeout=50000) {
  const response = await fetch(url, {...opts, signal: AbortSignal.timeout(timeout)});
  const txt = await response.text();
  let data;
  try { data = JSON.parse(txt); } catch { data = {error: txt.slice(0,500)}; }
  if (!response.ok) {
    const msg = data?.message || data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || `${response.status} ${response.statusText}`;
    const e = new Error(`HTTP ${response.status}: ${String(msg).slice(0,450)}`);
    e.statusCode = response.status;
    throw e;
  }
  return data;
}
async function roblox(endpoint, method='GET', payload) {
  checkRoblox();
  const url = `https://apis.roblox.com/cloud/v2/${endpoint}`;
  const headers = {'x-api-key':ROBLOX_KEY};
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  return fetchJson(url, {method, headers, ...(payload !== undefined ? {body:JSON.stringify(payload)} : {})});
}
async function pollOperation(p) {
  let item = await roblox(safeCloudPath(p));
  for (let i=0; !item.done && i<18; i++) {
    await sleep(Math.min(800 + i*200, 2400));
    item = await roblox(safeCloudPath(p));
  }
  if (!item.done) throw new Error('Roblox долго отвечает. Повтори запрос немного позже.');
  if (item.error) throw new Error('Ошибка Roblox: '+JSON.stringify(item.error).slice(0,600));
  return item.response ?? item;
}
async function instanceOperation(instanceId, verb='get', payload) {
  const prefix = `${cloudPrefix()}/instances/${idCheck(instanceId)}`;
  let route = prefix;
  if (verb === 'children') route += ':listChildren';
  const method = verb === 'update' ? 'PATCH' : 'GET';
  const first = await roblox(route, method, payload);
  return first.path ? pollOperation(first.path) : first;
}
function normalizeInstance(item) {
  const x = item?.instance || item;
  const e = x?.engineInstance || x?.EngineInstance || {};
  const t = Object.keys(e.Details || e.details || {}).find(key => SCRIPT_TYPES.includes(key));
  const name = e.Name || e.name || '';
  const id = e.Id || e.id || String(x?.path||'').split('/').at(-1);
  return {id, name, type: t || e.ClassName || 'Instance', hasChildren: !!x?.hasChildren, isScript: !!t, raw:e};
}
function getScript(response) {
  const x = normalizeInstance(response);
  const details = x.raw?.Details || x.raw?.details || {};
  const type = SCRIPT_TYPES.find(t => details[t] && typeof details[t].Source === 'string');
  if (!type) throw new Error('Этот объект не содержит читаемый Script.Source');
  const source = details[type].Source;
  return {id:x.id, name:x.name, type, source, sha256:sha256(source)};
}
async function readScript(id) { return getScript(await instanceOperation(id)); }
const SYSTEM = `Ты ForgeCloud AI — специалист по Roblox Luau и Roblox Open Cloud. Отвечай по-русски.
Всегда возвращай ТОЛЬКО JSON-объект с полями "summary" (краткое объяснение на русском), "code" (полный валидный Luau исходник, без Markdown), "notes" (краткое описание установки или важных ограничений). Не добавляй ничего вне JSON.
Реализуй аккуратный рабочий код, без внешних require по AssetId, без HTTP запросов, без отправки данных сторонним сервисам. Не обращайся к DataStore без явного задания. Не выдумывай Roblox API. Не вставляй AssetService:SavePlaceAsync — сохранением управляет сайт. Не используй экосистему вне Roblox. При изменении существующего скрипта сохрани его функциональность, если не просят убрать.
Если запрос про новые объекты, верни исполняемый в Open Cloud Luau код, создающий нужные Instance через Instance.new и помещающий их в необходимые сервисы. Для пользовательских GUI создай ScreenGui и LocalScript в StarterGui; где требуется, запиши .Source для LocalScript. Учти, что код генерируется в облачной редакторской сессии, а не выполняется в обычном игровом сервере. Для существующих скриптов верни полный заменяющий исходник. Не добавляй стартовые / конечные Markdown тройные кавычки.`;
function parseAI(content) {
  let text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(c=>c.text||'').join('\n') : String(content||'');
  const clean = text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try {
    const x = JSON.parse(clean);
    return {summary:String(x.summary||'Готово.'),code:String(x.code||''),notes:String(x.notes||'')};
  } catch {
    const fenced = /```(?:lua|luau)?\s*([\s\S]*?)```/i.exec(text);
    return {summary:'Ответ модели получен в свободной форме. Проверь код перед применением.',code:fenced?fenced[1].trim():text, notes:'Модель не вернула ожидаемый JSON. Проверь правильность результата.'};
  }
}
async function generate(input) {
  if (!ZAI_KEY) throw new Error('Не задан ZAI_API_KEY в Render.');
  if (!['glm-4.7-flash','glm-4.5-flash'].includes(ZAI_MODEL)) throw new Error('Разрешены только бесплатные модели Z.ai: glm-4.7-flash или glm-4.5-flash');
  const {message, mode, selectedId, history} = input;
  if (typeof message !== 'string' || !message.trim() || message.length > 3500) throw new Error('Напиши запрос длиной от 1 до 3500 символов');
  if (!['build','edit','help'].includes(mode)) throw new Error('Неверный режим');
  let context = '';
  let scriptData = null;
  if (mode === 'edit') {
    checkRoblox();
    if (!selectedId) throw new Error('Сначала выбери существующий скрипт в списке Roblox.');
    scriptData = await readScript(idCheck(selectedId));
    context = `РЕЖИМ: ЗАМЕНИТЬ ИСТОЧНИК существующего скрипта ${scriptData.name} (${scriptData.type}). Выдай ПОЛНЫЙ новый Source, НЕ код для создания объекта.\nИсходный код:\n${scriptData.source.slice(0,45000)}`;
  } else if (mode === 'build') {
    context = 'РЕЖИМ: СОЗДАТЬ И ИЗМЕНИТЬ ОБЪЕКТЫ через Luau Execution Task. Код будет выполнен в headless Open Cloud и сохранён отдельно после успешного завершения. Создавай объекты, скрипты, детали, UI по запросу. НЕ вызывай SavePlaceAsync сам.';
  } else {
    context = 'РЕЖИМ: КОНСУЛЬТАЦИЯ. Дай полезное объяснение и, если уместно, код; никакая запись в Roblox не производится.';
  }
  const prev = Array.isArray(history) ? history.slice(-6).filter(x=>['user','assistant'].includes(x?.role) && typeof x.content === 'string').map(x=>({role:x.role,content:x.content.slice(0,1400)})) : [];
  const messages = [{role:'system',content:SYSTEM+'\n'+context},...prev,{role:'user',content:message.trim()}];
  const result = await fetchJson('https://api.z.ai/api/paas/v4/chat/completions', {
    method:'POST', headers:{'Authorization':`Bearer ${ZAI_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({model:ZAI_MODEL,messages,temperature:0.2,max_tokens:6500})
  }, 110000);
  const response = parseAI(result?.choices?.[0]?.message?.content);
  if (!response.code && mode !== 'help') throw new Error('Модель не вернула Luau-код. Уточни запрос и попробуй снова.');
  if (Buffer.byteLength(response.code,'utf8') > 180000) throw new Error('Сгенерированный код слишком большой. Раздели задачу.');
  response.mode = mode;
  response.model = result.model || ZAI_MODEL;
  if (scriptData) { response.selectedScript = {id:scriptData.id,name:scriptData.name,type:scriptData.type,originalHash:scriptData.sha256}; }
  return response;
}
async function staticFile(req, res, pathname) {
  const files = {'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/app.js':'app.js'};
  const name = files[pathname];
  if (!name) return err(res,404,'Не найдено');
  const content = await fs.readFile(path.join(STATIC,name));
  const type = name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.js')?'application/javascript; charset=utf-8':'text/html; charset=utf-8';
  res.writeHead(200,{'Content-Type':type}); res.end(content);
}
async function handle(req, res) {
  baseHeaders(res);
  const url = new URL(req.url || '/', 'http://local');
  const route = url.pathname;
  if (!route.startsWith('/api/')) return staticFile(req,res,route);
  if (!originOk(req) && req.method !== 'GET') return err(res,403,'Неверный Origin');
  if (route === '/api/health' && req.method==='GET') return json(res,200,{ok:true,service:'ForgeCloud AI'});
  if (route === '/api/auth/status' && req.method==='GET') return json(res,200,{authenticated:validSession(req),configured:PASSWORD.length>=12});
  if (route === '/api/auth/login' && req.method==='POST') {
    if (PASSWORD.length<12) return err(res,503,'Создай APP_PASSWORD длиной от 12 символов в настройках Render.');
    const ip = String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].slice(0,80);
    const record = attempts.get(ip) || {count:0,until:0};
    if (Date.now()<record.until) return err(res,429,'Слишком много попыток, попробуй позже');
    const b = await body(req);
    if (typeof b.password!=='string' || !safeEqual(b.password,PASSWORD)) {
      record.count++; record.until = record.count>=8 ? Date.now()+10*60*1000 : 0;
      attempts.set(ip,record); return err(res,401,'Неверный пароль');
    }
    attempts.delete(ip);
    res.setHeader('Set-Cookie',sessionCookie(req,12*3600)); return json(res,200,{ok:true});
  }
  if (!validSession(req)) return err(res,401,'Сначала войди в ForgeCloud AI');
  if (route === '/api/auth/logout' && req.method==='POST') {res.setHeader('Set-Cookie',sessionCookie(req));return json(res,200,{ok:true});}
  if (route === '/api/config' && req.method==='GET') return json(res,200,{ai:!!ZAI_KEY,roblox:!!(ROBLOX_KEY&&UNIVERSE&&PLACE),model:ZAI_MODEL,universe:UNIVERSE||null,place:PLACE||null});
  if (route === '/api/ai/generate' && req.method==='POST') return json(res,200,await generate(await body(req)));
  if (route === '/api/roblox/children' && req.method==='GET') {
    const id = idCheck(url.searchParams.get('id')||'root');
    const response = await instanceOperation(id,'children');
    const items = response.instances || response.children || [];
    return json(res,200,{items:items.map(normalizeInstance).map(({raw,...safe})=>safe),id});
  }
  if (route === '/api/roblox/script' && req.method==='GET') {
    const script = await readScript(idCheck(url.searchParams.get('id')));
    return json(res,200,script);
  }
  if (route === '/api/roblox/script/apply' && req.method==='POST') {
    const b=await body(req);
    if (b.confirmation!=='APPLY_SCRIPT') return err(res,400,'Требуется явное подтверждение');
    const id=idCheck(b.id);
    if (typeof b.source!=='string'||!b.source.trim()||Buffer.byteLength(b.source,'utf8')>175000) throw new Error('Неверный размер текста скрипта');
    const before=await readScript(id);
    if (!safeEqual(before.sha256,b.originalHash||'')) return err(res,409,'Скрипт изменился после просмотра. Обнови его перед записью.');
    const payload = {engineInstance:{Details:{[before.type]:{Source:b.source}}}};
    await instanceOperation(id,'update',payload);
    return json(res,200,{ok:true,name:before.name,previousSource:before.source});
  }
  if (route === '/api/roblox/build' && req.method==='POST') {
    checkRoblox();
    const b=await body(req);
    if (b.confirmation!=='SAVE_DRAFT') return err(res,400,'Требуется явное подтверждение');
    if (typeof b.source!=='string'||!b.source.trim()||Buffer.byteLength(b.source,'utf8')>140000) throw new Error('Неверный размер Luau-кода');
    // The user reviews the code, then gives explicit permission to execute and save unpublished draft.
    const wrapper = `-- ForgeCloud AI: code approved by owner\nlocal ok, err = pcall(function()\n${b.source}\nend)\nif not ok then error("ForgeCloud generated script failed: " .. tostring(err)) end\ngame:GetService("AssetService"):SavePlaceAsync({SaveWithoutPublish = true})\nprint("ForgeCloud AI: saved unpublished place version")\n`;
    const task = await roblox(`${cloudPrefix()}/luau-execution-session-tasks`,'POST',{script:wrapper,timeout:'300s'});
    const taskPath = safeCloudPath(task.path);
    return json(res,200,{ok:true,path:taskPath,state:task.state || 'PROCESSING'});
  }
  if (route === '/api/roblox/build/status' && req.method==='GET') {
    checkRoblox();
    const p = safeCloudPath(url.searchParams.get('path'));
    if (!/\/luau-execution-sessions\/[^/]+\/tasks\/[^/]+$/.test(p)) throw new Error('Неверный путь задачи');
    const task=await roblox(p);
    return json(res,200,{state:task.state || 'UNKNOWN',output:task.output || null,error:task.error || null,path:p});
  }
  if (route === '/api/roblox/build/logs' && req.method==='GET') {
    checkRoblox();
    const p=safeCloudPath(url.searchParams.get('path'));
    if (!/\/luau-execution-sessions\/[^/]+\/tasks\/[^/]+$/.test(p)) throw new Error('Неверный путь задачи');
    const data=await roblox(`${p}/logs`);
    return json(res,200,{logs:data.luauExecutionSessionTaskLogs||[]});
  }
  return err(res,404,'Такого API нет');
}
http.createServer(async (req,res)=>{
  try { await handle(req,res); }
  catch(e) {
    if (e.name==='TimeoutError') return err(res,504,'Внешний сервис долго не отвечает.');
    const message=String(e.message||e).slice(0,650);
    const status=e.statusCode>=400 && e.statusCode<=599 ? e.statusCode : 400;
    // Do not log API keys or full HTTP request headers.
    console.error(`[${new Date().toISOString()}] ${req.method} ${String(req.url||'').split('?')[0]}: ${message}`);
    if (!res.headersSent) err(res,status,message);
  }
}).listen(PORT,'0.0.0.0',()=>console.log(`ForgeCloud AI listening on 0.0.0.0:${PORT}`));
