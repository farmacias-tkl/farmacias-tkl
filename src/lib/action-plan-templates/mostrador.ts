export interface TemplateItem {
  id: string;
  label: string;
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
      { id: "a1", label: "Cumple con el horario establecido" },
      { id: "a2", label: "Notifica ausencias o llegadas tarde con anticipación" },
      { id: "a3", label: "Respeta los horarios de descanso" },
      { id: "a4", label: "Presenta ausencias reiteradas" },
    ],
  },
  {
    id: "rendimiento",
    title: "Rendimiento operativo",
    items: [
      { id: "r1", label: "Cumple con la cantidad diaria promedio de operaciones" },
      { id: "r2", label: "Factura correctamente y evita errores en ventas" },
      { id: "r3", label: "Aborda y brinda atención ágil al cliente" },
      { id: "r4", label: "Se informa sobre las normativas vigentes de obras sociales, convenios y promociones" },
    ],
  },
  {
    id: "atencion",
    title: "Atención al cliente y comunicación",
    items: [
      { id: "c1", label: "Trato cordial y profesional con los clientes" },
      { id: "c2", label: "Escucha, comprende y soluciona los reclamos" },
      { id: "c3", label: "Mantiene buena comunicación con sus compañeros" },
    ],
  },
  {
    id: "orden",
    title: "Orden y prolijidad",
    items: [
      { id: "o1", label: "Mantiene limpio y ordenado su sector de trabajo" },
      { id: "o2", label: "Informa diferencias en stock y controla vencimientos" },
      { id: "o3", label: "Mantiene la reposición y exhibición de productos" },
      { id: "o4", label: "Cuida la presentación personal y el uniforme" },
      { id: "o5", label: "Cuida el material de trabajo (PC, lector, mostrador, etc.)" },
    ],
  },
  {
    id: "colaboracion",
    title: "Colaboración y actitud",
    items: [
      { id: "col1", label: "Coopera con sus compañeros y respeta jerarquías" },
      { id: "col2", label: "Muestra buena predisposición ante tareas adicionales" },
      { id: "col3", label: "Se adapta a cambios y prioridades de la sucursal" },
      { id: "col4", label: "Acepta correcciones y sugerencias de mejora" },
    ],
  },
  {
    id: "comportamiento",
    title: "Comportamiento laboral",
    items: [
      { id: "b1", label: "Hace uso responsable del celular en horario laboral (sin distracciones ni abuso)" },
      { id: "b2", label: "Mantiene una conducta profesional y comprometida" },
      { id: "b3", label: "Evita conversaciones ajenas a la atención durante la jornada" },
    ],
  },
];
