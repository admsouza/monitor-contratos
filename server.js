
const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
// BUILD-NG-2405: nova landing page impactante

const app = express();
const PORT = 80;
const TASKS_FILE = '/data/tasks.json';
const SAGRES_KEY = '3938a148-5b81-4ad7-ba2c-dcc68e5106ff';
const SAGRES_BASE = 'sagrescaptura.tce.pb.gov.br';
const GESTOR_BASE = 'gestor.tce.pb.gov.br';
const ENTIDADES = require('./entidades.js');
const NOTIFICACOES_FILE = process.env.NOTIFICACOES_FILE || '/data/notificacoes.json';
const WHATSAPP_LOG_FILE = process.env.WHATSAPP_LOG_FILE || '/data/whatsapp_log.json';

try { if (!fs.existsSync('/data')) fs.mkdirSync('/data', { recursive: true }); } catch(e) {}

app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ===== HELPERS =====

// HTTPS get wrapper
function httpsGet(hostname, path, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get({ hostname, path, headers, timeout: 30000 }, (resp) => {
      let raw = '';
      resp.on('data', c => raw += c);
      resp.on('end', () => {
        if (resp.statusCode !== 200) return reject(new Error(`HTTP ${resp.statusCode}`));
        resolve(raw);
      });
    }).on('error', reject).on('timeout', () => reject(new Error('Timeout')));
  });
}

// SAGRES proxy (with month-by-month iteration for >31 day periods)
async function sagresQuery(endpoint, ug, dataMinima, dataMaxima) {
  const start = new Date(dataMinima);
  const end = new Date(dataMaxima);
  const allResults = [];
  const errors = [];

  let current = new Date(start);
  while (current <= end) {
    const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
    const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
    const mStart = monthStart.toISOString().slice(0, 10);
    const mEnd = (monthEnd < end ? monthEnd : end).toISOString().slice(0, 10);

    const qs = new URLSearchParams({
      codUnidadeGestora: ug,
      dataMinima: mStart,
      dataMaxima: mEnd,
      size: 10000
    }).toString();

    try {
      const raw = await httpsGet(SAGRES_BASE, `/api/v1${endpoint}?${qs}`, { 'AuthToken': SAGRES_KEY });
      const data = JSON.parse(raw);
      const records = Array.isArray(data) ? data : (data.content || data.records || []);
      allResults.push(...records);
    } catch (e) {
      errors.push(`${mStart}-${mEnd}: ${e.message}`);
    }

    current.setMonth(current.getMonth() + 1);
  }

  return { records: allResults, errors };
}

// Parse TCE-PB contratos — usa formato de 281 chars (campos posicionais exatos)
// Formato: UG(6) + Contrato(12) + Inicio(8) + Fim(8) + CNPJ(14) + Licitacao(9) + Modalidade(2) + Valor(16) + Objeto(var) + Periodo(6)
function parseContratosTCE(texto) {
  // Pega TODAS as linhas, encontra as que têm formato de 281 chars
  const linhas = texto.split('\n')
    .map(l => l.trim())
    .filter(l => l.length >= 275 && l.length <= 285 && /^\d{6}/.test(l));
  
  const contratos = [];

  for (const linha of linhas) {
    const ug = linha.substring(0, 6).trim();
    const numContrato = linha.substring(6, 18).trim();
    const inicioRaw = linha.substring(18, 26).trim();
    const fimRaw = linha.substring(26, 34).trim();
    const docRaw = linha.substring(34, 48).trim();
    // Detecta se é CPF (11 díg) ou CNPJ (14 díg)
    const digits = docRaw.replace(/\D/g, '');
    const cnpj = digits.length <= 11
      ? digits.padStart(11, '0')   // CPF: normaliza pra 11 díg
      : digits.padStart(14, '0');  // CNPJ: normaliza pra 14 díg
    const numLicitacao = linha.substring(48, 57).trim();
    const modalidade = linha.substring(57, 59).trim();
    const valorStr = linha.substring(59, 75).trim();
    const objeto = linha.substring(75, linha.length - 6).trim();
    const periodo = linha.substring(linha.length - 6).trim(); // MMYYYY

    // Validação básica: campos essenciais preenchidos
    if (!ug || !numContrato || !valorStr) continue;

    // Formata datas DDMMYYYY → DD/MM/YYYY
    const inicio = inicioRaw.length === 8 ? `${inicioRaw.substring(0,2)}/${inicioRaw.substring(2,4)}/${inicioRaw.substring(4,8)}` : inicioRaw;
    const fim = fimRaw.length === 8 ? `${fimRaw.substring(0,2)}/${fimRaw.substring(2,4)}/${fimRaw.substring(4,8)}` : fimRaw;

    const valor = parseFloat(valorStr) || 0;

    contratos.push({
      ug,
      numero_contrato: numContrato,
      inicio,
      fim,
      cnpj_prestador: cnpj,
      numero_licitacao: numLicitacao,
      modalidade,
      valor,
      objeto,
      periodo
    });
  }

  return contratos;
}

// Parse TCE-PB aditivos — formato de 264 chars
// UG(6) + Contrato(12) + AditivoNum(4) + AditivoAno(4) + DataRef(8) + Desc(var) + Valor(16) + NovaData(8) + Periodo(6)
function parseAditivos(texto) {
  // Extrai seção <aditivos>
  const match = texto.match(/<aditivos>([\s\S]*?)<\/aditivos>/);
  if (!match) return [];
  const body = match[1];
  const linhas = body.split('\n')
    .map(l => l.trim())
    .filter(l => l.length >= 255 && l.length <= 270 && /^\d{6}/.test(l));
  
  return linhas.map(linha => {
    const ug = linha.substring(0, 6).trim();
    const numContrato = linha.substring(6, 18).trim();
    const aditivoNum = linha.substring(18, 22).trim();
    const aditivoAno = linha.substring(22, 26).trim();
    const dataRefRaw = linha.substring(26, 34).trim();
    const descricao = linha.substring(34, linha.length - 30).trim();
    const valorStr = linha.substring(linha.length - 30, linha.length - 14).trim();
    const novaDataRaw = linha.substring(linha.length - 14, linha.length - 6).trim();
    const periodo = linha.substring(linha.length - 6).trim();

    const valor = parseFloat(valorStr) || 0;
    
    const dataRef = dataRefRaw.length === 8 ? `${dataRefRaw.substring(0,2)}/${dataRefRaw.substring(2,4)}/${dataRefRaw.substring(4,8)}` : dataRefRaw;
    const novaData = (novaDataRaw.length === 8 && novaDataRaw !== '00000000') 
      ? `${novaDataRaw.substring(0,2)}/${novaDataRaw.substring(2,4)}/${novaDataRaw.substring(4,8)}` : null;

    // Classificar tipo
    const descUpper = descricao.toUpperCase();
    const temProrrogacao = /PRORROGA|PRAZO|TEMPO|VIG.NCIA|VIGENCIA/i.test(descUpper);
    const temValor = /VALOR/i.test(descUpper) && valor > 0;

    return {
      ug,
      numero_contrato: numContrato,
      aditivo_numero: parseInt(aditivoNum),
      aditivo_ano: aditivoAno,
      data_referencia: dataRef,
      descricao,
      valor,
      nova_data: novaData,
      periodo,
      prorrogacao: temProrrogacao,
      acrescimo_valor: temValor
    };
  }).filter(a => a.ug && a.numero_contrato);
}

// Aplica aditivos aos contratos: atualiza data fim e valor
function aplicarAditivos(contratos, aditivos) {
  // Agrupa aditivos por contrato
  const aditivosPorContrato = {};
  aditivos.forEach(a => {
    if (!aditivosPorContrato[a.numero_contrato]) aditivosPorContrato[a.numero_contrato] = [];
    aditivosPorContrato[a.numero_contrato].push(a);
  });

  return contratos.map(c => {
    const aditivosContrato = aditivosPorContrato[c.numero_contrato] || [];
    if (aditivosContrato.length === 0) {
      return { ...c, aditivos: [], data_fim_original: c.fim, valor_original: c.valor };
    }

    // Ordenar aditivos por número (cronológico)
    aditivosContrato.sort((a, b) => a.aditivo_numero - b.aditivo_numero);

    // Aplicar cada aditivo em ordem
    let dataFimAtual = c.fim;
    let valorAtual = c.valor;
    const aditivosAplicados = [];

    aditivosContrato.forEach(a => {
      if (a.prorrogacao && a.nova_data) {
        dataFimAtual = a.nova_data; // Aditivo estende a data
        aditivosAplicados.push(`⏱️ Aditivo ${a.aditivo_numero}/${a.aditivo_ano} → ${a.nova_data}`);
      }
      if (a.acrescimo_valor) {
        valorAtual += a.valor;
        aditivosAplicados.push(`💰 Aditivo ${a.aditivo_numero}/${a.aditivo_ano} +R$ ${a.valor.toFixed(2)}`);
      }
    });

    return {
      ...c,
      aditivos: aditivosContrato,
      aditivos_resumo: aditivosAplicados,
      fim: dataFimAtual,           // Data atualizada
      data_fim_original: c.fim,     // Data original guardada
      valor: valorAtual,            // Valor atualizado
      valor_original: c.valor,      // Valor original guardado
      tem_aditivos: aditivosContrato.length > 0,
      qtd_aditivos: aditivosContrato.length
    };
  });
}

