import Link from "next/link";
import { Users, BookOpen, Settings } from "lucide-react";

const CARDS = [
  {
    href:        "/admin/usuarios",
    icon:        Users,
    title:       "Usuarios",
    description: "Crear, editar, activar y resetear contraseñas.",
    color:       "bg-blue-50 text-blue-600",
  },
  {
    href:        "/puestos",
    icon:        BookOpen,
    title:       "Puestos",
    description: "Catalogo de puestos y configuracion de cobertura.",
    color:       "bg-violet-50 text-violet-600",
  },
];

export default function AdminPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Administracion</h2>
        <p className="text-sm text-gray-500 mt-0.5">Gestion de usuarios, catalogos y configuracion del sistema.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map(card => {
          const Icon = card.icon;
          return (
            <Link key={card.href} href={card.href}
              className="card p-5 flex items-start gap-4 hover:shadow-md transition-shadow group">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${card.color}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                  {card.title}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{card.description}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

