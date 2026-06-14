let currentImageBase64 = null;
let remedyChartInst = null;
let cameraStream = null;

/* ══════════════════════════════════════════════
   DRAG & DROP
══════════════════════════════════════════════ */
function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('uploadZone').classList.add('drag-over');
}

function handleDragLeave(e) {
    document.getElementById('uploadZone').classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('uploadZone').classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
        processImageFile(file);
    } else {
        showToast('Please drop a valid image file (JPG, PNG, WEBP).', 'error');
    }
}

/* ══════════════════════════════════════════════
   FILE INPUT CHANGE
══════════════════════════════════════════════ */
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) processImageFile(file);
}

/* ══════════════════════════════════════════════
   PROCESS IMAGE FILE → read as base64 → preview
══════════════════════════════════════════════ */
function processImageFile(file) {
    if (file.size > 10 * 1024 * 1024) {
        showToast('Image too large. Max 10 MB allowed.', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = function(ev) {
        const dataUrl = ev.target.result;
        // Strip the "data:image/jpeg;base64," prefix — keep only the raw base64
        currentImageBase64 = dataUrl.split(',')[1];
        showPreview(dataUrl);
    };
    reader.readAsDataURL(file);
}

/* ══════════════════════════════════════════════
   SHOW PREVIEW  (hide upload zone, show image + analyze btn)
══════════════════════════════════════════════ */
function showPreview(dataUrl) {
    const uploadZone = document.getElementById('uploadZone');
    const imagePreview = document.getElementById('imagePreview');
    const previewImg = document.getElementById('previewImg');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const cameraModal = document.getElementById('cameraModal');

    if (uploadZone) uploadZone.style.display = 'none';
    if (cameraModal) cameraModal.style.display = 'none';
    if (imagePreview) {
        imagePreview.style.display = ''; // show
        previewImg.src = dataUrl;
    }
    if (analyzeBtn) analyzeBtn.style.display = ''; // show

    // Reset right panel to placeholder (clear old results)
    resetResultsPanel();
}

/* ══════════════════════════════════════════════
   CLEAR IMAGE
══════════════════════════════════════════════ */
function clearImage() {
    currentImageBase64 = null;

    const uploadZone = document.getElementById('uploadZone');
    const imagePreview = document.getElementById('imagePreview');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const fileInput = document.getElementById('fileInput');

    if (uploadZone) uploadZone.style.display = '';
    if (imagePreview) imagePreview.style.display = 'none';
    if (analyzeBtn) analyzeBtn.style.display = 'none';
    if (fileInput) fileInput.value = '';

    resetResultsPanel();
    closeCamera();
}

/* ══════════════════════════════════════════════
   RESET RIGHT PANEL to placeholder state
══════════════════════════════════════════════ */
function resetResultsPanel() {
    const panel = document.getElementById('resultsPanel');
    if (!panel) return;
    panel.innerHTML = `
    <div class="results-placeholder" id="resultsPlaceholder">
      <div class="placeholder-icon"><i class="fas fa-leaf"></i></div>
      <h3>${t('results_placeholder')}</h3>
      <p>${t('results_placeholder_sub')}</p>
      <div class="placeholder-steps">
        <div class="ps-item"><span class="ps-num">1</span> Upload or capture image</div>
        <div class="ps-item"><span class="ps-num">2</span> Click Analyze Crop</div>
        <div class="ps-item"><span class="ps-num">3</span> Get instant AI diagnosis</div>
      </div>
    </div>`;
    if (remedyChartInst) {
        remedyChartInst.destroy();
        remedyChartInst = null;
    }
}

/* ══════════════════════════════════════════════
   CAMERA
══════════════════════════════════════════════ */
async function openCamera() {
    const modal = document.getElementById('cameraModal');
    const video = document.getElementById('cameraFeed');
    const uploadZone = document.getElementById('uploadZone');

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        video.srcObject = cameraStream;
        if (uploadZone) uploadZone.style.display = 'none';
        if (modal) modal.style.display = '';
        showToast('Camera ready — position your crop in frame.', 'success');
    } catch (err) {
        console.error('Camera error:', err);
        showToast('Camera access denied or not available.', 'error');
    }
}

function closeCamera() {
    const modal = document.getElementById('cameraModal');
    const video = document.getElementById('cameraFeed');
    const uploadZone = document.getElementById('uploadZone');

    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }
    if (video) video.srcObject = null;
    if (modal) modal.style.display = 'none';

    // Only show upload zone again if no image has been selected
    if (!currentImageBase64 && uploadZone) {
        uploadZone.style.display = '';
    }
}