// Vincula empenhos aos contratos por CNPJ e busca semântica no histórico
// Retorna contratos enriquecidos com total_empenhado, saldo, confiança
async function vincularEmpenhos(contratos, ug, anoInicio, anoFim) {
  // Busca empenhos do período
  const result = await sagresQuery('/empenhos', ug, `${anoInicio}-01-01`, `${anoFim}-12-31`);
  const empenhos = result.records;
  
  if (!empenhos || empenhos.length === 0) return contratos;

  // Índice de empenhos por CPF/CNPJ normalizado para matching rápido
  const empenhosPorCNPJ = {};
  empenhos.forEach(e => {
    const docRaw = (e.cpfCnpjFornecedor || '').trim();
    if (docRaw) {
      // Normaliza: remove zeros à esquerda para comparação uniforme
      const docSig = docRaw.replace(/^0+/, '');
      if (!empenhosPorCNPJ[docSig]) empenhosPorCNPJ[docSig] = [];
      empenhosPorCNPJ[docSig].push(e);
    }
  });

  // Índice de empenhos por número de licitação
  const empenhosPorLicitacao = {};
  empenhos.forEach(e => {
    const lic = (e.licitacao && e.licitacao.numero || '').trim();
    if (lic && lic !== '000000000') {
      if (!empenhosPorLicitacao[lic]) empenhosPorLicitacao[lic] = [];
      empenhosPorLicitacao[lic].push(e);
    }
  });

  // Para cada contrato, busca empenhos vinculados
  return contratos.map(c => {
    const cnpjContrato = (c.cnpj_prestador || '').trim();
    const cnpjSig = cnpjContrato.replace(/^0+/, ''); // CPF ou CNPJ sem zeros à esquerda
    const numLicitacao = (c.numero_licitacao || '').trim();
    const numContratoSimples = c.numero_contrato.replace(/^0+/, '');
    const palavrasObjeto = extrairPalavrasChave(c.objeto || '');
    
    // Conjunto de empenhos candidatos (evita duplicatas)
    const candidatos = new Map();

    // 1. Matching por CPF/CNPJ
    // Ambos os lados já estão normalizados (sem zeros à esquerda)
    Object.entries(empenhosPorCNPJ).forEach(([doc, emps]) => {
      if (doc === cnpjSig) {
        emps.forEach(e => candidatos.set(e.numero + '-' + e.competencia, { empenho: e, origem: 'cnpj' }));
      }
    });

    // 2. Matching por licitação
    const empsLicit = empenhosPorLicitacao[numLicitacao] || [];
    empsLicit.forEach(e => {
      const key = e.numero + '-' + e.competencia;
      if (candidatos.has(key)) {
        candidatos.get(key).origem += '+licitacao';
      } else {
        candidatos.set(key, { empenho: e, origem: 'licitacao' });
      }
    });

    // 3. Matching por número do contrato no histórico
    empenhos.forEach(e => {
      const hist = (e.historico || '').toUpperCase();
      // Busca padrões como "CONTRATO N° 000XX/ANO" ou "CONTRATO N°XXXXX/ANO"
      const matchContrato = hist.match(/CONTRATO\s*N[°º]?\s*(\d+)/);
      if (matchContrato) {
        const numHist = matchContrato[1].replace(/^0+/, '');
        if (numHist === numContratoSimples) {
          const key = e.numero + '-' + e.competencia;
          if (candidatos.has(key)) {
            candidatos.get(key).origem += '+historico';
          } else {
            candidatos.set(key, { empenho: e, origem: 'historico' });
          }
        }
      }
    });

    // Converte Map para array e classifica
    const todosEmpenhos = Array.from(candidatos.values()).map(({ empenho, origem }) => {
      const hist = (empenho.historico || '').toUpperCase();
      const obj = (c.objeto || '').toUpperCase();
      
      // Busca semântica: quantas palavras-chave do objeto aparecem no histórico
      let palavrasEncontradas = 0;
      for (const palavra of palavrasObjeto) {
        if (palavra.length >= 4 && hist.includes(palavra)) {
          palavrasEncontradas++;
        }
      }
      const scoreSemantico = palavrasObjeto.length > 0 ? palavrasEncontradas / palavrasObjeto.length : 0;

      // Determina nível de confiança
      let confianca = 'baixa';
      let confiancaLabel = '🔶 Requer auditoria';
      let confiancaCor = '#eab308';

      const temCNPJ = origem.includes('cnpj');
      const temLicitacao = origem.includes('licitacao');
      const temHistorico = origem.includes('historico');
      const temKeyword = scoreSemantico >= 0.3;

      if (temCNPJ && (temHistorico || temLicitacao || temKeyword)) {
        confianca = 'alta';
        confiancaLabel = '✅ Confirmado';
        confiancaCor = '#22c55e';
      } else if (temCNPJ && !temHistorico && !temLicitacao && !temKeyword) {
        confianca = 'media';
        confiancaLabel = '⚠️ Requer auditoria';
        confiancaCor = '#f97316';
      } else if (!temCNPJ && (temHistorico || temLicitacao)) {
        confianca = 'media';
        confiancaLabel = '🔶 Requer auditoria';
        confiancaCor = '#eab308';
      }

      return {
        numero_empenho: empenho.numero,
        valor: empenho.valor,
        historico: (empenho.historico || '').substring(0, 120),
        competencia: empenho.competencia,
        cnpj: empenho.cpfCnpjFornecedor,
        origem_matching: origem,
        score_semantico: Math.round(scoreSemantico * 100) / 100,
        confianca,
        confianca_label: confiancaLabel,
        confianca_cor: confiancaCor
      };
    });

    // Separa: só conta no saldo se confiança alta (CNPJ + hist/lic/keyword)
    const empenhosVinculados = todosEmpenhos.filter(e => e.confianca === 'alta');
    const auditoria = todosEmpenhos.filter(e => e.confianca !== 'alta').map(e => {
      let motivo, motivo_desc;
      if (e.origem_matching.includes('cnpj') && e.score_semantico === 0) {
        motivo = 'score_zero';
        motivo_desc = 'Mesmo CPF/CNPJ, mas histórico do empenho diverge do objeto do contrato — nenhuma palavra-chave em comum';
      } else if (e.origem_matching.includes('cnpj') && e.score_semantico < 0.3) {
        motivo = 'score_baixo';
        motivo_desc = 'Mesmo CPF/CNPJ, mas score semântico insuficiente ('+e.score_semantico+') — poucas palavras-chave em comum no histórico';
      } else if (!e.origem_matching.includes('cnpj') && e.score_semantico > 0) {
        motivo = 'doc_diferente';
        motivo_desc = 'Histórico coincide parcialmente, mas CPF/CNPJ do empenho difere do contrato';
      } else if (!e.origem_matching.includes('cnpj') && e.score_semantico === 0) {
        motivo = 'doc_diferente_score_zero';
        motivo_desc = 'CPF/CNPJ diferente e histórico diverge do objeto do contrato';
      } else {
        motivo = 'requer_auditoria';
        motivo_desc = 'Correspondência insuficiente para consumo de saldo — requer validação manual';
      }
      return { ...e, motivo, motivo_desc };
    });

    // Calcula totais (só dos vinculados)
    const totalEmpenhado = empenhosVinculados.reduce((s, e) => s + (e.valor || 0), 0);
    const saldo = c.valor - totalEmpenhado;
    const saldoEstourado = saldo < 0;
    const menorConfianca = empenhosVinculados.length > 0 
      ? empenhosVinculados.reduce((min, e) => e.confianca === 'baixa' ? 'baixa' : min, 'alta')
      : null;

    return {
      ...c,
      empenhos: empenhosVinculados,
      total_empenhado: totalEmpenhado,
      qtd_empenhos: empenhosVinculados.length,
      auditoria: auditoria,
      qtd_auditoria: auditoria.length,
      saldo_contrato: saldo,
      saldo_estourado: saldoEstourado,
      ordenado_apartir: c.inicio,
      confianca_geral: menorConfianca || 'sem_empenhos'
    };
  });
}

