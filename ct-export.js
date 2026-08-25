/* ═══════════════════════════════════════════════════════════════════════════
   ct-export.js — shared export engine for the Cricket Times stats pages

   One module, four formats, five pages. Every stats page used to carry its own
   exportToExcel(); this replaces all of them, so columns, gate, filename
   convention and copyright notice cannot drift apart the way the Oracle pages
   did before their engine was extracted.

   A page supplies a model builder and nothing else:

     const exp = CTExport.init({
       buttonId: 'exportBtn',       // default; countries.html mounts two
       build: buildExportModel,     // () => model | null
       minFilters: 2                // 0 disables the gate
     });

   Model — single table:
     { title, caption, base, unit, sheetName, headers:[…], rows:[[…]] }

   Model — multi-sheet (captaincy, countries):
     { title, caption, base, unit,
       sheets: [ { name, role:'summary', rows:[[k,v],…] },
                 { name, role:'data', headers:[…], rows:[[…]], numFmt:{2:'0.00'} } ] }

   Spreadsheet writers emit every sheet. CSV, clipboard and PDF use the first
   'data' sheet, with the summary rendered above it where one exists.

   Pages drive the gate through exp.setFilterCount(n) — their own
   updateExportButton() delegates here instead of styling the button itself.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';

/* ── Attribution and terms ─────────────────────────────────────────────────
   Every export carries the copyright notice, the terms and the source line.

   `attribution` optionally adds a licence marker on top of that:

     'none'       copyright notice only (default)
     'subscriber' also marks the file as a subscriber copy — signals that it is
                  licensed rather than public, and identifies nobody

   There is deliberately no option that stamps the reader's own identity. A
   plaintext address would export a subscriber's email into files they may
   share; an opaque per-account code would need a code-to-account mapping,
   which is exactly the per-uid record this project decided in August 2026 not
   to keep. Neither is reachable from here without new code. */
const BRAND = {
  owner:  'Cricket Times',
  site:   'cricketimes.com',
  terms:  'Personal and internal use only. Not for redistribution, republication or resale without written permission.',
  attribution: 'none',       // 'none' | 'subscriber'
  watermark: true            // the diagonal wash across each PDF page
};

const YEAR   = () => new Date().getFullYear();
const NOTICE = () => '\u00a9 ' + YEAR() + ' ' + BRAND.owner + '. All rights reserved.';
const STAMP  = () => new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });

/* Returns the licence marker, or null when attribution is off. Note what this
   does NOT do: it never reads the signed-in user. Nothing about the reader
   reaches the file. */
function attributionLabel() {
  return BRAND.attribution === 'subscriber' ? 'a Cricket Times subscriber' : null;
}
/* Shorter form, for the watermark, where the sentence would not fit. */
function attributionMark() {
  return BRAND.attribution === 'subscriber' ? 'SUBSCRIBER COPY' : null;
}

function legalLines() {
  const out = [NOTICE(), BRAND.terms, 'Source: ' + BRAND.owner + ' \u2014 ' + BRAND.site, 'Exported ' + STAMP()];
  const who = attributionLabel();
  if (who) out.push('Prepared for ' + who + '.');
  return out;
}

/* ── Styles ────────────────────────────────────────────────────────────────
   Every custom property carries a fallback: the five pages do not all define
   the same variable set, and a menu that renders invisible on one of them is
   worse than one that renders slightly off-palette. */
