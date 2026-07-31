let allMarketData = {};
let marketChart = null;
let activeChartType = 'line';
let activeFilter = 'all';

// Wraps fetch() with a hard timeout via AbortController. Without this, if
// data.gov.in (or the network path to it) hangs, the browser's fetch()
// promise just never resolves or rejects — the UI is stuck on whatever
// state it was already in, with no error and no way to recover except a
// manual refresh. This guarantees the promise settles one way or another.
async function fetchWithTimeout(url, ms = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

document.addEventListener('DOMContentLoaded', () => { loadMarkets();
    setupSearch(); });

async function loadMarkets() {
    try {
        const res = await fetchWithTimeout('/api/market', 20000);
        const data = await res.json();
        allMarketData = data.markets || {};
        document.getElementById('marketLoading').style.display = 'none';
        document.getElementById('marketCitiesGrid').style.display = '';
        renderGrid(allMarketData);
        buildTicker(allMarketData);
        buildTable(allMarketData);
        buildChart(allMarketData, 'Delhi', 'line');
    } catch (err) {
        const msg = err.name === 'AbortError'
            ? 'Prices are taking too long to load (mandi data source is slow right now). <a href="#" onclick="location.reload();return false;">Retry</a>'
            : 'Could not load prices. Please refresh.';
        document.getElementById('marketLoading').innerHTML = `<p style="color:var(--red)">${msg}</p>`;
    }
}

function renderGrid(markets) {
    const grid = document.getElementById('marketCitiesGrid');
    const none = document.getElementById('noResults');
    if (!grid) return;
    const entries = Object.entries(markets);
    if (!entries.length) { grid.style.display = 'none'; if (none) none.style.display = ''; return; }
    if (none) none.style.display = 'none';
    grid.innerHTML = entries.map(([city, crops], ci) => {
                let filtered = crops;
                if (activeFilter === 'Very High') filtered = crops.filter(c => c.demand === 'Very High');
                else if (activeFilter === 'rising') filtered = crops.filter(c => c.change > 0);
                else if (activeFilter === 'falling') filtered = crops.filter(c => c.change < 0);
                if (!filtered.length) return '';
                return `<div class="city-card" style="animation-delay:${ci*0.06}s">
      <div class="city-card-header">
        <div class="city-name"><i class="fas fa-location-dot"></i> ${city}</div>
        <span class="city-count">${filtered.length} crops</span>
      </div>
      <div class="crop-rows">
        <div style="display:grid;grid-template-columns:1.5fr 1fr 1fr 80px;padding:8px 16px;font-size:0.68rem;color:var(--text-3);font-weight:700;text-transform:uppercase;border-bottom:1px solid var(--border)">
          <span>Crop</span><span>Mandi</span><span>${getMarketT('msp')}</span><span>Change</span>
        </div>
        ${filtered.map(crop=>`
          <div class="crop-row">
            <div class="cr-name">${getCropName(crop.crop)}</div>
            <div>
              <div class="cr-price ${crop.above_msp?'above-msp':'below-msp'}">₹${crop.price.toLocaleString('en-IN')}</div>
              <div class="cr-unit">${getMarketT('per_quintal')}</div>
            </div>
            <div>
              <div class="cr-msp">₹${crop.msp.toLocaleString('en-IN')}</div>
              <div class="cr-unit">${getMarketT('msp')}</div>
            </div>
            <div class="cr-change ${crop.change>=0?'up':'down'}">
              <i class="fas fa-arrow-${crop.change>=0?'up':'down'}"></i>
              ${Math.abs(crop.change).toFixed(1)}%
            </div>
          </div>`).join('')}
      </div>
    </div>`;
  }).join('');
  setTimeout(()=>observeAnimations(),100);
}

async function searchLocation() {
  const input = document.getElementById('locationSearch');
  const query = input?.value.trim();
  if (!query) { clearSearch(); return; }
  document.getElementById('clearSearchBtn').style.display='flex';

  // Show a visible loading state — previously nothing changed on screen
  // while the request was in flight, so a slow backend looked identical
  // to a frozen page with no feedback at all.
  document.getElementById('noResults').style.display='none';
  document.getElementById('marketCitiesGrid').style.display='none';
  document.getElementById('marketLoading').style.display='';
  document.getElementById('marketLoading').innerHTML =
    `<p>Searching for "${query}"…</p>`;

  try {
    const res  = await fetchWithTimeout(`/api/market?location=${encodeURIComponent(query)}`, 20000);
    const data = await res.json();
    document.getElementById('marketLoading').style.display='none';
    document.getElementById('marketCitiesGrid').style.display='';
    if (!data.markets||!Object.keys(data.markets).length) {
      document.getElementById('marketCitiesGrid').style.display='none';
      document.getElementById('noResults').style.display='';
    } else {
      allMarketData = data.markets;
      renderGrid(data.markets);
      buildTable(data.markets);
      const first = data.locations[0];
      if (first) buildChart(data.markets,first,activeChartType);
      showToast(`Showing ${data.locations[0]}`, 'success');
    }
  } catch (err) {
    document.getElementById('marketLoading').style.display='none';
    document.getElementById('marketCitiesGrid').style.display='';
    const msg = err.name === 'AbortError'
      ? 'Search timed out — the mandi data source is slow right now. Try again.'
      : 'Search failed.';
    showToast(msg, 'error');
  }
}

function clearSearch() {
  const input=document.getElementById('locationSearch'); if(input) input.value='';
  const cb=document.getElementById('clearSearchBtn'); if(cb) cb.style.display='none';
  document.getElementById('noResults').style.display='none';
  loadMarkets();
}

function setupSearch() {
  const input=document.getElementById('locationSearch');
  if (input) {
    input.addEventListener('keydown',e=>{ if(e.key==='Enter') searchLocation(); });
    input.addEventListener('input',()=>{ const cb=document.getElementById('clearSearchBtn'); if(cb) cb.style.display=input.value?'flex':'none'; });
  }
  const showAll=document.getElementById('showAllMarketsBtn');
  if (showAll) showAll.addEventListener('click',clearSearch);
}

function filterDemand(type,el) {
  activeFilter=type;
  document.querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));
  if(el) el.classList.add('active');
  renderGrid(allMarketData);
}