// Extrai palavras-chave relevantes de um texto (remove artigos, preposições, etc.)
function extrairPalavrasChave(texto) {
  const stopwords = new Set([
    'para', 'com', 'sem', 'dos', 'das', 'dos', 'nas', 'nos', 'pela', 'pelo',
    'aos', 'a', 'ao', 'da', 'do', 'de', 'em', 'e', 'o', 'os', 'as', 'um', 'uma',
    'seu', 'sua', 'este', 'esta', 'esse', 'essa', 'que', 'por', 'na', 'no',
    'aquisicao', 'contratacao', 'aquisição', 'contratação', 'registro', 'preços', 'precos',
    'atender', 'necessidades', 'destinado', 'destinada', 'destinados', 'destinadas',
    'municipal', 'publica', 'publico', 'prefeitura', 'secretaria', 'diversas'
  ]);
  const palavras = texto.toUpperCase()
    .replace(/[^A-ZÀ-Ú0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(p => p.length >= 4 && !stopwords.has(p.toLowerCase()));
  return [...new Set(palavras)]; // Remove duplicatas
}

// Filtra registros SAGRES por mês
function filtrarPorMes(registros, ano, mes) {
  if (!mes) return registros;
  const mesStr = String(mes).padStart(2, '0');
  return registros.filter(r => {
    const data = r.data || r.dataEmpenho || r.dataLiquidacao || r.dataPagamento || r.dataReferencia || r.competencia || '';
    const dataStr = String(data);
    if (ano) return dataStr.startsWith(`${ano}-${mesStr}`);
    return dataStr.includes(`-${mesStr}-`);
  });
}

// Aplica ordenação e limite
function aplicarOrdenacaoLimite(arr, ordenar, limite, campoValor = 'valor') {
  let out = arr;
  if (ordenar === 'valor_desc') {
    out = [...out].sort((a, b) => (parseFloat(b[campoValor]) || 0) - (parseFloat(a[campoValor]) || 0));
  }
  if (limite && limite > 0) {
    out = out.slice(0, limite);
  }
  return out;
}

// Encontra registro de maior valor
function encontrarMaior(registros, campoValor = 'valor') {
  if (!registros || registros.length === 0) return null;
  let maior = registros[0];
  let maiorValor = parseFloat(maior[campoValor]) || 0;
  for (const r of registros) {
    const v = parseFloat(r[campoValor]) || 0;
    if (v > maiorValor) { maior = r; maiorValor = v; }
  }
  return {
    valor: maiorValor,
    historico: maior.historico || maior.descricao || maior.fornecedor || '',
    competencia: maior.competencia || maior.periodo || maior.data || maior.dataEmpenho || maior.dataLiquidacao || maior.dataPagamento || ''
  };
}

// ====== FERRAMENTAS DE CÁLCULO DETERMINÍSTICO ======
// 
// ARQUITETURA: Cálculo Determinístico vs. Probabilístico
//
// ┌─────────────────────────────────────────────────────────────────────┐
// │  BUSCA PROBABILÍSTICA (LLM)           BUSCA DETERMINÍSTICA (MATH)  │
// ├─────────────────────────────────────────────────────────────────────┤
// │  Aproximação estatística              Resultado exato e único      │
// │  Pode alucinar/inventar números       Zero tolerância a erro       │
// │  Depende do treinamento do modelo     Depende de hardware/CPU      │
// │  Ex: "qual o maior contrato?"         Ex: "some 1.234,56 + 567,89" │
// │  Margem de erro: variável             Margem de erro: 0%           │
// │  Usa heurísticas                      Usa aritmética formal        │
// └─────────────────────────────────────────────────────────────────────┘
//
// TÉCNICA: Precisão inteira (centavos)
// - Todo valor monetário é convertido para centavos (integer) antes da operação
// - Evita erros de ponto flutuante: 0.1 + 0.2 !== 0.3 em IEEE 754
// - Resultado é convertido de volta para reais SOMENTE na saída
//
// REGRAS PARA O AGENTE:
// 1. NUNCA faça contas "de cabeça" ou com JavaScript no frontend
// 2. SEMPRE use estes endpoints para QUALQUER operação numérica
// 3. O resultado retornado é a VERDADE ABSOLUTA
// 4. Se precisar de uma operação não listada, solicite ao usuário

// Converte valor para centavos (inteiro) — aceita string ou number
// Lida com formatos: 1234.56 (US), 1.234,56 (BR), R$ 1.234,56, 1500
function paraCentavos(valor) {
  let s = String(valor).replace(/[R$\s]/g, '').trim();
  if (!s) return 0;
  // Se tem vírgula → formato brasileiro: 1.234,56 → remove pontos, troca vírgula por ponto
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  const v = parseFloat(s);
  if (isNaN(v)) return 0;
  return Math.round(v * 100);
}

// Converte centavos para reais (string formatada)
function deCentavos(centavos) {
  return (centavos / 100).toFixed(2);
}

// ====== ENDPOINTS DE CÁLCULO DETERMINÍSTICO ======

// SOMA: /api/calcular/soma?v=100&v=200&v=350.50
// ou POST com { valores: [100, 200, 350.50] }
app.get('/api/calcular/soma', (req, res) => {
  const valores = [].concat(req.query.v || []);
  const cents = valores.map(v => paraCentavos(v));
  const total = cents.reduce((a, b) => a + b, 0);
  res.json({
    operacao: 'soma',
    parcelas: valores.map(v => parseFloat(v)),
    total_centavos: total,
    total_reais: deCentavos(total),
    total_formatado: `R$ ${deCentavos(total).replace('.', ',')}`,
    deterministico: true,
    tecnica: 'precisao_inteira_centavos'
  });
});

app.post('/api/calcular/soma', (req, res) => {
  const valores = req.body.valores || [];
  const cents = valores.map(v => paraCentavos(v));
  const total = cents.reduce((a, b) => a + b, 0);
  res.json({
    operacao: 'soma',
    parcelas: valores,
    total_centavos: total,
    total_reais: deCentavos(total),
    total_formatado: `R$ ${deCentavos(total).replace('.', ',')}`,
    deterministico: true
  });
});

// MÉDIA: /api/calcular/media?v=100&v=200&v=300
app.get('/api/calcular/media', (req, res) => {
  const valores = [].concat(req.query.v || []);
  const cents = valores.map(v => paraCentavos(v));
  if (cents.length === 0) return res.status(400).json({ erro: 'Nenhum valor informado' });
  const soma = cents.reduce((a, b) => a + b, 0);
  const media = Math.round(soma / cents.length);
  res.json({
    operacao: 'media',
    quantidade: cents.length,
    soma_centavos: soma,
    media_centavos: media,
    media_reais: deCentavos(media),
    media_formatada: `R$ ${deCentavos(media).replace('.', ',')}`,
    deterministico: true
  });
});

// DIVISÃO: /api/calcular/dividir?dividendo=1000&divisor=3&casas=2
app.get('/api/calcular/dividir', (req, res) => {
  const dividendo = parseFloat(req.query.dividendo || 0);
  const divisor = parseFloat(req.query.divisor || 1);
  const casas = parseInt(req.query.casas) || 2;
  if (divisor === 0) return res.status(400).json({ erro: 'Divisão por zero' });
  const dCents = paraCentavos(dividendo);
  const resultado = dCents / divisor;
  const arredondado = Math.round(resultado * Math.pow(10, casas)) / Math.pow(10, casas);
  res.json({
    operacao: 'divisao',
    dividendo, divisor,
    resultado_exato: deCentavos(Math.round(resultado)),
    resultado_centavos: Math.round(resultado),
    resultado_reais: deCentavos(Math.round(resultado)),
    resultado_formatado: `R$ ${deCentavos(Math.round(resultado)).replace('.', ',')}`,
    deterministico: true
  });
});

// PERCENTUAL: /api/calcular/percentual?valor=500&total=2000
app.get('/api/calcular/percentual', (req, res) => {
  const valor = parseFloat(req.query.valor || 0);
  const total = parseFloat(req.query.total || 1);
  if (total === 0) return res.status(400).json({ erro: 'Total zero' });
  const percentual = (valor / total) * 100;
  res.json({
    operacao: 'percentual',
    valor, total,
    percentual: Math.round(percentual * 100) / 100,
    percentual_formatado: `${(Math.round(percentual * 100) / 100).toFixed(2).replace('.', ',')}%`,
    deterministico: true
  });
});

// DIFERENÇA: /api/calcular/diferenca?a=1000&b=300
app.get('/api/calcular/diferenca', (req, res) => {
  const a = parseFloat(req.query.a || 0);
  const b = parseFloat(req.query.b || 0);
  const aCents = paraCentavos(a);
  const bCents = paraCentavos(b);
  const diff = aCents - bCents;
  res.json({
    operacao: 'diferenca',
    valor_a: a, valor_b: b,
    diferenca_centavos: Math.abs(diff),
    diferenca_reais: deCentavos(Math.abs(diff)),
    diferenca_formatada: `R$ ${deCentavos(Math.abs(diff)).replace('.', ',')}`,
    maior: diff >= 0 ? 'a' : 'b',
    deterministico: true
  });
});

// VALIDAÇÃO: /api/calcular/validar?calculado=1500&esperado=1499.99
// Útil para verificar se o LLM não alucinou um valor
app.get('/api/calcular/validar', (req, res) => {
  const calculado = parseFloat(req.query.calculado || 0);
  const esperado = parseFloat(req.query.esperado || 0);
  const calcCents = paraCentavos(calculado);
  const espCents = paraCentavos(esperado);
  const diff = Math.abs(calcCents - espCents);
  res.json({
    operacao: 'validacao',
    valor_calculado: calculado,
    valor_esperado: esperado,
    centavos_calculado: calcCents,
    centavos_esperado: espCents,
    corresponde: diff === 0,
    diferenca_centavos: diff,
    diferenca_reais: deCentavos(diff),
    mensagem: diff === 0 
      ? '✅ VALOR CONFIRMADO — correspondência exata' 
      : `❌ DIVERGÊNCIA — diferença de R$ ${deCentavos(diff).replace('.', ',')}`,
    deterministico: true
  });
});

// LISTAR TODAS AS OPERAÇÕES DISPONÍVEIS
app.get('/api/calcular', (req, res) => {
  res.json({
    titulo: '🧮 API de Cálculos Determinísticos',
    descricao: 'Operações com precisão de centavos (inteiro). Zero alucinação.',
    tecnica: 'Precisão inteira — tudo em centavos antes de operar',
    deterministico: true,
    operacoes: {
      soma: {
        metodo: 'GET /api/calcular/soma?v=100&v=200&v=350.50',
        descricao: 'Soma exata de valores. Use para totalizar empenhos, pagamentos, etc.'
      },
      media: {
        metodo: 'GET /api/calcular/media?v=100&v=200&v=300',
        descricao: 'Média aritmética exata (arredondada para centavos)'
      },
      divisao: {
        metodo: 'GET /api/calcular/dividir?dividendo=1000&divisor=3',
        descricao: 'Divisão exata usando centavos como base'
      },
      percentual: {
        metodo: 'GET /api/calcular/percentual?valor=500&total=2000',
        descricao: 'Percentual exato (valor / total * 100)'
      },
      diferenca: {
        metodo: 'GET /api/calcular/diferenca?a=1000&b=300',
        descricao: 'Diferença absoluta entre dois valores'
      },
      validacao: {
        metodo: 'GET /api/calcular/validar?calculado=1500&esperado=1499.99',
        descricao: 'Valida se um valor calculado corresponde ao esperado (detecta alucinação)'
      }
    }
  });
});

// Resolve período baseado em ano informado ou default
function resolverPeriodo(ano, defaultIni, defaultFim) {
  if (ano) {
    return { dataMinima: `${ano}-01-01`, dataMaxima: `${ano}-12-31` };
  }
  return { dataMinima: defaultIni, dataMaxima: defaultFim };
}

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Lista de entidades TCE-PB
app.get('/api/entidades', (req, res) => {
  const { q } = req.query;
  let result = ENTIDADES;
  if (q) {
    const query = q.toLowerCase().trim();
    result = ENTIDADES.filter(e => 
      e.codigo.includes(query) || 
      e.nome.toLowerCase().includes(query) ||
      e.cidade.toLowerCase().includes(query) ||
      e.tipo.toLowerCase().includes(query)
    );
  }
  res.json({ total: result.length, entidades: result });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'), (err) => {
    if (err) res.status(500).send('Frontend not found');
  });
});