const CSS = `
.ct-exp-wrap{position:relative;display:inline-flex}
.ct-exp-caret{margin-left:6px;font-size:10px;line-height:1;opacity:0.7;transition:transform 0.15s}
.ct-exp-wrap [aria-expanded="true"] .ct-exp-caret{transform:rotate(180deg)}
.ct-exp-menu{display:none;position:absolute;top:calc(100% + 6px);right:0;min-width:250px;
  background:var(--surface,#fff);border:1px solid var(--border,#e0dcd5);border-radius:5px;
  box-shadow:0 8px 22px rgba(0,0,0,0.12);z-index:200;overflow:hidden;text-align:left}
.ct-exp-menu.open{display:block}
.ct-exp-item{display:flex;align-items:flex-start;gap:9px;width:100%;padding:9px 12px;border:0;
  border-bottom:1px solid var(--border,#e0dcd5);background:none;
  font-family:var(--font-body,Georgia,serif);font-size:12.5px;color:var(--text,#1a1e26);
  text-align:left;cursor:pointer;transition:background 0.15s,color 0.15s}
.ct-exp-item:last-child{border-bottom:0}
.ct-exp-item:hover{background:var(--surface2,#f5f0ea);color:var(--accent,#8B2500)}
.ct-exp-item svg{width:14px;height:14px;flex:none;margin-top:2px;stroke:currentColor;fill:none;stroke-width:2}
.ct-exp-item b{display:block;font-weight:600}
.ct-exp-item small{display:block;margin-top:1px;font-size:10.5px;color:var(--text3,#888)}
.ct-exp-item:hover small{color:var(--text2,#555)}
.ct-exp-foot{padding:7px 12px;background:var(--surface2,#f5f0ea);border-top:1px solid var(--border,#e0dcd5);
  font-family:var(--font-body,Georgia,serif);font-size:10px;line-height:1.45;color:var(--text3,#888)}
.ct-toast{position:fixed;left:50%;bottom:26px;z-index:9999;max-width:min(540px,92vw);
  padding:12px 40px 12px 16px;background:var(--text,#1a1e26);color:#fff;border-radius:6px;
  font-family:var(--font-body,Georgia,serif);font-size:12.5px;line-height:1.55;
  box-shadow:0 10px 30px rgba(0,0,0,0.28);opacity:0;transform:translateX(-50%) translateY(10px);
  transition:opacity 0.2s,transform 0.2s}
.ct-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.ct-toast a{color:#fff;text-decoration:underline}
.ct-toast-x{position:absolute;top:6px;right:8px;padding:2px 6px;border:0;background:none;
  color:rgba(255,255,255,0.65);font-size:15px;line-height:1;cursor:pointer}
.ct-toast-x:hover{color:#fff}
@media(max-width:767px){.ct-exp-menu{right:auto;left:0}}
`;

function injectCss() {
  if (document.getElementById('ct-export-css')) return;
  const el = document.createElement('style');
  el.id = 'ct-export-css';
  el.textContent = CSS;
  document.head.appendChild(el);
}

const ICONS = {
  down:   '<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  xlsx:   '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="19"/><line x1="15" y1="13" x2="9" y2="19"/></svg>',
  ods:    '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="8" x2="21" y2="8"/><line x1="10" y1="8" x2="10" y2="21"/></svg>',
  sheets: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="14" x2="21" y2="14"/><line x1="9" y1="9" x2="9" y2="20"/><line x1="15" y1="9" x2="15" y2="20"/></svg>',
  pdf:    '<svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><polyline points="15 2 15 7 20 7"/><path d="M8 15h1.5a1.5 1.5 0 0 0 0-3H8v6"/><path d="M14 18h1.5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2H14z"/></svg>'
};

const FORMATS = [
  { key:'xlsx',   icon:'xlsx',   name:'Excel',            note:'.xlsx workbook &mdash; one row per record' },
  { key:'ods',    icon:'ods',    name:'LibreOffice Calc', note:'.ods spreadsheet &mdash; open format, same columns' },
  { key:'sheets', icon:'sheets', name:'Google Sheets',    note:'copies the table &mdash; paste straight into a Sheet' },
  { key:'pdf',    icon:'pdf',    name:'PDF',              note:'landscape, print-ready, watermarked' }
];

/* ── Shared helpers ────────────────────────────────────────────────────── */
function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

let toastTimer = null;
function toast(html, ms) {
  document.querySelectorAll('.ct-toast').forEach(t => t.remove());
  clearTimeout(toastTimer);
  const t = document.createElement('div');
  t.className = 'ct-toast';
  t.innerHTML = '<button type="button" class="ct-toast-x" aria-label="Dismiss">&times;</button><div>' + html + '</div>';
  t.querySelector('.ct-toast-x').onclick = () => t.remove();
  document.body.appendChild(t);
  (global.requestAnimationFrame || (fn => setTimeout(fn, 16)))(() => t.classList.add('show'));
  toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, ms || 12000);
}

