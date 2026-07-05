/* ============================================================
   BODEGA · Gestión de Mercadería  ·  app.js
   App de una sola página, sin dependencias de build.
   Persistencia local (localStorage) + Excel (SheetJS).
   ============================================================ */
(function () {
  "use strict";

  /* ---------------------------------------------------------
     1) UTILIDADES BÁSICAS
  --------------------------------------------------------- */
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const view = $("#view");

  const uid = (p = "id") => p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const fmtCLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
  const fmtNum = new Intl.NumberFormat("es-CL");
  const money = (n) => fmtCLP.format(Math.round(Number(n) || 0));
  const num = (n) => fmtNum.format(Number(n) || 0);

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // ----- Fechas (se guardan como 'YYYY-MM-DD') -----
  function hoy() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function toISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
  }
  function addDays(n) { const d = hoy(); d.setDate(d.getDate() + n); return toISO(d); }
  function parseFecha(iso) {
    if (!iso) return null;
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    dt.setHours(0, 0, 0, 0);
    return isNaN(dt) ? null : dt;
  }
  function diasHasta(iso) {
    const f = parseFecha(iso);
    if (!f) return null;
    return Math.round((f - hoy()) / 86400000);
  }
  function fmtFecha(iso) {
    const f = parseFecha(iso);
    if (!f) return "—";
    return f.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
  }
  // Normaliza fechas en múltiples formatos a 'YYYY-MM-DD' (para importación)
  function normalizarFecha(val) {
    if (val == null || val === "") return "";
    if (val instanceof Date && !isNaN(val)) return toISO(val);
    const s = String(val).trim();
    // Serial de Excel
    if (/^\d{5}(\.\d+)?$/.test(s)) {
      const base = new Date(Date.UTC(1899, 11, 30));
      base.setUTCDate(base.getUTCDate() + Math.floor(Number(s)));
      return toISO(new Date(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
    }
    let m;
    if ((m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)))
      return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
    if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)))
      return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
    const d = new Date(s);
    return isNaN(d) ? "" : toISO(d);
  }

  /* ---------------------------------------------------------
     2) ESTADO Y PERSISTENCIA
  --------------------------------------------------------- */
  const STORAGE_KEY = "bodega.state.v1";
  let memoryFallback = null; // si localStorage no está disponible

  let state = {
    productos: [],
    lotes: [],
    compras: [],
    config: { diasPorVencer: 30, tema: null },
  };

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      memoryFallback = JSON.stringify(state);
    }
  }
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = memoryFallback; }
    if (!raw) return false;
    try {
      const data = JSON.parse(raw);
      state = Object.assign({ productos: [], lotes: [], compras: [], config: {} }, data);
      state.config = Object.assign({ diasPorVencer: 30, tema: null }, state.config || {});
      return true;
    } catch (e) { return false; }
  }

  /* ---------------------------------------------------------
     3) MODELO / LÓGICA DE DOMINIO
  --------------------------------------------------------- */
  const ESTADOS = {
    normal:     { label: "Vigente",    badge: "ok",      dot: "var(--success)" },
    por_vencer: { label: "Por vencer", badge: "warn",    dot: "var(--warning)" },
    vencido:    { label: "Vencido",    badge: "danger",  dot: "var(--danger)" },
    mermado:    { label: "Mermado",    badge: "merma",   dot: "var(--merma)" },
    sin_fecha:  { label: "Sin fecha",  badge: "neutral", dot: "var(--text-muted)" },
  };

  const getProducto = (id) => state.productos.find((p) => p.id === id);
  const lotesDeProducto = (id) => state.lotes.filter((l) => l.productoId === id);

  function estadoLote(lote) {
    if (lote.mermado) return "mermado";
    const dias = diasHasta(lote.fechaVencimiento);
    if (dias === null) return "sin_fecha";
    if (dias < 0) return "vencido";
    if (dias <= state.config.diasPorVencer) return "por_vencer";
    return "normal";
  }
  // Stock vendible de un producto (excluye mermados y vencidos)
  function stockVendible(id) {
    return lotesDeProducto(id).reduce((s, l) => {
      const e = estadoLote(l);
      return e === "mermado" || e === "vencido" ? s : s + (Number(l.cantidad) || 0);
    }, 0);
  }
  function stockTotal(id) {
    return lotesDeProducto(id).reduce((s, l) => (l.mermado ? s : s + (Number(l.cantidad) || 0)), 0);
  }

  function estadoBadge(estado) {
    const e = ESTADOS[estado] || ESTADOS.sin_fecha;
    return `<span class="badge badge--${e.badge}">${e.label}</span>`;
  }
  function vencInfo(lote) {
    const dias = diasHasta(lote.fechaVencimiento);
    if (dias === null) return `<span class="muted">Sin fecha</span>`;
    if (dias < 0) return `<span class="text-danger">hace ${Math.abs(dias)} d</span>`;
    if (dias === 0) return `<span class="text-danger">¡hoy!</span>`;
    if (dias <= state.config.diasPorVencer) return `<span class="text-warn">en ${dias} d</span>`;
    return `<span class="muted">en ${dias} d</span>`;
  }
  // Barra de vida útil restante (0–100%)
  function lifeBar(lote) {
    const venc = parseFecha(lote.fechaVencimiento);
    const ing = parseFecha(lote.fechaIngreso);
    if (!venc) return "";
    const total = ing ? (venc - ing) / 86400000 : 180;
    const rest = (venc - hoy()) / 86400000;
    let pct = total > 0 ? Math.max(0, Math.min(100, (rest / total) * 100)) : (rest > 0 ? 100 : 0);
    const e = estadoLote(lote);
    const color = ESTADOS[e].dot;
    return `<div class="life-bar" title="${Math.round(pct)}% de vida útil restante"><div class="life-bar__fill" style="width:${pct}%;background:${color}"></div></div>`;
  }

  // Métricas globales
  function metrics() {
    let vendibles = 0, valorVenta = 0, valorCosto = 0;
    let vencidos = 0, uVencidos = 0, vVencidos = 0;
    let porVencer = 0, uPorVencer = 0, vPorVencer = 0;
    let mermados = 0, uMermados = 0, perdidaMerma = 0;
    for (const l of state.lotes) {
      const c = Number(l.cantidad) || 0;
      const pc = Number(l.precioCompra) || 0;
      const prod = getProducto(l.productoId);
      const pv = prod ? Number(prod.precioVenta) || 0 : 0;
      const e = estadoLote(l);
      if (e === "mermado") { mermados++; uMermados += c; perdidaMerma += c * pc; continue; }
      if (e === "vencido") { vencidos++; uVencidos += c; vVencidos += c * pc; }
      else if (e === "por_vencer") { porVencer++; uPorVencer += c; vPorVencer += c * pv; vendibles += c; valorVenta += c * pv; valorCosto += c * pc; }
      else { vendibles += c; valorVenta += c * pv; valorCosto += c * pc; }
    }
    return {
      productos: state.productos.length,
      vendibles, valorVenta, valorCosto,
      vencidos, uVencidos, vVencidos,
      porVencer, uPorVencer, vPorVencer,
      mermados, uMermados, perdidaMerma,
      compras: state.compras.length,
    };
  }

  const marcasUnicas = () => [...new Set(state.productos.map((p) => p.marca).filter(Boolean))].sort();

  /* ---------------------------------------------------------
     4) NOTIFICACIONES Y MODALES
  --------------------------------------------------------- */
  function toast(msg, type = "success") {
    const icons = { success: "✅", error: "⛔", warn: "⚠️", info: "ℹ️" };
    const el = document.createElement("div");
    el.className = `toast toast--${type}`;
    el.innerHTML = `<span class="toast__icon">${icons[type] || "ℹ️"}</span><span class="toast__msg">${escapeHtml(msg)}</span>`;
    $("#toastRoot").appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateX(20px)"; el.style.transition = "all .2s"; }, 2600);
    setTimeout(() => el.remove(), 2900);
  }

  function openModal(innerHTML, { wide = false } = {}) {
    const root = $("#modalRoot");
    root.innerHTML = `<div class="modal-backdrop"><div class="modal ${wide ? "modal--wide" : ""}">${innerHTML}</div></div>`;
    const backdrop = $(".modal-backdrop", root);
    backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) closeModal(); });
    return root;
  }
  function closeModal() { $("#modalRoot").innerHTML = ""; }

  function confirmDialog(message, onConfirm, { danger = false, confirmLabel = "Confirmar", title = "Confirmar acción" } = {}) {
    openModal(`
      <div class="modal__head"><h3>${escapeHtml(title)}</h3><button class="icon-btn" data-close>✕</button></div>
      <div class="modal__body"><p>${message}</p></div>
      <div class="modal__foot">
        <button class="btn btn--ghost" data-close>Cancelar</button>
        <button class="btn ${danger ? "btn--danger" : "btn--primary"}" id="cfmOk">${escapeHtml(confirmLabel)}</button>
      </div>`);
    $("#cfmOk").addEventListener("click", () => { onConfirm(); closeModal(); });
  }

  /* ---------------------------------------------------------
     5) ROUTER / NAVEGACIÓN
  --------------------------------------------------------- */
  const VIEWS = {
    dashboard:   { title: "Panel de control",        subtitle: "Resumen general de la bodega",            render: renderDashboard },
    ingreso:     { title: "Ingreso de mercadería",   subtitle: "Registra llegadas con sus vencimientos",  render: renderIngreso },
    inventario:  { title: "Inventario / Lotes",      subtitle: "Todos los lotes en bodega",               render: renderInventario },
    vencimientos:{ title: "Control de vencimientos", subtitle: "Productos vencidos y por vencer",         render: renderVencimientos },
    mermas:      { title: "Mermas",                  subtitle: "Pérdidas y productos en riesgo",          render: renderMermas },
    productos:   { title: "Catálogo de productos",   subtitle: "Define productos, marcas y precios",      render: renderProductos },
    compras:     { title: "Compras / Camiones",      subtitle: "Registro de ingresos y proveedores",      render: renderCompras },
    carga:       { title: "Carga masiva (Excel)",    subtitle: "Importa y exporta con planillas",         render: renderCarga },
    config:      { title: "Configuración",           subtitle: "Preferencias y datos",                    render: renderConfig },
  };

  let currentView = "dashboard";
  function navigate(v, opts) {
    if (!VIEWS[v]) v = "dashboard";
    currentView = v;
    $$(".nav__item").forEach((n) => n.classList.toggle("active", n.dataset.view === v));
    $("#pageTitle").textContent = VIEWS[v].title;
    $("#pageSubtitle").textContent = VIEWS[v].subtitle;
    closeSidebar();
    view.scrollTop = 0; window.scrollTo(0, 0);
    VIEWS[v].render(opts || {});
    refreshBadges();
  }

  function refreshBadges() {
    const m = metrics();
    const bv = $("#badgeVenc"), bm = $("#badgeMerma");
    const totalAlerta = m.vencidos + m.porVencer;
    if (totalAlerta > 0) { bv.textContent = totalAlerta; bv.hidden = false; } else bv.hidden = true;
    if (m.mermados > 0) { bm.textContent = m.mermados; bm.hidden = false; bm.style.background = "var(--merma)"; } else bm.hidden = true;
  }

  /* ---------------------------------------------------------
     6) VISTA: PANEL DE CONTROL
  --------------------------------------------------------- */
  function renderDashboard() {
    const m = metrics();
    const kpi = (label, value, hint, icon, mod, goto) => `
      <div class="kpi ${goto ? "kpi--clickable" : ""}" ${goto ? `data-goto="${goto}"` : ""}>
        <div class="kpi__top">
          <span class="kpi__label">${label}</span>
          <span class="kpi__icon kpi__icon--${mod}">${icon}</span>
        </div>
        <div class="kpi__value">${value}</div>
        <div class="kpi__hint">${hint}</div>
      </div>`;

    // Próximos a vencer (vencidos + por vencer), ordenados por fecha
    const criticos = state.lotes
      .filter((l) => !l.mermado && ["vencido", "por_vencer"].includes(estadoLote(l)) && l.fechaVencimiento)
      .sort((a, b) => parseFecha(a.fechaVencimiento) - parseFecha(b.fechaVencimiento))
      .slice(0, 9);

    // Stock bajo el mínimo
    const bajoStock = state.productos
      .map((p) => ({ p, stock: stockVendible(p.id) }))
      .filter((x) => Number(x.p.stockMinimo) > 0 && x.stock <= Number(x.p.stockMinimo))
      .slice(0, 6);

    const ultimasCompras = [...state.compras].sort((a, b) => parseFecha(b.fecha) - parseFecha(a.fecha)).slice(0, 5);

    view.innerHTML = `
      <div class="kpi-grid">
        ${kpi("Productos", num(m.productos), "en catálogo", "📦", "primary", "productos")}
        ${kpi("Unidades vendibles", num(m.vendibles), "stock disponible", "🟢", "ok", "inventario")}
        ${kpi("Valor inventario", money(m.valorVenta), `costo ${money(m.valorCosto)}`, "💵", "info", null)}
        ${kpi("Vencidos", num(m.vencidos), `${num(m.uVencidos)} u · ${money(m.vVencidos)}`, "⛔", "danger", "vencimientos")}
        ${kpi("Por vencer", num(m.porVencer), `≤ ${state.config.diasPorVencer} días · ${num(m.uPorVencer)} u`, "⏳", "warn", "vencimientos")}
        ${kpi("Mermados", num(m.mermados), `${num(m.uMermados)} u · −${money(m.perdidaMerma)}`, "🔻", "merma", "mermas")}
      </div>

      <div class="dash-grid">
        <div class="card">
          <div class="card__head">
            <h3>Próximos vencimientos</h3>
            <button class="btn btn--ghost btn--sm" data-goto="vencimientos">Ver todo</button>
          </div>
          <div class="table-wrap">
            ${criticos.length ? `
            <table class="data">
              <thead><tr><th>Producto</th><th>Lote</th><th class="num">Cant.</th><th>Vence</th><th>Falta</th><th>Estado</th></tr></thead>
              <tbody>
                ${criticos.map((l) => {
                  const p = getProducto(l.productoId) || {};
                  return `<tr>
                    <td><div class="cell-main">${escapeHtml(p.nombre || "—")}</div><div class="cell-sub">${escapeHtml(p.marca || "")}</div></td>
                    <td class="muted">#${l.id.slice(-5)}</td>
                    <td class="num">${num(l.cantidad)}</td>
                    <td>${fmtFecha(l.fechaVencimiento)}</td>
                    <td>${vencInfo(l)}</td>
                    <td>${estadoBadge(estadoLote(l))}</td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>` : emptyBlock("🎉", "Nada por vencer", "No hay productos vencidos ni próximos a vencer.")}
          </div>
        </div>

        <div class="flex" style="flex-direction:column;gap:18px">
          <div class="card">
            <div class="card__head"><h3>Alertas de stock bajo</h3></div>
            <div class="card__body">
              ${bajoStock.length ? `<ul class="list-clean">${bajoStock.map((x) => `
                <li class="mini-list-item">
                  <span class="mini-list-item__dot" style="background:var(--warning)"></span>
                  <div class="mini-list-item__body">
                    <div class="mini-list-item__title">${escapeHtml(x.p.nombre)}</div>
                    <div class="mini-list-item__sub">${escapeHtml(x.p.marca || "Sin marca")}</div>
                  </div>
                  <div style="text-align:right"><span class="tag-stock text-warn">${num(x.stock)}</span><div class="cell-sub">mín ${num(x.p.stockMinimo)}</div></div>
                </li>`).join("")}</ul>`
                : `<p class="text-muted" style="padding:6px 0">Todo el stock está sobre el mínimo. 👍</p>`}
            </div>
          </div>

          <div class="card">
            <div class="card__head"><h3>Últimas compras</h3><button class="btn btn--ghost btn--sm" data-goto="compras">Ver todo</button></div>
            <div class="card__body">
              ${ultimasCompras.length ? `<ul class="list-clean">${ultimasCompras.map((c) => {
                const items = state.lotes.filter((l) => l.compraId === c.id);
                const total = items.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.precioCompra) || 0), 0);
                return `<li class="mini-list-item">
                  <span class="mini-list-item__dot" style="background:var(--info)"></span>
                  <div class="mini-list-item__body">
                    <div class="mini-list-item__title">${escapeHtml(c.proveedor || "Proveedor")}</div>
                    <div class="mini-list-item__sub">${fmtFecha(c.fecha)} · ${items.length} ítem(s)${c.patente ? " · " + escapeHtml(c.patente) : ""}</div>
                  </div>
                  <span class="tag-stock">${money(total)}</span>
                </li>`;
              }).join("")}</ul>`
                : `<p class="text-muted" style="padding:6px 0">Aún no registras compras o camiones.</p>`}
            </div>
          </div>
        </div>
      </div>`;
  }

  function emptyBlock(icon, title, msg, btn) {
    return `<div class="empty"><div class="empty__icon">${icon}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(msg)}</p>${btn || ""}</div>`;
  }

  /* ---------------------------------------------------------
     7) VISTA: INGRESO DE MERCADERÍA  (multi-vencimiento)
  --------------------------------------------------------- */
  let ingresoLineCount = 0;

  function renderIngreso() {
    const comprasOpts = [...state.compras]
      .sort((a, b) => parseFecha(b.fecha) - parseFecha(a.fecha))
      .map((c) => `<option value="${c.id}">${escapeHtml((c.proveedor || "Compra") + " · " + fmtFecha(c.fecha) + (c.documento ? " · " + c.documento : ""))}</option>`)
      .join("");

    view.innerHTML = `
      <div class="card" style="margin-bottom:18px">
        <div class="card__body">
          <p style="margin-bottom:4px"><strong>💡 ¿Llegan cajas del mismo producto con distintas fechas de vencimiento?</strong></p>
          <p class="text-muted">Agrega una línea por cada fecha. Usa el botón <strong>⧉ Duplicar</strong> para repetir el mismo producto y solo cambiar la fecha y la cantidad. Ej.: 3 líneas de “Coca Cola 1.5L” con vencimientos distintos.</p>
        </div>
      </div>

      <div class="card" style="margin-bottom:18px">
        <div class="card__head"><h3>Datos del ingreso</h3></div>
        <div class="card__body">
          <div class="form-grid">
            <div class="field">
              <label>Fecha de ingreso</label>
              <input type="date" class="input" id="ingFecha" value="${addDays(0)}">
            </div>
            <div class="field">
              <label>Asociar a compra / camión</label>
              <select class="select" id="ingCompra">
                <option value="">— Sin asociar —</option>
                ${comprasOpts}
                <option value="__new">➕ Registrar nueva compra…</option>
              </select>
            </div>
          </div>
          <div id="ingNuevaCompra" hidden>
            <hr class="divider">
            <div class="form-grid">
              <div class="field"><label>Proveedor</label><input class="input" id="ncProveedor" placeholder="Ej: Distribuidora Andina"></div>
              <div class="field"><label>N° documento / factura</label><input class="input" id="ncDoc" placeholder="Ej: F-12345"></div>
              <div class="field"><label>Patente camión</label><input class="input" id="ncPatente" placeholder="Ej: KLRT-45"></div>
              <div class="field"><label>Transportista</label><input class="input" id="ncTransp" placeholder="Ej: Juan Pérez"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__head">
          <h3>Líneas de productos / lotes</h3>
          <button class="btn btn--soft btn--sm" id="btnAddLine">➕ Agregar línea</button>
        </div>
        <div class="card__body">
          <div class="lote-lines" id="loteLines"></div>
          <div class="section-head" style="margin-top:18px;margin-bottom:0">
            <div class="text-muted" id="ingResumen">0 líneas · 0 unidades</div>
            <div class="row-actions">
              <button class="btn btn--ghost" id="btnLimpiar">Limpiar</button>
              <button class="btn btn--primary" id="btnGuardarIngreso">✔ Confirmar ingreso</button>
            </div>
          </div>
        </div>
      </div>

      <datalist id="dlProductos">${state.productos.map((p) => `<option value="${escapeHtml(p.nombre)}"></option>`).join("")}</datalist>
      <datalist id="dlMarcas">${marcasUnicas().map((mk) => `<option value="${escapeHtml(mk)}"></option>`).join("")}</datalist>`;

    // Eventos
    $("#ingCompra").addEventListener("change", (e) => {
      $("#ingNuevaCompra").hidden = e.target.value !== "__new";
    });
    $("#btnAddLine").addEventListener("click", () => addIngresoLine());
    $("#btnLimpiar").addEventListener("click", () => { $("#loteLines").innerHTML = ""; ingresoLineCount = 0; addIngresoLine(); updateIngResumen(); });
    $("#btnGuardarIngreso").addEventListener("click", guardarIngreso);

    $("#loteLines").addEventListener("click", (e) => {
      const del = e.target.closest("[data-del-line]");
      const dup = e.target.closest("[data-dup-line]");
      if (del) { del.closest(".lote-line").remove(); updateIngResumen(); }
      if (dup) {
        const line = dup.closest(".lote-line");
        const prod = $(".li-prod", line).value, marca = $(".li-marca", line).value, costo = $(".li-costo", line).value;
        addIngresoLine({ producto: prod, marca: marca, costo: costo });
      }
    });
    $("#loteLines").addEventListener("input", (e) => {
      if (e.target.classList.contains("li-cant")) updateIngResumen();
      if (e.target.classList.contains("li-prod")) {
        const line = e.target.closest(".lote-line");
        const p = state.productos.find((x) => x.nombre.toLowerCase() === e.target.value.trim().toLowerCase());
        if (p) $(".li-marca", line).value = p.marca || "";
      }
    });

    addIngresoLine();
    updateIngResumen();
  }

  function addIngresoLine(data = {}) {
    ingresoLineCount++;
    const wrap = document.createElement("div");
    wrap.className = "lote-line";
    wrap.innerHTML = `
      <div class="field"><label>Producto <span class="req">*</span></label>
        <input class="input li-prod" list="dlProductos" placeholder="Ej: Coca Cola 1.5L" value="${escapeHtml(data.producto || "")}"></div>
      <div class="field"><label>Marca</label>
        <input class="input li-marca" list="dlMarcas" placeholder="Marca" value="${escapeHtml(data.marca || "")}"></div>
      <div class="field"><label>Cantidad <span class="req">*</span></label>
        <input type="number" min="0" step="1" class="input li-cant" placeholder="0" value="${escapeHtml(data.cant || "")}"></div>
      <div class="field"><label>Vencimiento</label>
        <input type="date" class="input li-venc" value="${escapeHtml(data.venc || "")}"></div>
      <div class="field"><label>Precio compra (unit.)</label>
        <input type="number" min="0" step="1" class="input li-costo" placeholder="0" value="${escapeHtml(data.costo || "")}"></div>
      <div class="flex gap-8" style="padding-bottom:2px">
        <button class="lote-line__del" data-dup-line title="Duplicar (mismo producto, otra fecha)" style="color:var(--info)">⧉</button>
        <button class="lote-line__del" data-del-line title="Eliminar línea">✕</button>
      </div>`;
    $("#loteLines").appendChild(wrap);
  }

  function updateIngResumen() {
    const lines = $$("#loteLines .lote-line");
    let u = 0;
    lines.forEach((l) => { u += Number($(".li-cant", l).value) || 0; });
    $("#ingResumen").textContent = `${lines.length} línea(s) · ${num(u)} unidades`;
  }

  function guardarIngreso() {
    const lines = $$("#loteLines .lote-line");
    const fechaIngreso = $("#ingFecha").value || addDays(0);

    // Validación
    const parsed = [];
    let invalid = false;
    lines.forEach((line) => {
      const prodInput = $(".li-prod", line);
      const nombre = prodInput.value.trim();
      const cantInput = $(".li-cant", line);
      const cant = Number(cantInput.value);
      prodInput.classList.remove("input--invalid"); cantInput.classList.remove("input--invalid");
      if (!nombre && !cantInput.value) return; // línea vacía → se ignora
      if (!nombre) { prodInput.classList.add("input--invalid"); invalid = true; }
      if (!(cant > 0)) { cantInput.classList.add("input--invalid"); invalid = true; }
      parsed.push({
        nombre, marca: $(".li-marca", line).value.trim(),
        cant, venc: $(".li-venc", line).value, costo: Number($(".li-costo", line).value) || 0,
      });
    });

    if (invalid) { toast("Revisa las líneas marcadas: falta producto o cantidad válida.", "error"); return; }
    if (!parsed.length) { toast("Agrega al menos una línea con producto y cantidad.", "warn"); return; }

    // Compra / camión
    let compraId = $("#ingCompra").value;
    if (compraId === "__new") {
      const prov = $("#ncProveedor").value.trim();
      if (!prov) { toast("Indica el proveedor de la nueva compra.", "error"); return; }
      const compra = {
        id: uid("c"), fecha: fechaIngreso, proveedor: prov,
        documento: $("#ncDoc").value.trim(), patente: $("#ncPatente").value.trim(),
        transportista: $("#ncTransp").value.trim(), observacion: "", creado: new Date().toISOString(),
      };
      state.compras.push(compra);
      compraId = compra.id;
    }
    const proveedorTxt = compraId ? (state.compras.find((c) => c.id === compraId) || {}).proveedor || "" : "";

    // Crear productos nuevos + lotes
    let nuevosProductos = 0, lotesCreados = 0;
    parsed.forEach((row) => {
      let prod = state.productos.find(
        (p) => p.nombre.toLowerCase() === row.nombre.toLowerCase() &&
               (p.marca || "").toLowerCase() === row.marca.toLowerCase()
      ) || state.productos.find((p) => p.nombre.toLowerCase() === row.nombre.toLowerCase());
      if (!prod) {
        prod = {
          id: uid("p"), nombre: row.nombre, marca: row.marca, categoria: "", descripcion: "",
          unidad: "Unidad", codigoBarras: "", precioVenta: 0, stockMinimo: 0, creado: new Date().toISOString(),
        };
        state.productos.push(prod);
        nuevosProductos++;
      }
      state.lotes.push({
        id: uid("l"), productoId: prod.id, cantidad: row.cant,
        fechaVencimiento: row.venc || "", fechaIngreso, precioCompra: row.costo,
        proveedor: proveedorTxt, compraId: compraId || "", mermado: false, motivoMerma: "",
        creado: new Date().toISOString(),
      });
      lotesCreados++;
    });

    save();
    let msg = `Ingreso registrado: ${lotesCreados} lote(s).`;
    if (nuevosProductos) msg += ` ${nuevosProductos} producto(s) nuevo(s) — define su precio de venta en Catálogo.`;
    toast(msg, "success");
    navigate("inventario");
  }

  /* ---------------------------------------------------------
     8) VISTA: INVENTARIO / LOTES
  --------------------------------------------------------- */
  let invFilters = { q: "", marca: "", estado: "", sort: "venc_asc" };
  let selectedLotes = new Set();

  function lotesFiltrados() {
    const q = invFilters.q.toLowerCase();
    let arr = state.lotes.map((l) => ({ l, p: getProducto(l.productoId) || {}, e: estadoLote(l) }));
    if (q) arr = arr.filter((x) =>
      (x.p.nombre || "").toLowerCase().includes(q) ||
      (x.p.marca || "").toLowerCase().includes(q) ||
      (x.p.categoria || "").toLowerCase().includes(q) ||
      x.l.id.toLowerCase().includes(q));
    if (invFilters.marca) arr = arr.filter((x) => (x.p.marca || "") === invFilters.marca);
    if (invFilters.estado) arr = arr.filter((x) => x.e === invFilters.estado);
    const sorters = {
      venc_asc: (a, b) => (parseFecha(a.l.fechaVencimiento) || Infinity) - (parseFecha(b.l.fechaVencimiento) || Infinity),
      venc_desc: (a, b) => (parseFecha(b.l.fechaVencimiento) || -Infinity) - (parseFecha(a.l.fechaVencimiento) || -Infinity),
      nombre: (a, b) => (a.p.nombre || "").localeCompare(b.p.nombre || ""),
      cant_desc: (a, b) => (b.l.cantidad || 0) - (a.l.cantidad || 0),
    };
    arr.sort(sorters[invFilters.sort] || sorters.venc_asc);
    return arr;
  }

  function renderInventario() {
    const marcaOpts = marcasUnicas().map((mk) => `<option value="${escapeHtml(mk)}" ${invFilters.marca === mk ? "selected" : ""}>${escapeHtml(mk)}</option>`).join("");
    const estadoOpts = Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}" ${invFilters.estado === k ? "selected" : ""}>${v.label}</option>`).join("");

    view.innerHTML = `
      <div class="section-head">
        <div><h2>Inventario de lotes</h2><p>Filtra por marca, estado o vencimiento. Selecciona para acciones masivas.</p></div>
        <div class="row-actions">
          <button class="btn btn--soft" data-goto="carga">⬆ Importar Excel</button>
          <button class="btn btn--primary" data-goto="ingreso">➕ Ingresar mercadería</button>
        </div>
      </div>

      <div class="filters">
        <div class="search" style="flex:1;min-width:200px">
          <svg viewBox="0 0 24 24" class="search__icon"><path d="M15.5 14h-.8l-.3-.3a6.5 6.5 0 10-.7.7l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 110-9 4.5 4.5 0 010 9z"/></svg>
          <input type="search" id="invSearch" placeholder="Buscar producto, marca, lote…" value="${escapeHtml(invFilters.q)}" style="width:100%">
        </div>
        <select class="select" id="invMarca"><option value="">Todas las marcas</option>${marcaOpts}</select>
        <select class="select" id="invEstado"><option value="">Todos los estados</option>${estadoOpts}</select>
        <select class="select" id="invSort">
          <option value="venc_asc" ${invFilters.sort === "venc_asc" ? "selected" : ""}>Vence primero</option>
          <option value="venc_desc" ${invFilters.sort === "venc_desc" ? "selected" : ""}>Vence último</option>
          <option value="nombre" ${invFilters.sort === "nombre" ? "selected" : ""}>Nombre A–Z</option>
          <option value="cant_desc" ${invFilters.sort === "cant_desc" ? "selected" : ""}>Mayor cantidad</option>
        </select>
        ${invFilters.q || invFilters.marca || invFilters.estado ? `<button class="btn btn--ghost btn--sm" id="invClear">✕ Limpiar filtros</button>` : ""}
      </div>

      <div id="bulkBar"></div>
      <div class="card"><div class="table-wrap" id="invTableWrap"></div></div>`;

    $("#invSearch").addEventListener("input", (e) => { invFilters.q = e.target.value; renderInvTable(); });
    $("#invMarca").addEventListener("change", (e) => { invFilters.marca = e.target.value; renderInvTable(); });
    $("#invEstado").addEventListener("change", (e) => { invFilters.estado = e.target.value; renderInvTable(); });
    $("#invSort").addEventListener("change", (e) => { invFilters.sort = e.target.value; renderInvTable(); });
    const clr = $("#invClear"); if (clr) clr.addEventListener("click", () => { invFilters = { q: "", marca: "", estado: "", sort: invFilters.sort }; renderInventario(); });

    renderInvTable();
  }

  function renderInvTable() {
    const rows = lotesFiltrados();
    // limpia selección de lo que ya no está visible
    const visibles = new Set(rows.map((r) => r.l.id));
    selectedLotes.forEach((id) => { if (!visibles.has(id)) selectedLotes.delete(id); });

    const wrap = $("#invTableWrap");
    if (!rows.length) {
      wrap.innerHTML = emptyBlock("🔍", "Sin resultados", "No hay lotes que coincidan con los filtros.");
      renderBulkBar();
      return;
    }
    wrap.innerHTML = `
      <table class="data">
        <thead><tr>
          <th class="checkbox-col"><input type="checkbox" id="chkAll"></th>
          <th>Producto</th><th>Marca</th><th class="num">Cantidad</th>
          <th class="num">P. compra</th><th class="num">P. venta</th>
          <th>Vencimiento</th><th>Falta</th><th>Vida útil</th><th>Estado</th><th></th>
        </tr></thead>
        <tbody>
          ${rows.map(({ l, p, e }) => `
            <tr data-id="${l.id}">
              <td class="checkbox-col"><input type="checkbox" class="rowChk" data-id="${l.id}" ${selectedLotes.has(l.id) ? "checked" : ""}></td>
              <td><div class="cell-main">${escapeHtml(p.nombre || "—")}</div><div class="cell-sub">#${l.id.slice(-5)} · ${escapeHtml(p.categoria || "Sin categoría")}</div></td>
              <td>${escapeHtml(p.marca || "—")}</td>
              <td class="num">${num(l.cantidad)} <span class="cell-sub">${escapeHtml(p.unidad || "")}</span></td>
              <td class="num">${money(l.precioCompra)}</td>
              <td class="num">${money(p.precioVenta)}</td>
              <td>${fmtFecha(l.fechaVencimiento)}</td>
              <td>${vencInfo(l)}</td>
              <td>${lifeBar(l) || "<span class='muted'>—</span>"}</td>
              <td>${estadoBadge(e)}</td>
              <td>
                <div class="flex gap-8">
                  <button class="btn btn--ghost btn--sm" data-edit="${l.id}" title="Editar">✏️</button>
                  ${l.mermado
                    ? `<button class="btn btn--ghost btn--sm" data-restore="${l.id}" title="Quitar merma">↩️</button>`
                    : `<button class="btn btn--ghost btn--sm" data-merma="${l.id}" title="Marcar como merma">🔻</button>`}
                  <button class="btn btn--ghost btn--sm" data-del="${l.id}" title="Eliminar">🗑️</button>
                </div>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>`;

    // eventos tabla
    $("#chkAll").addEventListener("change", (e) => {
      rows.forEach((r) => e.target.checked ? selectedLotes.add(r.l.id) : selectedLotes.delete(r.l.id));
      renderInvTable();
    });
    $$(".rowChk", wrap).forEach((chk) => chk.addEventListener("change", (e) => {
      const id = e.target.dataset.id;
      e.target.checked ? selectedLotes.add(id) : selectedLotes.delete(id);
      renderBulkBar();
    }));
    $$("[data-edit]", wrap).forEach((b) => b.addEventListener("click", () => modalEditarLote(b.dataset.edit)));
    $$("[data-merma]", wrap).forEach((b) => b.addEventListener("click", () => modalMerma([b.dataset.merma])));
    $$("[data-restore]", wrap).forEach((b) => b.addEventListener("click", () => { restaurarMerma([b.dataset.restore]); }));
    $$("[data-del]", wrap).forEach((b) => b.addEventListener("click", () => {
      confirmDialog("¿Eliminar este lote? Esta acción no se puede deshacer.", () => eliminarLotes([b.dataset.del]), { danger: true, confirmLabel: "Eliminar" });
    }));

    renderBulkBar();
  }

  function renderBulkBar() {
    const bar = $("#bulkBar");
    if (!bar) return;
    const n = selectedLotes.size;
    if (!n) { bar.innerHTML = ""; return; }
    bar.innerHTML = `
      <div class="bulk-bar">
        <span>${n} lote(s) seleccionado(s)</span>
        <button class="btn btn--soft btn--sm" id="bulkMerma">🔻 Marcar merma</button>
        <button class="btn btn--soft btn--sm" id="bulkExport">⬇ Exportar selección</button>
        <button class="btn btn--danger btn--sm" id="bulkDel">🗑️ Eliminar</button>
        <span class="bulk-bar__spacer"></span>
        <button class="btn btn--ghost btn--sm" id="bulkClear">Quitar selección</button>
      </div>`;
    $("#bulkMerma").addEventListener("click", () => modalMerma([...selectedLotes]));
    $("#bulkExport").addEventListener("click", () => exportarLotes([...selectedLotes]));
    $("#bulkClear").addEventListener("click", () => { selectedLotes.clear(); renderInvTable(); });
    $("#bulkDel").addEventListener("click", () => {
      confirmDialog(`¿Eliminar <strong>${n}</strong> lote(s) seleccionado(s)? No se puede deshacer.`, () => {
        eliminarLotes([...selectedLotes]); selectedLotes.clear();
      }, { danger: true, confirmLabel: `Eliminar ${n}` });
    });
  }

  function eliminarLotes(ids) {
    const set = new Set(ids);
    state.lotes = state.lotes.filter((l) => !set.has(l.id));
    save(); toast(`${ids.length} lote(s) eliminado(s).`, "success");
    rerenderCurrent();
  }
  function restaurarMerma(ids) {
    const set = new Set(ids);
    state.lotes.forEach((l) => { if (set.has(l.id)) { l.mermado = false; l.motivoMerma = ""; } });
    save(); toast("Merma revertida.", "success"); rerenderCurrent();
  }

  function modalMerma(ids) {
    if (!ids.length) return;
    openModal(`
      <div class="modal__head"><h3>Marcar como merma</h3><button class="icon-btn" data-close>✕</button></div>
      <div class="modal__body">
        <p class="text-muted" style="margin-bottom:14px">Se marcará(n) <strong>${ids.length}</strong> lote(s) como merma. Saldrán del stock vendible y se contabilizarán como pérdida.</p>
        <div class="field">
          <label>Motivo</label>
          <select class="select" id="mermaMotivo">
            <option>Vencido</option><option>Producto dañado / roto</option><option>Mal estado / contaminado</option>
            <option>Error de bodega</option><option>Robo / pérdida</option><option>Otro</option>
          </select>
        </div>
        <div class="field"><label>Detalle (opcional)</label><textarea class="textarea" id="mermaDetalle" placeholder="Observaciones…"></textarea></div>
      </div>
      <div class="modal__foot">
        <button class="btn btn--ghost" data-close>Cancelar</button>
        <button class="btn btn--primary" id="mermaOk">Confirmar merma</button>
      </div>`);
    $("#mermaOk").addEventListener("click", () => {
      const motivo = $("#mermaMotivo").value;
      const detalle = $("#mermaDetalle").value.trim();
      const set = new Set(ids);
      state.lotes.forEach((l) => { if (set.has(l.id)) { l.mermado = true; l.motivoMerma = motivo + (detalle ? " — " + detalle : ""); } });
      save(); closeModal(); selectedLotes.clear();
      toast(`${ids.length} lote(s) marcado(s) como merma.`, "success");
      rerenderCurrent();
    });
  }

  function modalEditarLote(id) {
    const l = state.lotes.find((x) => x.id === id);
    if (!l) return;
    const p = getProducto(l.productoId) || {};
    openModal(`
      <div class="modal__head"><h3>Editar lote · ${escapeHtml(p.nombre || "")}</h3><button class="icon-btn" data-close>✕</button></div>
      <div class="modal__body">
        <div class="form-grid">
          <div class="field"><label>Cantidad</label><input type="number" min="0" class="input" id="edCant" value="${escapeHtml(l.cantidad)}"></div>
          <div class="field"><label>Vencimiento</label><input type="date" class="input" id="edVenc" value="${escapeHtml(l.fechaVencimiento || "")}"></div>
          <div class="field"><label>Fecha de ingreso</label><input type="date" class="input" id="edIng" value="${escapeHtml(l.fechaIngreso || "")}"></div>
          <div class="field"><label>Precio compra (unit.)</label><input type="number" min="0" class="input" id="edCosto" value="${escapeHtml(l.precioCompra)}"></div>
          <div class="field"><label>Proveedor</label><input class="input" id="edProv" value="${escapeHtml(l.proveedor || "")}"></div>
        </div>
      </div>
      <div class="modal__foot">
        <button class="btn btn--ghost" data-close>Cancelar</button>
        <button class="btn btn--primary" id="edOk">Guardar cambios</button>
      </div>`);
    $("#edOk").addEventListener("click", () => {
      l.cantidad = Number($("#edCant").value) || 0;
      l.fechaVencimiento = $("#edVenc").value;
      l.fechaIngreso = $("#edIng").value;
      l.precioCompra = Number($("#edCosto").value) || 0;
      l.proveedor = $("#edProv").value.trim();
      save(); closeModal(); toast("Lote actualizado.", "success"); rerenderCurrent();
    });
  }

  /* ---------------------------------------------------------
     9) VISTA: CONTROL DE VENCIMIENTOS
  --------------------------------------------------------- */
  function renderVencimientos() {
    const m = metrics();
    const vencidos = state.lotes.filter((l) => estadoLote(l) === "vencido").sort((a, b) => parseFecha(a.fechaVencimiento) - parseFecha(b.fechaVencimiento));
    const porVencer = state.lotes.filter((l) => estadoLote(l) === "por_vencer").sort((a, b) => parseFecha(a.fechaVencimiento) - parseFecha(b.fechaVencimiento));

    const tabla = (arr, tipo) => arr.length ? `
      <table class="data">
        <thead><tr><th>Producto</th><th>Marca</th><th class="num">Cant.</th><th>Vence</th><th>${tipo === "v" ? "Vencido" : "Falta"}</th><th class="num">Pérdida pot.</th><th></th></tr></thead>
        <tbody>
          ${arr.map((l) => {
            const p = getProducto(l.productoId) || {};
            const perdida = (Number(l.cantidad) || 0) * (Number(l.precioCompra) || 0);
            return `<tr>
              <td><div class="cell-main">${escapeHtml(p.nombre || "—")}</div><div class="cell-sub">#${l.id.slice(-5)}</div></td>
              <td>${escapeHtml(p.marca || "—")}</td>
              <td class="num">${num(l.cantidad)}</td>
              <td>${fmtFecha(l.fechaVencimiento)}</td>
              <td>${vencInfo(l)}</td>
              <td class="num">${money(perdida)}</td>
              <td><div class="flex gap-8">
                <button class="btn btn--ghost btn--sm" data-merma="${l.id}" title="Marcar merma">🔻</button>
                <button class="btn btn--ghost btn--sm" data-del="${l.id}" title="Eliminar">🗑️</button>
              </div></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>` : emptyBlock(tipo === "v" ? "✅" : "🟢", tipo === "v" ? "Sin vencidos" : "Nada por vencer", tipo === "v" ? "No hay productos vencidos." : "No hay productos próximos a vencer.");

    view.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi__top"><span class="kpi__label">Vencidos</span><span class="kpi__icon kpi__icon--danger">⛔</span></div><div class="kpi__value text-danger">${num(m.vencidos)}</div><div class="kpi__hint">${num(m.uVencidos)} unidades · ${money(m.vVencidos)} en costo</div></div>
        <div class="kpi"><div class="kpi__top"><span class="kpi__label">Por vencer</span><span class="kpi__icon kpi__icon--warn">⏳</span></div><div class="kpi__value text-warn">${num(m.porVencer)}</div><div class="kpi__hint">en los próximos ${state.config.diasPorVencer} días</div></div>
        <div class="kpi"><div class="kpi__top"><span class="kpi__label">Umbral de alerta</span><span class="kpi__icon kpi__icon--info">⚙️</span></div>
          <div class="flex gap-8 items-center"><input type="number" min="1" class="input" id="venUmbral" value="${state.config.diasPorVencer}" style="width:90px"><span class="text-muted">días</span></div>
          <div class="kpi__hint">“por vencer / por mermar”</div></div>
        <div class="kpi"><div class="kpi__top"><span class="kpi__label">Acción rápida</span><span class="kpi__icon kpi__icon--merma">🔻</span></div>
          <button class="btn btn--soft btn--sm" id="btnMermarVencidos" style="margin-top:4px">Pasar vencidos a merma</button>
          <div class="kpi__hint">${num(m.vencidos)} lote(s)</div></div>
      </div>

      <div class="card" style="margin-bottom:18px">
        <div class="card__head"><h3>⛔ Productos vencidos</h3><span class="badge badge--danger badge--plain">${vencidos.length}</span></div>
        <div class="table-wrap">${tabla(vencidos, "v")}</div>
      </div>
      <div class="card">
        <div class="card__head"><h3>⏳ Por vencer (≤ ${state.config.diasPorVencer} días)</h3><span class="badge badge--warn badge--plain">${porVencer.length}</span></div>
        <div class="table-wrap">${tabla(porVencer, "pv")}</div>
      </div>`;

    $("#venUmbral").addEventListener("change", (e) => {
      const v = Math.max(1, Number(e.target.value) || 30);
      state.config.diasPorVencer = v; save(); renderVencimientos(); refreshBadges();
    });
    $("#btnMermarVencidos").addEventListener("click", () => {
      const ids = state.lotes.filter((l) => estadoLote(l) === "vencido").map((l) => l.id);
      if (!ids.length) { toast("No hay vencidos para mermar.", "info"); return; }
      modalMerma(ids);
    });
    $$("[data-merma]").forEach((b) => b.addEventListener("click", () => modalMerma([b.dataset.merma])));
    $$("[data-del]").forEach((b) => b.addEventListener("click", () =>
      confirmDialog("¿Eliminar este lote?", () => eliminarLotes([b.dataset.del]), { danger: true, confirmLabel: "Eliminar" })));
  }

  /* ---------------------------------------------------------
     10) VISTA: MERMAS
  --------------------------------------------------------- */
  function renderMermas() {
    const m = metrics();
    const mermados = state.lotes.filter((l) => l.mermado);
    const enRiesgo = state.lotes.filter((l) => estadoLote(l) === "por_vencer").sort((a, b) => parseFecha(a.fechaVencimiento) - parseFecha(b.fechaVencimiento));

    view.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi__top"><span class="kpi__label">Lotes mermados</span><span class="kpi__icon kpi__icon--merma">🔻</span></div><div class="kpi__value">${num(m.mermados)}</div><div class="kpi__hint">${num(m.uMermados)} unidades</div></div>
        <div class="kpi"><div class="kpi__top"><span class="kpi__label">Pérdida por merma</span><span class="kpi__icon kpi__icon--danger">💸</span></div><div class="kpi__value text-danger">−${money(m.perdidaMerma)}</div><div class="kpi__hint">valorizado al costo</div></div>
        <div class="kpi"><div class="kpi__top"><span class="kpi__label">En riesgo (por mermar)</span><span class="kpi__icon kpi__icon--warn">⚠️</span></div><div class="kpi__value text-warn">${num(enRiesgo.length)}</div><div class="kpi__hint">próximos a vencer</div></div>
      </div>

      <div class="card" style="margin-bottom:18px">
        <div class="card__head"><h3>🔻 Registro de mermas</h3></div>
        <div class="table-wrap">
          ${mermados.length ? `
          <table class="data">
            <thead><tr><th>Producto</th><th>Marca</th><th class="num">Cant.</th><th class="num">Pérdida</th><th>Motivo</th><th>Vencía</th><th></th></tr></thead>
            <tbody>${mermados.map((l) => {
              const p = getProducto(l.productoId) || {};
              return `<tr>
                <td><div class="cell-main">${escapeHtml(p.nombre || "—")}</div><div class="cell-sub">#${l.id.slice(-5)}</div></td>
                <td>${escapeHtml(p.marca || "—")}</td>
                <td class="num">${num(l.cantidad)}</td>
                <td class="num text-danger">−${money((Number(l.cantidad) || 0) * (Number(l.precioCompra) || 0))}</td>
                <td><span class="cell-sub">${escapeHtml(l.motivoMerma || "—")}</span></td>
                <td>${fmtFecha(l.fechaVencimiento)}</td>
                <td><div class="flex gap-8">
                  <button class="btn btn--ghost btn--sm" data-restore="${l.id}" title="Revertir merma">↩️</button>
                  <button class="btn btn--ghost btn--sm" data-del="${l.id}" title="Eliminar definitivo">🗑️</button>
                </div></td>
              </tr>`;
            }).join("")}</tbody>
          </table>` : emptyBlock("✨", "Sin mermas registradas", "Cuando marques un lote como merma aparecerá aquí.")}
        </div>
      </div>

      <div class="card">
        <div class="card__head"><h3>⚠️ Productos en riesgo de merma (por vencer)</h3><button class="btn btn--ghost btn--sm" data-goto="vencimientos">Ver vencimientos</button></div>
        <div class="table-wrap">
          ${enRiesgo.length ? `
          <table class="data">
            <thead><tr><th>Producto</th><th>Marca</th><th class="num">Cant.</th><th>Vence</th><th>Falta</th><th></th></tr></thead>
            <tbody>${enRiesgo.slice(0, 30).map((l) => {
              const p = getProducto(l.productoId) || {};
              return `<tr>
                <td><div class="cell-main">${escapeHtml(p.nombre || "—")}</div></td>
                <td>${escapeHtml(p.marca || "—")}</td>
                <td class="num">${num(l.cantidad)}</td>
                <td>${fmtFecha(l.fechaVencimiento)}</td>
                <td>${vencInfo(l)}</td>
                <td><button class="btn btn--ghost btn--sm" data-merma="${l.id}" title="Marcar merma">🔻</button></td>
              </tr>`;
            }).join("")}</tbody>
          </table>` : emptyBlock("🟢", "Nada en riesgo", "No hay productos próximos a vencer.")}
        </div>
      </div>`;

    $$("[data-restore]").forEach((b) => b.addEventListener("click", () => restaurarMerma([b.dataset.restore])));
    $$("[data-merma]").forEach((b) => b.addEventListener("click", () => modalMerma([b.dataset.merma])));
    $$("[data-del]").forEach((b) => b.addEventListener("click", () =>
      confirmDialog("¿Eliminar definitivamente este lote mermado?", () => eliminarLotes([b.dataset.del]), { danger: true, confirmLabel: "Eliminar" })));
  }

  /* ---------------------------------------------------------
     11) VISTA: CATÁLOGO DE PRODUCTOS
  --------------------------------------------------------- */
  let prodSearch = "";
  function renderProductos() {
    const q = prodSearch.toLowerCase();
    let prods = state.productos.slice();
    if (q) prods = prods.filter((p) => (p.nombre + " " + (p.marca || "") + " " + (p.categoria || "")).toLowerCase().includes(q));
    prods.sort((a, b) => a.nombre.localeCompare(b.nombre));

    view.innerHTML = `
      <div class="section-head">
        <div><h2>Catálogo</h2><p>Define productos, marcas y precios de venta. El stock se calcula desde los lotes.</p></div>
        <div class="row-actions">
          <button class="btn btn--soft" data-goto="carga">⬆ Importar</button>
          <button class="btn btn--primary" id="btnNuevoProd">➕ Nuevo producto</button>
        </div>
      </div>
      <div class="filters">
        <div class="search" style="flex:1;min-width:200px">
          <svg viewBox="0 0 24 24" class="search__icon"><path d="M15.5 14h-.8l-.3-.3a6.5 6.5 0 10-.7.7l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 110-9 4.5 4.5 0 010 9z"/></svg>
          <input type="search" id="prodSearch" placeholder="Buscar en catálogo…" value="${escapeHtml(prodSearch)}" style="width:100%">
        </div>
      </div>
      <div class="card"><div class="table-wrap">
        ${prods.length ? `
        <table class="data">
          <thead><tr><th>Producto</th><th>Marca</th><th>Categoría</th><th class="num">P. venta</th><th class="num">Stock</th><th class="num">Mínimo</th><th class="num">Lotes</th><th></th></tr></thead>
          <tbody>${prods.map((p) => {
            const st = stockVendible(p.id);
            const nLotes = lotesDeProducto(p.id).length;
            const bajo = Number(p.stockMinimo) > 0 && st <= Number(p.stockMinimo);
            return `<tr>
              <td><div class="cell-main">${escapeHtml(p.nombre)}</div><div class="cell-sub">${escapeHtml(p.unidad || "Unidad")}${p.codigoBarras ? " · " + escapeHtml(p.codigoBarras) : ""}</div></td>
              <td>${escapeHtml(p.marca || "—")}</td>
              <td>${escapeHtml(p.categoria || "—")}</td>
              <td class="num">${money(p.precioVenta)}</td>
              <td class="num"><span class="tag-stock ${bajo ? "text-warn" : ""}">${num(st)}</span></td>
              <td class="num muted">${p.stockMinimo ? num(p.stockMinimo) : "—"}</td>
              <td class="num">${nLotes}</td>
              <td><div class="flex gap-8">
                <button class="btn btn--ghost btn--sm" data-vlotes="${p.id}" title="Ver lotes">📦</button>
                <button class="btn btn--ghost btn--sm" data-edit="${p.id}" title="Editar">✏️</button>
                <button class="btn btn--ghost btn--sm" data-del="${p.id}" title="Eliminar">🗑️</button>
              </div></td>
            </tr>`;
          }).join("")}</tbody>
        </table>` : emptyBlock("📦", "Catálogo vacío", "Crea tu primer producto o impórtalos desde Excel.",
          `<button class="btn btn--primary" id="btnNuevoProd2">➕ Nuevo producto</button>`)}
      </div></div>`;

    $("#prodSearch").addEventListener("input", (e) => { prodSearch = e.target.value; renderProductos(); });
    const b1 = $("#btnNuevoProd"); if (b1) b1.addEventListener("click", () => modalProducto());
    const b2 = $("#btnNuevoProd2"); if (b2) b2.addEventListener("click", () => modalProducto());
    $$("[data-edit]").forEach((b) => b.addEventListener("click", () => modalProducto(b.dataset.edit)));
    $$("[data-vlotes]").forEach((b) => b.addEventListener("click", () => { invFilters = { q: getProducto(b.dataset.vlotes).nombre, marca: "", estado: "", sort: "venc_asc" }; navigate("inventario"); }));
    $$("[data-del]").forEach((b) => b.addEventListener("click", () => {
      const p = getProducto(b.dataset.del); const n = lotesDeProducto(p.id).length;
      confirmDialog(`¿Eliminar <strong>${escapeHtml(p.nombre)}</strong>?${n ? ` Se eliminarán también sus <strong>${n}</strong> lote(s).` : ""}`, () => {
        state.lotes = state.lotes.filter((l) => l.productoId !== p.id);
        state.productos = state.productos.filter((x) => x.id !== p.id);
        save(); toast("Producto eliminado.", "success"); renderProductos(); refreshBadges();
      }, { danger: true, confirmLabel: "Eliminar" });
    }));
  }

  function modalProducto(id) {
    const p = id ? getProducto(id) : null;
    const unidades = ["Unidad", "Caja", "Pack", "Kilogramo", "Litro", "Bolsa", "Botella", "Display"];
    openModal(`
      <div class="modal__head"><h3>${p ? "Editar producto" : "Nuevo producto"}</h3><button class="icon-btn" data-close>✕</button></div>
      <div class="modal__body">
        <div class="field"><label>Nombre <span class="req">*</span></label><input class="input" id="pNombre" value="${escapeHtml(p?.nombre || "")}" placeholder="Ej: Coca Cola 1.5L"></div>
        <div class="form-grid">
          <div class="field"><label>Marca</label><input class="input" id="pMarca" list="dlMarcas2" value="${escapeHtml(p?.marca || "")}" placeholder="Ej: Coca-Cola"></div>
          <div class="field"><label>Categoría</label><input class="input" id="pCat" value="${escapeHtml(p?.categoria || "")}" placeholder="Ej: Bebidas"></div>
          <div class="field"><label>Unidad</label><select class="select" id="pUnidad">${unidades.map((u) => `<option ${p?.unidad === u ? "selected" : ""}>${u}</option>`).join("")}</select></div>
          <div class="field"><label>Código de barras</label><input class="input" id="pCodigo" value="${escapeHtml(p?.codigoBarras || "")}" placeholder="Opcional"></div>
          <div class="field"><label>Precio de venta</label><input type="number" min="0" class="input" id="pVenta" value="${escapeHtml(p?.precioVenta || 0)}"></div>
          <div class="field"><label>Stock mínimo</label><input type="number" min="0" class="input" id="pMin" value="${escapeHtml(p?.stockMinimo || 0)}"></div>
        </div>
        <div class="field"><label>Descripción</label><textarea class="textarea" id="pDesc" placeholder="Detalle del producto…">${escapeHtml(p?.descripcion || "")}</textarea></div>
        <datalist id="dlMarcas2">${marcasUnicas().map((mk) => `<option value="${escapeHtml(mk)}"></option>`).join("")}</datalist>
      </div>
      <div class="modal__foot"><button class="btn btn--ghost" data-close>Cancelar</button><button class="btn btn--primary" id="pOk">${p ? "Guardar" : "Crear producto"}</button></div>`);
    $("#pOk").addEventListener("click", () => {
      const nombre = $("#pNombre").value.trim();
      if (!nombre) { $("#pNombre").classList.add("input--invalid"); toast("El nombre es obligatorio.", "error"); return; }
      const data = {
        nombre, marca: $("#pMarca").value.trim(), categoria: $("#pCat").value.trim(),
        unidad: $("#pUnidad").value, codigoBarras: $("#pCodigo").value.trim(),
        precioVenta: Number($("#pVenta").value) || 0, stockMinimo: Number($("#pMin").value) || 0,
        descripcion: $("#pDesc").value.trim(),
      };
      if (p) Object.assign(p, data);
      else state.productos.push(Object.assign({ id: uid("p"), creado: new Date().toISOString() }, data));
      save(); closeModal(); toast(p ? "Producto actualizado." : "Producto creado.", "success"); renderProductos();
    });
  }

  /* ---------------------------------------------------------
     12) VISTA: COMPRAS / CAMIONES
  --------------------------------------------------------- */
  function renderCompras() {
    const compras = [...state.compras].sort((a, b) => parseFecha(b.fecha) - parseFecha(a.fecha));
    view.innerHTML = `
      <div class="section-head">
        <div><h2>Compras y camiones</h2><p>Cada ingreso puede asociarse a una compra. Aquí ves proveedores y totales.</p></div>
        <button class="btn btn--primary" id="btnNuevaCompra">➕ Registrar compra</button>
      </div>
      <div class="card"><div class="table-wrap">
        ${compras.length ? `
        <table class="data">
          <thead><tr><th>Fecha</th><th>Proveedor</th><th>Documento</th><th>Camión / Transp.</th><th class="num">Ítems</th><th class="num">Unidades</th><th class="num">Total costo</th><th></th></tr></thead>
          <tbody>${compras.map((c) => {
            const items = state.lotes.filter((l) => l.compraId === c.id);
            const u = items.reduce((s, l) => s + (Number(l.cantidad) || 0), 0);
            const total = items.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.precioCompra) || 0), 0);
            return `<tr>
              <td>${fmtFecha(c.fecha)}</td>
              <td class="cell-main">${escapeHtml(c.proveedor || "—")}</td>
              <td class="muted">${escapeHtml(c.documento || "—")}</td>
              <td>${escapeHtml(c.patente || "—")}${c.transportista ? `<div class="cell-sub">${escapeHtml(c.transportista)}</div>` : ""}</td>
              <td class="num">${items.length}</td>
              <td class="num">${num(u)}</td>
              <td class="num">${money(total)}</td>
              <td><div class="flex gap-8">
                <button class="btn btn--ghost btn--sm" data-ver="${c.id}" title="Ver detalle">👁️</button>
                <button class="btn btn--ghost btn--sm" data-edit="${c.id}" title="Editar">✏️</button>
                <button class="btn btn--ghost btn--sm" data-del="${c.id}" title="Eliminar">🗑️</button>
              </div></td>
            </tr>`;
          }).join("")}</tbody>
        </table>` : emptyBlock("🚚", "Sin compras registradas", "Registra una compra o crea una al ingresar mercadería.",
          `<button class="btn btn--primary" id="btnNuevaCompra2">➕ Registrar compra</button>`)}
      </div></div>`;

    const b1 = $("#btnNuevaCompra"); if (b1) b1.addEventListener("click", () => modalCompra());
    const b2 = $("#btnNuevaCompra2"); if (b2) b2.addEventListener("click", () => modalCompra());
    $$("[data-edit]").forEach((b) => b.addEventListener("click", () => modalCompra(b.dataset.edit)));
    $$("[data-ver]").forEach((b) => b.addEventListener("click", () => modalDetalleCompra(b.dataset.ver)));
    $$("[data-del]").forEach((b) => b.addEventListener("click", () => {
      const items = state.lotes.filter((l) => l.compraId === b.dataset.del).length;
      confirmDialog(`¿Eliminar esta compra?${items ? ` Sus <strong>${items}</strong> lote(s) quedarán sin compra asociada (no se borran).` : ""}`, () => {
        state.lotes.forEach((l) => { if (l.compraId === b.dataset.del) l.compraId = ""; });
        state.compras = state.compras.filter((c) => c.id !== b.dataset.del);
        save(); toast("Compra eliminada.", "success"); renderCompras();
      }, { danger: true, confirmLabel: "Eliminar" });
    }));
  }

  function modalCompra(id) {
    const c = id ? state.compras.find((x) => x.id === id) : null;
    openModal(`
      <div class="modal__head"><h3>${c ? "Editar compra" : "Registrar compra / camión"}</h3><button class="icon-btn" data-close>✕</button></div>
      <div class="modal__body">
        <div class="form-grid">
          <div class="field"><label>Fecha <span class="req">*</span></label><input type="date" class="input" id="cFecha" value="${escapeHtml(c?.fecha || addDays(0))}"></div>
          <div class="field"><label>Proveedor <span class="req">*</span></label><input class="input" id="cProv" value="${escapeHtml(c?.proveedor || "")}" placeholder="Ej: Distribuidora Andina"></div>
          <div class="field"><label>N° documento / factura</label><input class="input" id="cDoc" value="${escapeHtml(c?.documento || "")}"></div>
          <div class="field"><label>Patente camión</label><input class="input" id="cPat" value="${escapeHtml(c?.patente || "")}"></div>
          <div class="field"><label>Transportista</label><input class="input" id="cTransp" value="${escapeHtml(c?.transportista || "")}"></div>
        </div>
        <div class="field"><label>Observación</label><textarea class="textarea" id="cObs">${escapeHtml(c?.observacion || "")}</textarea></div>
      </div>
      <div class="modal__foot"><button class="btn btn--ghost" data-close>Cancelar</button><button class="btn btn--primary" id="cOk">${c ? "Guardar" : "Registrar"}</button></div>`);
    $("#cOk").addEventListener("click", () => {
      const prov = $("#cProv").value.trim();
      if (!prov) { toast("El proveedor es obligatorio.", "error"); return; }
      const data = {
        fecha: $("#cFecha").value || addDays(0), proveedor: prov, documento: $("#cDoc").value.trim(),
        patente: $("#cPat").value.trim(), transportista: $("#cTransp").value.trim(), observacion: $("#cObs").value.trim(),
      };
      if (c) Object.assign(c, data);
      else state.compras.push(Object.assign({ id: uid("c"), creado: new Date().toISOString() }, data));
      save(); closeModal(); toast(c ? "Compra actualizada." : "Compra registrada.", "success"); renderCompras();
    });
  }

  function modalDetalleCompra(id) {
    const c = state.compras.find((x) => x.id === id); if (!c) return;
    const items = state.lotes.filter((l) => l.compraId === id);
    const total = items.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.precioCompra) || 0), 0);
    openModal(`
      <div class="modal__head"><h3>Detalle de compra</h3><button class="icon-btn" data-close>✕</button></div>
      <div class="modal__body">
        <div class="form-grid" style="margin-bottom:10px">
          <div><div class="cell-sub">Proveedor</div><div class="cell-main">${escapeHtml(c.proveedor || "—")}</div></div>
          <div><div class="cell-sub">Fecha</div><div class="cell-main">${fmtFecha(c.fecha)}</div></div>
          <div><div class="cell-sub">Documento</div><div class="cell-main">${escapeHtml(c.documento || "—")}</div></div>
          <div><div class="cell-sub">Camión</div><div class="cell-main">${escapeHtml(c.patente || "—")}</div></div>
        </div>
        ${c.observacion ? `<p class="text-muted">${escapeHtml(c.observacion)}</p>` : ""}
        <hr class="divider">
        ${items.length ? `<table class="data"><thead><tr><th>Producto</th><th class="num">Cant.</th><th>Vence</th><th class="num">Costo</th></tr></thead>
          <tbody>${items.map((l) => { const p = getProducto(l.productoId) || {}; return `<tr><td>${escapeHtml(p.nombre || "—")}</td><td class="num">${num(l.cantidad)}</td><td>${fmtFecha(l.fechaVencimiento)}</td><td class="num">${money((Number(l.cantidad) || 0) * (Number(l.precioCompra) || 0))}</td></tr>`; }).join("")}</tbody>
          <tfoot><tr><th colspan="3" style="text-align:right">Total</th><th class="num">${money(total)}</th></tr></tfoot></table>`
          : `<p class="text-muted">Esta compra no tiene lotes asociados todavía. Usa <strong>Ingreso de mercadería</strong> y selecciónala.</p>`}
      </div>
      <div class="modal__foot"><button class="btn btn--ghost" data-close>Cerrar</button><button class="btn btn--primary" id="dcIngreso">➕ Ingresar a esta compra</button></div>`);
    $("#dcIngreso").addEventListener("click", () => { closeModal(); navigate("ingreso"); setTimeout(() => { const sel = $("#ingCompra"); if (sel) sel.value = id; }, 50); });
  }

  /* ---------------------------------------------------------
     13) VISTA: CARGA MASIVA (EXCEL)
  --------------------------------------------------------- */
  const PLANTILLA_COLS = ["Producto", "Marca", "Categoria", "Descripcion", "Unidad", "CodigoBarras", "PrecioVenta", "Cantidad", "FechaVencimiento", "PrecioCompra", "Proveedor", "Documento", "FechaIngreso"];
  let importPreview = null;

  function renderCarga() {
    view.innerHTML = `
      <div class="section-head"><div><h2>Carga masiva con Excel</h2><p>Descarga la plantilla, complétala y súbela. Cada fila es un lote (producto + fecha + cantidad).</p></div></div>

      <div class="dash-grid">
        <div class="card">
          <div class="card__head"><h3>1 · Plantilla</h3></div>
          <div class="card__body">
            <p class="text-muted" style="margin-bottom:14px">Una fila por lote. Para el mismo producto con varias fechas, repite el nombre en filas distintas con su fecha y cantidad.</p>
            <div class="row-actions">
              <button class="btn btn--primary" id="btnPlantillaXlsx">⬇ Plantilla Excel (.xlsx)</button>
              <button class="btn btn--soft" id="btnPlantillaCsv">⬇ Plantilla CSV</button>
            </div>
            <hr class="divider">
            <p class="cell-sub">Columnas: ${PLANTILLA_COLS.join(", ")}.<br>Obligatorias: <strong>Producto</strong> y <strong>Cantidad</strong>. Fechas: AAAA-MM-DD o DD/MM/AAAA.</p>
          </div>
        </div>

        <div class="card">
          <div class="card__head"><h3>2 · Subir archivo</h3></div>
          <div class="card__body">
            <div class="drop-zone" id="dropZone">
              <div class="drop-zone__icon">📥</div>
              <div><strong>Arrastra tu archivo aquí</strong> o haz clic para buscar</div>
              <div class="cell-sub">.xlsx · .xls · .csv</div>
            </div>
            <input type="file" id="fileInput" accept=".xlsx,.xls,.csv" hidden>
          </div>
        </div>
      </div>

      <div class="card mt-16">
        <div class="card__head"><h3>Exportar datos actuales</h3></div>
        <div class="card__body row-actions">
          <button class="btn btn--soft" id="btnExportInv">⬇ Exportar inventario (.xlsx)</button>
          <button class="btn btn--soft" id="btnExportProd">⬇ Exportar catálogo (.xlsx)</button>
          <button class="btn btn--soft" id="btnExportCompras">⬇ Exportar compras (.xlsx)</button>
        </div>
      </div>

      <div id="previewArea" class="mt-24"></div>`;

    $("#btnPlantillaXlsx").addEventListener("click", descargarPlantillaXlsx);
    $("#btnPlantillaCsv").addEventListener("click", descargarPlantillaCsv);
    $("#btnExportInv").addEventListener("click", () => exportarLotes(state.lotes.map((l) => l.id)));
    $("#btnExportProd").addEventListener("click", exportarCatalogo);
    $("#btnExportCompras").addEventListener("click", exportarCompras);

    const dz = $("#dropZone"), fi = $("#fileInput");
    dz.addEventListener("click", () => fi.click());
    fi.addEventListener("change", (e) => { if (e.target.files[0]) leerArchivo(e.target.files[0]); });
    ["dragover", "dragenter"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("dragover"); }));
    ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("dragover"); }));
    dz.addEventListener("drop", (e) => { if (e.dataTransfer.files[0]) leerArchivo(e.dataTransfer.files[0]); });
  }

  function ensureXLSX() {
    if (!window.XLSX) { toast("La librería de Excel no cargó. Verifica tu conexión o usa CSV.", "error"); return false; }
    return true;
  }

  function descargarPlantillaXlsx() {
    if (!ensureXLSX()) return;
    const ej = [
      { Producto: "Coca Cola 1.5L", Marca: "Coca-Cola", Categoria: "Bebidas", Descripcion: "Bebida gaseosa", Unidad: "Botella", CodigoBarras: "7801234567890", PrecioVenta: 1800, Cantidad: 50, FechaVencimiento: addDays(60), PrecioCompra: 1100, Proveedor: "Distribuidora Andina", Documento: "F-1001", FechaIngreso: addDays(0) },
      { Producto: "Coca Cola 1.5L", Marca: "Coca-Cola", Categoria: "Bebidas", Descripcion: "Bebida gaseosa", Unidad: "Botella", CodigoBarras: "7801234567890", PrecioVenta: 1800, Cantidad: 30, FechaVencimiento: addDays(120), PrecioCompra: 1100, Proveedor: "Distribuidora Andina", Documento: "F-1001", FechaIngreso: addDays(0) },
      { Producto: "Leche Entera 1L", Marca: "Soprole", Categoria: "Lácteos", Descripcion: "Leche larga vida", Unidad: "Caja", CodigoBarras: "", PrecioVenta: 1200, Cantidad: 40, FechaVencimiento: addDays(15), PrecioCompra: 850, Proveedor: "Soprole S.A.", Documento: "F-2002", FechaIngreso: addDays(0) },
    ];
    const ws = XLSX.utils.json_to_sheet(ej, { header: PLANTILLA_COLS });
    ws["!cols"] = PLANTILLA_COLS.map((c) => ({ wch: Math.max(12, c.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Plantilla");
    XLSX.writeFile(wb, "plantilla_bodega.xlsx");
    toast("Plantilla descargada.", "success");
  }
  function descargarPlantillaCsv() {
    const ej = [PLANTILLA_COLS.join(",")];
    ej.push(`Coca Cola 1.5L,Coca-Cola,Bebidas,Bebida gaseosa,Botella,7801234567890,1800,50,${addDays(60)},1100,Distribuidora Andina,F-1001,${addDays(0)}`);
    ej.push(`Coca Cola 1.5L,Coca-Cola,Bebidas,Bebida gaseosa,Botella,7801234567890,1800,30,${addDays(120)},1100,Distribuidora Andina,F-1001,${addDays(0)}`);
    descargarTexto("plantilla_bodega.csv", "﻿" + ej.join("\r\n"), "text/csv");
    toast("Plantilla CSV descargada.", "success");
  }

  function leerArchivo(file) {
    if (!ensureXLSX()) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
        prepararPreview(json);
      } catch (err) { toast("No se pudo leer el archivo: " + err.message, "error"); }
    };
    reader.readAsArrayBuffer(file);
  }

  // Busca una columna sin importar mayúsculas/acentos/espacios
  function pick(row, names) {
    const keys = Object.keys(row);
    for (const n of names) {
      const k = keys.find((k) => k.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s|_/g, "") === n);
      if (k != null) return row[k];
    }
    return "";
  }

  function prepararPreview(json) {
    if (!json.length) { toast("El archivo no tiene filas.", "warn"); return; }
    const filas = json.map((row, i) => {
      const nombre = String(pick(row, ["producto", "nombre"]) || "").trim();
      const cantidad = Number(String(pick(row, ["cantidad", "cant"]) || "").replace(/[^\d.-]/g, ""));
      const venc = normalizarFecha(pick(row, ["fechavencimiento", "vencimiento", "vence"]));
      const f = {
        idx: i + 2, nombre,
        marca: String(pick(row, ["marca"]) || "").trim(),
        categoria: String(pick(row, ["categoria"]) || "").trim(),
        descripcion: String(pick(row, ["descripcion"]) || "").trim(),
        unidad: String(pick(row, ["unidad"]) || "Unidad").trim() || "Unidad",
        codigoBarras: String(pick(row, ["codigobarras", "codigo", "barra"]) || "").trim(),
        precioVenta: Number(String(pick(row, ["precioventa", "venta"]) || "").replace(/[^\d.-]/g, "")) || 0,
        cantidad: isNaN(cantidad) ? 0 : cantidad,
        fechaVencimiento: venc,
        precioCompra: Number(String(pick(row, ["preciocompra", "compra", "costo"]) || "").replace(/[^\d.-]/g, "")) || 0,
        proveedor: String(pick(row, ["proveedor"]) || "").trim(),
        documento: String(pick(row, ["documento", "factura"]) || "").trim(),
        fechaIngreso: normalizarFecha(pick(row, ["fechaingreso", "ingreso"])) || addDays(0),
      };
      f.errores = [];
      if (!f.nombre) f.errores.push("Sin producto");
      if (!(f.cantidad > 0)) f.errores.push("Cantidad inválida");
      return f;
    });
    importPreview = filas;
    const ok = filas.filter((f) => !f.errores.length).length;
    const bad = filas.length - ok;

    $("#previewArea").innerHTML = `
      <div class="card">
        <div class="card__head">
          <h3>Vista previa de importación</h3>
          <div class="row-actions">
            <span class="badge badge--ok badge--plain">${ok} válidas</span>
            ${bad ? `<span class="badge badge--danger badge--plain">${bad} con error</span>` : ""}
            <button class="btn btn--ghost btn--sm" id="impCancel">Cancelar</button>
            <button class="btn btn--primary btn--sm" id="impConfirm" ${ok ? "" : "disabled"}>✔ Importar ${ok} fila(s)</button>
          </div>
        </div>
        <div class="table-wrap" style="max-height:460px;overflow:auto">
          <table class="data">
            <thead><tr><th>Fila</th><th>Producto</th><th>Marca</th><th class="num">Cant.</th><th>Vence</th><th class="num">Costo</th><th>Proveedor</th><th>Estado</th></tr></thead>
            <tbody>${filas.map((f) => `
              <tr style="${f.errores.length ? "background:var(--danger-soft)" : ""}">
                <td class="muted">${f.idx}</td>
                <td class="cell-main">${escapeHtml(f.nombre || "—")}</td>
                <td>${escapeHtml(f.marca || "—")}</td>
                <td class="num">${num(f.cantidad)}</td>
                <td>${f.fechaVencimiento ? fmtFecha(f.fechaVencimiento) : "<span class='muted'>—</span>"}</td>
                <td class="num">${money(f.precioCompra)}</td>
                <td>${escapeHtml(f.proveedor || "—")}</td>
                <td>${f.errores.length ? `<span class="badge badge--danger">${f.errores.join(", ")}</span>` : `<span class="badge badge--ok">OK</span>`}</td>
              </tr>`).join("")}</tbody>
          </table>
        </div>
      </div>`;
    $("#impConfirm").addEventListener("click", confirmarImport);
    $("#impCancel").addEventListener("click", () => { importPreview = null; $("#previewArea").innerHTML = ""; });
    $("#previewArea").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function confirmarImport() {
    if (!importPreview) return;
    const validas = importPreview.filter((f) => !f.errores.length);
    let nuevosProd = 0, nuevosLotes = 0, nuevasCompras = 0;
    const comprasCache = {};

    validas.forEach((f) => {
      // producto
      let prod = state.productos.find((p) => p.nombre.toLowerCase() === f.nombre.toLowerCase() && (p.marca || "").toLowerCase() === f.marca.toLowerCase())
        || state.productos.find((p) => p.nombre.toLowerCase() === f.nombre.toLowerCase());
      if (!prod) {
        prod = { id: uid("p"), nombre: f.nombre, marca: f.marca, categoria: f.categoria, descripcion: f.descripcion, unidad: f.unidad, codigoBarras: f.codigoBarras, precioVenta: f.precioVenta, stockMinimo: 0, creado: new Date().toISOString() };
        state.productos.push(prod); nuevosProd++;
      } else if (f.precioVenta && !prod.precioVenta) { prod.precioVenta = f.precioVenta; }

      // compra (agrupa por proveedor+documento+fecha)
      let compraId = "";
      if (f.proveedor) {
        const key = (f.proveedor + "|" + f.documento + "|" + f.fechaIngreso).toLowerCase();
        if (comprasCache[key]) compraId = comprasCache[key];
        else {
          const existente = state.compras.find((c) => (c.proveedor || "").toLowerCase() === f.proveedor.toLowerCase() && (c.documento || "") === f.documento && c.fecha === f.fechaIngreso);
          if (existente) compraId = existente.id;
          else { const c = { id: uid("c"), fecha: f.fechaIngreso, proveedor: f.proveedor, documento: f.documento, patente: "", transportista: "", observacion: "Importado", creado: new Date().toISOString() }; state.compras.push(c); compraId = c.id; nuevasCompras++; }
          comprasCache[key] = compraId;
        }
      }
      state.lotes.push({ id: uid("l"), productoId: prod.id, cantidad: f.cantidad, fechaVencimiento: f.fechaVencimiento, fechaIngreso: f.fechaIngreso, precioCompra: f.precioCompra, proveedor: f.proveedor, compraId, mermado: false, motivoMerma: "", creado: new Date().toISOString() });
      nuevosLotes++;
    });

    save();
    importPreview = null;
    toast(`Importación lista: ${nuevosLotes} lote(s), ${nuevosProd} producto(s) nuevo(s), ${nuevasCompras} compra(s).`, "success");
    navigate("inventario");
  }

  /* ----- Exportaciones ----- */
  function exportarLotes(ids) {
    if (!ensureXLSX()) return;
    const set = new Set(ids);
    const data = state.lotes.filter((l) => set.has(l.id)).map((l) => {
      const p = getProducto(l.productoId) || {};
      return {
        Producto: p.nombre || "", Marca: p.marca || "", Categoria: p.categoria || "", Unidad: p.unidad || "",
        Cantidad: l.cantidad, PrecioCompra: l.precioCompra, PrecioVenta: p.precioVenta || 0,
        FechaVencimiento: l.fechaVencimiento || "", FechaIngreso: l.fechaIngreso || "",
        Estado: ESTADOS[estadoLote(l)].label, Proveedor: l.proveedor || "", Lote: l.id,
      };
    });
    if (!data.length) { toast("No hay lotes para exportar.", "warn"); return; }
    exportarHoja(data, "Inventario", "inventario_bodega.xlsx");
  }
  function exportarCatalogo() {
    if (!ensureXLSX()) return;
    const data = state.productos.map((p) => ({
      Producto: p.nombre, Marca: p.marca || "", Categoria: p.categoria || "", Unidad: p.unidad || "",
      CodigoBarras: p.codigoBarras || "", PrecioVenta: p.precioVenta || 0, StockMinimo: p.stockMinimo || 0,
      StockActual: stockVendible(p.id), Lotes: lotesDeProducto(p.id).length,
    }));
    if (!data.length) { toast("Catálogo vacío.", "warn"); return; }
    exportarHoja(data, "Catalogo", "catalogo_bodega.xlsx");
  }
  function exportarCompras() {
    if (!ensureXLSX()) return;
    const data = state.compras.map((c) => {
      const items = state.lotes.filter((l) => l.compraId === c.id);
      return { Fecha: c.fecha, Proveedor: c.proveedor, Documento: c.documento || "", Patente: c.patente || "", Transportista: c.transportista || "", Items: items.length, Unidades: items.reduce((s, l) => s + (Number(l.cantidad) || 0), 0), TotalCosto: items.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.precioCompra) || 0), 0) };
    });
    if (!data.length) { toast("No hay compras.", "warn"); return; }
    exportarHoja(data, "Compras", "compras_bodega.xlsx");
  }
  function exportarHoja(data, sheet, filename) {
    const ws = XLSX.utils.json_to_sheet(data);
    const cols = Object.keys(data[0] || {});
    ws["!cols"] = cols.map((c) => ({ wch: Math.max(12, c.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheet);
    XLSX.writeFile(wb, filename);
    toast("Archivo exportado.", "success");
  }
  function descargarTexto(filename, contenido, mime) {
    const blob = new Blob([contenido], { type: mime || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------------------------------------------------------
     14) VISTA: CONFIGURACIÓN
  --------------------------------------------------------- */
  function renderConfig() {
    const m = metrics();
    view.innerHTML = `
      <div class="dash-grid">
        <div class="card">
          <div class="card__head"><h3>Preferencias</h3></div>
          <div class="card__body">
            <div class="field">
              <label>Días de alerta “por vencer / por mermar”</label>
              <div class="flex gap-8 items-center"><input type="number" min="1" class="input" id="cfgDias" value="${state.config.diasPorVencer}" style="width:120px"><span class="text-muted">días antes del vencimiento</span></div>
              <span class="field-hint">Un lote se marca “por vencer” cuando le queda este número de días o menos.</span>
            </div>
            <hr class="divider">
            <div class="field">
              <label>Tema de la interfaz</label>
              <div class="row-actions">
                <button class="chip-toggle" data-tema="light">☀️ Claro</button>
                <button class="chip-toggle" data-tema="dark">🌙 Oscuro</button>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card__head"><h3>Datos y respaldo</h3></div>
          <div class="card__body">
            <p class="text-muted" style="margin-bottom:12px">Tienes <strong>${num(m.productos)}</strong> productos, <strong>${num(state.lotes.length)}</strong> lotes y <strong>${num(state.compras.length)}</strong> compras guardados en este navegador.</p>
            <div class="row-actions" style="margin-bottom:12px">
              <button class="btn btn--soft" id="cfgBackup">⬇ Descargar respaldo (.json)</button>
              <button class="btn btn--soft" id="cfgRestore">⬆ Restaurar respaldo</button>
              <input type="file" id="restoreFile" accept=".json" hidden>
            </div>
            <hr class="divider">
            <div class="row-actions">
              <button class="btn btn--ghost" id="cfgSeed">🌱 Cargar datos de ejemplo</button>
              <button class="btn btn--danger" id="cfgWipe">🗑️ Borrar todos los datos</button>
            </div>
            <span class="field-hint" style="display:block;margin-top:10px">⚠️ Los datos se guardan localmente en este equipo/navegador. Descarga respaldos con frecuencia.</span>
          </div>
        </div>
      </div>`;

    $("#cfgDias").addEventListener("change", (e) => { state.config.diasPorVencer = Math.max(1, Number(e.target.value) || 30); save(); toast("Umbral actualizado.", "success"); refreshBadges(); });
    $$("[data-tema]").forEach((b) => { b.classList.toggle("active", currentTheme() === b.dataset.tema); b.addEventListener("click", () => setTheme(b.dataset.tema)); });
    $("#cfgBackup").addEventListener("click", () => descargarTexto(`respaldo_bodega_${addDays(0)}.json`, JSON.stringify(state, null, 2), "application/json"));
    $("#cfgRestore").addEventListener("click", () => $("#restoreFile").click());
    $("#restoreFile").addEventListener("change", (e) => {
      const file = e.target.files[0]; if (!file) return;
      const r = new FileReader();
      r.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (!data.productos || !data.lotes) throw new Error("Formato no válido");
          confirmDialog("¿Reemplazar todos los datos actuales por el respaldo?", () => {
            state = Object.assign({ productos: [], lotes: [], compras: [], config: { diasPorVencer: 30 } }, data);
            save(); toast("Respaldo restaurado.", "success"); navigate("dashboard");
          }, { danger: true, confirmLabel: "Restaurar" });
        } catch (err) { toast("Archivo inválido: " + err.message, "error"); }
      };
      r.readAsText(file);
    });
    $("#cfgSeed").addEventListener("click", () => confirmDialog("Esto agregará productos y lotes de ejemplo a tus datos actuales. ¿Continuar?", () => { seed(true); save(); toast("Datos de ejemplo cargados.", "success"); navigate("dashboard"); }));
    $("#cfgWipe").addEventListener("click", () => confirmDialog("¿Borrar <strong>todos</strong> los productos, lotes y compras? Esta acción no se puede deshacer.", () => { state.productos = []; state.lotes = []; state.compras = []; save(); toast("Datos borrados.", "success"); navigate("dashboard"); }, { danger: true, confirmLabel: "Borrar todo" }));
  }

  /* ---------------------------------------------------------
     15) TEMA (claro / oscuro)
  --------------------------------------------------------- */
  function currentTheme() { return document.documentElement.getAttribute("data-theme") || "light"; }
  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    state.config.tema = t; save();
    if (currentView === "config") $$("[data-tema]").forEach((b) => b.classList.toggle("active", b.dataset.tema === t));
  }

  /* ---------------------------------------------------------
     16) RE-RENDER ACTUAL
  --------------------------------------------------------- */
  function rerenderCurrent() { VIEWS[currentView].render(); refreshBadges(); }

  /* ---------------------------------------------------------
     17) DATOS DE EJEMPLO
  --------------------------------------------------------- */
  function seed(append = false) {
    if (!append) { state.productos = []; state.lotes = []; state.compras = []; }
    const compra1 = { id: uid("c"), fecha: addDays(-3), proveedor: "Distribuidora Andina", documento: "F-10234", patente: "KLRT-45", transportista: "Juan Pérez", observacion: "", creado: new Date().toISOString() };
    const compra2 = { id: uid("c"), fecha: addDays(-1), proveedor: "Soprole S.A.", documento: "F-55012", patente: "JHGF-22", transportista: "María Soto", observacion: "", creado: new Date().toISOString() };
    state.compras.push(compra1, compra2);

    const defs = [
      { nombre: "Coca Cola 1.5L", marca: "Coca-Cola", categoria: "Bebidas", unidad: "Botella", venta: 1800, min: 24,
        lotes: [[60, 40, 1100, compra1.id], [120, 30, 1100, compra1.id], [8, 12, 1100, compra1.id]] },
      { nombre: "Coca Cola 3L", marca: "Coca-Cola", categoria: "Bebidas", unidad: "Botella", venta: 2500, min: 12,
        lotes: [[200, 20, 1600, compra1.id], [4, 6, 1600, compra1.id]] },
      { nombre: "Leche Entera 1L", marca: "Soprole", categoria: "Lácteos", unidad: "Caja", venta: 1200, min: 30,
        lotes: [[15, 50, 850, compra2.id], [-2, 10, 850, compra2.id]] },
      { nombre: "Yogurt Frutilla 150g", marca: "Soprole", categoria: "Lácteos", unidad: "Pack", venta: 600, min: 20,
        lotes: [[6, 24, 380, compra2.id], [-5, 8, 380, compra2.id]] },
      { nombre: "Arroz Grano Largo 1kg", marca: "Tucapel", categoria: "Abarrotes", unidad: "Bolsa", venta: 1500, min: 15,
        lotes: [[400, 60, 950, compra1.id]] },
      { nombre: "Fideos Spaghetti 400g", marca: "Carozzi", categoria: "Abarrotes", unidad: "Bolsa", venta: 900, min: 18,
        lotes: [[300, 45, 520, compra1.id], [25, 15, 520, compra1.id]] },
      { nombre: "Detergente Polvo 1kg", marca: "Omo", categoria: "Limpieza", unidad: "Bolsa", venta: 3500, min: 8,
        lotes: [[600, 16, 2300, compra1.id]] },
      { nombre: "Pan de Molde Grande", marca: "Ideal", categoria: "Panadería", unidad: "Bolsa", venta: 2000, min: 10,
        lotes: [[3, 14, 1300, compra2.id], [-1, 5, 1300, compra2.id]] },
    ];

    defs.forEach((d) => {
      const prod = { id: uid("p"), nombre: d.nombre, marca: d.marca, categoria: d.categoria, descripcion: "", unidad: d.unidad, codigoBarras: "", precioVenta: d.venta, stockMinimo: d.min, creado: new Date().toISOString() };
      state.productos.push(prod);
      d.lotes.forEach((lt) => {
        const compra = state.compras.find((c) => c.id === lt[3]);
        state.lotes.push({ id: uid("l"), productoId: prod.id, cantidad: lt[1], fechaVencimiento: addDays(lt[0]), fechaIngreso: compra ? compra.fecha : addDays(-2), precioCompra: lt[2], proveedor: compra ? compra.proveedor : "", compraId: lt[3], mermado: false, motivoMerma: "", creado: new Date().toISOString() });
      });
    });
    // un par de mermas de ejemplo
    const algunVencido = state.lotes.find((l) => diasHasta(l.fechaVencimiento) < 0);
    if (algunVencido) { algunVencido.mermado = true; algunVencido.motivoMerma = "Vencido"; }
  }

  /* ---------------------------------------------------------
     18) BÚSQUEDA GLOBAL + EVENTOS GLOBALES
  --------------------------------------------------------- */
  function wireGlobal() {
    // Navegación del sidebar
    $$(".nav__item").forEach((n) => n.addEventListener("click", () => navigate(n.dataset.view)));
    // Delegación: cualquier elemento con data-goto y botones data-close
    document.addEventListener("click", (e) => {
      const goto = e.target.closest("[data-goto]");
      if (goto) { navigate(goto.dataset.goto); return; }
      const close = e.target.closest("[data-close]");
      if (close) { closeModal(); }
    });
    // Esc cierra modales
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

    // Tema
    $("#btnTheme").addEventListener("click", () => setTheme(currentTheme() === "dark" ? "light" : "dark"));
    // Respaldo desde sidebar
    $("#btnBackup").addEventListener("click", () => descargarTexto(`respaldo_bodega_${addDays(0)}.json`, JSON.stringify(state, null, 2), "application/json"));

    // Búsqueda global → inventario
    const gs = $("#globalSearch");
    gs.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { invFilters = { q: gs.value.trim(), marca: "", estado: "", sort: "venc_asc" }; navigate("inventario"); }
    });

    // Sidebar móvil
    $("#btnOpenSidebar").addEventListener("click", openSidebar);
    $("#btnCloseSidebar").addEventListener("click", closeSidebar);
    $("#sidebarOverlay").addEventListener("click", closeSidebar);
  }
  function openSidebar() { $("#sidebar").classList.add("open"); $("#sidebarOverlay").classList.add("show"); }
  function closeSidebar() { $("#sidebar").classList.remove("open"); $("#sidebarOverlay").classList.remove("show"); }

  /* ---------------------------------------------------------
     19) INICIALIZACIÓN
  --------------------------------------------------------- */
  function init() {
    const had = load();
    if (!had) { seed(false); save(); }
    // Tema: guardado > preferencia del sistema > claro
    let tema = state.config.tema;
    if (!tema) tema = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", tema);
    state.config.tema = tema;

    wireGlobal();
    navigate("dashboard");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
