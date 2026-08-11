/* ============================================================
   La Rústica — Informes de campo
   Stack: Supabase (DB + Storage) + función serverless en Vercel para Claude
   ============================================================ */

const LS_KEYS = { clinic: 'lr_clinic', visits: 'lr_visitas_local' };

const supa = window.supabase.createClient(window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_ANON_KEY);

const state = {
  recognizing: false,
  recognition: null,
  recSeconds: 0,
  recInterval: null,
  draft: freshDraft(),
  currentTab: 'nueva'
};

function freshDraft(){
  const now = new Date();
  return {
    fecha: now.toISOString().slice(0,10),
    hora: now.toTimeString().slice(0,5),
    geo: null,
    photos: [],   // { file, dataUrl }
    transcript: '',
    cliente: '',
    motivo: '',
    informe: ''
  };
}

/* ---------------- Toast ---------------- */
function toast(msg, ms=3200){
  const root = document.getElementById('toast');
  const el = document.createElement('div');
  el.className = 'toast-msg';
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(()=>el.remove(), ms);
}

/* ---------------- Tabs ---------------- */
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>switchTab(btn.dataset.tab));
});
function switchTab(name){
  state.currentTab = name;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  document.getElementById('tab-nueva').classList.toggle('hidden', name!=='nueva');
  document.getElementById('tab-historial').classList.toggle('hidden', name!=='historial');
  document.getElementById('tab-config').classList.toggle('hidden', name!=='config');
  if(name==='historial') renderHistorial();
}