// List consultas for a UG
app.get('/api/consultas/:ug', (req, res) => {
  res.json({
    ug: req.params.ug,
    consultas: [
      { id: 'despesas', nome: '\ud83d\udcb0 Despesas', fonte: 'SAGRES' },
      { id: 'receitas', nome: '\ud83d\udcc8 Receitas', fonte: 'SAGRES' },
      { id: 'empenhos', nome: '\ud83d\udcc4 Empenhos', fonte: 'SAGRES' },
      { id: 'liquidacoes', nome: '\u2705 Liquida\u00e7\u00f5es', fonte: 'SAGRES' },
      { id: 'pagamentos', nome: '\ud83d\udcb5 Pagamentos', fonte: 'SAGRES' },
      { id: 'restos_pagar', nome: '\ud83d\udccb Restos a Pagar', fonte: 'SAGRES' },
      { id: 'contratos', nome: '\ud83e\udd1d Contratos (TCE-PB)', fonte: 'TCE-PB', sem_token: true },
      { id: 'licitacoes', nome: '\ud83c\udfdb\ufe0f Licita\u00e7\u00f5es', fonte: 'TCE-PB' },
      { id: 'pessoal', nome: '\ud83d\udc64 Pessoal', fonte: 'SAGRES' },
    ]
  });
});

