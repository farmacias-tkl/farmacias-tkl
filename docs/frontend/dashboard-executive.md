# Dashboard Ejecutivo — frontend

Este documento describe la implementación del dashboard ejecutivo
(`/executive`): estructura de componentes, decisiones UX, manejo de
fechas en zona horaria Argentina, lógica de stale, responsive, filtros,
y cómo se conecta con la DB.

---

## Vista general

URL pública (producción): `https://dashboard.YOUR_DOMAIN/executive`.
También accesible desde la operativa con OWNER vía link en el TopBar.

```
┌─────────────────────────────────────────────────────┐
│  TopBar — usuario, switch operativa, branch filter  │
├─────────────────────────────────────────────────────┤
│  AlertBanner — banners de stale (saldos / ventas)   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  KPICards — 5 KPIs principales                       │
│   ┌───┬───┬───┬───┬───┐                              │
│   │$  │$  │U  │T  │$  │                              │
│   └───┴───┴───┴───┴───┘                              │
│                                                     │
│  BalanceTable — saldos bancarios por sucursal       │
│   - Expandible por banco/cuenta                      │
│                                                     │
│  SalesTable — ventas del día por sucursal           │
│   - Filtros globales OS / Vendedor                   │
│   - Expandible por OS y Vendedor (tabs)              │
│   - Mobile: fila compacta, abreviada                 │
│                                                     │
│  ComparativeSection — comparativos vs año anterior  │
│   - Períodos preset (7d/14d/21d/30d/3m/6m/12m)       │
│   - Período custom (4 fechas)                        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## Estructura de componentes

```
src/app/(executive)/
├── layout.tsx                      ← layout wrapper, auth check
└── executive/
    └── page.tsx                    ← Server Component, queries Prisma

src/components/executive/
├── ExecutiveDashboard.tsx          ← orquestador client-side
├── KPICard.tsx                     ← cada KPI card
├── BalanceTable.tsx                ← saldos bancarios
├── SalesTable.tsx                  ← ventas (con expand/collapse y filtros)
├── ComparativeSection.tsx          ← comparativos
└── AlertBanner.tsx                 ← banner de stale
```

### `executive/page.tsx` — Server Component

Hace las queries Prisma server-side y arma el `data` para pasar al
componente cliente.

Responsabilidades:
1. **Auth**: verifica sesión, redirige si no hay (middleware ya gateó pero defensivo).
2. **TZ Argentina**: usa `getArtToday()` para anclar todas las queries al día actual ART.
3. **Carga balances**: `bankBalanceSnapshot.findMany({ snapshotDate: today })`. Si vacío, fallback al último snapshot disponible.
4. **Stale detection**: si fallback se usó pero el último snap es de ayer → no es stale (legítimo).
5. **Carga ventas**: análogo, con filtros por sucursal vía `branchId` query param.
6. **Construye `data`** con KPIs agregados, balances por sucursal, ventas por sucursal, alertas, etc.
7. **Renderiza `<ExecutiveDashboard data={data} ...>`**.

### `ExecutiveDashboard.tsx`

Componente cliente que recibe `data` y orquesta:
- Renderiza KPICards.
- Renderiza BalanceTable, SalesTable.
- Inserta `<ComparativeSection />` como children prop (server-rendered).
- Maneja el filtro de sucursal y el cambio de URL.

---

## Manejo de fechas: TZ Argentina

### Por qué importa

El servidor de Vercel corre en UTC. Argentina es UTC-3 (sin DST).
Si construyo "hoy" con `new Date()` + `setHours(0,0,0,0)`, uso TZ del
server. A las 23:00 ART (= 02:00 UTC del día siguiente), el server
ve "mañana" mientras en Argentina sigue siendo hoy. Resultado: la
query `where: { snapshotDate: today }` no encuentra los datos de
"hoy ART".

### Helper `getArtToday`

```ts
function getArtToday(): Date {
  const artMs = Date.now() - 3 * 60 * 60 * 1000;
  const art   = new Date(artMs);
  return new Date(Date.UTC(art.getUTCFullYear(), art.getUTCMonth(), art.getUTCDate()));
}
```

Devuelve un `Date` a medianoche UTC del **día calendario en ART**. Esto
matchea con cómo Prisma devuelve fechas `@db.Date` (midnight UTC del
día almacenado).

### Cálculo de "ayer ART"

```ts
const yesterdayArt = new Date(today.getTime() - 24 * 60 * 60 * 1000);
```

Usado para la lógica de stale (ver abajo).

---

## Lógica de stale

Hay dos tipos de "stale":

### 1. Stale legítimo

Es **normal** que el dato más reciente sea de ayer:
- Domingo: el admin no sube Excel de saldos.
- Después de un feriado: misma situación.
- Madrugada (antes del cron de las 04:00): los datos de hoy todavía no llegaron.

En estos casos no queremos asustar al usuario con un banner rojo.

### 2. Stale real

El dato es **anterior a ayer**:
- El sync está caído.
- El archivo de Drive nunca se actualizó.
- Hay un problema técnico que requiere acción.

### Implementación

```ts
// Saldos
if (isStaleBalances && balances.length > 0) {
  const lastBalanceDate = balances[0].snapshotDate;
  if (lastBalanceDate.getTime() >= yesterdayArt.getTime()) {
    isStaleBalances = false;  // datos de ayer son OK
  }
}