/* ---------------- Config ---------------- */
function loadConfig(){
  document.getElementById('cfgClinic').value = localStorage.getItem(LS_KEYS.clinic) || '';
  document.getElementById('clinicLabel') && (document.getElementById('clinicLabel').textContent = localStorage.getItem(LS_KEYS.clinic) || 'Informes de campo');
}
document.getElementById('saveCfgBtn').addEventListener('click', ()=>{
  localStorage.setItem(LS_KEYS.clinic, document.getElementById('cfgClinic').value.trim());
  loadConfig();
  toast('Guardado');
});
document.getElementById('exportJsonBtn').addEventListener('click', ()=>{
  const blob = new Blob([JSON.stringify(getLocalVisits(), null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'la_rustica_backup.json';
  a.click();
});

/* ---------------- Reconocimiento de voz ---------------- */
function setupRecognition(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){
    document.getElementById('recHint').textContent =
      'Este navegador no soporta dictado en vivo. Escribí la nota manualmente abajo (funciona igual).';
    return null;
  }
  const rec = new SR();
  rec.lang = 'es-PY';
  rec.continuous = true;
  rec.interimResults = true;
  const normalize = s => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  let finalText = '';
  let lastFinalNorm = '';
  rec.onresult = (e)=>{
    let interim = '';
    for(let i = e.resultIndex; i < e.results.length; i++){
      const t = e.results[i][0].transcript;
      if(e.results[i].isFinal){
        const chunk = t.trim();
        const norm = normalize(chunk);
        if(chunk && norm && norm !== lastFinalNorm){
          finalText += t + ' ';
          lastFinalNorm = norm;
        }
      } else {
        interim += t;
      }
    }
    document.getElementById('transcriptBox').value = (finalText + interim).trim();
  };
  rec.onerror = (e)=>{
    if(e.error === 'no-speech') return;
    toast('No se pudo escuchar bien. Revisá el permiso de micrófono o escribí manualmente.');
    stopRecording();
  };
  rec.onend = ()=>{
    if(state.recognizing){ try{ rec.start(); }catch(_e){} }
  };
  return rec;
}
document.getElementById('micBtn').addEventListener('click', ()=>{
  if(state.recognizing) stopRecording(); else startRecording();
});
function startRecording(){
  if(!state.recognition) state.recognition = setupRecognition();
  state.recognizing = true;
  document.getElementById('micBtn').classList.add('recording');
  document.getElementById('recHint').textContent = 'Escuchando… tocá de nuevo para parar.';
  state.recSeconds = 0;
  updateRecTime();
  state.recInterval = setInterval(()=>{ state.recSeconds++; updateRecTime(); }, 1000);
  if(state.recognition){ try{ state.recognition.start(); }catch(_e){} }
}
function stopRecording(){
  state.recognizing = false;
  document.getElementById('micBtn').classList.remove('recording');
  document.getElementById('recHint').textContent = 'Tocá el micrófono para seguir grabando, o editá el texto abajo.';
  clearInterval(state.recInterval);
  if(state.recognition){ try{ state.recognition.stop(); }catch(_e){} }
}
function updateRecTime(){
  const m = String(Math.floor(state.recSeconds/60)).padStart(2,'0');
  const s = String(state.recSeconds%60).padStart(2,'0');
  document.getElementById('recTime').textContent = state.recognizing ? `${m}:${s}` : '';
}

/* ---------------- Geolocalización ---------------- */
document.getElementById('geoBtn').addEventListener('click', ()=>{
  if(!navigator.geolocation){ toast('Este dispositivo no soporta geolocalización.'); return; }
  document.getElementById('geoVal').textContent = 'buscando…';
  navigator.geolocation.getCurrentPosition(pos=>{
    const lat = pos.coords.latitude.toFixed(5);
    const lon = pos.coords.longitude.toFixed(5);
    state.draft.geo = { lat, lon, mapsUrl: `https://maps.google.com/?q=${lat},${lon}` };
    const el = document.getElementById('geoVal');
    el.textContent = `${lat}, ${lon}`;
    el.classList.remove('pending');
  }, ()=>{
    document.getElementById('geoVal').textContent = 'sin capturar';
    toast('No se pudo obtener la ubicación. Revisá el permiso de GPS.');
  }, { enableHighAccuracy:true, timeout:12000 });
});

function refreshDateLabel(){
  const [y,m,d] = state.draft.fecha.split('-');
  document.getElementById('dateVal').textContent = `${d}/${m}/${y} ${state.draft.hora}`;
}

/* ---------------- Fotos ---------------- */
document.getElementById('photoInput').addEventListener('change', (e)=>{
  const files = Array.from(e.target.files || []);
  files.forEach(file=>{
    const reader = new FileReader();
    reader.onload = ()=>{
      state.draft.photos.push({ file, dataUrl: reader.result });
      renderPhotoStrip();
    };
    reader.readAsDataURL(file);
  });
  e.target.value = '';
});
function renderPhotoStrip(){
  const strip = document.getElementById('photoStrip');
  strip.innerHTML = '';
  state.draft.photos.forEach((p, idx)=>{
    const img = document.createElement('img');
    img.src = p.dataUrl;
    img.addEventListener('click', ()=>{
      if(confirm('¿Quitar esta foto?')){ state.draft.photos.splice(idx,1); renderPhotoStrip(); }
    });
    strip.appendChild(img);
  });
  const add = document.createElement('label');
  add.className = 'photo-add';
  add.setAttribute('for','photoInput');
  add.textContent = '＋';
  strip.appendChild(add);
}

/* ---------------- Generar informe (vía función serverless) ---------------- */
document.getElementById('genBtn').addEventListener('click', generarInforme);

async function generarInforme(){
  const transcript = document.getElementById('transcriptBox').value.trim();
  if(!transcript){ toast('Grabá o escribí la nota de la visita primero.'); return; }
  state.draft.transcript = transcript;

  const genBtn = document.getElementById('genBtn');
  const log = document.getElementById('genLog');
  genBtn.disabled = true;
  log.textContent = 'Analizando nota de voz…';

  const clinic = localStorage.getItem(LS_KEYS.clinic) || '';

  try{
    const resp = await fetch('/api/generate-informe', {
      method:'POST',
      headers:{ 'content-type':'application/json' },
      body: JSON.stringify({
        transcript,
        fecha: state.draft.fecha,
        hora: state.draft.hora,
        geo: state.draft.geo,
        clinic,
        photos: state.draft.photos.slice(0,4).map(p=>p.dataUrl)
      })
    });
    const parsed = await resp.json();
    if(!resp.ok) throw new Error(parsed.error || `Error ${resp.status}`);

    state.draft.cliente = parsed.cliente || '';
    state.draft.motivo = parsed.motivo || '';
    state.draft.informe = parsed.informe || '';

    document.getElementById('clienteInput').value = state.draft.cliente;
    document.getElementById('informeText').value = state.draft.informe;
    const [y,m,d] = state.draft.fecha.split('-');
    document.getElementById('informeHeadMeta').textContent =
      `${d}/${m}/${y} · ${state.draft.hora}${state.draft.geo ? ' · '+state.draft.geo.lat+', '+state.draft.geo.lon : ''}`;
    document.getElementById('informeSection').classList.remove('hidden');
    document.getElementById('informeSection').scrollIntoView({behavior:'smooth', block:'start'});
    log.textContent = '';
    toast('Informe generado. Revisalo y ajustalo antes de enviarlo.');
  }catch(err){
    console.error(err);
    log.textContent = '';
    toast('Error al generar el informe: ' + err.message, 5000);
  }finally{
    genBtn.disabled = false;
  }
}

/* ---------------- Copiar / PDF ---------------- */
document.getElementById('copyBtn').addEventListener('click', async ()=>{
  try{
    await navigator.clipboard.writeText(document.getElementById('informeText').value);
    toast('Informe copiado. Pegalo en WhatsApp.');
  }catch(_e){ toast('No se pudo copiar automáticamente. Seleccioná el texto manualmente.'); }
});
document.getElementById('pdfBtn').addEventListener('click', ()=>{
  buildPrintArea({
    cliente: document.getElementById('clienteInput').value || 'Cliente sin identificar',
    meta: document.getElementById('informeHeadMeta').textContent,
    informe: document.getElementById('informeText').value,
    photos: state.draft.photos
  });
  window.print();
});
function buildPrintArea({cliente, meta, informe, photos}){
  const clinic = localStorage.getItem(LS_KEYS.clinic) || 'La Rústica — Informe de campo';
  const area = document.getElementById('printArea');
  const photosHtml = (photos||[]).map(p=>`<img src="${p.dataUrl}" style="width:140px;height:140px;object-fit:cover;border-radius:4px;margin:4px;">`).join('');
  area.innerHTML = `
    <div style="font-family:'Inter',sans-serif;padding:30px;max-width:720px;margin:0 auto;">
      <div style="display:flex;align-items:center;gap:10px;border-bottom:3px solid #000;padding-bottom:14px;margin-bottom:20px;">
        <div style="width:34px;height:34px;border-radius:6px;background:#A7926F;color:#000;display:flex;align-items:center;justify-content:center;font-weight:700;font-family:'Anton',sans-serif;">LR</div>
        <div>
          <div style="font-size:17px;font-weight:700;font-family:'Anton',sans-serif;text-transform:uppercase;">${escapeHtml(clinic)}</div>
          <div style="font-family:'Share Tech Mono',monospace;font-size:11px;color:#666;">${escapeHtml(meta)}</div>
        </div>
      </div>
      <div style="font-size:12px;color:#666;font-family:'Share Tech Mono',monospace;margin-bottom:4px;text-transform:uppercase;">Cliente</div>
      <div style="font-size:18px;font-weight:700;margin-bottom:18px;">${escapeHtml(cliente)}</div>
      <div style="font-size:14px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(informe)}</div>
      ${photosHtml ? `<div style="margin-top:22px;">${photosHtml}</div>` : ''}
    </div>`;
}
function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---------------- Guardar visita (Supabase) ---------------- */
document.getElementById('saveBtn').addEventListener('click', saveVisit);

function getLocalVisits(){
  try{ return JSON.parse(localStorage.getItem(LS_KEYS.visits) || '[]'); }catch(_e){ return []; }
}
function setLocalVisits(arr){ localStorage.setItem(LS_KEYS.visits, JSON.stringify(arr)); }

async function saveVisit(){
  const cliente = document.getElementById('clienteInput').value.trim() || 'Cliente sin identificar';
  const informe = document.getElementById('informeText').value.trim();
  if(!informe){ toast('Generá el informe antes de guardar.'); return; }

  const saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled = true;
  toast('Guardando…');

  const slug = cliente.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,40);
  const id = `${state.draft.fecha}|${state.draft.hora}|${slug}`;

  // 1. Subir fotos a Supabase Storage (si hay conexión)
  let fotosUrls = [];
  try{
    for(let i=0; i<state.draft.photos.length; i++){
      const { file } = state.draft.photos[i];
      const path = `${id.replace(/\|/g,'_')}/${i}-${file.name}`;
      const { error } = await supa.storage.from('fotos-informes').upload(path, file, { upsert:true });
      if(!error){
        const { data: pub } = supa.storage.from('fotos-informes').getPublicUrl(path);
        fotosUrls.push(pub.publicUrl);
      }
    }
  }catch(err){ console.warn('No se pudieron subir todas las fotos', err); }

  const visita = {
    id, fecha: state.draft.fecha, hora: state.draft.hora, cliente,
    motivo: state.draft.motivo,
    lat: state.draft.geo ? Number(state.draft.geo.lat) : null,
    lon: state.draft.geo ? Number(state.draft.geo.lon) : null,
    maps_url: state.draft.geo ? state.draft.geo.mapsUrl : null,
    transcripcion: state.draft.transcript,
    informe,
    estado: 'borrador',
    fotos_urls: fotosUrls,
    creado: new Date().toISOString()
  };

  // 2. Guardar local siempre (funciona offline)
  const local = getLocalVisits();
  const idx = local.findIndex(v=>v.id===visita.id);
  if(idx>=0) local[idx] = visita; else local.unshift(visita);
  setLocalVisits(local);

  // 3. Guardar en Supabase
  const { error } = await supa.from('visitas').upsert(visita);
  if(error){
    console.error(error);
    toast('Guardado en el teléfono. No se pudo sincronizar con Supabase todavía (' + error.message + ').', 5000);
  }else{
    toast('Visita guardada y sincronizada.');
  }
  saveBtn.disabled = false;

  state.draft = freshDraft();
  document.getElementById('transcriptBox').value = '';
  document.getElementById('clienteInput').value = '';
  document.getElementById('informeText').value = '';
  document.getElementById('geoVal').textContent = 'sin capturar';
  document.getElementById('geoVal').classList.add('pending');
  document.getElementById('informeSection').classList.add('hidden');
  refreshDateLabel();
  renderPhotoStrip();
  switchTab('historial');
}

/* ---------------- Sync con Supabase ---------------- */
document.getElementById('syncBtn').addEventListener('click', async ()=>{
  toast('Sincronizando…');
  try{
    const { data, error } = await supa.from('visitas').select('*').order('creado', { ascending:false });
    if(error) throw error;
    const local = getLocalVisits();
    const byId = {};
    local.forEach(v=>byId[v.id]=v);
    (data||[]).forEach(v=>{ byId[v.id] = { ...byId[v.id], ...v }; });
    setLocalVisits(Object.values(byId));
    renderHistorial();
    toast('Sincronizado.');
  }catch(err){
    console.error(err);
    toast('No se pudo sincronizar: ' + err.message, 5000);
  }
});

/* ---------------- Historial ---------------- */
function renderHistorial(){
  const visits = getLocalVisits().sort((a,b)=> (b.fecha+b.hora).localeCompare(a.fecha+a.hora));
  const clienteFilter = document.getElementById('filterCliente');
  const estadoFilter = document.getElementById('filterEstado').value;
  const clienteSel = clienteFilter.value;

  const clientes = [...new Set(visits.map(v=>v.cliente))].sort();
  clienteFilter.innerHTML = '<option value="">Todos los clientes</option>' +
    clientes.map(c=>`<option value="${escapeHtml(c)}" ${c===clienteSel?'selected':''}>${escapeHtml(c)}</option>`).join('');

  const filtered = visits.filter(v=>(!clienteSel || v.cliente===clienteSel) && (!estadoFilter || v.estado===estadoFilter));

  const list = document.getElementById('visitList');
  if(filtered.length===0){
    list.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" fill="none"><path d="M4 5h16M4 12h16M4 19h10"/></svg>
      <p>Todavía no hay visitas guardadas. Creá una desde la pestaña "Nueva visita".</p>
    </div>`;
    return;
  }
  list.innerHTML = filtered.map(v=>{
    const [y,m,d] = v.fecha.split('-');
    return `<div class="visit-item" data-id="${escapeHtml(v.id)}">
      <div class="row1">
        <div>
          <div class="cliente">${escapeHtml(v.cliente)}</div>
          <div class="fecha">${d}/${m}/${y} · ${v.hora}${v.lat ? ' · '+v.lat+', '+v.lon : ''}</div>
        </div>
        <span class="pill ${v.estado}">${v.estado}</span>
      </div>
      <div class="motivo">${escapeHtml(v.motivo || '')}</div>
    </div>`;
  }).join('');

  list.querySelectorAll('.visit-item').forEach(item=>{
    item.addEventListener('click', ()=>openVisitDetail(item.dataset.id));
  });
}
document.getElementById('filterCliente').addEventListener('change', renderHistorial);
document.getElementById('filterEstado').addEventListener('change', renderHistorial);

function openVisitDetail(id){
  const visits = getLocalVisits();
  const v = visits.find(x=>x.id===id);
  if(!v) return;
  const root = document.getElementById('modalRoot');
  const [y,m,d] = v.fecha.split('-');
  root.innerHTML = `
    <div class="modal-bg" id="detailModal">
      <div style="background:#fff;border-radius:4px;max-width:520px;width:100%;max-height:85vh;overflow:auto;padding:20px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
          <h2 style="font-size:19px;">${escapeHtml(v.cliente)}</h2>
          <span class="pill ${v.estado}">${v.estado}</span>
        </div>
        <div class="fecha" style="margin-bottom:14px;">${d}/${m}/${y} · ${v.hora}${v.lat ? ' · '+v.lat+', '+v.lon : ''}</div>
        <textarea class="informe-text" id="detailInforme" style="border:1px solid var(--gris);border-radius:4px;min-height:220px;">${v.informe}</textarea>
        <div class="btn-row" style="margin-top:12px;">
          <button class="btn btn-secondary" id="detailCopyBtn">Copiar</button>
          <button class="btn btn-secondary" id="detailPdfBtn">PDF</button>
        </div>
        <div class="btn-row" style="margin-top:8px;">
          <button class="btn ${v.estado==='enviado'?'btn-ghost':'btn-primary'}" id="detailEstadoBtn">${v.estado==='enviado' ? 'Marcar como borrador' : 'Marcar como enviado'}</button>
          <button class="btn btn-ghost" id="detailCloseBtn">Cerrar</button>
        </div>
      </div>
    </div>`;
  document.getElementById('detailModal').addEventListener('click', (e)=>{ if(e.target.id==='detailModal') root.innerHTML=''; });
  document.getElementById('detailCloseBtn').addEventListener('click', ()=>root.innerHTML='');
  document.getElementById('detailCopyBtn').addEventListener('click', async ()=>{
    await navigator.clipboard.writeText(document.getElementById('detailInforme').value);
    toast('Copiado.');
  });
  document.getElementById('detailPdfBtn').addEventListener('click', ()=>{
    buildPrintArea({ cliente:v.cliente, meta:`${d}/${m}/${y} · ${v.hora}`, informe: document.getElementById('detailInforme').value, photos:[] });
    window.print();
  });
  document.getElementById('detailEstadoBtn').addEventListener('click', async ()=>{
    v.estado = v.estado==='enviado' ? 'borrador' : 'enviado';
    v.informe = document.getElementById('detailInforme').value;
    const idx = visits.findIndex(x=>x.id===v.id);
    visits[idx] = v;
    setLocalVisits(visits);
    const { error } = await supa.from('visitas').upsert(v);
    if(error) toast('Guardado local. No se pudo sincronizar: ' + error.message, 5000);
    root.innerHTML = '';
    renderHistorial();
    toast(v.estado==='enviado' ? 'Marcada como enviada.' : 'Marcada como borrador.');
  });
}

/* ---------------- Service worker ---------------- */
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{ navigator.serviceWorker.register('sw.js').catch(()=>{}); });
}

/* ---------------- Init ---------------- */
loadConfig();
refreshDateLabel();
renderPhotoStrip();
renderHistorial();