// Main consult endpoint
app.get('/api/consultar/:ug/:tipo', async (req, res) => {
  const { ug, tipo } = req.params;
  const ano = req.query.ano ? String(req.query.ano) : null;
  const mes = req.query.mes ? String(req.query.mes).padStart(2, '0') : null;
  const ordenar = req.query.ordenar || null;
  const limite = req.query.limite ? parseInt(req.query.limite, 10) : null;

  try {
    switch (tipo) {
      // --- DESPESAS → SAGRES empenhos ---
      case 'despesas': {
        const { dataMinima, dataMaxima } = resolverPeriodo(ano, '2025-01-01', '2026-12-31');
        const result = await sagresQuery('/empenhos', ug, dataMinima, dataMaxima);
        const registros = filtrarPorMes(result.records, ano, mes);
        const total = registros.length;
        const valorTotal = registros.reduce((s, r) => s + (parseFloat(r.valor) || 0), 0);
        const maior = encontrarMaior(registros);
        const dados = aplicarOrdenacaoLimite(registros, ordenar, limite || 200);
        const erroMsg = result.errors.length ? ` (${result.errors.length} meses com erro)` : '';
        return res.json({
          status: 'ok', ug, tipo, fonte: 'SAGRES',
          ano, mes, ordenar, limite,
          total, valorTotal, maior,
          dados,
          msg: `${total} registros encontrados (${dataMinima} a ${dataMaxima})${erroMsg}`
        });
      }

      // --- EMPENHOS → SAGRES empenhos ---
      case 'empenhos': {
        const { dataMinima, dataMaxima } = resolverPeriodo(ano, '2025-01-01', '2026-12-31');
        const result = await sagresQuery('/empenhos', ug, dataMinima, dataMaxima);
        const registros = filtrarPorMes(result.records, ano, mes);
        const total = registros.length;
        const valorTotal = registros.reduce((s, r) => s + (parseFloat(r.valor) || 0), 0);
        const maior = encontrarMaior(registros);
        const dados = aplicarOrdenacaoLimite(registros, ordenar, limite || 200);
        return res.json({
          status: 'ok', ug, tipo, fonte: 'SAGRES',
          ano, mes, ordenar, limite,
          total, valorTotal, maior,
          dados,
          msg: `${total} empenhos encontrados (${dataMinima} a ${dataMaxima})`
        });
      }

      // --- LIQUIDAÇÕES → SAGRES liquidacoes ---
      case 'liquidacoes': {
        const { dataMinima, dataMaxima } = resolverPeriodo(ano, '2025-01-01', '2026-12-31');
        const result = await sagresQuery('/liquidacoes', ug, dataMinima, dataMaxima);
        const registros = filtrarPorMes(result.records, ano, mes);
        const total = registros.length;
        const valorTotal = registros.reduce((s, r) => s + (parseFloat(r.valor) || 0), 0);
        const maior = encontrarMaior(registros);
        const dados = aplicarOrdenacaoLimite(registros, ordenar, limite || 200);
        return res.json({
          status: 'ok', ug, tipo, fonte: 'SAGRES',
          ano, mes, ordenar, limite,
          total, valorTotal, maior,
          dados,
          msg: `${total} liquidações encontradas (${dataMinima} a ${dataMaxima})`
        });
      }

      // --- PAGAMENTOS → SAGRES pagamentos ---
      case 'pagamentos': {
        const { dataMinima, dataMaxima } = resolverPeriodo(ano, '2025-01-01', '2026-12-31');
        const result = await sagresQuery('/pagamentos', ug, dataMinima, dataMaxima);
        const registros = filtrarPorMes(result.records, ano, mes);
        const total = registros.length;
        const valorTotal = registros.reduce((s, r) => s + (parseFloat(r.valor) || 0), 0);
        const maior = encontrarMaior(registros);
        const dados = aplicarOrdenacaoLimite(registros, ordenar, limite || 200);
        return res.json({
          status: 'ok', ug, tipo, fonte: 'SAGRES',
          ano, mes, ordenar, limite,
          total, valorTotal, maior,
          dados,
          msg: `${total} pagamentos encontrados (${dataMinima} a ${dataMaxima})`
        });
      }

      // --- RESTOS A PAGAR → SAGRES empenhos filtrando por 'resto' ---
      case 'restos_pagar': {
        const { dataMinima, dataMaxima } = resolverPeriodo(ano, '2024-01-01', '2025-12-31');
        const result = await sagresQuery('/empenhos', ug, dataMinima, dataMaxima);
        let restos = result.records.filter(r => {
          const h = (r.historico || r.descricao || '').toLowerCase();
          return h.includes('resto');
        });
        restos = filtrarPorMes(restos, ano, mes);
        const total = restos.length;
        const valorTotal = restos.reduce((s, r) => s + (parseFloat(r.valor) || 0), 0);
        const maior = encontrarMaior(restos);
        const dados = aplicarOrdenacaoLimite(restos, ordenar, limite || 200);
        return res.json({
          status: 'ok', ug, tipo, fonte: 'SAGRES',
          ano, mes, ordenar, limite,
          total, valorTotal, maior,
          dados,
          msg: `${total} restos a pagar encontrados (${dataMinima} a ${dataMaxima})`
        });
      }

      // --- CONTRATOS (TCE-PB GESTOR) ---
      case 'contratos': {
        const raw = await httpsGet(GESTOR_BASE,
          '/tramita/exportar_licitacoes.jsp?codigo=' + ug + '&ci=052024&cf=122026&tipo=1',
          { 'User-Agent': 'curl/8.14.1' }
        );
        let contratos = parseContratosTCE(raw);
        if (ano) {
          contratos = contratos.filter(c => {
            const p = String(c.periodo || '');
            return p.length >= 4 && p.slice(-4) === String(ano);
          });
        }
        if (mes) {
          contratos = contratos.filter(c => {
            const p = String(c.periodo || '');
            const m = String(mes).padStart(2, '0');
            return p.startsWith(m);
          });
        }
        const total = contratos.length;
        const valorTotal = contratos.reduce((s, c) => s + c.valor, 0);
        const maior = encontrarMaior(contratos);
        const dados = aplicarOrdenacaoLimite(contratos, ordenar, limite || 500);
        return res.json({
          status: 'ok', ug, tipo, fonte: 'TCE-PB Gestor',
          ano, mes, ordenar, limite,
          total, valorTotal, maior,
          contratos: dados
        });
      }

      // --- LICITAÇÕES (TCE-PB GESTOR) ---
      case 'licitacoes': {
        try {
          const raw = await httpsGet(GESTOR_BASE,
            '/tramita/exportar_licitacoes.jsp?codigo=' + ug + '&ci=012024&cf=122026&tipo=2',
            { 'User-Agent': 'curl/8.14.1' }
          );
          let linhas = raw.split('\n').filter(l => l.trim().length > 10);
          const lim = limite && limite > 0 ? limite : 200;
          linhas = linhas.slice(0, lim);
          return res.json({
            status: 'ok', ug, tipo, fonte: 'TCE-PB Gestor',
            ano, mes, ordenar, limite,
            total: linhas.length,
            dados: linhas
          });
        } catch (e) {
          // Fallback: contratos como licitacoes
          const raw = await httpsGet(GESTOR_BASE,
            '/tramita/exportar_licitacoes.jsp?codigo=' + ug + '&ci=052024&cf=122026&tipo=1',
            { 'User-Agent': 'curl/8.14.1' }
          );
          let contratos = parseContratosTCE(raw);
          if (ano) {
            contratos = contratos.filter(c => String(c.periodo || '').includes(ano));
          }
          if (mes) {
            contratos = contratos.filter(c => {
              const p = String(c.periodo || '');
              const m = String(c.mes_ref || '');
              return p.includes(mes) || m.includes(mes);
            });
          }
          const total = contratos.length;
          const valorTotal = contratos.reduce((s, c) => s + c.valor, 0);
          const maior = encontrarMaior(contratos);
          const dados = aplicarOrdenacaoLimite(contratos, ordenar, limite || 200);
          return res.json({
            status: 'ok', ug, tipo, fonte: 'TCE-PB Gestor (contratos)',
            ano, mes, ordenar, limite,
            total, valorTotal, maior,
            dados
          });
        }
      }

      // --- RECEITAS (em breve) ---
      case 'receitas':
        return res.json({ status: 'ok', ug, tipo, fonte: 'SAGRES', ano, mes, ordenar, limite, total: 0, valorTotal: 0, maior: null, dados: [], msg: '\u26a0\ufe0f Consulta de receitas dispon\u00edvel em breve' });

      // --- PESSOAL (em breve) ---
      case 'pessoal':
        return res.json({ status: 'ok', ug, tipo, fonte: 'SAGRES', ano, mes, ordenar, limite, total: 0, valorTotal: 0, maior: null, dados: [], msg: '\u26a0\ufe0f Consulta de pessoal dispon\u00edvel em breve' });

      default:
        return res.status(404).json({ status: 'error', msg: `Tipo "${tipo}" n\u00e3o implementado` });
    }
  } catch (err) {
    console.error(`Erro consulta ${tipo}/${ug}:`, err.message);
    return res.status(500).json({ status: 'error', msg: err.message });
  }
});

