'use strict';
/* ===== ESEBÉS v2 — lógica ===== */
const $ = s => document.querySelector(s);

const STORE_KEY = 'esebes_store_v1';
const FAV_KEY   = 'esebes_favs_v1';
const RECENT_KEY= 'esebes_recent_v1';
const THEME_KEY = 'esebes_theme_v1';
const DISMISS_KEY = 'esebes_install_dismissed_v1';
const PAGE = 60;

let DB = null;                 // {source, sheets:[{name,n,rows:[{r,c,t}]}]}
let FAVS = [];                 // [{k,sheet,r,c}]
let RECENT = [];
let activeSheet = '__all';
let lastResults = [];
let shown = PAGE;
let deferredPrompt = null;
let zoneColor = {};

const ZONE_COLORS = ['#1d4ed8','#059669','#d97706','#dc2626','#7c3aed','#0891b2','#be185d','#4d7c0f','#b45309','#0f766e','#6d28d9','#c2410c'];

/* ---------- utils ---------- */
function norm(s){
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}
function esc(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
const ACCENT_MAP = {a:'aáàäâ',e:'eéèëê',i:'iíìïî',o:'oóòöô',u:'uúùüû',n:'nñ',c:'cç'};
function rxFor(term){
  let p = '';
  for (const ch of term.toLowerCase()){
    p += ACCENT_MAP[ch] ? '[' + ACCENT_MAP[ch] + ']' : ch.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  }
  return p;
}
function hi(text, terms){
  let out = esc(text);
  for (const t of terms){
    if (!t) continue;
    try { out = out.replace(new RegExp('(' + rxFor(t) + ')','gi'), '<mark>$1</mark>'); } catch(e){}
  }
  return out;
}
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
function toast(msg){
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>{ el.hidden = true; }, 1800);
}