function buildTicker(markets) {
  const content=document.getElementById('tickerContent');
  if (!content) return;
  const items=[];
  Object.entries(markets).forEach(([city,crops])=>{
    crops.slice(0,5).forEach(crop=>{
      const sign=crop.change>=0?'▲':'▼';
      const color=crop.change>=0?'#4ade80':'#f87171';
      items.push(`<span style="margin:0 28px"><strong style="color:#e8f5e9">${crop.crop}</strong> <span style="color:var(--text-3)">(${city})</span> <strong style="color:var(--amber)">₹${crop.price.toLocaleString('en-IN')}</strong> <span style="color:${color}"> ${sign}${Math.abs(crop.change).toFixed(1)}%</span></span>`);
    });
  });
  const html=items.join(' • ');
  content.innerHTML=html+' • '+html;
}

function switchChart(type) {
  activeChartType=type;
  document.querySelectorAll('.chart-tab').forEach(t=>t.classList.remove('active'));
  document.querySelector(`.chart-tab[onclick*="${type}"]`)?.classList.add('active');
  buildChart(allMarketData,document.getElementById('chartCitySelect')?.value||'Delhi',type);
}

function updateChart() {
  buildChart(allMarketData,document.getElementById('chartCitySelect')?.value||'Delhi',activeChartType);
}

function buildChart(markets,city,type) {
  const canvas=document.getElementById('marketChart');
  if (!canvas) return;
  const cityData=markets[city]||Object.values(markets)[0]||[];
  if (marketChart) marketChart.destroy();
  if (type==='line')      buildLine(canvas,cityData,city);
  else if (type==='bar')  buildBar(canvas,cityData,city);
  else if (type==='radar') buildRadar(canvas,cityData,city);
}