// Generic SAGRES proxy
app.post('/api/sagres', async (req, res) => {
  const { endpoint, params } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
  try {
    const raw = await httpsGet(SAGRES_BASE, `/api/v1${endpoint}?${new URLSearchParams(params || {}).toString()}`, { 'AuthToken': SAGRES_KEY });
    res.json({ success: true, data: JSON.parse(raw) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ====== MONITORAMENTO DE CONTRATOS ======
// Dashboard de contratos próximos ao vencimento
// Ordena por: expirados > vencendo em 30d > vencendo em 60d > vigentes

app.get('/api/monitorar/contratos/:ug', async (req, res) => {
  const { ug } = req.params;
  const diasAlerta = parseInt(req.query.dias) || 90;
  const anoInicio = req.query.ano_inicio || '2024';
  const anoFim = req.query.ano_fim || '2026';

  try {
    const raw = await httpsGet(GESTOR_BASE,
      `/tramita/exportar_licitacoes.jsp?codigo=${ug}&ci=01${anoInicio}&cf=12${anoFim}&tipo=1`,
      { 'User-Agent': 'curl/8.14.1' }
    );
    let contratos = parseContratosTCE(raw);
    
    // Parse e aplica aditivos (prorrogações e acréscimos)
    const aditivos = parseAditivos(raw);
    contratos = aplicarAditivos(contratos, aditivos);

    // Vincula empenhos aos contratos
    try {
      contratos = await vincularEmpenhos(contratos, ug, anoInicio, anoFim);
    } catch (e) {
      console.error('Erro ao vincular empenhos (continuando sem):', e.message);
    }

    const hoje = new Date();
    hoje.setHours(0,0,0,0);

    // Enriquecer com dados de monitoramento
    const monitorados = contratos.map(c => {
      // Parse das datas DD/MM/YYYY
      let dataFim = null;
      if (c.fim && c.fim.length === 10) {
        const partes = c.fim.split('/');
        dataFim = new Date(parseInt(partes[2]), parseInt(partes[1]) - 1, parseInt(partes[0]));
      }
      
      let diasRestantes = null;
      let status = 'indefinido';
      let statusLabel = 'Sem data';
      let statusCor = '#6b7280';

      if (dataFim && !isNaN(dataFim.getTime())) {
        dataFim.setHours(0,0,0,0);
        diasRestantes = Math.round((dataFim - hoje) / (1000 * 60 * 60 * 24));
        
        if (diasRestantes < 0) {
          status = 'expirado';
          statusLabel = `⚠️ Vencido há ${Math.abs(diasRestantes)} dias`;
          statusCor = '#ef4444';
        } else if (diasRestantes === 0) {
          status = 'vence_hoje';
          statusLabel = '🚨 Vence HOJE!';
          statusCor = '#ef4444';
        } else if (diasRestantes <= 15) {
          status = 'critico';
          statusLabel = `🚨 Vence em ${diasRestantes} dias`;
          statusCor = '#f97316';
        } else if (diasRestantes <= 30) {
          status = 'urgente';
          statusLabel = `🔶 Vence em ${diasRestantes} dias`;
          statusCor = '#eab308';
        } else if (diasRestantes <= 60) {
          status = 'atencao';
          statusLabel = `🟡 Vence em ${diasRestantes} dias`;
          statusCor = '#84cc16';
        } else {
          status = 'vigente';
          statusLabel = `✅ Vigente (${diasRestantes} dias)`;
          statusCor = '#22c55e';
        }
      }

      // Parse data de início para exibição
      let dataInicio = null;
      if (c.inicio && c.inicio.length === 10) {
        const partes = c.inicio.split('/');
        dataInicio = new Date(parseInt(partes[2]), parseInt(partes[1]) - 1, parseInt(partes[0]));
      }

      return {
        ...c,
        data_fim_iso: dataFim ? dataFim.toISOString().split('T')[0] : null,
        data_inicio_iso: dataInicio ? dataInicio.toISOString().split('T')[0] : null,
        dias_restantes: diasRestantes,
        status,
        status_label: statusLabel,
        status_cor: statusCor
      };
    });

    // Ordenar: expirados primeiro (mais recentes), depois próximos ao vencimento
    monitorados.sort((a, b) => {
      const ordemStatus = { expirado: 0, vence_hoje: 1, critico: 2, urgente: 3, atencao: 4, vigente: 5, indefinido: 6 };
      const oa = ordemStatus[a.status] ?? 99;
      const ob = ordemStatus[b.status] ?? 99;
      if (oa !== ob) return oa - ob;
      // Dentro do mesmo status, ordenar por data fim (mais próxima primeiro)
      if (a.dias_restantes !== null && b.dias_restantes !== null) return a.dias_restantes - b.dias_restantes;
      return 0;
    });

    // Estatísticas
    const stats = {
      total: monitorados.length,
      expirados: monitorados.filter(c => c.status === 'expirado').length,
      vence_hoje: monitorados.filter(c => c.status === 'vence_hoje').length,
      critico: monitorados.filter(c => c.status === 'critico').length,
      urgente: monitorados.filter(c => c.status === 'urgente').length,
      atencao: monitorados.filter(c => c.status === 'atencao').length,
      vigentes: monitorados.filter(c => c.status === 'vigente').length,
      valor_total: monitorados.reduce((s, c) => s + c.valor, 0),
      alertas: monitorados.filter(c => ['expirado','vence_hoje','critico','urgente'].includes(c.status)).length,
      com_aditivos: monitorados.filter(c => c.tem_aditivos).length
    };

    // Limite
    const limite = req.query.limite ? parseInt(req.query.limite) : null;
    const dados = limite ? monitorados.slice(0, limite) : monitorados;

    res.json({
      status: 'ok',
      ug,
      data_consulta: hoje.toISOString().split('T')[0],
      dias_alerta: diasAlerta,
      estatisticas: stats,
      contratos: dados
    });

  } catch (err) {
    console.error('Erro monitoramento contratos:', err.message);
    res.status(500).json({ status: 'error', msg: err.message });
  }
});

// Rota do dashboard HTML
app.get('/monitorar', (req, res) => {
  const ug = req.query.ug || '201115';
  res.sendFile(path.join(__dirname, 'monitorar.html'), (err) => {
    if (err) res.status(500).send('Dashboard não encontrado');
  });
});
function loadTasks() { try { if (fs.existsSync(TASKS_FILE)) return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')); } catch(e) {} return []; }
function saveTasks(t) { fs.writeFileSync(TASKS_FILE, JSON.stringify(t, null, 2)); }

app.post('/api/tarefas', (req, res) => {
  const { ug, consulta, nome, descricao, schedule, schedule_type } = req.body;
  if (!ug || !nome) return res.status(400).json({ error: 'ug e nome são obrigatórios' });
  const task = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ug, consulta: consulta || 'custom', nome, descricao: descricao || '',
    schedule: schedule || null, schedule_type: schedule_type || 'once',
    created_at: new Date().toISOString(), status: 'pending'
  };
  const tasks = loadTasks(); tasks.push(task); saveTasks(tasks);
  res.json({ status: 'ok', tarefa: task });
});

app.get('/api/tarefas', (req, res) => {
  let tasks = loadTasks();
  if (req.query.status) tasks = tasks.filter(t => t.status === req.query.status);
  res.json(tasks);
});

app.get('/api/tarefas/:id', (req, res) => {
  const tasks = loadTasks();
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Tarefa não encontrada' });
  res.json(task);
});

app.post('/api/tarefas/:id/status', (req, res) => {
  if (!req.body.status) return res.status(400).json({ error: 'status required' });
  const tasks = loadTasks();
  const idx = tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });
  tasks[idx].status = req.body.status;
  saveTasks(tasks);
  res.json({ success: true, tarefa: tasks[idx] });
});

app.post('/api/tarefas/:id/schedule', (req, res) => {
  const tasks = loadTasks();
  const idx = tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });
  tasks[idx].schedule = req.body.cron_expr || tasks[idx].schedule;
  tasks[idx].schedule_type = req.body.schedule_type || tasks[idx].schedule_type;
  saveTasks(tasks);
  res.json({ success: true, tarefa: tasks[idx] });
});

// Legacy endpoints
app.post('/api/task', (req, res) => {
  const { agent, ug, query } = req.body;
  const task = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    agent, ug, query, timestamp: new Date().toISOString(), status: 'pending'
  };
  const tasks = loadTasks(); tasks.push(task); saveTasks(tasks);
  res.json({ success: true, task_id: task.id });
});
app.get('/api/tasks', (req, res) => { res.json(loadTasks().filter(t => t.status === 'pending')); });
app.post('/api/tasks/:id/done', (req, res) => {
  const tasks = loadTasks();
  const idx = tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });
  tasks[idx].status = 'done'; saveTasks(tasks);
  res.json({ success: true });
});

// =============================================
// CENTRAL DE NOTIFICAÇÕES - WHATSAPP
// =============================================

// Helpers para persistência
function loadContatos() {
  try {
    if (!fs.existsSync(NOTIFICACOES_FILE)) {
      const inicial = { gestor: [], fornecedor: [], cpl: [] };
      fs.writeFileSync(NOTIFICACOES_FILE, JSON.stringify(inicial, null, 2));
      return inicial;
    }
    return JSON.parse(fs.readFileSync(NOTIFICACOES_FILE, 'utf8'));
  } catch(e) { return { gestor: [], fornecedor: [], cpl: [] }; }
}
function saveContatos(data) {
  fs.writeFileSync(NOTIFICACOES_FILE, JSON.stringify(data, null, 2));
}