function normalise(m) {
  if (!m) return null;
  if (!m.sheets) {
    m = Object.assign({}, m, {
      sheets: [{ name: m.sheetName || m.title || 'Data', role:'data',
                 headers: m.headers, rows: m.rows, cols: m.cols, numFmt: m.numFmt }]
    });
  }
  m.sheets.forEach(sh => { if (!sh.role) sh.role = sh.headers ? 'data' : 'summary'; });
  return m;
}
function dataSheet(m)    { return m.sheets.find(s => s.role === 'data') || m.sheets[0]; }
function summarySheet(m) { return m.sheets.find(s => s.role === 'summary') || null; }

/* A column counts as numeric when nearly all of its filled cells parse as
   numbers — cheaper and less error-prone than annotating every column on every
   page, and it only ever drives alignment. */
function numericCols(sh) {
  const n = (sh.headers || []).length || (sh.rows[0] || []).length;
  const out = [];
  for (let c = 0; c < n; c++) {
    let filled = 0, numeric = 0;
    for (const r of sh.rows) {
      const v = r[c];
      if (v === '' || v === null || v === undefined) continue;
      filled++;
      if (typeof v === 'number' || /^-?[\d,]+(\.\d+)?%?$/.test(String(v).trim())) numeric++;
    }
    out.push(filled > 0 && numeric / filled >= 0.8);
  }
  return out;
}

function safeSheetName(n) {
  return String(n || 'Data').replace(/[\\\/\?\*\[\]:]/g, '-').slice(0, 31) || 'Data';
}

function csvCell(v) {
  const t = String(v === null || v === undefined ? '' : v);
  return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}
function buildCsv(m) {
  const sh = dataSheet(m);
  const lines = [];
  if (sh.headers) lines.push(sh.headers.map(csvCell).join(','));
  sh.rows.forEach(r => lines.push(r.map(csvCell).join(',')));
  lines.push('');
  legalLines().forEach(l => lines.push(csvCell(l)));
  return lines.join('\r\n');
}
function clipboardHtml(m) {
  const sh = dataSheet(m);
  const num = numericCols(sh);
  const width = (sh.headers || sh.rows[0] || []).length;
  const head = sh.headers
    ? '<thead><tr>' + sh.headers.map((h, i) =>
        `<th style="${num[i] ? 'text-align:right;' : 'text-align:left;'}background:#8B2500;color:#ffffff;font-weight:bold;">${esc(h)}</th>`).join('') + '</tr></thead>'
    : '';
  const body = sh.rows.map(r => '<tr>' + r.map((v, i) =>
    `<td style="${num[i] ? 'text-align:right;' : 'text-align:left;'}">${esc(v)}</td>`).join('') + '</tr>').join('');
  const foot = `<tr><td colspan="${width}" style="color:#888888;font-size:9pt;">${esc(legalLines().join('  \u00b7  '))}</td></tr>`;
  return `<meta charset="utf-8"><table>${head}<tbody>${body}${foot}</tbody></table>`;
}

/* ── PDF text sanitising ───────────────────────────────────────────────────
   jsPDF's built-in fonts speak WinAnsi, which covers Latin-1 and the usual
   punctuation but not the maths signs the filter captions use — an unmapped
   glyph comes out as mojibake rather than as nothing. */
const PDF_MAP = { '\u2265':'>=', '\u2264':'<=', '\u2260':'!=', '\u2192':'->', '\u2190':'<-' };
const PDF_KEEP = /[\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC\u2122]/;
function pdfSafe(v) {
  let t = String(v === null || v === undefined ? '' : v).replace(/[\u2265\u2264\u2260\u2192\u2190]/g, c => PDF_MAP[c]);
  if (/[^\x20-\x7E\xA0-\xFF]/.test(t)) {
    t = t.normalize('NFD').replace(/[\u0300-\u036F]/g, '');
    t = t.replace(/[^\x20-\x7E\xA0-\xFF]/g, c => PDF_KEEP.test(c) ? c : '?');
  }
  return t;
}

