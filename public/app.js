// ===== LANDING PAGE CONTROLS =====
document.addEventListener('DOMContentLoaded', function() {
  initParticles();
  animateCounters();
});

// Smooth scroll
function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({behavior:'smooth', block:'start'});
}

// Enter dashboard modes
function enterDashboard() {
  document.getElementById('landing-screen').style.display = 'none';
  document.getElementById('dashboard-screen').classList.remove('hidden');
  setTimeout(() => document.getElementById('ug-input')?.focus(), 200);
  document.getElementById('particle-canvas').style.opacity = '0.15';
}
function enterDashboardFinanceiro() {
  enterDashboard();
}
function enterDashboardContratos() {
  enterDashboard();
}

// ===== PARTICLE CANVAS =====
function initParticles() {
  const canvas = document.getElementById('particle-canvas');
  const ctx = canvas.getContext('2d');
  let W, H;
  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const particles = [];
  const COUNT = 80;
  for (let i = 0; i < COUNT; i++) {
    particles.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 2 + 0.5,
      a: Math.random() * 0.4 + 0.1
    });
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach((p, i) => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = W;
      if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H;
      if (p.y > H) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(34, 211, 238, ${p.a})`;
      ctx.fill();

      // Connect nearby particles
      for (let j = i + 1; j < particles.length; j++) {
        const dx = p.x - particles[j].x;
        const dy = p.y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 140) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(34, 211, 238, ${0.06 * (1 - dist / 140)})`;
          ctx.stroke();
        }
      }
    });
    requestAnimationFrame(draw);
  }
  draw();
}

// ===== ANIMATED COUNTERS =====
function animateCounters() {
  const counters = [
    {el: 'stat-ugs', target: 624, suffix: ''},
    {el: 'stat-contratos', target: 3200, suffix: '+', format: true},
    {el: 'stat-api', target: 100, suffix: '%'},
    {el: 'stat-precisao', target: 100, suffix: '%'}
  ];
  counters.forEach(c => {
    const el = document.getElementById(c.el);
    if (!el) return;
    let current = 0;
    const step = c.target / 40;
    const timer = setInterval(() => {
      current += step;
      if (current >= c.target) {
        current = c.target;
        clearInterval(timer);
      }
      el.textContent = (c.format ? (Math.floor(current) >= 1000 ? (Math.floor(current)/1000).toFixed(1)+'K' : Math.floor(current)) : Math.floor(current)) + c.suffix;
    }, 30);
  });
}

// ===== PRESERVED DASHBOARD LOGIC =====

const API_BASE = window.location.origin;
let ugAtual = null;
let ugAtualNome = null;
let ugSelecionada = null;
let primeiraConsultaFeita = false;
let agenteAtivo = null;
let aguardando = null;
let consultaPendente = null;

let ugDebounceTimer = null;
let ugCurrentResults = [];
let ugActiveIndex = -1;
let ugSearchSeq = 0;

const MESES = {
  'janeiro':'01','jan':'01','fevereiro':'02','fev':'02',
  'março':'03','marco':'03','mar':'03','abril':'04','abr':'04',
  'maio':'05','mai':'05','junho':'06','jun':'06','julho':'07','jul':'07',
  'agosto':'08','ago':'08','setembro':'09','set':'09','outubro':'10','out':'10',
  'novembro':'11','nov':'11','dezembro':'12','dez':'12'
};

const DOMINIOS = {
  financeiro: {
    nome: 'Financeiro',
    icone: '💰',
    cor: 'financeiro',
    tipos: ['empenhos','pagamentos','liquidacoes','restos_pagar'],
    placeholder: 'Pergunte sobre empenhos, pagamentos, liquidações, restos a pagar...',
    exemplos: [
      'maior empenho de 2026',
      '5 maiores pagamentos em janeiro',
      'liquidações de março de 2025',
      'restos a pagar de 2024'
    ]
  },
  contratos: {
    nome: 'Contratos',
    icone: '🤝',
    cor: 'contratos',
    tipos: ['contratos','licitacoes'],
    placeholder: 'Pergunte sobre contratos e licitações...',
    exemplos: [
      '📊 monitorar contratos',
      'contratos próximos ao vencimento',
      'quais contratos vencem esse mês',
      'contratos vencidos',
      'monitorar UG 201082'
    ]
  }
};

const TIPOS_PRECISA_MES = ['empenhos','liquidacoes','pagamentos','contratos','licitacoes'];

function iconePorEntidade(nome){
  const n=(nome||'').toLowerCase();
  if(/c[âa]mara/.test(n))return '🏛️';
  if(/prefeitura/.test(n))return '🏢';
  if(/(autarquia|instituto|iprev|ipam|iss|saae|daae|samae)/.test(n))return '🏗️';
  if(/fundo/.test(n))return '💰';
  if(/cons[óo]rcio/.test(n))return '🤝';
  return '🏷️';
}

async function sha256(t){
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t))))
    .map(b=>b.toString(16).padStart(2,'0')).join('');
}
function handleLogout(){location.reload()}
  setTimeout(()=>document.getElementById('ug-input').focus(),100);
}
function fecharModal(){document.querySelectorAll('.modal-overlay').forEach(m=>m.classList.add('hidden'))}
function openTools(){document.getElementById('modal-tools').classList.remove('hidden')}

function now(){
  const d=new Date();
  return d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');
}