// Gera ID único
function novoId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Envio WhatsApp (placeholder — registra no log)
async function enviarWhatsApp(telefone, mensagem, modulo, tipo, ug, contrato) {
  const entry = {
    timestamp: new Date().toISOString(),
    destino: telefone,
    modulo,
    tipo,
    ug,
    contrato: contrato || null,
    mensagem,
    canal: 'whatsapp',
    status: 'pending'
  };
  console.log(`[WHATSAPP] Para ${telefone} (${modulo}/${tipo}): ${mensagem.substring(0, 80)}...`);
  
  // Tenta enviar via Meta Cloud API se configurado
  const metaToken = process.env.META_WHATSAPP_TOKEN;
  const metaPhoneId = process.env.META_WHATSAPP_PHONE_ID;
  if (metaToken && metaPhoneId) {
    try {
      await httpsPost('graph.facebook.com', `/v21.0/${metaPhoneId}/messages`, {
        messaging_product: 'whatsapp',
        to: telefone.replace(/\D/g, ''),
        type: 'text',
        text: { body: mensagem }
      }, {
        'Authorization': `Bearer ${metaToken}`,
        'Content-Type': 'application/json'
      });
      entry.status = 'enviado';
      console.log(`[WHATSAPP] ✅ Enviado para ${telefone}`);
    } catch(e) {
      entry.status = 'erro';
      entry.erro = e.message;
      console.log(`[WHATSAPP] ❌ Erro: ${e.message}`);
    }
  } else {
    console.log(`[WHATSAPP] 📝 Meta Cloud API não configurada. Envio simulado.`);
    entry.status = 'simulado';
  }
  
  // Persiste log
  try {
    let log = [];
    if (fs.existsSync(WHATSAPP_LOG_FILE)) {
      log = JSON.parse(fs.readFileSync(WHATSAPP_LOG_FILE, 'utf8'));
    }
    log.unshift(entry);
    if (log.length > 500) log = log.slice(0, 500);
    fs.writeFileSync(WHATSAPP_LOG_FILE, JSON.stringify(log, null, 2));
  } catch(e) {}
  return entry;
}

// Envio Telegram via Bot API
async function enviarTelegram(chatId, mensagem, modulo, tipo, ug, contrato) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const entry = {
    timestamp: new Date().toISOString(),
    destino: `Telegram:${chatId}`,
    modulo, tipo, ug, contrato: contrato || null,
    mensagem, canal: 'telegram', status: 'pending'
  };
  
  if (!botToken) {
    console.log(`[TELEGRAM] ⚠️ TELEGRAM_BOT_TOKEN não configurado.`);
    entry.status = 'sem_token';
    logNotificacao(entry);
    return entry;
  }
  
  try {
    // Escapa markdown do Telegram
    const texto = mensagem.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
    const data = JSON.stringify({
      chat_id: chatId,
      text: texto,
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true
    });
    await httpsPost('api.telegram.org', `/bot${botToken}/sendMessage`, data, {
      'Content-Type': 'application/json'
    });
    entry.status = 'enviado';
    console.log(`[TELEGRAM] ✅ Enviado para chat ${chatId}`);
  } catch(e) {
    entry.status = 'erro';
    entry.erro = e.message;
    console.log(`[TELEGRAM] ❌ Erro: ${e.message}`);
  }
  logNotificacao(entry);
  return entry;
}

// Envio Discord via Webhook
async function enviarDiscord(webhookUrl, mensagem, modulo, tipo, ug, contrato) {
  const entry = {
    timestamp: new Date().toISOString(),
    destino: `Discord webhook`,
    modulo, tipo, ug, contrato: contrato || null,
    mensagem, canal: 'discord', status: 'pending'
  };
  
  if (!webhookUrl || !webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
    console.log(`[DISCORD] ⚠️ Webhook URL inválida ou não configurada.`);
    entry.status = 'sem_webhook';
    logNotificacao(entry);
    return entry;
  }
  
  try {
    const url = new URL(webhookUrl);
    const data = JSON.stringify({
      content: mensagem,
      username: `🔔 Monitor de Contratos - ${modulo.toUpperCase()}`,
      avatar_url: 'https://i.imgur.com/4M34hi2.png'
    });
    await httpsPost(url.hostname, url.pathname + url.search, data, {
      'Content-Type': 'application/json'
    });
    entry.status = 'enviado';
    console.log(`[DISCORD] ✅ Enviado para webhook`);
  } catch(e) {
    entry.status = 'erro';
    entry.erro = e.message;
    console.log(`[DISCORD] ❌ Erro: ${e.message}`);
  }
  logNotificacao(entry);
  return entry;
}

// Helper: log notificação
function logNotificacao(entry) {
  try {
    let log = [];
    if (fs.existsSync(WHATSAPP_LOG_FILE)) {
      log = JSON.parse(fs.readFileSync(WHATSAPP_LOG_FILE, 'utf8'));
    }
    log.unshift(entry);
    if (log.length > 500) log = log.slice(0, 500);
    fs.writeFileSync(WHATSAPP_LOG_FILE, JSON.stringify(log, null, 2));
  } catch(e) {}
}