const PDF_LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.25/jspdf.plugin.autotable.min.js'
];
let pdfLibs = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    const el = document.createElement('script');
    el.src = src; el.onload = () => res(); el.onerror = () => rej(new Error('load failed: ' + src));
    document.head.appendChild(el);
  });
}
function loadPdfLibs() {
  if (!pdfLibs) {
    pdfLibs = loadScript(PDF_LIBS[0]).then(() => loadScript(PDF_LIBS[1]))
      .catch(err => { pdfLibs = null; throw err; });
  }
  return pdfLibs;
}

/* ═══ Instance ═══════════════════════════════════════════════════════════ */
function Instance(opts) {
  const self = this;
  this.buildModel   = opts.build;
  this.minFilters   = opts.minFilters === undefined ? 2 : opts.minFilters;
  this.hideDisabled = !!opts.hideWhenDisabled;
  this.buttonId     = opts.buttonId || 'exportBtn';
  this.enabled      = false;
  this.lastCount    = 0;      // pages set the gate before DOMContentLoaded; replayed at mount
  this.btn = this.wrap = this.menu = this.label = null;

  injectCss();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  function boot() { self.mount(); self.setFilterCount(self.lastCount); }
}

Instance.prototype.mount = function () {
  const self = this;
  const btn = document.getElementById(this.buttonId);
  if (!btn) { console.warn('[ct-export] no #' + this.buttonId + ' on this page \u2014 menu not mounted'); return; }
  if (btn.dataset.ctExport) return;
  btn.dataset.ctExport = '1';
  btn.type = 'button';
  this.btn = btn;

  // The page's own button classes are kept, so the trigger looks native here
  const wrap = document.createElement('div');
  wrap.className = 'ct-exp-wrap';
  if (btn.style.marginLeft) { wrap.style.marginLeft = btn.style.marginLeft; btn.style.marginLeft = ''; }
  btn.parentNode.insertBefore(wrap, btn);
  wrap.appendChild(btn);
  this.wrap = wrap;

  btn.innerHTML = ICONS.down + '<span class="ct-exp-label" style="margin-left:6px">Export</span><span class="ct-exp-caret">\u25be</span>';
  this.label = btn.querySelector('.ct-exp-label');
  btn.removeAttribute('onclick');
  btn.onclick = function (e) { self.toggle(e); };
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'ct-exp-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = FORMATS.map(f =>
    `<button type="button" class="ct-exp-item" role="menuitem" data-fmt="${f.key}">${ICONS[f.icon]}` +
    `<span><b>${f.name}</b><small>${f.note}</small></span></button>`
  ).join('') +
  `<div class="ct-exp-foot">${NOTICE()} Exports carry a source line and are for personal use.</div>`;
  wrap.appendChild(menu);
  this.menu = menu;

  menu.querySelectorAll('.ct-exp-item').forEach(function (b) {
    b.onclick = function () { self.close(); self.run(b.dataset.fmt); };
  });

  document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) self.close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') self.close(); });
};

Instance.prototype.toggle = function (e) {
  // stopPropagation keeps this click from reaching the document listener that
  // would immediately close what we just opened — which also means sibling
  // menus never hear it, so they are closed explicitly here
  if (e) e.stopPropagation();
  if (!this.menu || this.btn.disabled) return;
  closeAllExcept(this);
  const open = !this.menu.classList.contains('open');
  this.menu.classList.toggle('open', open);
  this.btn.setAttribute('aria-expanded', open ? 'true' : 'false');
};
Instance.prototype.close = function () {
  if (!this.menu) return;
  this.menu.classList.remove('open');
  if (this.btn) this.btn.setAttribute('aria-expanded', 'false');
};

Instance.prototype.setEnabled = function (on, tip) {
  this.enabled = !!on;
  if (!this.btn) return;                       // pre-mount: replayed by boot()
  this.btn.disabled = !this.enabled;
  this.btn.style.opacity = this.enabled ? '1' : '0.45';
  this.btn.style.cursor  = this.enabled ? 'pointer' : 'not-allowed';
  this.btn.title = tip || (this.enabled
    ? 'Export the current view \u2014 Excel, LibreOffice, Google Sheets or PDF'
    : 'Not enough filters selected to export');
  if (this.hideDisabled && this.wrap) this.wrap.style.display = this.enabled ? 'inline-flex' : 'none';
  if (!this.enabled) this.close();
};

