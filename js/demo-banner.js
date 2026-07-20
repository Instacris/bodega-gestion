/* ============================================================
   BODEGA · Aviso de modo demostración (para el portafolio)

   Esta app guarda todo en el navegador de cada visitante
   (localStorage), así que los cambios de una persona NUNCA los
   ve otra ni afectan la versión original. Este aviso lo deja
   claro y ofrece un botón para volver todo a cero.
   ============================================================ */
(function () {
  "use strict";

  /* Borra los datos de la demo (todo lo que empieza con "bodega.") */
  function reiniciar() {
    try {
      Object.keys(localStorage)
        .filter(function (k) { return /^bodega\./.test(k); })
        .forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* sin storage: nada que borrar */ }
    location.reload();
  }

  function montar() {
    if (document.querySelector(".demo-banner")) return;

    var st = document.createElement("style");
    st.textContent =
      ".demo-banner{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;" +
      "display:flex;align-items:center;gap:12px;max-width:calc(100vw - 24px);" +
      "padding:9px 10px 9px 15px;border-radius:999px;background:#0f172a;color:#e2e8f0;" +
      "font-size:13px;font-weight:500;box-shadow:0 12px 30px -10px rgba(0,0,0,.5);" +
      "border:1px solid rgba(255,255,255,.12);font-family:inherit;}" +
      ".demo-banner b{color:#2dd4bf;font-weight:700;}.demo-banner .dm-txt{opacity:.85;}" +
      ".demo-banner button{border:0;cursor:pointer;border-radius:999px;padding:7px 14px;" +
      "font:inherit;font-weight:600;background:#0d9488;color:#fff;white-space:nowrap;" +
      "transition:background .18s cubic-bezier(.23,1,.32,1),transform .15s cubic-bezier(.23,1,.32,1);}" +
      ".demo-banner button:hover{background:#0f766e;}.demo-banner button:active{transform:scale(.96);}" +
      "@media (max-width:560px){.demo-banner .dm-txt{display:none;}}";
    document.head.appendChild(st);

    var b = document.createElement("div");
    b.className = "demo-banner";
    b.innerHTML =
      '<span>🔎</span>' +
      '<span class="dm-txt"><b>MODO DEMO</b> · los cambios se guardan solo en este navegador</span>' +
      '<button type="button">↺ Reiniciar</button>';
    document.body.appendChild(b);
    b.querySelector("button").addEventListener("click", reiniciar);
  }

  if (document.readyState !== "loading") montar();
  else document.addEventListener("DOMContentLoaded", montar);
})();