function escapeHtml(s){return (s||'').toString().replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'})[c])}
function fmtValor(v){return 'R$ '+parseFloat(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}

/* ========= SELETOR DE UG ========= */

function abrirDropdown(){document.getElementById('ug-dropdown').classList.remove('hidden')}
function fecharDropdown(){
  document.getElementById('ug-dropdown').classList.add('hidden');
  ugActiveIndex=-1;
}

function renderDropdown(items){
  const dd=document.getElementById('ug-dropdown');
  if(!items || !items.length){
    dd.innerHTML='<div class="ug-dropdown-empty">Nenhum resultado encontrado</div>';
    abrirDropdown();
    return;
  }
  ugCurrentResults=items;
  let html='';
  items.forEach((it,i)=>{
    const icone=iconePorEntidade(it.nome);
    html+='<div class="ug-dropdown-item" data-idx="'+i+'" onclick="selecionarUgItem('+i+')">'+
            '<div class="ug-dropdown-icon">'+icone+'</div>'+
            '<div class="ug-dropdown-info">'+
              '<div class="ug-dropdown-name">'+escapeHtml(it.nome||'Sem nome')+'</div>'+
              '<div class="ug-dropdown-code">'+escapeHtml(it.codigo||'')+'</div>'+
            '</div>'+
          '</div>';
  });
  dd.innerHTML=html;
  abrirDropdown();
}

function setActiveItem(idx){
  const itens=document.querySelectorAll('.ug-dropdown-item');
  itens.forEach(el=>el.classList.remove('active'));
  if(idx>=0 && idx<itens.length){
    itens[idx].classList.add('active');
    itens[idx].scrollIntoView({block:'nearest'});
  }
  ugActiveIndex=idx;
}

function selecionarUgItem(i){
  const it=ugCurrentResults[i];
  if(!it)return;
  ugSelecionada={codigo:it.codigo,nome:it.nome};
  document.getElementById('ug-input').value=it.nome+' ('+it.codigo+')';
  renderBadgeSelecionada();
  document.getElementById('ug-btn').disabled=false;
  fecharDropdown();
}

function limparSelecao(){
  ugSelecionada=null;
  document.getElementById('ug-input').value='';
  document.getElementById('ug-btn').disabled=true;
  renderBadgeSelecionada();
  document.getElementById('ug-input').focus();
}

function renderBadgeSelecionada(){
  const wrap=document.getElementById('ug-selected-wrap');
  if(!ugSelecionada){wrap.innerHTML='';return}
  const ic=iconePorEntidade(ugSelecionada.nome);
  wrap.innerHTML='<span class="ug-selected-badge">'+
    '<span class="ug-selected-icon">'+ic+'</span>'+
    '<span class="ug-selected-name">'+escapeHtml(ugSelecionada.nome)+'</span>'+
    '<span class="ug-selected-code">'+escapeHtml(ugSelecionada.codigo)+'</span>'+
    '<button class="ug-selected-clear" onclick="limparSelecao()" title="Limpar">✕</button>'+
  '</span>';
}

async function buscarEntidades(q){
  const seq=++ugSearchSeq;
  document.getElementById('ug-spinner').classList.remove('hidden');
  try{
    const r=await fetch(API_BASE+'/api/entidades?q='+encodeURIComponent(q));
    if(!r.ok)throw new Error('http');
    const data=await r.json();
    if(seq!==ugSearchSeq)return;
    let lista=[];
    if(Array.isArray(data))lista=data;
    else if(Array.isArray(data.entidades))lista=data.entidades;
    else if(Array.isArray(data.resultados))lista=data.resultados;
    else if(Array.isArray(data.dados))lista=data.dados;
    lista=lista.map(it=>({
      codigo:(it.codigo||it.codigoUg||it.id||'').toString(),
      nome:(it.nome||it.descricao||it.entidade||'').toString()
    })).filter(it=>it.codigo);
    renderDropdown(lista);
  }catch(e){
    if(seq===ugSearchSeq)renderDropdown([]);
  }finally{
    if(seq===ugSearchSeq)document.getElementById('ug-spinner').classList.add('hidden');
  }
}

function onUgInput(e){
  const v=e.target.value.trim();
  if(ugSelecionada){
    ugSelecionada=null;
    renderBadgeSelecionada();
    document.getElementById('ug-btn').disabled=true;
  }
  clearTimeout(ugDebounceTimer);
  if(!v){fecharDropdown();document.getElementById('ug-spinner').classList.add('hidden');return}
  ugDebounceTimer=setTimeout(()=>buscarEntidades(v),300);
}

function onUgFocus(){
  if(ugCurrentResults.length && document.getElementById('ug-input').value.trim()){
    abrirDropdown();
  }
}

function onUgKeydown(e){
  const dd=document.getElementById('ug-dropdown');
  const visible=!dd.classList.contains('hidden');
  if(e.key==='ArrowDown' && visible){
    e.preventDefault();
    setActiveItem(Math.min(ugActiveIndex+1,ugCurrentResults.length-1));
  } else if(e.key==='ArrowUp' && visible){
    e.preventDefault();
    setActiveItem(Math.max(ugActiveIndex-1,0));
  } else if(e.key==='Enter'){
    if(visible && ugActiveIndex>=0){
      e.preventDefault();
      selecionarUgItem(ugActiveIndex);
    } else if(ugSelecionada){
      e.preventDefault();
      carregarUG();
    }
  } else if(e.key==='Escape'){
    fecharDropdown();
  }
}

document.addEventListener('click',function(e){
  const sel=document.getElementById('ug-selector');
  if(sel && !sel.contains(e.target))fecharDropdown();
});

/* ========= CHAT / MENSAGENS ========= */

function addMsg(html, who='agent'){
  const inner=document.getElementById('chat-inner');
  const row=document.createElement('div');
  row.className='msg-row '+(who==='user'?'user':'');
  let avatarClass='system';
  let avatarText='AI';
  if(who==='user'){
    avatarClass='user';
    avatarText='JS';
  } else if(agenteAtivo){
    avatarClass=agenteAtivo;
    avatarText=DOMINIOS[agenteAtivo].icone;
  } else {
    avatarText='🤖';
  }
  let msgClass='msg agent';
  if(who==='user'){
    msgClass='msg user '+(agenteAtivo||'neutral');
  }
  row.innerHTML='<div class="avatar '+avatarClass+'">'+avatarText+'</div>'+
                '<div><div class="'+msgClass+'">'+html+'</div><div class="msg-meta">'+now()+'</div></div>';
  inner.appendChild(row);
  scrollToBottom();
}

function addChips(chips){
  const inner=document.getElementById('chat-inner');
  const row=document.createElement('div');
  row.className='msg-row';
  let chipsHtml='<div class="chips-wrap">';
  chips.forEach(c=>{chipsHtml+='<span class="chip" onclick="'+c.onclick+'">'+c.label+'</span>'});
  chipsHtml+='</div>';
  row.innerHTML='<div class="avatar '+(agenteAtivo||'system')+'">'+(agenteAtivo?DOMINIOS[agenteAtivo].icone:'⚡')+'</div>'+
                '<div><div class="msg agent"><div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;margin-bottom:4px;">Ações rápidas</div>'+chipsHtml+'</div></div>';
  inner.appendChild(row);
  scrollToBottom();
}

function showLoading(){
  const inner=document.getElementById('chat-inner');
  const row=document.createElement('div');
  row.id='loading-msg';
  row.className='msg-row';
  const avClass=agenteAtivo||'system';
  const avText=agenteAtivo?DOMINIOS[agenteAtivo].icone:'🤖';
  row.innerHTML='<div class="avatar '+avClass+'">'+avText+'</div>'+
                '<div><div class="msg agent"><div class="typing-dots"><span></span><span></span><span></span></div></div></div>';
  inner.appendChild(row);
  scrollToBottom();
}
function hideLoading(){const l=document.getElementById('loading-msg');if(l)l.remove()}

function showSkeleton(){
  const inner=document.getElementById('chat-inner');
  const row=document.createElement('div');
  row.id='skeleton-msg';
  row.className='msg-row';
  const avClass=agenteAtivo||'system';
  const avText=agenteAtivo?DOMINIOS[agenteAtivo].icone:'🤖';
  row.innerHTML='<div class="avatar '+avClass+'">'+avText+'</div>'+
                '<div style="flex:1;max-width:80%"><div class="msg agent"><div class="skeleton w-60"></div><div class="skeleton w-80"></div><div class="skeleton w-40"></div></div></div>';
  inner.appendChild(row);
  scrollToBottom();
}
function hideSkeleton(){const s=document.getElementById('skeleton-msg');if(s)s.remove()}

function limparChat(){document.getElementById('chat-inner').innerHTML=''}
function scrollToBottom(){const a=document.getElementById('chat-area');a.scrollTop=a.scrollHeight}

function showToast(msg){
  const t=document.createElement('div');
  t.className='toast';
  t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),3000);
}