Instance.prototype.setFilterCount = function (n) {
  this.lastCount = n;
  if (this.minFilters <= 0) { this.setEnabled(true); return; }
  const need = Math.max(0, this.minFilters - n);
  this.setEnabled(n >= this.minFilters, need
    ? 'Select at least ' + need + ' more filter' + (need === 1 ? '' : 's') + ' to enable export'
    : null);
};

Instance.prototype.setBusy = function (text) {
  if (!this.btn || !this.label) return;
  if (text) { this.btn.disabled = true; this.label.textContent = text; }
  else { this.label.textContent = 'Export'; this.setEnabled(this.enabled); }
};

Instance.prototype.model = function () {
  if (!this.enabled) { alert('Select more filters before exporting.'); return null; }
  let m;
  try { m = normalise(this.buildModel()); }
  catch (e) { console.error('[ct-export] model build failed', e); alert('Could not prepare the export.'); return null; }
  if (!m) { alert('No data to export.'); return null; }
  const d = dataSheet(m);
  if (!d || !d.rows || !d.rows.length) { alert('No data to export.'); return null; }
  if (!m.base) m.base = 'CricketTimes_export';
  if (!m.unit) m.unit = d.rows.length === 1 ? 'row' : 'rows';
  return m;
};

Instance.prototype.run = function (fmt) {
  if (fmt === 'xlsx' || fmt === 'ods') return this.writeWorkbook(fmt);
  if (fmt === 'sheets') return this.exportSheets();
  if (fmt === 'pdf') return this.exportPdf();
};

/* ═══ Spreadsheets — Excel (.xlsx) and LibreOffice Calc (.ods) ═══════════
   Both come out of the same SheetJS workbook; only the book type differs. The
   notice goes BELOW the data, two rows clear, so the header row stays at A1
   and anything parsing the file still finds the table where it expects it. */
Instance.prototype.writeWorkbook = function (fmt) {
  const m = this.model();
  if (!m) return;
  if (typeof XLSX === 'undefined') { alert('Spreadsheet library still loading \u2014 try again in a moment.'); return; }

  const wb = XLSX.utils.book_new();
  wb.Props = {
    Title:    BRAND.owner + ' \u2014 ' + (m.title || 'Export'),
    Author:   BRAND.owner,
    Company:  BRAND.owner,   // the legal entity is deliberately not named in exports
    Subject:  m.caption || '',
    Comments: legalLines().join(' | '),
    CreatedDate: new Date()
  };

  m.sheets.forEach(function (sh) {
    const aoa = sh.headers ? [sh.headers].concat(sh.rows) : sh.rows.map(function (r) { return r.slice(); });
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Widths from the data only, computed before the notice is appended — or a
    // 90-character legal line would set column A's width for the whole sheet
    if (sh.cols && sh.cols.length && typeof sh.cols[0] === 'object' && 'wch' in sh.cols[0]) {
      ws['!cols'] = sh.cols;
    } else {
      const n = (sh.headers || sh.rows[0] || []).length;
      ws['!cols'] = Array.from({ length: n }, function (_, i) {
        const head = sh.headers ? String(sh.headers[i] || '').length : 0;
        const body = sh.rows.reduce(function (mx, r) {
          return Math.max(mx, String(r[i] === null || r[i] === undefined ? '' : r[i]).length);
        }, 0);
        return { wch: Math.min(Math.max(head, body) + 2, 40) };
      });
    }

    if (sh.headers) {
      sh.headers.forEach(function (_, i) {
        const addr = XLSX.utils.encode_cell({ r:0, c:i });
        if (ws[addr]) ws[addr].s = { font: { bold: true } };
      });
    }

    // Per-column number formats, where the page asks for them (captaincy)
    if (sh.numFmt) {
      const first = sh.headers ? 1 : 0;
      Object.keys(sh.numFmt).forEach(function (k) {
        const c = +k;
        for (let r = first; r < first + sh.rows.length; r++) {
          const cell = ws[XLSX.utils.encode_cell({ r:r, c:c })];
          if (cell && typeof cell.v === 'number') cell.z = sh.numFmt[k];
        }
      });
    }

    XLSX.utils.sheet_add_aoa(ws, [['']].concat(legalLines().map(function (l) { return [l]; })), { origin: -1 });
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(sh.name));
  });

  XLSX.writeFile(wb, m.base + (fmt === 'ods' ? '.ods' : '.xlsx'), { bookType: fmt === 'ods' ? 'ods' : 'xlsx' });
};