function capturePhoto() {
    const video = document.getElementById('cameraFeed');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0);

    canvas.toBlob(blob => {
        const file = new File([blob], 'capture.jpg', { type: 'image/jpeg' });
        closeCamera();
        processImageFile(file);
        showToast('📸 Photo captured!', 'success');
    }, 'image/jpeg', 0.92);
}

/* ══════════════════════════════════════════════
   ANALYZE IMAGE  — call Flask /api/diagnose
══════════════════════════════════════════════ */
async function analyzeImage() {
    if (!currentImageBase64) {
        showToast('Please upload or capture a crop image first.', 'warning');
        return;
    }

    const analyzeBtn = document.getElementById('analyzeBtn');
    const panel = document.getElementById('resultsPanel');

    // ── Loading state on button
    if (analyzeBtn) {
        analyzeBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Analyzing…`;
        analyzeBtn.disabled = true;
    }

    // ── Show loader in results panel
    if (panel) {
        panel.innerHTML = `
      <div class="analyzing-loader">
        <div class="ai-loading-ring"></div>
        <p style="color:var(--green);font-weight:700;font-size:1rem">AI is analyzing your crop…</p>
        <p style="color:var(--text-3);font-size:0.82rem;margin-top:4px">Identifying disease patterns and preparing remedies</p>
        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
          ${['🔍 Scanning image…','🧬 Detecting patterns…','🌿 Finding remedies…'].map((s,i)=>`
            <span style="font-size:0.72rem;padding:4px 11px;background:var(--bg-3);border:1px solid var(--border);
                         border-radius:50px;color:var(--text-3);animation:fadeInUp 0.3s ease ${i*0.15}s both">${s}</span>
          `).join('')}
        </div>
      </div>`;
  }

  try {
    // Extract image color hints to help Groq diagnose
    const hints = extractImageHints(document.getElementById('previewImg'));

    const res = await fetch('/api/diagnose', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ image: currentImageBase64, hints: hints })
    });

    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    renderDiagnosisResults(data);
    showToast('✅ Diagnosis complete!', 'success');

  } catch (err) {
    console.error('Diagnose error:', err);
    showToast('Diagnosis failed. Please try again.', 'error');
    if (panel) panel.innerHTML = `
      <div class="results-placeholder">
        <div class="placeholder-icon" style="opacity:1;color:var(--red)">
          <i class="fas fa-circle-xmark"></i>
        </div>
        <h3 style="color:var(--red)">Analysis Failed</h3>
        <p>Could not process the image.<br>Make sure your API key is set and the image is clear.</p>
        <button class="btn-secondary" style="margin-top:16px" onclick="analyzeImage()">
          <i class="fas fa-rotate"></i> Try Again
        </button>
      </div>`;
  } finally {
    if (analyzeBtn) {
      analyzeBtn.innerHTML = `<i class="fas fa-wand-magic-sparkles"></i> ${t('btn_analyze')}<div class="btn-shine"></div>`;
      analyzeBtn.disabled  = false;
    }
  }
}

/* ══════════════════════════════════════════════
   RENDER DIAGNOSIS RESULTS
══════════════════════════════════════════════ */
function renderDiagnosisResults(data) {
  const panel = document.getElementById('resultsPanel');
  if (!panel) return;

  const sevClass   = `badge-severity-${(data.severity || 'mild').toLowerCase()}`;
  const isHealthy  = (data.disease || '').toLowerCase().includes('healthy');
  const ecoList    = Array.isArray(data.eco_remedies)      ? data.eco_remedies      : [];
  const chemList   = Array.isArray(data.chemical_remedies) ? data.chemical_remedies : [];
  const prevList   = Array.isArray(data.prevention)        ? data.prevention        : [];

  panel.innerHTML = `
    <div class="results-content">

      <!-- Header -->
      <div class="result-header">
        <div class="result-disease-name">
          ${isHealthy ? '✅' : '🔬'} ${data.disease || 'Unknown Disease'}
        </div>
        <div class="result-meta">
          <span class="result-badge badge-confidence">
            <i class="fas fa-circle-check"></i> ${data.confidence || 0}% Confidence
          </span>
          ${data.severity ? `<span class="result-badge ${sevClass}">${data.severity} Severity</span>` : ''}
          ${data.affected_part ? `
            <span class="result-badge" style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);color:var(--amber)">
              <i class="fas fa-leaf"></i> ${data.affected_part}
            </span>` : ''}
        </div>
      </div>

      <div class="result-body">

        <!-- Cause -->
        ${data.cause ? `
          <div class="result-section">
            <h4><i class="fas fa-circle-info"></i> Cause</h4>
            <div class="result-cause">${data.cause}</div>
          </div>` : ''}

        <!-- Recovery timeline -->
        ${data.recovery_timeline ? `
          <div class="result-section">
            <h4><i class="fas fa-clock-rotate-left"></i> Recovery Timeline</h4>
            <div class="result-timeline">
              <i class="fas fa-calendar-check"></i> ${data.recovery_timeline}
            </div>
          </div>` : ''}

        <!-- Eco Remedies -->
        ${ecoList.length > 0 ? `
          <div class="result-section">
            <h4>
              <i class="fas fa-leaf"></i> Eco-Friendly Remedies
              <span style="font-size:0.68rem;padding:2px 8px;background:rgba(74,222,128,0.1);
                           color:var(--green);border-radius:50px;border:1px solid rgba(74,222,128,0.2);
                           margin-left:4px;font-weight:700">RECOMMENDED</span>
            </h4>
            <div class="eco-remedies">
              ${ecoList.map(r => `
                <div class="eco-remedy-card">
                  <div class="eco-remedy-name">🌿 ${r.remedy}</div>
                  <div class="eco-remedy-method">
                    <i class="fas fa-hand-dots" style="color:var(--teal);margin-right:4px"></i>${r.method}
                  </div>
                  <div class="eco-remedy-freq">
                    <i class="fas fa-rotate" style="color:var(--text-3);margin-right:4px"></i>${r.frequency}
                  </div>
                  <div class="eco-effectiveness">
                    <div class="eco-effectiveness-bar" style="width:0%" data-target="${r.effectiveness || 75}%"></div>
                  </div>
                  <div style="font-size:0.68rem;color:var(--text-3);margin-top:2px">${r.effectiveness || 75}% effectiveness</div>
                </div>`).join('')}
            </div>
          </div>` : ''}

        <!-- Remedy Effectiveness Chart -->
        ${ecoList.length > 0 ? `
          <div class="result-section">
            <h4><i class="fas fa-chart-bar"></i> Remedy Effectiveness Chart</h4>
            <div class="remedy-chart-wrap"><canvas id="remedyChart"></canvas></div>
          </div>` : ''}

        <!-- Chemical options -->
        ${chemList.length > 0 ? `
          <div class="result-section">
            <h4><i class="fas fa-flask"></i> Chemical Treatment Options</h4>
            <div class="chemical-remedies">
              ${chemList.map(c => `
                <div class="chem-item">
                  <span class="chem-name">⚗️ ${c.name}</span>
                  <span class="chem-dose">${c.dose}</span>
                  <span style="font-size:0.72rem;color:var(--text-3)">${c.interval}</span>
                </div>`).join('')}
            </div>
          </div>` : ''}

        <!-- Prevention tips -->
        ${prevList.length > 0 ? `
          <div class="result-section">
            <h4><i class="fas fa-shield-halved"></i> Prevention Tips</h4>
            <ul class="prevention-list">
              ${prevList.map(tip => `<li>${tip}</li>`).join('')}
            </ul>
          </div>` : ''}

        <!-- Disclaimer -->
        <div style="padding:10px 14px;background:rgba(251,191,36,0.05);
                    border:1px solid rgba(251,191,36,0.15);border-radius:8px;
                    font-size:0.72rem;color:var(--text-3);line-height:1.5">
          <i class="fas fa-circle-info" style="color:var(--amber);margin-right:4px"></i>
          AI-generated diagnosis for guidance only. Consult a local agronomist for critical crop decisions.
        </div>

      </div><!-- /.result-body -->
    </div><!-- /.results-content -->`;

  // Animate effectiveness bars after paint
  setTimeout(() => {
    document.querySelectorAll('.eco-effectiveness-bar').forEach(bar => {
      bar.style.width = bar.dataset.target;
    });
  }, 300);

  // Draw chart
  if (ecoList.length > 0) {
    setTimeout(() => buildRemedyChart(ecoList), 450);
  }
}

/* ══════════════════════════════════════════════
   REMEDY BAR CHART
══════════════════════════════════════════════ */
function buildRemedyChart(remedies) {
  const canvas = document.getElementById('remedyChart');
  if (!canvas) return;
  if (remedyChartInst) { remedyChartInst.destroy(); remedyChartInst = null; }

  const labels = remedies.map(r => r.remedy);
  const values = remedies.map(r => r.effectiveness || 75);
  const COLORS  = ['rgba(74,222,128,0.75)','rgba(45,212,191,0.75)','rgba(34,197,94,0.75)','rgba(16,185,129,0.75)'];

  remedyChartInst = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Effectiveness (%)',
        data:  values,
        backgroundColor: COLORS.slice(0, values.length),
        borderColor:     COLORS.slice(0, values.length).map(c => c.replace('0.75','1')),
        borderWidth: 1,
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      scales: {
        x: {
          min: 0, max: 100,
          grid:   { color: 'rgba(74,222,128,0.06)' },
          ticks:  { color: '#6b8c6c', callback: v => v + '%', font: { size: 10 } },
          border: { color: 'rgba(74,222,128,0.1)' }
        },
        y: {
          grid:   { display: false },
          ticks:  { color: '#a7c4a8', font: { size: 11 } },
          border: { display: false }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0e1510',
          borderColor: 'rgba(74,222,128,0.25)',
          borderWidth: 1,
          titleColor: '#e8f5e9',
          bodyColor:  '#a7c4a8',
          callbacks: { label: ctx => ` ${ctx.raw}% effectiveness` }
        }
      },
      animation: { duration: 800, easing: 'easeOutQuart' }
    }
  });
}

/* ── Stop camera on page leave ──────────────── */
window.addEventListener('beforeunload', () => {
  if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
});
/* ── Extract color hints from image for Groq ── */
function extractImageHints(imgEl) {
  if (!imgEl) return {};
  try {
    const canvas  = document.createElement('canvas');
    canvas.width  = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, 100, 100);
    const data = ctx.getImageData(0, 0, 100, 100).data;

    let r=0, g=0, b=0, darkPixels=0, yellowPixels=0, brownPixels=0, whitePixels=0;
    const total = data.length / 4;

    for (let i = 0; i < data.length; i += 4) {
      const pr = data[i], pg = data[i+1], pb = data[i+2];
      r += pr; g += pg; b += pb;

      const brightness = (pr + pg + pb) / 3;
      if (brightness < 60)                   darkPixels++;
      if (pr > 180 && pg > 180 && pb < 80)   yellowPixels++;
      if (pr > 120 && pg < 90  && pb < 70)   brownPixels++;
      if (pr > 200 && pg > 200 && pb > 200)  whitePixels++;
    }

    r = Math.round(r / total);
    g = Math.round(g / total);
    b = Math.round(b / total);

    return {
      colors:       `RGB(${r},${g},${b}) - dominant: ${r>g&&r>b?'red/brown':g>r&&g>b?'green':b>r&&b>g?'blue':'mixed'}`,
      dark_spots:   darkPixels   / total > 0.15,
      yellow:       yellowPixels / total > 0.10,
      brown:        brownPixels  / total > 0.10,
      white_powder: whitePixels  / total > 0.20,
      wilting:      g < 80 && r > 100,
      green_ratio:  Math.round((g / (r+g+b+1)) * 100) + '%'
    };
  } catch(e) {
    return { colors: 'unknown' };
  }
}