function buildLine(canvas,cityData,city) {
  const labels=[]; for(let i=29;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);labels.push(d.toLocaleDateString('en-IN',{day:'numeric',month:'short'}));}
  const colors=['#4ade80','#fbbf24','#2dd4bf','#a78bfa'];
  const datasets=cityData.slice(0,4).map((crop,idx)=>{
    const base=crop.price, trend=crop.change/100;
    return {label:crop.crop,data:labels.map((_,di)=>Math.round(base*(1-trend*(29-di)/29)+(Math.random()-0.5)*base*0.04)),borderColor:colors[idx],backgroundColor:colors[idx]+'18',borderWidth:2.5,tension:0.4,fill:idx===0,pointRadius:0,pointHoverRadius:5};
  });
  marketChart=new Chart(canvas,{type:'line',data:{labels,datasets},options:chartOpts(`${city} — 30-Day Trend (₹/quintal)`)});
}

function buildBar(canvas,cityData,city) {
  const colors=cityData.map(c=>c.change>=2?'rgba(74,222,128,0.75)':c.change<=-2?'rgba(248,113,113,0.75)':'rgba(251,191,36,0.75)');
  marketChart=new Chart(canvas,{type:'bar',data:{labels:cityData.map(c=>c.crop),datasets:[{label:'Price (₹/quintal)',data:cityData.map(c=>c.price),backgroundColor:colors,borderRadius:6}]},options:chartOpts(`${city} — Current Prices`)});
}

function buildRadar(canvas,cityData,city) {
  const dm={'Very High':100,'High':75,'Medium':50,'Low':25};
  marketChart=new Chart(canvas,{type:'radar',data:{labels:cityData.map(c=>c.crop),datasets:[{label:'Demand',data:cityData.map(c=>dm[c.demand]||50),backgroundColor:'rgba(251,191,36,0.12)',borderColor:'rgba(251,191,36,0.7)',borderWidth:2,pointBackgroundColor:'#fbbf24',pointRadius:5}]},options:{responsive:true,maintainAspectRatio:false,scales:{r:{min:0,max:100,ticks:{color:'rgba(107,140,108,0.7)',backdropColor:'transparent'},grid:{color:'rgba(74,222,128,0.08)'},angleLines:{color:'rgba(74,222,128,0.1)'},pointLabels:{color:'#a7c4a8',font:{size:11}}}},plugins:{legend:{display:false}}}});
}

function chartOpts(title) {
  return {responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},scales:{x:{grid:{color:'rgba(74,222,128,0.05)'},ticks:{color:'#6b8c6c',font:{size:10},maxTicksLimit:8}},y:{grid:{color:'rgba(74,222,128,0.06)'},ticks:{color:'#6b8c6c',callback:v=>'₹'+v.toLocaleString('en-IN')}}},plugins:{legend:{display:true,labels:{color:'#a7c4a8',font:{size:12},usePointStyle:true}},title:{display:true,text:title,color:'#a7c4a8',font:{size:13}},tooltip:{backgroundColor:'#0e1510',borderColor:'rgba(74,222,128,0.25)',borderWidth:1,titleColor:'#e8f5e9',bodyColor:'#a7c4a8',callbacks:{label:ctx=>` ${ctx.dataset.label}: ₹${ctx.raw.toLocaleString('en-IN')}`}}},animation:{duration:700}};
}

function buildTable(markets) {
  const tbody=document.getElementById('priceTableBody');
  if (!tbody) return;
  const cities=Object.keys(markets);
  const cropSet=new Set(); Object.values(markets).forEach(crops=>crops.forEach(c=>cropSet.add(c.crop)));
  const lookup={};
  Object.entries(markets).forEach(([city,crops])=>{ lookup[city]={}; crops.forEach(c=>{lookup[city][c.crop]=c;}); });
  tbody.innerHTML=[...cropSet].sort().map(crop=>{
    const cells=cities.map(city=>{
      const item=lookup[city]?.[crop];
      if (!item) return '<td class="not-available">—</td>';
      const color=item.change>=2?'#4ade80':item.change<=-2?'#f87171':'#e8f5e9';
      const arrow=item.change>=0.5?'▲':item.change<=-0.5?'▼':'–';
      return `<td style="color:${color}">₹${item.price.toLocaleString('en-IN')}<span style="font-size:0.65rem;opacity:0.7"> ${arrow}</span></td>`;
    });
    return `<tr><td>${crop}</td>${cells.join('')}</tr>`;
  }).join('');
  const thead=document.querySelector('.price-table thead tr');
  if (thead) thead.innerHTML='<th>Crop</th>'+cities.map(c=>`<th>${c}</th>`).join('');
}