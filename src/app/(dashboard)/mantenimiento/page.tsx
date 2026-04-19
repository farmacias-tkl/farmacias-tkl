import { Wrench } from "lucide-react";
export default function Page() {
  return (
    <div className="card p-10 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gray-100 mb-4">
        <Wrench className="w-6 h-6 text-gray-400" />
      </div>
      <h2 className="text-base font-semibold text-gray-700 mb-2">Mantenimiento</h2>
      <p className="text-sm text-gray-400 max-w-sm mx-auto">Cola operativa de tickets y evidencia.</p>
      <div className="inline-flex items-center gap-1.5 mt-4 text-xs bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
        Disponible en la siguiente etapa
      </div>
    </div>
  );
}