// Ventas (misma lógica)
if (isStaleSales && sales.length > 0 && salesDate.getTime() >= yesterdayArt.getTime()) {
  isStaleSales = false;
}
```

**Resultado**: el banner "Saldos sin actualizar" solo aparece si los
datos son anteriores a ayer. Para datos de ayer, se muestra una línea
discreta gris debajo de la tabla con la fecha del último cierre.

---

## KPIs

5 cards en la parte superior. Usan `KPICard.tsx` con estilo unificado.

| KPI | Cálculo | Fuente |
|---|---|---|
| Ventas del día | `SUM(salesSnapshot.totalSales)` filtrado por hoy | `SalesSnapshot.totalSales` |
| Ticket promedio | `totalSales / totalReceipts` | derivado |
| Unidades | `SUM(salesSnapshot.units)` | `SalesSnapshot.units` |
| Tickets | `SUM(salesSnapshot.receipts)` | `SalesSnapshot.receipts` |
| Saldo bancario total | `SUM(bankBalanceSnapshot.balance)` | `BankBalanceSnapshot.balance` |

Si todas son 0 (sin datos), las cards muestran "—" o "N/A" según el caso.

---

## SalesTable.tsx

Tabla de ventas por sucursal. **El componente más complejo del módulo.**

### Vista desktop

7 columnas:
1. Chevron (expand/collapse)
2. Sucursal
3. Ventas (`fmtARS`, número completo)
4. Unidades
5. Comprobantes
6. Ticket promedio
7. vs ayer (con icono trending y color)

### Vista mobile

5 columnas compactas:
1. Chevron (20px)
2. Sucursal (1fr, flex-grow)
3. Ventas completas (auto, `fmtARS`)
4. Tickets (48px, font 11px)
5. Unidades (54px, font 11px)

```css
.sal-row {
  grid-template-columns: 20px minmax(0, 1fr) auto 48px 54px;
  gap: 0.375rem;
  padding: 0.625rem 0.875rem;
}
```

Header mobile reducido a 9.5px para que "TICKETS" quepa en 48px.

### Helpers de formato

```ts
const fmtARS = (n: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0
  }).format(n);

const fmtInt = (n: number) =>
  new Intl.NumberFormat("es-AR").format(n);