async function api(path,opts={}){
  try{
    const r=await fetch(API_BASE+path,{...opts,headers:{'Content-Type':'application/json',...opts.headers}});
    return r.ok?await r.json():null;
  }catch{return null}
}

function mostrarEscolhaAgente(){
  limparChat();
  const inner=document.getElementById('chat-inner');
  const wrap=document.createElement('div');
  const tituloUg=ugAtualNome?(ugAtualNome+' ('+ugAtual+')'):ugAtual;
  wrap.innerHTML=`
    <div class="agent-choice-header">
      <h2>Escolha um agente para a <span class="ug-tag">${escapeHtml(tituloUg)}</span></h2>
      <p>Cada agente tem domínio exclusivo. Você pode trocar a qualquer momento.</p>
    </div>
    <div class="agent-grid">
      <div class="agent-card financeiro" onclick="selecionarAgente('financeiro')">
        <div class="agent-card-icon">💰</div>
        <h3>Agente Financeiro</h3>
        <p>Consulta empenhos, pagamentos, liquidações e restos a pagar.</p>
        <div class="tags">
          <span class="tag">Empenhos</span>
          <span class="tag">Pagamentos</span>
          <span class="tag">Liquidações</span>
          <span class="tag">Restos a Pagar</span>
        </div>
      </div>
      <div class="agent-card contratos" onclick="selecionarAgente('contratos')">
        <div class="agent-card-icon">🤝</div>
        <h3>Agente Contratos</h3>
        <p>Consulta contratos e licitações vinculados à unidade gestora.</p>
        <div class="tags">
          <span class="tag">Contratos</span>
          <span class="tag">Licitações</span>
        </div>
      </div>
    </div>
  `;
  inner.appendChild(wrap);

  document.getElementById('chat-input-bar').classList.add('hidden');
  document.getElementById('agent-header-bar').classList.add('hidden');
  document.getElementById('agent-active-badge').classList.add('hidden');
  document.getElementById('btn-trocar-agente').classList.add('hidden');
}

