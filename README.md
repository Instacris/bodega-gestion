# 📦 Bodega · Gestión de Mercadería

Aplicación web para administrar la mercadería de una bodega, con **foco en el control de vencimientos**, stock, mermas, compras/camiones y cargas masivas por Excel. Pensada para **personal administrativo**.

No requiere instalación ni internet (salvo la primera descarga ya incluida de la librería de Excel). Funciona con solo abrir un archivo.

---

## ▶️ Cómo abrir la aplicación

**Opción A — Doble clic (lo más simple):**
1. Abre la carpeta `BodegaGestion`.
2. Haz doble clic en **`index.html`**. Se abrirá en tu navegador.

**Opción B — Servidor local (recomendado para uso diario):**
Algunos navegadores limitan funciones cuando se abre un archivo directamente. Para evitarlo:
1. Haz clic derecho en **`serve.ps1`** → **Ejecutar con PowerShell**.
   - Si Windows lo bloquea, abre PowerShell en la carpeta y ejecuta:
     `powershell -ExecutionPolicy Bypass -File serve.ps1`
2. Abre tu navegador en **http://localhost:8123/**
3. Para cerrar el servidor, cierra la ventana de PowerShell.

> 💡 Puedes crear un acceso directo a `index.html` (o a `http://localhost:8123/`) en el escritorio.

---

## 🧭 Qué incluye

| Sección | Para qué sirve |
|---|---|
| **Panel de control** | Resumen: stock, valor del inventario, vencidos, por vencer, mermas y alertas de stock bajo. |
| **Ingreso de mercadería** | Registrar llegadas. Permite **varias fechas de vencimiento para el mismo producto** (ver abajo). |
| **Inventario / Lotes** | Todos los lotes, con filtros por marca/estado y **acciones masivas** (seleccionar, mermar, eliminar, exportar). |
| **Vencimientos** | Productos **vencidos** y **por vencer**, con pérdida potencial y umbral configurable. |
| **Mermas** | Registro de pérdidas y productos **en riesgo de merma** (por vencer). |
| **Catálogo de productos** | Definir productos, marcas, categorías y **precios de venta**. El stock se calcula solo. |
| **Compras / Camiones** | Registro de proveedores, documentos, patente del camión y total por compra. |
| **Carga masiva (Excel)** | Importar/exportar con planillas `.xlsx` o `.csv`. |
| **Configuración** | Días de alerta, tema claro/oscuro, respaldos y borrado de datos. |

---

## 🥤 Solución al caso "mismo producto, distintas fechas de vencimiento"

El sistema separa **Producto** (el artículo del catálogo: *Coca Cola 1.5L*) de sus **Lotes** (cada llegada con su propia fecha y cantidad). Así, un mismo producto puede tener muchos lotes con vencimientos diferentes, y el stock se suma automáticamente.

**Para ingresar cómodamente:**
1. Ve a **Ingreso de mercadería**.
2. Escribe el producto (ej. *Coca Cola 1.5L*), cantidad, fecha de vencimiento y precio de compra.
3. Pulsa **⧉ Duplicar** para repetir el mismo producto: solo cambias la fecha y la cantidad.
4. Repite por cada vencimiento distinto y pulsa **✔ Confirmar ingreso**.

**Para cargas/eliminaciones masivas:**
- **Carga masiva (Excel):** una fila por lote. Para el mismo producto con varias fechas, repite el nombre en filas distintas. Descarga la **plantilla** desde la sección.
- **Eliminación masiva:** en **Inventario**, marca las casillas de los lotes y usa la barra de acciones (Eliminar / Marcar merma / Exportar). También hay un botón para **pasar todos los vencidos a merma** de una vez.

---

## 📊 Estados de un lote

- 🟢 **Vigente** — lejos de vencer.
- 🟡 **Por vencer** — le quedan *N* días o menos (configurable; también significa "por mermar").
- 🔴 **Vencido** — pasó su fecha.
- 🟣 **Mermado** — marcado como pérdida (sale del stock vendible).

---

## 💾 Sobre los datos

- La información se guarda **localmente en tu navegador** (no se sube a internet).
- ⚠️ Si cambias de navegador/equipo o limpias datos del navegador, no se verá. **Descarga respaldos** con frecuencia:
  - Botón **Respaldar datos** (menú lateral) o **Configuración → Descargar respaldo (.json)**.
  - Para mover datos a otro equipo: respalda el `.json` y usa **Restaurar respaldo**.
- También puedes exportar a Excel para tener una copia en planilla.

---

## 🧩 Estructura del proyecto

```
BodegaGestion/
├── index.html          → página principal
├── css/styles.css      → estilos (tema claro/oscuro)
├── js/app.js           → toda la lógica de la aplicación
├── lib/xlsx.full.min.js→ librería para leer/escribir Excel (offline)
├── serve.ps1           → servidor local opcional (sin instalar nada)
└── README.md
```

Hecho con HTML, CSS y JavaScript puro (sin frameworks ni instalación).