/* ═══ Google Sheets ══════════════════════════════════════════════════════
   No Drive integration — that would mean an OAuth consent screen and a Drive
   scope on every reader. Two browser-only routes instead: the table on the
   clipboard as text/html (a paste lands in cells), and a .csv for File ›
   Import when the clipboard is blocked. */
Instance.prototype.exportSheets = async function () {
  const m = this.model();
  if (!m) return;
  const sh = dataSheet(m);
  const tsv = [].concat(sh.headers ? [sh.headers.join('\t')] : [],
                        sh.rows.map(function (r) { return r.join('\t'); }),
                        [''], legalLines()).join('\n');

  download(new Blob(['\ufeff' + buildCsv(m)], { type:'text/csv;charset=utf-8' }), m.base + '.csv');

  let copied = false;
  try {
    if (navigator.clipboard && global.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html':  new Blob([clipboardHtml(m)], { type:'text/html' }),
        'text/plain': new Blob([tsv], { type:'text/plain' })
      })]);
      copied = true;
    }
  } catch (e) { copied = false; }

  const open = '<a href="https://sheets.new" target="_blank" rel="noopener">Open a blank Google Sheet</a>';
  toast(copied
    ? 'Table copied. ' + open + ' and paste (Ctrl/\u2318&nbsp;V) \u2014 it arrives in cells, header row and all.<br>' +
      'A <b>.csv</b> copy was downloaded too; use <i>File \u203a Import</i> if you would rather start from the file.'
    : 'A <b>.csv</b> copy was downloaded. ' + open + ', then <i>File \u203a Import \u203a Upload</i>.<br>' +
      '(Your browser blocked the clipboard, so there is nothing to paste.)');
};

/* ═══ PDF ════════════════════════════════════════════════════════════════
   jsPDF plus autoTable, ~400 kB, loaded on first use rather than on page load.
   The watermark is drawn as an OVERLAY: autoTable paints cell fills over
   anything laid down first, so an underlay is invisible on a striped table.
   If the CDN is unreachable the export falls back to a hidden print frame. */
let wmPages = null;
function drawWatermark(doc, W, H) {
  if (!BRAND.watermark) return;
  // Two autoTable calls share the first page and both fire didDrawPage, which
  // would lay the wash down twice and double its density
  const pg = doc.internal.getCurrentPageInfo().pageNumber;
  if (wmPages.has(pg)) return;
  wmPages.add(pg);

  const mark = attributionMark();
  const text = mark ? BRAND.owner.toUpperCase() + '  \u00b7  ' + mark : BRAND.owner.toUpperCase();
  doc.saveGraphicsState();
  try { doc.setGState(new doc.GState({ opacity: 0.08 })); }
  catch (e) { doc.restoreGraphicsState(); return; }   // older jsPDF: skip rather than print it solid
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(139, 37, 0);
  doc.setFontSize(mark ? 26 : 34);
  for (let y = 90; y < H + 120; y += 165) {
    for (let x = -40; x < W + 120; x += 300) doc.text(text, x, y, { angle: 32 });
  }
  doc.restoreGraphicsState();
}

function pageFurniture(doc, m, sh, W, H, stamp, who) {
  drawWatermark(doc, W, H);      // first, so masthead and footer stay crisp on top of it
  doc.setFont('times', 'bold');   doc.setFontSize(16); doc.setTextColor(26, 30, 38);
  doc.text(BRAND.owner, 24, 34);
  doc.setFont('times', 'normal'); doc.setFontSize(11); doc.setTextColor(139, 37, 0);
  doc.text(pdfSafe(m.title || ''), 24, 50);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(110, 110, 110);
  doc.text(doc.splitTextToSize(pdfSafe(m.caption || ''), W - 48).slice(0, 2), 24, 61);
  doc.setDrawColor(216, 211, 203);
  doc.line(24, 72, W - 24, 72);

  doc.setFontSize(6.8); doc.setTextColor(140, 140, 140);
  doc.text(pdfSafe(sh.rows.length.toLocaleString() + ' ' + m.unit + ' \u00b7 ' + stamp + ' \u00b7 ' + BRAND.site), 24, H - 22);
  doc.text(pdfSafe(NOTICE() + '  ' + BRAND.terms), 24, H - 14);
  if (who) doc.text(pdfSafe('Prepared for ' + who), W - 24, H - 22, { align:'right' });  // never an identity — see attributionLabel()
}