```

`fmtAbbrev` (que abreviaba a "105.5M") existió pero fue removido
después de feedback del dueño que prefiere ver el número completo.

### Expand / Collapse

Cada sucursal puede expandirse para ver detalle:
- **Tab "Obra Social"**: lista filtrable de OS con código, nombre, ventas, unidades, tickets.
- **Tab "Vendedor"**: análogo.

Búsqueda incluida en cada tab. Si no hay datos SIAF (ej: data seed),
se muestra placeholder "pendiente de datos reales".

### Filtros globales

Dos selects al tope:
- **Obra Social**: lista todas las OS presentes en cualquier sucursal.
- **Vendedor**: análogo.

Mutuamente excluyentes — si activás OS, se desactiva Vendedor.

Cuando se aplica filtro:
- Cada `BranchSales` se transforma en uno virtual con solo el subset
  del OS o vendedor seleccionado.
- Sucursales sin esa OS/Vendedor desaparecen.
- Los KPIs no se actualizan (siguen siendo del día completo).

### Ordering

Sucursales ordenadas por `totalSales DESC` (las que más venden arriba).
Decisión ejecutiva: el dueño quiere ver primero las que mueven más
plata.

---

## BalanceTable.tsx

Tabla de saldos bancarios por sucursal.

### Vista

- Una fila por sucursal con saldo total.
- Expandible para ver el desglose por banco/cuenta.
- Cada cuenta muestra: banco, saldo, cheques (opcional), saldo del día anterior.

### Origen de datos

`BankBalanceSnapshot` cargado por `sync-balances.ts` desde el Excel
`SALDOS.xlsx` que sube Administración manualmente cada mañana.

### Stale handling

Si hay datos pero no de hoy → fallback al último snapshot disponible.
Banner aparece solo si es anterior a ayer.

---

## ComparativeSection.tsx

Comparativos contra el año anterior.

### Períodos preset

- **7d, 14d, 21d, 30d**: rolling days desde anchorDate (último día disponible).
- **3m, 6m, 12m**: rolling months. La aritmética usa `setMonth(getMonth() - N) + setDate(getDate() + 1)` para anclar al inicio del mes correcto.

### Período custom

4 fechas: `currentStart`, `currentEnd`, `pastStart`, `pastEnd`. Permite
comparar cualquier rango contra cualquier otro. Útil para análisis
ad-hoc: "comparar abril 2026 vs abril 2025".

### Cálculos

API endpoint: `GET /api/dashboard/comparative?period=...&branchId=...`.

Devuelve:

```json
{
  "period": "30d",
  "branchId": "ALL",
  "anchorDate": "2026-05-05T00:00:00.000Z",
  "range": {
    "currentStart": "...", "currentEnd": "...",
    "pastStart": "...", "pastEnd": "..."
  },
  "aggregate": {
    "sales":   { "current": 12345, "yearAgo": 11000, "variation": 12.2 },
    "units":   { ... },
    "tickets": { ... }
  },
  "byBranch": [
    {
      "branchId": "...", "branchName": "Tekiel",
      "sales":   { ... },
      "units":   { ... },
      "tickets": { ... },
      "currentDaysWithData": 28
    }
  ],
  "byMonth": [    // solo para períodos mensuales
    { "month": "2026-03", "current": 12000, "yearAgo": 11500 },
    ...
  ]
}
```

### Anchor date

Cuando `period=custom`: `anchorDate = currentEnd`.

Cuando `period` es preset: `anchorDate = MAX(snapshotDate)` bajo el
filtro activo (sucursal). Esto evita "comparar últimos 30 días desde
hoy" si hoy no tiene datos — usamos el último día con datos como
ancla. Mejor UX.

### Por qué `byMonth` solo para mensuales

Para `7d`, `14d`, etc., un breakdown mensual no tiene sentido (no hay
suficientes meses). Solo se construye para `3m`, `6m`, `12m`, `custom`.

---

## AlertBanner.tsx

Banner amarillo con icono ⚠️ que aparece cuando hay alertas.

```tsx
<AlertBanner alertas={["Saldos desactualizados...", "Ventas desactualizadas..."]} />
```

Cada alerta es una string descriptiva con el último cierre disponible
en formato `DD/MM/YYYY`. Solo se renderiza si hay al menos una.

---

## TopBar (operativa) → link a ejecutivo

OWNER ve un botón "Dashboard Ejecutivo" en el TopBar de la operativa.
Click → navega a `NEXT_PUBLIC_EXECUTIVE_DASHBOARD_URL`.

Implementación: `src/components/layout/TopBar.tsx`.

Solo visible para `canViewExecutive(user)` (OWNER siempre, otros si
tienen el flag).

---

## Cache y revalidación

`/executive` server component tiene `export const revalidate = 300;`
(5 minutos). Después de un sync exitoso puede tardar hasta 5 min en
reflejarse para visitantes que ya tenían la página cacheada.

**Hard refresh (Ctrl+Shift+R)** invalida cache local del browser.

Para invalidar el cache server-side de Vercel (next/cache), no hay
endpoint manual — esperar al próximo `revalidate` o redeploy.

---

## Decisiones UX importantes

### Por qué fmtARS y no fmtAbbrev en mobile

Originalmente mobile usaba `fmtAbbrev` (105.5M) para ahorrar espacio.
El dueño pidió ver el número completo. Tradeoffs:
- Pro: menos ambigüedad (105.5M puede confundirse con $105 millones o $105.5).
- Con: requirió ajustar la grid, gap, font-size para que 9-10 caracteres entren en el width disponible.

### Por qué TICKETS y UNID. mobile y no T / U

Letras solas eran ambiguas. "TICKETS" + "UNID." es claro pero requirió
font-size 9.5px en el header (vs 10px del estándar) para entrar en
48px de columna.

### Por qué columnas mobile asimétricas (48 + 54)

`UNIDADES` típicamente tiene 4-5 dígitos (1.146, 12.345). `TICKETS`
3-4 dígitos (730, 1.087). Asimetría refleja el ancho real de los datos.

### Por qué expand all / collapse all

Para vistas extensas, click manual en cada sucursal era pesado. Botón
del header del SalesTable hace toggle masivo.

### Por qué N/A vs — para "vs ayer"

Cuando ayer no tuvo actividad (`vsYesterday === null`):
- `—` se confundía con "0%".
- `N/A` con tooltip "Sin base de comparación" es más claro.

---

## Diferencias mobile vs desktop

| Elemento | Mobile (<640px) | Desktop (≥640px) |
|---|---|---|
| `.sal-row` columnas | 5 (chevron, name, total, T, U) | 7 (+ avg ticket, vs ayer) |
| `.sal-row` gap | 0.375rem | 1rem |
| `.sal-row` padding | 0.625rem 0.875rem | 0.75rem 1rem |
| `.sal-name` font | 13px | 14px |
| `.sal-total` font | 13px | 14px |
| `.sal-num-col` font | 11px | 12px |
| Header celdas mobile-only | "TICKETS", "UNID." (9.5px) | hidden |
| Header celdas desktop-only | "Unid.", "Compr.", "Ticket prom.", "vs ayer" (10px) | visible |

---

## Referencias cruzadas

- [database/neon-schema.md](../database/neon-schema.md) — `SalesSnapshot.rawData` schema.
- [integrations/siaf-sync.md](../integrations/siaf-sync.md) — origen de los datos de ventas.
- [SECURITY.md](../SECURITY.md) — `canViewExecutive` y acceso al dashboard.
- [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) — datos viejos, cache.
