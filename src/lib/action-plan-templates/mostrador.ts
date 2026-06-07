export type ItemPolarity = "POSITIVE" | "NEGATIVE";

export interface TemplateItem {
  id: string;
  label: string;
  polarity: ItemPolarity;
}

export interface TemplateSection {
  id: string;
  title: string;
  items: TemplateItem[];
}

export const MOSTRADOR_TEMPLATE: TemplateSection[] = [
  {
    id: "asistencia",
    title: "Asistencia y puntualidad",
    items: [
      { id: "a1", label: "Cumple con el horario establecido", polarity: "POSITIVE" },
      { id: "a2", label: "Notifica ausencias o llegadas tarde con anticipación", polarity: "POSITIVE" },
      { id: "a3", label: "Respeta los horarios de descanso", polarity: "POSITIVE" },
      { id: "a4", label: "Presenta ausencias reiteradas", polarity: "NEGATIVE" },
    ],
  },
  {
    id: "rendimiento",
    title: "Rendimiento operativo",
    items: [
      { id: "r1", label: "Cumple con la cantidad diaria promedio de operaciones", polarity: "POSITIVE" },
      { id: "r2", label: "Factura correctamente y evita errores en ventas", polarity: "POSITIVE" },
      { id: "r3", label: "Aborda y brinda atención ágil al cliente", polarity: "POSITIVE" },
      { id: "r4", label: "Se informa sobre las normativas vigentes de obras sociales, convenios y promociones", polarity: "POSITIVE" },
    ],
  },
  {
    id: "atencion",
    title: "Atención al cliente y comunicación",
    items: [
      { id: "c1", label: "Trato cordial y profesional con los clientes", polarity: "POSITIVE" },
      { id: "c2", label: "Escucha, comprende y soluciona los reclamos", polarity: "POSITIVE" },
      { id: "c3", label: "Mantiene buena comunicación con sus compañeros", polarity: "POSITIVE" },
    ],
  },
  {
    id: "orden",
    title: "Orden y prolijidad",
    items: [
      { id: "o1", label: "Mantiene limpio y ordenado su sector de trabajo", polarity: "POSITIVE" },
      { id: "o2", label: "Informa diferencias en stock y controla vencimientos", polarity: "POSITIVE" },
      { id: "o3", label: "Mantiene la reposición y exhibición de productos", polarity: "POSITIVE" },
      { id: "o4", label: "Cuida la presentación personal y el uniforme", polarity: "POSITIVE" },
      { id: "o5", label: "Cuida el material de trabajo (PC, lector, mostrador, etc.)", polarity: "POSITIVE" },
    ],
  },
  {
    id: "colaboracion",
    title: "Colaboración y actitud",
    items: [
      { id: "col1", label: "Coopera con sus compañeros y respeta jerarquías", polarity: "POSITIVE" },
      { id: "col2", label: "Muestra buena predisposición ante tareas adicionales", polarity: "POSITIVE" },
      { id: "col3", label: "Se adapta a cambios y prioridades de la sucursal", polarity: "POSITIVE" },
      { id: "col4", label: "Acepta correcciones y sugerencias de mejora", polarity: "POSITIVE" },
    ],
  },
  {
    id: "comportamiento",
    title: "Comportamiento laboral",
    items: [
      { id: "b1", label: "Hace uso responsable del celular en horario laboral (sin distracciones ni abuso)", polarity: "POSITIVE" },
      { id: "b2", label: "Mantiene una conducta profesional y comprometida", polarity: "POSITIVE" },
      { id: "b3", label: "Evita conversaciones ajenas a la atención durante la jornada", polarity: "POSITIVE" },
    ],
  },
];