/* ---------- persistencia ---------- */
function loadJSON(k, fb){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; }catch(e){ return fb; } }
function saveJSON(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
function favKey(sheet, r){ return sheet + '§' + r; }

/* ---------- datos ---------- */
async function loadData(){
  const saved = loadJSON(STORE_KEY, null);
  if (saved && saved.sheets && saved.sheets.length){ DB = saved; return 'actualizados'; }
  const res = await fetch('data/esebes.json');
  DB = await res.json();
  return 'incluidos';
}
function buildZoneColors(){
  DB.sheets.forEach((s,i)=>{ zoneColor[s.name] = ZONE_COLORS[i % ZONE_COLORS.length]; });
}
function rowByKey(k){
  const [sheet, r] = k.split('§');
  const sh = DB.sheets.find(s=>s.name===sheet);
  if (!sh) return null;
  const row = sh.rows.find(x=>String(x.r)===r);
  return row ? {sheet, r:row.r, c:row.c} : null;
}

/* ---------- búsqueda ---------- */
function doSearch(){
  const q = $('#searchInput').value.trim();
  const terms = norm(q).split(/\s+/).filter(Boolean);
  lastResults = []; shown = PAGE;
  $('#recentWrap').style.display = terms.length ? 'none' : '';
  if (!terms.length){
    $('#results').innerHTML = '';
    $('#resultMeta').textContent = '';
    $('#moreBtn').hidden = true;
    return;
  }
  for (const sh of DB.sheets){
    if (activeSheet !== '__all' && sh.name !== activeSheet) continue;
    for (const row of sh.rows){
      if (!terms.every(t => row.t.includes(t))) continue;
      // mejor celda coincidente: la más corta que contenga todos los términos
      let best = -1, score = 0;
      row.c.forEach((cell, ci)=>{
        const nc = norm(cell);
        if (terms.every(t => nc.includes(t))){
          const s = 1000 / (cell.length + 8) + (nc === norm(q) ? 500 : 0);
          if (s > score){ score = s; best = ci; }
        }
      });
      lastResults.push({sheet: sh.name, r: row.r, c: row.c, best, score});
    }
  }
  lastResults.sort((a,b)=>b.score - a.score);
  renderResults(terms);
}

function cardHTML(res, terms){
  const cells = res.c.filter(c=>c!=='');
  const titleCell = res.best >= 0 ? res.c[res.best] : (cells[0] || '');
  const ctx = cells.filter(c=>c!==titleCell).slice(0,4).join(' · ');
  const loc = (res.c[0] && res.c[0] !== titleCell) ? res.c[0] : '';
  const k = favKey(res.sheet, res.r);
  const isFav = FAVS.some(f=>f.k===k);
  return `<article class="card-result" data-k="${esc(k)}">
    <div class="card-photo-slot"></div>
    <div class="card-top">
      <span class="zone-badge" style="background:${zoneColor[res.sheet]||'#1d4ed8'}">${esc(res.sheet)}</span>
      <span class="row-num">Fila ${res.r}</span>
    </div>
    <h3 class="card-title">${hi(titleCell, terms)}</h3>
    ${loc ? `<p class="card-loc">📍 ${hi(loc, terms)}</p>` : ''}
    ${ctx ? `<p class="card-ctx">${hi(ctx, terms)}</p>` : ''}
    <div class="card-actions">
      <button class="mini-btn act-copy" data-k="${esc(k)}">📋 Copiar</button>
      <button class="mini-btn act-fav${isFav?' faved':''}" data-k="${esc(k)}">${isFav?'★ Guardado':'☆ Guardar'}</button>
    </div>
  </article>`;
}

function renderResults(terms){
  const box = $('#results');
  const total = lastResults.length;
  const slice = lastResults.slice(0, shown);
  $('#resultMeta').textContent = total === 0 ? '' :
    `${total} resultado${total===1?'':'s'}${activeSheet!=='__all' ? ' en ' + activeSheet : ''}`;
  if (total === 0){
    box.innerHTML = `<div class="empty"><span class="big">🔌</span>
      Sin resultados para «${esc($('#searchInput').value.trim())}».<br>
      Prueba con menos palabras o revisa la zona seleccionada.</div>`;
    $('#moreBtn').hidden = true;
    return;
  }
  box.innerHTML = slice.map(r=>cardHTML(r, terms)).join('');
  $('#moreBtn').hidden = total <= shown;
  enhancePhotos(box);
}

function bindCardActions(container){
  container.onclick = (e)=>{
    const copyBtn = e.target.closest('.act-copy');
    const favBtn  = e.target.closest('.act-fav');
    const card    = e.target.closest('.card-result');
    if (copyBtn){ e.stopPropagation(); copyResult(copyBtn.dataset.k); return; }
    if (favBtn){ e.stopPropagation(); toggleFav(favBtn.dataset.k); return; }
    if (card){ openSheet(card.dataset.k); }
  };
}

async function copyText(t){
  try{ await navigator.clipboard.writeText(t); return true; }
  catch(e){
    const ta = document.createElement('textarea');
    ta.value = t; document.body.appendChild(ta); ta.select();
    let ok = false;
    try{ ok = document.execCommand('copy'); }catch(_){}
    ta.remove(); return ok;
  }
}
function resultText(k){
  const info = resolveK(k);
  if (!info) return '';
  return `${info.sheet} · Fila ${info.r}\n` + info.c.filter(c=>c!=='').join(' | ');
}
function resolveK(k){
  const fav = FAVS.find(f=>f.k===k);
  if (fav) return {sheet:fav.sheet, r:fav.r, c:fav.c};
  return rowByKey(k);
}
async function copyResult(k){
  const ok = await copyText(resultText(k));
  toast(ok ? 'Copiado al portapapeles' : 'No se pudo copiar');
}

/* ---------- favoritos ---------- */
function toggleFav(k){
  const i = FAVS.findIndex(f=>f.k===k);
  if (i >= 0){ FAVS.splice(i,1); toast('Quitado de favoritos'); }
  else{
    const info = resolveK(k) || rowByKey(k);
    if (!info) return;
    FAVS.unshift({k, sheet:info.sheet, r:info.r, c:info.c});
    toast('⭐ Guardado en favoritos');
  }
  saveJSON(FAV_KEY, FAVS);
  updateFavBadge();
  // refrescar botones visibles
  document.querySelectorAll(`.act-fav[data-k="${CSS.escape(k)}"]`).forEach(b=>{
    const on = FAVS.some(f=>f.k===k);
    b.classList.toggle('faved', on);
    b.textContent = on ? '★ Guardado' : '☆ Guardar';
  });
  renderFavs();
}
function updateFavBadge(){
  const b = $('#favCount');
  b.hidden = FAVS.length === 0;
  b.textContent = FAVS.length;
}
function renderFavs(){
  const box = $('#favsList');
  if (!FAVS.length){
    box.innerHTML = `<div class="empty"><span class="big">⭐</span>
      Aún no tienes favoritos.<br>Toca la estrella en cualquier resultado para guardarlo aquí.</div>`;
    return;
  }
  box.innerHTML = FAVS.map(f=>cardHTML({sheet:f.sheet, r:f.r, c:f.c, best:-1, score:0}, [])).join('');
  enhancePhotos(box);
}

/* ---------- recientes ---------- */
function pushRecent(q){
  q = q.trim();
  if (q.length < 2) return;
  RECENT = [q, ...RECENT.filter(x=>x!==q)].slice(0,8);
  saveJSON(RECENT_KEY, RECENT);
  renderRecent();
}
function renderRecent(){
  const box = $('#recentChips');
  box.innerHTML = RECENT.map(q=>`<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('');
  $('#recentWrap').style.display = RECENT.length && !$('#searchInput').value.trim() ? '' : 'none';
}

/* ---------- chips de zona ---------- */
function renderChips(){
  const box = $('#zoneChips');
  const all = `<button class="chip${activeSheet==='__all'?' active':''}" data-zone="__all">Todas <span class="n">${DB.total}</span></button>`;
  box.innerHTML = all + DB.sheets.map(s=>
    `<button class="chip${activeSheet===s.name?' active':''}" data-zone="${esc(s.name)}">${esc(s.name)}<span class="n">${s.n}</span></button>`
  ).join('');
  box.onclick = (e)=>{
    const b = e.target.closest('[data-zone]');
    if (!b) return;
    activeSheet = b.dataset.zone;
    renderChips();
    doSearch();
  };
}

/* ---------- bottom sheet (detalle) ---------- */
let sheetK = null;
function openSheet(k){
  const info = resolveK(k);
  if (!info) return;
  sheetK = k;
  const terms = norm($('#searchInput').value.trim()).split(/\s+/).filter(Boolean);
  const zb = $('#sheetZone');
  zb.textContent = info.sheet + ' · Fila ' + info.r;
  zb.style.background = zoneColor[info.sheet] || '#1d4ed8';
  $('#sheetBody').innerHTML = info.c.map((c,i)=>
    `<div class="field"><span class="fl">${i===0?'Posición / ubicación':'Dato '+(i+1)}</span>${hi(c, terms)}</div>`
  ).join('');
  const isFav = FAVS.some(f=>f.k===k);
  $('#sheetFav').textContent = isFav ? '★ Guardado' : '⭐ Guardar';
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  refreshPhotoUI(k);
}
function closeSheet(){
  $('#sheet').hidden = true;
  document.body.style.overflow = '';
}

/* ---------- tabs ---------- */
function switchTab(id){
  document.querySelectorAll('.tab').forEach(t=>{ t.hidden = t.id !== id; t.classList.toggle('active', t.id===id); });
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===id));
  window.scrollTo({top:0});
}

/* ---------- tema ---------- */
function applyTheme(mode){
  document.documentElement.dataset.theme = mode;
  document.querySelectorAll('.seg-btn').forEach(b=>b.classList.toggle('active', b.dataset.themeOpt===mode));
  saveJSON(THEME_KEY, mode);
}

/* ---------- instalación PWA ---------- */
function setupInstall(){
  window.addEventListener('beforeinstallprompt', (e)=>{
    e.preventDefault();
    deferredPrompt = e;
    if (!loadJSON(DISMISS_KEY, false)){
      $('#installBanner').hidden = false;
      $('#installBtn2').hidden = false;
    }
  });
  const doInstall = async ()=>{
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('#installBanner').hidden = true;
  };
  $('#installBtn').onclick = doInstall;
  $('#installBtn2').onclick = doInstall;
  $('#installDismiss').onclick = ()=>{
    $('#installBanner').hidden = true;
    saveJSON(DISMISS_KEY, true);
  };
  window.addEventListener('appinstalled', ()=>{
    $('#installBanner').hidden = true;
    toast('ESEBÉS instalada 🎉');
  });
  // pista para iOS
  const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isiOS && !window.navigator.standalone){
    $('#installHint').textContent = 'En iPhone: pulsa Compartir ⬆️ y «Añadir a pantalla de inicio».';
  }
}

/* ---------- offline ---------- */
function setupOffline(){
  const upd = ()=>{
    const off = !navigator.onLine;
    $('#offlineBadge').hidden = !off;
  };
  window.addEventListener('online', upd);
  window.addEventListener('offline', upd);
  upd();
}

/* ---------- actualizar datos (Excel) ---------- */
let xlsxLoaded = false;
function ensureXLSX(){
  return new Promise((resolve, reject)=>{
    if (xlsxLoaded || window.XLSX) return resolve();
    const s = document.createElement('script');
    s.src = 'vendor/xlsx.full.min.js';
    s.onload = ()=>{ xlsxLoaded = true; resolve(); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
async function handleExcelFile(file){
  toast('Leyendo Excel…');
  try{
    await ensureXLSX();
    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab, {type:'array'});
    const SKIP = new Set(['busqueda','hoja1']);
    const HEADER = new Set(['posicion','tag','denominacion','celdas','hoja']);
    const sheets = [];
    wb.SheetNames.forEach(name=>{
      if (SKIP.has(norm(name).trim())) return;
      const arr = XLSX.utils.sheet_to_json(wb.Sheets[name], {header:1, defval:''});
      const rows = [];
      arr.forEach((row, idx)=>{
        let cells = row.map(c=>String(c).trim());
        while (cells.length && cells[cells.length-1]==='') cells.pop();
        if (!cells.length || !cells.some(c=>c)) return;
        const nc = cells.filter(c=>c).map(norm);
        if (nc.length >= 2 && nc.filter(c=>HEADER.has(c)).length >= 2) return;
        rows.push({r: idx+1, c: cells, t: norm(cells.join(' '))});
      });
      if (rows.length) sheets.push({name: name.trim(), n: rows.length, rows});
    });
    if (!sheets.length){ toast('No se encontraron datos en el Excel'); return; }
    DB = {source: file.name, sheets, total: sheets.reduce((a,s)=>a+s.n,0)};
    saveJSON(STORE_KEY, DB);
    buildZoneColors();
    renderChips();
    renderDataInfo();
    doSearch();
    toast(`Datos actualizados: ${DB.total} filas`);
  }catch(e){
    console.error(e);
    toast('Error al leer el Excel');
  }
}

/* ---------- info de datos ---------- */
function renderDataInfo(){
  $('#dataInfo').textContent = `${DB.total} equipos · ${DB.sheets.length} zonas`;
  $('#dataDetail').textContent = `Fuente: ${DB.source || 'ESEBES.xlsm'} · ${DB.total} filas en ${DB.sheets.length} zonas. Guardados en este dispositivo, disponibles sin internet.`;
}

/* ---------- voz ---------- */
function setupVoice(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  const btn = $('#micBtn');
  btn.hidden = false;
  const rec = new SR();
  rec.lang = 'es-ES';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  btn.onclick = ()=>{ try{ rec.start(); }catch(e){} };
  rec.onstart = ()=> btn.classList.add('listening');
  rec.onend = ()=> btn.classList.remove('listening');
  rec.onerror = (e)=>{
    btn.classList.remove('listening');
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed')
      toast('Permite el micrófono para usar la voz');
  };
  rec.onresult = (e)=>{
    const t = e.results[0][0].transcript || '';
    if (!t.trim()) return;
    $('#searchInput').value = t;
    $('#clearBtn').hidden = false;
    doSearch();
    pushRecent(t);
  };
}

/* ---------- fotos (IndexedDB, offline) ---------- */
const idb = {
  _db: null,
  open(){
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject)=>{
      try{
        const rq = indexedDB.open('esebes-v1', 1);
        rq.onupgradeneeded = ()=> rq.result.createObjectStore('photos');
        rq.onsuccess = ()=>{ this._db = rq.result; resolve(this._db); };
        rq.onerror = ()=> reject(rq.error);
      }catch(e){ reject(e); }
    });
  },
  async get(k){
    try{
      const db = await this.open();
      return await new Promise((res)=>{
        const rq = db.transaction('photos','readonly').objectStore('photos').get(k);
        rq.onsuccess = ()=> res(rq.result || null);
        rq.onerror = ()=> res(null);
      });
    }catch(e){ return null; }
  },
  async set(k, blob){
    const db = await this.open();
    return new Promise((res, rej)=>{
      const tx = db.transaction('photos','readwrite');
      tx.objectStore('photos').put(blob, k);
      tx.oncomplete = ()=> res();
      tx.onerror = ()=> rej(tx.error);
    });
  },
  async del(k){
    try{
      const db = await this.open();
      await new Promise((res)=>{
        const tx = db.transaction('photos','readwrite');
        tx.objectStore('photos').delete(k);
        tx.oncomplete = ()=> res();
        tx.onerror = ()=> res();
      });
    }catch(e){}
  }
};

let photoTargetK = null;
function takePhoto(k){
  photoTargetK = k;
  const inp = $('#photoInput');
  inp.value = '';
  inp.click();
}
function compressImage(file){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = ()=>{
      URL.revokeObjectURL(url);
      const max = 900;
      const sc = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * sc));
      c.height = Math.max(1, Math.round(img.height * sc));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => b ? resolve(b) : reject(new Error('blob')), 'image/jpeg', 0.72);
    };
    img.onerror = reject;
    img.src = url;
  });
}
async function refreshPhotoUI(k){
  const blob = await idb.get(k);
  const url = blob ? URL.createObjectURL(blob) : null;
  if (sheetK === k){
    const wrap = $('#sheetPhotoWrap');
    if (url){ wrap.hidden = false; $('#sheetPhoto').src = url; }
    else wrap.hidden = true;
  }
  document.querySelectorAll(`.card-result[data-k="${CSS.escape(k)}"] .card-photo-slot`).forEach(slot=>{
    slot.innerHTML = url ? '<img class="card-photo" alt="Foto del equipo">' : '';
    if (url) slot.firstChild.src = url;
  });
}
async function enhancePhotos(container){
  const cards = [...container.querySelectorAll('.card-result')];
  for (const card of cards){
    const blob = await idb.get(card.dataset.k);
    const slot = card.querySelector('.card-photo-slot');
    if (blob && slot){
      slot.innerHTML = '<img class="card-photo" alt="Foto del equipo">';
      slot.firstChild.src = URL.createObjectURL(blob);
    }
  }
}

/* ---------- QR con enlace directo ---------- */
let qrLoaded = false;
function ensureQR(){
  return new Promise((resolve, reject)=>{
    if (qrLoaded || window.QRCode) return resolve();
    const s = document.createElement('script');
    s.src = 'vendor/qrcode.min.js';
    s.onload = ()=>{ qrLoaded = true; resolve(); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
function deepLink(k){
  return location.origin + location.pathname + '?r=' + encodeURIComponent(k);
}
async function openQR(k){
  const info = resolveK(k);
  if (!info) return;
  try{ await ensureQR(); }
  catch(e){ toast('No se pudo cargar el generador QR'); return; }
  $('#qrTitle').textContent = 'QR · ' + info.sheet;
  $('#qrLabel').textContent = info.c.filter(c=>c!=='').slice(0,3).join(' · ');
  const box = $('#qrCode');
  box.innerHTML = '';
  new QRCode(box, {text: deepLink(k), width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M});
  const dl = $('#qrDownload');
  dl.removeAttribute('href');
  dl.download = 'esebes-' + info.sheet.replace(/[^\wáéíóúñü]+/gi,'-') + '-f' + info.r + '.png';
  let tries = 0;
  const timer = setInterval(()=>{
    const img = box.querySelector('img');
    if (img && img.src){ dl.href = img.src; clearInterval(timer); }
    else if (++tries > 50) clearInterval(timer);
  }, 100);
  $('#qrModal').hidden = false;
}
function closeQR(){ $('#qrModal').hidden = true; }

/* ---------- compartir por WhatsApp ---------- */
async function shareResult(k){
  const info = resolveK(k);
  if (!info) return;
  const text = '⚡ ESEBÉS · ' + info.sheet + ' · Fila ' + info.r + '\n'
    + info.c.filter(c=>c!=='').join(' | ');
  if (navigator.share){
    try{ await navigator.share({title: 'ESEBÉS', text}); return; }
    catch(e){ if (e && e.name === 'AbortError') return; }
  }
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
}

/* ---------- enlace directo ?r= ---------- */
function handleDeepLink(){
  const p = new URLSearchParams(location.search);
  const r = p.get('r');
  if (r && rowByKey(r)){
    openSheet(r);
    history.replaceState(null, '', location.pathname);
  }
}

/* ---------- init ---------- */
async function init(){
  FAVS = loadJSON(FAV_KEY, []);
  RECENT = loadJSON(RECENT_KEY, []);
  try{
    const src = await loadData();
    buildZoneColors();
    renderChips();
    renderRecent();
    renderFavs();
    updateFavBadge();
    renderDataInfo();
    $('#dataInfo').textContent += src === 'actualizados' ? ' · datos actualizados' : '';
    handleDeepLink();
  }catch(e){
    console.error(e);
    $('#results').innerHTML = `<div class="empty"><span class="big">⚠️</span>No se pudieron cargar los datos.</div>`;
  }

  // búsqueda en vivo
  const run = debounce(()=>{ doSearch(); }, 220);
  $('#searchInput').addEventListener('input', ()=>{
    $('#clearBtn').hidden = !$('#searchInput').value;
    run();
  });
  $('#searchInput').addEventListener('keydown', (e)=>{
    if (e.key === 'Enter'){
      pushRecent($('#searchInput').value);
      doSearch();
      $('#searchInput').blur();
    }
  });
  $('#clearBtn').onclick = ()=>{
    $('#searchInput').value = '';
    $('#clearBtn').hidden = true;
    renderRecent();
    doSearch();
    $('#searchInput').focus();
  };
  $('#recentChips').onclick = (e)=>{
    const b = e.target.closest('[data-q]');
    if (!b) return;
    $('#searchInput').value = b.dataset.q;
    $('#clearBtn').hidden = false;
    doSearch();
  };
  $('#moreBtn').onclick = ()=>{ shown += PAGE; renderResults(norm($('#searchInput').value.trim()).split(/\s+/).filter(Boolean)); };

  bindCardActions($('#results'));
  bindCardActions($('#favsList'));

  // tabs
  document.querySelectorAll('.nav-btn').forEach(b=> b.onclick = ()=>switchTab(b.dataset.tab));

  // sheet
  $('#sheetClose').onclick = closeSheet;
  $('#sheet').addEventListener('click', (e)=>{ if (e.target.id === 'sheet') closeSheet(); });
  document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape'){ closeSheet(); closeQR(); } });
  $('#sheetCopy').onclick = ()=>copyResult(sheetK);
  $('#sheetFav').onclick = ()=>{ toggleFav(sheetK); openSheet(sheetK); };
  $('#sheetShare').onclick = ()=>shareResult(sheetK);
  $('#sheetPhotoBtn').onclick = ()=>takePhoto(sheetK);
  $('#sheetPhotoDel').onclick = async ()=>{ await idb.del(sheetK); toast('Foto eliminada'); refreshPhotoUI(sheetK); };
  $('#sheetQr').onclick = ()=>openQR(sheetK);

  // modal QR
  $('#qrClose').onclick = closeQR;
  $('#qrModal').addEventListener('click', (e)=>{ if (e.target.id === 'qrModal') closeQR(); });

  // foto (cámara / galería)
  $('#photoInput').onchange = async (e)=>{
    const f = e.target.files[0];
    if (!f || !photoTargetK) return;
    try{
      const blob = await compressImage(f);
      await idb.set(photoTargetK, blob);
      toast('📷 Foto guardada');
      refreshPhotoUI(photoTargetK);
    }catch(err){
      console.error(err);
      toast('No se pudo guardar la foto');
    }
  };

  setupVoice();

  // tema
  applyTheme(loadJSON(THEME_KEY, 'auto'));
  document.querySelectorAll('.seg-btn').forEach(b=> b.onclick = ()=>applyTheme(b.dataset.themeOpt));

  // ajustes: excel
  $('#updateBtn').onclick = ()=>{ $('#fileInput').value=''; $('#fileInput').click(); };
  $('#fileInput').onchange = (e)=>{ const f = e.target.files[0]; if (f) handleExcelFile(f); };
  $('#resetBtn').onclick = ()=>{
    localStorage.removeItem(STORE_KEY);
    location.reload();
  };

  setupInstall();
  setupOffline();

  // service worker
  if ('serviceWorker' in navigator){
    try{ await navigator.serviceWorker.register('sw.js'); }catch(e){ console.warn('SW no registrado', e); }
  }
}

document.addEventListener('DOMContentLoaded', init);