Instance.prototype.exportPdf = async function () {
  const m = this.model();
  if (!m) return;
  const sh = dataSheet(m);

  if (sh.rows.length > 1500 && !confirm(
      'This view holds ' + sh.rows.length.toLocaleString() + ' rows. Rendering them all into a PDF may take a few seconds and produce a large file.\n\nExport anyway?')) return;

  this.setBusy('Building PDF\u2026');
  try { await loadPdfLibs(); }
  catch (e) { console.error(e); this.setBusy(false); printFallback(m); return; }

  try {
    const jsPDF = global.jspdf.jsPDF;
    const doc = new jsPDF({ orientation:'landscape', unit:'pt', format:'a4', compress:true });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const stamp = STAMP();
    const who = attributionLabel();
    wmPages = new Set();

    doc.setProperties({
      title:    BRAND.owner + ' \u2014 ' + m.title,
      subject:  m.caption || '',
      author:   BRAND.owner,
      creator:  BRAND.owner + ' (' + BRAND.site + ')',
      keywords: NOTICE() + '; ' + BRAND.terms
    });

    const num = numericCols(sh);
    const colStyles = {};
    num.forEach(function (isNum, i) { if (isNum) colStyles[i] = { halign:'right' }; });
    [['Player', 78], ['Captain', 78], ['Best By', 70], ['HS By', 70], ['Match', 96], ['Venue', 90]]
      .forEach(function (pair) {
        const i = (sh.headers || []).indexOf(pair[0]);
        if (i > -1) colStyles[i] = Object.assign({}, colStyles[i], { cellWidth: pair[1] });
      });

    const TOP = 80;
    let startY = TOP;

    const sum = summarySheet(m);
    if (sum && sum.rows.length) {
      doc.autoTable({
        body: sum.rows.filter(function (r) {
          return r.some(function (c) { return c !== '' && c !== null && c !== undefined; });
        }).map(function (r) { return r.map(pdfSafe); }),
        startY: TOP,
        margin: { top:TOP, left:24, right:24, bottom:34 },
        theme: 'plain',
        styles: { font:'helvetica', fontSize:7.5, cellPadding:1.6, textColor:[70,70,70] },
        columnStyles: { 0: { fontStyle:'bold', cellWidth:130, textColor:[26,30,38] } },
        didDrawPage: function () { pageFurniture(doc, m, sh, W, H, stamp, who); }
      });
      startY = doc.lastAutoTable.finalY + 14;
    }

    doc.autoTable({
      head: sh.headers ? [sh.headers.map(pdfSafe)] : undefined,
      body: sh.rows.map(function (r) { return r.map(pdfSafe); }),
      startY: startY,
      margin: { top:TOP, left:24, right:24, bottom:34 },
      styles: { font:'helvetica', fontSize:6.5, cellPadding:2.4, overflow:'linebreak',
                lineColor:[216,211,203], lineWidth:0.4, textColor:[26,30,38] },
      headStyles: { fillColor:[139,37,0], textColor:255, fontStyle:'bold', fontSize:6.5, halign:'left' },
      alternateRowStyles: { fillColor:[250,247,242] },
      columnStyles: colStyles,
      didDrawPage: function () { pageFurniture(doc, m, sh, W, H, stamp, who); }
    });

    const total = doc.internal.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(140, 140, 140);
      doc.text('Page ' + i + ' of ' + total, W - 24, H - 14, { align:'right' });
    }

    doc.save(m.base + '.pdf');
  } catch (e) {
    console.error('[ct-export] pdf failed', e);
    toast('The PDF could not be built. Try a narrower filter set, or export to Excel instead.');
  } finally {
    this.setBusy(false);
  }
};