function selecionarAgente(tipo){
  if(!DOMINIOS[tipo])return;
  agenteAtivo=tipo;
  aguardando=null;
  consultaPendente=null;
  const dom=DOMINIOS[tipo];

  const ugLabel=ugAtualNome?(ugAtualNome+' ('+ugAtual+')'):('UG '+ugAtual);

  const bar=document.getElementById('agent-header-bar');
  bar.className='agent-header-bar '+dom.cor;
  bar.classList.remove('hidden');
  document.getElementById('agent-header-title').innerHTML=
    '<span style="font-size:16px">'+dom.icone+'</span> <span>Agente '+dom.nome+'</span> <span style="color:var(--text-dim);font-weight:400;margin-left:6px;">· '+escapeHtml(ugLabel)+'</span>';
  document.getElementById('agent-header-domain').textContent='Domínio: '+dom.tipos.join(', ');

  const badge=document.getElementById('agent-active-badge');
  badge.className='agent-badge '+dom.cor;
  badge.classList.remove('hidden');
  badge.innerHTML='<span class="dot"></span>'+dom.nome;

  document.getElementById('btn-trocar-agente').classList.remove('hidden');

  document.getElementById('chat-input').placeholder=dom.placeholder;
  const inputBar=document.getElementById('chat-input-bar');
  inputBar.className='chat-input-bar '+dom.cor;
  inputBar.classList.remove('hidden');
  const inputInner=document.getElementById('chat-input-inner');
  inputInner.className='chat-input-inner '+dom.cor;

  limparChat();
  let exHtml='<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">';
  dom.exemplos.forEach(ex=>{
    exHtml+='<div style="font-size:13px;color:var(--text-muted);cursor:pointer;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.02);border:1px solid var(--border);transition:all 0.2s ease;" onmouseover="this.style.background=\'rgba(34,211,238,0.06)\';this.style.borderColor=\'rgba(34,211,238,0.2)\';this.style.color=\'var(--text)\'" onmouseout="this.style.background=\'rgba(255,255,255,0.02)\';this.style.borderColor=\'var(--border)\';this.style.color=\'var(--text-muted)\'" onclick="usarExemplo(\''+ex.replace(/'/g,"\\'")+'\')">→ '+ex+'</div>';
  });
  exHtml+='</div>';
  addMsg('<div style="font-weight:600;font-size:14px;letter-spacing:-0.01em;">Agente '+dom.nome+' ativo</div><div style="font-size:13px;color:var(--text-muted);margin-top:6px;">Pergunte em português sobre o domínio deste agente. Exemplos:</div>'+exHtml);
  document.getElementById('chat-input').focus();
}

function usarExemplo(txt){
  const i=document.getElementById('chat-input');
  i.value=txt;i.focus();
}

function trocarAgente(){
  addMsg('<span class="text-warning">↻ Trocando de agente... O histórico foi limpo.</span>');
  setTimeout(()=>{agenteAtivo=null;aguardando=null;consultaPendente=null;mostrarEscolhaAgente()},300);
}

function interpretarPergunta(texto){
  const t=texto.toLowerCase().trim();
  const r={tipo:null,ano:null,mes:null,ordenar:null,limite:null,foraDominio:null};

  if(!agenteAtivo)return r;

  const palavrasFinanceiro=/\b(empenhos?|despesas?|gastos?|gasto|pagamentos?|pagos?|pagamento|liquidaç|liquidac|liquidados?|restos?|resto)\b/;
  const palavrasContratos=/\b(contratos?|contrato|licitaç|licitac|licitação)\b/;

  if(agenteAtivo==='financeiro'){
    if(/restos?\b|\bresto\b/.test(t))r.tipo='restos_pagar';
    else if(/liquidaç|liquidac|liquidados?/.test(t))r.tipo='liquidacoes';
    else if(/pagamentos?|pagos?|pagamento/.test(t))r.tipo='pagamentos';
    else if(/empenhos?|despesas?|gastos?|gasto/.test(t))r.tipo='empenhos';
    else if(palavrasContratos.test(t))r.foraDominio='contratos';
  } else if(agenteAtivo==='contratos'){
    if(/monitor|dashboard|vencimento|vence|prestes a|pr[óo]ximos?|expirar|alertas?/.test(t)){
      r.tipo='monitorar';
      r.acao = 'abrir_dashboard';
    } else if(/licitaç|licitac|licitação/.test(t))r.tipo='licitacoes';
    else if(/contratos?|contrato/.test(t))r.tipo='contratos';
    else if(palavrasFinanceiro.test(t))r.foraDominio='financeiro';
  }

  const mAno=t.match(/\b(2024|2025|2026)\b/);
  if(mAno)r.ano=parseInt(mAno[1]);
  else if(/(desse|esse|este)\s+ano/.test(t))r.ano=new Date().getFullYear();
  else if(/(último|ultimo|passado)\s+ano|ano\s+passado/.test(t))r.ano=new Date().getFullYear()-1;

  for(const [nome,num] of Object.entries(MESES)){
    if(new RegExp('\\b'+nome+'\\b','i').test(t)){r.mes=num;break}
  }
  if(!r.mes){
    const mMes=t.match(/\bm[eê]s\s+(\d{1,2})\b/);
    if(mMes){const n=parseInt(mMes[1]);if(n>=1&&n<=12)r.mes=String(n).padStart(2,'0')}
  }

  if(/maior|maiores|top/.test(t)){
    r.ordenar='valor_desc';
    const mLim=t.match(/\b(\d+)\s*(maior|maiores|top)\b/)||t.match(/\btop\s*(\d+)\b/);
    if(mLim)r.limite=parseInt(mLim[1]);
    else r.limite=1;
  }

  return r;
}

function nomeTipo(tipo){
  return ({empenhos:'empenhos',liquidacoes:'liquidações',pagamentos:'pagamentos',contratos:'contratos',licitacoes:'licitações',restos_pagar:'restos a pagar'})[tipo]||tipo;
}

function mostrarSugestoes(){
  addChips([
    {label:'📊 Monitor Contratos',onclick:"window.open('/monitorar?ug='+(ugAtual||'201115'),'_blank')"},
    {label:'🧮 Calcular',onclick:'abrirCalculadora()'},
    {label:'📋 Criar Tarefa',onclick:'abrirCriarTarefa()'},
    {label:'⏰ Agendar',onclick:'abrirAgendar()'}
  ]);
}

async function executarConsulta(ug,tipo,ano,mes,ordenar,limite){
  if(!agenteAtivo || !DOMINIOS[agenteAtivo].tipos.includes(tipo)){
    addMsg('<span class="text-danger font-semibold">🚫 Bloqueado</span><div style="font-size:13px;color:var(--text-muted);margin-top:4px">Esse tipo de consulta não pertence ao agente ativo.</div>');
    return;
  }
  const params=new URLSearchParams();
  if(ano)params.set('ano',ano);
  if(mes)params.set('mes',mes);
  if(ordenar)params.set('ordenar',ordenar);
  if(limite)params.set('limite',limite);
  const qs=params.toString()?'?'+params.toString():'';

  showSkeleton();
  const d=await api('/api/consultar/'+ug+'/'+tipo+qs);
  hideSkeleton();
  primeiraConsultaFeita=true;

  if(!d){
    addMsg('<span class="text-danger font-semibold">❌ Erro</span><div style="font-size:13px;color:var(--text-muted);margin-top:4px">Não foi possível consultar '+nomeTipo(tipo)+'</div>');
    return;
  }

  const periodo=(mes?(mes+'/'):'')+(ano||'');
  let html='<div style="font-weight:600;font-size:14px;letter-spacing:-0.01em;">'+DOMINIOS[agenteAtivo].icone+' '+nomeTipo(tipo)+(periodo?' · '+periodo:'')+'</div>';

  if(d.maior && d.maior.valor!==undefined){
    html+='<div class="destaque"><div class="destaque-label">Maior '+nomeTipo(tipo).replace(/s$/,'')+(ano?' de '+ano:'')+(mes?' em '+mes:'')+'</div>';
    html+='<div class="destaque-value">'+fmtValor(d.maior.valor)+'</div>';
    if(d.maior.historico)html+='<div class="destaque-sub">'+escapeHtml(d.maior.historico)+'</div>';
    if(d.maior.competencia)html+='<div class="destaque-sub" style="font-size:11px;color:var(--text-dim)">Competência: '+escapeHtml(d.maior.competencia)+'</div>';
    html+='</div>';
  }

  if(d.total!==undefined && d.total!==null){
    html+='<div style="font-size:13px;color:var(--text-muted);margin-top:8px;">📄 Total de <strong style="color:var(--text)">'+d.total+'</strong> '+nomeTipo(tipo);
    if(periodo)html+=' em '+periodo;
    if(d.valorTotal!==undefined && d.valorTotal!==null)html+=': <span class="val-emerald">'+fmtValor(d.valorTotal)+'</span>';
    html+='</div>';
  }

  if(d.contratos && d.contratos.length){
    let tab='<div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">';
    d.contratos.slice(0,20).forEach(c=>{
      const modalidades={'22':'Concorrência','24':'Convite','30':'Pregão','35':'Dispensa','99':'Inexigibilidade','32':'Tomada de Preços'};
      tab+='<div style="background:var(--card-bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:12px;line-height:1.6">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'+
          '<strong style="font-size:13px;color:var(--text)">#'+escapeHtml(c.numero_contrato)+'</strong>'+
          '<span class="val-emerald" style="font-size:13px;font-weight:600">'+fmtValor(c.valor)+'</span>'+
        '</div>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;color:var(--text-muted)">'+
          '<span><span style="color:var(--text-dim)">📅 Início:</span> '+escapeHtml(c.inicio)+'</span>'+
          '<span><span style="color:var(--text-dim)">📅 Fim:</span> '+escapeHtml(c.fim)+'</span>'+
          '<span><span style="color:var(--text-dim)">🏛️ Licitação:</span> '+escapeHtml(c.numero_licitacao)+'</span>'+
          '<span><span style="color:var(--text-dim)">📋 Modalidade:</span> '+(modalidades[c.modalidade]||c.modalidade)+'</span>'+
          '<span style="grid-column:1/3"><span style="color:var(--text-dim)">🏢 CPF/CNPJ:</span> '+escapeHtml(c.cnpj_prestador)+'</span>'+
        '</div>'+
        '<div style="margin-top:4px;color:var(--text);font-size:11px;border-top:1px solid var(--border);padding-top:4px">'+
          escapeHtml((c.objeto||''))+
        '</div>'+
        '<div style="margin-top:2px;color:var(--text-dim);font-size:10px;text-align:right">📆 Ref: '+escapeHtml(c.periodo)+'</div>'+
      '</div>';
    });
    tab+='</div>';
    if(d.contratos.length>20)tab+='<div style="font-size:11px;color:var(--text-dim);margin-top:6px">... mais '+(d.contratos.length-20)+' contratos</div>';
    html+=tab;
  }

  if(d.dados && d.dados.length){
    let tab='<table class="result-table"><tr><th>#</th><th>Valor</th><th>Competência</th><th>Histórico</th></tr>';
    d.dados.slice(0,30).forEach((r,i)=>{
      const val=r.valor||0;
      const comp=r.competencia||r.periodo||'-';
      const hist=(r.historico||r.descricao||'')+'';
      tab+='<tr><td>'+(i+1)+'</td><td class="val-emerald">'+fmtValor(val)+'</td><td>'+escapeHtml(comp)+'</td><td>'+escapeHtml(hist.slice(0,70))+'</td></tr>';
    });
    tab+='</table>';
    if(d.dados.length>30)tab+='<div style="font-size:11px;color:var(--text-dim);margin-top:6px">... mais '+(d.dados.length-30)+' registros</div>';
    html+=tab;
  }

  addMsg(html);
  mostrarSugestoes();
}

async function processarConsulta(c){
  if(c.foraDominio){
    const outro=DOMINIOS[c.foraDominio];
    addMsg('<span class="text-warning font-semibold">🚫 Fora do domínio</span><div style="font-size:13px;color:var(--text-muted);margin-top:4px">Isso é assunto do <strong style="color:var(--text)">Agente '+outro.nome+'</strong> '+outro.icone+'. Clique em <em>↻ Trocar agente</em> para mudar.</div>');
    return;
  }
  if(!c.tipo){
    const dom=DOMINIOS[agenteAtivo];
    addMsg('<span class="text-warning font-semibold">🤔 Não entendi</span><div style="font-size:13px;color:var(--text-muted);margin-top:4px">No agente <strong style="color:var(--text)">'+dom.nome+'</strong>, pergunte sobre: '+dom.tipos.map(nomeTipo).join(', ')+'.</div>');
    return;
  }

  const precisaMes=TIPOS_PRECISA_MES.includes(c.tipo);

  if(c.acao === 'abrir_dashboard'){
    const ug = ugAtual || c.ug || '201115';
    addMsg('<span class="text-success font-semibold">📊 Abrindo Monitor de Contratos</span><div style="font-size:12px;color:var(--text-dim);margin-top:4px">UG: '+ug+'</div>');
    window.open('/monitorar?ug='+ug, '_blank');
    mostrarSugestoes();
    return;
  }

  if(!c.ano){
    aguardando='ano';
    consultaPendente=c;
    addMsg('<span class="text-accent font-semibold">📅 Qual exercício?</span><div style="font-size:12px;color:var(--text-dim);margin-top:4px">Ex: 2026, 2025, 2024</div>');
    return;
  }

  if(precisaMes && !c.mes){
    aguardando='mes';
    consultaPendente=c;
    addMsg('<span class="text-accent font-semibold">📆 Qual mês?</span><div style="font-size:12px;color:var(--text-dim);margin-top:4px">Ex: janeiro, fevereiro... ou digite <strong>todos</strong> para o ano inteiro</div>');
    return;
  }

  aguardando=null;
  consultaPendente=null;

  await executarConsulta(ugAtual,c.tipo,c.ano,c.mes,c.ordenar,c.limite);
}

async function carregarUG(){
  const err=document.getElementById('ug-error');
  err.textContent='';
  if(!ugSelecionada){err.textContent='Selecione uma UG na lista antes de buscar';return}
  const ug=ugSelecionada.codigo;
  const nome=ugSelecionada.nome;
  const btn=document.getElementById('ug-btn');
  btn.disabled=true;
  btn.innerHTML='<span class="spinner"></span>';
  showLoading();
  const d=await api('/api/consultas/'+ug);
  hideLoading();
  btn.disabled=false;
  btn.innerHTML='🔍 Buscar';
  if(!d){err.textContent='Erro ao consultar UG. Tente novamente.';return}
  ugAtual=ug;
  ugAtualNome=nome;
  agenteAtivo=null;
  aguardando=null;
  consultaPendente=null;
  primeiraConsultaFeita=false;
  document.getElementById('ug-status').innerHTML=escapeHtml(nome)+' <span class="text-accent font-semibold">('+escapeHtml(ug)+')</span>';
  addMsg('<span class="text-success font-semibold">✅ '+iconePorEntidade(nome)+' '+escapeHtml(nome)+' ('+escapeHtml(ug)+') carregada!</span>');
  mostrarEscolhaAgente();
}

async function enviarPergunta(){
  if(!ugAtual){addMsg('<span class="text-warning">⚠️ Selecione uma UG primeiro</span>');return}
  if(!agenteAtivo){addMsg('<span class="text-warning">⚠️ Escolha um agente primeiro</span>');return}
  const input=document.getElementById('chat-input');
  const txt=input.value.trim();
  if(!txt)return;
  input.value='';
  addMsg(escapeHtml(txt),'user');

  if(aguardando==='ano'){
    const mAno=txt.match(/\b(20\d{2})\b/);
    let ano=null;
    if(mAno)ano=parseInt(mAno[1]);
    else if(/(desse|esse|este)\s+ano/i.test(txt))ano=new Date().getFullYear();
    else if(/(último|ultimo|passado)/i.test(txt))ano=new Date().getFullYear()-1;
    if(!ano){addMsg('<span class="text-warning">⚠️ Não entendi o ano. Tente: 2026, 2025 ou 2024.</span>');return}
    consultaPendente.ano=ano;
    aguardando=null;
    await processarConsulta(consultaPendente);
    return;
  }

  if(aguardando==='mes'){
    const low=txt.toLowerCase();
    if(/^\s*todos\s*$/.test(low)||/ano inteiro/.test(low)){
      const c=consultaPendente;
      aguardando=null;consultaPendente=null;
      await executarConsulta(ugAtual,c.tipo,c.ano,null,c.ordenar,c.limite);
      return;
    }
    let mes=null;
    for(const [nome,num] of Object.entries(MESES)){
      if(new RegExp('\\b'+nome+'\\b','i').test(low)){mes=num;break}
    }
    if(!mes){
      const mNum=low.match(/\b(\d{1,2})\b/);
      if(mNum){const n=parseInt(mNum[1]);if(n>=1&&n<=12)mes=String(n).padStart(2,'0')}
    }
    if(!mes){addMsg('<span class="text-warning">⚠️ Não entendi o mês. Tente: janeiro, fevereiro... ou digite <strong>todos</strong>.</span>');return}
    consultaPendente.mes=mes;
    const c=consultaPendente;
    aguardando=null;consultaPendente=null;
    await executarConsulta(ugAtual,c.tipo,c.ano,c.mes,c.ordenar,c.limite);
    return;
  }

  const interp=interpretarPergunta(txt);
  await processarConsulta(interp);
}

function abrirCriarTarefa(){
  let m=document.getElementById('modal-tarefa');
  if(!m){
    const div=document.createElement('div');
    div.id='modal-tarefa';
    div.className='modal-overlay';
    div.innerHTML='<div class="modal-box">'+
      '<h3>Criar Tarefa</h3>'+
      '<p style="font-size:12px;color:var(--text-muted);margin-bottom:14px">UG: <strong style="color:var(--text)">'+escapeHtml(ugAtualNome?ugAtualNome+' ('+ugAtual+')':ugAtual)+'</strong> · Agente: <strong style="color:var(--text)">'+(agenteAtivo?DOMINIOS[agenteAtivo].nome:'-')+'</strong></p>'+
      '<div class="field"><label>Nome da Tarefa</label><input id="mt-nome" class="input" placeholder="Ex: Relatório contratos"></div>'+
      '<div class="field"><label>Descrição (opcional)</label><textarea id="mt-desc" class="input" rows="2" style="resize:vertical;font-family:inherit"></textarea></div>'+
      '<div id="mt-msg" style="font-size:12px;text-align:center;color:var(--success);min-height:18px"></div>'+
      '<div class="modal-actions">'+
        '<button onclick="criarTarefa()" class="btn btn-primary">Criar</button>'+
        '<button onclick="fecharModal()" class="btn btn-ghost">Cancelar</button>'+
      '</div></div>';
    document.body.appendChild(div);
    m=div;
  }
  m.classList.remove('hidden');
}

async function criarTarefa(){
  const n=document.getElementById('mt-nome').value.trim();
  const msg=document.getElementById('mt-msg');
  if(!n){msg.style.color='var(--warning)';msg.textContent='Dê um nome para a tarefa';return}
  msg.style.color='var(--text-muted)';
  msg.innerHTML='<span class="spinner"></span> Criando...';
  const d=await api('/api/tarefas',{method:'POST',body:JSON.stringify({ug:ugAtual,ugNome:ugAtualNome,consulta:'custom',nome:n,agente:agenteAtivo})});
  if(d){
    msg.style.color='var(--success)';
    msg.textContent='✅ Tarefa '+d.tarefa.id+' criada!';
    addMsg('<span class="text-success font-semibold">✅ Tarefa <strong>'+escapeHtml(d.tarefa.id)+'</strong> criada com sucesso!</span>');
    showToast('Tarefa criada com sucesso');
    setTimeout(fecharModal,1200);
  } else {
    msg.style.color='var(--danger)';
    msg.textContent='❌ Erro ao criar tarefa';
  }
}

function abrirAgendar(){
  addMsg('<span class="text-warning">⏰ Agendamento disponível em breve!</span>');
}

// ====== CALCULADORA DETERMINÍSTICA ======
// Garante 100% de precisão usando backend com aritmética inteira (centavos)

async function abrirCalculadora(){
  const m=getModal();
  m.innerHTML=`
    <div class="modal-overlay" onclick="fecharModal()">
      <div class="modal-box" style="max-width:520px" onclick="event.stopPropagation()">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div style="font-weight:600;font-size:15px">🧮 Calculadora Determinística</div>
          <span style="cursor:pointer;font-size:20px;color:var(--text-dim)" onclick="fecharModal()">✕</span>
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;background:rgba(16,185,129,0.1);padding:8px 10px;border-radius:6px;border:1px solid rgba(16,185,129,0.2)">
          ✅ Precisão de <strong style="color:var(--success)">100%</strong> — usa aritmética inteira (centavos) no servidor. Zero alucinação.
        </div>
        <div class="calc-body">
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
            <button class="calc-op" data-op="soma" style="background:rgba(59,130,246,0.15);color:#60a5fa" onclick="calcSetOp('soma')">➕ Somar</button>
            <button class="calc-op" data-op="media" style="background:rgba(16,185,129,0.15);color:#34d399" onclick="calcSetOp('media')">📊 Média</button>
            <button class="calc-op" data-op="divisao" style="background:rgba(245,158,11,0.15);color:#fbbf24" onclick="calcSetOp('divisao')">➗ Dividir</button>
            <button class="calc-op" data-op="percentual" style="background:rgba(139,92,246,0.15);color:#a78bfa" onclick="calcSetOp('percentual')">% Percentual</button>
            <button class="calc-op" data-op="diferenca" style="background:rgba(236,72,153,0.15);color:#f472b6" onclick="calcSetOp('diferenca')">↔️ Diferença</button>
          </div>
          <div id="calc-form">
            <!-- Dynamic form -->
          </div>
          <div id="calc-result" style="display:none;margin-top:10px;padding:10px;background:rgba(16,185,129,0.08);border-radius:8px;border:1px solid rgba(16,185,129,0.15)"></div>
        </div>
      </div>
    </div>`;
  m.classList.remove('hidden');
  calcSetOp('soma');
}

let calcOp = 'soma';

function calcSetOp(op){
  calcOp = op;
  document.querySelectorAll('.calc-op').forEach(b => b.style.opacity = b.dataset.op === op ? '1' : '0.5');
  const form = document.getElementById('calc-form');
  const r = document.getElementById('calc-result');
  if(r) r.style.display = 'none';

  if(op === 'soma'){
    form.innerHTML=`
      <div style="margin-bottom:8px;font-size:12px;color:var(--text-dim)">Digite os valores a somar (um por linha):</div>
      <textarea id="calc-values" rows="4" style="width:100%;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text);font-size:13px;resize:vertical" placeholder="1000&#10;2500.50&#10;750.25">1000&#10;2500.50&#10;750.25</textarea>
      <button onclick="calcExecutar()" style="margin-top:8px;width:100%;padding:8px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer">🧮 Calcular Soma</button>`;
  } else if(op === 'media'){
    form.innerHTML=`
      <div style="margin-bottom:8px;font-size:12px;color:var(--text-dim)">Digite os valores para calcular a média:</div>
      <textarea id="calc-values" rows="4" style="width:100%;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text);font-size:13px;resize:vertical" placeholder="1000&#10;2500&#10;750">1000&#10;2500&#10;750</textarea>
      <button onclick="calcExecutar()" style="margin-top:8px;width:100%;padding:8px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer">📊 Calcular Média</button>`;
  } else if(op === 'divisao'){
    form.innerHTML=`
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div><label style="font-size:11px;color:var(--text-dim)">Dividendo (R$)</label>
          <input id="calc-dividendo" type="number" step="0.01" value="1000" style="width:100%;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text);font-size:13px"></div>
        <div><label style="font-size:11px;color:var(--text-dim)">Divisor</label>
          <input id="calc-divisor" type="number" step="0.01" value="3" style="width:100%;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text);font-size:13px"></div>
      </div>
      <button onclick="calcExecutar()" style="margin-top:4px;width:100%;padding:8px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer">➗ Calcular Divisão</button>`;
  } else if(op === 'percentual'){
    form.innerHTML=`
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div><label style="font-size:11px;color:var(--text-dim)">Valor (R$)</label>
          <input id="calc-valor" type="number" step="0.01" value="500" style="width:100%;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text);font-size:13px"></div>
        <div><label style="font-size:11px;color:var(--text-dim)">Total (R$)</label>
          <input id="calc-total" type="number" step="0.01" value="2000" style="width:100%;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text);font-size:13px"></div>
      </div>
      <button onclick="calcExecutar()" style="margin-top:4px;width:100%;padding:8px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer">% Calcular Percentual</button>`;
  } else if(op === 'diferenca'){
    form.innerHTML=`
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div><label style="font-size:11px;color:var(--text-dim)">Valor A (R$)</label>
          <input id="calc-a" type="number" step="0.01" value="1000" style="width:100%;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text);font-size:13px"></div>
        <div><label style="font-size:11px;color:var(--text-dim)">Valor B (R$)</label>
          <input id="calc-b" type="number" step="0.01" value="300" style="width:100%;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;padding:8px;color:var(--text);font-size:13px"></div>
      </div>
      <button onclick="calcExecutar()" style="margin-top:4px;width:100%;padding:8px;background:linear-gradient(135deg,#ec4899,#db2777);color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer">↔️ Calcular Diferença</button>`;
  }
}

async function calcExecutar(){
  const r = document.getElementById('calc-result');
  r.style.display = 'block';
  r.innerHTML = '<span class="spinner"></span> Calculando...';

  try {
    let url;
    if(calcOp === 'soma' || calcOp === 'media'){
      const vals = document.getElementById('calc-values').value.split('\n').map(v => v.trim()).filter(v => v);
      if(vals.length === 0){ r.innerHTML = '<span style="color:var(--danger)">⚠️ Informe ao menos um valor</span>'; return; }
      url = `/api/calcular/${calcOp}?` + vals.map(v => 'v=' + encodeURIComponent(v)).join('&');
    } else if(calcOp === 'divisao'){
      const d = document.getElementById('calc-dividendo').value;
      const v = document.getElementById('calc-divisor').value;
      if(parseFloat(v) === 0){ r.innerHTML = '<span style="color:var(--danger)">⚠️ Divisão por zero não permitida</span>'; return; }
      url = `/api/calcular/dividir?dividendo=${encodeURIComponent(d)}&divisor=${encodeURIComponent(v)}`;
    } else if(calcOp === 'percentual'){
      const val = document.getElementById('calc-valor').value;
      const tot = document.getElementById('calc-total').value;
      url = `/api/calcular/percentual?valor=${encodeURIComponent(val)}&total=${encodeURIComponent(tot)}`;
    } else if(calcOp === 'diferenca'){
      const a = document.getElementById('calc-a').value;
      const b = document.getElementById('calc-b').value;
      url = `/api/calcular/diferenca?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`;
    }

    const res = await api(url);
    if(!res){ r.innerHTML = '<span style="color:var(--danger)">❌ Erro ao calcular</span>'; return; }

    let html = '<div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;display:flex;align-items:center;gap:4px">✅ Resultado Determinístico <span style="font-size:9px;background:rgba(16,185,129,0.2);padding:1px 5px;border-radius:3px">100% preciso</span></div>';

    if(calcOp === 'soma'){
      html += `<div style="font-size:20px;font-weight:700;color:var(--success)">${res.total_formatado}</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px">${res.parcelas.length} parcelas · ${res.total_centavos} centavos</div>`;
    } else if(calcOp === 'media'){
      html += `<div style="font-size:20px;font-weight:700;color:var(--success)">${res.media_formatada}</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px">Média de ${res.quantidade} valores · Soma: ${res.soma_centavos} centavos</div>`;
    } else if(calcOp === 'divisao'){
      html += `<div style="font-size:20px;font-weight:700;color:#fbbf24">${res.resultado_formatado}</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px">${res.dividendo} ÷ ${res.divisor} · ${res.resultado_centavos} centavos</div>`;
    } else if(calcOp === 'percentual'){
      html += `<div style="font-size:20px;font-weight:700;color:#a78bfa">${res.percentual_formatado}</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px">${res.valor} de ${res.total}</div>`;
    } else if(calcOp === 'diferenca'){
      html += `<div style="font-size:20px;font-weight:700;color:#f472b6">${res.diferenca_formatada}</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px">${res.valor_a} - ${res.valor_b} · Maior: ${res.maior === 'a' ? 'Valor A' : 'Valor B'}</div>`;
    }

    r.innerHTML = html;
  } catch(e){
    r.innerHTML = `<span style="color:var(--danger)">❌ Erro: ${e.message}</span>`;
  }
}

// ====== FIM CALCULADORA ======



// Start — show landing page with particles
initParticles();
// If there's a UG in URL, open dashboard directly
document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('ug')) enterDashboard();
});