// Helper: HTTPS POST
function httpsPost(hostname, path, data, headers) {
  return new Promise((resolve, reject) => {
    const postData = typeof data === 'string' ? data : JSON.stringify(data);
    const defaultHeaders = typeof data === 'string' ? headers || {} : { 'Content-Type': 'application/json', ...(headers || {}) };
    const opts = {
      hostname, path,
      method: 'POST',
      headers: {
        'Content-Length': Buffer.byteLength(postData),
        ...defaultHeaders
      }
    };
    const req = https.request(opts, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Gera mensagem conforme tipo de notificação
function gerarMensagem(tipo, contrato, ug) {
  const statusMap = {
    expirado: '⚠️ VENCIDO',
    critico: '🔴 CRÍTICO (≤15 dias)',
    urgente: '🟠 URGENTE (≤30 dias)',
    atencao: '🟡 ATENÇÃO (≤60 dias)',
    vigente: '✅ Vigente'
  };
  const c = contrato;
  const statusLabel = statusMap[c.status] || c.status;
  const saldo = c.saldo_contrato !== undefined ? c.saldo_contrato : c.valor;
  
  switch(tipo) {
    case 'prazo_vencimento':
      return `📅 *PRAZO PRÓXIMO* - Contrato #${c.numero_contrato}\\n` +
        `UG: ${ug}\\n` +
        `Objeto: ${(c.objeto||'').substring(0, 60)}...\\n` +
        `Vencimento: ${c.fim || '-'} (${c.dias_restantes !== null ? c.dias_restantes + ' dias' : 'sem data'})\\n` +
        `Status: ${statusLabel}\\n` +
        `Valor: R$ ${(c.valor||0).toFixed(2)}`;
    case 'saldo_estourado':
      return `🚨 *SALDO ESTOURADO* - Contrato #${c.numero_contrato}\\n` +
        `UG: ${ug}\\n` +
        `Contratado: R$ ${(c.valor||0).toFixed(2)}\\n` +
        `Consumido: R$ ${((c.valor||0) - saldo).toFixed(2)}\\n` +
        `Estouro: R$ ${Math.abs(saldo).toFixed(2)}\\n` +
        `Objeto: ${(c.objeto||'').substring(0, 60)}...`;
    case 'saldo_restante':
      const pct = c.valor > 0 ? ((saldo / c.valor) * 100).toFixed(1) : '0';
      return `💰 *SALDO RESTANTE* - Contrato #${c.numero_contrato}\\n` +
        `UG: ${ug}\\n` +
        `Restante: R$ ${(saldo||0).toFixed(2)} (${pct}%)\\n` +
        `Valor total: R$ ${(c.valor||0).toFixed(2)}\\n` +
        `Vencimento: ${c.fim || '-'}`;
    case 'contratos_a_vencer':
      return `📋 *CONTRATOS A VENCER (30 DIAS)*\\n` +
        `UG: ${ug}\\n` +
        `Contrato #${c.numero_contrato}\\n` +
        `Objeto: ${(c.objeto||'').substring(0, 60)}...\\n` +
        `Vencimento: ${c.fim || '-'} (${c.dias_restantes !== null ? c.dias_restantes + ' dias' : 'N/A'})\\n` +
        `Valor: R$ ${(c.valor||0).toFixed(2)}`;
    default:
      return `Notificação: ${tipo}\\nContrato #${c.numero_contrato}\\n${c.objeto||''}`;
  }
}

// Verifica se um contrato precisa de notificação
function precisaNotificar(contrato, configContato, tipo) {
  if (!configContato.notificacoes || !configContato.notificacoes[tipo]) return false;
  const dias = contrato.dias_restantes;
  const saldo = contrato.saldo_contrato;
  const valor = contrato.valor;
  
  switch(tipo) {
    case 'prazo_vencimento':
      return dias !== null && dias >= 0 && dias <= configContato.dias_antecedencia;
    case 'saldo_estourado':
      return saldo !== undefined && saldo < 0;
    case 'saldo_restante':
      return valor > 0 && saldo !== undefined && saldo >= 0 && (saldo / valor) <= 0.1;
    case 'contratos_a_vencer':
      return dias !== null && dias >= 0 && dias <= 30;
    default:
      return false;
  }
}

// Filtra contratos do contato
function filtrarContratosDoContato(contato, todosContratos) {
  if (contato.contratos_todos) return todosContratos;
  if (!contato.contratos || contato.contratos.length === 0) return [];
  return todosContratos.filter(c => contato.contratos.includes(c.numero_contrato));
}

// CRUD: Listar contatos
app.get('/api/notificacoes/contatos', (req, res) => {
  const modulo = req.query.modulo || 'gestor';
  const data = loadContatos();
  res.json({ status: 'ok', modulo, contatos: data[modulo] || [] });
});

// CRUD: Criar contato
app.post('/api/notificacoes/contatos', (req, res) => {
  const { modulo, nome, telefone, contratos, contratos_todos, notificacoes, dias_antecedencia, telegram_chat_id, discord_webhook } = req.body;
  if (!modulo || !nome || !telefone) {
    return res.status(400).json({ error: 'modulo, nome e telefone são obrigatórios' });
  }
  if (!['gestor', 'fornecedor', 'cpl'].includes(modulo)) {
    return res.status(400).json({ error: 'Módulo inválido. Use: gestor, fornecedor, cpl' });
  }
  const data = loadContatos();
  const contato = {
    id: novoId(),
    nome,
    telefone: telefone.replace(/\D/g, ''),
    modulo,
    contratos: contratos || [],
    contratos_todos: !!contratos_todos,
    notificacoes: {
      prazo_vencimento: true,
      saldo_estourado: true,
      saldo_restante: false,
      contratos_a_vencer: false,
      ...(notificacoes || {})
    },
    dias_antecedencia: parseInt(dias_antecedencia) || 15,
    telegram_chat_id: telegram_chat_id || null,
    discord_webhook: discord_webhook || null,
    ativo: true,
    created_at: new Date().toISOString(),
    ultima_notificacao: null
  };
  data[modulo].push(contato);
  saveContatos(data);
  res.json({ status: 'ok', contato });
});

// CRUD: Atualizar contato
app.put('/api/notificacoes/contatos/:id', (req, res) => {
  const { id } = req.params;
  const data = loadContatos();
  for (const mod of ['gestor', 'fornecedor', 'cpl']) {
    const idx = data[mod].findIndex(c => c.id === id);
    if (idx !== -1) {
      data[mod][idx] = { ...data[mod][idx], ...req.body, id };
      saveContatos(data);
      return res.json({ status: 'ok', contato: data[mod][idx] });
    }
  }
  res.status(404).json({ error: 'Contato não encontrado' });
});

// CRUD: Deletar contato
app.delete('/api/notificacoes/contatos/:id', (req, res) => {
  const { id } = req.params;
  const data = loadContatos();
  for (const mod of ['gestor', 'fornecedor', 'cpl']) {
    const idx = data[mod].findIndex(c => c.id === id);
    if (idx !== -1) {
      data[mod].splice(idx, 1);
      saveContatos(data);
      return res.json({ status: 'ok', message: 'Contato removido' });
    }
  }
  res.status(404).json({ error: 'Contato não encontrado' });
});

// Disparar notificações para uma UG
app.get('/api/notificacoes/disparar/:ug', async (req, res) => {
  const { ug } = req.params;
  const modulo = req.query.modulo || null;
  const tipo = req.query.tipo || null;
  
  try {
    // Buscar contratos da UG via monitor
    const raw = await httpsGet(GESTOR_BASE,
      `/tramita/exportar_licitacoes.jsp?codigo=${ug}&ci=012024&cf=122026&tipo=1`,
      { 'User-Agent': 'curl/8.14.1' }
    );
    let contratos = parseContratosTCE(raw);
    contratos = aplicarAditivos(contratos, parseAditivos(raw));
    // Só vincula empenhos se precisar de saldo_estourado ou saldo_restante
    const precisaSaldo = !tipo || tipo === 'saldo_estourado' || tipo === 'saldo_restante';
    if (precisaSaldo) {
      try { contratos = await vincularEmpenhos(contratos, ug, '2024', '2026'); } catch(e) {}
    }
    
    // Enriquecer com status
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const monitorados = contratos.map(c => {
      let dataFim = null, diasRestantes = null;
      if (c.fim && c.fim.length === 10) {
        const p = c.fim.split('/');
        dataFim = new Date(parseInt(p[2]), parseInt(p[1])-1, parseInt(p[0]));
      }
      if (dataFim && !isNaN(dataFim.getTime())) {
        dataFim.setHours(0,0,0,0);
        diasRestantes = Math.round((dataFim - hoje) / (1000*60*60*24));
      }
      return { ...c, dias_restantes: diasRestantes, status: diasRestantes < 0 ? 'expirado' : diasRestantes <= 15 ? 'critico' : diasRestantes <= 30 ? 'urgente' : diasRestantes <= 60 ? 'atencao' : 'vigente' };
    });

    const data = loadContatos();
    const modulos = modulo ? [modulo] : ['gestor', 'fornecedor', 'cpl'];
    const tiposNotif = tipo ? [tipo] : ['prazo_vencimento', 'saldo_estourado', 'saldo_restante', 'contratos_a_vencer'];
    
    const enviadas = [];
    
    for (const mod of modulos) {
      for (const contato of (data[mod] || [])) {
        if (!contato.ativo) continue;
        const contratosDoContato = filtrarContratosDoContato(contato, monitorados);
        
        for (const contrato of contratosDoContato) {
          for (const tp of tiposNotif) {
            if (precisaNotificar(contrato, contato, tp)) {
              const msg = gerarMensagem(tp, contrato, ug);
              // Envia para WhatsApp
              const result = await enviarWhatsApp(contato.telefone, msg, mod, tp, ug, contrato.numero_contrato);
              enviadas.push(result);
              // Envia para Telegram se configurado
              if (contato.telegram_chat_id) {
                const r2 = await enviarTelegram(contato.telegram_chat_id, msg, mod, tp, ug, contrato.numero_contrato);
                enviadas.push(r2);
              }
              // Envia para Discord se configurado
              if (contato.discord_webhook) {
                const r3 = await enviarDiscord(contato.discord_webhook, msg, mod, tp, ug, contrato.numero_contrato);
                enviadas.push(r3);
              }
            }
          }
        }
        
        // Atualiza ultima_notificacao
        if (enviadas.some(e => e.destino === contato.telefone)) {
          contato.ultima_notificacao = new Date().toISOString();
        }
      }
    }
    saveContatos(data);
    
    res.json({
      status: 'ok',
      ug,
      modulo: modulo || 'todos',
      tipo: tipo || 'todos',
      total_contratos: monitorados.length,
      notificacoes_enviadas: enviadas.length,
      notificacoes: enviadas.slice(0, 50)
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Status das configurações de envio
app.get('/api/notificacoes/config', (req, res) => {
  res.json({
    status: 'ok',
    telegram: {
      configurado: !!process.env.TELEGRAM_BOT_TOKEN,
      bot_token: process.env.TELEGRAM_BOT_TOKEN ? process.env.TELEGRAM_BOT_TOKEN.substring(0, 10) + '...' : null
    },
    whatsapp: {
      configurado: !!(process.env.META_WHATSAPP_TOKEN && process.env.META_WHATSAPP_PHONE_ID),
      meta_token: process.env.META_WHATSAPP_TOKEN ? 'configurado' : null,
      phone_id: process.env.META_WHATSAPP_PHONE_ID || null
    },
    discord: {
      configuracao: 'Por contato (webhook URL)'
    }
  });
});

// Histórico de notificações
app.get('/api/notificacoes/log', (req, res) => {
  try {
    if (!fs.existsSync(WHATSAPP_LOG_FILE)) return res.json({ status: 'ok', log: [] });
    const log = JSON.parse(fs.readFileSync(WHATSAPP_LOG_FILE, 'utf8'));
    const limite = parseInt(req.query.limite) || 50;
    const modulo = req.query.modulo;
    let filtrados = log;
    if (modulo) filtrados = filtrados.filter(e => e.modulo === modulo);
    res.json({ status: 'ok', total: filtrados.length, log: filtrados.slice(0, limite) });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`API Agentes running on port ${PORT}`));

// build: 1779587558
// build: 1779588348
// build: 1779589337
// build: 1779590336
// build: 1779591049