/* Browser's own PDF writer, for when the CDN is unreachable. A hidden iframe
   rather than a popup, because a popup blocker would eat window.open(). */
function printFallback(m) {
  const sh = dataSheet(m);
  const num = numericCols(sh);
  const head = sh.headers ? '<tr>' + sh.headers.map(function (h, i) {
    return '<th style="' + (num[i] ? 'text-align:right' : 'text-align:left') + '">' + esc(h) + '</th>';
  }).join('') + '</tr>' : '';
  const body = sh.rows.map(function (r) {
    return '<tr>' + r.map(function (v, i) {
      return '<td style="' + (num[i] ? 'text-align:right' : 'text-align:left') + '">' + esc(v) + '</td>';
    }).join('') + '</tr>';
  }).join('');

  const html = '<html><head><meta charset="utf-8"><title>' + esc(BRAND.owner + ' \u2014 ' + m.title) + '</title><style>' +
`@page{size:A4 landscape;margin:1.4cm}
body{font-family:Georgia,'Times New Roman',serif;color:#1a1e26;margin:0;position:relative}
h1{font-size:18pt;margin:0 0 2pt}h2{font-size:12pt;font-weight:normal;color:#8B2500;margin:0 0 6pt}
p.meta{font-size:8.5pt;color:#555;margin:0 0 10pt}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #d8d3cb;padding:3pt 5pt;font-size:7.5pt}
th{background:#8B2500;color:#fff}
tr:nth-child(even) td{background:#faf7f2}
p.src{font-size:7.5pt;color:#888;margin-top:10pt}
.wm{position:fixed;top:38%;left:6%;font-size:64pt;color:rgba(139,37,0,0.07);transform:rotate(-28deg);
    font-family:Helvetica,Arial,sans-serif;font-weight:bold;z-index:-1}` +
'</style></head><body><div class="wm">' + esc(BRAND.owner.toUpperCase()) + '</div>' +
'<h1>' + esc(BRAND.owner) + '</h1><h2>' + esc(m.title) + '</h2>' +
'<p class="meta">' + esc(m.caption || '') + '<br>' +
  esc(sh.rows.length.toLocaleString() + ' ' + m.unit + ' \u00b7 ' + STAMP()) + '</p>' +
'<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' +
'<p class="src">' + esc(legalLines().join(' \u00b7 ')) + '</p></body></html>';

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const d = frame.contentWindow.document;
  d.open(); d.write(html); d.close();
  setTimeout(function () {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { console.error(e); }
    setTimeout(function () { frame.remove(); }, 1500);
  }, 350);
  toast('The PDF library did not load, so the print dialog opened instead \u2014 choose <b>Save as PDF</b> as the destination.');
}

/* ── Public API ────────────────────────────────────────────────────────── */
const instances = [];
function closeAllExcept(keep) {
  instances.forEach(function (i) { if (i !== keep) i.close(); });
}
function init(opts) {
  const inst = new Instance(opts || {});
  instances.push(inst);
  return inst;
}

global.CTExport = {
  init: init,
  brand: BRAND,
  legalLines: legalLines,
  toast: toast,
  /* CTExport.setAttribution('subscriber') marks exports as licensed copies.
     'none' and 'subscriber' are the only accepted values. */
  setAttribution: function (mode) {
    BRAND.attribution = (mode === 'subscriber') ? 'subscriber' : 'none';
    return BRAND.attribution;
  },
  /* Convenience for the single-menu pages: delegates to the first instance */
  setFilterCount: function (n) { if (instances[0]) instances[0].setFilterCount(n); },
  setEnabled: function (on, tip) { if (instances[0]) instances[0].setEnabled(on, tip); },
  run: function (fmt) { if (instances[0]) instances[0].run(fmt); },
  _internals: { normalise: normalise, dataSheet: dataSheet, summarySheet: summarySheet,
                numericCols: numericCols, buildCsv: buildCsv, clipboardHtml: clipboardHtml,
                csvCell: csvCell, pdfSafe: pdfSafe, safeSheetName: safeSheetName, legalLines: legalLines }
};

})(typeof window !== 'undefined' ? window : this);
