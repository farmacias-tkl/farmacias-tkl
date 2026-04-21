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
      { id: "a2", label: "Notifica ausencias con anticipación" },
      { id: "a3", label: "Asiste de forma regular sin ausentismos injustificados" },
      { id: "a4", label: "Permanece en el puesto durante su turno" },
    ],
  },
  {
    id: "rendimiento",
    title: "Rendimiento operativo",
    items: [
      { id: "r1", label: "Realiza las tareas asignadas con eficiencia" },
      { id: "r2", label: "Mantiene el ritmo de trabajo en horarios de alta demanda" },
      { id: "r3", label: "Conoce los productos y procedimientos del mostrador" },
      { id: "r4", label: "Comete pocos errores en la operación diaria" },
    ],
  },
  {
    id: "atencion",
    title: "Atención al cliente y comunicación",
    items: [
      { id: "c1", label: "Atiende al cliente con cordialidad y respeto" },
      { id: "c2", label: "Resuelve consultas o deriva adecuadamente" },
      { id: "c3", label: "Se comunica de manera clara con compañeros y supervisores" },
    ],
  },
  {
    id: "orden",
    title: "Orden y prolijidad",
    items: [
      { id: "o1", label: "Mantiene el área de trabajo ordenada" },
      { id: "o2", label: "Cuida los materiales e insumos de la sucursal" },
      { id: "o3", label: "Respeta los procedimientos de higiene" },
      { id: "o4", label: "Devuelve mercadería a su lugar correcto" },
      { id: "o5", label: "Registra correctamente las operaciones" },
    ],
  },
  {
    id: "colaboracion",
    title: "Colaboración y actitud",
    items: [
      { id: "col1", label: "Colabora con el equipo ante situaciones de mayor demanda" },
      { id: "col2", label: "Acepta y aplica las correcciones indicadas" },
      { id: "col3", label: "Muestra predisposición para aprender" },
      { id: "col4", label: "Mantiene buenas relaciones con sus compañeros" },
    ],
  },
  {
    id: "comportamiento",
    title: "Comportamiento laboral",
    items: [
      { id: "b1", label: "Respeta el reglamento interno de la farmacia" },
      { id: "b2", label: "No usa el teléfono personal en horario de atención" },
      { id: "b3", label: "Actúa con honestidad e integridad" },
    ],
  },
];
